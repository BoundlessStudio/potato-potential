import { expect, test } from "@playwright/test";

test("keeps the operator entry hidden throughout onboarding and provisioning", async ({
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
  await expect(page.getByText("Beta operator", { exact: true })).toHaveCount(0);
  provisioning = true;
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Making room for Pip." }),
  ).toBeVisible();
  await expect(page.getByText("Beta operator", { exact: true })).toHaveCount(0);
});

test("operator reviews beta requests and approves sending separately from adding emails", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { operator: true, profile: null, agent: null } }),
  );
  const people = [
    { email: "joined@example.com", status: "accepted", accountExists: true },
    {
      email: "waiting@example.com",
      status: "awaiting_review",
      accountExists: false,
    },
    { email: "invited@example.com", status: "pending", accountExists: false },
    { email: "former@example.com", status: "accepted", accountExists: false },
    { email: "expired@example.com", status: "expired", accountExists: false },
  ];
  await page.route("**/api/operator/invitations", (route) =>
    route.fulfill({ json: { invitations: people } }),
  );
  let added: { email: string } | undefined, sent: { email: string } | undefined;
  await page.route("**/api/operator/beta", (route) => {
    added = route.request().postDataJSON();
    people.push({
      email: added!.email,
      status: "awaiting_review",
      accountExists: false,
    });
    return route.fulfill({ status: 201, json: added });
  });
  await page.route("**/api/operator/invitations/send", (route) => {
    sent = route.request().postDataJSON();
    people.find((person) => person.email === sent!.email)!.status = "pending";
    return route.fulfill({
      status: 201,
      json: { ...sent, sent: true, demo: false },
    });
  });
  await page.goto("/operator/invitations");
  await expect(
    page.getByRole("heading", { name: "Beta list.", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Email address", { exact: true })
    .fill("friend@example.com");
  await page.getByRole("button", { name: "Add email", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "friend@example.com" }),
  ).toContainText("Awaiting review");
  expect(added).toEqual({ email: "friend@example.com" });
  expect(sent).toBeUndefined();
  await page
    .getByRole("button", {
      name: "Approve and invite friend@example.com",
      exact: true,
    })
    .click();
  await expect(page.locator('.toast[role="status"]')).toHaveText(
    "Invitation sent to friend@example.com.",
  );
  await expect(
    page.getByRole("row").filter({ hasText: "friend@example.com" }),
  ).toContainText("Invited");
  expect(sent).toEqual({ email: "friend@example.com" });
  await expect(
    page.getByRole("row").filter({ hasText: "joined@example.com" }),
  ).toContainText("Created");
  await expect(
    page.getByRole("row").filter({ hasText: "former@example.com" }),
  ).toContainText("Not created");
  await expect(page.getByRole("button", { name: "Suspend" })).toHaveCount(0);
  await page.screenshot({
    path: ".cache/beta-review-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".cache/beta-review-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("regular customers cannot access beta review controls", async ({
  page,
}) => {
  let requests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/operator")) requests++;
  });
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { operator: false } }),
  );
  await page.goto("/operator/invitations");
  await expect(
    page.getByRole("heading", { name: "Operator access only." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add email" })).toHaveCount(0);
  expect(requests).toBe(0);
});

test("signed-out visitors reach the dedicated sign-in page from operator access", async ({
  page,
}) => {
  await page.route("**/api/me", (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: "unauthenticated", message: "Sign in first." } },
    }),
  );
  await page.goto("/operator/invitations");
  await expect(
    page.getByRole("heading", { name: "Sign in to manage invitations." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign in", exact: true }),
  ).toHaveAttribute("href", "/signin");
  await expect(page.getByRole("button", { name: "Add email" })).toHaveCount(0);
});

test("completed operator setup exposes a link to the beta list", async ({
  page,
}) => {
  await page.route("**/api/me", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, operator: true } });
  });
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "Message your companion" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Beta operator" }),
  ).toHaveAttribute("href", "/operator/invitations");
});

test("failed invitation delivery retains approval and exposes a retry without reporting success", async ({
  page,
}) => {
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { operator: true } }),
  );
  const person = {
    email: "retry@example.com",
    status: "awaiting_review",
    accountExists: false,
  };
  await page.route("**/api/operator/invitations", (route) =>
    route.fulfill({ json: { invitations: [person] } }),
  );
  let release!: () => void,
    sends = 0;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/operator/invitations/send", async (route) => {
    sends++;
    await waiting;
    person.status = "approved";
    await route.fulfill({
      status: 502,
      json: {
        error: {
          code: "invitation_email_failed",
          message:
            "Couldn’t confirm sending this invitation. Please try again.",
        },
      },
    });
  });
  await page.goto("/operator/invitations");
  await page
    .getByRole("button", {
      name: "Approve and invite retry@example.com",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Approve and invite retry@example.com",
      exact: true,
    }),
  ).toBeDisabled();
  expect(sends).toBe(1);
  release();
  await expect(page.locator('.toast[role="alert"]')).toContainText(
    "Couldn’t confirm sending",
  );
  await expect(
    page.getByRole("button", {
      name: "Send invitation to retry@example.com",
      exact: true,
    }),
  ).toHaveText("Retry invitation");
  await expect(page.getByText(/Invitation sent to/)).toHaveCount(0);
});
