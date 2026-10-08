import { expect, test, type Page } from "@playwright/test";

const newConversation = (page: Page) =>
  page
    .locator(".topbar-actions")
    .getByRole("button", { name: "New conversation", exact: true });
const history = (page: Page) =>
  page
    .locator(".topbar-actions")
    .getByRole("button", { name: "Conversation history", exact: true });
const composer = (page: Page) =>
  page.getByRole("textbox", { name: "Message your companion" });

async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.locator(".message-assistant").filter({ hasText: text }),
  ).toHaveCount(1);
  await expect(newConversation(page)).toBeEnabled();
}

test("creates separate conversations from the global header and resumes earlier web chats with their drafts", async ({
  page,
}) => {
  await page.goto("/tasks");
  await newConversation(page).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(composer(page)).toHaveValue("");
  await expect(page.locator(".message")).toHaveCount(0);
  await send(page, "Original weekly planning conversation");
  await composer(page).fill("An unsent planning draft");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await newConversation(page).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(composer(page)).toHaveValue("");
  await expect(page.locator(".message")).toHaveCount(0);
  await send(page, "Separate research conversation");
  await expect(
    page
      .locator(".message-user")
      .filter({ hasText: "Original weekly planning" }),
  ).toHaveCount(0);
  await history(page).click();
  await page
    .getByRole("dialog", { name: "Your conversations" })
    .getByRole("button", { name: /Original weekly planning conversation/ })
    .first()
    .click();
  await expect(composer(page)).toHaveValue("An unsent planning draft");
  await expect(
    page
      .locator(".message-user")
      .filter({ hasText: "Original weekly planning" }),
  ).toHaveCount(1);
  await expect(
    page.locator(".message-user").filter({ hasText: "Separate research" }),
  ).toHaveCount(0);
  await send(page, "Continue the original planning");
  await page.reload();
  await expect(
    page
      .locator(".message-user")
      .filter({ hasText: "Continue the original planning" }),
  ).toHaveCount(1);
  await expect(
    page.locator(".message-user").filter({ hasText: "Separate research" }),
  ).toHaveCount(0);
  await page.screenshot({ path: "test-results/chat-sessions-desktop.png" });
});

test("retries a lost creation reply using the same conversation instead of making a duplicate", async ({
  page,
}) => {
  await page.goto("/chat");
  const requests: { id: string }[] = [];
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("failed");
    } else await route.continue();
  });
  await newConversation(page).click();
  await expect.poll(() => requests.length).toBe(1);
  await expect(newConversation(page)).toBeEnabled();
  await newConversation(page).click();
  await expect.poll(() => requests.length).toBe(2);
  await expect(composer(page)).toBeEnabled();
  expect(requests[1].id).toBe(requests[0].id);
  const sessions = await (
    await page.request.get("http://localhost:4000/api/sessions", {
      headers: { Authorization: "Bearer demo" },
    })
  ).json();
  expect(
    sessions.sessions.filter(
      (row: { id: string }) => row.id === requests[0].id,
    ),
  ).toHaveLength(1);
});

test("does not display a slow old transcript after opening a new conversation", async ({
  page,
}) => {
  await page.goto("/chat");
  await newConversation(page).click();
  await send(page, "Transcript that should stay in the old conversation");
  const me = await (
    await page.request.get("http://localhost:4000/api/me", {
      headers: { Authorization: "Bearer demo" },
    })
  ).json();
  const oldId = me.agent.mainSessionId;
  let release!: () => void;
  let entered!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    entered = resolve;
  });
  await page.route(
    `**/api/sessions/${oldId}`,
    async (route) => {
      const response = await route.fetch();
      entered();
      await pending;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await page.reload();
  await requested;
  await newConversation(page).click();
  await expect(composer(page)).toBeEnabled();
  release();
  await expect(page.locator(".message")).toHaveCount(0);
  await send(page, "Only this fresh conversation should appear");
  await expect(page.locator(".message-user")).toHaveCount(1);
});

test("keeps channel histories read-only with the new conversation control available", async ({
  page,
}) => {
  const scheduledId = "d".repeat(32);
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: {
        sessions: [
          ...data.sessions,
          {
            id: scheduledId,
            title: "A saved morning briefing",
            channel: "scheduled",
          },
        ],
      },
    });
  });
  await page.route(`**/api/sessions/${scheduledId}`, (route) =>
    route.fulfill({
      json: {
        id: scheduledId,
        active_response_id: null,
        history: [
          { role: "assistant", content: "The scheduled briefing transcript." },
        ],
      },
    }),
  );
  await page.goto("/chat");
  await history(page).click();
  await page.getByRole("button", { name: /A saved morning briefing/ }).click();
  await expect(
    page.getByText("The scheduled briefing transcript."),
  ).toBeVisible();
  await expect(composer(page)).toHaveCount(0);
  await expect(newConversation(page)).toBeEnabled();
  await newConversation(page).click();
  await expect(composer(page)).toBeEnabled();
  await expect(page.locator(".message")).toHaveCount(0);
});

test("keeps both conversation controls visible on every workspace page at 320 pixels", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/chat");
  for (const name of [
    "Tasks",
    "Wiki",
    "Routines",
    "Apps",
    "Computer",
    "Settings",
    "Your conversation",
  ]) {
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
    await page.getByRole("link", { name, exact: true }).click();
    await expect(newConversation(page)).toBeVisible();
    await expect(history(page)).toBeVisible();
    for (const button of [
      newConversation(page),
      history(page),
      page.getByRole("button", { name: "Channels", exact: true }),
      page.getByRole("button", { name: "Notifications", exact: true }),
    ]) {
      const bounds = await button.boundingBox();
      expect(bounds).toBeTruthy();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await history(page).click();
  await expect(
    page.getByRole("dialog", { name: "Your conversations" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/chat-sessions-mobile-history.png",
  });
  await page.keyboard.press("Escape");
  await expect(history(page)).toBeFocused();
  await page.screenshot({ path: "test-results/chat-sessions-mobile.png" });
});
