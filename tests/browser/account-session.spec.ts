import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

declare global {
  interface Window {
    accountClosureTest: {
      supabase: () => SupabaseClient;
      credential: () => Promise<string>;
      signOut: (scope: "local") => Promise<void>;
    };
  }
}

const authUrl = "http://127.0.0.1:54321";
let clientScript: string;

test.beforeAll(async () => {
  // Bundle the actual non-demo client, including Supabase's cookie adapter.
  const result = await build({
    stdin: {
      contents: `import { supabase, credential, signOut } from "./apps/web/src/lib/client";
        window.accountClosureTest = { supabase, credential, signOut };`,
      resolveDir: resolve(import.meta.dirname, "../.."),
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    define: {
      "process.env.NEXT_PUBLIC_DEMO_MODE": JSON.stringify("false"),
      "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify(authUrl),
      "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY":
        JSON.stringify("test-public-key"),
      "process.env.NEXT_PUBLIC_CONTROL_URL": JSON.stringify(""),
    },
  });
  clientScript = result.outputFiles[0].text;
});

test("clears Supabase session cookies after account closure, including when Auth reports the user is gone", async ({
  page,
  context,
}) => {
  const owner = "12345678-1234-4234-8234-123456789abc";
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const accessToken = [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({
      sub: owner,
      aud: "authenticated",
      role: "authenticated",
      iat: now - 60,
      exp: now + 3600,
    }),
    Buffer.from("fixture-signature").toString("base64url"),
  ].join(".");
  let logoutRequests = 0;
  await page.route(`${authUrl}/auth/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    expect(request.headers().authorization).toBe(`Bearer ${accessToken}`);
    if (url.pathname === "/auth/v1/user") {
      expect(request.method()).toBe("GET");
      await route.fulfill({
        json: {
          id: owner,
          email: "closing@example.com",
          aud: "authenticated",
          role: "authenticated",
          created_at: "2026-01-01T00:00:00Z",
        },
      });
    } else if (url.pathname === "/auth/v1/logout") {
      expect(request.method()).toBe("POST");
      expect(url.searchParams.get("scope")).toBe("local");
      logoutRequests++;
      await route.fulfill({
        status: 401,
        json: { message: "Account has been removed", code: "user_not_found" },
      });
    } else {
      throw new Error(
        `Unexpected Auth fixture request: ${request.method()} ${url.pathname}`,
      );
    }
  });
  // Keep the demo UI signed out while exercising the real authentication client.
  await page.addInitScript(() =>
    localStorage.setItem("boundless-demo-user", "signed-out"),
  );
  await page.goto("/signin");
  await page.addScriptTag({ content: clientScript });
  expect(
    await page.evaluate(async (token) => {
      const { error } = await window.accountClosureTest
        .supabase()
        .auth.setSession({
          access_token: token,
          refresh_token: "fixture-refresh-token",
        });
      if (error) throw error;
      localStorage.setItem("boundless-invite", "invitation-token");
      return window.accountClosureTest.credential();
    }, accessToken),
  ).toBe(accessToken);
  const authCookies = async () =>
    (await context.cookies()).filter(
      (cookie) =>
        cookie.name.startsWith("sb-") && cookie.name.includes("-auth-token"),
    );
  expect(await authCookies()).not.toHaveLength(0);
  await Promise.all([
    page.waitForURL("/", { waitUntil: "domcontentloaded" }),
    page.evaluate(() => {
      void window.accountClosureTest.signOut("local");
    }),
  ]);
  expect(logoutRequests).toBe(1);
  expect(await authCookies()).toHaveLength(0);
  expect(
    await page.evaluate(() => localStorage.getItem("boundless-invite")),
  ).toBeNull();
  await page.reload();
  await page.addScriptTag({ content: clientScript });
  expect(
    await page.evaluate(() => window.accountClosureTest.credential()),
  ).toBe("");
  expect(await authCookies()).toHaveLength(0);
});
