import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { Server } from "node:http";
import { visibleMessage, type WorkspaceItem } from "@boundless/shared";
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
import {
  Lifecycle,
  workspaceHelper,
} from "../services/control-plane/src/lifecycle";
import { MemoryRepository } from "../services/control-plane/src/repository";
import { hash } from "../services/control-plane/src/security";

let repo: MemoryRepository,
  a37: DemoAgent37,
  dep: Dependencies,
  server: Server,
  base: string;
let task: WorkspaceItem;
const sessionOne = "a".repeat(32);
const sessionTwo = "20261007_012345_b2c3d4";
beforeEach(async () => {
  repo = new MemoryRepository();
  a37 = new DemoAgent37();
  const inkbox = new DemoInkbox();
  await seedDemo(repo, a37, inkbox);
  const agent = (await repo.agent(DEMO_USER))!;
  await repo.saveAgent({ ...agent, callbackHash: hash("callback") });
  await repo.saveProfile({
    ...(await repo.profile(DEMO_USER))!,
    id: DEMO_NEW_USER,
    email: "other@example.com",
  });
  await repo.saveAgent({
    ...agent,
    ownerId: DEMO_NEW_USER,
    instanceId: "other12345",
    callbackHash: hash("other-callback"),
  });
  const config = loadConfig({ DEMO_MODE: "true" });
  dep = {
    repo,
    a37,
    inkbox,
    config,
    lifecycle: new Lifecycle(config, repo, a37, inkbox),
    queue: { send: vi.fn(async () => {}) },
  };
  server = createApp(dep).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  task = (await repo.items(DEMO_USER)).find((item) => item.kind === "task")!;
  a37.histories.set(sessionOne, {
    id: sessionOne,
    active_response_id: null,
    history: [
      { role: "user", content: "Earlier task decision" },
      {
        role: "assistant",
        content: "Full result " + "x".repeat(40000) + " final detail",
      },
    ],
  });
  a37.histories.set(sessionTwo, {
    id: sessionTwo,
    active_response_id: null,
    history: [
      { role: "user", content: "Follow-up in a different chat" },
      { role: "assistant", content: "A revised decision" },
    ],
  });
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
function call(
  path: string,
  method = "GET",
  body?: unknown,
  credential = "demo",
) {
  return fetch(base + "/api" + path, {
    method,
    headers: {
      Authorization: `Bearer ${credential}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function callback(
  command: string,
  fields: Record<string, unknown> = {},
  credential = "callback",
  instanceId?: string,
) {
  return call(
    "/agent/workspace",
    "POST",
    {
      instance_id: instanceId || (await repo.agent(DEMO_USER))!.instanceId,
      event_id: randomUUID(),
      command,
      ...fields,
    },
    credential,
  );
}
async function link(sessionId = sessionOne) {
  const response = await callback("link", {
    task_id: task.id,
    session_id: sessionId,
  });
  expect(response.status).toBe(200);
  return (await response.json()).item as WorkspaceItem;
}

it("links multiple conversations without changing task details and deduplicates repeated links", async () => {
  await link();
  await link(sessionTwo);
  const item = await link();
  expect(item.sessionLinks?.map((row) => row.sessionId)).toEqual([
    sessionOne,
    sessionTwo,
  ]);
  expect(item).toMatchObject({
    title: task.title,
    body: task.body,
    status: task.status,
    createdAt: task.createdAt,
  });
  const instanceId = (await repo.agent(DEMO_USER))!.instanceId;
  expect(item.sessionLinks?.every((row) => row.instanceId === instanceId)).toBe(
    true,
  );
});

it("preserves links on customer edits, completion, and agent saves; ignores forged customer links", async () => {
  await link();
  const edited = await call("/items", "POST", {
    ...task,
    title: "Updated task",
    status: "completed",
    sessionLinks: [
      {
        sessionId: sessionTwo,
        instanceId: "other12345",
        linkedAt: task.createdAt,
      },
    ],
  });
  expect(edited.status).toBe(200);
  expect(
    (await edited.json()).item.sessionLinks.map((row: any) => row.sessionId),
  ).toEqual([sessionOne]);
  const saved = await callback("save", {
    item: { ...task, title: "Agent update" },
    session_id: sessionTwo,
  });
  expect(saved.status).toBe(200);
  expect(
    (await saved.json()).item.sessionLinks.map((row: any) => row.sessionId),
  ).toEqual([sessionOne, sessionTwo]);
  const created = await (
    await call("/items", "POST", {
      kind: "task",
      title: "Manual task",
      sessionLinks: task.sessionLinks || [{ sessionId: sessionOne }],
    })
  ).json();
  expect(created.item.sessionLinks).toBeUndefined();
});

it("returns complete histories across chats and can select one without requiring session resumption", async () => {
  await link();
  await link(sessionTwo);
  const all = await (await callback("history", { task_id: task.id })).json();
  expect(all.conversations).toHaveLength(2);
  expect(all.conversations[0].history[1].content).toBe(
    a37.histories.get(sessionOne)!.history[1].content,
  );
  expect(all.conversations[1].history[1].content).toBe("A revised decision");
  expect(all.conversations.every((row: any) => row.available)).toBe(true);
  const single = await (
    await call(`/items/${task.id}/history?sessionId=${sessionTwo}`)
  ).json();
  expect(single.conversations).toHaveLength(1);
  expect(single.conversations[0].sessionId).toBe(sessionTwo);
  expect(
    (await call(`/items/${task.id}/history?sessionId=${"f".repeat(32)}`))
      .status,
  ).toBe(404);
});

it("keeps task and history access scoped to the authenticated owner before consulting the provider", async () => {
  await link();
  const read = vi.spyOn(a37, "session");
  expect(
    (await call(`/items/${task.id}/history`, "GET", undefined, "demo-new"))
      .status,
  ).toBe(404);
  expect(
    (
      await callback(
        "history",
        { task_id: task.id },
        "other-callback",
        "other12345",
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await callback(
        "link",
        { task_id: task.id, session_id: sessionTwo },
        "other-callback",
        "other12345",
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await callback(
        "save",
        { item: task, session_id: sessionTwo },
        "other-callback",
        "other12345",
      )
    ).status,
  ).toBe(404);
  expect(
    (await callback("history", { task_id: task.id }, "wrong")).status,
  ).toBe(403);
  expect(read).not.toHaveBeenCalled();
  expect((await repo.item(DEMO_USER, task.id))?.sessionLinks).toHaveLength(1);
});

it("reports unavailable transcripts and computer replacements without redirecting an old link to a new computer", async () => {
  await link();
  a37.histories.delete(sessionOne);
  expect(
    (await (await call(`/items/${task.id}/history`)).json()).conversations[0]
      .available,
  ).toBe(false);
  const agent = (await repo.agent(DEMO_USER))!;
  await repo.saveAgent({ ...agent, instanceId: "newagent01" });
  const read = vi.spyOn(a37, "session");
  const history = await (await call(`/items/${task.id}/history`)).json();
  expect(history.conversations[0]).toMatchObject({
    available: false,
    reason: "computer_replaced",
    sessionId: sessionOne,
  });
  expect(read).not.toHaveBeenCalled();
});

it("rejects invalid links, wiki targets, and suspended callbacks", async () => {
  const wiki = (await repo.items(DEMO_USER)).find(
    (item) => item.kind === "wiki",
  )!;
  expect(
    (await callback("link", { task_id: wiki.id, session_id: sessionOne }))
      .status,
  ).toBe(404);
  expect(
    (await callback("link", { task_id: task.id, session_id: "../../secret" }))
      .status,
  ).toBe(400);
  expect((await callback("link", { task_id: task.id })).status).toBe(400);
  expect((await callback("history", {})).status).toBe(400);
  const agent = (await repo.agent(DEMO_USER))!;
  await repo.saveAgent({ ...agent, suspended: true });
  expect(
    (await callback("link", { task_id: task.id, session_id: sessionOne }))
      .status,
  ).toBe(403);
  expect((await callback("history", { task_id: task.id })).status).toBe(403);
});

it("does not lose concurrent conversation links during task editing", async () => {
  const responses = await Promise.all([
    callback("link", { task_id: task.id, session_id: sessionOne }),
    call("/items", "POST", { ...task, title: "Concurrent edit" }),
    callback("link", { task_id: task.id, session_id: sessionTwo }),
  ]);
  expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
  const item = (await repo.item(DEMO_USER, task.id))!;
  expect(item.title).toBe("Concurrent edit");
  expect(item.sessionLinks?.map((row) => row.sessionId).sort()).toEqual(
    [sessionOne, sessionTwo].sort(),
  );
});

async function helper(args: string[], input = "", sessionId?: string) {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", workspaceHelper(base), "--", ...args],
    {
      env: {
        ...process.env,
        AGENT37_INSTANCE_ID: (await repo.agent(DEMO_USER))!.instanceId,
        BOUNDLESS_CALLBACK_TOKEN: "callback",
        HERMES_SESSION_ID: sessionId || "",
      },
    },
  );
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.stdin.end(input);
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { code, stdout, stderr };
}

it("automatically links helper saves using the runtime session and supports an explicit web id override", async () => {
  // -e scripts use argv[1] for their first argument; match the installed file's argv[2].
  const saved = await helper(
    ["workspace.mjs", "save"],
    JSON.stringify({ kind: "task", title: "Runtime task" }),
    sessionTwo,
  );
  expect(saved.code, saved.stderr).toBe(0);
  const item = JSON.parse(saved.stdout).item;
  expect(item.sessionLinks[0].sessionId).toBe(sessionTwo);
  const linked = await helper(
    ["workspace.mjs", "link", item.id, "--session-id", sessionOne],
    "",
    sessionTwo,
  );
  expect(linked.code, linked.stderr).toBe(0);
  expect(JSON.parse(linked.stdout).item.sessionLinks).toHaveLength(2);
  const history = await helper(
    ["workspace.mjs", "history", item.id],
    "",
    sessionTwo,
  );
  expect(history.code, history.stderr).toBe(0);
  expect(JSON.parse(history.stdout).conversations).toHaveLength(2);
  const missing = await helper(["workspace.mjs", "link", task.id]);
  expect(missing.code).not.toBe(0);
  expect(missing.stderr).toContain("Current session id unavailable");
});

it("refreshes the installed workspace helper once for an existing ready computer", async () => {
  const agent = (await repo.agent(DEMO_USER))!;
  await repo.saveAgent({ ...agent, workspaceHelperVersion: undefined });
  const configure = vi.spyOn(dep.lifecycle, "configurePersona");
  await reconcile(dep, DEMO_USER);
  expect(configure).toHaveBeenCalledOnce();
  expect(
    (await a37.readFile(agent.instanceId!, "~/.boundless/workspace.mjs"))
      .content,
  ).toContain("HERMES_SESSION_ID");
  const persona = (await a37.readFile(agent.instanceId!, "~/.hermes/SOUL.md"))
    .content;
  expect(persona).toContain("full linked conversation histories across chats");
  await reconcile(dep, DEMO_USER);
  expect(configure).toHaveBeenCalledOnce();
});

it("provides the web conversation id without exposing internal context in the displayed user message", async () => {
  const responses = vi.spyOn(a37, "responses");
  const note = (await repo.notifications(DEMO_USER))[0];
  const response = await call("/responses", "POST", {
    input: "Follow up on my task",
    takeover: true,
    notificationId: note.id,
  });
  expect(response.status).toBe(200);
  const frames = await response.text();
  expect(frames).toContain("response.completed");
  const input = String(responses.mock.calls[0][1].input);
  expect(visibleMessage(input)).toBe("Follow up on my task");
  expect(input).toContain(
    `--session-id ${(await repo.agent(DEMO_USER))!.mainSessionId}`,
  );
  expect(input).toContain("returned control");
  expect(input).toContain("replying to this check-in");
});
