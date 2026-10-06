import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
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
import { hash, HttpError } from "../services/control-plane/src/security";

let repo: MemoryRepository,
  a37: DemoAgent37,
  inkbox: DemoInkbox,
  lifecycle: Lifecycle,
  server: Server,
  base: string,
  dep: Dependencies;
beforeEach(async () => {
  repo = new MemoryRepository();
  a37 = new DemoAgent37();
  inkbox = new DemoInkbox();
  await seedDemo(repo, a37, inkbox);
  const config = loadConfig({ DEMO_MODE: "true" });
  lifecycle = new Lifecycle(config, repo, a37, inkbox);
  dep = {
    config,
    repo,
    a37,
    inkbox,
    lifecycle,
    queue: { send: vi.fn(async () => {}) },
  };
  server = createServer(createApp(dep));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
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
  return fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${credential}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

it("leaves invitations retryable on profile failure and accepts tokenless retries after success", async () => {
  const digest = hash("recovery-invitation-token");
  await repo.createInvitation(
    "new@example.com",
    digest,
    new Date(Date.now() + 86400000).toISOString(),
  );
  vi.spyOn(repo, "saveProfile").mockRejectedValueOnce(
    new HttpError(500, "database_error", "Injected save failure"),
  );
  expect(
    (await call("/invitations/accept", "POST", {}, "demo-new")).status,
  ).toBe(502);
  expect(await repo.profile(DEMO_NEW_USER)).toBeNull();
  expect(await repo.pendingInvitation("new@example.com")).toBe(digest);
  expect(
    (await call("/invitations/accept", "POST", {}, "demo-new")).status,
  ).toBe(200);
  expect(
    (await call("/invitations/accept", "POST", {}, "demo-new")).status,
  ).toBe(200);
  expect((await repo.invitations())[0].usedBy).toBe(DEMO_NEW_USER);
});

it("requires a new approval after deletion, mints a fresh token and erases the old invitation", async () => {
  const deliveries: { url: string; digest: string }[] = [];
  dep.invitationEmail = async (input) => {
    deliveries.push(input);
  };
  expect(
    (
      await call("/operator/invitations/send", "POST", {
        email: "new@example.com",
      })
    ).status,
  ).toBe(201);
  const oldToken = new URL(deliveries[0].url).searchParams.get("invite")!;
  expect(
    (await call("/invitations/accept", "POST", {}, "demo-new")).status,
  ).toBe(200);
  expect(
    (
      await call("/operator/invitations/send", "POST", {
        email: "new@example.com",
      })
    ).status,
  ).toBe(409);
  await repo.removeCustomer(DEMO_NEW_USER);
  expect(await repo.invitations()).toHaveLength(0);
  expect(await repo.betaRequests()).toHaveLength(0);
  expect(
    (await call("/invitations/accept", "POST", {}, "demo-new")).status,
  ).toBe(403);
  expect(
    (
      await call("/operator/invitations/send", "POST", {
        email: "new@example.com",
      })
    ).status,
  ).toBe(201);
  expect(deliveries).toHaveLength(2);
  expect(deliveries[1].digest).not.toBe(deliveries[0].digest);
  expect(
    (await (await call("/operator/invitations")).json()).invitations[0].status,
  ).toBe("pending");
  const otherOwner = randomUUID();
  await expect(
    repo.acceptInvitation(
      {
        ...(await repo.profile(DEMO_USER))!,
        id: otherOwner,
        email: "new@example.com",
      },
      hash(oldToken),
    ),
  ).rejects.toMatchObject({ code: "invalid_invitation" });
  expect(
    (await call("/invitations/accept", "POST", {}, "demo-new")).status,
  ).toBe(200);
  // Delivery retry must keep the newly approved token, rather than remint every time.
  expect(
    (
      await call("/operator/invitations/send", "POST", {
        email: "new@example.com",
      })
    ).status,
  ).toBe(409);
});

it("marks account closure before dispatch and denies further setup and workspace access", async () => {
  vi.mocked(dep.queue.send).mockImplementation(async (kind, owner) => {
    expect(kind).toBe("cleanup");
    expect(owner).toBe(DEMO_USER);
    expect((await repo.agent(owner))!.status).toBe("deleting");
  });
  expect((await call("/account", "DELETE")).status).toBe(202);
  for (const [path, method, body] of [
    ["/items", "GET", undefined],
    ["/items", "POST", { kind: "wiki", title: "Closing account" }],
    ["/responses", "POST", { input: "Keep working" }],
    ["/onboarding/retry", "POST", {}],
    ["/onboarding/verify-phone", "POST", {}],
  ] as const) {
    const response = await call(path, method, body);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "account_deleting" },
    });
  }
  const create = vi.spyOn(a37, "createInstance");
  await lifecycle.provision(DEMO_USER);
  expect(create).not.toHaveBeenCalled();
  expect((await call("/me")).status).toBe(200);
});
it("keeps closure intent when dispatch fails and recovers it from account polling", async () => {
  vi.mocked(dep.queue.send).mockRejectedValueOnce(
    new HttpError(503, "queue_unavailable", "Dispatch unavailable"),
  );
  expect((await call("/account", "DELETE")).status).toBe(502);
  expect((await repo.agent(DEMO_USER))!.status).toBe("deleting");
  expect((await call("/me")).status).toBe(200);
  expect(dep.queue.send).toHaveBeenLastCalledWith("cleanup", DEMO_USER);
  expect(await repo.profile(DEMO_USER)).not.toBeNull();
});

it("serializes a phone-code refresh and cleanup so deletion progress cannot be overwritten", async () => {
  const agent = (await repo.agent(DEMO_USER))!;
  agent.status = "awaiting_phone";
  agent.phase = "phone";
  agent.phoneChallengeBox = undefined;
  await repo.saveAgent(agent);
  let entered!: () => void, release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const save = repo.saveAgent.bind(repo);
  vi.spyOn(repo, "saveAgent").mockImplementation(async (row) => {
    if (row.status === "awaiting_phone" && row.phoneChallengeBox) {
      entered();
      await gate;
    }
    await save(row);
  });
  const polling = call("/me");
  await waiting;
  let cleanupEntered = false;
  const cleanup = repo.locked(DEMO_USER, async () => {
    cleanupEntered = true;
    const current = (await repo.agent(DEMO_USER))!;
    current.status = "deleting";
    current.deletion = { instance: true, identity: false };
    await repo.saveAgent(current);
  });
  await Promise.resolve();
  expect(cleanupEntered).toBe(false);
  release();
  expect((await polling).status).toBe(200);
  await cleanup;
  expect((await repo.agent(DEMO_USER))!.status).toBe("deleting");
  expect((await repo.agent(DEMO_USER))!.deletion).toEqual({
    instance: true,
    identity: false,
  });
});

it("reconciles a successful stop whose reply was lost and does not stop twice", async () => {
  const stop = a37.stop.bind(a37);
  const spy = vi.spyOn(a37, "stop").mockImplementationOnce(async (id) => {
    await stop(id);
    throw new HttpError(503, "lost_reply", "Injected lost stop reply");
  });
  expect(
    (
      await call(`/operator/${DEMO_USER}/suspension`, "PUT", {
        suspended: true,
      })
    ).status,
  ).toBe(200);
  expect((await repo.agent(DEMO_USER))!.suspended).toBe(true);
  expect(dep.queue.send).toHaveBeenCalledWith("reconcile", DEMO_USER);
  await reconcile(dep, DEMO_USER);
  expect(spy).toHaveBeenCalledTimes(1);
});

it("fails closed during a lost pause request and resumes saved intent through reconciliation", async () => {
  vi.spyOn(a37, "stop").mockRejectedValueOnce(
    new HttpError(503, "unavailable", "Unavailable"),
  );
  expect(
    (
      await call(`/operator/${DEMO_USER}/suspension`, "PUT", {
        suspended: true,
      })
    ).status,
  ).toBe(502);
  expect((await repo.agent(DEMO_USER))!.suspensionOperation?.phase).toBe(
    "pending",
  );
  expect((await call("/responses", "POST", { input: "hello" })).status).toBe(
    403,
  );
  await reconcile(dep, DEMO_USER);
  expect((await repo.agent(DEMO_USER))!.suspended).toBe(true);
  const start = a37.start.bind(a37);
  vi.spyOn(a37, "start").mockImplementationOnce(async (id) => {
    await start(id);
    throw new HttpError(503, "lost_reply", "Lost reply");
  });
  expect(
    (
      await call(`/operator/${DEMO_USER}/suspension`, "PUT", {
        suspended: false,
      })
    ).status,
  ).toBe(200);
  expect((await repo.agent(DEMO_USER))!.suspended).toBe(false);
});

it("denies every workspace callback while suspended", async () => {
  const agent = (await repo.agent(DEMO_USER))!;
  agent.suspended = true;
  agent.callbackHash = hash("recovery-callback");
  await repo.saveAgent(agent);
  for (const command of ["list", "save", "notify"])
    expect(
      (
        await call(
          "/agent/workspace",
          "POST",
          {
            instance_id: agent.instanceId,
            event_id: randomUUID(),
            command,
            text: "Paused notification",
            item: { kind: "wiki", title: "Paused item" },
          },
          "recovery-callback",
        )
      ).status,
    ).toBe(403);
  expect(
    (await repo.notifications(DEMO_USER)).some(
      (note) => note.text === "Paused notification",
    ),
  ).toBe(false);
});

it("does not grant takeover when cancellation is acknowledged but the turn remains active", async () => {
  const agent = (await repo.agent(DEMO_USER))!;
  const session = await a37.session(agent.instanceId!, agent.mainSessionId!);
  session.active_response_id = "f".repeat(32);
  a37.histories.set(agent.mainSessionId!, session);
  vi.spyOn(a37, "cancel").mockResolvedValue();
  const response = await call("/computer/takeover", "POST");
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    error: { code: "cancellation_pending" },
  });
});

it("grants takeover only after cancellation completes and keeps chat starts serialized while waiting", async () => {
  const agent = (await repo.agent(DEMO_USER))!;
  const session = await a37.session(agent.instanceId!, agent.mainSessionId!);
  session.active_response_id = "f".repeat(32);
  a37.histories.set(agent.mainSessionId!, session);
  let cancelled!: () => void;
  const entered = new Promise<void>((resolve) => {
    cancelled = resolve;
  });
  vi.spyOn(a37, "cancel").mockImplementation(async () => {
    cancelled();
  });
  let waiting = false;
  const takeover = call("/computer/takeover", "POST").then((response) => {
    waiting = true;
    return response;
  });
  await entered;
  const responses = vi.spyOn(a37, "responses");
  const chat = call("/responses", "POST", {
    input: "After handoff",
    stream: false,
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(waiting).toBe(false);
  expect(responses).not.toHaveBeenCalled();
  session.active_response_id = null;
  a37.histories.set(agent.mainSessionId!, session);
  expect((await takeover).status).toBe(200);
  expect((await chat).status).toBe(200);
});

it("freezes onboarding once identity provisioning starts, preserving the configured whitelist", async () => {
  const profile = {
    ...(await repo.profile(DEMO_USER))!,
    id: DEMO_NEW_USER,
    email: "new@example.com",
  };
  await repo.saveProfile(profile);
  const rules = vi.spyOn(inkbox, "request");
  await lifecycle.provision(DEMO_NEW_USER, true);
  const initialRules = rules.mock.calls.filter(([path]) =>
    path.includes("contact-rules"),
  );
  expect(
    initialRules.some(
      ([, init]) =>
        JSON.parse(init!.body as string).match_target === profile.phone,
    ),
  ).toBe(true);
  expect(
    (
      await call(
        "/onboarding",
        "POST",
        { ...profile, phone: "+15195550124" },
        "demo-new",
      )
    ).status,
  ).toBe(409);
  expect((await repo.profile(DEMO_NEW_USER))!.phone).toBe(profile.phone);
  expect((await call("/onboarding/retry", "POST", {}, "demo-new")).status).toBe(
    202,
  );
});

it("retries a lost successful bootstrap reply with the same scoped credential and without requesting signing-key rotation", async () => {
  const profile = {
    ...(await repo.profile(DEMO_USER))!,
    id: DEMO_NEW_USER,
    email: "new@example.com",
  };
  await repo.saveProfile(profile);
  await lifecycle.provision(DEMO_NEW_USER);
  await lifecycle.verifyPhone(DEMO_NEW_USER);
  const exec = a37.exec.bind(a37);
  const request = vi.spyOn(inkbox, "request");
  let attempts = 0;
  vi.spyOn(a37, "exec").mockImplementation(async (id, command) => {
    const result = await exec(id, command);
    if (command.includes("inkbox bootstrap")) {
      expect(command).not.toContain("--rotate-signing-key");
      if (++attempts === 1) throw new Error("Lost successful bootstrap reply");
    }
    return result;
  });
  await expect(lifecycle.provision(DEMO_NEW_USER)).rejects.toThrow(
    "Lost successful bootstrap reply",
  );
  const interrupted = (await repo.agent(DEMO_NEW_USER))!;
  expect(interrupted.runtimeKeyBox).toBeTruthy();
  await lifecycle.provision(DEMO_NEW_USER);
  const completed = (await repo.agent(DEMO_NEW_USER))!;
  expect(completed.status).toBe("ready");
  expect(completed.runtimeKeyId).toBe(interrupted.runtimeKeyId);
  expect(
    request.mock.calls.filter(([path]) => path === "/api-keys"),
  ).toHaveLength(1);
  expect(attempts).toBe(2);
});
