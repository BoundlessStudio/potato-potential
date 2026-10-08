import { expect, test, type Page } from "@playwright/test";

const messageId = "22222222222222222222222222222222";
const emailId = "33333333333333333333333333333333";
const sessions = [
  {
    id: "11111111111111111111111111111111",
    channel: "web",
    title: "Private web conversation",
    createdAt: "2026-10-08T12:00:00Z",
  },
  {
    id: emailId,
    channel: "email",
    title: "Notes for Friday",
    createdAt: "2026-10-07T12:00:00Z",
  },
  {
    id: messageId,
    channel: "imessage",
    title: "A message from the train",
    createdAt: "2026-10-08T12:00:00Z",
  },
  {
    id: "44444444444444444444444444444444",
    channel: "scheduled",
    title: "Background routine",
    createdAt: "2026-10-08T13:00:00Z",
  },
];
const status = {
  email: "ready",
  imessage: "connected",
  voice: "hosted",
  sms: null,
};
const calls = [
  {
    id: "empty-call",
    status: "completed",
    direction: "outbound",
    started_at: "2026-10-06T12:00:00Z",
  },
  {
    id: "recent-call",
    status: "completed",
    direction: "inbound",
    started_at: "2026-10-08T12:00:00Z",
    transcript: "You: Can we plan tomorrow?\n\nPip: Let’s make some room.",
  },
];
const channels = (page: Page) =>
  page
    .locator(".topbar-actions")
    .getByRole("button", { name: "Channels", exact: true });
const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "One companion, wherever you are" });

async function fixture(page: Page) {
  await page.route("**/api/me", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      json: {
        ...body,
        agent: {
          ...body.agent,
          agentEmail: "pip-has-a-very-long-email-address@inboxmail.com",
          connect: {
            ...body.agent.connect,
            command: "connect @pip-companion",
            number: "+14165550100",
            smsLink: "sms:+14165550100?body=connect%20%40pip-companion",
          },
        },
      },
    });
  });
  await page.route("**/api/channels", (route) =>
    route.fulfill({ json: status }),
  );
  await page.route("**/api/sessions", (route) =>
    route.fulfill({ json: { sessions } }),
  );
  await page.route("**/api/calls", (route) =>
    route.fulfill({ json: { calls } }),
  );
  await page.route(`**/api/sessions/${messageId}`, (route) =>
    route.fulfill({
      json: {
        history: [
          { role: "system", content: "Hidden system context" },
          { role: "user", content: "Can we plan the afternoon?" },
          { role: "assistant", content: "Let’s protect a little quiet time." },
          { role: "tool", content: "Hidden tool details" },
        ],
      },
    }),
  );
  await page.route(`**/api/sessions/${emailId}`, (route) =>
    route.fulfill({
      json: { history: [{ role: "user", content: "Friday notes for Pip" }] },
    }),
  );
  await page.route("**/api/calls/empty-call/transcript", (route) =>
    route.fulfill({ json: { transcript: "" } }),
  );
}

test("uses the saved contact for shared-line messages and calls without changing the workspace", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await fixture(page);
  await page.goto("/settings");
  await page
    .getByLabel("Your name", { exact: true })
    .fill("Unfinished profile edit");
  await channels(page).click();
  const modal = dialog(page);
  await expect(
    modal.getByRole("status", { name: "Connection status", exact: true }),
  ).toHaveText("Connected");
  await expect(modal.locator(".channel-status")).toHaveCount(1);
  await expect(modal.locator(".channel-card .channel-status")).toHaveCount(0);
  await expect(modal.getByRole("link", { name: "Send email" })).toHaveAttribute(
    "href",
    "mailto:pip-has-a-very-long-email-address@inboxmail.com",
  );
  await expect(
    modal.getByRole("region", { name: "iMessage", exact: true }),
  ).toContainText("saved contact card Inkbox sent when you connected");
  await expect(
    modal.getByRole("region", { name: "Calls", exact: true }),
  ).toContainText("saved contact card Inkbox sent in Messages");
  await expect(modal.locator('a[href^="sms:"], a[href^="tel:"]')).toHaveCount(
    0,
  );
  await expect(modal).not.toContainText("+14165550100");
  await expect(modal.getByRole("button", { name: /^Copy / })).toHaveCount(1);
  await expect(modal.locator("a.channel-action")).toHaveCount(1);
  await modal.getByRole("button", { name: "Copy email address" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "pip-has-a-very-long-email-address@inboxmail.com",
  );
  await page.getByRole("button", { name: "Dismiss message" }).click();
  await page.screenshot({ path: "test-results/channels-contact-desktop.png" });
  await page.keyboard.press("Escape");
  await expect(channels(page)).toBeFocused();
  await expect(page.getByLabel("Your name", { exact: true })).toHaveValue(
    "Unfinished profile edit",
  );
  await expect(page).toHaveURL(/\/settings$/);
});

test("uses the router only to connect shared messaging and calls", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await fixture(page);
  await page.route("**/api/channels", (route) =>
    route.fulfill({
      json: {
        ...status,
        imessage: "connect_required",
      },
    }),
  );
  await page.goto("/chat");
  await channels(page).click();
  const modal = dialog(page);
  await expect(
    modal.getByRole("status", { name: "Connection status", exact: true }),
  ).toHaveText("Connection needed");
  await expect(modal.locator(".channel-status")).toHaveCount(1);
  await expect(
    modal.getByRole("link", { name: "Connect Messages" }),
  ).toHaveAttribute("href", "sms:+14165550100?body=connect%20%40pip-companion");
  await expect(
    modal.getByRole("region", { name: "Calls", exact: true }).getByRole("link"),
  ).toHaveCount(0);
  await expect(
    modal.getByRole("region", { name: "Calls", exact: true }),
  ).toContainText("Connect iMessage, then call from the contact card");
  await expect(modal.locator('a[href^="tel:"]')).toHaveCount(0);
  await expect(modal).not.toContainText("+14165550100");
  await expect(
    modal.getByRole("region", { name: "SMS", exact: true }),
  ).toHaveCount(0);
  await modal.getByRole("button", { name: "Copy connection message" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "connect @pip-companion",
  );
});

test("calls the dedicated number independently of shared iMessage setup and keeps SMS distinct", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await fixture(page);
  await page.route("**/api/channels", (route) =>
    route.fulfill({
      json: {
        ...status,
        imessage: "connect_required",
        sms: { number: "+14165550199", status: "pending" },
      },
    }),
  );
  await page.goto("/chat");
  await channels(page).click();
  const modal = dialog(page);
  await expect(
    modal.getByRole("link", { name: "Connect Messages" }),
  ).toHaveAttribute("href", "sms:+14165550100?body=connect%20%40pip-companion");
  await expect(
    modal.getByRole("link", { name: "Call", exact: true }),
  ).toHaveAttribute("href", "tel:+14165550199");
  await expect(
    modal.getByRole("region", { name: "Calls", exact: true }),
  ).toContainText("Call this dedicated number");
  await expect(
    modal.getByRole("region", { name: "SMS", exact: true }),
  ).toContainText("Setup in progress");
  await expect(modal.getByRole("link", { name: "Open SMS" })).toHaveAttribute(
    "href",
    "sms:+14165550199",
  );
  await modal.getByRole("button", { name: "Copy phone number" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "+14165550199",
  );
});

test("withholds router actions while connection status is loading or unavailable", async ({
  page,
}) => {
  await fixture(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/channels", async (route) => {
    await held;
    await route.fulfill({
      status: 502,
      json: { error: { message: "Temporary outage" } },
    });
  });
  await page.goto("/chat");
  await channels(page).click();
  const modal = dialog(page);
  await expect(
    modal.getByRole("status", { name: "Connection status", exact: true }),
  ).toHaveText("Checking…");
  await expect(modal.locator('a[href^="sms:"], a[href^="tel:"]')).toHaveCount(
    0,
  );
  release();
  await expect(
    modal.getByRole("status", { name: "Connection status", exact: true }),
  ).toHaveText("Status unavailable");
  await expect(modal.getByRole("alert")).toContainText(
    "connection status couldn’t be loaded",
  );
  await expect(modal.locator('a[href^="sms:"], a[href^="tel:"]')).toHaveCount(
    0,
  );
  await expect(modal).not.toContainText("+14165550100");
});

test("opens only channel message history in the dialog and preserves the active web chat", async ({
  page,
}) => {
  await fixture(page);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "DELETE"].includes(request.method()))
      writes.push(request.url());
  });
  await page.goto("/chat");
  const composer = page.getByRole("textbox", {
    name: "Message your companion",
  });
  await composer.fill("An unsent web draft");
  await channels(page).click();
  const modal = dialog(page);
  await modal.getByRole("tab", { name: "Messages", exact: true }).click();
  await expect(modal.locator(".channel-history-list > button")).toHaveCount(2);
  await expect(
    modal.locator(".channel-history-list > button").first(),
  ).toContainText("A message from the train");
  await expect(modal).not.toContainText("Private web conversation");
  await expect(modal).not.toContainText("Background routine");
  const item = modal.getByRole("button", { name: /A message from the train/ });
  await item.click();
  await expect(
    modal.getByRole("heading", { name: "A message from the train" }),
  ).toBeFocused();
  await expect(modal).toContainText("Can we plan the afternoon?");
  await expect(modal).toContainText("Let’s protect a little quiet time.");
  await expect(modal).not.toContainText("Hidden system context");
  await expect(modal).not.toContainText("Hidden tool details");
  await expect(modal).toContainText("Continue this conversation in iMessage");
  await page.screenshot({ path: "test-results/channels-message-history.png" });
  await modal.getByRole("button", { name: "Back to messages" }).click();
  await expect(item).toBeFocused();
  await modal.getByRole("button", { name: /Notes for Friday/ }).click();
  await expect(modal).toContainText("Friday notes for Pip");
  await page.keyboard.press("Escape");
  await expect(composer).toHaveValue("An unsent web draft");
  expect(writes).toEqual([]);
});

test("shows call transcripts in place, handles unavailable transcripts, and retries failed history independently", async ({
  page,
}) => {
  await fixture(page);
  let fail = true;
  await page.route("**/api/calls", (route) =>
    fail
      ? route.fulfill({
          status: 502,
          json: { error: { message: "Temporary outage" } },
        })
      : route.fulfill({ json: { calls } }),
  );
  await page.goto("/chat");
  await channels(page).click();
  const modal = dialog(page);
  await expect(modal.getByRole("link", { name: "Send email" })).toBeVisible();
  await modal.getByRole("tab", { name: "Messages", exact: true }).click();
  await expect(
    modal.getByRole("button", { name: /A message from the train/ }),
  ).toBeVisible();
  await modal.getByRole("tab", { name: "Calls", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText(
    "call history couldn’t be loaded",
  );
  fail = false;
  await modal.getByRole("button", { name: "Try again" }).click();
  await expect(
    modal.locator(".channel-history-list > button").first(),
  ).toContainText("Incoming call");
  await modal.getByRole("button", { name: /Incoming call/ }).click();
  await expect(modal).toContainText("Can we plan tomorrow?");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await modal.getByRole("button", { name: "Back to calls" }).click();
  await modal.getByRole("button", { name: /Outgoing call/ }).click();
  await expect(modal).toContainText(
    "A transcript isn’t available for this call yet",
  );
});

test("does not show old messages after changing tabs while a transcript is loading", async ({
  page,
}) => {
  await fixture(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/sessions/${messageId}`, async (route) => {
    await held;
    await route.fulfill({
      json: {
        history: [{ role: "assistant", content: "Late message transcript" }],
      },
    });
  });
  await page.goto("/chat");
  await channels(page).click();
  const modal = dialog(page);
  await modal.getByRole("tab", { name: "Messages", exact: true }).click();
  await modal.getByRole("button", { name: /A message from the train/ }).click();
  await expect(modal.getByRole("tabpanel").getByRole("status")).toContainText(
    "Loading conversation",
  );
  await modal.getByRole("tab", { name: "Calls", exact: true }).click();
  release();
  await modal.getByRole("button", { name: /Incoming call/ }).click();
  await expect(modal).toContainText("Can we plan tomorrow?");
  await expect(modal).not.toContainText("Late message transcript");
});

test("fits narrow screens and supports keyboard tabs, empty histories, and closing focus", async ({
  page,
}) => {
  await fixture(page);
  await page.route("**/api/sessions", (route) =>
    route.fulfill({ json: { sessions: [] } }),
  );
  await page.route("**/api/calls", (route) =>
    route.fulfill({ json: { calls: [] } }),
  );
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/tasks");
  await channels(page).click();
  const modal = dialog(page);
  await expect(modal.getByRole("link", { name: "Send email" })).toBeVisible();
  expect(
    await modal.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/channels-contact-mobile.png" });
  const contactTab = modal.getByRole("tab", { name: "Contact", exact: true });
  await contactTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    modal.getByRole("tab", { name: "Messages", exact: true }),
  ).toBeFocused();
  await expect(modal).toContainText("Your messages, all together");
  await page.keyboard.press("End");
  await expect(
    modal.getByRole("tab", { name: "Calls", exact: true }),
  ).toBeFocused();
  await expect(modal).toContainText(
    "Your calls and their transcripts will appear here",
  );
  await page.screenshot({ path: "test-results/channels-calls-mobile.png" });
  await page.keyboard.press("Escape");
  await expect(channels(page)).toBeFocused();
});
