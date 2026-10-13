import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
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
import { HttpError } from "../services/control-plane/src/security";

let server: Server,
  base: string,
  repo: MemoryRepository,
  inkbox: DemoInkbox,
  dep: Dependencies;
const number = "+14165550188";
const other = "+14165550189";
beforeEach(async () => {
  repo = new MemoryRepository();
  inkbox = new DemoInkbox();
  const a37 = new DemoAgent37();
  await seedDemo(repo, a37, inkbox);
  const config = loadConfig({ DEMO_MODE: "true" });
  dep = {
    config,
    repo,
    inkbox,
    a37,
    lifecycle: new Lifecycle(config, repo, a37, inkbox),
    queue: { send: vi.fn(async () => {}) },
  };
  server = createApp(dep).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const call = (
  path = "/contact-number",
  method = "GET",
  body?: unknown,
  token = "demo",
) =>
  fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const save = (number: string | null, expectedNumber: string | null = null) =>
  call("/contact-number", "PUT", { number, expectedNumber });

it("saves a normalized account contact independently of the profile and exposes it to channel links", async () => {
  const profile = (await repo.profile(DEMO_USER))!;
  const agent = (await repo.agent(DEMO_USER))!;
  const request = vi.spyOn(inkbox, "request");
  expect(await (await call()).json()).toEqual({ number: null });
  const response = await save("+1 (416) 555-0188");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ number });
  expect(request).not.toHaveBeenCalled();
  expect((await repo.agent(DEMO_USER))!.contactNumber).toEqual({
    number,
    identityId: agent.identityId,
    recipientNumber: profile.phone,
  });
  expect(await repo.profile(DEMO_USER)).toEqual(profile);
  expect(await (await call()).json()).toEqual({ number });
  expect(await (await call("/channels")).json()).toMatchObject({
    imessage: "connected",
    contactNumber: number,
  });
  expect((await (await call("/me")).json()).agent).not.toHaveProperty(
    "contactNumber",
  );
  await reconcile(dep, DEMO_USER);
  expect(await (await call()).json()).toEqual({ number });
  expect((await save(null, number)).status).toBe(200);
  expect((await repo.agent(DEMO_USER))!).not.toHaveProperty("contactNumber");
  expect(await (await call("/channels")).json()).toMatchObject({
    contactNumber: null,
  });
});

it("rejects invalid numbers, the verified recipient and the connection router without writing", async () => {
  const prior = structuredClone(await repo.agent(DEMO_USER));
  for (const invalid of [
    "",
    "hello",
    "4165550188",
    "+1 (416) 555-0123",
    "+1 (416) 555-0100",
    "+14165550188 ext 9",
    "sms:+14165550188",
  ]) {
    expect((await save(invalid)).status, invalid).toBe(400);
  }
  expect(
    (
      await call("/contact-number", "PUT", {
        number,
        expectedNumber: null,
        identityId: "foreign",
      })
    ).status,
  ).toBe(400);
  expect(await repo.agent(DEMO_USER)).toEqual(prior);
});

it("prevents stale tabs from overwriting a saved number and accepts a lost-response retry", async () => {
  expect((await save(number)).status).toBe(200);
  expect((await save(number)).status).toBe(200);
  expect((await save(other)).status).toBe(409);
  expect((await save(null, other)).status).toBe(409);
  expect(await (await call()).json()).toEqual({ number });
  expect((await save(other, number)).status).toBe(200);
  expect((await save(null, other)).status).toBe(200);
  expect(await (await call()).json()).toEqual({ number: null });
});

it("isolates contact numbers by authenticated account and rejects unauthorized or unready access", async () => {
  const profile = (await repo.profile(DEMO_USER))!;
  const agent = (await repo.agent(DEMO_USER))!;
  await repo.saveProfile({
    ...profile,
    id: DEMO_NEW_USER,
    email: "other@example.com",
    phone: "+14165550124",
  });
  await repo.saveAgent({
    ...agent,
    ownerId: DEMO_NEW_USER,
    identityId: randomUUID(),
  });
  expect((await save(number)).status).toBe(200);
  expect(
    await (await call("/contact-number", "GET", undefined, "demo-new")).json(),
  ).toEqual({ number: null });
  expect(
    (
      await call(
        `/contact-number?ownerId=${DEMO_USER}`,
        "PUT",
        { number: other, expectedNumber: null },
        "demo-new",
      )
    ).status,
  ).toBe(200);
  expect(await (await call()).json()).toEqual({ number });
  expect((await repo.agent(DEMO_NEW_USER))!.contactNumber?.number).toBe(other);
  expect(
    (await call("/contact-number", "GET", undefined, "invalid")).status,
  ).toBe(401);
  agent.status = "provisioning";
  await repo.saveAgent(agent);
  expect((await save(number)).status).toBe(409);
});

it("withholds a manual number after the companion identity or verified recipient changes", async () => {
  await save(number);
  const agent = (await repo.agent(DEMO_USER))!;
  agent.identityId = randomUUID();
  await repo.saveAgent(agent);
  expect(await (await call()).json()).toEqual({ number: null });
  expect(await (await call("/channels")).json()).toMatchObject({
    contactNumber: null,
  });
  expect((await save(other)).status).toBe(200);
  const profile = (await repo.profile(DEMO_USER))!;
  await repo.saveProfile({ ...profile, phone: "+14165550124" });
  expect(await (await call()).json()).toEqual({ number: null });
  expect(await (await call("/channels")).json()).toMatchObject({
    imessage: "connect_required",
    contactNumber: null,
  });
});

it("uses a saved number only for an active connection to this identity and recipient", async () => {
  await save(number);
  const agent = (await repo.agent(DEMO_USER))!;
  const profile = (await repo.profile(DEMO_USER))!;
  const request = vi.spyOn(inkbox, "request");
  for (const assignment of [
    {
      agent_identity_id: randomUUID(),
      remote_number: profile.phone,
      status: "active",
    },
    {
      agent_identity_id: agent.identityId,
      remote_number: "+14165550124",
      status: "active",
    },
    {
      agent_identity_id: agent.identityId,
      remote_number: profile.phone,
      status: "released",
    },
  ]) {
    request.mockResolvedValueOnce([assignment]);
    expect(await (await call("/channels")).json()).toMatchObject({
      imessage: "connect_required",
      contactNumber: null,
    });
  }
  expect(await (await call("/channels")).json()).toMatchObject({
    imessage: "connected",
    contactNumber: number,
  });
});

it("saves profile and contact drafts in one request and preserves the number when omitted", async () => {
  const profile = (await repo.profile(DEMO_USER))!;
  const response = await call("/profile", "PUT", {
    ...profile,
    name: "Updated name",
    contactNumber: { number: "+1 (416) 555-0188", expectedNumber: null },
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    profile: { name: "Updated name", phone: profile.phone },
    contactNumber: { number },
  });
  expect((await repo.profile(DEMO_USER))!).not.toHaveProperty("contactNumber");
  expect(await (await call()).json()).toEqual({ number });
  expect(
    (await call("/profile", "PUT", { ...profile, name: "Another name" }))
      .status,
  ).toBe(200);
  expect(await (await call()).json()).toEqual({ number });
  expect(
    (
      await call("/profile", "PUT", {
        ...profile,
        contactNumber: { number: null, expectedNumber: number },
      })
    ).status,
  ).toBe(200);
  expect(await (await call()).json()).toEqual({ number: null });
});

it("validates the merged contact draft before writing profile changes and retains both on a computer failure", async () => {
  await save(number);
  const profile = (await repo.profile(DEMO_USER))!;
  const configure = vi.spyOn(dep.lifecycle, "configurePersona");
  for (const invalid of [profile.phone, "+14165550100"]) {
    expect(
      (
        await call("/profile", "PUT", {
          ...profile,
          name: "Should not save",
          contactNumber: { number: invalid, expectedNumber: number },
        })
      ).status,
    ).toBe(400);
  }
  expect(
    (
      await call("/profile", "PUT", {
        ...profile,
        name: "Should not save",
        contactNumber: { number: other, expectedNumber: null },
      })
    ).status,
  ).toBe(409);
  expect(configure).not.toHaveBeenCalled();
  expect(await repo.profile(DEMO_USER)).toEqual(profile);
  expect(await (await call()).json()).toEqual({ number });
  configure.mockRejectedValueOnce(
    new HttpError(502, "profile_save_failed", "Computer unavailable."),
  );
  expect(
    (
      await call("/profile", "PUT", {
        ...profile,
        name: "Still a draft",
        contactNumber: { number: other, expectedNumber: number },
      })
    ).status,
  ).toBe(502);
  expect(await repo.profile(DEMO_USER)).toEqual(profile);
  expect(await (await call()).json()).toEqual({ number });
});
