import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "boundless-demo-user",
      localStorage.getItem("boundless-demo-user") || "signed-out",
    ),
  );
});

test("home saves a beta request without signing in or sending an invitation", async ({
  page,
}) => {
  let submitted: unknown;
  const sensitiveRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/auth\/v1|\/invitations\/send|\/onboarding/.test(request.url()))
      sensitiveRequests.push(request.url());
  });
  await page.route("**/api/beta", (route) => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ status: 202, json: { saved: true } });
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Join the beta list", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".welcome-navigation")
      .getByRole("link", { name: "Sign in", exact: true }),
  ).toHaveAttribute("href", "/signin");
  await page.screenshot({ path: ".cache/beta-home-desktop.png" });
  await page
    .getByLabel("Email address", { exact: true })
    .fill("  FRIEND@example.com");
  await page
    .getByRole("button", { name: "Join the beta list", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "You’re on the beta list",
  );
  expect(submitted).toEqual({ email: "friend@example.com", website: "" });
  expect(sensitiveRequests).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".cache/beta-home-mobile.png",
    fullPage: true,
  });
});

test("signup failures stay actionable and sign-in has its own passwordless form", async ({
  page,
}) => {
  await page.route("**/api/beta", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { message: "Please try again." } },
    }),
  );
  await page.goto("/");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("friend@example.com");
  await page
    .getByRole("button", { name: "Join the beta list", exact: true })
    .click();
  await expect(page.locator('.error-inline[role="alert"]')).toHaveText(
    "Please try again.",
  );
  await expect(page.getByLabel("Email address", { exact: true })).toHaveValue(
    "friend@example.com",
  );
  await page
    .locator(".welcome-navigation")
    .getByRole("link", { name: "Sign in", exact: true })
    .click();
  await expect(page).toHaveURL(/\/signin$/);
  await expect(
    page.getByRole("button", { name: "Join the beta list", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Email address", { exact: true })
    .fill("invited@example.com");
  await page.screenshot({ path: ".cache/beta-signin-desktop.png" });
  await page
    .getByRole("button", { name: "Send a sign-in link", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Check your email for your sign-in link",
  );
});

test("invitation links reach sign-in and retain the invitation through passwordless authentication", async ({
  page,
}) => {
  const invitation = "registered-invitation-token-example";
  await page.goto(`/signin?invite=${invitation}&email=friend%40example.com`);
  await expect(page.getByLabel("Email address", { exact: true })).toHaveValue(
    "friend@example.com",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("boundless-invite")),
  ).toBe(invitation);
  await expect(page).toHaveURL(/\/signin$/);
  await page.goto("/signin?auth_error=1");
  await expect(page.locator('.error-inline[role="alert"]')).toContainText(
    "Request a fresh one",
  );
});

test("rejects an unapproved email on the login page without requesting an Auth email", async ({
  page,
}) => {
  const authRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/auth/v1/")) authRequests.push(request.url());
  });
  await page.route("**/api/auth/signin", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: "waiting@example.com",
    });
    return route.fulfill({
      status: 403,
      json: {
        error: {
          code: "invitation_required",
          message:
            "This email hasn’t been approved for beta access. No sign-in email was sent. Join the beta list or wait for your invitation before signing in.",
        },
      },
    });
  });
  await page.goto("/signin");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("waiting@example.com");
  await page
    .getByRole("button", { name: "Send a sign-in link", exact: true })
    .click();
  await expect(page.locator('.error-inline[role="alert"]')).toContainText(
    "No sign-in email was sent.",
  );
  await expect(
    page
      .locator('.error-inline[role="alert"]')
      .getByRole("link", { name: "Join the beta list" }),
  ).toHaveAttribute("href", "/");
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Send a sign-in link", exact: true }),
  ).toBeEnabled();
  expect(authRequests).toEqual([]);
  await page.screenshot({
    path: ".cache/beta-signin-rejected.png",
    fullPage: true,
  });
});

test("shows email confirmation when first sign-in mail was delivered through the admin invitation flow", async ({
  page,
}) => {
  await page.route("**/api/auth/signin", (route) =>
    route.fulfill({ json: { ready: true, emailSent: true } }),
  );
  await page.goto("/signin");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("invited@example.com");
  await page
    .getByRole("button", { name: "Send a sign-in link", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Check your email for your sign-in link",
  );
  await expect(page.locator('.error-inline[role="alert"]')).toHaveCount(0);
});

test("recovers from an old invitation stored in the browser when the signed-in email has a fresh approval", async ({
  page,
}) => {
  const stale = "expired-invitation-from-previous-account";
  await page.addInitScript((invitation) => {
    localStorage.setItem("boundless-demo-user", "demo-new");
    localStorage.setItem("boundless-invite", invitation);
  }, stale);
  let accepted = false;
  const attempts: unknown[] = [];
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        profile: accepted
          ? {
              id: "new-owner",
              email: "new@example.com",
              name: "",
              agentName: "Pip",
              phone: "",
              timezone: "UTC",
              avatar: "sprout",
              color: "#7659e8",
              personality: "",
              preferences: "",
              createdAt: new Date().toISOString(),
            }
          : null,
        agent: null,
        email: "new@example.com",
        invited: !accepted,
        operator: false,
        demo: true,
      },
    }),
  );
  await page.route("**/api/invitations/accept", (route) => {
    const body = route.request().postDataJSON();
    attempts.push(body);
    if (body.invitation === stale)
      return route.fulfill({
        status: 403,
        json: {
          error: {
            code: "invalid_invitation",
            message:
              "This invitation is invalid, expired, or belongs to another email.",
          },
        },
      });
    accepted = true;
    return route.fulfill({ json: { accepted: true } });
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Create my companion", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  expect(attempts).toContainEqual({});
  expect(
    await page.evaluate(() => localStorage.getItem("boundless-invite")),
  ).toBeNull();
});
