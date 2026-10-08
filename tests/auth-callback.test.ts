import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { factory, exchange, verify, jar } = vi.hoisted(() => ({
  factory: vi.fn(),
  exchange: vi.fn(),
  verify: vi.fn(),
  jar: { getAll: vi.fn(), set: vi.fn() },
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: factory }));
vi.mock("next/headers", () => ({ cookies: async () => jar }));
import { GET } from "../apps/web/src/app/auth/callback/route";
const origin = "https://potato.example.com";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.example.com");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-key");
  jar.getAll.mockReturnValue([]);
  factory.mockReturnValue({
    auth: { exchangeCodeForSession: exchange, verifyOtp: verify },
  });
});
afterEach(() => vi.unstubAllEnvs());

it("redeems an admin invite token, persists the verified session cookie, and removes credentials from the redirect", async () => {
  verify.mockImplementation(async () => {
    factory.mock.calls[0][2].cookies.setAll([
      {
        name: "session-cookie",
        value: "verified-session",
        options: { sameSite: "lax" },
      },
    ]);
    return { error: null };
  });
  const response = await GET(
    new Request(
      origin + "/auth/callback?type=invite&token_hash=private-invite-hash",
    ),
  );
  expect(verify).toHaveBeenCalledExactlyOnceWith({
    type: "invite",
    token_hash: "private-invite-hash",
  });
  expect(exchange).not.toHaveBeenCalled();
  expect(jar.set).toHaveBeenCalledWith("session-cookie", "verified-session", {
    sameSite: "lax",
  });
  expect(response.headers.get("location")).toBe(origin + "/");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
});

it("retains the PKCE callback for already verified customers", async () => {
  exchange.mockResolvedValue({ error: null });
  const response = await GET(
    new Request(origin + "/auth/callback?code=pkce-code"),
  );
  expect(exchange).toHaveBeenCalledExactlyOnceWith("pkce-code");
  expect(verify).not.toHaveBeenCalled();
  expect(response.headers.get("location")).toBe(origin + "/");
});

it("keeps expired or used invite links on the sign-in error flow without a session", async () => {
  verify.mockResolvedValue({ error: new Error("Expired token") });
  const response = await GET(
    new Request(origin + "/auth/callback?type=invite&token_hash=expired"),
  );
  expect(response.headers.get("location")).toBe(
    origin + "/signin?auth_error=1",
  );
  expect(jar.set).not.toHaveBeenCalled();
});

it("limits token redemption to admin invites and redirects only to an allowed download", async () => {
  const denied = await GET(
    new Request(origin + "/auth/callback?type=recovery&token_hash=other-token"),
  );
  expect(denied.headers.get("location")).toBe(origin + "/signin?auth_error=1");
  expect(factory).not.toHaveBeenCalled();
  verify.mockResolvedValue({ error: null });
  const query = new URLSearchParams({
    type: "invite",
    token_hash: "invite-token",
    next: "https://evil.example.com",
  });
  expect(
    (await GET(new Request(origin + "/auth/callback?" + query))).headers.get(
      "location",
    ),
  ).toBe(origin + "/");
  const download =
    "/api/files/content?instance=abcdefghij&path=%2Fhome%2Fnode%2Freport.pdf";
  query.set("next", download);
  expect(
    (await GET(new Request(origin + "/auth/callback?" + query))).headers.get(
      "location",
    ),
  ).toBe(origin + download);
});
