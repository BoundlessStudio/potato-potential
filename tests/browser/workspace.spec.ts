import { expect, test } from "@playwright/test";
test("keeps takeover read-only while cancellation is pending and after a failed handoff", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fail = true;
  await page.route("**/api/computer/takeover", async (route) => {
    await pending;
    await route.fulfill(
      fail
        ? {
            status: 409,
            json: {
              error: {
                code: "cancellation_pending",
                message: "Companion is still stopping.",
              },
            },
          }
        : { status: 200, json: { control: "customer" } },
    );
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Preview computer", exact: true })
    .click();
  await page.getByRole("button", { name: "Take over", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Waiting for companion…" }),
  ).toBeDisabled();
  await expect(page.getByText("You have control")).toHaveCount(0);
  release();
  await expect(
    page.getByText("Companion is still stopping.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Take over", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText("You have control")).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Take over", exact: true }).click();
  await expect(page.getByText("You have control")).toBeVisible();
});

test("does not grant control to a reopened computer after the original panel closes", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/computer/takeover", async (route) => {
    await pending;
    await route.fulfill({ status: 200, json: { control: "customer" } });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Preview computer", exact: true })
    .click();
  await page.getByRole("button", { name: "Take over", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Waiting for companion…" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Close computer" }).click();
  await page
    .getByRole("button", { name: "Preview computer", exact: true })
    .click();
  release();
  await expect(
    page.getByRole("button", { name: "Take over", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("You have control")).toHaveCount(0);
});

test("formats local and pasted international numbers and blocks incomplete input", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("boundless-demo-user", "demo-new"),
  );
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        profile: null,
        agent: null,
        email: "customer@example.com",
        operator: false,
        demo: true,
      },
    }),
  );
  let submitted: { phone?: string } | undefined;
  await page.route("**/api/onboarding", (route) => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ status: 202, json: { queued: true } });
  });
  await page.goto("/");
  await page.getByLabel("Your name", { exact: true }).fill("Taylor");
  await expect(page.getByText("Beta operator", { exact: true })).toHaveCount(0);
  const phone = page.getByLabel("Your mobile number", { exact: true });
  const country = page.getByRole("combobox", { name: "Phone country" });
  await expect(country).toHaveValue("CA");
  await phone.fill("519555");
  await page.getByLabel("Your timezone").click();
  await expect(page.locator("#phone-error")).toHaveText(
    "Enter a complete mobile number for the selected country.",
  );
  await page.getByRole("button", { name: "Create my companion" }).click();
  expect(submitted).toBeUndefined();
  await phone.fill("(519) 555-0123");
  await expect(phone).toHaveValue("(519) 555-0123");
  await expect(
    page.getByText("We’ll use +1 519 555 0123.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("#phone-error")).toHaveCount(0);
  await phone.fill("");
  await country.selectOption("GB");
  await phone.fill("07700 900123");
  await expect(
    page.getByText("We’ll use +44 7700 900123.", { exact: true }),
  ).toBeVisible();
  await phone.fill("+1 (519) 555-0123");
  await expect(country).toHaveValue("CA");
  await page.getByRole("button", { name: "Create my companion" }).click();
  await expect.poll(() => submitted?.phone).toBe("+15195550123");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(phone).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".cache/phone-input-mobile.png",
    fullPage: true,
  });
  await page
    .locator(".phone-field")
    .screenshot({ path: ".cache/phone-field.png" });
});

test("hides the invitation administration button from a regular customer workspace", async ({
  page,
}) => {
  await page.route("**/api/me", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, operator: false } });
  });
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "Message your companion" }),
  ).toBeVisible();
  await expect(page.getByText("Beta operator", { exact: true })).toHaveCount(0);
});

test("automatically resumes a rotated stream without submitting the message twice", async ({
  page,
}) => {
  await page.goto("/");
  const message = page.getByRole("textbox", { name: "Message your companion" });
  await expect(message).toBeVisible();
  let submissions = 0,
    replays = 0;
  await page.route("**/api/responses", async (route) => {
    submissions++;
    const response = await route.fetch();
    const frames = (await response.text()).split("\n\n");
    await route.fulfill({
      response,
      body:
        frames.slice(0, 4).join("\n\n") +
        "\n\nevent: connection.rotate\ndata: {}\n\n",
    });
  });
  page.on("request", (request) => {
    if (/\/api\/responses\/[^/]+\/stream$/.test(request.url())) replays++;
  });
  await message.fill("Keep this turn running across a rotation");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page
      .locator(".message-assistant")
      .filter({ hasText: "Keep this turn running across a rotation" }),
  ).toHaveCount(1);
  expect(submissions).toBe(1);
  expect(replays).toBe(1);
  await expect(
    page.getByRole("button", { name: "Reconnect", exact: true }),
  ).not.toBeVisible();
});
test("recovers a dropped stream without duplicating the completed assistant response", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "Message your companion" }),
  ).toBeVisible();
  await page.route(
    "**/api/responses",
    async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      const frames = body.split("\n\n");
      await route.fulfill({
        response,
        body: frames.slice(0, 4).join("\n\n") + "\n\n",
      });
    },
    { times: 1 },
  );
  await page
    .getByRole("textbox", { name: "Message your companion" })
    .fill("Recover this unique thought");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByRole("button", { name: "Reconnect", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Reconnect", exact: true }),
  ).not.toBeVisible();
  await expect(
    page
      .locator(".message-assistant")
      .filter({ hasText: "Recover this unique thought" }),
  ).toHaveCount(1);
});
test("companion workspace, streamed chat, task/wiki editing, apps, memory and takeover", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /A little more room/ }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/workspace-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("textbox", { name: "Message your companion" })
    .fill("Help me plan tomorrow");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page
      .locator(".message-assistant")
      .filter({ hasText: "Help me plan tomorrow" })
      .getByText(/I’ve got it. In this local preview/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "Add a task", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Browser test task");
  await page.getByLabel("A little context").fill("A useful next step.");
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(
    page.getByText("Browser test task", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Wiki", exact: true }).click();
  await page.getByRole("button", { name: "New page" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Browser test wiki");
  await page
    .getByLabel("Your notes · Markdown welcome")
    .fill("## A useful note\nRemember this.");
  await page.getByRole("button", { name: "Save page" }).click();
  await expect(
    page.getByText("Browser test wiki", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Apps", exact: true }).click();
  await page.getByRole("textbox", { name: "Search apps" }).fill("github");
  await expect(page.getByRole("heading", { name: "GitHub" })).toBeVisible();
  const popupPromise = page.waitForEvent("popup");
  await page
    .locator(".app-card")
    .filter({ has: page.getByRole("heading", { name: "GitHub" }) })
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  const popup = await popupPromise;
  await expect(
    popup.getByRole("heading", { name: "Your connected apps are ready." }),
  ).toBeVisible();
  await popup.close();
  await page.getByRole("button", { name: "Check connections" }).click();
  await expect(
    page.getByRole("button", { name: "Disconnect github" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Disconnect github" }).click();
  await expect(
    page.getByRole("button", { name: "Disconnect github" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Routines", exact: true }).click();
  await page.getByRole("button", { name: "New routine" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Browser routine");
  await page
    .getByLabel("What should your agent do?")
    .fill("Review my tasks and check in when useful.");
  await page.getByRole("button", { name: "Make it a routine" }).click();
  await expect(
    page.getByRole("heading", { name: "Browser routine" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause Browser routine" }).click();
  await expect(
    page.getByRole("button", { name: "Resume Browser routine" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const aboutYou = page.getByRole("textbox", { name: "About you", exact: true });
  await expect(aboutYou).toBeEnabled();
  await aboutYou.fill("Browser-verified memory");
  await page.getByRole("button", { name: "Save About you", exact: true }).click();
  await expect(page.getByText("About you saved.", { exact: true })).toBeVisible();
  await expect(aboutYou).toHaveValue("Browser-verified memory");
  await page
    .getByRole("button", { name: "Your conversation", exact: true })
    .click();
  await expect(
    page
      .locator(".chat-heading")
      .getByRole("button", { name: "Preview computer", exact: true }),
  ).toHaveCount(0);
  const preview = page
    .locator(".companion-panel")
    .getByRole("button", { name: "Preview computer", exact: true });
  await expect(preview).toBeVisible();
  await preview.click();
  await expect(
    page
      .locator(".companion-panel")
      .getByRole("button", { name: "Close computer" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Take over", exact: true }).click();
  await expect(page.getByText("You have control")).toBeVisible();
  await page
    .getByRole("button", { name: "Return control", exact: true })
    .click();
  await page.getByRole("button", { name: "Close computer" }).click();
  await expect(preview).toBeVisible();
  const channels = page.locator(".topbar-actions").getByRole("button", {
    name: "Channels",
    exact: true,
  });
  await expect(page.getByText("Here for you", { exact: true })).toHaveCount(0);
  await expect(
    page.locator(".chat-tools").getByRole("button", { name: "Channels" }),
  ).toHaveCount(0);
  await expect(channels).toHaveText("");
  await channels.click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /completed/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Your call transcript" }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Your call transcript" })
    .getByRole("button", { name: "Close dialog" })
    .click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  expect(errors).toEqual([]);
});
test("mobile navigation and overflowing layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /A little more room/ }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/workspace-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Good things, getting done." }),
  ).toBeVisible();
  const channels = page.locator(".topbar-actions").getByRole("button", {
    name: "Channels",
    exact: true,
  });
  await channels.click();
  await expect(
    page.getByRole("dialog", { name: "One companion, wherever you are" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(channels).toBeFocused();
  await page.setViewportSize({ width: 320, height: 720 });
  await expect(channels).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Computer", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Computer", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect to desktop" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("resumable first-time setup with explicit preview phone confirmation", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("boundless-demo-user", "demo-new"),
  );
  await page.goto("/");
  await page.getByLabel("Your name").fill("Taylor");
  await page.getByLabel("Their name").fill("Fern");
  await page.getByLabel("Your mobile number").fill("+14165550999");
  await page.getByRole("button", { name: "Create my companion" }).click();
  await expect(page.getByText(/VERIFY /)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/VERIFY /)).toBeVisible();
  await page.getByRole("button", { name: /simulate/i }).click();
  await expect(
    page.getByRole("textbox", { name: "Message your companion" }),
  ).toBeVisible({ timeout: 15000 });
});
