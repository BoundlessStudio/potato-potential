import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  DEFAULT_UPLOAD_DIRECTORY,
  personaStart,
  personaEnd,
} from "@boundless/shared";
import { loadConfig } from "../services/control-plane/src/config";
import { SupabaseRepository } from "../services/control-plane/src/repository";
import { Agent37 } from "../services/control-plane/src/providers";
import {
  FILE_TRANSFER_VERSION,
  FILE_TRANSFER_HELPER,
  fileTransferHelper,
} from "../services/control-plane/src/file-transfer";
import { accessPaused } from "../services/control-plane/src/suspension";
import { computerBusy } from "../services/control-plane/src/computer-maintenance";

const config = loadConfig(),
  repo = new SupabaseRepository(config.supabaseUrl, config.supabaseKey),
  provider = new Agent37(config.agent37Key);
assert.equal(
  new URL(config.supabaseUrl).hostname.split(".")[0],
  "cbipuhnmxyrwfiuwfiou",
);
const digest = (content: string) =>
  createHash("sha256").update(content).digest("hex");
function nativePersona(content: string) {
  const start = content.indexOf(personaStart),
    end = content.indexOf(personaEnd);
  return (
    start < 0
      ? content
      : content.slice(0, start) + content.slice(end + personaEnd.length)
  ).trim();
}
const targets = (await repo.agents()).filter(
  (agent) =>
    agent.status === "ready" &&
    agent.instanceId &&
    !accessPaused(agent) &&
    !computerBusy(agent),
);
const snapshots = [];
for (const agent of targets) {
  const soul = await provider.readFile(agent.instanceId!, "~/.hermes/SOUL.md");
  snapshots.push({
    ownerId: agent.ownerId,
    instanceId: agent.instanceId!,
    callbackHash: agent.callbackHash,
    nativeHash: digest(nativePersona(soul.content)),
  });
  const queued = await repo.client.rpc("enqueue_application_job", {
    p_owner_id: agent.ownerId,
    p_kind: "reconcile",
  });
  if (queued.error) throw new Error("Could not queue helper reconciliation.");
}
if (targets.length) {
  const response = await fetch(
    "https://potato-potential.rgbknights.com/api/internal/maintenance",
    {
      headers: { Authorization: "Bearer " + process.env.CRON_SECRET },
      signal: AbortSignal.timeout(60000),
    },
  );
  assert.ok(response.ok, "Production reconciliation dispatch failed.");
}
for (const before of snapshots) {
  let current = await repo.agent(before.ownerId);
  for (
    let attempt = 0;
    (current?.fileTransferVersion || 0) < FILE_TRANSFER_VERSION;
    attempt++
  ) {
    if (attempt >= 60)
      throw new Error("Helper reconciliation did not complete.");
    await new Promise((resolve) => setTimeout(resolve, 5000));
    current = await repo.agent(before.ownerId);
  }
  assert.equal(current!.instanceId, before.instanceId);
  assert.equal(current!.callbackHash, before.callbackHash);
  assert.equal(
    (await provider.readFile(before.instanceId, FILE_TRANSFER_HELPER)).content,
    fileTransferHelper,
  );
  assert.equal(
    (
      await provider.listDirectories(
        before.instanceId,
        DEFAULT_UPLOAD_DIRECTORY,
      )
    ).path,
    DEFAULT_UPLOAD_DIRECTORY,
  );
  const soul = await provider.readFile(before.instanceId, "~/.hermes/SOUL.md");
  assert.equal(digest(nativePersona(soul.content)), before.nativeHash);
  assert.ok(
    soul.content.includes("/api/files/content?instance=" + before.instanceId),
  );
  assert.ok(
    soul.content.includes(
      `Uploads are saved to ${DEFAULT_UPLOAD_DIRECTORY}/ by default`,
    ),
  );
}
await writeFile(
  ".cache/file-transfer-rollout.json",
  JSON.stringify({
    verified: true,
    computers: snapshots.length,
    helperVersion: FILE_TRANSFER_VERSION,
    nativePersonaPreserved: true,
    callbackPreserved: true,
  }),
);
console.log(
  "PASS: versioned file helper and instructions reconciled on",
  snapshots.length,
  "ready computer(s); native persona, callback and instance preserved.",
);
