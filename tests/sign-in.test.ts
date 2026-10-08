import { afterEach, expect, it, vi } from "vitest";
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
} from "@supabase/supabase-js";

const { signInWithOtp, providerSignOut, getSession, refreshSession } =
  vi.hoisted(() => ({
    signInWithOtp: vi.fn(),
    providerSignOut: vi.fn(),
    getSession: vi.fn(),
    refreshSession: vi.fn(),
  }));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    auth: {
      signInWithOtp,
      signOut: providerSignOut,
      getSession,
      refreshSession,
    },
  }),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.resetAllMocks();
});

it("awaits local Supabase logout before clearing the invitation and redirecting after account closure", async () => {
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.example.com");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-public-key");
  const assign = vi.fn();
  vi.stubGlobal("window", { location: { assign } });
  const storage = new Map([["boundless-invite", "invitation-token"]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    removeItem: (key: string) => storage.delete(key),
  });
  getSession.mockResolvedValue({
    data: { session: { access_token: "session-token" } },
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  providerSignOut.mockImplementation(async () => {
    await gate;
    getSession.mockResolvedValue({ data: { session: null } });
    return { error: null };
  });
  const { credential, signOut } = await import("../apps/web/src/lib/client");
  expect(await credential()).toBe("session-token");
  try {
    const pending = signOut("local");
    expect(providerSignOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
    expect(assign).not.toHaveBeenCalled();
    expect(storage.get("boundless-invite")).toBe("invitation-token");
    release();
    await pending;
    expect(await credential()).toBe("");
    expect(storage.has("boundless-invite")).toBe(false);
    expect(assign).toHaveBeenCalledExactlyOnceWith("/");
  } finally {
    release();
  }
});

it("requests a passwordless link with the canonical email and the application's callback", async () => {
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.example.com");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-public-key");
  vi.stubGlobal("window", {
    location: { origin: "https://boundless.example.com" },
  });
  vi.stubGlobal("localStorage", { setItem: vi.fn(), removeItem: vi.fn() });
  const fetch = vi
    .fn()
    .mockImplementation(async () =>
      Response.json({ ready: true, emailSent: false }),
    );
  vi.stubGlobal("fetch", fetch);
  signInWithOtp.mockResolvedValue({ error: null });
  const { sendSignInLink } = await import("../apps/web/src/lib/client");
  await sendSignInLink("  FRIEND@example.com ");
  expect(signInWithOtp).toHaveBeenCalledWith({
    email: "friend@example.com",
    options: {
      emailRedirectTo: "https://boundless.example.com/auth/callback",
      shouldCreateUser: false,
    },
  });
  expect(fetch).toHaveBeenCalledWith(
    "/api/auth/signin",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ email: "friend@example.com" }),
    }),
  );
  expect(fetch.mock.invocationCallOrder[0]).toBeLessThan(
    signInWithOtp.mock.invocationCallOrder[0],
  );
  signInWithOtp.mockResolvedValue({
    error: new Error("Please wait before requesting another link."),
  });
  await expect(sendSignInLink("friend@example.com")).rejects.toThrow(
    "Please wait",
  );
});
it("keeps the protected download destination in this browser across the existing passwordless callback", async () => {
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.example.com");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-public-key");
  vi.stubGlobal("window", {
    location: { origin: "https://boundless.example.com" },
  });
  const setItem = vi.fn();
  vi.stubGlobal("localStorage", { setItem, removeItem: vi.fn() });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ ready: true })),
  );
  signInWithOtp.mockResolvedValue({ error: null });
  const next =
    "/api/files/content?instance=abcdefghij&path=%2Fhome%2Fnode%2Freport.pdf";
  const { sendSignInLink } = await import("../apps/web/src/lib/client");
  await sendSignInLink("friend@example.com", next);
  expect(setItem).toHaveBeenCalledWith("boundless-download-return", next);
  expect(signInWithOtp).toHaveBeenCalledWith({
    email: "friend@example.com",
    options: {
      emailRedirectTo: "https://boundless.example.com/auth/callback",
      shouldCreateUser: false,
    },
  });
});

it.each([403, 502])(
  "rejects sign-in before sending email if the approval check returns %s",
  async (status) => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
    vi.stubGlobal("localStorage", { setItem: vi.fn(), removeItem: vi.fn() });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { message: "An approved invitation is required." } },
            { status },
          ),
        ),
    );
    const { sendSignInLink } = await import("../apps/web/src/lib/client");
    await expect(sendSignInLink("waiting@example.com")).rejects.toThrow(
      "An approved invitation is required.",
    );
    expect(signInWithOtp).not.toHaveBeenCalled();
  },
);

it("does not request public OTP again when the server sent the first sign-in email through the admin invite flow", async () => {
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
  vi.stubGlobal("localStorage", { setItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ ready: true, emailSent: true })),
  );
  const { sendSignInLink } = await import("../apps/web/src/lib/client");
  await sendSignInLink("invited@example.com");
  expect(signInWithOtp).not.toHaveBeenCalled();
});

it("fails closed if the sign-in endpoint does not acknowledge approval", async () => {
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
  vi.stubGlobal("localStorage", { setItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));
  const { sendSignInLink } = await import("../apps/web/src/lib/client");
  await expect(sendSignInLink("invited@example.com")).rejects.toThrow(
    "Couldn’t check your beta access",
  );
  expect(signInWithOtp).not.toHaveBeenCalled();
});

function sessionRequests() {
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.example.com");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-public-key");
  getSession.mockResolvedValue({
    data: { session: { access_token: "old-token" } },
    error: null,
  });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

it("refreshes a rejected credential and retries phone verification with the same request", async () => {
  const fetch = sessionRequests();
  fetch
    .mockResolvedValueOnce(new Response("", { status: 401 }))
    .mockResolvedValueOnce(Response.json({ verified: true }, { status: 202 }));
  refreshSession.mockResolvedValue({
    data: { session: { access_token: "fresh-token" } },
    error: null,
  });
  const { api } = await import("../apps/web/src/lib/client");
  expect(await api("/onboarding/verify-phone", "POST", {})).toEqual({
    verified: true,
  });
  expect(refreshSession).toHaveBeenCalledTimes(1);
  expect(
    fetch.mock.calls.map(([, init]) => init.headers.Authorization),
  ).toEqual(["Bearer old-token", "Bearer fresh-token"]);
  for (const [url, init] of fetch.mock.calls) {
    expect(url).toBe("/api/onboarding/verify-phone");
    expect(init).toMatchObject({ method: "POST", body: "{}" });
  }
  expect(providerSignOut).not.toHaveBeenCalled();
});

it("shares a session refresh between concurrent rejected requests", async () => {
  const fetch = sessionRequests();
  fetch.mockImplementation(async (_url, init) =>
    init.headers.Authorization === "Bearer old-token"
      ? new Response("", { status: 401 })
      : Response.json({ ok: true }),
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  refreshSession.mockImplementation(async () => {
    await gate;
    return { data: { session: { access_token: "fresh-token" } }, error: null };
  });
  const { api } = await import("../apps/web/src/lib/client");
  const pending = Promise.all([
    api("/me"),
    api("/onboarding/verify-phone", "POST"),
  ]);
  try {
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(refreshSession).toHaveBeenCalledTimes(1));
    release();
    expect(await pending).toEqual([{ ok: true }, { ok: true }]);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  } finally {
    release();
  }
});

it("limits authentication retry to one attempt without signing out", async () => {
  const fetch = sessionRequests();
  fetch.mockImplementation(async () =>
    Response.json(
      { error: { code: "unauthorized", message: "Try signing in again." } },
      { status: 401 },
    ),
  );
  refreshSession.mockResolvedValue({
    data: { session: { access_token: "fresh-token" } },
    error: null,
  });
  const { api } = await import("../apps/web/src/lib/client");
  await expect(api("/me")).rejects.toMatchObject({ status: 401 });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(refreshSession).toHaveBeenCalledTimes(1);
  expect(providerSignOut).not.toHaveBeenCalled();
});
it.each([
  new AuthApiError("Refresh token not found", 400, "refresh_token_not_found"),
  new AuthSessionMissingError(),
])(
  "reports a permanently revoked session as unauthorized after a rejected API call",
  async (error) => {
    const fetch = sessionRequests();
    fetch.mockResolvedValue(
      Response.json(
        { error: { code: "unauthorized", message: "Account removed" } },
        { status: 401 },
      ),
    );
    refreshSession.mockResolvedValue({ data: { session: null }, error });
    const { api, ApiError } = await import("../apps/web/src/lib/client");
    try {
      await api("/me");
      throw new Error("Expected session rejection");
    } catch (rejected) {
      expect(rejected).toBeInstanceOf(ApiError);
      expect(rejected).toMatchObject({ status: 401, code: "session_expired" });
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
it("keeps a temporary refresh outage retryable instead of declaring the session revoked", async () => {
  const fetch = sessionRequests();
  fetch.mockResolvedValue(new Response("", { status: 401 }));
  const error = new AuthRetryableFetchError("Auth unavailable", 503);
  refreshSession.mockResolvedValue({ data: { session: null }, error });
  const { api } = await import("../apps/web/src/lib/client");
  await expect(api("/me")).rejects.toBe(error);
  expect(providerSignOut).not.toHaveBeenCalled();
});

it.each([409, 502])(
  "does not refresh authentication for a %s connection error",
  async (status) => {
    const fetch = sessionRequests();
    fetch.mockResolvedValue(
      Response.json({ error: { message: "Check again." } }, { status }),
    );
    const { api } = await import("../apps/web/src/lib/client");
    await expect(api("/onboarding/verify-phone", "POST")).rejects.toMatchObject(
      { status },
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(refreshSession).not.toHaveBeenCalled();
    expect(providerSignOut).not.toHaveBeenCalled();
  },
);

it("preserves session lookup errors instead of treating them as a signed-out session", async () => {
  const fetch = sessionRequests();
  getSession.mockResolvedValue({
    data: { session: null },
    error: new Error("Auth unavailable"),
  });
  const { credential, api } = await import("../apps/web/src/lib/client");
  await expect(credential()).rejects.toThrow("Auth unavailable");
  await expect(api("/me")).rejects.toThrow("Auth unavailable");
  expect(fetch).not.toHaveBeenCalled();
  expect(providerSignOut).not.toHaveBeenCalled();
});
it("reports a revoked session during credential lookup as expired while leaving temporary errors unchanged", async () => {
  sessionRequests();
  getSession.mockResolvedValue({
    data: { session: null },
    error: new AuthSessionMissingError(),
  });
  const { credential } = await import("../apps/web/src/lib/client");
  await expect(credential()).rejects.toMatchObject({
    status: 401,
    code: "session_expired",
  });
});
