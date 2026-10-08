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
let authUsers: { id: string; email: string; email_confirmed_at?: string }[],
  accountLookupFailed: boolean;
let authStatus: number, lifecycle: Lifecycle;
let authCreates: { email: string; email_confirm: boolean }[],
  authCreateStatus: number;
let authLinks: { type: string; email: string }[], authLinkStatus: number;
let signInEmail: ReturnType<
  typeof vi.fn<(input: InvitationEmail) => Promise<void>>
>;
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
    { id: operatorId, email: ownerEmail, email_confirmed_at: "verified" },
    { id: customerId, email: customerEmail, email_confirmed_at: "verified" },
  ];
  accountLookupFailed = false;
  userChecks = 0;
  authStatus = 200;
  authCreates = [];
  authCreateStatus = 200;
  authLinks = [];
  authLinkStatus = 200;
  // Exercise the live auth path with a local Supabase Auth endpoint, without provider side effects.
  auth = createServer((request, response) => {
    const url = new URL(request.url!, "http://localhost");
    if (url.pathname === "/auth/v1/admin/users" && request.method === "GET") {
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
    if (url.pathname === "/auth/v1/admin/users" && request.method === "POST") {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const input = JSON.parse(body);
        authCreates.push(input);
        const user = { id: randomUUID(), email: input.email };
        if (authCreateStatus === 200) authUsers.push(user);
        response.writeHead(authCreateStatus, {
          "Content-Type": "application/json",
        });
        response.end(
          JSON.stringify(
            authCreateStatus === 200
              ? user
              : { message: "Creation unavailable" },
          ),
        );
      });
      return;
    }
    if (
      url.pathname === "/auth/v1/admin/generate_link" &&
      request.method === "POST"
    ) {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const input = JSON.parse(body);
        authLinks.push(input);
        const user = authUsers.find((row) => row.email === input.email);
        response.writeHead(authLinkStatus, {
          "Content-Type": "application/json",
        });
        response.end(
          JSON.stringify(
            authLinkStatus === 200
              ? {
                  ...user,
                  hashed_token: `private-invite-hash-${authLinks.length}`,
                  verification_type: "invite",
                  action_link: "https://auth.example.com/private-link",
                }
              : { message: "Private Auth link error" },
          ),
        );
      });
      return;
    }
    userChecks++;
    if (authStatus !== 200) {
      response.writeHead(authStatus, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: "Auth temporarily unavailable" }));
      return;
    }
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
  queue = { send: vi.fn(async () => {}) };
  invitationEmail = vi.fn(async (_input: InvitationEmail) => {});
  signInEmail = vi.fn(async (_input: InvitationEmail) => {});
  const a37 = new DemoAgent37(),
    inkbox = new DemoInkbox();
  lifecycle = new Lifecycle(config, repo, a37, inkbox);
  server = createServer(
    createApp({
      config,
      repo,
      queue,
      invitationEmail,
      signInEmail,
      a37,
      inkbox,
      lifecycle,
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
async function call(
  path: string,
  token: string,
  body?: unknown,
  method = body ? "POST" : "GET",
) {
  return fetch(base + "/api" + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
it("does not erase an account that accepts its invitation while removal waits for the owner lease", async () => {
  const invitation = "concurrent-accept-removal-token";
  await repo.addBetaRequest(customerEmail);
  await repo.createInvitation(
    customerEmail,
    hash(invitation),
    new Date(Date.now() + 86400000).toISOString(),
  );
  let release!: () => void, entered!: () => void, cleanupWaiting!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const saving = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    cleanupWaiting = resolve;
  });
  const save = repo.saveProfile.bind(repo);
  vi.spyOn(repo, "saveProfile").mockImplementationOnce(async (profile) => {
    entered();
    await gate;
    await save(profile);
  });
  const locked = repo.locked.bind(repo);
  let ownerLeases = 0;
  vi.spyOn(repo, "locked").mockImplementation((owner, work) => {
    if (owner === customerId && ++ownerLeases === 2) cleanupWaiting();
    return locked(owner, work);
  });
  const accepting = call("/invitations/accept", "verified-customer", {
    invitation,
  });
  await saving;
  const removing = call(
    "/beta/requests",
    betaToken,
    { email: customerEmail },
    "DELETE",
  );
  await waiting;
  release();
  expect((await accepting).status).toBe(200);
  const response = await removing;
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    error: { code: "account_exists" },
  });
  expect(await repo.profile(customerId)).not.toBeNull();
  expect(await repo.agent(customerId)).toBeNull();
  expect(await repo.betaRequests()).toHaveLength(1);
  expect(queue.send).not.toHaveBeenCalled();
});

it("refuses ambiguous Auth owners instead of erasing whichever duplicate email was listed last", async () => {
  authUsers.push({
    id: randomUUID(),
    email: customerEmail,
    email_confirmed_at: "verified",
  });
  await repo.addBetaRequest(customerEmail);
  const remove = vi.spyOn(repo, "removeCustomer");
  const response = await call(
    "/beta/requests",
    betaToken,
    { email: customerEmail, closeAccount: true },
    "DELETE",
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    error: { code: "account_ownership_conflict" },
  });
  expect(remove).not.toHaveBeenCalled();
  expect(await repo.betaRequests()).toHaveLength(1);
});
it("rejects ambiguous sign-in and invitation approval even when the second email match is on another Auth page", async () => {
  authUsers.push(
    ...Array.from({ length: 998 }, (_, index) => ({
      id: randomUUID(),
      email: `unrelated-${index}@example.com`,
      email_confirmed_at: "verified",
    })),
    { id: randomUUID(), email: customerEmail, email_confirmed_at: "verified" },
  );
  await repo.addBetaRequest(customerEmail);
  const signin = await call("/auth/signin", "", { email: customerEmail });
  expect(signin.status).toBe(409);
  expect(await signin.json()).toMatchObject({
    error: { code: "account_ownership_conflict" },
  });
  const approval = await call("/beta/invitations", betaToken, {
    email: customerEmail,
  });
  expect(approval.status).toBe(409);
  expect(await approval.json()).toMatchObject({
    error: { code: "account_ownership_conflict" },
  });
  expect(authCreates).toEqual([]);
  expect(authLinks).toEqual([]);
  expect(signInEmail).not.toHaveBeenCalled();
  expect(invitationEmail).not.toHaveBeenCalled();
  expect(await repo.invitations()).toEqual([]);
});

it("recovers setup if the request died after saving the new agent but before queueing its first job", async () => {
  queue.send.mockRejectedValueOnce(
    new HttpError(503, "queue_unavailable", "Queue unavailable"),
  );
  expect((await call("/onboarding", "verified-owner", input)).status).toBe(502);
  expect(await repo.agent(operatorId)).toMatchObject({ status: "new" });
  queue.send.mockClear();
  expect((await call("/me", "verified-owner")).status).toBe(200);
  expect(queue.send).toHaveBeenCalledWith("provision", operatorId);
  expect(await repo.agent(operatorId)).toMatchObject({ status: "new" });
});
it.each([429, 500, 503])(
  "reports an Auth service %s failure as retryable without invalidating the account",
  async (status) => {
    await call("/onboarding", "verified-owner", input);
    const profile = await repo.profile(operatorId);
    authStatus = status;
    const response = await call("/me", "verified-owner");
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: "auth_unavailable" },
    });
    expect(await repo.profile(operatorId)).toEqual(profile);
    authStatus = 200;
    expect((await call("/me", "verified-owner")).status).toBe(200);
    expect((await call("/me", "invalid-token")).status).toBe(401);
  },
);

it("resumes verified phone setup after the provisioning queue fails", async () => {
  await call("/onboarding", "verified-owner", input);
  await lifecycle.provision(operatorId);
  queue.send.mockRejectedValueOnce(new Error("Queue temporarily unavailable"));
  expect(
    (await call("/onboarding/verify-phone", "verified-owner", {})).status,
  ).toBe(500);
  const me = await (await call("/me", "verified-owner")).json();
  expect(me.agent.status).toBe("provisioning");
  expect(me.agent.phoneVerifiedAt).toBeTruthy();
  expect(me.agent.phoneChallenge).toBeUndefined();
  expect(
    (await call("/onboarding/verify-phone", "verified-owner", {})).status,
  ).toBe(202);
  expect((await repo.agent(operatorId))!.phoneVerifiedAt).toBe(
    me.agent.phoneVerifiedAt,
  );
  expect(queue.send).toHaveBeenLastCalledWith("provision", operatorId);
});

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

it("rejects sign-in preparation for unknown, waitlisted, and Auth-only unapproved emails", async () => {
  await repo.addBetaRequest("waiting@example.com");
  for (const email of [
    "unknown@example.com",
    "waiting@example.com",
    customerEmail,
  ]) {
    const response = await call("/auth/signin", "", {
      email,
      invited: true,
      operator: true,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: {
        code: "invitation_required",
        message: expect.stringContaining("No sign-in email was sent."),
      },
    });
  }
  expect(authCreates).toEqual([]);
  expect(invitationEmail).not.toHaveBeenCalled();
  expect(authLinks).toEqual([]);
  expect(signInEmail).not.toHaveBeenCalled();
  expect(await repo.customers()).toEqual([]);
  expect(queue.send).not.toHaveBeenCalled();
});

it("sends admin invite sign-in links for a newly approved unverified account without granting a session or accepting beta", async () => {
  const email = "approved@example.com";
  await repo.addBetaRequest(email);
  expect((await call("/beta/invitations", betaToken, { email })).status).toBe(
    201,
  );
  const before = await repo.invitations();
  for (const value of [email, ` ${email.toUpperCase()} `]) {
    const response = await call("/auth/signin", "", { email: value });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ready: true, emailSent: true });
  }
  expect(authCreates).toEqual([{ email, email_confirm: false }]);
  expect(authLinks).toEqual([
    { email, type: "invite" },
    { email, type: "invite" },
  ]);
  expect(signInEmail).toHaveBeenCalledTimes(2);
  const link = new URL(signInEmail.mock.calls[0][0].url);
  expect(link.origin).toBe(config.webOrigin);
  expect(link.pathname).toBe("/auth/callback");
  expect(link.searchParams.get("type")).toBe("invite");
  expect(link.searchParams.get("token_hash")).toBe("private-invite-hash-1");
  expect(
    authUsers.find((row) => row.email === email)?.email_confirmed_at,
  ).toBeUndefined();
  expect(await repo.invitations()).toEqual(before);
  expect(await repo.customers()).toEqual([]);
  expect(queue.send).not.toHaveBeenCalled();
  expect(
    (await (await call("/beta/requests", betaToken)).json()).requests[0],
  ).toMatchObject({ status: "pending", accountExists: false });
});

it("permits accepted users and configured operators to sign in without creating new Auth users", async () => {
  await repo.createInvitation(
    customerEmail,
    hash("accepted-signin-token"),
    new Date(Date.now() + 86400000).toISOString(),
  );
  expect(
    (
      await call("/invitations/accept", "verified-customer", {
        invitation: "accepted-signin-token",
      })
    ).status,
  ).toBe(200);
  for (const email of [customerEmail, ownerEmail])
    expect((await call("/auth/signin", "", { email })).status).toBe(200);
  authUsers[1].email = "changed@example.com";
  expect(
    (await call("/auth/signin", "", { email: "changed@example.com" })).status,
  ).toBe(200);
  expect(authCreates).toEqual([]);
  expect(authLinks).toEqual([]);
  expect(signInEmail).not.toHaveBeenCalled();
});

it("recovers an existing unconfirmed invitee without confirming the address or recreating the Auth user", async () => {
  authUsers[1].email_confirmed_at = undefined;
  await repo.createInvitation(
    customerEmail,
    hash("unconfirmed-invite"),
    new Date(Date.now() + 86400000).toISOString(),
  );
  const response = await call("/auth/signin", "", { email: customerEmail });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ready: true, emailSent: true });
  expect(authCreates).toEqual([]);
  expect(authLinks).toEqual([{ email: customerEmail, type: "invite" }]);
  expect(signInEmail).toHaveBeenCalledOnce();
  expect(authUsers[1].email_confirmed_at).toBeUndefined();
  expect(await repo.customers()).toEqual([]);
});

it("keeps sign-in failures actionable when Auth link generation or email delivery fails", async () => {
  authUsers[1].email_confirmed_at = undefined;
  await repo.createInvitation(
    customerEmail,
    hash("retry-invite-link"),
    new Date(Date.now() + 86400000).toISOString(),
  );
  authLinkStatus = 500;
  const failed = await call("/auth/signin", "", { email: customerEmail });
  expect(failed.status).toBe(502);
  expect(await failed.json()).toMatchObject({
    error: { code: "auth_unavailable" },
  });
  expect(signInEmail).not.toHaveBeenCalled();
  authLinkStatus = 200;
  signInEmail.mockRejectedValueOnce(
    new HttpError(
      502,
      "signin_email_failed",
      "Couldn’t confirm sending your sign-in email. Please try again.",
    ),
  );
  expect(
    (await call("/auth/signin", "", { email: customerEmail })).status,
  ).toBe(502);
  expect(
    (await call("/auth/signin", "", { email: customerEmail })).status,
  ).toBe(200);
  expect(await repo.profile(customerId)).toBeNull();
  expect(authUsers[1].email_confirmed_at).toBeUndefined();
});

it("rejects expired or removed invitations at sign-in", async () => {
  const email = "expired@example.com";
  await repo.createInvitation(
    email,
    hash("expired-signin"),
    new Date(Date.now() - 1000).toISOString(),
  );
  expect((await call("/auth/signin", "", { email })).status).toBe(403);
  await repo.addBetaRequest(email);
  await repo.createInvitation(
    email,
    hash("active-signin"),
    new Date(Date.now() + 86400000).toISOString(),
  );
  expect(
    (await call("/beta/requests", betaToken, { email }, "DELETE")).status,
  ).toBe(200);
  expect((await call("/auth/signin", "", { email })).status).toBe(403);
  expect(authCreates).toEqual([]);
});

it("rejects sign-in while an accepted account is closing", async () => {
  await call("/onboarding", "verified-owner", input);
  await lifecycle.requestCleanup(operatorId);
  expect((await call("/auth/signin", "", { email: ownerEmail })).status).toBe(
    409,
  );
  expect(authCreates).toEqual([]);
});

it("reports sign-in lookup and account preparation failures without granting access", async () => {
  const email = "retry-signin@example.com";
  await repo.createInvitation(
    email,
    hash("retry-signin"),
    new Date(Date.now() + 86400000).toISOString(),
  );
  accountLookupFailed = true;
  expect((await call("/auth/signin", "", { email })).status).toBe(502);
  expect(authCreates).toEqual([]);
  accountLookupFailed = false;
  authCreateStatus = 500;
  expect((await call("/auth/signin", "", { email })).status).toBe(502);
  authCreateStatus = 200;
  expect((await call("/auth/signin", "", { email })).status).toBe(200);
  expect((await call("/auth/signin", "", { email: "invalid" })).status).toBe(
    400,
  );
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
  await repo.claimInvitation(customerId, customerEmail, hash("old-invite"));
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

it("requires the beta token to remove requests and validates the email", async () => {
  await repo.addBetaRequest(customerEmail);
  const before = await repo.betaRequests();
  for (const token of [
    "",
    "invalid-token",
    "verified-owner",
    "verified-customer",
  ])
    expect(
      (await call("/beta/requests", token, { email: customerEmail }, "DELETE"))
        .status,
    ).toBe(401);
  expect(
    (await call("/beta/requests", betaToken, { email: "invalid" }, "DELETE"))
      .status,
  ).toBe(400);
  expect(await repo.betaRequests()).toEqual(before);
  expect(userChecks).toBe(0);
});

it("removes only a selected request without an account and permits retries and rejoining", async () => {
  const selected = "remove@example.com";
  await repo.addBetaRequest(selected);
  await repo.addBetaRequest(customerEmail);
  await repo.createInvitation(
    selected,
    hash("keep-invitation"),
    new Date(Date.now() + 86400000).toISOString(),
  );
  for (const email of [` ${selected.toUpperCase()} `, selected]) {
    const response = await call(
      "/beta/requests",
      betaToken,
      { email },
      "DELETE",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      email: selected,
      removed: true,
      queued: false,
    });
  }
  expect(await repo.betaRequests()).toEqual([
    expect.objectContaining({ email: customerEmail }),
  ]);
  expect(await repo.invitations()).toEqual([]);
  expect(invitationEmail).not.toHaveBeenCalled();
  expect((await call("/beta", "", { email: selected })).status).toBe(202);
  expect(await repo.betaRequests()).toHaveLength(2);
});

it("closes an accepted customer's account through provider cleanup before removing their beta entry", async () => {
  await repo.addBetaRequest(customerEmail);
  await repo.addBetaRequest("keep@example.com");
  await repo.createInvitation(
    customerEmail,
    hash("accepted-removal-token"),
    new Date(Date.now() + 86400000).toISOString(),
  );
  expect(
    (
      await call("/invitations/accept", "verified-customer", {
        invitation: "accepted-removal-token",
      })
    ).status,
  ).toBe(200);
  await call("/onboarding", "verified-customer", input);
  await lifecycle.provision(customerId);
  await lifecycle.verifyPhone(customerId);
  await lifecycle.provision(customerId);
  queue.send.mockClear();
  expect(
    (
      await call(
        "/beta/requests",
        betaToken,
        { email: customerEmail },
        "DELETE",
      )
    ).status,
  ).toBe(409);
  expect(queue.send).not.toHaveBeenCalled();
  const response = await call(
    "/beta/requests",
    betaToken,
    { email: customerEmail, closeAccount: true },
    "DELETE",
  );
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({
    email: customerEmail,
    removed: false,
    queued: true,
  });
  expect(queue.send).toHaveBeenCalledWith("cleanup", customerId);
  expect(await repo.agent(customerId)).toMatchObject({ status: "deleting" });
  expect(await repo.profile(customerId)).not.toBeNull();
  expect(await repo.betaRequests()).toHaveLength(2);
  expect(
    (await (await call("/beta/requests", betaToken)).json()).requests[0],
  ).toMatchObject({ accountClosing: true });
  vi.spyOn(lifecycle.a37, "removeInstance").mockRejectedValueOnce(
    new Error("Provider unavailable"),
  );
  await expect(lifecycle.cleanup(customerId)).rejects.toThrow(
    "Provider unavailable",
  );
  expect(await repo.betaRequests()).toHaveLength(2);
  expect(
    (
      await call(
        "/beta/requests",
        betaToken,
        { email: customerEmail, closeAccount: true },
        "DELETE",
      )
    ).status,
  ).toBe(202);
  await lifecycle.cleanup(customerId);
  expect(await repo.profile(customerId)).toBeNull();
  expect(await repo.agent(customerId)).toBeNull();
  expect(await repo.betaRequests()).toEqual([
    expect.objectContaining({ email: "keep@example.com" }),
  ]);
});

it("retains the beta entry and makes account closure retryable when queue dispatch fails", async () => {
  await call("/onboarding", "verified-owner", input);
  await repo.addBetaRequest(ownerEmail);
  queue.send.mockRejectedValueOnce(new Error("Queue unavailable"));
  expect(
    (
      await call(
        "/beta/requests",
        betaToken,
        { email: ownerEmail, closeAccount: true },
        "DELETE",
      )
    ).status,
  ).toBe(500);
  expect(await repo.profile(operatorId)).not.toBeNull();
  expect(await repo.betaRequests()).toHaveLength(1);
  expect(await repo.agent(operatorId)).toMatchObject({ status: "deleting" });
  expect(
    (
      await call(
        "/beta/requests",
        betaToken,
        { email: ownerEmail, closeAccount: true },
        "DELETE",
      )
    ).status,
  ).toBe(202);
  await lifecycle.cleanup(operatorId);
  expect(await repo.betaRequests()).toEqual([]);
});

it("fails removal safely if account lookup is unavailable", async () => {
  await repo.addBetaRequest(customerEmail);
  accountLookupFailed = true;
  expect(
    (
      await call(
        "/beta/requests",
        betaToken,
        { email: customerEmail, closeAccount: true },
        "DELETE",
      )
    ).status,
  ).toBe(502);
  expect(await repo.betaRequests()).toHaveLength(1);
  expect(queue.send).not.toHaveBeenCalled();
});

it("finds the accepted account by invitation ownership after its Auth email changes", async () => {
  await call("/onboarding", "verified-owner", input);
  const email = "old-owner@example.com";
  await repo.addBetaRequest(email);
  await repo.createInvitation(
    email,
    hash("old-owner-token"),
    new Date(Date.now() + 86400000).toISOString(),
  );
  await repo.claimInvitation(operatorId, email, hash("old-owner-token"));
  expect(
    (
      await call(
        "/beta/requests",
        betaToken,
        { email, closeAccount: true },
        "DELETE",
      )
    ).status,
  ).toBe(202);
  expect(queue.send).toHaveBeenLastCalledWith("cleanup", operatorId);
  await lifecycle.cleanup(operatorId);
  expect(await repo.betaRequests()).toEqual([]);
});

it("closes an Auth-only account without creating an orphan companion or dispatching a job", async () => {
  await repo.addBetaRequest(customerEmail);
  const remove = vi.spyOn(repo, "removeCustomer");
  expect(
    (
      await call(
        "/beta/requests",
        betaToken,
        { email: customerEmail, closeAccount: true },
        "DELETE",
      )
    ).status,
  ).toBe(200);
  expect(remove).toHaveBeenCalledWith(customerId);
  expect(await repo.betaRequests()).toEqual([]);
  expect(await repo.agent(customerId)).toBeNull();
  expect(queue.send).not.toHaveBeenCalled();
});

it("refuses to close accounts when the request email belongs to two current owners", async () => {
  await repo.addBetaRequest(customerEmail);
  await repo.createInvitation(
    customerEmail,
    hash("ambiguous-owner"),
    new Date(Date.now() + 86400000).toISOString(),
  );
  await repo.claimInvitation(
    operatorId,
    customerEmail,
    hash("ambiguous-owner"),
  );
  const remove = vi.spyOn(repo, "removeCustomer");
  const response = await call(
    "/beta/requests",
    betaToken,
    { email: customerEmail, closeAccount: true },
    "DELETE",
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    error: { code: "account_ownership_conflict" },
  });
  expect(remove).not.toHaveBeenCalled();
  expect(queue.send).not.toHaveBeenCalled();
  expect(await repo.betaRequests()).toHaveLength(1);
});

it("does not close unrelated accounts that have no beta request", async () => {
  await call("/onboarding", "verified-owner", input);
  queue.send.mockClear();
  expect(
    (
      await call(
        "/beta/requests",
        betaToken,
        { email: ownerEmail, closeAccount: true },
        "DELETE",
      )
    ).status,
  ).toBe(200);
  expect(await repo.profile(operatorId)).not.toBeNull();
  expect(await repo.agent(operatorId)).toMatchObject({ status: "new" });
  expect(queue.send).not.toHaveBeenCalled();
});

it("serializes removal after an in-flight approval so the request cannot be recreated by the send", async () => {
  const email = "removing@example.com";
  await repo.addBetaRequest(email);
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sending = new Promise<void>((resolve) => {
    started = resolve;
  });
  invitationEmail.mockImplementationOnce(async () => {
    started();
    await gate;
  });
  const approval = call("/beta/invitations", betaToken, { email });
  await sending;
  const remove = vi.spyOn(repo, "removeBetaRequest");
  const received = new Promise<void>((resolve) =>
    server.once("request", () => resolve()),
  );
  const removal = call("/beta/requests", betaToken, { email }, "DELETE");
  await received;
  expect(remove).not.toHaveBeenCalled();
  release();
  expect((await approval).status).toBe(201);
  expect((await removal).status).toBe(200);
  expect(remove).toHaveBeenCalledWith(email);
  expect(await repo.betaRequests()).toEqual([]);
});

it("allows approval of an Auth-only user who has never accepted an invitation", async () => {
  await call("/beta", "", { email: customerEmail });
  expect(await repo.profile(customerId)).toBeNull();
  const response = await call("/beta/invitations", betaToken, {
    email: ` ${customerEmail.toUpperCase()} `,
  });
  expect(response.status).toBe(201);
  expect(await repo.invitations()).toHaveLength(1);
  expect(invitationEmail).toHaveBeenCalledOnce();
  const requests = (await (await call("/beta/requests", betaToken)).json())
    .requests;
  expect(requests[0]).toMatchObject({
    status: "pending",
    accountExists: false,
  });
});

it("can approve a new Auth-only owner after the previous account was deleted", async () => {
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
  ).toBe(201);
  expect(invitationEmail).toHaveBeenCalledOnce();
  const data = await (await call("/beta/requests", betaToken)).json();
  expect(data.requests[0]).toMatchObject({
    email: customerEmail,
    status: "pending",
    accountExists: false,
  });
});

it("checks every Auth page before inviting and fails closed if account lookup is unavailable", async () => {
  await repo.addBetaRequest(customerEmail);
  await repo.createInvitation(
    customerEmail,
    hash("enrolled-customer"),
    new Date(Date.now() + 86400000).toISOString(),
  );
  await repo.claimInvitation(
    customerId,
    customerEmail,
    hash("enrolled-customer"),
  );
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
  expect(await repo.invitations()).toHaveLength(1);
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

it("approval retries reuse the registered invitation and stop after delivery or invitation acceptance", async () => {
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
  ).toBe(201);
  expect(invitationEmail).toHaveBeenCalledTimes(2);
  expect(
    (await call("/invitations/accept", "verified-customer", {})).status,
  ).toBe(200);
  expect(
    (await call("/beta/invitations", betaToken, { email: customerEmail }))
      .status,
  ).toBe(409);
  list = await (await call("/beta/requests", betaToken)).json();
  expect(list.requests[0]).toMatchObject({
    status: "accepted",
    accountExists: true,
  });
});
