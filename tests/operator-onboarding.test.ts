import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { createApp } from "../services/control-plane/src/app";
import { loadConfig, type Config } from "../services/control-plane/src/config";
import { DemoAgent37, DemoInkbox } from "../services/control-plane/src/demo";
import { MemoryRepository } from "../services/control-plane/src/repository";
import { Lifecycle } from "../services/control-plane/src/lifecycle";
import { hash } from "../services/control-plane/src/security";
import { HttpError } from "../services/control-plane/src/security";
import type { InvitationEmail } from "../services/control-plane/src/invitations";

const operatorId = randomUUID(),
  customerId = randomUUID();
const ownerEmail = "owner@example.com",
  customerEmail = "customer@example.com";
const betaToken = "beta-access-fixture-token";
let config: Config, userChecks: number;
let auth: Server, server: Server, base: string, repo: MemoryRepository;
let queue: { send: ReturnType<typeof vi.fn> };
let invitationEmail: ReturnType<
  typeof vi.fn<(input: InvitationEmail) => Promise<void>>
>;
let authUsers: { id: string; email: string }[], accountLookupFailed: boolean;
const input = {
  name: "Owner",
  agentName: "Fern",
  avatar: "sprout",
  color: "#7659e8",
  phone: "+1 (519) 555-0123",
  timezone: "America/Toronto",
  personality: "Thoughtful",
  preferences: "",
};
async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
beforeEach(async () => {
  authUsers = [
    { id: operatorId, email: ownerEmail },
    { id: customerId, email: customerEmail },
  ];
  accountLookupFailed = false;
  userChecks = 0;
  // Exercise the live auth path with a local Supabase Auth endpoint, without provider side effects.
  auth = createServer((request, response) => {
    const url = new URL(request.url!, "http://localhost");
    if (url.pathname === "/auth/v1/admin/users") {
      if (request.headers.authorization !== "Bearer test-service-key") {
        response.writeHead(401);
        response.end();
        return;
      }
      response.writeHead(accountLookupFailed ? 500 : 200, {
        "Content-Type": "application/json",
      });
      const page = Number(url.searchParams.get("page"));
      response.end(
        JSON.stringify(
          accountLookupFailed
            ? { message: "Unavailable" }
            : {
                users: authUsers.slice((page - 1) * 1000, page * 1000),
                aud: "authenticated",
              },
        ),
      );
      return;
    }
    userChecks++;
    const token = request.headers.authorization?.replace("Bearer ", "");
    const owner = token === "verified-owner" || token === "unverified-owner";
    const known = owner || token === "verified-customer";
    response.writeHead(known ? 200 : 401, {
      "Content-Type": "application/json",
    });
    response.end(
      JSON.stringify(
        known
          ? {
              id: owner ? operatorId : customerId,
              email: owner ? ownerEmail : customerEmail,
              email_confirmed_at:
                token === "unverified-owner"
                  ? undefined
                  : new Date().toISOString(),
              aud: "authenticated",
              role: "authenticated",
              app_metadata: {},
              user_metadata: {},
              created_at: new Date().toISOString(),
            }
          : { message: "Invalid token" },
      ),
    );
  });
  config = {
    ...loadConfig({ DEMO_MODE: "true" }),
    demo: false,
    supabaseUrl: await listen(auth),
    supabaseKey: "test-service-key",
    encryptionKey: "a".repeat(64),
    operators: [ownerEmail],
    resendKey: "test-resend-key",
    invitationFrom: "invites@example.com",
    betaAccessToken: betaToken,
  };
  repo = new MemoryRepository();
  queue = { send: vi.fn() };
  invitationEmail = vi.fn(async (_input: InvitationEmail) => {});
  const a37 = new DemoAgent37(),
    inkbox = new DemoInkbox();
  server = createServer(
    createApp({
      config,
      repo,
      queue,
      invitationEmail,
      a37,
      inkbox,
      lifecycle: new Lifecycle(config, repo, a37, inkbox),
    }),
  );
  base = await listen(server);
});
afterEach(async () => {
  for (const running of [server, auth]) {
    running.closeAllConnections();
    await new Promise<void>((resolve) => running.close(() => resolve()));
  }
});
async function call(path: string, token: string, body?: unknown) {
  return fetch(base + "/api" + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
it("enrolls only the verified operator without requiring a customer invitation", async () => {
  expect((await call("/onboarding", "verified-owner", input)).status).toBe(202);
  expect(await repo.profile(operatorId)).toMatchObject({
    id: operatorId,
    email: ownerEmail,
    phone: "+15195550123",
  });
  expect(await repo.agent(operatorId)).toMatchObject({
    ownerId: operatorId,
    status: "new",
  });
  expect(queue.send).toHaveBeenCalledWith("provision", operatorId);
  expect((await call("/onboarding", "unverified-owner", input)).status).toBe(
    401,
  );
  expect(
    (
      await call("/onboarding", "verified-customer", {
        ...input,
        operator: true,
        email: ownerEmail,
      })
    ).status,
  ).toBe(403);
  expect(await repo.profile(customerId)).toBeNull();
});
it("allows an invited customer to enroll but gives them no invitation authority", async () => {
  await repo.createInvitation(
    customerEmail,
    hash("invitation-token-for-test"),
    new Date(Date.now() + 60_000).toISOString(),
  );
  expect(
    (
      await call("/invitations/accept", "verified-customer", {
        invitation: "invitation-token-for-test",
      })
    ).status,
  ).toBe(200);
  expect((await call("/onboarding", "verified-customer", input)).status).toBe(
    202,
  );
  expect(
    (
      await call("/beta/invitations", "verified-customer", {
        email: "invitee@example.com",
        operator: true,
      })
    ).status,
  ).toBe(401);
  expect((await call("/operator", "verified-customer")).status).toBe(403);
  expect((await (await call("/me", "verified-customer")).json()).operator).toBe(
    false,
  );
});
it.each([
  "",
  "wrong-token",
  "verified-owner",
  "unverified-owner",
  "verified-customer",
])(
  "requires the beta secret rather than a user account credential (%s)",
  async (credential) => {
    await repo.addBetaRequest("waiting@example.com");
    expect((await call("/beta/requests", credential)).status).toBe(401);
    expect(
      (
        await call("/beta/invitations", credential, {
          email: "waiting@example.com",
        })
      ).status,
    ).toBe(401);
    expect(invitationEmail).not.toHaveBeenCalled();
    expect(userChecks).toBe(0);
  },
);

it("opens the list with the environment token without authenticating a user, and ignores URL tokens", async () => {
  await repo.addBetaRequest("waiting@example.com");
  const response = await call("/beta/requests", betaToken);
  expect(response.status).toBe(200);
  expect((await response.json()).requests).toEqual([
    expect.objectContaining({
      email: "waiting@example.com",
      status: "awaiting_review",
    }),
  ]);
  expect((await call(`/beta/requests?token=${betaToken}`, "")).status).toBe(
    401,
  );
  expect(userChecks).toBe(0);
  expect(await repo.customers()).toHaveLength(0);
});

it("fails closed when the environment token is absent and invalidates a rotated token", async () => {
  config.betaAccessToken = "";
  for (const response of [
    await call("/beta/requests", betaToken),
    await call("/beta/invitations", betaToken, { email: customerEmail }),
  ]) {
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: "beta_not_configured" },
    });
  }
  config.betaAccessToken = "rotated-beta-access-token";
  expect((await call("/beta/requests", betaToken)).status).toBe(401);
  expect((await call("/beta/requests", config.betaAccessToken)).status).toBe(
    200,
  );
  expect(invitationEmail).not.toHaveBeenCalled();
});

it("retires the account-authenticated beta and manual invitation APIs", async () => {
  for (const path of [
    "/operator/invitations",
    "/operator/invitations/send",
    "/operator/beta",
  ])
    expect(
      (await call(path, "verified-owner", { email: "waiting@example.com" }))
        .status,
    ).toBe(404);
  expect((await call("/operator/invitations", "verified-owner")).status).toBe(
    404,
  );
  expect(await repo.betaRequests()).toHaveLength(0);
  expect(await repo.invitations()).toHaveLength(0);
  expect(invitationEmail).not.toHaveBeenCalled();
});

it("lists only beta request records, with one row per email and no invitation credentials", async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  await repo.addBetaRequest(customerEmail);
  await repo.addBetaRequest("waiting@example.com");
  await repo.createInvitation(customerEmail, hash("old-invite"), future);
  await repo.createInvitation(customerEmail, hash("new-invite"), future);
  await repo.createInvitation(
    "not-requested@example.com",
    hash("not-requested"),
    future,
  );
  const response = await call("/beta/requests", betaToken);
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.requests).toEqual([
    expect.objectContaining({
      email: customerEmail,
      status: "pending",
      accountExists: true,
    }),
    expect.objectContaining({
      email: "waiting@example.com",
      status: "awaiting_review",
      accountExists: false,
    }),
  ]);
  expect(JSON.stringify(data)).not.toMatch(
    /invitationBox|token_hash|approvedBy|usedBy/,
  );
});

it("public beta signup normalizes and deduplicates concurrent requests without resetting review or creating access", async () => {
  const responses = await Promise.all(
    [`  ${customerEmail.toUpperCase()} `, customerEmail, customerEmail].map(
      (email) => call("/beta", "", { email }),
    ),
  );
  for (const response of responses) {
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ saved: true });
  }
  const original = (await repo.betaRequests())[0];
  const approved = { ...original, approvedAt: "2026-01-01T00:00:00Z" };
  await repo.saveBetaRequest(approved);
  expect(
    (await call("/beta", "", { email: customerEmail.toUpperCase() })).status,
  ).toBe(202);
  expect(await repo.betaRequests()).toEqual([approved]);
  expect(await repo.invitations()).toHaveLength(0);
  expect(await repo.customers()).toHaveLength(0);
  expect(queue.send).not.toHaveBeenCalled();
  expect(invitationEmail).not.toHaveBeenCalled();
  expect(
    (await call("/invitations/accept", "verified-customer", {})).status,
  ).toBe(403);
  expect((await call("/beta", "", { email: "invalid" })).status).toBe(400);
  await call("/beta", "", { email: "bot@example.com", website: "spam" });
  expect(await repo.betaRequests()).toHaveLength(1);
});

it("requires an actual beta request before approving an invitation", async () => {
  expect(
    (
      await call("/beta/invitations", betaToken, {
        email: "not-requested@example.com",
      })
    ).status,
  ).toBe(404);
  expect(
    (await call("/beta/invitations", betaToken, { email: "invalid" })).status,
  ).toBe(400);
  expect(await repo.betaRequests()).toHaveLength(0);
  expect(await repo.invitations()).toHaveLength(0);
  expect(invitationEmail).not.toHaveBeenCalled();
});

it("refuses to invite an existing Auth user who has never enrolled in the application", async () => {
  await call("/beta", "", { email: customerEmail });
  expect(await repo.profile(customerId)).toBeNull();
  const before = await repo.betaRequests();
  const response = await call("/beta/invitations", betaToken, {
    email: ` ${customerEmail.toUpperCase()} `,
  });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    error: { code: "account_exists" },
  });
  expect(await repo.betaRequests()).toEqual(before);
  expect(await repo.invitations()).toHaveLength(0);
  expect(invitationEmail).not.toHaveBeenCalled();
});

it("blocks re-inviting a deleted customer's email if a new Auth account now uses it", async () => {
  await repo.addBetaRequest(customerEmail);
  await repo.createInvitation(
    customerEmail,
    hash("deleted-owner-invite"),
    new Date(Date.now() + 86400000).toISOString(),
  );
  await repo.claimInvitation(
    randomUUID(),
    customerEmail,
    hash("deleted-owner-invite"),
  );
  expect(
    (await call("/beta/invitations", betaToken, { email: customerEmail }))
      .status,
  ).toBe(409);
  expect(invitationEmail).not.toHaveBeenCalled();
  const data = await (await call("/beta/requests", betaToken)).json();
  expect(data.requests[0]).toMatchObject({
    email: customerEmail,
    status: "accepted",
    accountExists: true,
  });
});

it("checks every Auth page before inviting and fails closed if account lookup is unavailable", async () => {
  await repo.addBetaRequest(customerEmail);
  authUsers = [
    ...Array.from({ length: 1000 }, (_, index) => ({
      id: randomUUID(),
      email: `fixture${index}@example.com`,
    })),
    { id: customerId, email: customerEmail },
  ];
  expect(
    (await (await call("/beta/requests", betaToken)).json()).requests[0],
  ).toMatchObject({ accountExists: true });
  expect(
    (await call("/beta/invitations", betaToken, { email: customerEmail }))
      .status,
  ).toBe(409);
  accountLookupFailed = true;
  for (const response of [
    await call("/beta/requests", betaToken),
    await call("/beta/invitations", betaToken, { email: customerEmail }),
  ]) {
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: "account_lookup_failed" },
    });
  }
  expect(await repo.invitations()).toHaveLength(0);
  expect(invitationEmail).not.toHaveBeenCalled();
});

it("rejects an active legacy invitation instead of sending a second one", async () => {
  const email = "legacy@example.com";
  await repo.addBetaRequest(email);
  await repo.createInvitation(
    email,
    hash("legacy-invitation"),
    new Date(Date.now() + 86400000).toISOString(),
  );
  const response = await call("/beta/invitations", betaToken, { email });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    error: { code: "invitation_pending" },
  });
  expect(invitationEmail).not.toHaveBeenCalled();
  expect(await repo.invitations()).toHaveLength(1);
});

it("serializes simultaneous approvals and sends a single registered invitation", async () => {
  const email = "simultaneous@example.com";
  await repo.addBetaRequest(email);
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const deliveryStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  invitationEmail.mockImplementation(async ({ digest, url }) => {
    expect(hash(new URL(url).searchParams.get("invite")!)).toBe(digest);
    expect(await repo.invitations()).toHaveLength(1);
    started();
    await gate;
  });
  const requests = Array.from({ length: 3 }, () =>
    call("/beta/invitations", betaToken, { email }),
  );
  try {
    await deliveryStarted;
    release();
    for (const response of await Promise.all(requests))
      expect(response.status).toBe(201);
    expect(invitationEmail).toHaveBeenCalledTimes(1);
    expect(await repo.invitations()).toHaveLength(1);
    expect((await repo.betaRequests())[0].sentAt).toBeDefined();
  } finally {
    release();
  }
});

it("approval retries reuse the registered invitation and stop after delivery or account creation", async () => {
  authUsers = authUsers.filter((user) => user.id !== customerId);
  await call("/beta", "", { email: customerEmail });
  invitationEmail.mockRejectedValueOnce(
    new HttpError(502, "invitation_email_failed", "Interrupted"),
  );
  expect(
    (await call("/beta/invitations", betaToken, { email: customerEmail }))
      .status,
  ).toBe(502);
  let list = await (await call("/beta/requests", betaToken)).json();
  expect(list.requests[0]).toMatchObject({
    status: "approved",
    accountExists: false,
  });
  expect(JSON.stringify(list)).not.toMatch(
    /invitationBox|token_hash|approvedBy/,
  );
  expect(
    (await call("/beta/invitations", betaToken, { email: customerEmail }))
      .status,
  ).toBe(201);
  expect(invitationEmail.mock.calls[0][0]).toEqual(
    invitationEmail.mock.calls[1][0],
  );
  expect(new URL(invitationEmail.mock.calls[1][0].url).pathname).toBe(
    "/signin",
  );
  expect(await repo.invitations()).toHaveLength(1);
  expect(
    (await call("/beta/invitations", betaToken, { email: customerEmail }))
      .status,
  ).toBe(201);
  expect(invitationEmail).toHaveBeenCalledTimes(2);
  authUsers.push({ id: customerId, email: customerEmail });
  expect(
    (await call("/beta/invitations", betaToken, { email: customerEmail }))
      .status,
  ).toBe(409);
  expect(invitationEmail).toHaveBeenCalledTimes(2);
  expect(
    (await call("/invitations/accept", "verified-customer", {})).status,
  ).toBe(200);
  list = await (await call("/beta/requests", betaToken)).json();
  expect(list.requests[0]).toMatchObject({
    status: "accepted",
    accountExists: true,
  });
});
