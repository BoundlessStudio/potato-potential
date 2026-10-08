import express, { type Express, type Request } from "express";
import { createHash, randomUUID } from "node:crypto";
import { posix } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import {
  UPLOAD_CHUNK_BYTES,
  MAX_UPLOAD_BYTES,
  DEFAULT_UPLOAD_DIRECTORY,
  type Agent,
  type FileUpload,
} from "@boundless/shared";
import type { Dependencies } from "./app";
import { HttpError } from "./security";
import { browserPath, registerBrowserRoutes } from "./file-browser";
import {
  FILE_TRANSFER_VERSION,
  filePath,
  runTransfer,
  uploadDirectory,
  uploadStage,
} from "./file-transfer";

const input = z.object({
  purpose: z.enum(["chat", "files"]).default("chat"),
  id: z.uuid(),
  name: z
    .string()
    .min(1)
    .max(240)
    .refine(
      (name) =>
        !/[\x00-\x1f/\\]/.test(name) &&
        ![".", ".."].includes(name) &&
        !name.startsWith(".boundless-upload-"),
      "Choose a regular filename.",
    ),
  directory: z.string().max(4000).default(DEFAULT_UPLOAD_DIRECTORY),
  size: z.number().int().min(0).max(MAX_UPLOAD_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const missing = (error: unknown) =>
  error instanceof HttpError && error.status === 404;
function active(upload: FileUpload) {
  if (
    ["cancelled", "expired"].includes(upload.state) ||
    Date.parse(upload.expiresAt) <= Date.now()
  )
    throw new HttpError(
      410,
      "upload_expired",
      "This upload has ended. Select the file again to start a new upload.",
    );
}

/** Runs under the existing owner lease. Staging lives in persistent storage, never in the web deployment. */
export async function cleanUploadsLocked(
  dep: Dependencies,
  ownerId: string,
  instanceId: string,
) {
  for (const upload of await dep.repo.fileUploads(ownerId)) {
    if (upload.instanceId !== instanceId || upload.cleanedAt) continue;
    if (
      upload.state !== "completed" &&
      Date.parse(upload.expiresAt) <= Date.now()
    ) {
      upload.state = "expired";
      await dep.repo.saveFileUpload(upload);
    }
    if (["expired", "cancelled", "completed"].includes(upload.state)) {
      try {
        await runTransfer(dep.a37, "cleanup", upload);
        upload.cleanedAt = new Date().toISOString();
        await dep.repo.saveFileUpload(upload);
      } catch {
        /* The next reconciliation retries cleanup. */
      }
    }
  }
}

export function registerFileRoutes(
  app: Express,
  dep: Dependencies,
  owner: (req: Request) => string,
  ready: (req: Request) => Promise<Agent & { instanceId: string }>,
) {
  const { repo, a37 } = dep;
  registerBrowserRoutes(app, dep, owner, ready);
  app.get("/api/files/directories", async (req, res) => {
    const agent = await ready(req);
    const instance = z
      .string()
      .regex(/^[a-z0-9]{10}$/)
      .parse(req.query.instance);
    if (instance !== agent.instanceId)
      throw new HttpError(
        404,
        "computer_replaced",
        "Choose a folder on your current computer. The computer may have been replaced.",
      );
    const path = uploadDirectory(
      z
        .string()
        .max(4000)
        .default(DEFAULT_UPLOAD_DIRECTORY)
        .parse(req.query.path),
    );
    const listing = await a37.listDirectories(agent.instanceId, path);
    res.setHeader("Cache-Control", "private, no-store");
    res.json(listing);
  });
  const locked = (
    req: Request,
    work: (agent: Agent & { instanceId: string }) => Promise<any>,
  ) => repo.locked(owner(req), async () => work(await ready(req)));
  async function lookup(req: Request, agent: Agent & { instanceId: string }) {
    const upload = await repo.fileUpload(
      owner(req),
      z.uuid().parse(req.params.id),
    );
    if (!upload)
      throw new HttpError(404, "upload_not_found", "Upload not found.");
    if (upload.instanceId !== agent.instanceId)
      throw new HttpError(
        409,
        "computer_replaced",
        "This upload belongs to a computer that has been replaced. Select the file again.",
      );
    return upload;
  }
  app.get("/api/files/uploads", async (req, res) =>
    res.json(
      await locked(req, async (agent) => {
        await cleanUploadsLocked(dep, owner(req), agent.instanceId);
        return {
          uploads: (await repo.fileUploads(owner(req))).filter(
            (row) =>
              row.instanceId === agent.instanceId &&
              ["uploading", "finalizing"].includes(row.state),
          ),
        };
      }),
    ),
  );
  app.post("/api/files/uploads", async (req, res) => {
    const body = input.parse(req.body);
    const directory = uploadDirectory(body.directory);
    res.json(
      await locked(req, async (agent) => {
        if ((agent.fileTransferVersion || 0) < FILE_TRANSFER_VERSION) {
          await dep.lifecycle.configurePersona(
            (await repo.profile(owner(req)))!,
            agent,
          );
          await repo.saveAgent(agent);
        }
        let upload = await repo.fileUpload(owner(req), body.id);
        if (upload) {
          if (
            upload.instanceId !== agent.instanceId ||
            upload.name !== body.name ||
            upload.size !== body.size ||
            upload.sha256 !== body.sha256 ||
            (upload.purpose || "chat") !== body.purpose ||
            upload.directory !== directory
          )
            throw new HttpError(
              409,
              "upload_conflict",
              "The selected file does not match this upload.",
            );
          if (upload.state !== "completed") active(upload);
        } else {
          upload = {
            ...body,
            directory,
            ownerId: owner(req),
            instanceId: agent.instanceId,
            chunks: {},
            state: "uploading",
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 86400_000).toISOString(),
          };
          await repo.saveFileUpload(upload);
        }
        if (upload.state === "uploading")
          await runTransfer(a37, "prepare", upload);
        return { upload, chunkSize: UPLOAD_CHUNK_BYTES };
      }),
    );
  });
  app.get("/api/files/uploads/:id", async (req, res) =>
    res.json(
      await locked(req, async (agent) => ({
        upload: await lookup(req, agent),
        chunkSize: UPLOAD_CHUNK_BYTES,
      })),
    ),
  );
  app.put(
    "/api/files/uploads/:id/chunks/:index",
    express.raw({ type: () => true, limit: UPLOAD_CHUNK_BYTES }),
    async (req, res) => {
      res.json(
        await locked(req, async (agent) => {
          const upload = await lookup(req, agent);
          active(upload);
          const index = z.coerce.number().int().min(0).parse(req.params.index);
          const expected = Math.min(
            UPLOAD_CHUNK_BYTES,
            upload.size - index * UPLOAD_CHUNK_BYTES,
          );
          if (
            expected <= 0 ||
            !Buffer.isBuffer(req.body) ||
            req.body.length !== expected
          )
            throw new HttpError(
              400,
              "chunk_length",
              "This file piece is incomplete. Retry the upload.",
            );
          const digest = createHash("sha256").update(req.body).digest("hex");
          if (upload.chunks[index]) {
            if (upload.chunks[index] !== digest)
              throw new HttpError(
                409,
                "chunk_conflict",
                "This piece does not match the original file.",
              );
            return { upload };
          }
          if (upload.state !== "uploading")
            throw new HttpError(
              409,
              "upload_finalizing",
              "This upload is being completed. Retry completion.",
            );
          await runTransfer(a37, "prepare", upload);
          await runTransfer(a37, "chunk", upload, index);
          // A concrete Uint8Array gives fetch a sized body; the Agent37 proxy cannot accept HTTP chunked writes.
          const part = await a37.writeBinary(
            agent.instanceId,
            `${uploadStage(upload.id)}/${index}.part`,
            new Uint8Array(req.body),
          );
          if (
            part.size !== expected ||
            part.type !== "file" ||
            part.path !== `${uploadStage(upload.id)}/${index}.part`
          )
            throw new HttpError(
              502,
              "chunk_length",
              "The computer did not save the complete piece. Retry the upload.",
            );
          upload.chunks[index] = digest;
          await repo.saveFileUpload(upload);
          return { upload };
        }),
      );
    },
  );
  app.post("/api/files/uploads/:id/complete", async (req, res) =>
    res.json(
      await locked(req, async (agent) => {
        const upload = await lookup(req, agent);
        if (upload.state === "completed") return { upload };
        active(upload);
        if (
          Object.keys(upload.chunks).length !==
          Math.ceil(upload.size / UPLOAD_CHUNK_BYTES)
        )
          throw new HttpError(
            409,
            "upload_incomplete",
            "Upload all file pieces before completing.",
          );
        if (!upload.target) {
          let target = posix.join(upload.directory, upload.name);
          try {
            await a37.statFile(agent.instanceId, target);
            target = "";
          } catch (error) {
            if (!missing(error)) throw error;
          }
          if (!target) {
            const extension = posix.extname(upload.name),
              stem = upload.name.slice(
                0,
                upload.name.length - extension.length,
              );
            target = posix.join(
              upload.directory,
              `${stem}-${upload.id}${extension}`,
            );
          }
          upload.target = target;
          upload.state = "finalizing";
          await repo.saveFileUpload(upload);
        }
        if (upload.state !== "finalizing") {
          upload.state = "finalizing";
          await repo.saveFileUpload(upload);
        }
        let result;
        try {
          result = await runTransfer(a37, "complete", upload);
        } catch (error) {
          if (
            error instanceof HttpError &&
            error.code === "checksum_mismatch"
          ) {
            upload.chunks = {};
            upload.state = "uploading";
            await repo.saveFileUpload(upload);
          }
          if (!(error instanceof HttpError) || error.code !== "file_exists")
            throw error;
          const extension = posix.extname(upload.name),
            stem = upload.name.slice(0, upload.name.length - extension.length);
          upload.target = posix.join(
            upload.directory,
            `${stem}-${randomUUID()}${extension}`,
          );
          await repo.saveFileUpload(upload);
          result = await runTransfer(a37, "complete", upload);
        }
        if (
          result.file?.path !== upload.target ||
          result.file?.type !== "file" ||
          result.file?.size !== upload.size
        )
          throw new HttpError(
            502,
            "invalid_receipt",
            "The computer returned an invalid file receipt. Retry completion.",
          );
        upload.file = result.file;
        upload.state = "completed";
        await repo.saveFileUpload(upload);
        try {
          await runTransfer(a37, "cleanup", upload);
          upload.cleanedAt = new Date().toISOString();
          await repo.saveFileUpload(upload);
        } catch {
          /* Reconcile cleanup later. */
        }
        return { upload };
      }),
    ),
  );
  app.delete("/api/files/uploads/:id", async (req, res) =>
    res.json(
      await locked(req, async (agent) => {
        const upload = await lookup(req, agent);
        if (upload.state !== "completed") {
          upload.state = "cancelled";
          await repo.saveFileUpload(upload);
        }
        await runTransfer(a37, "cleanup", upload);
        upload.cleanedAt = new Date().toISOString();
        await repo.saveFileUpload(upload);
        return { upload };
      }),
    ),
  );
  app.get("/api/files/content", async (req, res) => {
    const agent = await ready(req);
    const instance = z
      .string()
      .regex(/^[a-z0-9]{10}$/)
      .parse(req.query.instance);
    if (instance !== agent.instanceId)
      throw new HttpError(
        404,
        "computer_replaced",
        "This file is not on your current computer. The computer may have been replaced.",
      );
    const path = filePath(z.string().parse(req.query.path));
    const archive = z.literal("1").optional().parse(req.query.archive);
    if (archive) await a37.listFiles(agent.instanceId, browserPath(path));
    const file = archive
      ? { name: posix.basename(path) + ".tar.gz" }
      : await a37.statFile(agent.instanceId, path);
    const upstream = archive
      ? await a37.archiveFolder(agent.instanceId, path)
      : await a37.downloadFile(agent.instanceId, path);
    if (!upstream.body)
      throw new HttpError(
        502,
        "empty_download",
        "The computer returned an empty download.",
      );
    const name = file.name.replace(/[\r\n"]/g, "_");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name).replace(/[!'()*]/g, (char) => "%" + char.charCodeAt(0).toString(16))}`,
    );
    res.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") || "application/octet-stream",
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      await pipeline(Readable.fromWeb(upstream.body as any), res);
    } catch (error) {
      if (!res.destroyed) throw error;
    }
  });
}
