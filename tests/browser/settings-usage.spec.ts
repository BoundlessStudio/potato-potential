import { expect, test } from "@playwright/test";

const initial = {
  period: "2026-10",
  totalMicros: 1_280_114,
  byIntegration: {
    llm: {
      costMicros: 930_000,
      calls: 42,
      inputTokens: 184_032,
      outputTokens: 96_110,
    },
    brave: { costMicros: 350_000, calls: 70 },
    composio: { costMicros: 114, calls: 1 },
    perflo: { costMicros: 0, calls: 0 },
  },
};

test("shows monthly usage below Budget and refreshes without touching other drafts", async ({
  page,
}) => {
  let reads = 0;
  const writes: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "DELETE"].includes(request.method()))
      writes.push(request.url());
  });
  await page.route("**/api/usage", (route) => {
    reads++;
    return route.fulfill({
      json: {
        usage: {
          ...initial,
          totalMicros: reads > 1 ? 2_000_000 : initial.totalMicros,
        },
      },
    });
  });
  await page.goto("/settings");
  const card = page.getByRole("region", { name: "Usage", exact: true });
  await expect(card.getByText("$1.280114", { exact: true })).toBeVisible();
  await expect(card).toContainText("October 2026 (UTC)");
  await expect(card.getByText("113", { exact: true })).toBeVisible();
  await expect(card.getByText("280,142", { exact: true })).toBeVisible();
  await expect(
    card.getByRole("row", { name: "Connected apps 1 $0.000114" }),
  ).toBeVisible();
  await expect(card).toContainText("184,032 input · 96,110 output");
  expect(
    await card.evaluate(
      (el) => el.previousElementSibling?.querySelector("h2")?.textContent,
    ),
  ).toBe("Budget");
  await page.getByLabel("Your name", { exact: true }).fill("Unsaved profile");
  await page
    .getByRole("textbox", { name: "About you", exact: true })
    .fill("Unsaved memory");
  const budget = page
    .getByRole("region", { name: "Budget", exact: true })
    .getByLabel("Monthly limit · USD");
  await expect(budget).toHaveValue("5");
  await budget.fill("2.25");
  await card.getByRole("button", { name: "Refresh usage" }).click();
  await expect(card.getByText("$2.00", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Your name", { exact: true })).toHaveValue(
    "Unsaved profile",
  );
  await expect(
    page.getByRole("textbox", { name: "About you", exact: true }),
  ).toHaveValue("Unsaved memory");
  await expect(budget).toHaveValue("2.25");
  expect(writes).toEqual([]);
});

test("retries a failed read and labels retained figures after a failed refresh", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/usage", (route) =>
    fail
      ? route.fulfill({
          status: 502,
          json: { error: { message: "Usage is unavailable. Try again." } },
        })
      : route.fulfill({ json: { usage: initial } }),
  );
  await page.goto("/settings");
  const card = page.getByRole("region", { name: "Usage", exact: true });
  await expect(card.getByRole("alert")).toContainText("Usage is unavailable");
  await expect(card.getByRole("table")).toHaveCount(0);
  fail = false;
  await card.getByRole("button", { name: "Refresh usage" }).click();
  await expect(card.getByText("$1.280114", { exact: true })).toBeVisible();
  await expect(card.getByRole("alert")).toHaveCount(0);
  fail = true;
  await card.getByRole("button", { name: "Refresh usage" }).click();
  await expect(card.getByRole("alert")).toContainText(
    "Showing the last loaded figures",
  );
  await expect(card.getByText("$1.280114", { exact: true })).toBeVisible();
});

test("shows a true empty month and readable service details on a narrow screen", async ({
  page,
}) => {
  const empty = {
    period: "2026-10",
    totalMicros: 0,
    byIntegration: {
      llm: { costMicros: 0, calls: 0, inputTokens: 0, outputTokens: 0 },
      brave: { costMicros: 0, calls: 0 },
      composio: { costMicros: 0, calls: 0 },
      perflo: { costMicros: 0, calls: 0 },
    },
  };
  await page.route("**/api/usage", (route) =>
    route.fulfill({ json: { usage: empty } }),
  );
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/settings");
  const card = page.getByRole("region", { name: "Usage", exact: true });
  await expect(card).toContainText(
    "No managed-service usage recorded for this month yet",
  );
  await expect(card).toContainText(
    "Computer hosting, messaging, and services using your own API keys aren’t included",
  );
  await expect(card.getByRole("row")).toHaveCount(5);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await card.screenshot({ path: ".cache/settings-usage-mobile.png" });
});
