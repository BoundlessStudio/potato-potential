import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import { createApp } from "../services/control-plane/src/app";
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

let server: Server, base: string, repo: MemoryRepository, a37: DemoAgent37;
let originalId: string;
const sessionId = () => randomBytes(16).toString("hex");

beforeEach(async () => {
  repo = new MemoryRepository();
  a37 = new DemoAgent37();
  const inkbox = new DemoInkbox();
  await seedDemo(repo, a37, inkbox);
  originalId = (await repo.agent(DEMO_USER))!.mainSessionId!;
  const config = loadConfig({ DEMO_MODE: "true" });
  server = createApp({
    config,
    repo,
    a37,
    inkbox,
    lifecycle: new Lifecycle(config, repo, a37, inkbox),
    queue: { send: vi.fn(async () => {}) },
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function call(path: string, method = "GET", body?: unknown, key = "demo") {
  return fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

it("reserves a blank conversation without a model call and retries a lost create reply safely", async () => {
  const id = sessionId();
  const request = { id, expectedSessionId: originalId };
  const created = await call("/sessions", "POST", request);
  expect(created.status).toBe(201);
  expect((await created.json()).session).toMatchObject({
    id,
    channel: "web",
    title: "New conversation",
  });
  expect((await repo.agent(DEMO_USER))!.mainSessionId).toBe(id);
  expect((await (await call(`/sessions/${id}`)).json()).history).toEqual([]);
  expect((await call("/sessions", "POST", request)).status).toBe(201);
  expect(
    (await repo.conversations(DEMO_USER)).filter((row) => row.id === id),
  ).toHaveLength(1);
  expect(a37.responseRequests).toHaveLength(0);
  expect(a37.histories.has(id)).toBe(false);
  expect(
    (await (await call("/sessions")).json()).sessions.map(
      (row: { id: string }) => row.id,
    ),
  ).toContain(originalId);
});

it("keeps transcripts separate and resumes an earlier web conversation", async () => {
  const id = sessionId();
  await call("/sessions", "POST", { id, expectedSessionId: originalId });
  const createdAt = (await repo.conversations(DEMO_USER)).find(
    (row) => row.id === id,
  )!.createdAt;
  await (
    await call("/responses", "POST", {
      input: "A distinct research project",
      sessionId: id,
    })
  ).text();
  expect(
    (
      await call(`/sessions/${originalId}/activate`, "POST", {
        expectedSessionId: id,
      })
    ).status,
  ).toBe(200);
  await (
    await call("/responses", "POST", {
      input: "Continue my original planning",
      sessionId: originalId,
    })
  ).text();
  const next = await (await call(`/sessions/${id}`)).json();
  const original = await (await call(`/sessions/${originalId}`)).json();
  expect(
    next.history.some((message: { content: string }) =>
      message.content.includes("distinct research"),
    ),
  ).toBe(true);
  expect(
    next.history.some((message: { content: string }) =>
      message.content.includes("original planning"),
    ),
  ).toBe(false);
  expect(
    original.history.some((message: { content: string }) =>
      message.content.includes("original planning"),
    ),
  ).toBe(true);
  expect(
    (await repo.conversations(DEMO_USER)).find((row) => row.id === id),
  ).toMatchObject({ title: "A distinct research project", createdAt });
  expect(
    (
      await call(`/sessions/${id}/activate`, "POST", {
        expectedSessionId: originalId,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await call(`/sessions/${id}/activate`, "POST", {
        expectedSessionId: originalId,
      })
    ).status,
  ).toBe(200);
});

it("rejects stale-tab sends and selections before starting a turn or changing the selection", async () => {
  const id = sessionId();
  await call("/sessions", "POST", { id, expectedSessionId: originalId });
  const send = await call("/responses", "POST", {
    input: "Do not misroute this draft",
    sessionId: originalId,
  });
  expect(send.status).toBe(409);
  expect(await send.json()).toMatchObject({
    error: { code: "conversation_changed" },
  });
  const abandonedId = sessionId();
  expect(
    (
      await call("/sessions", "POST", {
        id: abandonedId,
        expectedSessionId: originalId,
      })
    ).status,
  ).toBe(409);
  expect((await repo.agent(DEMO_USER))!.mainSessionId).toBe(id);
  expect(
    (await repo.conversations(DEMO_USER)).some((row) => row.id === abandonedId),
  ).toBe(false);
  expect(a37.responseRequests).toHaveLength(0);
});

it("refuses to abandon active work and keeps takeover attached to the selected conversation", async () => {
  const id = sessionId();
  await call("/sessions", "POST", { id, expectedSessionId: originalId });
  const responseId = sessionId();
  a37.histories.set(id, { id, active_response_id: responseId, history: [] });
  a37.responseSessions.set(responseId, id);
  expect(
    (
      await call("/sessions", "POST", {
        id: sessionId(),
        expectedSessionId: id,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await call(`/sessions/${originalId}/activate`, "POST", {
        expectedSessionId: id,
      })
    ).status,
  ).toBe(409);
  const cancel = vi.spyOn(a37, "cancel");
  expect((await call("/computer/takeover", "POST")).status).toBe(200);
  expect(cancel).toHaveBeenCalledWith(
    (await repo.agent(DEMO_USER))!.instanceId,
    responseId,
  );
  expect(
    (
      await call(`/sessions/${originalId}/activate`, "POST", {
        expectedSessionId: id,
      })
    ).status,
  ).toBe(200);
});

it("only activates owned web conversations and leaves channel histories read-only", async () => {
  const foreignId = sessionId();
  await repo.saveConversation({
    ownerId: DEMO_NEW_USER,
    id: foreignId,
    title: "Private",
    channel: "web",
    createdAt: new Date().toISOString(),
  });
  expect(
    (await call(`/sessions/${foreignId}/activate`, "POST", {})).status,
  ).toBe(404);
  const scheduledId = sessionId();
  await repo.saveConversation({
    ownerId: DEMO_USER,
    id: scheduledId,
    title: "Morning briefing",
    channel: "scheduled",
    createdAt: new Date().toISOString(),
  });
  expect(
    (await call(`/sessions/${scheduledId}/activate`, "POST", {})).status,
  ).toBe(409);
  expect((await call("/sessions", "POST", { id: scheduledId })).status).toBe(
    409,
  );
  expect((await repo.agent(DEMO_USER))!.mainSessionId).toBe(originalId);
  expect(
    (await call("/sessions", "POST", { id: sessionId() }, "wrong")).status,
  ).toBe(401);
});

it("preserves conversation metadata during replay and reads native titles for history", async () => {
  const prior = (await repo.conversations(DEMO_USER)).find(
    (row) => row.id === originalId,
  )!;
  const response = await (
    await call("/responses", "POST", {
      input: "Plan the week",
      sessionId: originalId,
    })
  ).text();
  const responseId = JSON.parse(response.split("data: ")[1].split("\n")[0]).id;
  await (await call(`/responses/${responseId}/stream`)).text();
  expect(
    (await repo.conversations(DEMO_USER)).find((row) => row.id === originalId),
  ).toEqual(prior);
  vi.spyOn(a37, "sessions").mockResolvedValue([
    { id: originalId, title: "Weekly planning" },
  ]);
  const history = await (await call("/sessions")).json();
  expect(
    history.sessions.find((row: { id: string }) => row.id === originalId),
  ).toMatchObject({
    title: "Weekly planning",
    createdAt: prior.createdAt,
    channel: "web",
  });
});

it("recovers a selection interrupted after the conversation record was saved", async () => {
  const saveAgent = vi
    .spyOn(repo, "saveAgent")
    .mockRejectedValueOnce(new Error("Lost database reply"));
  const id = sessionId();
  expect(
    (await call("/sessions", "POST", { id, expectedSessionId: originalId }))
      .status,
  ).toBe(500);
  expect(
    (await call("/sessions", "POST", { id, expectedSessionId: originalId }))
      .status,
  ).toBe(201);
  expect(saveAgent).toHaveBeenCalledTimes(2);
  expect((await repo.agent(DEMO_USER))!.mainSessionId).toBe(id);
  expect(
    (await repo.conversations(DEMO_USER)).filter((row) => row.id === id),
  ).toHaveLength(1);
});
