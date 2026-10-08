import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
import { loadConfig } from "../services/control-plane/src/config";
import { createApp } from "../services/control-plane/src/app";
import { ProviderError } from "../services/control-plane/src/providers";

let server: Server,
  base: string,
  repo: MemoryRepository,
  a37: DemoAgent37,
  instance: string,
  other: string;
beforeEach(async () => {
  repo = new MemoryRepository();
  a37 = new DemoAgent37();
  const inkbox = new DemoInkbox();
  await seedDemo(repo, a37, inkbox);
  const agent = (await repo.agent(DEMO_USER))!;
  instance = agent.instanceId!;
  await repo.saveProfile({
    ...(await repo.profile(DEMO_USER))!,
    id: DEMO_NEW_USER,
    email: "new@example.com",
  });
  other = (await a37.createInstance({})).id;
  await repo.saveAgent({ ...agent, ownerId: DEMO_NEW_USER, instanceId: other });
  const config = loadConfig({ DEMO_MODE: "true" });
  const app = createApp({
    config,
    repo,
    a37,
    inkbox,
    lifecycle: new Lifecycle(config, repo, a37, inkbox),
    queue: { send: vi.fn() },
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${(server.address() as any).port}/api/usage`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const call = (key = "demo", query = "") =>
  fetch(base + query, { headers: { Authorization: `Bearer ${key}` } });

it("returns only the signed-in regular owner's usage and never takes an account lease", async () => {
  const read = vi.spyOn(a37, "getUsage");
  const lock = vi.spyOn(repo, "locked"),
    save = vi.spyOn(repo, "saveAgent"),
    budget = vi.spyOn(a37, "budget");
  const response = await call(
    "demo-new",
    `?ownerId=${DEMO_USER}&instanceId=${instance}&month=2020-01`,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect((await response.json()).usage).toEqual(await a37.getUsage(other));
  expect(read).toHaveBeenNthCalledWith(1, other);
  expect(lock).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  expect(budget).not.toHaveBeenCalled();
});

it("rejects anonymous and unenrolled accounts without contacting the provider", async () => {
  const read = vi.spyOn(a37, "getUsage");
  expect((await call("wrong")).status).toBe(401);
  repo.profiles.delete(DEMO_NEW_USER);
  expect((await call("demo-new")).status).toBe(403);
  expect(read).not.toHaveBeenCalled();
});

it.each(["new", "provisioning", "failed", "deleting", "deleted"] as const)(
  "blocks usage for a %s account",
  async (status) => {
    await repo.saveAgent({ ...(await repo.agent(DEMO_USER))!, status });
    const read = vi.spyOn(a37, "getUsage");
    expect((await call()).status).toBe(409);
    expect(read).not.toHaveBeenCalled();
  },
);

it("can read financial usage while the computer is paused or restarting", async () => {
  await repo.saveAgent({
    ...(await repo.agent(DEMO_USER))!,
    suspended: true,
    computerOperation: {
      id: "maintenance",
      action: "restart",
      phase: "queued",
      requestedAt: new Date().toISOString(),
      targetTemplate: "test@1",
    },
  });
  expect((await call()).status).toBe(200);
});

it("returns a retryable provider failure rather than invented zero usage", async () => {
  vi.spyOn(a37, "getUsage").mockRejectedValue(
    new ProviderError(
      502,
      "invalid_usage",
      "Couldn’t verify usage. Try again.",
    ),
  );
  const response = await call();
  expect(response.status).toBe(502);
  const body = await response.json();
  expect(body.error.code).toBe("invalid_usage");
  expect(body.usage).toBeUndefined();
});

it.each(["instance", "account"])(
  "discards usage if the %s changes during a provider read",
  async (change) => {
    const usage = await a37.getUsage(instance);
    vi.spyOn(a37, "getUsage").mockImplementationOnce(async () => {
      await repo.saveAgent({
        ...(await repo.agent(DEMO_USER))!,
        ...(change === "instance"
          ? { instanceId: other }
          : { status: "deleting" as const }),
      });
      return usage;
    });
    const response = await call();
    expect(response.status).toBe(409);
    expect((await response.json()).usage).toBeUndefined();
  },
);
