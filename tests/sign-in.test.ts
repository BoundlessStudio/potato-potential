import { afterEach, expect, it, vi } from "vitest";

const { signInWithOtp, providerSignOut, getSession } = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  providerSignOut: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    auth: { signInWithOtp, signOut: providerSignOut, getSession },
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
  signInWithOtp.mockResolvedValue({ error: null });
  const { sendSignInLink } = await import("../apps/web/src/lib/client");
  await sendSignInLink("  FRIEND@example.com ");
  expect(signInWithOtp).toHaveBeenCalledWith({
    email: "friend@example.com",
    options: { emailRedirectTo: "https://boundless.example.com/auth/callback" },
  });
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
  signInWithOtp.mockResolvedValue({ error: null });
  const next =
    "/api/files/content?instance=abcdefghij&path=%2Fhome%2Fnode%2Freport.pdf";
  const { sendSignInLink } = await import("../apps/web/src/lib/client");
  await sendSignInLink("friend@example.com", next);
  expect(setItem).toHaveBeenCalledWith("boundless-download-return", next);
  expect(signInWithOtp).toHaveBeenCalledWith({
    email: "friend@example.com",
    options: { emailRedirectTo: "https://boundless.example.com/auth/callback" },
  });
});
