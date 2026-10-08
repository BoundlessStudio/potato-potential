import { posix } from "node:path";
import { HttpError } from "./security";
import { uploadDirectory } from "./file-transfer";
import type { Express, Request } from "express";
import type { Agent } from "@boundless/shared";
import type { Dependencies } from "./app";
import { z } from "zod";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export function browserPath(value: string, mutation = false) {
  const path = uploadDirectory(value);
  if (
    path
      .split("/")
      .some(
        (part) =>
          part === ".boundless" || part.startsWith(".boundless-upload-"),
      ) ||
    (mutation && ["/home/node", "/home/linuxbrew"].includes(path))
  )
    throw new HttpError(
      400,
      "protected_path",
      "This path is managed by the application.",
    );
  return path;
}
export function browserName(value: string) {
  if (
    !value.trim() ||
    value.length > 240 ||
    /[\x00-\x1f/\\]/.test(value) ||
    [".", ".."].includes(value)
  )
    throw new HttpError(
      400,
      "invalid_name",
      "Choose a regular file or folder name.",
    );
  return value;
}
export const browserTarget = (path: string, name: string) =>
  browserPath(posix.join(posix.dirname(path), browserName(name)), true);

export function registerBrowserRoutes(
  app: Express,
  dep: Dependencies,
  owner: (req: Request) => string,
  ready: (req: Request) => Promise<Agent & { instanceId: string }>,
) {
  const scope = z.object({
    instance: z.string().regex(/^[a-z0-9]{10}$/),
    path: z.string().max(4000),
  });
  async function current(req: Request, instance: string) {
    const agent = await ready(req);
    if (agent.instanceId !== instance)
      throw new HttpError(
        404,
        "computer_replaced",
        "This item belongs to a different computer. Refresh and try again.",
      );
    return agent;
  }
  app.get("/api/files/list", async (req, res) => {
    const query = scope.parse(req.query);
    const agent = await current(req, query.instance);
    const listing = await dep.a37.listFiles(
      agent.instanceId,
      browserPath(query.path),
    );
    res.json({
      ...listing,
      entries: listing.entries.filter((entry) => {
        try {
          browserPath(entry.path);
          return true;
        } catch {
          return false;
        }
      }),
    });
  });
  app.post("/api/files/entries", async (req, res) => {
    const body = scope
      .extend({
        action: z.enum(["create", "rename", "delete"]),
        name: z.string().optional(),
        modified: z.number().optional(),
      })
      .strict()
      .parse(req.body);
    await dep.repo.locked(owner(req), async () => {
      const agent = await current(req, body.instance);
      const path = browserPath(body.path, body.action !== "create");
      const target =
        body.action === "create"
          ? browserPath(posix.join(path, browserName(body.name || "")), true)
          : path;
      const to =
        body.action === "rename"
          ? browserTarget(path, body.name || "")
          : undefined;
      if (body.action !== "create") {
        const uploads = await dep.repo.fileUploads(owner(req));
        if (
          uploads.some(
            (upload) =>
              upload.instanceId === agent.instanceId &&
              ["uploading", "finalizing"].includes(upload.state) &&
              Date.parse(upload.expiresAt) > Date.now() &&
              [upload.directory, upload.target].some(
                (p) => p && (p === path || p.startsWith(path + "/")),
              ),
          )
        )
          throw new HttpError(
            409,
            "upload_busy",
            "Finish or cancel uploads in this folder before changing it.",
          );
      }
      if (body.action === "rename" && to === path) return;
      await dep.a37.manageFile(
        agent.instanceId,
        body.action,
        target,
        to,
        body.modified,
      );
    });
    res.json({ ok: true });
  });
  app.get("/api/files/preview", async (req, res) => {
    const query = scope.parse(req.query);
    const agent = await current(req, query.instance);
    const path = browserPath(query.path);
    const listing = await dep.a37.listFiles(
      agent.instanceId,
      posix.dirname(path),
    );
    const entry = listing.entries.find(
      (entry) => entry.path === path && entry.type === "file",
    );
    if (!entry)
      throw new HttpError(
        404,
        "file_not_found",
        "This file no longer exists or cannot be previewed.",
      );
    const file = await dep.a37.statFile(agent.instanceId, path);
    if (file.size > 20_000_000)
      throw new HttpError(
        413,
        "preview_too_large",
        "This file is too large to preview. Download it to open it.",
      );
    const upstream = await dep.a37.downloadFile(agent.instanceId, path);
    if (!upstream.body)
      throw new HttpError(
        502,
        "empty_download",
        "The computer returned an empty file.",
      );
    res.set({
      "Content-Type": "application/octet-stream",
      "Content-Disposition": "attachment",
      "Cache-Control": "private, no-store",
    });
    try {
      await pipeline(Readable.fromWeb(upstream.body as any), res);
    } catch (error) {
      if (!res.destroyed) throw error;
    }
  });
}

// Variable input is encoded data. Validate every ancestor before native file API calls.
// Renames use mv -n -T so even a concurrently created destination is never overwritten.
export const browserCheckScript = String.raw`const fs=require('node:fs');const p=require('node:path');const cp=require('node:child_process');const u=JSON.parse(Buffer.from(process.argv[1],'base64url').toString('utf8'));
const fail=(code,message,status=400)=>{throw Object.assign(new Error(message),{code,status});};
function check(path,missing=false){if(!['/home/node','/home/linuxbrew'].some(r=>path===r||path.startsWith(r+'/'))||path.split('/').some(s=>s==='.'||s==='..'||s==='.boundless'||s.startsWith('.boundless-upload-'))||/[\x00-\x1f\\]/.test(path))fail('invalid_path','Choose a path in persistent storage.');let current='',s;for(const part of path.split('/').filter(Boolean)){current+='/'+part;try{s=fs.lstatSync(current);}catch(e){if(missing&&e.code==='ENOENT')return null;throw e;}if(s.isSymbolicLink())fail('symbolic_link','Symbolic links cannot be opened or changed here.');if(current!==path&&!s.isDirectory())fail('invalid_path','A parent is not a folder.');}return s;}
try{const s=check(u.path,u.action==='create');if(u.action==='create'){if(s&&!s.isDirectory())fail('file_exists','An item already uses that name.',409);}
else{if(!s)fail('not_found','This item no longer exists.',404);if(u.modified!==undefined&&s.mtimeMs!==u.modified)fail('modified','This item changed. Refresh before trying again.',412);}
if(u.action==='rename'){if(check(u.to,true))fail('file_exists','An item already uses that name.',409);const r=cp.spawnSync('mv',['-n','-T','--',u.path,u.to],{encoding:'utf8'});if(r.status!==0)fail('rename_failed','Could not rename this item.');if(fs.existsSync(u.path))fail('file_exists','An item already uses that name.',409);}
console.log(JSON.stringify({ok:true}));}catch(e){console.log(JSON.stringify({code:e.code==='ENOENT'?'not_found':e.code||'file_operation_failed',error:e.code==='ENOENT'?'This item no longer exists.':e.message,status:e.status||(e.code==='ENOENT'?404:400)}));process.exitCode=1;}`;
