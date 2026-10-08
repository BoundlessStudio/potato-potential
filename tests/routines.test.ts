import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { Cron } from "@boundless/shared";
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
import {
  createApp,
  reconcile,
  type Dependencies,
} from "../services/control-plane/src/app";
import { ProviderError } from "../services/control-plane/src/providers";

let server: Server,
  base: string,
  repo: MemoryRepository,
  a37: DemoAgent37,
  dep: Dependencies,
  instance: string,
  cron: Cron;
beforeEach(async () => {
  repo = new MemoryRepository();
  a37 = new DemoAgent37();
  const inkbox = new DemoInkbox();
  await seedDemo(repo, a37, inkbox);
  const original = (await repo.profile(DEMO_USER))!;
  await repo.saveProfile({
    ...original,
    id: DEMO_NEW_USER,
    email: "other@example.com",
  });
  const agent = (await repo.agent(DEMO_USER))!;
  instance = agent.instanceId!;
  await repo.saveAgent({
    ...agent,
    ownerId: DEMO_NEW_USER,
    instanceId: "other12345",
  });
  const config = loadConfig({ DEMO_MODE: "true" });
  dep = {
    config,
    repo,
    a37,
    inkbox,
    lifecycle: new Lifecycle(config, repo, a37, inkbox),
    queue: { send: vi.fn(async () => {}) },
  };
  cron = await a37.createCron(instance, {
    name: "Morning rhythm",
    prompt: "Check the calendar.",
    schedule: "30 8 * * 1-5",
    timezone: "America/Toronto",
    agent: "hermes",
    profile: null,
  });
  cron.next_run = 2_000_000_000;
  cron.last_run = 100;
  await repo.archive(DEMO_USER, [
    {
      cronId: cron.id,
      name: cron.name,
      ran_at: 100,
      status: "triggered",
      session_id: null,
      outcome: "completed",
    },
  ]);
  await new Promise<void>((resolve) => {
    server = createApp(dep).listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
});
const patch = (body: unknown, key = "demo", id = cron.id) =>
  fetch(`${base}/routines/${id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

it("patches all seven fields in place, retaining routine identity and archived runs", async () => {
  const history = await repo.archived(DEMO_USER);
  const create = vi.spyOn(a37, "createCron"),
    remove = vi.spyOn(a37, "removeCron"),
    update = vi.spyOn(a37, "patchCron");
  const body = {
    name: "Evening rhythm",
    prompt: "Review the week.",
    schedule: "*/15 9-17 * JAN,MAR MON-FRI",
    timezone: "Europe/London",
    enabled: false,
    agent: "hermes",
    profile: "work_notes-2",
  };
  const response = await patch(body);
  expect(response.status).toBe(200);
  expect((await response.json()).routine).toMatchObject({
    ...body,
    id: cron.id,
    last_run: 100,
    next_run: null,
  });
  expect(update).toHaveBeenCalledExactlyOnceWith(instance, cron.id, body);
  expect(create).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(await repo.archived(DEMO_USER)).toEqual(history);
});

it("forwards name and prompt edits without adding schedule fields or notification text", async () => {
  const update = vi.spyOn(a37, "patchCron");
  const body = { name: "A fresh name", prompt: "x".repeat(8000) };
  expect((await patch(body)).status).toBe(200);
  expect(update).toHaveBeenCalledExactlyOnceWith(instance, cron.id, body);
  expect(cron.next_run).toBe(2_000_000_000);
  expect(cron.last_run).toBe(100);
});

it("keeps a rescheduled dated reminder whose last firing belongs to its previous schedule", async () => {
  const remove = vi.spyOn(a37, "removeCron");
  cron.last_run = Date.parse("2026-10-08T13:00:00Z") / 1000;
  vi.spyOn(a37, "cronRuns").mockResolvedValue([
    {
      cronId: cron.id,
      name: cron.name,
      ran_at: cron.last_run,
      status: "triggered",
      session_id: null,
    },
  ]);
  expect((await patch({ schedule: "0 9 9 10 *" })).status).toBe(200);
  await reconcile(dep, DEMO_USER);
  expect(remove).not.toHaveBeenCalled();
  expect((await a37.crons(instance)).some((row) => row.id === cron.id)).toBe(
    true,
  );
});

it("resets agent/profile with explicit nulls and preserves choices through reconciliation", async () => {
  cron.profile = "work";
  const update = vi.spyOn(a37, "patchCron");
  expect((await patch({ agent: null, profile: null })).status).toBe(200);
  await reconcile(dep, DEMO_USER);
  expect(cron.agent).toBeNull();
  expect(cron.profile).toBeNull();
  expect(update).toHaveBeenCalledTimes(1);
  expect(cron.next_run).toBe(2_000_000_000);
  expect((await patch({ agent: "codex" })).status).toBe(200);
  await reconcile(dep, DEMO_USER);
  expect(cron.agent).toBe("codex");
  expect(update).toHaveBeenCalledTimes(2);
});

it("checks profile compatibility against the merged routine and allows clearing it when switching", async () => {
  cron.profile = "work";
  expect((await patch({ agent: "codex" })).status).toBe(400);
  expect((await patch({ agent: "codex", profile: null })).status).toBe(200);
  expect((await patch({ profile: "work" })).status).toBe(400);
  expect((await patch({ agent: "hermes", profile: "work" })).status).toBe(200);
  expect((await patch({ agent: null, profile: "work" })).status).toBe(200);
});

it("recomputes next_run when schedule, timezone or enabled is supplied, and supports pause/resume", async () => {
  for (const body of [{ schedule: "*/5 * * * *" }, { timezone: "UTC" }]) {
    cron.next_run = 2_000_000_000;
    expect((await patch(body)).status).toBe(200);
    expect(cron.next_run).not.toBe(2_000_000_000);
  }
  expect((await patch({ enabled: false })).status).toBe(200);
  expect(cron.next_run).toBeNull();
  expect((await patch({ enabled: true })).status).toBe(200);
  expect(cron.next_run).toBeGreaterThan(Date.now() / 1000);
});

it.each([
  {},
  { enabled: "false" },
  { enabled: null },
  { name: "x".repeat(81) },
  { prompt: "" },
  { prompt: "x".repeat(8001) },
  { prompt: null },
  { schedule: "" },
  { schedule: "0 0 9 * * *" },
  { schedule: "@daily" },
  { timezone: "Mars/Olympus" },
  { timezone: null },
  { agent: "unsupported" },
  { profile: "Work Profile" },
  { profile: "" },
  { profile: 12 },
  { enabled: false, instanceId: "other12345" },
  { when: "2026-12-01T09:00:00Z" },
  { once: true },
  { next_run: 123 },
  { id: "123456789abc" },
])(
  "rejects invalid or read-only patch fields before upstream mutation: %j",
  async (body) => {
    const update = vi.spyOn(a37, "patchCron");
    expect((await patch(body)).status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  },
);

it("leaves detailed cron validation and provider failures visible to the caller", async () => {
  vi.spyOn(a37, "patchCron").mockRejectedValueOnce(
    new ProviderError(400, "invalid_request", "Invalid minute field."),
  );
  const response = await patch({ schedule: "99 8 * * *" });
  expect(response.status).toBe(400);
  expect((await response.json()).error.message).toBe("Invalid minute field.");
});

it("scopes updates to the authenticated owner's ready, unpaused computer", async () => {
  const update = vi.spyOn(a37, "patchCron");
  expect((await patch({ name: "Other" }, "wrong")).status).toBe(401);
  expect((await patch({ name: "Other" }, "demo-new")).status).toBe(404);
  expect((await patch({ name: "Other" }, "demo", "not-an-id")).status).toBe(
    400,
  );
  const agent = (await repo.agent(DEMO_USER))!;
  agent.suspended = true;
  await repo.saveAgent(agent);
  expect((await patch({ name: "Paused" })).status).toBe(403);
  agent.suspended = false;
  agent.computerOperation = {
    id: randomUUID(),
    action: "restore",
    phase: "applying",
    requestedAt: new Date().toISOString(),
  };
  await repo.saveAgent(agent);
  expect((await patch({ name: "Restoring" })).status).toBe(409);
  expect(update).not.toHaveBeenCalled();
});

it("rechecks readiness under the owner lease before changing a routine", async () => {
  const locked = repo.locked.bind(repo),
    update = vi.spyOn(a37, "patchCron");
  vi.spyOn(repo, "locked").mockImplementation(async (owner, work) => {
    const agent = (await repo.agent(owner))!;
    await repo.saveAgent({ ...agent, suspended: true });
    return locked(owner, work);
  });
  expect((await patch({ enabled: false })).status).toBe(403);
  expect(update).not.toHaveBeenCalled();
});
