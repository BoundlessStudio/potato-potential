import { expect, test, type Page } from "@playwright/test";
import type { AssistantModelSettings } from "../../packages/shared/src/index";

const original = { model: "default", provider: "custom:agent37" };
const chosen = { model: "openai/gpt-5.2", provider: "custom:agent37" };
const initial: AssistantModelSettings = {
  model: null,
  applied: true,
  defaultModel: original,
  models: [
    { ...original, label: "Agent37 default" },
    { ...chosen, label: "GPT-5.2" },
  ],
};
const section = (page: Page) =>
  page.getByRole("region", { name: "Default assistant model", exact: true });
const choiceValue = JSON.stringify([chosen.provider, chosen.model]);

test("starts unset, saves independently and persists the choice until it is cleared", async ({
  page,
}) => {
  let settings = structuredClone(initial);
  const writes: unknown[] = [],
    otherWrites: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      /\/api\/(profile|memory|budget)/.test(request.url())
    )
      otherWrites.push(request.url());
  });
  await page.route("**/api/assistant-model", (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      writes.push(body);
      settings = {
        ...settings,
        model: body.model,
        defaultModel: body.model || original,
        applied: true,
      };
    }
    return route.fulfill({ json: settings });
  });
  await page.goto("/settings");
  const card = section(page),
    select = card.getByLabel("Assistant model", { exact: true }),
    save = card.getByRole("button", { name: "Save model" });
  await expect(select).toHaveValue("");
  await expect(save).toBeDisabled();
  await expect(card).toContainText("iMessage, SMS, email, and Routines");
  await page.getByLabel("Your name", { exact: true }).fill("Unsaved profile");
  await select.selectOption(choiceValue);
  await save.click();
  await expect(save).toBeDisabled();
  expect(writes).toEqual([{ model: chosen, expectedModel: null }]);
  expect(otherWrites).toEqual([]);
  await expect(page.getByLabel("Your name", { exact: true })).toHaveValue(
    "Unsaved profile",
  );
  await page.reload();
  await expect(select).toHaveValue(choiceValue);
  await select.selectOption("");
  await save.click();
  await expect(save).toBeDisabled();
  expect(writes[1]).toEqual({ model: null, expectedModel: chosen });
  await page.reload();
  await expect(select).toHaveValue("");
});

test("recovers catalog failures and lets an interrupted save be retried", async ({
  page,
}) => {
  let failLoad = true,
    failSave = true;
  await page.route("**/api/assistant-model", (route) => {
    if (failLoad)
      return route.fulfill({
        status: 502,
        json: { error: { message: "Model catalog unavailable" } },
      });
    if (route.request().method() === "PUT" && failSave)
      return route.fulfill({
        status: 502,
        json: { error: { message: "Couldn’t confirm the model. Retry." } },
      });
    return route.fulfill({
      json:
        route.request().method() === "PUT"
          ? { ...initial, model: chosen, defaultModel: chosen }
          : initial,
    });
  });
  await page.goto("/settings");
  const card = section(page),
    select = card.getByLabel("Assistant model", { exact: true }),
    save = card.getByRole("button", { name: "Save model" });
  await expect(card.getByRole("alert")).toHaveText("Model catalog unavailable");
  await expect(select).toBeDisabled();
  failLoad = false;
  await card.getByRole("button", { name: "Reload models" }).click();
  await select.selectOption(choiceValue);
  await save.click();
  await expect(card.getByRole("alert")).toContainText("Retry");
  await expect(select).toHaveValue(choiceValue);
  failSave = false;
  await save.click();
  await expect(save).toBeDisabled();
  await expect(card.getByRole("alert")).toHaveCount(0);
});

test("shows pending application and fits a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/assistant-model", (route) =>
    route.fulfill({ json: { ...initial, model: chosen, applied: false } }),
  );
  await page.goto("/settings");
  const card = section(page);
  await expect(card.getByRole("status")).toContainText("hasn’t been confirmed");
  await expect(card.getByRole("button", { name: "Save model" })).toBeEnabled();
  await card.scrollIntoViewIfNeeded();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await card.screenshot({ path: ".cache/settings-model-mobile.png" });
});
