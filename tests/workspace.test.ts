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
  seedDemo,
} from "../services/control-plane/src/demo";
import {
  Lifecycle,
  WORKSPACE_HELPER_VERSION,
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
const nativeSessionId = "20261007_012345_b2c3d4";

beforeEach(async () => {
  repo = new MemoryRepository();
  a37 = new DemoAgent37();
  const inkbox = new DemoInkbox();
  await seedDemo(repo, a37, inkbox);
  const agent = (await repo.agent(DEMO_USER))!;
  await repo.saveAgent({ ...agent, callbackHash: hash("callback") });
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
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function call(path: string, method = "GET", body?: unknown) {
  return fetch(base + "/api" + path, {
    method,
    headers: {
      Authorization: "Bearer demo",
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function callback(command: string, fields: Record<string, unknown> = {}) {
  return fetch(base + "/api/agent/workspace", {
    method: "POST",
    headers: {
      Authorization: "Bearer callback",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      instance_id: (await repo.agent(DEMO_USER))!.instanceId,
      event_id: randomUUID(),
      command,
      ...fields,
    }),
  });
}

it.each(["task", "responsibility"] as const)(
  "saves a %s without a session and ignores obsolete link metadata",
  async (kind) => {
    const created = await callback("save", {
      item: { kind, title: "Plan the trip", body: "Budget: $500" },
    });
    expect(created.status).toBe(200);
    const item = (await created.json()).item;
    expect(item).toMatchObject({ kind, body: "Budget: $500", status: "todo" });
    expect(item).not.toHaveProperty("sessionLinks");

    const updated = await callback("save", {
      item: {
        ...item,
        status: "needs_you",
        sessionLinks: [{ sessionId: nativeSessionId }],
      },
      session_id: nativeSessionId,
    });
    expect(updated.status).toBe(200);
    expect((await updated.json()).item).toEqual({
      ...item,
      status: "needs_you",
      updatedAt: expect.any(String),
    });
    expect(dep.queue.send).not.toHaveBeenCalled();
  },
);

it("drops legacy links on customer and agent edits while preserving task details", async () => {
  const legacyTask = {
    ...task,
    sessionLinks: [{ sessionId: nativeSessionId, instanceId: "oldagent01" }],
  };
  await repo.saveItem(legacyTask);
  const edited = await call("/items", "POST", {
    ...legacyTask,
    title: "Updated task",
    status: "completed",
  });
  expect(edited.status).toBe(200);
  expect((await edited.json()).item).toEqual({
    ...task,
    title: "Updated task",
    status: "completed",
    updatedAt: expect.any(String),
  });

  await repo.saveItem(legacyTask);
  const saved = await callback("save", {
    item: { ...legacyTask, title: "Agent update" },
  });
  expect(saved.status).toBe(200);
  expect((await saved.json()).item).toEqual({
    ...task,
    title: "Agent update",
    updatedAt: expect.any(String),
  });
  expect(await repo.item(DEMO_USER, task.id)).not.toHaveProperty(
    "sessionLinks",
  );
});

it("removes task history access and rejects obsolete workspace commands", async () => {
  const session = vi.spyOn(a37, "session");
  expect((await call(`/items/${task.id}/history`)).status).toBe(404);
  for (const command of ["link", "history"]) {
    expect(
      (
        await callback(command, {
          task_id: task.id,
          session_id: nativeSessionId,
        })
      ).status,
    ).toBe(400);
  }
  expect(session).not.toHaveBeenCalled();
});

async function helper(args: string[], input = "", sessionId = "") {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", workspaceHelper(base), "--", ...args],
    {
      env: {
        ...process.env,
        AGENT37_INSTANCE_ID: (await repo.agent(DEMO_USER))!.instanceId,
        BOUNDLESS_CALLBACK_TOKEN: "callback",
        HERMES_SESSION_ID: sessionId,
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

it.each(["", nativeSessionId])(
  "saves and lists tasks through the installed helper independently of runtime session %s",
  async (sessionId) => {
    // -e scripts use argv[1] for their first argument; match the installed file's argv[2].
    const saved = await helper(
      ["workspace.mjs", "save"],
      JSON.stringify({ kind: "task", title: "Runtime task" }),
      sessionId,
    );
    expect(saved.code, saved.stderr).toBe(0);
    const item = JSON.parse(saved.stdout).item;
    expect(item).not.toHaveProperty("sessionLinks");
    const listed = await helper(["workspace.mjs", "list"], "", sessionId);
    expect(listed.code, listed.stderr).toBe(0);
    expect(JSON.parse(listed.stdout).items).toContainEqual(item);
  },
);

it("preserves the originating native session on notifications", async () => {
  const result = await helper(
    ["workspace.mjs", "notify", "Your report is ready"],
    "",
    nativeSessionId,
  );
  expect(result.code, result.stderr).toBe(0);
  expect(await repo.notifications(DEMO_USER)).toContainEqual(
    expect.objectContaining({
      text: "Your report is ready",
      sessionId: nativeSessionId,
    }),
  );
});

it("rejects removed link and history commands in the helper", async () => {
  for (const command of ["link", "history"]) {
    const result = await helper(["workspace.mjs", command, task.id]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Use list, save, or notify");
  }
});

it("upgrades the previous workspace helper and persona once on reconciliation", async () => {
  const agent = (await repo.agent(DEMO_USER))!;
  await repo.saveAgent({ ...agent, workspaceHelperVersion: 1 });
  const configure = vi.spyOn(dep.lifecycle, "configurePersona");
  await reconcile(dep, DEMO_USER);
  expect(configure).toHaveBeenCalledOnce();
  const helperFile = await a37.readFile(
    agent.instanceId!,
    "~/.boundless/workspace.mjs",
  );
  expect(helperFile.content).not.toContain("--session-id");
  expect(helperFile.content).not.toContain("task_id");
  const persona = (await a37.readFile(agent.instanceId!, "~/.hermes/SOUL.md"))
    .content;
  expect(persona).toContain("read its saved details");
  expect(persona).not.toContain("workspace.mjs history");
  expect(persona).not.toContain("workspace.mjs link");
  expect((await repo.agent(DEMO_USER))!.workspaceHelperVersion).toBe(
    WORKSPACE_HELPER_VERSION,
  );
  await reconcile(dep, DEMO_USER);
  expect(configure).toHaveBeenCalledOnce();
});

it("sends ordinary chat without task-linking context while keeping its session", async () => {
  const responses = vi.spyOn(a37, "responses");
  const response = await call("/responses", "POST", {
    input: "Follow up on my task",
  });
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("response.completed");
  expect(responses.mock.calls[0][1]).toMatchObject({
    input: "Follow up on my task",
    session_id: (await repo.agent(DEMO_USER))!.mainSessionId,
  });
});

it("keeps takeover and check-in context hidden from the displayed user message", async () => {
  const responses = vi.spyOn(a37, "responses");
  const note = (await repo.notifications(DEMO_USER))[0];
  const response = await call("/responses", "POST", {
    input: "Follow up on my task",
    takeover: true,
    notificationId: note.id,
  });
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("response.completed");
  const input = String(responses.mock.calls[0][1].input);
  expect(visibleMessage(input)).toBe("Follow up on my task");
  expect(input).not.toContain("--session-id");
  expect(input).toContain("returned control");
  expect(input).toContain("replying to this check-in");
});
