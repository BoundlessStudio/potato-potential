import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import {
  createApp,
  reconcile,
  type Dependencies,
} from "../services/control-plane/src/app";
import { loadConfig } from "../services/control-plane/src/config";
import {
  DemoAgent37,
  DemoInkbox,
  DEMO_USER,
  DEMO_NEW_USER,
  seedDemo,
} from "../services/control-plane/src/demo";
import { Lifecycle } from "../services/control-plane/src/lifecycle";
import { MemoryRepository } from "../services/control-plane/src/repository";
import { maintainComputer } from "../services/control-plane/src/computer-maintenance";
import { HttpError } from "../services/control-plane/src/security";

let server: Server,
  base: string,
  repo: MemoryRepository,
  a37: DemoAgent37,
  dep: Dependencies,
  instance: string;
const original = { model: "default", provider: "custom:agent37" };
const selected = { model: "openai/gpt-5.2", provider: "custom:agent37" };
const another = {
  model: "anthropic/claude-sonnet-4-5",
  provider: "custom:agent37",
};

beforeEach(async () => {
  repo = new MemoryRepository();
  a37 = new DemoAgent37();
  const inkbox = new DemoInkbox();
  await seedDemo(repo, a37, inkbox);
  instance = (await repo.agent(DEMO_USER))!.instanceId!;
  const config = loadConfig({ DEMO_MODE: "true" });
  dep = {
    config,
    repo,
    a37,
    inkbox,
    lifecycle: new Lifecycle(config, repo, a37, inkbox),
    queue: { send: vi.fn(async () => {}) },
  };
  server = createApp(dep).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const call = (
  path = "/assistant-model",
  method = "GET",
  body?: unknown,
  key = "demo",
) =>
  fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const save = (
  model: typeof selected | null,
  expectedModel: typeof selected | null = null,
) => call("/assistant-model", "PUT", { model, expectedModel });

it("leaves new and legacy accounts unset without writing to the computer", async () => {
  const write = vi.spyOn(a37, "setModel");
  const response = await call();
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({
    model: null,
    defaultModel: original,
    applied: true,
  });
  const legacy = (await repo.agent(DEMO_USER))!;
  delete legacy.assistantModel;
  await repo.saveAgent(legacy);
  expect(await (await call()).json()).toMatchObject({
    model: null,
    applied: true,
  });
  await reconcile(dep, DEMO_USER);
  expect(write).not.toHaveBeenCalled();
  expect((await call(undefined, "GET", undefined, "invalid")).status).toBe(401);
});

it("applies the choice to Hermes and persists it separately from profile edits", async () => {
  const profile = await repo.profile(DEMO_USER);
  const response = await save(selected);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    model: selected,
    defaultModel: selected,
    applied: true,
  });
  expect((await repo.agent(DEMO_USER))!).toMatchObject({
    assistantModel: selected,
    assistantModelOriginal: original,
    assistantModelPending: false,
  });
  expect(await repo.profile(DEMO_USER)).toEqual(profile);
  const sessionId = (await repo.agent(DEMO_USER))!.mainSessionId;
  await (
    await call("/responses", "POST", {
      input: "Continue this conversation",
      sessionId,
    })
  ).text();
  expect(a37.responseRequests[0].body).not.toHaveProperty("model");
  expect((await a37.models(instance)).defaultModel).toEqual(selected);
});

it("clears to null, restores the prior native default and removes boot enforcement", async () => {
  await save(selected);
  expect((await save(null, selected)).status).toBe(200);
  expect(await (await call()).json()).toMatchObject({
    model: null,
    defaultModel: original,
    applied: true,
  });
  expect(a37.files.has(`${instance}:~/.boundless/assistant-model.json`)).toBe(
    false,
  );
  const write = vi.spyOn(a37, "setModel");
  await reconcile(dep, DEMO_USER);
  expect(write).not.toHaveBeenCalled();
});

it("rejects unavailable models, extra arguments and stale tabs while allowing a lost-reply retry", async () => {
  expect((await save({ ...selected, model: "not-listed" })).status).toBe(400);
  expect(
    (
      await call("/assistant-model", "PUT", {
        model: selected,
        expectedModel: null,
        instanceId: "foreign",
      })
    ).status,
  ).toBe(400);
  expect((await save(selected)).status).toBe(200);
  expect((await save(selected)).status).toBe(200);
  expect((await save(another)).status).toBe(409);
  expect((await repo.agent(DEMO_USER))!.assistantModel).toEqual(selected);
});

it("isolates models by account and blocks changes during maintenance or suspension", async () => {
  const foreign = await a37.createInstance({});
  const agent = (await repo.agent(DEMO_USER))!;
  await repo.saveProfile({
    ...(await repo.profile(DEMO_USER))!,
    id: DEMO_NEW_USER,
    email: "other@example.com",
  });
  await repo.saveAgent({
    ...agent,
    ownerId: DEMO_NEW_USER,
    instanceId: foreign.id,
  });
  const response = await call(
    `/assistant-model?instanceId=${instance}`,
    "PUT",
    { model: selected, expectedModel: null },
    "demo-new",
  );
  expect(response.status).toBe(200);
  expect((await a37.models(foreign.id)).defaultModel).toEqual(selected);
  expect((await a37.models(instance)).defaultModel).toEqual(original);
  agent.suspended = true;
  await repo.saveAgent(agent);
  expect((await save(selected)).status).toBe(403);
  agent.suspended = false;
  agent.computerOperation = {
    id: randomUUID(),
    action: "restart",
    phase: "queued",
    targetTemplate: "test",
    requestedAt: new Date().toISOString(),
  };
  await repo.saveAgent(agent);
  expect((await save(selected)).status).toBe(409);
});

it("recovers a failed remote save from durable intent without a browser retry", async () => {
  const write = vi
    .spyOn(a37, "setModel")
    .mockRejectedValueOnce(
      new HttpError(502, "model_save_failed", "Disconnected"),
    );
  expect((await save(selected)).status).toBe(502);
  expect((await repo.agent(DEMO_USER))!).toMatchObject({
    assistantModel: selected,
    assistantModelPending: true,
  });
  expect(dep.queue.send).toHaveBeenCalledWith("reconcile", DEMO_USER);
  await reconcile(dep, DEMO_USER);
  expect(write).toHaveBeenCalledTimes(2);
  expect(await (await call()).json()).toMatchObject({
    model: selected,
    applied: true,
  });
});

it("recovers an interrupted clear while keeping null as the saved account choice", async () => {
  await save(selected);
  vi.spyOn(a37, "setModel").mockRejectedValueOnce(
    new HttpError(502, "model_save_failed", "Disconnected"),
  );
  expect((await save(null, selected)).status).toBe(502);
  expect((await repo.agent(DEMO_USER))!).toMatchObject({
    assistantModel: null,
    assistantModelPending: true,
  });
  expect((await a37.models(instance)).defaultModel).toEqual(selected);
  await reconcile(dep, DEMO_USER);
  expect(await (await call()).json()).toMatchObject({
    model: null,
    defaultModel: original,
    applied: true,
  });
  expect(a37.files.has(`${instance}:~/.boundless/assistant-model.json`)).toBe(false);
});

it.each(["restart", "update"] as const)(
  "reapplies the account choice before completing a %s",
  async (action) => {
    await save(selected);
    const agent = (await repo.agent(DEMO_USER))!;
    agent.computerOperation = {
      id: randomUUID(),
      action,
      phase: "queued",
      targetTemplate: dep.config.desktopTemplate,
      requestedAt: new Date().toISOString(),
    };
    await repo.saveAgent(agent);
    expect(await maintainComputer(dep, DEMO_USER)).toBe(true);
    // Simulate startup config injection replacing the default.
    await a37.setModel(instance, null);
    expect(await maintainComputer(dep, DEMO_USER)).toBe(false);
    expect((await a37.models(instance)).defaultModel).toEqual(selected);
    expect((await repo.agent(DEMO_USER))!.computerOperation!.phase).toBe(
      "completed",
    );
  },
);

it.each([false, true])(
  "restores the account model after a checkpoint rolls back computer settings (cleared: %s)",
  async (clear) => {
    await save(another);
    const backup = await a37.backup(instance);
    await save(selected, another);
    if (clear) await save(null, selected);
    expect(
      (
        await call("/computer/restore", "POST", {
          id: randomUUID(),
          backup: backup.id,
          confirm: true,
        })
      ).status,
    ).toBe(202);
    expect(await maintainComputer(dep, DEMO_USER)).toBe(true);
    expect((await a37.models(instance)).defaultModel).toEqual(another);
    expect(await maintainComputer(dep, DEMO_USER)).toBe(false);
    expect((await a37.models(instance)).defaultModel).toEqual(
      clear ? original : selected,
    );
    expect((await repo.agent(DEMO_USER))!.assistantModel).toEqual(
      clear ? null : selected,
    );
  },
);
