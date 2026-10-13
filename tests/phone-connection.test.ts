import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Inkbox } from "../services/control-plane/src/providers";

const identity = "owner-identity",
  phone = "+14165550123";
const startedAt = "2026-10-12T12:00:00.000Z";
const createdAt = "2026-10-12T12:00:10.000Z";
const assignment = {
  id: "owner-assignment",
  agent_identity_id: identity,
  remote_number: phone,
  status: "active",
  created_at: startedAt,
};
const inbound = {
  id: "owner-message",
  assignment_id: assignment.id,
  remote_number: phone,
  direction: "inbound",
  is_group: false,
  is_blocked: false,
  created_at: createdAt,
  service: "imessage",
  status: "received",
  message_type: "message",
  content: "Hi",
};
let assignments: any[],
  messages: any[],
  texts: any[],
  number: any,
  consent: any;
let fetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T12:05:00.000Z"));
  assignments = [{ ...assignment }];
  messages = [{ ...inbound }];
  texts = [];
  number = { id: "own-number", agent_identity_id: identity };
  consent = { receiver_number: phone, status: "opted_in", source: "sms" };
  fetch = vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    return Response.json(
      path.includes("assignments")
        ? assignments
        : path.includes("imessage/messages")
          ? messages
          : path.endsWith("/texts")
            ? texts
            : path.includes("sms-opt-ins")
              ? consent
              : number,
    );
  });
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const check = (sms?: string) =>
  new Inkbox("admin").phoneConnection(identity, phone, startedAt, sms);
const routedTransports = ["imessage", "sms", "rcs"] as const;

it.each(routedTransports)(
  "confirms a fresh %s Hi only in the owner's current identity and active assignment",
  async (channel) => {
    messages = [{ ...inbound, service: channel }];
    expect(await check()).toEqual({
      status: "confirmed",
      confirmation: {
        channel,
        messageId: inbound.id,
      },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetch.mock.calls) {
      expect(new URL(url).searchParams.get("agent_identity_id")).toBe(identity);
      expect(init.method || "GET").toBe("GET");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  },
);

const invalidMessages = [
  ["outbound message", { direction: "outbound" }],
  ["another phone", { remote_number: "+14165550999" }],
  ["Apple ID email", { remote_number: "owner@example.com" }],
  ["group", { is_group: true }],
  ["missing group flag", { is_group: undefined }],
  ["blocked sender", { is_blocked: true }],
  ["missing admission flag", { is_blocked: undefined }],
  ["history before the attempt", { created_at: "2026-10-12T11:59:59.000Z" }],
  ["history at the attempt boundary", { created_at: startedAt }],
  ["invalid timestamp", { created_at: "invalid" }],
  ["future timestamp", { created_at: "2999-01-01T00:00:00.000Z" }],
  ["another assignment", { assignment_id: "another-assignment" }],
  ["missing assignment", { assignment_id: null }],
  ["failed receipt", { status: "failed" }],
  ["reaction", { message_type: "reaction" }],
  ["unknown transport", { service: "unknown" }],
  ["missing transport", { service: undefined }],
  ["empty message", { content: "  " }],
  ["router connection command", { content: "connect @owner-identity" }],
  ["router disconnection command", { content: "disconnect @owner-identity" }],
  ["no evidence ID", { id: undefined }],
] as const;
it.each(
  routedTransports.flatMap((channel) =>
    invalidMessages.map(
      ([label, changes]) => [channel, label, changes] as const,
    ),
  ),
)(
  "rejects %s %s as phone-ownership evidence",
  async (channel, _label, changes) => {
    messages = [{ ...inbound, service: channel, ...changes }];
    expect(await check()).toEqual({ status: "waiting_message" });
  },
);

const invalidAssignments = [
  ["another identity", { agent_identity_id: "another-identity" }],
  ["another phone", { remote_number: "+14165550999" }],
  ["released connection", { status: "released" }],
  ["missing identity binding", { agent_identity_id: undefined }],
  [
    "assignment created after the message",
    { created_at: "2026-10-12T12:00:20.000Z" },
  ],
] as const;
it.each(
  routedTransports.flatMap((channel) =>
    invalidAssignments.map(
      ([label, changes]) => [channel, label, changes] as const,
    ),
  ),
)("rejects a %s assignment for %s", async (channel, _label, changes) => {
  messages = [{ ...inbound, service: channel }];
  assignments = [{ ...assignment, ...changes }];
  expect((await check()).status).not.toBe("confirmed");
});

it.each(
  (["sms", "rcs"] as const).flatMap((channel) =>
    ["START", "STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "HELP"].map(
      (word) => [channel, word] as const,
    ),
  ),
)(
  "does not treat the routed %s control word %s as a hello",
  async (channel, word) => {
    messages = [
      { ...inbound, service: channel, content: ` ${word.toLowerCase()} ` },
    ];
    expect(await check()).toEqual({ status: "waiting_message" });
  },
);

it.each(["sms", "rcs"] as const)(
  "uses a routed %s hello without creating dedicated SMS provisioning or consent",
  async (channel) => {
    messages = [{ ...inbound, service: channel }];
    expect(await check("own-number")).toEqual({
      status: "confirmed",
      confirmation: { channel, messageId: inbound.id },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      fetch.mock.calls.every(([url]) =>
        new URL(url).pathname.startsWith("/api/v1/imessage/"),
      ),
    ).toBe(true);
  },
);

it("a connection/contact without an inbound message only advances the guidance", async () => {
  assignments = [];
  expect(await check()).toEqual({ status: "waiting_connection" });
  assignments = [{ ...assignment }];
  messages = [];
  expect(await check()).toEqual({ status: "waiting_message" });
});

it("fails closed for invalid attempt times and unnormalized phones without querying Inkbox", async () => {
  const provider = new Inkbox("admin");
  for (const date of ["bad", "2999-01-01T00:00:00Z"])
    expect(
      (await provider.phoneConnection(identity, phone, date)).status,
    ).not.toBe("confirmed");
  expect(
    (await provider.phoneConnection(identity, "4165550123", startedAt)).status,
  ).not.toBe("confirmed");
  expect(fetch).not.toHaveBeenCalled();
});

it("bounds a stalled provider read to eight seconds", async () => {
  vi.useFakeTimers();
  fetch.mockImplementation(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      }),
  );
  const pending = expect(check()).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(8000);
  await pending;
});

const start = {
  id: "sms-start",
  direction: "inbound",
  remote_phone_number: phone,
  is_blocked: false,
  text: "START",
  created_at: createdAt,
};
const hello = {
  ...start,
  id: "sms-hello",
  text: "Hi",
  created_at: "2026-10-12T12:00:20.000Z",
};
it("requires a fresh recipient START, a later Hi and current SMS consent on the owned number", async () => {
  assignments = [];
  messages = [];
  texts = [{ ...hello }];
  expect((await check("own-number")).status).not.toBe("confirmed");
  texts.push({ ...start });
  expect(await check("own-number")).toEqual({
    status: "confirmed",
    confirmation: {
      channel: "sms",
      messageId: hello.id,
    },
  });
  expect(
    fetch.mock.calls.some(([url]) => url.includes("/phone/sms-opt-ins/")),
  ).toBe(true);
  expect(
    fetch.mock.calls.every(([, init]) => !init.method || init.method === "GET"),
  ).toBe(true);
});

it.each([
  "outbound_start",
  "wrong_sender",
  "stale_start",
  "blocked",
  "group",
  "before_start",
  "opted_out",
  "admin_consent",
  "wrong_consent_phone",
  "other_number_identity",
  "wrong_number",
])("does not confirm SMS when %s", async (scenario) => {
  assignments = [];
  messages = [];
  texts = [{ ...start }, { ...hello }];
  if (scenario === "outbound_start") texts[0].direction = "outbound";
  if (scenario === "wrong_sender")
    texts[0].remote_phone_number = "+14165550999";
  if (scenario === "stale_start") texts[0].created_at = startedAt;
  if (scenario === "blocked") texts[1].is_blocked = true;
  if (scenario === "group")
    texts[1].recipients = [{ phone_number: "+14165550999" }];
  if (scenario === "before_start") texts[1].created_at = startedAt;
  if (scenario === "opted_out") consent.status = "opted_out";
  if (scenario === "admin_consent") consent.source = "api";
  if (scenario === "wrong_consent_phone")
    consent.receiver_number = "+14165550999";
  if (scenario === "other_number_identity")
    number.agent_identity_id = "other-identity";
  if (scenario === "wrong_number") number.id = "other-number";
  expect((await check("own-number")).status).not.toBe("confirmed");
});
