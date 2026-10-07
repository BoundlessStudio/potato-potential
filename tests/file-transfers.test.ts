import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  UPLOAD_CHUNK_BYTES,
  MAX_UPLOAD_BYTES,
  type FileUpload,
} from "@boundless/shared";
import {
  DemoAgent37,
  DemoInkbox,
  DEMO_USER,
  DEMO_NEW_USER,
  seedDemo,
} from "../services/control-plane/src/demo";
import { MemoryRepository } from "../services/control-plane/src/repository";
import { Lifecycle } from "../services/control-plane/src/lifecycle";
import { loadConfig } from "../services/control-plane/src/config";
import { createApp } from "../services/control-plane/src/app";
import { HttpError } from "../services/control-plane/src/security";
import { Agent37 } from "../services/control-plane/src/providers";
import { prepareExpressRequest } from "../apps/web/src/server/express-request";
let server: Server,
  base: string,
  repo: MemoryRepository,
  provider: DemoAgent37,
  instance: string;
beforeEach(async () => {
  repo = new MemoryRepository();
  provider = new DemoAgent37();
  const inkbox = new DemoInkbox();
  await seedDemo(repo, provider, inkbox);
  const agent = (await repo.agent(DEMO_USER))!;
  instance = agent.instanceId!;
  await repo.saveProfile({
    ...(await repo.profile(DEMO_USER))!,
    id: DEMO_NEW_USER,
    email: "new@example.com",
  });
  await repo.saveAgent({
    ...agent,
    ownerId: DEMO_NEW_USER,
    instanceId: "new1234567",
    mainSessionId: undefined,
  });
  const config = loadConfig({ DEMO_MODE: "true" });
  await new Promise<void>((resolve) => {
    const app = createApp({
      config,
      repo,
      a37: provider,
      inkbox,
      lifecycle: new Lifecycle(config, repo, provider, inkbox),
      queue: { send: vi.fn() },
    });
    server = createServer((req, res) => {
      Object.defineProperty(req, "query", {
        value: { path: ["files", "content"] },
        configurable: true,
      });
      prepareExpressRequest(req);
      app(req, res);
    }).listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
});
afterEach(async () => {
  vi.unstubAllGlobals();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const call = (path: string, method = "GET", body?: unknown, key = "demo") =>
  fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type":
        body instanceof Uint8Array
          ? "application/octet-stream"
          : "application/json",
    },
    ...(body !== undefined
      ? {
          body:
            body instanceof Uint8Array
              ? new Uint8Array(body)
              : JSON.stringify(body),
        }
      : {}),
  });
it("defaults uploads to the uploads folder and attaches the exact saved path to the native turn", async () => {
  const response = await call("/files/uploads", "POST", {
    id: randomUUID(),
    name: "home.txt",
    size: 0,
    sha256: digest(Buffer.alloc(0)),
  });
  expect(response.status).toBe(200);
  const { upload } = await response.json();
  expect(upload.directory).toBe("/home/node/uploads");
  const saved = await complete(upload);
  expect(saved.file!.path).toBe("/home/node/uploads/home.txt");
  expect(
    (await call("/responses", "POST", { input: "", files: [saved.file!.path] }))
      .status,
  ).toBe(200);
  expect(provider.responseRequests.at(-1)!.body.files).toEqual([
    saved.file!.path,
  ]);
  expect(provider.files.get("~/.hermes/SOUL.md")!.content).toContain(
    "Uploads are saved to /home/node/uploads/ by default",
  );
});
it("lists only this owner's remote folders with persistent roots and lifecycle restrictions", async () => {
  const listing = vi.spyOn(provider, "listDirectories");
  const url = `/files/directories?${new URLSearchParams({ instance, path: "/home/node/" })}`;
  const response = await call(url);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const folders = await response.json();
  expect(folders.path).toBe("/home/node");
  expect(folders.parentPath).toBeNull();
  expect(folders.directories).toContainEqual({
    name: "work",
    path: "/home/node/work",
    hidden: false,
  });
  expect(listing).toHaveBeenLastCalledWith(instance, "/home/node");
  const nested = await (
    await call(
      `/files/directories?${new URLSearchParams({ instance, path: "~/work" })}`,
    )
  ).json();
  expect(nested.parentPath).toBe("/home/node");
  expect(nested.directories).toContainEqual({
    name: "客户",
    path: "/home/node/work/客户",
    hidden: false,
  });
  expect(
    (
      await call(
        `/files/directories?${new URLSearchParams({ instance, path: "/home/node/missing" })}`,
      )
    ).status,
  ).toBe(404);
  for (const path of [
    "/etc",
    "/home/node/../linuxbrew",
    "/home/node/./work",
    "/home/node-other",
    "/home/node/work\\escape",
  ])
    expect(
      (
        await call(
          `/files/directories?${new URLSearchParams({ instance, path })}`,
        )
      ).status,
    ).toBe(400);
  listing.mockClear();
  expect((await call(url, "GET", undefined, "wrong")).status).toBe(401);
  expect((await call(url, "GET", undefined, "demo-new")).status).toBe(404);
  expect(listing).not.toHaveBeenCalled();
  const agent = (await repo.agent(DEMO_USER))!;
  agent.suspended = true;
  await repo.saveAgent(agent);
  expect((await call(url)).status).toBe(403);
  agent.suspended = false;
  agent.computerOperation = {
    id: randomUUID(),
    action: "restart",
    phase: "queued",
    targetTemplate: "test",
    requestedAt: new Date().toISOString(),
  };
  await repo.saveAgent(agent);
  expect((await call(url)).status).toBe(409);
  agent.computerOperation = undefined;
  agent.status = "deleting";
  await repo.saveAgent(agent);
  expect((await call(url)).status).toBe(409);
  expect(listing).not.toHaveBeenCalled();
});
async function create(
  bytes: Uint8Array,
  name = "leads.csv",
  directory = "~/uploads",
) {
  const response = await call("/files/uploads", "POST", {
    id: randomUUID(),
    name,
    directory,
    size: bytes.length,
    sha256: digest(bytes),
  });
  expect(response.status).toBe(200);
  return (await response.json()).upload as FileUpload;
}
async function pieces(upload: FileUpload, bytes: Uint8Array) {
  for (let i = 0; i < Math.ceil(bytes.length / UPLOAD_CHUNK_BYTES); i++)
    expect(
      (
        await call(
          `/files/uploads/${upload.id}/chunks/${i}`,
          "PUT",
          bytes.subarray(i * UPLOAD_CHUNK_BYTES, (i + 1) * UPLOAD_CHUNK_BYTES),
        )
      ).status,
    ).toBe(200);
}
async function complete(upload: FileUpload) {
  const response = await call(
    `/files/uploads/${upload.id}/complete`,
    "POST",
    {},
  );
  expect(response.status).toBe(200);
  return (await response.json()).upload as FileUpload;
}
it("round-trips binary data over 4.5 MB in sized pieces, then forwards exact paths for multiple native attachments", async () => {
  const bytes = Buffer.alloc(5_000_001);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
  const write = vi.spyOn(provider, "writeBinary");
  const large = await create(bytes, "résumé.csv", "~/work/客户");
  await pieces(large, bytes);
  const saved = await complete(large);
  const empty = await complete(
    await create(new Uint8Array(), "empty.txt", "/home/linuxbrew/data"),
  );
  expect(
    write.mock.calls
      .filter((call) => call[1].endsWith(".part"))
      .map((call) => call[2].byteLength),
  ).toEqual([
    UPLOAD_CHUNK_BYTES,
    UPLOAD_CHUNK_BYTES,
    bytes.length - 2 * UPLOAD_CHUNK_BYTES,
  ]);
  expect(saved.file!.path).toBe("/home/node/work/客户/résumé.csv");
  const download = await call(
    `/files/content?${new URLSearchParams({ instance, path: saved.file!.path })}`,
  );
  expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
  expect(download.headers.get("content-disposition")).toContain(
    "filename*=UTF-8''r%C3%A9sum%C3%A9.csv",
  );
  expect(download.headers.get("cache-control")).toContain("no-store");
  expect(download.headers.get("x-content-type-options")).toBe("nosniff");
  const paths = [saved.file!.path, empty.file!.path];
  const response = await call("/responses", "POST", {
    input: "Summarize",
    files: paths,
  });
  expect(response.status).toBe(200);
  await response.text();
  expect(provider.responseRequests.at(-1)!.body).toMatchObject({
    files: paths,
    agent: "hermes",
    stream: true,
  });
  const session = await provider.session(
    instance,
    (await repo.agent(DEMO_USER))!.mainSessionId!,
  );
  expect(session.history.at(-2)!.content).toContain("résumé.csv");
  expect(session.history.at(-2)!.content).toContain(
    "/api/files/content?instance=",
  );
});
it("allows files-only turns, preserves collision contents, and includes only selected paths", async () => {
  const bytes = Buffer.from("original");
  const first = await create(bytes);
  await pieces(first, bytes);
  const a = await complete(first);
  const second = await create(Buffer.from("second"));
  await pieces(second, Buffer.from("second"));
  const b = await complete(second);
  expect(b.file!.path).not.toBe(a.file!.path);
  expect(b.file!.path).toMatch(/leads-.+\.csv$/);
  expect(
    await (await provider.downloadFile(instance, a.file!.path)).text(),
  ).toBe("original");
  const response = await call("/responses", "POST", { files: [b.file!.path] });
  await response.text();
  expect(provider.responseRequests.at(-1)!.body.files).toEqual([b.file!.path]);
  expect(provider.responseRequests.at(-1)!.body.input).toContain(
    "I’ve uploaded these files.",
  );
  expect((await provider.statFile(instance, a.file!.path)).size).toBe(
    bytes.length,
  );
});
it("refuses missing attachments without dispatching and allows a preserved submission to retry", async () => {
  const missing = "/home/node/uploads/missing.csv";
  expect(
    (
      await call("/responses", "POST", {
        input: "Keep this draft",
        files: [missing],
      })
    ).status,
  ).toBe(404);
  expect(provider.responseRequests).toHaveLength(0);
  await provider.writeBinary(instance, missing, Buffer.from("restored"));
  const response = await call("/responses", "POST", {
    input: "Keep this draft",
    files: [missing],
  });
  expect(response.status).toBe(200);
  await response.text();
  expect(provider.responseRequests.at(-1)!.body.files).toEqual([missing]);
});
it("reconciles an interrupted piece and lost completion reply without publishing twice", async () => {
  const bytes = Buffer.from("lost replies");
  const upload = await create(bytes);
  const write = provider.writeBinary.bind(provider);
  vi.spyOn(provider, "writeBinary").mockImplementationOnce(async (...args) => {
    await write(...args);
    throw new HttpError(502, "lost_reply", "Lost upload reply.");
  });
  expect(
    (await call(`/files/uploads/${upload.id}/chunks/0`, "PUT", bytes)).status,
  ).toBe(502);
  await pieces(upload, bytes);
  expect(
    (
      await call(
        `/files/uploads/${upload.id}/chunks/0`,
        "PUT",
        Buffer.from("not the same"),
      )
    ).status,
  ).toBe(409);
  const exec = provider.exec.bind(provider);
  let lost = false;
  vi.spyOn(provider, "exec").mockImplementation(async (id, command) => {
    const result = await exec(id, command);
    if (!lost && command?.includes("'complete'")) {
      lost = true;
      throw new HttpError(502, "lost_reply", "Lost completion reply.");
    }
    return result;
  });
  expect(
    (await call(`/files/uploads/${upload.id}/complete`, "POST", {})).status,
  ).toBe(502);
  const saved = await complete(upload);
  expect((await complete(upload)).file!.path).toBe(saved.file!.path);
  expect(
    [...provider.binaryFiles.keys()].filter((key) =>
      key.includes("/uploads/leads"),
    ),
  ).toHaveLength(1);
});
it("validates the 100 MB boundary, piece lengths, checksum, paths and immutable bindings", async () => {
  const body = {
    id: randomUUID(),
    name: "boundary.bin",
    size: MAX_UPLOAD_BYTES,
    sha256: "a".repeat(64),
  };
  expect((await call("/files/uploads", "POST", body)).status).toBe(200);
  expect(
    (
      await call("/files/uploads", "POST", {
        ...body,
        id: randomUUID(),
        size: MAX_UPLOAD_BYTES + 1,
      })
    ).status,
  ).toBe(400);
  for (const directory of [
    "~/../outside",
    "/etc",
    "/home/node/../../tmp",
    "/home/node\\escape",
  ])
    expect(
      (
        await call("/files/uploads", "POST", {
          ...body,
          id: randomUUID(),
          directory,
        })
      ).status,
    ).toBe(400);
  expect(
    (await call("/files/uploads", "POST", { ...body, name: "../escape" }))
      .status,
  ).toBe(400);
  expect(
    (await call("/files/uploads", "POST", { ...body, sha256: "b".repeat(64) }))
      .status,
  ).toBe(409);
  expect(
    (
      await call(
        `/files/uploads/${body.id}/chunks/0`,
        "PUT",
        new Uint8Array(100),
      )
    ).status,
  ).toBe(400);
  expect(
    (await call(`/files/uploads/${body.id}/complete`, "POST", {})).status,
  ).toBe(409);
  const bad = await create(Buffer.from("abc"));
  await pieces(bad, Buffer.from("xyz"));
  expect(
    (await call(`/files/uploads/${bad.id}/complete`, "POST", {})).status,
  ).toBe(400);
  expect(
    provider.binaryFiles.has(`${instance}:/home/node/uploads/leads.csv`),
  ).toBe(false);
  const repair = (await repo.fileUpload(DEMO_USER, bad.id))!;
  expect(repair.state).toBe("uploading");
  expect(repair.chunks).toEqual({});
  await pieces(repair, Buffer.from("abc"));
  expect((await complete(repair)).file!.size).toBe(3);
});
it("cleans cancelled and expired staging while completed files remain downloadable", async () => {
  const bytes = Buffer.from("staged");
  const upload = await create(bytes);
  await pieces(upload, bytes);
  expect((await call(`/files/uploads/${upload.id}`, "DELETE")).status).toBe(
    200,
  );
  expect(
    (await call(`/files/uploads/${upload.id}/complete`, "POST", {})).status,
  ).toBe(410);
  const abandoned = await create(bytes);
  await pieces(abandoned, bytes);
  const row = (await repo.fileUpload(DEMO_USER, abandoned.id))!;
  row.expiresAt = new Date(Date.now() - 1).toISOString();
  await repo.saveFileUpload(row);
  expect((await call("/files/uploads")).status).toBe(200);
  expect((await repo.fileUpload(DEMO_USER, row.id))!.state).toBe("expired");
  expect(
    [...provider.binaryFiles.keys()].some(
      (key) => key.includes(row.id) || key.includes(upload.id),
    ),
  ).toBe(false);
  const completed = await create(bytes);
  await pieces(completed, bytes);
  const saved = await complete(completed);
  await call(`/files/uploads/${saved.id}`, "DELETE");
  expect(
    await (await provider.downloadFile(instance, saved.file!.path)).text(),
  ).toBe("staged");
});
it("enforces owner isolation, authentication, current computer and lifecycle guards", async () => {
  const bytes = Buffer.from("private");
  const row = await create(bytes);
  await pieces(row, bytes);
  const saved = await complete(row);
  const url = `/files/content?${new URLSearchParams({ instance, path: saved.file!.path })}`;
  expect((await call(url, "GET", undefined, "wrong")).status).toBe(401);
  expect((await call(url, "GET", undefined, "demo-new")).status).toBe(404);
  expect(
    (await call(`/files/uploads/${row.id}`, "GET", undefined, "demo-new"))
      .status,
  ).toBe(404);
  const agent = (await repo.agent(DEMO_USER))!;
  agent.suspended = true;
  await repo.saveAgent(agent);
  expect((await call(url)).status).toBe(403);
  agent.suspended = false;
  agent.computerOperation = {
    id: randomUUID(),
    action: "restart",
    phase: "queued",
    targetTemplate: "test",
    requestedAt: new Date().toISOString(),
  };
  await repo.saveAgent(agent);
  expect((await call(url)).status).toBe(409);
  agent.computerOperation = undefined;
  agent.instanceId = "new1234567";
  await repo.saveAgent(agent);
  expect((await call(url)).status).toBe(404);
  expect((await call(`/files/uploads/${row.id}`)).status).toBe(409);
  agent.status = "deleting";
  await repo.saveAgent(agent);
  expect((await call(url)).status).toBe(409);
});
it("retains verified pieces after disk exhaustion and rejects oversized chunk bodies before writing", async () => {
  const bytes = Buffer.from("retry when space is available"),
    upload = await create(bytes);
  const write = vi.spyOn(provider, "writeBinary");
  expect(
    (
      await call(
        `/files/uploads/${upload.id}/chunks/0`,
        "PUT",
        Buffer.alloc(UPLOAD_CHUNK_BYTES + 1),
      )
    ).status,
  ).toBe(413);
  expect(write).not.toHaveBeenCalled();
  await pieces(upload, bytes);
  const exec = provider.exec.bind(provider);
  let full = true;
  vi.spyOn(provider, "exec").mockImplementation(async (id, command) => {
    if (full && command?.includes("'complete'"))
      return {
        stdout: JSON.stringify({
          code: "ENOSPC",
          error: "The computer is out of disk space.",
        }),
        stderr: "",
        exit_code: 1,
      };
    return exec(id, command);
  });
  const failed = await call(`/files/uploads/${upload.id}/complete`, "POST", {});
  expect(failed.status).toBe(400);
  expect((await failed.json()).error.message).toBe(
    "The computer is out of disk space.",
  );
  expect(
    Object.keys((await repo.fileUpload(DEMO_USER, upload.id))!.chunks),
  ).toEqual(["0"]);
  full = false;
  expect((await complete(upload)).file!.size).toBe(bytes.length);
});
it("sends a concrete binary upstream body with a known byte length and streams reads", async () => {
  const bytes = new Uint8Array([0, 255, 1]);
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ path: "/home/node/piece", size: 3, type: "file" }),
    )
    .mockResolvedValueOnce(new Response(bytes));
  fetch.mockResolvedValueOnce(new Response("native response"));
  vi.stubGlobal("fetch", fetch);
  const a37 = new Agent37("test-server-key");
  await a37.writeBinary("abcdefghij", "/home/node/piece", bytes);
  expect(fetch.mock.calls[0][1].body).toBeInstanceOf(Uint8Array);
  expect(fetch.mock.calls[0][1].body.byteLength).toBe(3);
  expect(fetch.mock.calls[0][1].headers["X-Agent37-Key"]).toBe(
    "test-server-key",
  );
  expect(
    Buffer.from(
      await (
        await a37.downloadFile("abcdefghij", "/home/node/piece")
      ).arrayBuffer(),
    ),
  ).toEqual(Buffer.from(bytes));
  const files = ["/home/node/uploads/a.csv", "/home/linuxbrew/b.txt"];
  await a37.responses("abcdefghij", {
    input: "Use these files",
    files,
    stream: true,
  });
  expect(fetch.mock.calls.at(-1)![0]).toBe(
    "https://abcdefghij.agent37.app/v1/responses",
  );
  expect(JSON.parse(fetch.mock.calls.at(-1)![1].body).files).toEqual(files);
});
