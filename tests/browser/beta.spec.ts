import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("boundless-demo-user", "signed-out"),
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
