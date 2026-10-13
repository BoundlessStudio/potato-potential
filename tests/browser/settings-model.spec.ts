import { expect, test, type Page } from "@playwright/test";
import type { AssistantModelSettings } from "../../packages/shared/src/index";

const original = { model: "default", provider: "custom:agent37" };
const chosen = { model: "openai/gpt-5.2", provider: "custom:agent37" };
const mini = { model: "openai/gpt-5.2-mini", provider: "custom:agent37" };
const claude = {
  model: "anthropic/claude-sonnet-4-5",
  provider: "custom:agent37",
};
const initial: AssistantModelSettings = {
  model: null,
  applied: true,
  defaultModel: original,
  models: [
    { ...original, label: "Agent37 default" },
    { ...chosen, label: "GPT-5.2" },
    { ...mini, label: "GPT-5.2 Mini" },
    { ...claude, label: "Claude Sonnet 4.5" },
  ],
};
const section = (page: Page) =>
  page.getByRole("region", { name: "Default assistant model", exact: true });
const picker = (page: Page) =>
  section(page).getByRole("button", { name: /^Assistant model / });
const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "Choose assistant model" });
async function choose(page: Page, name: string) {
  await picker(page).click();
  await dialog(page).getByRole("option", { name, exact: true }).click();
}

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
    select = picker(page),
    save = card.getByRole("button", { name: "Save model" });
  await expect(select).toContainText("Use computer default");
  await expect(save).toBeDisabled();
  await expect(card).toContainText("iMessage, SMS, email, and Routines");
  await page.getByLabel("Your name", { exact: true }).fill("Unsaved profile");
  await choose(page, "GPT-5.2");
  await save.click();
  await expect(save).toBeDisabled();
  expect(writes).toEqual([{ model: chosen, expectedModel: null }]);
  expect(otherWrites).toEqual([]);
  await expect(page.getByLabel("Your name", { exact: true })).toHaveValue(
    "Unsaved profile",
  );
  await page.reload();
  await expect(select).toContainText("GPT-5.2");
  await choose(page, "Use computer default");
  await save.click();
  await expect(save).toBeDisabled();
  expect(writes[1]).toEqual({ model: null, expectedModel: chosen });
  await page.reload();
  await expect(select).toContainText("Use computer default");
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
    select = picker(page),
    save = card.getByRole("button", { name: "Save model" });
  await expect(card.getByRole("alert")).toHaveText("Model catalog unavailable");
  await expect(select).toBeDisabled();
  failLoad = false;
  await card.getByRole("button", { name: "Reload models" }).click();
  await choose(page, "GPT-5.2");
  await save.click();
  await expect(card.getByRole("alert")).toContainText("Retry");
  await expect(select).toContainText("GPT-5.2");
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
  await picker(page).click();
  await expect(
    dialog(page).getByRole("combobox", { name: "Search models" }),
  ).toBeFocused();
  await expect(
    dialog(page).getByRole("option", { name: "GPT-5.2", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(
    await dialog(page).evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return (
        bounds.left >= 0 &&
        bounds.right <= innerWidth &&
        bounds.top >= 0 &&
        bounds.bottom <= innerHeight
      );
    }),
  ).toBe(true);
  await dialog(page).screenshot({
    path: ".cache/settings-model-picker-mobile.png",
  });
  await page.keyboard.press("Escape");
  await expect(picker(page)).toBeFocused();
});

test("searches the live catalog by model or provider and supports keyboard selection", async ({
  page,
}) => {
  const custom = {
    model: "new-vendor/future-model",
    provider: "custom:some-router",
  };
  const writes: unknown[] = [];
  await page.route("**/api/assistant-model", (route) => {
    if (route.request().method() === "PUT")
      writes.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        ...initial,
        models: [...initial.models, { ...custom, label: "Future Model" }],
      },
    });
  });
  await page.goto("/settings");
  await picker(page).click();
  const search = dialog(page).getByRole("combobox", { name: "Search models" });
  await expect(search).toBeFocused();
  await expect(dialog(page).getByRole("option")).toHaveCount(
    initial.models.length + 1,
  );
  await expect(
    dialog(page).getByRole("option", { name: "Agent37 default", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog(page).getByRole("group", { name: "OpenAI", exact: true }),
  ).toBeVisible();
  await expect(
    dialog(page).getByRole("group", { name: "Anthropic", exact: true }),
  ).toBeVisible();
  await dialog(page).screenshot({
    path: ".cache/settings-model-picker-desktop.png",
  });
  await expect
    .poll(() =>
      dialog(page)
        .locator('img[src="/brand/models/openai.svg"]')
        .first()
        .evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await search.fill("cLaUdE SoNnEt");
  await expect(dialog(page).getByRole("option")).toHaveCount(1);
  await expect(
    dialog(page).getByRole("option", { name: "Claude Sonnet 4.5" }),
  ).toBeVisible();
  await search.fill("new-vendor");
  await expect(
    dialog(page).getByRole("option", { name: "Future Model" }),
  ).toBeVisible();
  await search.fill("does-not-exist");
  await expect(dialog(page).getByRole("status")).toContainText(
    "No models found",
  );
  await search.press("Enter");
  await expect(dialog(page)).toBeVisible();
  await search.fill("OPENAI");
  await expect(dialog(page).getByRole("option")).toHaveCount(2);
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(dialog(page)).toHaveCount(0);
  await expect(picker(page)).toContainText("GPT-5.2 Mini");
  await expect(picker(page)).toBeFocused();
  expect(writes).toEqual([]);
  await picker(page).click();
  await expect(search).toHaveValue("");
  await expect(
    dialog(page).getByRole("option", { name: "GPT-5.2 Mini", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await search.fill("Claude");
  await search.press("Escape");
  await expect(picker(page)).toContainText("GPT-5.2 Mini");
  await section(page).getByRole("button", { name: "Save model" }).click();
  expect(writes).toEqual([{ model: mini, expectedModel: null }]);
});

test("keeps unavailable selections clearable and preserves models with duplicate names on different routes", async ({
  page,
}) => {
  const unavailable = {
    model: "old-provider/retired-model",
    provider: "custom:old-router",
  };
  const direct = { model: chosen.model, provider: "openai" };
  let settings: AssistantModelSettings = {
    ...initial,
    model: unavailable,
    models: [...initial.models, { ...direct, label: "GPT-5.2" }],
  };
  const writes: unknown[] = [];
  await page.route("**/api/assistant-model", (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      writes.push(body);
      settings = { ...settings, model: body.model };
    }
    return route.fulfill({ json: settings });
  });
  await page.goto("/settings");
  await expect(picker(page)).toContainText("retired-model (unavailable)");
  await expect(
    section(page).getByRole("button", { name: "Save model" }),
  ).toBeDisabled();
  await picker(page).click();
  await expect(
    dialog(page).getByRole("option", { name: /retired-model/ }),
  ).toHaveAttribute("aria-disabled", "true");
  const search = dialog(page).getByRole("combobox", { name: "Search models" });
  await search.fill("GPT-5.2");
  await expect(dialog(page).getByRole("option")).toHaveCount(3);
  await dialog(page)
    .getByRole("option", { name: "GPT-5.2 openai", exact: true })
    .click();
  await section(page).getByRole("button", { name: "Save model" }).click();
  await expect(
    section(page).getByRole("button", { name: "Save model" }),
  ).toBeDisabled();
  expect(writes[0]).toEqual({ model: direct, expectedModel: unavailable });
  await choose(page, "Use computer default");
  await section(page).getByRole("button", { name: "Save model" }).click();
  await expect(
    section(page).getByRole("button", { name: "Save model" }),
  ).toBeDisabled();
  expect(writes[1]).toEqual({ model: null, expectedModel: direct });
});

test("shows one default option and clears a previously saved Agent37 default alias", async ({
  page,
}) => {
  let settings = {
    ...initial,
    model: original as AssistantModelSettings["model"],
  };
  const writes: unknown[] = [];
  await page.route("**/api/assistant-model", (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      writes.push(body);
      settings = { ...settings, model: body.model };
    }
    return route.fulfill({ json: settings });
  });
  await page.goto("/settings");
  await expect(picker(page)).toContainText("Use computer default");
  await picker(page).click();
  await expect(
    dialog(page).getByRole("option", { name: "Agent37 default", exact: true }),
  ).toHaveCount(0);
  const clear = dialog(page).getByRole("option", {
    name: "Use computer default",
    exact: true,
  });
  await expect(clear).toHaveAttribute("aria-selected", "true");
  await clear.click();
  await section(page).getByRole("button", { name: "Save model" }).click();
  await expect(
    section(page).getByRole("button", { name: "Save model" }),
  ).toBeDisabled();
  expect(writes).toEqual([{ model: null, expectedModel: original }]);
});
