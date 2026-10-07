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
import { loadConfig } from "../services/control-plane/src/config";
import { createApp } from "../services/control-plane/src/app";
import { hash } from "../services/control-plane/src/security";
import { ProviderError } from "../services/control-plane/src/providers";
let server: Server,
  base: string,
  repo: MemoryRepository,
  a37: DemoAgent37,
  inkbox: DemoInkbox;
beforeEach(async () => {
  repo = new MemoryRepository();
  a37 = new DemoAgent37();
  inkbox = new DemoInkbox();
  await seedDemo(repo, a37, inkbox);
  const original = (await repo.profile(DEMO_USER))!;
  await repo.saveProfile({
    ...original,
    id: DEMO_NEW_USER,
    email: "new@example.com",
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
async function call(
  path: string,
  method = "GET",
  body?: unknown,
  key = "demo",
) {
  return fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
it("rejects unauthenticated and nonoperator requests", async () => {
  expect((await call("/me", "GET", undefined, "wrong")).status).toBe(401);
  expect((await call("/operator", "GET", undefined, "demo-new")).status).toBe(
    403,
  );
});
it("validates catalog search before provider calls and allows an unfiltered first page", async () => {
  const toolkits = vi.spyOn(a37, "toolkits");
  expect((await call("/apps?search=gm")).status).toBe(400);
  expect(toolkits).not.toHaveBeenCalled();
  const first = await (await call("/apps")).json();
  expect(first.toolkits.length).toBeGreaterThan(0);
  expect(first.nextCursor).toBeTruthy();
  expect(toolkits).toHaveBeenLastCalledWith(
    (await repo.agent(DEMO_USER))!.instanceId,
    "",
    undefined,
  );
  const page = await (await call(`/apps?cursor=${first.nextCursor}`)).json();
  expect(page.toolkits.length).toBeGreaterThan(0);
  expect(
    (await (await call("/apps?search=gmail")).json()).toolkits[0].slug,
  ).toBe("gmail");
});
it("requires a ready owned computer for maintenance and rejects caller-supplied targets", async () => {
  expect(
    (await call("/computer/maintenance", "GET", undefined, "demo-new")).status,
  ).toBe(409);
  expect(
    (
      await call(
        "/computer/maintenance",
        "POST",
        { action: "restart" },
        "demo-new",
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await call("/computer/maintenance", "POST", {
        action: "update",
        template: "other@1",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await call("/computer/maintenance", "POST", {
        action: "restart",
        ownerId: DEMO_NEW_USER,
      })
    ).status,
  ).toBe(400);
  expect(
    (await call("/computer/maintenance", "POST", { action: "restart" })).status,
  ).toBe(202);
  const agent = (await repo.agent(DEMO_USER))!;
  expect(agent.computerOperation).toMatchObject({
    action: "restart",
    targetTemplate: "boundless-hermes-desktop@2",
    phase: "queued",
  });
  expect(
    (await call("/responses", "POST", { input: "Start new work" })).status,
  ).toBe(409);
  expect(
    (await call("/computer/maintenance", "POST", { action: "update" })).status,
  ).toBe(409);
});
it("scopes records, memory, desktop, sessions and connectors to the caller", async () => {
  const own = await repo.items(DEMO_USER);
  expect(
    (await (await call("/items", "GET", undefined, "demo-new")).json()).items,
  ).toEqual([]);
  expect(
    (await call("/items", "POST", { ...own[0], title: "Stolen" }, "demo-new"))
      .status,
  ).toBe(404);
  for (const path of [
    "/computer",
    "/memory/memory",
    "/sessions/" + "f".repeat(32),
    "/apps",
  ])
    expect(
      (
        await call(
          path,
          path === "/computer" ? "POST" : "GET",
          undefined,
          "demo-new",
        )
      ).status,
    ).toBe(409);
  const agent = (await (await call("/me")).json()).agent;
  expect(agent.callbackHash).toBeUndefined();
});
it("resolves authenticated callbacks from the instance and deduplicates notifications", async () => {
  const agent = (await repo.agent(DEMO_USER))!;
  agent.callbackHash = hash("callback");
  await repo.saveAgent(agent);
  const body = {
    instance_id: agent.instanceId,
    event_id: randomUUID(),
    command: "notify",
    text: "Check-in",
    owner_id: DEMO_NEW_USER,
  };
  expect((await call("/agent/workspace", "POST", body, "wrong")).status).toBe(
    403,
  );
  expect(
    (await call("/agent/workspace", "POST", body, "callback")).status,
  ).toBe(200);
  await call("/agent/workspace", "POST", body, "callback");
  expect(
    (await repo.notifications(DEMO_USER)).filter(
      (note) => note.text === "Check-in",
    ),
  ).toHaveLength(1);
  expect(await repo.notifications(DEMO_NEW_USER)).toHaveLength(0);
});
it("refuses a cross-identity transcript before touching its admin endpoint", async () => {
  const request = vi.spyOn(inkbox, "request");
  expect((await call("/calls/another-call/transcript")).status).toBe(404);
  expect(
    request.mock.calls.every(([path]) => !path.endsWith("/transcripts")),
  ).toBe(true);
});
it("guards stale native memory edits and returns chat SSE suitable for replay", async () => {
  const first = await (await call("/memory/memory")).json();
  await call("/memory/memory", "PUT", {
    content: "Changed",
    modified: first.modified,
  });
  expect(
    (
      await call("/memory/memory", "PUT", {
        content: "Stale",
        modified: first.modified,
      })
    ).status,
  ).toBe(412);
  const response = await call("/responses", "POST", {
    input: "Help with tomorrow",
  });
  const text = await response.text();
  expect(text).toContain("response.created");
  expect(text).toContain("response.completed");
  const id = JSON.parse(text.split("data: ")[1].split("\n")[0]).id;
  expect(await (await call(`/responses/${id}/stream`)).text()).toContain(
    "response.completed",
  );
});
it.each([
  {
    season: "summer",
    now: "2026-07-10T12:00:00Z",
    when: "2026-07-12T13:30:00Z",
    schedule: "30 9 12 7 *",
  },
  {
    season: "winter",
    now: "2026-12-13T12:00:00Z",
    when: "2026-12-15T13:30:00Z",
    schedule: "30 8 15 12 *",
  },
])(
  "converts a $season reminder to the customer's local date and time",
  async ({ now, when, schedule }) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(now));
    try {
      const response = await call("/routines", "POST", {
        name: "Once",
        prompt: "Check in",
        when,
      });
      expect(response.status).toBe(201);
      const result = await response.json();
      expect(result.routine.timezone).toBe("America/Toronto");
      expect(result.routine.schedule).toBe(schedule);
      expect(result.routine.agent).toBe("hermes");
    } finally {
      vi.useRealTimers();
    }
  },
);
it("does not claim suspension when the provider could not stop the computer", async () => {
  vi.spyOn(a37, "stop").mockRejectedValueOnce(
    new ProviderError(503, "unavailable", "Try again."),
  );
  expect(
    (
      await call(`/operator/${DEMO_USER}/suspension`, "PUT", {
        suspended: true,
      })
    ).status,
  ).toBe(502);
  expect((await repo.agent(DEMO_USER))!.suspended).not.toBe(true);
  expect(
    (
      await call(`/operator/${DEMO_USER}/suspension`, "PUT", {
        suspended: true,
      })
    ).status,
  ).toBe(200);
  expect((await call("/responses", "POST", { input: "hello" })).status).toBe(
    403,
  );
});
it("surfaces provider budget exhaustion without starting a replacement turn", async () => {
  const responses = vi
    .spyOn(a37, "responses")
    .mockRejectedValue(
      new ProviderError(
        402,
        "budget_exceeded",
        "Managed-service budget exhausted.",
      ),
    );
  const response = await call("/responses", "POST", { input: "hello" });
  expect(response.status).toBe(402);
  expect((await response.json()).error.code).toBe("budget_exceeded");
  expect(responses).toHaveBeenCalledTimes(1);
});
