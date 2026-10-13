import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/computer/status", (route) =>
    route.fulfill({
      json: {
        instanceStatus: "running",
        canManage: true,
        operation: null,
        screen: { width: 540, height: 1140 },
      },
    }),
  );
  await page.route("**/api/computer/takeover", (route) =>
    route.fulfill({ json: { control: "customer" } }),
  );
});

test("keeps the desktop ready across computer views, workspace pages, and closing the chat preview", async ({
  page,
}) => {
  await page.goto("/computer");
  await page
    .getByRole("button", { name: "Connect to desktop", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Reconnect computer", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Take over", exact: true }).click();
  await expect(
    page.getByText("You have control", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Resource usage", exact: true })
    .click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Reconnect computer", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText("You have control", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("link", { name: "Tasks", exact: true }).click();
  await page.getByRole("link", { name: "Computer", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Reconnect computer", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("link", { name: "Your conversation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Preview computer", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Reconnect computer", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Close computer", exact: true })
    .click();
  await page.getByRole("link", { name: "Computer", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Reconnect computer", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Take over", exact: true }),
  ).toBeEnabled();
});

test("releases input on a browser visibility change and leaves the desktop ready", async ({
  page,
}) => {
  await page.goto("/chat");
  await page
    .getByRole("button", { name: "Preview computer", exact: true })
    .click();
  await page.getByRole("button", { name: "Take over", exact: true }).click();
  await expect(
    page.getByText("You have control", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByText("You have control", { exact: true })).toHaveCount(
    0,
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    page.getByRole("button", { name: "Reconnect computer", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Take over", exact: true }),
  ).toBeEnabled();
});

test("does not grant delayed input control after leaving and returning to a browser tab", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/computer/takeover", async (route) => {
    await pending;
    await route.fulfill({ json: { control: "customer" } });
  });
  await page.goto("/chat");
  await page
    .getByRole("button", { name: "Preview computer", exact: true })
    .click();
  await page.getByRole("button", { name: "Take over", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Waiting for companion…" }),
  ).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  release();
  await expect(
    page.getByRole("button", { name: "Take over", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText("You have control", { exact: true })).toHaveCount(
    0,
  );
});
