import { expect, test } from "@playwright/test";

const pages = [
  ["chat", "Your conversation", "Pip"],
  ["tasks", "Tasks", "Good things, getting done."],
  ["wiki", "Wiki", "A shared little memory."],
  ["routines", "Routines", "Make a little rhythm."],
  ["apps", "Apps", "Good company for your companion."],
  ["computer", "Computer", "Computer"],
  ["settings", "Settings", "A companion of your own."],
] as const;

for (const [path, label, heading] of pages) {
  test(`opens /${path} directly and retains the page after reload`, async ({
    page,
  }) => {
    const response = await page.goto(`/${path}`);
    expect(response?.status()).toBe(200);
    const active = page.getByRole("link", { name: label, exact: true });
    await expect(active).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/${path}$`));
    await expect(active).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  });
}

test("replaces the signed-in root with chat without adding a history entry", async ({
  page,
}) => {
  await page.goto("/signin");
  await expect(page).toHaveURL(/\/chat$/);
  await page.goto("/wiki");
  await expect(
    page.getByRole("heading", { name: "A shared little memory." }),
  ).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL(/\/chat$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/wiki$/);
  await expect(
    page.getByRole("heading", { name: "A shared little memory." }),
  ).toBeVisible();
});

test("keeps anonymous visitors on the public homepage", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("boundless-demo-user", "signed-out"),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Join the beta list", exact: true }),
  ).toBeEnabled();
  await expect(page).toHaveURL("/");
  await expect(page.locator(".app-shell")).toHaveCount(0);
});

test("updates every URL and supports Back and Forward while preserving a chat draft", async ({
  page,
}) => {
  await page.goto("/chat");
  const message = page.getByRole("textbox", { name: "Message your companion" });
  await message.fill("Keep this draft while I browse.");
  let accountReads = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/me") accountReads++;
  });
  for (const [path, label, heading] of pages.slice(1)) {
    const link = page.getByRole("link", { name: label, exact: true });
    await expect(link).toHaveAttribute("href", `/${path}`);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/${path}$`));
    await expect(link).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expect(page).toHaveTitle(`${label} — Potato Potential`);
  }
  for (const [path, label, heading] of pages.slice(0, -1).reverse()) {
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/${path}$`));
    await expect(
      page.getByRole("link", { name: label, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  }
  await expect(message).toHaveValue("Keep this draft while I browse.");
  await page.goForward();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(
    page.getByRole("heading", { name: "Good things, getting done." }),
  ).toBeVisible();
  expect(accountReads).toBe(0);
});

test("supports opening a workspace link in a new tab", async ({
  page,
  context,
}) => {
  await page.goto("/chat");
  const popupReady = context.waitForEvent("page");
  await page
    .getByRole("link", { name: "Wiki", exact: true })
    .click({ modifiers: ["ControlOrMeta"] });
  const popup = await popupReady;
  await expect(popup).toHaveURL(/\/wiki$/);
  await expect(
    popup.getByRole("heading", { name: "A shared little memory." }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/chat$/);
  await popup.close();
});

test("closes mobile navigation after routing and returns to the homepage on sign-out", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/chat");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Tasks", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.locator(".sidebar.mobile-open")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Good things, getting done." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("button", { name: "Join the beta list", exact: true }),
  ).toBeEnabled();
});
