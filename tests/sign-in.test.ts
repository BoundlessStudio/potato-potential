import { afterEach, expect, it, vi } from "vitest";

const signInWithOtp = vi.hoisted(() => vi.fn());
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({ auth: { signInWithOtp } }),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("requests a passwordless link with the canonical email and the application's callback", async () => {
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.example.com");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-public-key");
  vi.stubGlobal("window", {
    location: { origin: "https://boundless.example.com" },
  });
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
