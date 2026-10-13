import { expect, test, type Page } from "@playwright/test";

const initial = {
  monthlyCapMicros: 5_000_000,
  monthlyConsumedMicros: 1_250_000,
  monthlyRemainingMicros: 3_750_000,
  monthlyPeriod: "2026-10",
  creditRemainingMicros: 2_000_000,
};
const section = (page: Page) =>
  page.getByRole("region", { name: "Budget", exact: true });

test("keeps budget, credit and excluded costs visible while editing is hidden", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "DELETE"].includes(request.method()))
      writes.push(request.url());
  });
  await page.route("**/api/budget", (route) =>
    route.fulfill({ json: { budget: initial } }),
  );
  await page.goto("/settings");
  const card = section(page);
  await expect(card.getByText("$5.00", { exact: true })).toBeVisible();
  await expect(card.getByText("$1.25", { exact: true })).toBeVisible();
  await expect(card.getByText("$3.75", { exact: true })).toBeVisible();
  await expect(card.getByRole("note")).toContainText(
    "$2.00 in one-time credit",
  );
  await expect(card).toContainText(
    "Computer hosting, messaging, and services using your own API keys",
  );
  await expect(card).toContainText("UTC month");
  await expect(card.getByLabel("Monthly limit · USD")).toHaveCount(0);
  await expect(card.getByRole("button")).toHaveCount(0);
  await expect(card).not.toContainText("Changes apply immediately");
  await page.reload();
  await expect(card.getByText("$5.00", { exact: true })).toBeVisible();
  await expect(card.getByLabel("Monthly limit · USD")).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("recovers a failed budget read without editing and fits a narrow mobile screen", async ({
  page,
}) => {
  let failLoad = true;
  const methods: string[] = [];
  await page.route("**/api/budget", (route) => {
    methods.push(route.request().method());
    return failLoad
      ? route.fulfill({
          status: 503,
          json: { error: { message: "Budget service unavailable." } },
        })
      : route.fulfill({ json: { budget: initial } });
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/settings");
  const card = section(page);
  await expect(card.getByRole("alert")).toHaveText(
    "Budget service unavailable.",
  );
  await expect(card.getByLabel("Monthly limit · USD")).toHaveCount(0);
  failLoad = false;
  await card.getByRole("button", { name: "Reload budget" }).click();
  await expect(card.getByText("$5.00", { exact: true })).toBeVisible();
  await expect(card.getByRole("alert")).toHaveCount(0);
  await expect(card.getByRole("button")).toHaveCount(0);
  expect(methods.length).toBeGreaterThanOrEqual(2);
  expect(methods.every((method) => method === "GET")).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await card.screenshot({ path: ".cache/settings-budget-mobile.png" });
});
