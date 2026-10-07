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
  reconcile,
  type Dependencies,
} from "../services/control-plane/src/app";
import { loadConfig } from "../services/control-plane/src/config";
import {
  executeJobSlice,
  type SupabaseJobs,
} from "../services/control-plane/src/jobs";
import { hash, HttpError } from "../services/control-plane/src/security";
import {
  protectedPorts,
  reconcileComputerLinksLocked,
} from "../services/control-plane/src/computer-services";

let repo: MemoryRepository,
  a37: DemoAgent37,
  dep: Dependencies,
  server: Server,
  base: string,
  instance: string,
  otherInstance: string;
const callback = "test-computer-callback";
beforeEach(async () => {
  repo = new MemoryRepository();
  a37 = new DemoAgent37();
  const inkbox = new DemoInkbox();
  await seedDemo(repo, a37, inkbox);
  const agent = (await repo.agent(DEMO_USER))!;
  agent.callbackHash = hash(callback);
  agent.computerHelperVersion = 1;
  await repo.saveAgent(agent);
  instance = agent.instanceId!;
  await repo.saveProfile({
    ...(await repo.profile(DEMO_USER))!,
    id: DEMO_NEW_USER,
    email: "new@example.com",
  });
  const other = await a37.createInstance({
    user: DEMO_NEW_USER,
    template: "boundless-hermes-desktop@4",
  });
  otherInstance = other.id;
  await repo.saveAgent({
    ...agent,
    ownerId: DEMO_NEW_USER,
    instanceId: otherInstance,
    mainSessionId: undefined,
    callbackHash: hash("other-callback"),
  });
  const config = loadConfig({ DEMO_MODE: "true" });
  dep = {
    repo,
    a37,
    inkbox,
    config,
    lifecycle: new Lifecycle(config, repo, a37, inkbox),
    queue: { send: vi.fn() },
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
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const input = (port = 8788, kind: "signed" | "public" = "signed") => ({
  id: randomUUID(),
  port,
  label: "Project preview",
  reason: "Preview the page I built.",
  kind,
  ...(kind === "signed" ? { ttl_seconds: 3600 } : {}),
});
const request = (
  body: ReturnType<typeof input>,
  key = callback,
  computer = instance,
) =>
  call(
    "/agent/computer",
    "POST",
    { instance_id: computer, command: "request", ...body },
    key,
  );
const tick = () =>
  repo.locked(DEMO_USER, () => reconcileComputerLinksLocked(dep, DEMO_USER));
async function ownerRequest(
  port = 8788,
  kind: "signed" | "public" = "signed",
  ttl = 3600,
) {
  await call("/computer/services", "POST", { port, label: "Project preview" });
  const body = {
    ...input(port, kind),
    ...(kind === "signed" ? { ttl_seconds: ttl } : {}),
  };
  expect((await call("/computer/requests", "POST", body)).status).toBe(202);
  return body;
}
it("queues an immutable agent request once without publishing or waking its computer", async () => {
  const signed = vi.spyOn(a37, "signedUrl"),
    create = vi.spyOn(a37, "createPublicPort"),
    check = vi.spyOn(a37, "checkService");
  const body = input();
  const results = await Promise.all([
    request(body),
    request(body),
    request(body),
  ]);
  expect(results.map((row) => row.status)).toEqual([202, 202, 202]);
  expect((await results[0].json()).request).toMatchObject({
    id: body.id,
    status: "pending",
    kind: "signed",
  });
  expect(await repo.computerRequests(DEMO_USER)).toHaveLength(1);
  expect(await repo.computerServices(DEMO_USER)).toHaveLength(1);
  const notes = (await repo.notifications(DEMO_USER)).filter(
    (note) => note.target?.requestId === body.id,
  );
  expect(notes).toHaveLength(1);
  expect(notes[0].target?.view).toBe("computer");
  expect(signed).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect(check).not.toHaveBeenCalled();
  expect(dep.queue.send).not.toHaveBeenCalled();
  expect((await request({ ...body, reason: "Changed reason" })).status).toBe(
    409,
  );
  expect((await request({ ...body, id: randomUUID() })).status).toBe(409);
  expect(
    (
      await call(`/computer/requests/${body.id}/approve`, "POST", {
        ttl_seconds: 604800,
      })
    ).status,
  ).toBe(400);
});
it("authenticates the originating instance and conceals foreign requests and links", async () => {
  const body = input();
  await request(body);
  expect(
    (await request({ ...body, id: randomUUID() }, callback, otherInstance))
      .status,
  ).toBe(403);
  expect((await request({ ...body, id: randomUUID() }, "wrong")).status).toBe(
    403,
  );
  expect(
    (
      await call(
        `/computer/requests/${body.id}/approve`,
        "POST",
        {},
        "demo-new",
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await (
        await call("/computer/services", "GET", undefined, "demo-new")
      ).json()
    ).requests,
  ).toEqual([]);
  expect(
    (
      await call(
        "/agent/computer",
        "POST",
        { instance_id: otherInstance, command: "status", id: body.id },
        "other-callback",
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await request({
        ...body,
        id: randomUUID(),
        ownerId: DEMO_NEW_USER,
      } as any)
    ).status,
  ).toBe(400);
  expect(
    (
      await call(
        "/agent/computer",
        "POST",
        { instance_id: instance, command: "approve", id: body.id },
        callback,
      )
    ).status,
  ).toBe(400);
  expect(
    (await call("/computer/services", "GET", undefined, "wrong")).status,
  ).toBe(401);
});
it.each([...protectedPorts])(
  "protects infrastructure port %s for signed/public requests and removal",
  async (port) => {
    const create = vi.spyOn(a37, "createPublicPort"),
      remove = vi.spyOn(a37, "removePublicPort");
    expect((await request(input(port))).status).toBe(400);
    expect((await request(input(port, "public"))).status).toBe(400);
    expect(
      (
        await call("/computer/services", "POST", {
          port,
          label: "Private service",
        })
      ).status,
    ).toBe(400);
    expect(
      (await call(`/computer/services/${port}/public-link`, "DELETE")).status,
    ).toBe(400);
    expect(create).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  },
);
it.each([0, 60, 901, 604801, "3600", 1.5])(
  "rejects unsupported signed expiry %s",
  async (ttl_seconds) => {
    expect((await request({ ...input(), ttl_seconds } as any)).status).toBe(
      400,
    );
  },
);
it.each([900, 3600, 86400, 604800])(
  "requires owner approval and preserves the issued %s-second signed receipt",
  async (ttl_seconds) => {
    const body = { ...input(), ttl_seconds };
    await request(body);
    const mint = vi.spyOn(a37, "signedUrl");
    expect(
      (await call(`/computer/requests/${body.id}/approve`, "POST", {})).status,
    ).toBe(200);
    await tick();
    const stored = (await repo.computerRequest(DEMO_USER, body.id))!;
    expect(stored.status).toBe("approved");
    expect(stored.urlBox).not.toContain("https");
    expect(mint).toHaveBeenCalledExactlyOnceWith(instance, 8788, ttl_seconds);
    const first = await (
      await call(
        "/agent/computer",
        "POST",
        { instance_id: instance, command: "status", id: body.id },
        callback,
      )
    ).json();
    expect(first.requests[0].url).toContain("a37_token=");
    expect(first.requests[0].urlBox).toBeUndefined();
    const repeated = await (
      await call(`/computer/requests/${body.id}/approve`, "POST", {})
    ).json();
    expect(repeated.request.url).toBe(first.requests[0].url);
    await tick();
    expect(mint).toHaveBeenCalledTimes(1);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse(stored.expiresAt!) + 1000);
    const expired = await (
      await call(
        "/agent/computer",
        "POST",
        { instance_id: instance, command: "status", id: body.id },
        callback,
      )
    ).json();
    expect(expired.requests[0]).toMatchObject({ status: "expired" });
    expect(expired.requests[0].url).toBeUndefined();
  },
);
it("fails an unavailable service visibly and only retries after explicit owner approval", async () => {
  const body = input();
  await request(body);
  a37.serviceStates.set(`${instance}:8788`, false);
  const mint = vi.spyOn(a37, "signedUrl");
  await call(`/computer/requests/${body.id}/approve`, "POST", {});
  await tick();
  expect((await repo.computerRequest(DEMO_USER, body.id))!.status).toBe(
    "failed",
  );
  expect((await repo.computerServices(DEMO_USER))[0].state).toBe("not_running");
  a37.serviceStates.set(`${instance}:8788`, true);
  await tick();
  expect(mint).not.toHaveBeenCalled();
  await call(`/computer/requests/${body.id}/approve`, "POST", {});
  await tick();
  expect((await repo.computerRequest(DEMO_USER, body.id))!.status).toBe(
    "approved",
  );
});
it("recovers a dropped public create reply and disables only its public route after a dropped delete reply", async () => {
  const publicRequest = await ownerRequest(8788, "public");
  const original = a37.createPublicPort.bind(a37);
  const create = vi
    .spyOn(a37, "createPublicPort")
    .mockImplementation(async (...args) => {
      await original(...args);
      throw new Error("reply dropped secret");
    });
  await tick();
  expect(
    (await repo.computerRequest(DEMO_USER, publicRequest.id))!.status,
  ).toBe("approved");
  expect(create).toHaveBeenCalledTimes(1);
  const signed = await ownerRequest();
  await tick();
  const deletePort = a37.removePublicPort.bind(a37);
  vi.spyOn(a37, "removePublicPort").mockImplementation(async (...args) => {
    await deletePort(...args);
    throw new Error("lost delete reply");
  });
  expect(
    (await call("/computer/services/8788/public-link", "DELETE")).status,
  ).toBe(202);
  await tick();
  expect(
    (await a37.publicPorts(instance)).some((row) => row.port === 8788),
  ).toBe(false);
  expect(
    (await a37.publicPorts(instance)).some((row) => row.port === 8765),
  ).toBe(true);
  expect(
    (await repo.computerRequest(DEMO_USER, publicRequest.id))!.status,
  ).toBe("revoked");
  expect((await repo.computerRequest(DEMO_USER, signed.id))!.status).toBe(
    "approved",
  );
  expect(
    (await call(`/computer/requests/${signed.id}/reject`, "POST", {})).status,
  ).toBe(409);
});
it("reconciles public publication after persistence fails even if the service then exits", async () => {
  const body = await ownerRequest(8788, "public");
  const save = repo.saveComputerRequest.bind(repo);
  let fail = true;
  vi.spyOn(repo, "saveComputerRequest").mockImplementation(async (row) => {
    if (row.status === "approved" && fail) {
      fail = false;
      throw new Error("database interrupted");
    }
    await save(row);
  });
  const create = vi.spyOn(a37, "createPublicPort");
  await expect(tick()).rejects.toThrow("database interrupted");
  a37.serviceStates.set(`${instance}:8788`, false);
  await tick();
  expect((await repo.computerRequest(DEMO_USER, body.id))!.status).toBe(
    "approved",
  );
  expect(create).toHaveBeenCalledTimes(1);
});
it("preserves saved intent when dispatch fails and redacts provider failure details", async () => {
  vi.mocked(dep.queue.send).mockRejectedValueOnce(
    new HttpError(503, "dispatch_interrupted", "Retry shortly."),
  );
  await call("/computer/services", "POST", {
    port: 8788,
    label: "Project preview",
  });
  const body = input();
  expect((await call("/computer/requests", "POST", body)).status).toBe(502);
  expect((await repo.computerRequest(DEMO_USER, body.id))!.status).toBe(
    "publishing",
  );
  vi.spyOn(a37, "signedUrl").mockRejectedValue(
    new Error("sk_live_private a37_token=secret"),
  );
  for (let i = 0; i < 5; i++) await tick();
  const failed = (await repo.computerRequest(DEMO_USER, body.id))!;
  expect(failed.status).toBe("failed");
  expect(JSON.stringify(failed)).not.toContain("sk_live_private");
  await tick();
  expect(a37.signedUrl).toHaveBeenCalledTimes(5);
});
it("keeps status/metrics readable and allows public removal during suspension", async () => {
  await ownerRequest(8788, "public");
  await tick();
  const agent = (await repo.agent(DEMO_USER))!;
  agent.suspended = true;
  await repo.saveAgent(agent);
  await a37.stop(instance);
  expect((await call("/computer/status")).status).toBe(200);
  expect((await call("/computer/metrics")).status).toBe(200);
  expect(
    (await (await call("/computer/services")).json()).publicationAllowed,
  ).toBe(false);
  expect((await request(input(8790))).status).toBe(403);
  expect(
    (await call("/computer/maintenance", "POST", { action: "restart" })).status,
  ).toBe(403);
  expect(
    (await call("/computer/services/8788/public-link", "DELETE")).status,
  ).toBe(202);
  await tick();
  expect(
    (await a37.publicPorts(instance)).some((row) => row.port === 8788),
  ).toBe(false);
});
it("caps pending requests across concurrent submissions and rejects retrying into a full inbox", async () => {
  const failed = await ownerRequest();
  a37.serviceStates.set(`${instance}:8788`, false);
  await tick();
  const results = await Promise.all(
    Array.from({ length: 51 }, (_, i) => request(input(10000 + i))),
  );
  expect(results.filter((result) => result.status === 202)).toHaveLength(50);
  expect(results.filter((result) => result.status === 409)).toHaveLength(1);
  expect(await repo.computerRequests(DEMO_USER)).toHaveLength(51);
  expect(
    (await call(`/computer/requests/${failed.id}/approve`, "POST", {})).status,
  ).toBe(409);
});
it("allows a regular ready customer to maintain only their own computer", async () => {
  expect(
    (await call("/computer/status", "GET", undefined, "demo-new")).status,
  ).toBe(200);
  expect(
    (
      await call(
        "/computer/maintenance",
        "POST",
        { action: "restart", ownerId: DEMO_USER },
        "demo-new",
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await call(
        "/computer/maintenance",
        "POST",
        { action: "restart" },
        "demo-new",
      )
    ).status,
  ).toBe(202);
  expect((await repo.agent(DEMO_NEW_USER))!.computerOperation?.action).toBe(
    "restart",
  );
  expect((await repo.agent(DEMO_USER))!.computerOperation).toBeUndefined();
});

it("revokes public access before an interrupted suspension and never publishes a queued signed link", async () => {
  const published = await ownerRequest(8788, "public");
  await tick();
  await ownerRequest();
  await call("/computer/services/8788/public-link", "DELETE");
  const agent = (await repo.agent(DEMO_USER))!;
  agent.suspensionOperation = {
    id: randomUUID(),
    suspended: true,
    phase: "pending",
    requestedAt: new Date().toISOString(),
  };
  await repo.saveAgent(agent);
  vi.spyOn(a37, "stop").mockRejectedValue(
    new HttpError(503, "stop_interrupted", "Provider unavailable."),
  );
  const mint = vi.spyOn(a37, "signedUrl");
  const jobs = {
    claim: vi
      .fn()
      .mockResolvedValue({
        id: randomUUID(),
        owner_id: DEMO_USER,
        kind: "reconcile",
        status: "running",
        failures: 0,
      }),
    finish: vi.fn(),
  } as unknown as SupabaseJobs;
  expect(await executeJobSlice(dep, jobs, randomUUID(), randomUUID())).toBe(
    "retry",
  );
  expect((await repo.computerRequest(DEMO_USER, published.id))!.status).toBe(
    "revoked",
  );
  expect(mint).not.toHaveBeenCalled();
});

it("requires explicit retry of failed public removal while allowing independent signed previews", async () => {
  await ownerRequest(8788, "public");
  await tick();
  const remove = vi
    .spyOn(a37, "removePublicPort")
    .mockRejectedValue(
      new HttpError(503, "upstream_failure", "Provider unavailable."),
    );
  await call("/computer/services/8788/public-link", "DELETE");
  for (let i = 0; i < 5; i++) await tick();
  expect((await repo.computerServices(DEMO_USER))[0].publicRemoval?.phase).toBe(
    "failed",
  );
  await tick();
  expect(remove).toHaveBeenCalledTimes(5);
  const signed = await ownerRequest();
  await tick();
  expect((await repo.computerRequest(DEMO_USER, signed.id))!.status).toBe(
    "approved",
  );
  remove.mockRestore();
  await call("/computer/services/8788/public-link", "DELETE");
  await tick();
  expect(
    (await repo.computerServices(DEMO_USER))[0].publicRemoval,
  ).toBeUndefined();
});

it("retains queued link work when maintenance completes on the same durable job", async () => {
  const body = await ownerRequest();
  const agent = (await repo.agent(DEMO_USER))!;
  agent.computerOperation = {
    id: randomUUID(),
    action: "restart",
    phase: "checking",
    targetTemplate: "boundless-hermes-desktop@2",
    requestedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
  };
  await repo.saveAgent(agent);
  const mint = vi.spyOn(a37, "signedUrl");
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
  expect(mint).not.toHaveBeenCalled();
  expect(await executeJobSlice(dep, jobs, randomUUID(), randomUUID())).toBe(
    "complete",
  );
  expect((await repo.computerRequest(DEMO_USER, body.id))!.status).toBe(
    "approved",
  );
});

it("blocks publishing during maintenance and preserves rejection status for the agent", async () => {
  const body = input();
  await request(body);
  const agent = (await repo.agent(DEMO_USER))!;
  agent.computerOperation = {
    id: randomUUID(),
    action: "restart",
    phase: "queued",
    targetTemplate: "boundless-hermes-desktop@2",
    requestedAt: new Date().toISOString(),
  };
  await repo.saveAgent(agent);
  expect((await request(input(8790))).status).toBe(409);
  expect(
    (await call(`/computer/requests/${body.id}/approve`, "POST", {})).status,
  ).toBe(409);
  expect(
    (await call(`/computer/requests/${body.id}/reject`, "POST", {})).status,
  ).toBe(200);
  const state = await (
    await call(
      "/agent/computer",
      "POST",
      { instance_id: instance, command: "status", id: body.id },
      callback,
    )
  ).json();
  expect(state.requests[0].status).toBe("rejected");
  expect(state.requests[0].url).toBeUndefined();
});

it("installs the new helper once on an existing computer and preserves custom persona content", async () => {
  const agent = (await repo.agent(DEMO_USER))!;
  delete agent.computerHelperVersion;
  await repo.saveAgent(agent);
  a37.files.set("~/.hermes/SOUL.md", {
    content:
      "# Custom native instructions\nKeep this private custom section.\n",
    modified: 123.25,
  });
  const create = vi.spyOn(a37, "createInstance");
  const write = vi.spyOn(a37, "writeFile");
  await reconcile(dep, DEMO_USER);
  expect((await repo.agent(DEMO_USER))!.computerHelperVersion).toBe(1);
  expect(a37.files.get("~/.boundless/computer.mjs")!.content).toContain(
    "BOUNDLESS_CALLBACK_TOKEN",
  );
  expect(a37.files.get("~/.hermes/SOUL.md")!.content).toContain(
    "Keep this private custom section.",
  );
  const count = write.mock.calls.length;
  await reconcile(dep, DEMO_USER);
  expect(write.mock.calls).toHaveLength(count);
  expect(create).not.toHaveBeenCalled();
  expect((await repo.agent(DEMO_USER))!.instanceId).toBe(instance);
});
it("serializes publication with closure and erases service/link records only after provider cleanup", async () => {
  const body = await ownerRequest(8788, "public");
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.spyOn(a37, "checkService").mockImplementation(async () => {
    entered();
    await gate;
    return true;
  });
  const publishing = tick();
  await started;
  const closing = call("/account", "DELETE");
  release();
  await publishing;
  expect((await closing).status).toBe(202);
  expect((await repo.agent(DEMO_USER))!.status).toBe("deleting");
  expect((await request(input(8790))).status).toBe(403);
  expect(
    (await call(`/computer/requests/${body.id}/approve`, "POST", {})).status,
  ).toBe(409);
  const create = vi.spyOn(a37, "createPublicPort");
  await tick();
  expect(create).not.toHaveBeenCalled();
  const remove = vi.spyOn(a37, "removeInstance");
  await dep.lifecycle.cleanup(DEMO_USER);
  expect(remove).toHaveBeenCalledExactlyOnceWith(instance);
  expect(await repo.computerServices(DEMO_USER)).toEqual([]);
  expect(await repo.computerRequests(DEMO_USER)).toEqual([]);
  expect(await repo.agent(DEMO_NEW_USER)).not.toBeNull();
});
