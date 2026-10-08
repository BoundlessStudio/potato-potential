import { expect, test } from "@playwright/test";

test("customers confirm updates and can recover progress after leaving Computer", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let status: any = {
    installedTemplate: "boundless-hermes-desktop@2",
    availableTemplate: "boundless-hermes-desktop@4",
    updateAvailable: true,
    instanceStatus: "running",
    screen: { width: 1440, height: 900 },
    operation: null,
  };
  const actions: unknown[] = [];
  await page.route("**/api/computer/maintenance", (route) => {
    if (route.request().method() === "POST") {
      const data = route.request().postDataJSON();
      actions.push(data);
      status.operation = { action: data.action, phase: "checking" };
      return route.fulfill({ status: 202, json: { queued: true } });
    }
    return route.fulfill({ json: status });
  });
  await page.route("**/api/computer/status", (route) =>
    route.fulfill({ json: status }),
  );
  await page.goto("/");
  await page.getByRole("link", { name: "Computer", exact: true }).click();
  const banner = page.locator("header:has(h1)");
  await expect(
    banner.getByRole("button", { name: "Restart computer", exact: true }),
  ).toBeEnabled();
  await expect(
    banner.getByRole("button", { name: "Update computer", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".computer-settings button")).toHaveCount(1);
  await expect(
    banner.getByRole("button", { name: "Refresh computer", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator(".computer-settings").getByRole("button", { name: "Refresh computer", exact: true }),
  ).toHaveText("");
  await banner.screenshot({
    path: ".cache/computer-maintenance-banner-desktop.png",
  });
  await expect(
    page.locator(".computer-version").getByRole("img", {
      name: "Update available: boundless-hermes-desktop@4",
      exact: true,
    }),
  ).toHaveAttribute("title", "Update available: boundless-hermes-desktop@4");
  await expect(
    page.getByText("A tested update is ready:", { exact: false }),
  ).toHaveCount(0);
  await page
    .locator(".computer-settings")
    .screenshot({ path: ".cache/computer-version-update-available.png" });
  await expect(
    page.getByRole("button", { name: "Update computer", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Update computer", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Update this computer?" }),
  ).toBeVisible();
  await expect(page.getByText(/Open browser forms and work/)).toBeVisible();
  await page.getByRole("button", { name: "Keep working", exact: true }).click();
  expect(actions).toEqual([]);
  await page
    .getByRole("button", { name: "Resource usage", exact: true })
    .click();
  await banner
    .getByRole("button", { name: "Update computer", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Update this computer?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep working", exact: true }).click();
  expect(actions).toEqual([]);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page
    .getByRole("button", { name: "Update computer", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Install update and restart", exact: true })
    .click();
  await expect(
    page.getByText("Checking that everything is ready…"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Restart computer", exact: true }),
  ).toBeDisabled();
  expect(actions).toEqual([{ action: "update" }]);
  await page.reload();
  await page.getByRole("link", { name: "Computer", exact: true }).click();
  await expect(
    page.getByText("Checking that everything is ready…"),
  ).toBeVisible();
  expect(actions).toHaveLength(1);
  status = {
    ...status,
    installedTemplate: "boundless-hermes-desktop@4",
    updateAvailable: false,
    screen: { width: 540, height: 1140 },
    operation: { action: "update", phase: "completed" },
  };
  await page
    .getByRole("button", { name: "Refresh computer", exact: true })
    .click();
  await expect(
    page.getByText("540 × 1140 · Portrait", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Update complete. The computer is ready."),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".computer-version")
      .getByRole("img", { name: "Up to date", exact: true }),
  ).toHaveAttribute("title", "Up to date");
  await expect(
    page.getByText("Your computer has the current update."),
  ).toHaveCount(0);
  await expect(page.locator(".computer-operation")).toHaveCount(0);
  await page
    .locator(".computer-settings")
    .screenshot({ path: ".cache/computer-version-current.png" });
  await expect(
    page.getByRole("button", { name: "Update computer", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Restart computer", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Restart this computer?" }),
  ).toBeVisible();
  await expect(page.getByText(/using its installed version/)).toBeVisible();
  await page.getByRole("button", { name: "Restart now", exact: true }).click();
  expect(actions).toEqual([{ action: "update" }, { action: "restart" }]);
  status.operation = {
    action: "restart",
    phase: "failed",
    error:
      "Couldn’t confirm the computer is ready. Check its status and retry.",
  };
  await page
    .getByRole("button", { name: "Refresh computer", exact: true })
    .click();
  await expect(page.getByText(status.operation.error)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Restart computer", exact: true }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .locator(".computer-settings")
    .screenshot({ path: ".cache/computer-settings-mobile.png" });
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(
    banner.getByRole("button", { name: "Restart computer", exact: true }),
  ).toBeVisible();
  await expect(
    banner.getByRole("button", { name: "Update computer", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await banner.screenshot({
    path: ".cache/computer-maintenance-banner-mobile.png",
  });
  expect(errors).toEqual([]);
});

test("regular customers find maintenance in Computer and general preferences in Settings", async ({
  page,
}) => {
  let maintenanceRequests = 0;
  page.on("request", (req) => {
    if (req.url().endsWith("/api/computer/maintenance")) maintenanceRequests++;
  });
  await page.route("**/api/me", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), operator: false },
    });
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A companion of your own." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Restart computer", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Update computer", exact: true }),
  ).toHaveCount(0);
  expect(maintenanceRequests).toBe(0);
  await page.getByRole("link", { name: "Computer", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Restart computer", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Update computer", exact: true }),
  ).toBeEnabled();
});
