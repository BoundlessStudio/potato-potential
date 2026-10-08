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
import { HttpError } from "../services/control-plane/src/security";

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
  other = (
    await a37.createInstance({ budget: { monthly_cap_micros: 7_000_000 } })
  ).id;
  await repo.saveAgent({
    ...agent,
    ownerId: DEMO_NEW_USER,
    instanceId: other,
    budgetMicros: 7_000_000,
  });
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
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const call = (method = "GET", body?: unknown, key = "demo", query = "") =>
  fetch(base + "/budget" + query, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

it("lets a regular customer read and change only their own provider budget", async () => {
  const read = vi.spyOn(a37, "getBudget"),
    write = vi.spyOn(a37, "budget");
  const response = await call(
    "GET",
    undefined,
    "demo-new",
    `?instanceId=${instance}&ownerId=${DEMO_USER}`,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect((await response.json()).budget.monthlyCapMicros).toBe(7_000_000);
  expect(read).toHaveBeenCalledWith(other);
  const updated = await call(
    "PUT",
    { micros: 2_250_000, expectedMicros: 7_000_000 },
    "demo-new",
  );
  expect(updated.status).toBe(200);
  expect((await updated.json()).budget.monthlyCapMicros).toBe(2_250_000);
  expect(write).toHaveBeenCalledWith(other, 2_250_000);
  expect((await repo.agent(DEMO_NEW_USER))!.budgetMicros).toBe(2_250_000);
  expect((await repo.agent(DEMO_USER))!.budgetMicros).toBe(5_000_000);
});

it("does not compete for an account lease during an ordinary budget read", async () => {
  vi.spyOn(repo, "locked").mockRejectedValue(
    new HttpError(409, "operation_running", "Another operation is running."),
  );
  expect((await call()).status).toBe(200);
  expect(
    (await call("PUT", { micros: 0, expectedMicros: 5_000_000 })).status,
  ).toBe(409);
});

it("rejects an authenticated account without an enrolled profile", async () => {
  repo.profiles.delete(DEMO_NEW_USER);
  const read = vi.spyOn(a37, "getBudget"),
    write = vi.spyOn(a37, "budget");
  expect((await call("GET", undefined, "demo-new")).status).toBe(403);
  expect(
    (await call("PUT", { micros: 0, expectedMicros: 7_000_000 }, "demo-new"))
      .status,
  ).toBe(403);
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});

it("rejects unsigned requests and attempts to supply a different owner or instance", async () => {
  const write = vi.spyOn(a37, "budget"),
    read = vi.spyOn(a37, "getBudget");
  for (const method of ["GET", "PUT"])
    expect(
      (
        await call(
          method,
          method === "PUT"
            ? { micros: 0, expectedMicros: 5_000_000 }
            : undefined,
          "wrong",
        )
      ).status,
    ).toBe(401);
  for (const field of ["ownerId", "instanceId", "creditMicros"])
    expect(
      (
        await call("PUT", {
          micros: 0,
          expectedMicros: 5_000_000,
          [field]: field === "creditMicros" ? 1e9 : other,
        })
      ).status,
    ).toBe(400);
  expect(write).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});

it.each([-1, 100_000_001, 1.5, 1e20, "5000000", null])(
  "rejects invalid cap %s before contacting the provider",
  async (micros) => {
    const write = vi.spyOn(a37, "budget"),
      read = vi.spyOn(a37, "getBudget");
    expect(
      (await call("PUT", { micros, expectedMicros: 5_000_000 })).status,
    ).toBe(400);
    expect(write).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  },
);

it("accepts both zero and the existing $100 maximum without adding credit", async () => {
  for (const [micros, expectedMicros] of [
    [0, 5_000_000],
    [100_000_000, 0],
  ]) {
    const response = await call("PUT", { micros, expectedMicros });
    expect(response.status).toBe(200);
    const { budget } = await response.json();
    expect(budget.monthlyCapMicros).toBe(micros);
    expect(budget.creditRemainingMicros).toBe(0);
    expect((await repo.agent(DEMO_USER))!.budgetMicros).toBe(micros);
  }
});

it("retains the saved limit after a provider failure", async () => {
  vi.spyOn(a37, "budget").mockRejectedValueOnce(
    new ProviderError(
      503,
      "provider_unavailable",
      "Budget service is unavailable.",
    ),
  );
  expect(
    (await call("PUT", { micros: 2_000_000, expectedMicros: 5_000_000 }))
      .status,
  ).toBe(502);
  expect((await repo.agent(DEMO_USER))!.budgetMicros).toBe(5_000_000);
  expect((await a37.getBudget(instance)).monthlyCapMicros).toBe(5_000_000);
});

it("reloads an applied cap after a lost provider reply and retries without applying it twice", async () => {
  const original = a37.budget.bind(a37);
  const write = vi
    .spyOn(a37, "budget")
    .mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new ProviderError(
        502,
        "reply_lost",
        "The budget reply was interrupted.",
      );
    });
  expect(
    (await call("PUT", { micros: 2_000_000, expectedMicros: 5_000_000 }))
      .status,
  ).toBe(502);
  expect((await repo.agent(DEMO_USER))!.budgetMicros).toBe(5_000_000);
  expect((await (await call()).json()).budget.monthlyCapMicros).toBe(2_000_000);
  expect((await repo.agent(DEMO_USER))!.budgetMicros).toBe(2_000_000);
  expect(
    (await call("PUT", { micros: 2_000_000, expectedMicros: 5_000_000 }))
      .status,
  ).toBe(200);
  expect(write).toHaveBeenCalledTimes(1);
});

it("recovers local persistence failure from the provider’s actual cap", async () => {
  vi.spyOn(repo, "saveAgent").mockRejectedValueOnce(
    new Error("Database unavailable"),
  );
  expect(
    (await call("PUT", { micros: 2_000_000, expectedMicros: 5_000_000 }))
      .status,
  ).toBe(500);
  expect((await repo.agent(DEMO_USER))!.budgetMicros).toBe(5_000_000);
  expect((await (await call()).json()).budget.monthlyCapMicros).toBe(2_000_000);
  expect((await repo.agent(DEMO_USER))!.budgetMicros).toBe(2_000_000);
});

it("refuses a stale cap and serializes simultaneous changes", async () => {
  await a37.budget(instance, 3_000_000);
  const write = vi.spyOn(a37, "budget");
  const stale = await call("PUT", {
    micros: 4_000_000,
    expectedMicros: 5_000_000,
  });
  expect(stale.status).toBe(409);
  expect((await stale.json()).error.code).toBe("budget_changed");
  expect(write).not.toHaveBeenCalled();
  const responses = await Promise.all(
    [1_000_000, 2_000_000].map((micros) =>
      call("PUT", { micros, expectedMicros: 3_000_000 }),
    ),
  );
  expect(responses.map((response) => response.status).sort()).toEqual([
    200, 409,
  ]);
  expect(write).toHaveBeenCalledTimes(1);
  expect((await repo.agent(DEMO_USER))!.budgetMicros).toBe(
    (await a37.getBudget(instance)).monthlyCapMicros,
  );
});

it.each(["new", "provisioning", "failed", "deleting", "deleted"] as const)(
  "blocks budget changes for a %s account",
  async (status) => {
    const agent = (await repo.agent(DEMO_USER))!;
    await repo.saveAgent({ ...agent, status });
    const write = vi.spyOn(a37, "budget"),
      read = vi.spyOn(a37, "getBudget");
    expect((await call()).status).toBe(409);
    expect(
      (await call("PUT", { micros: 0, expectedMicros: 5_000_000 })).status,
    ).toBe(409);
    expect(write).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  },
);

it("allows an owner to lower the cap while suspended or maintaining the computer", async () => {
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
  expect(
    (await call("PUT", { micros: 0, expectedMicros: 5_000_000 })).status,
  ).toBe(200);
  expect((await a37.getBudget(instance)).monthlyCapMicros).toBe(0);
});
