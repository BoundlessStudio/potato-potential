import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import {
  DemoAgent37,
  DemoInkbox,
  DEMO_USER,
  DEMO_NEW_USER,
  seedDemo,
} from "../services/control-plane/src/demo";
import { MemoryRepository } from "../services/control-plane/src/repository";
import { Lifecycle } from "../services/control-plane/src/lifecycle";
import {
  createApp,
  type Dependencies,
} from "../services/control-plane/src/app";
import { loadConfig } from "../services/control-plane/src/config";
import {
  computerBusy,
  maintainComputer,
  failComputerOperation,
} from "../services/control-plane/src/computer-maintenance";
import {
  executeJobSlice,
  type SupabaseJobs,
} from "../services/control-plane/src/jobs";
import { ProviderError } from "../services/control-plane/src/providers";

let repo: MemoryRepository,
  a37: DemoAgent37,
  dep: Dependencies,
  server: Server,
  base: string,
  instance: string;
beforeEach(async () => {
  repo = new MemoryRepository();
  a37 = new DemoAgent37();
  const inkbox = new DemoInkbox();
  await seedDemo(repo, a37, inkbox);
  instance = (await repo.agent(DEMO_USER))!.instanceId!;
  const config = loadConfig({ DEMO_MODE: "true" });
  dep = {
    repo,
    a37,
    inkbox,
    config,
    lifecycle: new Lifecycle(config, repo, a37, inkbox),
    queue: { send: vi.fn().mockResolvedValue(undefined) },
  };
  server = createApp(dep).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
});
afterEach(async () => {
  vi.useRealTimers();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const call = (path: string, method = "GET", body?: unknown, key = "demo") =>
  fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const tick = () => maintainComputer(dep, DEMO_USER);
const restoreInput = (backup: string) => ({
  id: randomUUID(),
  backup,
  confirm: true,
});

it("requires authentication, owns the instance, and rejects extra arguments or unconfirmed restores", async () => {
  expect(
    (await call("/computer/backups", "GET", undefined, "invalid")).status,
  ).toBe(401);
  expect(
    (
      await call("/computer/backups", "POST", {
        id: randomUUID(),
        instanceId: "other",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await call("/computer/restore", "POST", {
        ...restoreInput("abc"),
        confirm: false,
      })
    ).status,
  ).toBe(400);
  expect(
    (await call("/computer/restore", "POST", restoreInput("../escape"))).status,
  ).toBe(400);
  expect(
    (await call("/computer/restore", "POST", restoreInput("missing"))).status,
  ).toBe(404);
  const backup = await a37.backup(instance);
  const profile = (await repo.profile(DEMO_USER))!;
  await repo.saveProfile({
    ...profile,
    id: DEMO_NEW_USER,
    email: "new@example.com",
  });
  const other = await a37.createInstance({
    user: DEMO_NEW_USER,
    template: dep.config.desktopTemplate,
  });
  await repo.saveAgent({
    ...(await repo.agent(DEMO_USER))!,
    ownerId: DEMO_NEW_USER,
    instanceId: other.id,
  });
  expect(
    (
      await call(
        "/computer/restore",
        "POST",
        restoreInput(backup.id),
        "demo-new",
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await (
        await call("/computer/backups", "GET", undefined, "demo-new")
      ).json()
    ).backups,
  ).toEqual([]);
});

it("queues one manual backup, keeps chat available, and blocks overlapping maintenance", async () => {
  const backup = vi.spyOn(a37, "backup");
  const body = { id: randomUUID() };
  const replies = await Promise.all([
    call("/computer/backups", "POST", body),
    call("/computer/backups", "POST", body),
  ]);
  expect(replies.map((row) => row.status)).toEqual([202, 202]);
  expect(backup).not.toHaveBeenCalled();
  expect(computerBusy((await repo.agent(DEMO_USER))!)).toBe(false);
  expect((await call("/sessions")).status).toBe(200);
  expect(
    (await call("/computer/maintenance", "POST", { action: "restart" })).status,
  ).toBe(409);
  expect(await tick()).toBe(true);
  expect(await tick()).toBe(false);
  expect(backup).toHaveBeenCalledTimes(1);
  expect((await repo.agent(DEMO_USER))!.computerOperation?.phase).toBe(
    "completed",
  );
  expect((await call("/computer/backups", "POST", body)).status).toBe(202);
  expect(
    (await call("/computer/backups", "POST", { id: randomUUID() })).status,
  ).toBe(429);
  expect(backup).toHaveBeenCalledTimes(1);
  const snapshot = await (await call("/computer/backups")).json();
  expect(snapshot.backups).toHaveLength(1);
  expect(Date.parse(snapshot.cooldownUntil)).toBeGreaterThan(Date.now());
  expect(snapshot.operation.backupsBefore).toBeUndefined();
});

it("recovers a lost backup reply without creating another checkpoint", async () => {
  const original = a37.backup.bind(a37);
  const backup = vi.spyOn(a37, "backup").mockImplementation(async (id) => {
    await original(id);
    throw new Error("Lost reply");
  });
  await call("/computer/backups", "POST", { id: randomUUID() });
  expect(await tick()).toBe(true);
  expect(await tick()).toBe(false);
  expect(backup).toHaveBeenCalledTimes(1);
  expect((await repo.agent(DEMO_USER))!.computerOperation?.phase).toBe(
    "completed",
  );
});

it("accepts the acknowledged backup even when Agent37 deduplicates unchanged files", async () => {
  const existing = await a37.backup(instance);
  const backup = vi.spyOn(a37, "backup").mockResolvedValue(existing);
  await call("/computer/backups", "POST", { id: randomUUID() });
  await tick();
  expect(await tick()).toBe(false);
  expect((await repo.agent(DEMO_USER))!.computerOperation?.backupId).toBe(
    existing.id,
  );
  expect(backup).toHaveBeenCalledTimes(1);
});

it("never repeats an uncertain backup after worker termination and eventually reports uncertainty", async () => {
  const backup = vi
    .spyOn(a37, "backup")
    .mockRejectedValue(new Error("Timeout"));
  await call("/computer/backups", "POST", { id: randomUUID() });
  await tick();
  const agent = (await repo.agent(DEMO_USER))!;
  agent.computerOperation!.phase = "applying";
  await repo.saveAgent(agent);
  expect(await tick()).toBe(true);
  agent.computerOperation!.startedAt = new Date(
    Date.now() - 21 * 60_000,
  ).toISOString();
  await repo.saveAgent(agent);
  expect(await tick()).toBe(false);
  expect((await repo.agent(DEMO_USER))!.computerOperation?.error).toMatch(
    /may still appear/,
  );
  expect(backup).toHaveBeenCalledTimes(1);
});

it("retains the previous checkpoint and cooldown after a rejected backup attempt", async () => {
  const previous = await a37.backup(instance);
  vi.spyOn(a37, "backup").mockRejectedValue(
    new ProviderError(429, "rate_limited", "Slow down"),
  );
  await call("/computer/backups", "POST", { id: randomUUID() });
  expect(await tick()).toBe(false);
  expect((await repo.agent(DEMO_USER))!.computerOperation?.phase).toBe(
    "failed",
  );
  expect((await a37.backups(instance))[0].id).toBe(previous.id);
  expect(
    (await call("/computer/backups", "POST", { id: randomUUID() })).status,
  ).toBe(429);
});

it("does not allow an idempotency key to change its action or checkpoint", async () => {
  const body = { id: randomUUID() };
  await call("/computer/backups", "POST", body);
  expect(
    (
      await call("/computer/restore", "POST", {
        ...restoreInput("abc"),
        id: body.id,
      })
    ).status,
  ).toBe(409);
});
it("recognizes a delayed restore retry after a subsequent operation has completed", async () => {
  const checkpoint = await a37.backup(instance),
    body = restoreInput(checkpoint.id);
  const restore = vi.spyOn(a37, "restore");
  await call("/computer/restore", "POST", body);
  await tick();
  await tick();
  const agent = (await repo.agent(DEMO_USER))!;
  agent.computerOperation = {
    id: randomUUID(),
    action: "restart",
    phase: "completed",
    requestedAt: new Date().toISOString(),
    targetTemplate: dep.config.desktopTemplate,
  };
  await repo.saveAgent(agent);
  expect((await call("/computer/restore", "POST", body)).status).toBe(202);
  expect((await repo.agent(DEMO_USER))!.computerOperation?.action).toBe(
    "restart",
  );
  expect(restore).toHaveBeenCalledTimes(1);
});

it("repairs an interrupted queue dispatch on the next checkpoint read", async () => {
  const send = vi
    .mocked(dep.queue.send)
    .mockRejectedValueOnce(new Error("Outbox unavailable"));
  expect(
    (await call("/computer/backups", "POST", { id: randomUUID() })).status,
  ).toBe(500);
  expect((await repo.agent(DEMO_USER))!.computerOperation?.phase).toBe(
    "queued",
  );
  expect((await call("/computer/backups")).status).toBe(200);
  expect(send).toHaveBeenCalledTimes(2);
});

it("refuses to restore while any independent conversation is working", async () => {
  const checkpoint = await a37.backup(instance);
  a37.histories.set("independent", {
    id: "independent",
    active_response_id: "busy-response",
    history: [],
  });
  const restore = vi.spyOn(a37, "restore");
  expect(
    (await call("/computer/restore", "POST", restoreInput(checkpoint.id)))
      .status,
  ).toBe(409);
  expect(restore).not.toHaveBeenCalled();
  a37.histories.get("independent")!.active_response_id = null;
  expect(
    (await call("/computer/restore", "POST", restoreInput(checkpoint.id)))
      .status,
  ).toBe(202);
  a37.histories.get("independent")!.active_response_id = "new-work";
  await expect(tick()).rejects.toMatchObject({ code: "agent_busy" });
  expect(restore).not.toHaveBeenCalled();
});

it("rechecks that the chosen checkpoint still exists before issuing a restore", async () => {
  const checkpoint = await a37.backup(instance);
  await call("/computer/restore", "POST", restoreInput(checkpoint.id));
  await a37.backup(instance); // Replaces the only manual slot.
  const restore = vi.spyOn(a37, "restore");
  expect(await tick()).toBe(false);
  expect(restore).not.toHaveBeenCalled();
  expect((await repo.agent(DEMO_USER))!.computerOperation?.phase).toBe(
    "failed",
  );
  expect(computerBusy((await repo.agent(DEMO_USER))!)).toBe(false);
});

it("restores files once, reconnects the current workspace, and keeps Supabase records current", async () => {
  const path = "/home/node/outputs/plan.txt";
  await a37.writeBinary(instance, path, Buffer.from("saved plan"));
  const checkpoint = await a37.backup(instance);
  await a37.writeBinary(instance, path, Buffer.from("later plan"));
  const items = await repo.items(DEMO_USER),
    conversations = await repo.conversations(DEMO_USER);
  const profile = { ...(await repo.profile(DEMO_USER))!, agentName: "Sprout" };
  await repo.saveProfile(profile);
  await repo.saveComputerService({
    ownerId: DEMO_USER,
    instanceId: instance,
    port: 8788,
    label: "My doorway",
    state: "healthy",
    createdAt: new Date().toISOString(),
  });
  const restore = vi.spyOn(a37, "restore"),
    reconnect = vi.spyOn(dep.lifecycle, "restoreConfiguration");
  vi.spyOn(a37, "sessions").mockResolvedValue([]);
  const oldSession = (await repo.agent(DEMO_USER))!.mainSessionId;
  const body = restoreInput(checkpoint.id);
  expect((await call("/computer/restore", "POST", body)).status).toBe(202);
  expect((await call("/sessions")).status).toBe(409);
  expect(await tick()).toBe(true);
  expect(await tick()).toBe(false);
  const agent = (await repo.agent(DEMO_USER))!;
  expect(restore).toHaveBeenCalledTimes(1);
  expect(agent.computerOperation).toMatchObject({
    phase: "completed",
    restored: true,
    reconciled: true,
  });
  expect(reconnect).toHaveBeenCalledWith(
    profile,
    expect.objectContaining({ instanceId: instance }),
  );
  expect(await (await a37.downloadFile(instance, path)).text()).toBe(
    "saved plan",
  );
  expect(agent.mainSessionId).not.toBe(oldSession);
  expect(await repo.items(DEMO_USER)).toEqual(items);
  expect(await repo.conversations(DEMO_USER)).toEqual(conversations);
  expect(await repo.profile(DEMO_USER)).toEqual(profile);
  expect((await repo.computerServices(DEMO_USER))[0].state).toBe("unknown");
  expect((await call("/computer/restore", "POST", body)).status).toBe(202);
  expect(restore).toHaveBeenCalledTimes(1);
  expect(computerBusy(agent)).toBe(false);
});

it("reconciles a restore after a lost provider reply without restoring twice", async () => {
  const checkpoint = await a37.backup(instance);
  const original = a37.restore.bind(a37);
  const restore = vi
    .spyOn(a37, "restore")
    .mockImplementation(async (id, backup) => {
      await original(id, backup);
      throw new Error("Lost reply");
    });
  await call("/computer/restore", "POST", restoreInput(checkpoint.id));
  await tick();
  expect(await tick()).toBe(false);
  expect(restore).toHaveBeenCalledTimes(1);
  expect(computerBusy((await repo.agent(DEMO_USER))!)).toBe(false);
});

it("blocks unsafe use after uncertain restore and rechecks without reissuing it", async () => {
  const checkpoint = await a37.backup(instance),
    body = restoreInput(checkpoint.id);
  const restore = vi
    .spyOn(a37, "restore")
    .mockRejectedValue(new Error("Lost reply before acknowledgement"));
  await call("/computer/restore", "POST", body);
  await tick();
  expect(await tick()).toBe(true);
  await failComputerOperation(dep, DEMO_USER);
  expect(computerBusy((await repo.agent(DEMO_USER))!)).toBe(true);
  expect(
    (await call("/computer/maintenance", "POST", { action: "restart" })).status,
  ).toBe(409);
  expect(
    (await call("/computer/backups", "POST", { id: randomUUID() })).status,
  ).toBe(409);
  expect(
    (await call("/computer/restore", "POST", restoreInput(checkpoint.id)))
      .status,
  ).toBe(409);
  const snapshot = await (await call("/computer/backups")).json();
  expect(snapshot.operation.needsReconnect).toBe(true);
  expect(
    (await call("/computer/restore/reconnect", "POST", { id: body.id })).status,
  ).toBe(202);
  await a37.restart(instance); // The delayed provider restore eventually boots.
  expect(await tick()).toBe(false);
  expect(restore).toHaveBeenCalledTimes(1);
  expect(computerBusy((await repo.agent(DEMO_USER))!)).toBe(false);
});

it("can retry configuration failure without repeating the destructive restore", async () => {
  const checkpoint = await a37.backup(instance),
    body = restoreInput(checkpoint.id);
  const restore = vi.spyOn(a37, "restore");
  const reconnect = vi
    .spyOn(dep.lifecycle, "restoreConfiguration")
    .mockRejectedValueOnce(new Error("Connection interrupted"));
  await call("/computer/restore", "POST", body);
  await tick();
  await expect(tick()).rejects.toThrow("Connection interrupted");
  await failComputerOperation(dep, DEMO_USER);
  expect((await call("/sessions")).status).toBe(409);
  expect(
    (await call("/computer/restore/reconnect", "POST", { id: randomUUID() }))
      .status,
  ).toBe(409);
  expect(
    (await call("/computer/restore/reconnect", "POST", { id: body.id })).status,
  ).toBe(202);
  expect(await tick()).toBe(false);
  expect(reconnect).toHaveBeenCalledTimes(2);
  expect(restore).toHaveBeenCalledTimes(1);
});

it("does not lock the workspace after a definite restore rejection", async () => {
  const checkpoint = await a37.backup(instance);
  vi.spyOn(a37, "restore").mockRejectedValue(
    new ProviderError(409, "invalid_state", "Updating"),
  );
  await call("/computer/restore", "POST", restoreInput(checkpoint.id));
  expect(await tick()).toBe(false);
  expect(computerBusy((await repo.agent(DEMO_USER))!)).toBe(false);
});

it("allows checkpoint listing but no changes while suspended", async () => {
  const agent = (await repo.agent(DEMO_USER))!;
  agent.suspended = true;
  await repo.saveAgent(agent);
  expect((await call("/computer/backups")).status).toBe(200);
  expect((await (await call("/computer/backups")).json()).canManage).toBe(
    false,
  );
  expect(
    (await call("/computer/backups", "POST", { id: randomUUID() })).status,
  ).toBe(403);
});

it("executes a queued live backup through the normal reconciliation worker", async () => {
  await call("/computer/backups", "POST", { id: randomUUID() });
  const backup = vi.spyOn(a37, "backup");
  const jobs = {
    claim: vi.fn().mockResolvedValue({
      id: randomUUID(),
      owner_id: DEMO_USER,
      kind: "reconcile",
      status: "running",
      failures: 0,
    }),
    finish: vi.fn(),
  } as unknown as SupabaseJobs;
  expect(await executeJobSlice(dep, jobs, randomUUID(), randomUUID())).toBe(
    "continue",
  );
  expect(await executeJobSlice(dep, jobs, randomUUID(), randomUUID())).toBe(
    "complete",
  );
  expect(backup).toHaveBeenCalledTimes(1);
});
