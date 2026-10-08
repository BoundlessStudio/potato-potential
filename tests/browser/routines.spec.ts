import { expect, test, type Page } from "@playwright/test";
import { routineNotificationSuffix, type Cron } from "@boundless/shared";

async function fixture(page: Page, extra: Partial<Cron> = {}) {
  const routine: Cron = {
    id: "123456789abc",
    name: "A lighter morning",
    prompt: "Review my calendar." + routineNotificationSuffix,
    schedule: "30 8 * * 1-5",
    timezone: "America/Toronto",
    enabled: true,
    agent: "hermes",
    profile: null,
    last_run: 1791464400,
    next_run: 2_000_000_000,
    ...extra,
  };
  const patches: Record<string, unknown>[] = [];
  let fail = false;
  await page.route("**/api/routines", (route) =>
    route.fulfill({
      json: {
        routines: [routine],
        runs: [
          {
            cronId: routine.id,
            name: "Earlier check-in",
            ran_at: 1791464400,
            status: "triggered",
            outcome: "completed",
            session_id: null,
          },
        ],
      },
    }),
  );
  await page.route("**/api/routines/123456789abc", async (route) => {
    expect(route.request().method()).toBe("PATCH");
    const body = route.request().postDataJSON();
    patches.push(body);
    if (fail)
      return route.fulfill({
        status: 400,
        json: { error: { message: "That schedule needs another look." } },
      });
    Object.assign(routine, body);
    if (["schedule", "timezone", "enabled"].some((key) => key in body))
      routine.next_run = routine.enabled ? 2_000_003_600 : null;
    return route.fulfill({ json: { routine } });
  });
  await page.goto("/routines");
  await expect(
    page.getByRole("heading", { name: "Make a little rhythm." }),
  ).toBeVisible();
  return {
    routine,
    patches,
    fail: (value: boolean) => {
      fail = value;
    },
  };
}
async function edit(page: Page, name = "A lighter morning") {
  await page.getByRole("button", { name: `Edit ${name}`, exact: true }).click();
  return page.getByRole("dialog", { name: "A little change of rhythm" });
}

test("renames in place without moving the next run or losing check-in history", async ({
  page,
}) => {
  const { patches, routine } = await fixture(page);
  const dialog = await edit(page);
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(
    "A lighter morning",
  );
  await expect(dialog.getByLabel("What should your agent do?")).toHaveValue(
    "Review my calendar.",
  );
  await expect(
    dialog.getByRole("button", { name: "Save changes" }),
  ).toBeDisabled();
  await dialog.getByLabel("Name", { exact: true }).fill("A gentler morning");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toHaveCount(0);
  expect(patches).toEqual([{ name: "A gentler morning" }]);
  expect(routine.next_run).toBe(2_000_000_000);
  await expect(
    page.getByRole("heading", { name: "A gentler morning" }),
  ).toBeVisible();
  await expect(
    page.getByText("Earlier check-in", { exact: true }),
  ).toBeVisible();
});

test("edits all supported fields while keeping app notification instructions once", async ({
  page,
}) => {
  const { patches } = await fixture(page, { agent: "codex" });
  const dialog = await edit(page);
  await dialog.getByLabel("Name", { exact: true }).fill("An evening check-in");
  await dialog.getByLabel("What should your agent do?").fill("Review my week.");
  await dialog.getByLabel(/^Schedule/).fill("0 17 * JAN,MAR MON-FRI");
  await dialog.getByLabel(/^Timezone/).fill("Europe/London");
  await dialog.getByRole("checkbox").uncheck();
  await dialog.getByRole("button", { name: "More choices" }).click();
  await dialog.getByLabel("Agent for this routine").selectOption("hermes");
  await dialog.getByLabel(/^Profile/).fill("work_notes-2");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toHaveCount(0);
  expect(patches).toEqual([
    {
      name: "An evening check-in",
      prompt: "Review my week." + routineNotificationSuffix,
      schedule: "0 17 * JAN,MAR MON-FRI",
      timezone: "Europe/London",
      enabled: false,
      agent: "hermes",
      profile: "work_notes-2",
    },
  ]);
  await expect(
    page.getByRole("button", { name: "Resume An evening check-in" }),
  ).toBeVisible();
});

test("returns agent and profile to their defaults with explicit nulls", async ({
  page,
}) => {
  const { patches } = await fixture(page, { profile: "work" });
  const dialog = await edit(page);
  await dialog.getByRole("button", { name: "More choices" }).click();
  await dialog.getByLabel("Agent for this routine").selectOption("");
  await dialog.getByLabel(/^Profile/).fill("");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toHaveCount(0);
  expect(patches).toEqual([{ agent: null, profile: null }]);
});

test("keeps drafts after an upstream error and retries without changing a native prompt", async ({
  page,
}) => {
  const { patches, fail } = await fixture(page, {
    prompt: "A native instruction.",
  });
  fail(true);
  const dialog = await edit(page);
  await dialog
    .getByLabel("What should your agent do?")
    .fill("A new native instruction.");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "That schedule needs another look.",
  );
  await expect(dialog.getByLabel("What should your agent do?")).toHaveValue(
    "A new native instruction.",
  );
  fail(false);
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toHaveCount(0);
  expect(patches).toEqual([
    { prompt: "A new native instruction." },
    { prompt: "A new native instruction." },
  ]);
});

test("validates edits before sending and discards a cancelled draft", async ({
  page,
}) => {
  const { patches } = await fixture(page);
  const dialog = await edit(page);
  await dialog.getByLabel(/^Timezone/).fill("Mars/Olympus");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Choose a valid timezone",
  );
  expect(patches).toHaveLength(0);
  await dialog.getByRole("button", { name: "Keep as it was" }).click();
  await expect(
    page.getByRole("button", { name: "Edit A lighter morning", exact: true }),
  ).toBeFocused();
  const reopened = await edit(page);
  await expect(reopened.getByLabel(/^Timezone/)).toHaveValue("America/Toronto");
  await page.keyboard.press("Escape");
  await expect(reopened).toHaveCount(0);
  expect(patches).toHaveLength(0);
});

test("keeps routine actions and advanced editing usable at 320px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const { patches } = await fixture(page, { profile: "work" });
  const editButton = page.getByRole("button", {
    name: "Edit A lighter morning",
    exact: true,
  });
  await expect(editButton).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const dialog = await edit(page);
  await dialog.getByRole("button", { name: "More choices" }).click();
  await dialog.getByLabel("Agent for this routine").selectOption("codex");
  await expect(dialog.getByLabel(/^Profile/)).toBeDisabled();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toHaveCount(0);
  expect(patches).toEqual([{ agent: "codex", profile: null }]);
});
