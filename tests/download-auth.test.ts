import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
const { factory, getUser, getSession } = vi.hoisted(() => ({
  factory: vi.fn(),
  getUser: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: factory,
  serializeCookieHeader: (name: string, value: string) => name + "=" + value,
}));
import { downloadSession } from "../apps/web/src/server/download-session";
import { downloadDestination } from "../apps/web/src/lib/download-destination";
const destination =
  "/api/files/content?instance=abcdefghij&path=%2Fhome%2Fnode%2Foutputs%2Freport.pdf";
beforeEach(() => {
  vi.clearAllMocks();
  factory.mockReturnValue({ auth: { getUser, getSession } });
});
afterEach(() => vi.unstubAllEnvs());
it("verifies the existing browser cookie with getUser before using its session token", async () => {
  getUser.mockResolvedValue({ data: { user: { email_confirmed_at: "now" } } });
  getSession.mockResolvedValue({
    data: { session: { access_token: "verified-token" } },
  });
  const req = {
    method: "GET",
    url: destination,
    headers: {},
    cookies: { existing: "cookie" },
  } as NextApiRequest;
  const res = {
    setHeader: vi.fn(),
    redirect: vi.fn(),
  } as unknown as NextApiResponse;
  expect(await downloadSession(req, res)).toBe(true);
  expect(getUser).toHaveBeenCalledOnce();
  expect(req.headers.authorization).toBe("Bearer verified-token");
  const options = factory.mock.calls[0][2];
  expect(options.cookies.getAll()).toEqual([
    { name: "existing", value: "cookie" },
  ]);
  options.cookies.setAll([
    { name: "existing", value: "refreshed", options: {} },
  ]);
  expect(res.setHeader).toHaveBeenCalledWith("Set-Cookie", [
    "existing=refreshed",
  ]);
});
it("preserves a download destination across sign-in when the cookie is absent or invalid", async () => {
  getUser.mockResolvedValue({
    data: { user: null },
    error: new Error("invalid session"),
  });
  const res = {
    setHeader: vi.fn(),
    redirect: vi.fn(),
  } as unknown as NextApiResponse;
  expect(
    await downloadSession(
      {
        method: "GET",
        url: destination,
        cookies: {},
        headers: {},
      } as NextApiRequest,
      res,
    ),
  ).toBe(false);
  expect(res.redirect).toHaveBeenCalledWith(
    303,
    `/signin?${new URLSearchParams({ next: destination })}`,
  );
  expect(getSession).not.toHaveBeenCalled();
});
it("retains bearer-client authentication and rejects external sign-in destinations", async () => {
  expect(
    await downloadSession(
      {
        method: "GET",
        url: destination,
        headers: { authorization: "Bearer api-client" },
      } as NextApiRequest,
      {} as NextApiResponse,
    ),
  ).toBe(true);
  expect(factory).not.toHaveBeenCalled();
  for (const value of [
    "//evil.example/api/files/content",
    "https://evil.example",
    "/api/files/content?instance=bad&path=file",
    "/api/files/content/../other?instance=abcdefghij&path=file",
    "/other",
  ])
    expect(downloadDestination(value)).toBe("/");
  expect(downloadDestination(destination)).toBe(destination);
});
