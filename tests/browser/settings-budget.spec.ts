import { expect, test, type Page } from "@playwright/test";

const initial = {
  monthlyCapMicros: 5_000_000,
  monthlyConsumedMicros: 1_250_000,
  monthlyRemainingMicros: 3_750_000,
  monthlyPeriod: "2026-10",
  creditRemainingMicros: 0,
};
const section = (page: Page) =>
  page.getByRole("region", { name: "Budget", exact: true });

test("shows current usage and saves the budget independently from profile and memory drafts", async ({
  page,
}) => {
  let budget = { ...initial };
  const writes: unknown[] = [],
    otherWrites: string[] = [];
  page.on("request", (request) => {
    if (
      ["POST", "PUT", "DELETE"].includes(request.method()) &&
      /\/api\/(profile|memory)/.test(request.url())
    )
      otherWrites.push(request.url());
  });
  await page.route("**/api/budget", (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      writes.push(body);
      budget = {
        ...budget,
        monthlyCapMicros: body.micros,
        monthlyRemainingMicros: Math.max(
          0,
          body.micros - budget.monthlyConsumedMicros,
        ),
      };
    }
    return route.fulfill({ json: { budget } });
  });
  await page.goto("/settings");
  const card = section(page),
    input = card.getByLabel("Monthly limit · USD"),
    save = card.getByRole("button", { name: "Save budget" });
  await expect(input).toHaveValue("5");
  await expect(card.getByText("$1.25", { exact: true })).toBeVisible();
  await expect(card.getByText("$3.75", { exact: true })).toBeVisible();
  await expect(save).toBeDisabled();
  await page.getByLabel("Your name", { exact: true }).fill("Unsaved profile");
  await page
    .getByRole("textbox", { name: "About you", exact: true })
    .fill("Unsaved memory");
  await input.fill("7.25");
  await save.click();
  await expect(save).toBeDisabled();
  expect(writes).toEqual([{ micros: 7_250_000, expectedMicros: 5_000_000 }]);
  await expect(card.getByText("$7.25", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Your name", { exact: true })).toHaveValue(
    "Unsaved profile",
  );
  await expect(
    page.getByRole("textbox", { name: "About you", exact: true }),
  ).toHaveValue("Unsaved memory");
  await expect(
    page.getByRole("textbox", { name: "SOUL", exact: true }),
  ).toHaveCount(0);
  expect(otherWrites).toEqual([]);
  await page.reload();
  await expect(input).toHaveValue("7.25");
});

test("rejects invalid amounts, accepts zero and explains extra credit and excluded costs", async ({
  page,
}) => {
  const writes: unknown[] = [];
  await page.route("**/api/budget", (route) => {
    const budget = { ...initial, creditRemainingMicros: 2_000_000 };
    if (route.request().method() === "PUT") {
      writes.push(route.request().postDataJSON());
      budget.monthlyCapMicros = 0;
      budget.monthlyRemainingMicros = 0;
    }
    return route.fulfill({ json: { budget } });
  });
  await page.goto("/settings");
  const card = section(page),
    input = card.getByLabel("Monthly limit · USD"),
    save = card.getByRole("button", { name: "Save budget" });
  await expect(input).toHaveValue("5");
  await expect(card.getByRole("note")).toContainText(
    "$2.00 in one-time credit",
  );
  await expect(card).toContainText(
    "Computer hosting, messaging, and services using your own API keys",
  );
  await expect(card).toContainText("UTC month");
  for (const invalid of ["", "-1", "100.01"]) {
    await input.fill(invalid);
    await expect(save).toBeDisabled();
  }
  expect(writes).toEqual([]);
  await input.fill("0");
  await save.click();
  await expect(save).toBeDisabled();
  expect(writes).toEqual([{ micros: 0, expectedMicros: 5_000_000 }]);
  await expect(card.getByRole("note")).toContainText(
    "including when the limit is $0",
  );
});

test("recovers a failed load and preserves a failed save until an explicit reload", async ({
  page,
}) => {
  let failLoad = true,
    failSave = true;
  await page.route("**/api/budget", (route) => {
    if (route.request().method() === "GET" && failLoad)
      return route.fulfill({
        status: 503,
        json: { error: { message: "Budget service unavailable." } },
      });
    if (route.request().method() === "PUT" && failSave)
      return route.fulfill({
        status: 502,
        json: { error: { message: "Couldn’t save this limit. Try again." } },
      });
    return route.fulfill({ json: { budget: initial } });
  });
  await page.goto("/settings");
  const card = section(page),
    input = card.getByLabel("Monthly limit · USD"),
    save = card.getByRole("button", { name: "Save budget" });
  await expect(card.getByRole("alert")).toHaveText(
    "Budget service unavailable.",
  );
  await expect(input).toBeDisabled();
  await expect(save).toBeDisabled();
  failLoad = false;
  await card
    .getByRole("button", { name: "Reload budget", exact: true })
    .click();
  await expect(input).toHaveValue("5");
  await input.fill("2");
  await save.click();
  await expect(card.getByRole("alert")).toContainText(
    "Couldn’t save this limit",
  );
  await expect(input).toHaveValue("2");
  await expect(save).toBeEnabled();
  await expect(card.getByText("$5.00", { exact: true })).toBeVisible();
  await card
    .getByRole("button", { name: "Discard edits & reload budget" })
    .click();
  await expect(input).toHaveValue("5");
  await expect(card.getByRole("alert")).toHaveCount(0);
});

test("requires reloading an operator change before saving and fits a narrow mobile screen", async ({
  page,
}) => {
  let reads = 0;
  const writes: unknown[] = [];
  await page.route("**/api/budget", (route) => {
    if (route.request().method() === "GET") {
      reads++;
      return route.fulfill({
        json: {
          budget: {
            ...initial,
            monthlyCapMicros: reads > 1 ? 3_000_000 : 5_000_000,
          },
        },
      });
    }
    const body = route.request().postDataJSON();
    writes.push(body);
    if (body.expectedMicros === 5_000_000)
      return route.fulfill({
        status: 409,
        json: {
          error: {
            message:
              "Your budget changed elsewhere. Reload the current budget before saving.",
          },
        },
      });
    return route.fulfill({
      json: {
        budget: {
          ...initial,
          monthlyCapMicros: body.micros,
          monthlyRemainingMicros: body.micros - initial.monthlyConsumedMicros,
        },
      },
    });
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/settings");
  const card = section(page),
    input = card.getByLabel("Monthly limit · USD"),
    save = card.getByRole("button", { name: "Save budget" });
  await expect(input).toHaveValue("5");
  await input.fill("2");
  await save.click();
  await expect(card.getByRole("alert")).toContainText("changed elsewhere");
  await expect(input).toHaveValue("2");
  await card
    .getByRole("button", { name: "Discard edits & reload budget" })
    .click();
  await expect(input).toHaveValue("3");
  await input.fill("2");
  await save.click();
  await expect(save).toBeDisabled();
  expect(writes).toEqual([
    { micros: 2_000_000, expectedMicros: 5_000_000 },
    { micros: 2_000_000, expectedMicros: 3_000_000 },
  ]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await card.screenshot({ path: ".cache/settings-budget-mobile.png" });
});
