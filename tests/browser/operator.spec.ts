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

test("operator can create invitations on the standalone page before agent setup completes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { operator: true, profile: null, agent: null } }),
  );
  const invitations = [
    { email: "joined@example.com", status: "accepted", accountExists: true },
    { email: "waiting@example.com", status: "pending", accountExists: false },
    { email: "signed-up@example.com", status: "pending", accountExists: true },
    { email: "former@example.com", status: "accepted", accountExists: false },
    { email: "expired@example.com", status: "expired", accountExists: false },
  ];
  await page.route("**/api/operator/invitations", (route) =>
    route.fulfill({ json: { invitations } }),
  );
  let submitted: { email: string } | undefined;
  await page.route("**/api/operator/invitations/send", (route) => {
    submitted = route.request().postDataJSON();
    invitations.push({
      email: submitted!.email,
      status: "pending",
      accountExists: false,
    });
    return route.fulfill({
      status: 201,
      json: {
        email: submitted!.email,
        sent: true,
        demo: false,
      },
    });
  });
  await page.goto("/operator/invitations");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("friend@example.com");
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Invitation sent to friend@example.com.",
  );
  await expect(
    page.getByText("friend@example.com", { exact: true }),
  ).toBeVisible();
  const joined = page
    .getByRole("row")
    .filter({ hasText: "joined@example.com" });
  await expect(
    joined.getByRole("cell", { name: "Accepted", exact: true }),
  ).toBeVisible();
  await expect(
    joined.getByRole("cell", { name: "Created", exact: true }),
  ).toBeVisible();
  const waiting = page
    .getByRole("row")
    .filter({ hasText: "waiting@example.com" });
  await expect(
    waiting.getByRole("cell", { name: "Pending", exact: true }),
  ).toBeVisible();
  await expect(
    waiting.getByRole("cell", { name: "Not created", exact: true }),
  ).toBeVisible();
  const former = page
    .getByRole("row")
    .filter({ hasText: "former@example.com" });
  await expect(
    former.getByRole("cell", { name: "Accepted", exact: true }),
  ).toBeVisible();
  await expect(
    former.getByRole("cell", { name: "Not created", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Suspend" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Health & usage" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Your beta companions", { exact: true }),
  ).toHaveCount(0);
  expect(submitted).toEqual({ email: "friend@example.com" });
  await expect(
    page.getByRole("link", { name: "Back to companion" }),
  ).toHaveAttribute("href", "/");
  await page.screenshot({
    path: ".cache/operator-invitations-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".cache/operator-invitations-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("regular customers cannot access the standalone invitation controls", async ({
  page,
}) => {
  let operatorRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/operator"))
      operatorRequests++;
  });
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { operator: false } }),
  );
  await page.goto("/operator/invitations");
  await expect(
    page.getByRole("heading", { name: "Operator access only." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send invitation" }),
  ).toHaveCount(0);
  expect(operatorRequests).toBe(0);
});

test("signed-out visitors must sign in before accessing invitation controls", async ({
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
  ).toHaveAttribute("href", "/");
  await expect(
    page.getByRole("button", { name: "Send invitation" }),
  ).toHaveCount(0);
});

test("completed operator setup exposes a link to the standalone invitation page", async ({
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
test("email failure preserves the address for retry and never reports success", async ({
  page,
}) => {
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { operator: true } }),
  );
  await page.route("**/api/operator/invitations", (route) =>
    route.fulfill({ json: { invitations: [] } }),
  );
  let release!: () => void,
    sends = 0;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/operator/invitations/send", async (route) => {
    sends++;
    await waiting;
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
    .getByLabel("Email address", { exact: true })
    .fill("retry@example.com");
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("button", { name: "Sending…" })).toBeDisabled();
  expect(sends).toBe(1);
  release();
  await expect(page.locator('.toast[role="alert"]')).toContainText(
    "Couldn’t confirm sending",
  );
  await expect(page.getByLabel("Email address", { exact: true })).toHaveValue(
    "retry@example.com",
  );
  await expect(
    page.getByRole("button", { name: "Send invitation" }),
  ).toBeEnabled();
  await expect(page.getByText(/Invitation sent to/)).toHaveCount(0);
});
