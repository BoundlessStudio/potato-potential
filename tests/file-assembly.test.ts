import { afterAll, beforeAll, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { execFile as callbackExec } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  writeFile,
  readFile,
  rm,
  link,
  symlink,
  lstat,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  fileTransferHelper,
  directoryStatScript,
} from "../services/control-plane/src/file-transfer";
const physical = resolve(".cache", `assembly-${randomUUID()}`);
// Slash-rooted paths resolve on the current drive on Windows, just as /home/node does on Linux.
const root = physical.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "");
const node = root + "/node",
  brew = root + "/linuxbrew",
  helper = join(physical, "helper.mjs");
const exec = promisify(callbackExec),
  hash = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");
beforeAll(async () => {
  await mkdir(physical, { recursive: true });
  await mkdir(node);
  await mkdir(brew);
  await writeFile(
    helper,
    fileTransferHelper
      .replaceAll("/home/node", node)
      .replaceAll("/home/linuxbrew", brew),
  );
});
afterAll(async () => {
  await rm(physical, { recursive: true, force: true });
});
async function fixture(bytes = Buffer.from("verified bytes")) {
  const u = {
    id: randomUUID(),
    directory: node + "/uploads",
    target: node + `/uploads/${randomUUID()}.bin`,
    size: bytes.length,
    sha256: hash(bytes),
    chunks: { "0": hash(bytes) },
  };
  await run("prepare", u);
  if (bytes.length)
    await writeFile(node + `/.boundless/file-uploads/${u.id}/0.part`, bytes);
  return { u, bytes };
}
async function run(command: string, u: any) {
  try {
    const result = await exec(process.execPath, [
      helper,
      command,
      Buffer.from(JSON.stringify(u)).toString("base64url"),
    ]);
    return JSON.parse(result.stdout);
  } catch (error: any) {
    return { failed: true, ...JSON.parse(error.stdout) };
  }
}
it("assembles exact binary bytes, supports empty files, rejects corrupt pieces and never overwrites", async () => {
  const { u, bytes } = await fixture(Buffer.from([0, 255, 128, 5]));
  expect((await run("complete", u)).file.path).toBe(u.target);
  expect(await readFile(u.target)).toEqual(bytes);
  expect((await run("complete", u)).file.path).toBe(u.target);
  const empty = await fixture(Buffer.alloc(0));
  expect((await run("complete", empty.u)).file.size).toBe(0);
  const corrupt = await fixture();
  await writeFile(
    node + `/.boundless/file-uploads/${corrupt.u.id}/0.part`,
    "changed bytes!",
  );
  expect(await run("complete", corrupt.u)).toMatchObject({
    failed: true,
    code: "checksum_mismatch",
  });
  const collision = await fixture();
  await writeFile(collision.u.target, "keep this");
  expect(await run("complete", collision.u)).toMatchObject({
    failed: true,
    code: "file_exists",
  });
  expect(await readFile(collision.u.target, "utf8")).toBe("keep this");
});
it("recovers atomic publication before a receipt, then cleans staging without deleting the saved file", async () => {
  const { u, bytes } = await fixture();
  const partial = u.directory + `/.boundless-upload-${u.id}.partial`;
  await writeFile(partial, bytes);
  await link(partial, u.target);
  expect((await run("complete", u)).file.path).toBe(u.target);
  await expect(lstat(partial)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await run("cleanup", u)).toEqual({ ok: true });
  expect(await readFile(u.target)).toEqual(bytes);
});
it("rejects escaping destinations, folder symlinks and staged symlinks", async () => {
  const { u } = await fixture();
  expect(
    await run("prepare", { ...u, directory: node + "/../outside" }),
  ).toMatchObject({ failed: true, code: "invalid_directory" });
  const outside = join(physical, "outside");
  await mkdir(outside);
  const alias = node + "/alias";
  await symlink(
    outside,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  expect(await run("prepare", { ...u, directory: alias })).toMatchObject({
    failed: true,
    code: "invalid_directory",
  });
  const staged = node + `/.boundless/file-uploads/${u.id}/0.part`;
  await rm(staged);
  await symlink(
    u.directory,
    staged,
    process.platform === "win32" ? "junction" : "dir",
  );
  expect(await run("complete", u)).toMatchObject({ failed: true });
});
it("checks real destination directories and rejects symlink ancestors before browsing", async () => {
  const script = directoryStatScript
    .replaceAll("/home/node", node)
    .replaceAll("/home/linuxbrew", brew);
  const folder = node + "/browse/客户";
  await mkdir(folder, { recursive: true });
  const alias = node + "/browse-link";
  await symlink(
    node + "/browse",
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  await writeFile(node + "/ordinary-file", "file");
  async function check(path: string) {
    try {
      const result = await exec(process.execPath, [
        "-e",
        script,
        Buffer.from(path).toString("base64url"),
      ]);
      return JSON.parse(result.stdout);
    } catch (error: any) {
      return { failed: true, ...JSON.parse(error.stdout) };
    }
  }
  expect(await check(folder)).toEqual({ path: folder });
  expect(await check(brew)).toEqual({ path: brew });
  for (const path of [
    alias,
    alias + "/客户",
    node + "/../outside",
    root,
    node + "/ordinary-file",
  ])
    expect(await check(path)).toMatchObject({
      failed: true,
      code: "invalid_directory",
    });
  expect(await check(node + "/missing")).toMatchObject({
    failed: true,
    code: "directory_not_found",
  });
});
