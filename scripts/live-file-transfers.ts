import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { Agent37 } from "../services/control-plane/src/providers";
import { SupabaseRepository } from "../services/control-plane/src/repository";
import { UPLOAD_CHUNK_BYTES, type FileUpload } from "@boundless/shared";

// Explicit production validation: one disposable verified owner and zero-model-budget computer.
// No model turns, emails, Inkbox resources, or additional exposed ports.
const origin = "https://potato-potential.rgbknights.com";
const url = process.env.SUPABASE_URL!,
  key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY!;
const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const repo = new SupabaseRepository(url, key),
  provider = new Agent37(process.env.AGENT37_API_KEY!);
const user = `file-transfer-validation-${randomUUID()}`,
  email = `${user}@integration.invalid`,
  password = randomBytes(24).toString("base64url");
let ownerId: string | undefined,
  instanceId: string | undefined,
  token = "";
await mkdir(".cache", { recursive: true });
const receipt = (phase: string) =>
  writeFile(
    ".cache/live-file-transfers.json",
    JSON.stringify({ user, ownerId, instanceId, phase }),
  );
const ok = (result: any) => {
  if (result.error)
    throw new Error(
      "Fixture operation failed: " + (result.error.code || result.error.name),
    );
  return result.data;
};
const delay = () => new Promise((resolve) => setTimeout(resolve, 5000));
async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch(origin + "/api" + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
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
    signal: AbortSignal.timeout(240000),
  });
  if (!response.ok) {
    const failure = (await response.json().catch(() => ({}))).error;
    throw new Error(
      `Production ${method} ${path.split("?")[0]} failed: ${response.status} (${failure?.code || "unknown"})${failure?.code === "invalid_request" ? ": " + failure.message : ""}`,
    );
  }
  return response;
}
await receipt("creating");
try {
  ownerId = ok(
    await admin.auth.admin.createUser({ email, password, email_confirm: true }),
  ).user.id;
  await receipt("owner-created");
  await repo.saveProfile({
    id: ownerId!,
    email,
    name: "File validation",
    agentName: "File validation",
    avatar: "sprout",
    color: "#7659e8",
    phone: "",
    timezone: "America/Toronto",
    personality: "",
    preferences: "",
    createdAt: new Date().toISOString(),
  });
  const instance = await provider.createInstance({
    template: "boundless-hermes-desktop@3",
    user,
    name: "Temporary file transfer validation",
    budget: { monthly_cap_micros: 0 },
    auto_sleep: true,
    idle_timeout_seconds: 600,
  });
  instanceId = instance.id;
  await receipt("computer-created");
  await repo.saveAgent({
    ownerId: ownerId!,
    instanceId,
    phase: "ready",
    status: "ready",
    completed: ["ready"],
    budgetMicros: 0,
    updatedAt: new Date().toISOString(),
  });
  for (let i = 0; i < 60; i++) {
    let healthy = false;
    try {
      healthy = await provider.healthy(instanceId!);
    } catch {}
    if (healthy) break;
    if (i === 59) throw new Error("Fixture gateway did not become healthy.");
    await delay();
  }
  const jar = new Map<string, string>();
  const browserSession = createServerClient(
    url,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (values) => {
          for (const value of values) jar.set(value.name, value.value);
        },
      },
    },
  );
  token = ok(await browserSession.auth.signInWithPassword({ email, password }))
    .session.access_token;
  const bytes = Buffer.alloc(6_000_007);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const start = await (
    await api("/files/uploads", "POST", {
      id: randomUUID(),
      name: "résumé-客户.bin",
      directory: "~/uploads/validation",
      size: bytes.length,
      sha256,
    })
  ).json();
  const upload: FileUpload = start.upload;
  assert.equal(start.chunkSize, UPLOAD_CHUNK_BYTES);
  for (let i = 0; i < Math.ceil(bytes.length / UPLOAD_CHUNK_BYTES); i++) {
    await api(
      `/files/uploads/${upload.id}/chunks/${i}`,
      "PUT",
      bytes.subarray(i * UPLOAD_CHUNK_BYTES, (i + 1) * UPLOAD_CHUNK_BYTES),
    );
    console.log("Production piece saved:", i + 1);
  }
  const saved: FileUpload = (
    await (await api(`/files/uploads/${upload.id}/complete`, "POST", {})).json()
  ).upload;
  assert.equal(
    saved.file!.path,
    "/home/node/uploads/validation/résumé-客户.bin",
  );
  assert.equal(
    (
      await (
        await api(`/files/uploads/${upload.id}/complete`, "POST", {})
      ).json()
    ).upload.file.path,
    saved.file!.path,
  );
  const downloadPath = `/files/content?${new URLSearchParams({ instance: instanceId!, path: saved.file!.path })}`;
  async function verifyDownload(cookie = false) {
    const response = cookie
      ? await fetch(origin + "/api" + downloadPath, {
          headers: {
            Cookie: [...jar]
              .map(([name, value]) => `${name}=${value}`)
              .join("; "),
          },
          redirect: "manual",
          signal: AbortSignal.timeout(240000),
        })
      : await api(downloadPath);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-disposition")!, /^attachment;/);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(
      createHash("sha256")
        .update(Buffer.from(await response.arrayBuffer()))
        .digest("hex"),
      sha256,
    );
  }
  await verifyDownload();
  await verifyDownload(true);
  const signedOut = await fetch(origin + "/api" + downloadPath, {
    redirect: "manual",
  });
  assert.equal(signedOut.status, 303);
  assert.equal(
    new URL(signedOut.headers.get("location")!, origin).searchParams.get(
      "next",
    ),
    "/api" + downloadPath,
  );
  await receipt("round-trip-passed");
  console.log(
    "PASS: 6 MB through Vercel, exact Unicode path, idempotent completion, bearer/cookie downloads and signed-out return URL.",
  );
  for (const action of ["restart", "update"] as const) {
    if (action === "restart") await provider.restart(instanceId!);
    else
      await provider.update(
        instanceId!,
        process.env.DESKTOP_TEMPLATE || "boundless-hermes-desktop@4",
      );
    for (let i = 0; i < 60; i++) {
      let healthy = false;
      try {
        healthy = await provider.healthy(instanceId!);
      } catch {}
      if (healthy) break;
      if (i === 59) throw new Error("Computer did not return after " + action);
      await delay();
    }
    await verifyDownload();
    assert.equal(
      (await provider.statFile(instanceId!, saved.file!.path)).size,
      bytes.length,
    );
    const helper = await provider.readFile(
      instanceId!,
      "/home/node/.boundless/file-upload.mjs",
    );
    assert.ok(helper.content.includes("checksum_mismatch"));
    console.log("PASS: saved file and assembly helper retained after", action);
    await receipt(action + "-passed");
  }
  const empty = (
    await (
      await api("/files/uploads", "POST", {
        id: randomUUID(),
        name: "empty.txt",
        size: 0,
        sha256: createHash("sha256").digest("hex"),
        directory: "/home/linuxbrew/transfer-validation",
      })
    ).json()
  ).upload;
  const emptySaved = (
    await (await api(`/files/uploads/${empty.id}/complete`, "POST", {})).json()
  ).upload;
  assert.equal(emptySaved.file.size, 0);
  await receipt("passed");
} finally {
  await receipt("cleaning-up");
  instanceId ||= (await provider.listInstances()).find(
    (row) => row.user === user && row.status !== "deleted",
  )?.id;
  if (instanceId) await provider.removeInstance(instanceId);
  if (ownerId) {
    const agent = await repo.agent(ownerId);
    if (agent)
      await repo.saveAgent({
        ...agent,
        status: "deleting",
        deletion: { instance: true, identity: true },
      });
    ok(await admin.auth.admin.deleteUser(ownerId));
  }
  await receipt("removed");
  console.log(
    "Temporary computer and account removed; upload records cascaded with the account.",
  );
}
