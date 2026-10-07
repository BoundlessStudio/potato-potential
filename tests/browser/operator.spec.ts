import { expect, test } from "@playwright/test";

test("keeps beta navigation absent during onboarding, provisioning, and completed operator setup", async ({
  page,
}) => {
  let provisioning = false;
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        operator: true,
        demo: true,
        profile: provisioning
          ? { agentName: "Pip", avatar: "sprout", color: "#7659e8" }
          : null,
        agent: provisioning
          ? {
              status: "provisioning",
              phase: "computer",
              completed: ["identity"],
            }
          : null,
      },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Create my companion" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Beta operator" })).toHaveCount(
    0,
  );
  provisioning = true;
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Making room for Pip." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Beta operator" })).toHaveCount(
    0,
  );
  await page.unroute("**/api/me");
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Message your companion" }),
  ).toBeVisible();
  await expect(
    page.locator('a[href="/beta"], a[href="/operator/invitations"]'),
  ).toHaveCount(0);
});

test("regular customers cannot access companion operation controls", async ({
  page,
}) => {
  let requests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/operator")) requests++;
  });
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { operator: false } }),
  );
  await page.goto("/operator");
  await expect(
    page.getByRole("heading", { name: "Operator access only." }),
  ).toBeVisible();
  expect(requests).toBe(0);
});

test("signed-out operators reach sign-in for companion operations", async ({
  page,
}) => {
  await page.route("**/api/me", (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: "unauthenticated", message: "Sign in first." } },
    }),
  );
  await page.goto("/operator");
  await expect(
    page.getByRole("heading", { name: "Sign in to manage companions." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign in", exact: true }),
  ).toHaveAttribute("href", "/signin");
});
