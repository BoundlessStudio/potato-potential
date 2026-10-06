import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { createApp } from "../services/control-plane/src/app";
import { loadConfig } from "../services/control-plane/src/config";
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
  const config = {
    ...loadConfig({ DEMO_MODE: "true" }),
    demo: false,
    supabaseUrl: await listen(auth),
    supabaseKey: "test-service-key",
    encryptionKey: "a".repeat(64),
    operators: [ownerEmail],
    resendKey: "test-resend-key",
    invitationFrom: "invites@example.com",
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
      await call("/operator/invitations", "verified-customer", {
        email: "invitee@example.com",
        operator: true,
      })
    ).status,
  ).toBe(403);
  expect((await call("/operator", "verified-customer")).status).toBe(403);
  expect((await (await call("/me", "verified-customer")).json()).operator).toBe(
    false,
  );
});
it("restricts invitation creation to the verified configured operator", async () => {
  expect(
    (
      await call("/operator/invitations", "unverified-owner", {
        email: "invitee@example.com",
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await call("/operator/invitations", "verified-customer", {
        email: "invitee@example.com",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await call("/operator/invitations", "verified-owner", {
        email: "invitee@example.com",
      })
    ).status,
  ).toBe(201);
  expect((await repo.invitations()).length).toBe(1);
});
it("only the verified operator can email invitations, registered before sending", async () => {
  for (const [credential, status] of [
    ["unverified-owner", 401],
    ["verified-customer", 403],
  ] as const) {
    expect(
      (
        await call("/operator/invitations/send", credential, {
          email: customerEmail,
        })
      ).status,
    ).toBe(status);
    expect((await call("/operator/invitations", credential)).status).toBe(
      status,
    );
  }
  expect(invitationEmail).not.toHaveBeenCalled();
  expect(
    (
      await call("/operator/invitations/send", "verified-owner", {
        email: "not an email",
      })
    ).status,
  ).toBe(400);
  invitationEmail.mockImplementation(async ({ email, url, digest }) => {
    expect(email).toBe(customerEmail);
    const invitation = new URL(url).searchParams.get("invite")!;
    expect(hash(invitation)).toBe(digest);
    expect(await repo.invitations()).toEqual([
      expect.objectContaining({ email }),
    ]);
  });
  const response = await call("/operator/invitations/send", "verified-owner", {
    email: `  ${customerEmail.toUpperCase()}  `,
  });
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({
    email: customerEmail,
    sent: true,
  });
  expect(invitationEmail).toHaveBeenCalledTimes(1);
  const invitation = new URL(
    invitationEmail.mock.calls[0][0].url,
  ).searchParams.get("invite")!;
  expect(
    (await call("/invitations/accept", "verified-owner", { invitation }))
      .status,
  ).toBe(403);
  expect(
    (await call("/invitations/accept", "verified-customer", { invitation }))
      .status,
  ).toBe(200);
});
it("reports acceptance separately from current Auth accounts and groups repeated invites", async () => {
  const future = new Date(Date.now() + 60_000).toISOString(),
    past = new Date(Date.now() - 60_000).toISOString();
  await repo.createInvitation(customerEmail, hash("old-invite"), future);
  await repo.claimInvitation(customerId, customerEmail, hash("old-invite"));
  await repo.createInvitation(customerEmail, hash("new-invite"), future);
  await repo.createInvitation(ownerEmail, hash("existing-account"), future);
  await repo.createInvitation("expired@example.com", hash("expired"), past);
  authUsers = authUsers.filter((user) => user.id !== customerId);
  const response = await call("/operator/invitations", "verified-owner");
  expect(response.status).toBe(200);
  expect((await response.json()).invitations).toEqual([
    expect.objectContaining({
      email: customerEmail,
      status: "pending",
      accountExists: false,
    }),
    expect.objectContaining({
      email: ownerEmail,
      status: "pending",
      accountExists: true,
    }),
    expect.objectContaining({
      email: "expired@example.com",
      status: "expired",
      accountExists: false,
    }),
  ]);
});
it("lets operators re-invite a deleted customer even when a new Auth account uses the same email", async () => {
  const oldOwner = randomUUID();
  await repo.createInvitation(
    customerEmail,
    hash("deleted-owner-invite"),
    new Date(Date.now() + 86400000).toISOString(),
  );
  await repo.claimInvitation(
    oldOwner,
    customerEmail,
    hash("deleted-owner-invite"),
  );
  const listed = await (
    await call("/operator/invitations", "verified-owner")
  ).json();
  expect(listed.invitations[0]).toMatchObject({
    email: customerEmail,
    status: "accepted",
    accountExists: true,
    canReinvite: true,
  });
  expect(
    (
      await call("/operator/invitations/send", "verified-owner", {
        email: customerEmail,
      })
    ).status,
  ).toBe(201);
  expect(
    (await call("/invitations/accept", "verified-customer", {})).status,
  ).toBe(200);
  expect(
    (
      await call("/operator/invitations/send", "verified-owner", {
        email: customerEmail,
      })
    ).status,
  ).toBe(409);
});
it("looks past the first Auth page and fails clearly if account lookup is unavailable", async () => {
  await repo.createInvitation(
    customerEmail,
    hash("page-two"),
    new Date(Date.now() + 60_000).toISOString(),
  );
  authUsers = [
    ...Array.from({ length: 1000 }, (_, index) => ({
      id: randomUUID(),
      email: `fixture${index}@example.com`,
    })),
    { id: customerId, email: customerEmail },
  ];
  expect(
    (await (await call("/operator/invitations", "verified-owner")).json())
      .invitations[0],
  ).toMatchObject({ accountExists: true });
  accountLookupFailed = true;
  const response = await call("/operator/invitations", "verified-owner");
  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({
    error: { code: "account_lookup_failed" },
  });
});
it("retains the invitation and returns a failure when email sending cannot be confirmed", async () => {
  invitationEmail.mockRejectedValue(
    new HttpError(
      502,
      "invitation_email_failed",
      "Sending could not be confirmed.",
    ),
  );
  const response = await call("/operator/invitations/send", "verified-owner", {
    email: customerEmail,
  });
  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({
    error: { code: "invitation_email_failed" },
  });
  expect(await repo.invitations()).toHaveLength(1);
});
it("public beta signup normalizes and deduplicates emails without granting access or sending mail", async () => {
  for (const email of [`  ${customerEmail.toUpperCase()} `, customerEmail]) {
    const response = await call("/beta", "", { email });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ saved: true });
  }
  expect(await repo.betaRequests()).toEqual([
    expect.objectContaining({ email: customerEmail }),
  ]);
  expect(await repo.invitations()).toHaveLength(0);
  expect(await repo.customers()).toHaveLength(0);
  expect(queue.send).not.toHaveBeenCalled();
  expect(invitationEmail).not.toHaveBeenCalled();
  expect(
    (await call("/invitations/accept", "verified-customer", {})).status,
  ).toBe(403);
  expect((await call("/onboarding", "verified-customer", input)).status).toBe(
    403,
  );
  expect((await call("/beta", "", { email: "invalid" })).status).toBe(400);
  await call("/beta", "", { email: "bot@example.com", website: "spam" });
  expect(await repo.betaRequests()).toHaveLength(1);
});
it("only the operator reviews requests and adding an email never sends an invitation", async () => {
  expect(
    (
      await call("/operator/beta", "verified-customer", {
        email: customerEmail,
      })
    ).status,
  ).toBe(403);
  expect(
    (await call("/operator/beta", "verified-owner", { email: customerEmail }))
      .status,
  ).toBe(201);
  const data = await (
    await call("/operator/invitations", "verified-owner")
  ).json();
  expect(data.invitations).toEqual([
    expect.objectContaining({
      email: customerEmail,
      status: "awaiting_review",
    }),
  ]);
  expect(invitationEmail).not.toHaveBeenCalled();
});
it("approval retries reuse the registered invitation and verified invitees can accept from the sign-in page", async () => {
  await call("/beta", "", { email: customerEmail });
  invitationEmail.mockRejectedValueOnce(
    new HttpError(502, "invitation_email_failed", "Interrupted"),
  );
  expect(
    (
      await call("/operator/invitations/send", "verified-owner", {
        email: customerEmail,
      })
    ).status,
  ).toBe(502);
  let list = await (
    await call("/operator/invitations", "verified-owner")
  ).json();
  expect(list.invitations[0]).toMatchObject({ status: "approved" });
  expect(JSON.stringify(list)).not.toMatch(/invitationBox|token_hash/);
  expect(
    (
      await call("/operator/invitations/send", "verified-owner", {
        email: customerEmail,
      })
    ).status,
  ).toBe(201);
  expect(invitationEmail.mock.calls[0][0]).toEqual(
    invitationEmail.mock.calls[1][0],
  );
  expect(new URL(invitationEmail.mock.calls[1][0].url).pathname).toBe(
    "/signin",
  );
  expect(await repo.invitations()).toHaveLength(1);
  await call("/operator/invitations/send", "verified-owner", {
    email: customerEmail,
  });
  expect(invitationEmail).toHaveBeenCalledTimes(2);
  expect((await (await call("/me", "verified-customer")).json()).invited).toBe(
    true,
  );
  expect(
    (await call("/invitations/accept", "unverified-owner", {})).status,
  ).toBe(401);
  expect((await call("/invitations/accept", "verified-owner", {})).status).toBe(
    403,
  );
  expect(
    (await call("/invitations/accept", "verified-customer", {})).status,
  ).toBe(200);
  list = await (await call("/operator/invitations", "verified-owner")).json();
  expect(list.invitations[0]).toMatchObject({
    status: "accepted",
    accountExists: true,
  });
});
