import { expect, test, type Page } from "@playwright/test";

const number = "+14165550188";
const editor = (page: Page) =>
  page.getByRole("form", { name: "Companion settings" });
const summary = (page: Page) => page.locator(".companion-contact-details");
const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "One companion, wherever you are" });

test("saves the contact number with the profile, displays only the saved number on the left and clears it through Save changes", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let saved: string | null = null;
  let profileDraft: Record<string, unknown> = {};
  const writes: any[] = [],
    unexpected: string[] = [];
  await page.route("**/api/me", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    return route.fulfill({
      json: { ...body, profile: { ...body.profile, ...profileDraft } },
    });
  });
  await page.route("**/api/contact-number", (route) => {
    if (route.request().method() !== "GET")
      unexpected.push("Separate contact write");
    return route.fulfill({ json: { number: saved } });
  });
  await page.route("**/api/profile", (route) => {
    const { contactNumber, ...profile } = route.request().postDataJSON();
    writes.push({ ...profile, contactNumber });
    profileDraft = profile;
    if (contactNumber) saved = contactNumber.number;
    return route.fulfill({
      json: {
        profile,
        ...(contactNumber ? { contactNumber: { number: saved } } : {}),
      },
    });
  });
  await page.route("**/api/channels", (route) =>
    route.fulfill({
      json: {
        email: "ready",
        imessage: "connected",
        voice: "hosted",
        sms: null,
        contactNumber: saved,
      },
    }),
  );
  await page.goto("/settings");
  const form = editor(page),
    input = form.getByLabel("Pip’s contact number"),
    save = form.getByRole("button", { name: "Save changes", exact: true });
  await expect(input).toHaveValue("");
  await expect(summary(page)).toContainText("Not saved yet");
  await expect(summary(page).locator("input,textarea,button")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save number", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Clear number", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Your verified number", { exact: true }),
  ).toHaveCount(0);
  await form.getByLabel("Your name", { exact: true }).fill("Updated profile");
  await page
    .getByRole("textbox", { name: "About you", exact: true })
    .fill("Unsaved memory");
  await input.fill("+1 (416) 555-0188");
  await expect(summary(page)).toContainText("Not saved yet");
  await save.click();
  await expect(summary(page)).toContainText(number);
  await expect(input).toHaveValue(number);
  expect(writes[0]).toMatchObject({
    name: "Updated profile",
    phone: "+14165550123",
    contactNumber: { number, expectedNumber: null },
  });
  expect(unexpected).toEqual([]);
  await expect(form.getByLabel("Your name", { exact: true })).toHaveValue(
    "Updated profile",
  );
  await expect(
    page.getByRole("textbox", { name: "About you", exact: true }),
  ).toHaveValue("Unsaved memory");
  await page.reload();
  await expect(input).toHaveValue(number);
  await expect(summary(page)).toContainText(number);
  await expect(form.getByLabel("Your name", { exact: true })).toHaveValue(
    "Updated profile",
  );
  await page
    .locator(".settings-layout")
    .screenshot({ path: ".cache/settings-merged-contact-desktop.png" });
  await page
    .locator(".topbar-actions")
    .getByRole("button", { name: "Channels", exact: true })
    .click();
  const modal = dialog(page);
  await expect(
    modal.getByRole("region", { name: "iMessage", exact: true }),
  ).toContainText(number);
  await expect(
    modal.getByRole("region", { name: "Calls", exact: true }),
  ).toContainText(number);
  await expect(
    modal.getByRole("region", { name: "SMS", exact: true }),
  ).toContainText(number);
  await expect(
    modal.getByRole("link", { name: "Call", exact: true }),
  ).toHaveAttribute("href", `tel:${number}`);
  await expect(modal.getByRole("link", { name: "Open SMS" })).toHaveAttribute(
    "href",
    `sms:${number}`,
  );
  await expect(
    modal.getByRole("link", { name: "Open Messages" }),
  ).toHaveAttribute("href", `sms:${number}`);
  await expect(modal).not.toContainText("+14165550100");
  await expect(modal).not.toContainText("+14165550123");
  await modal
    .getByRole("button", { name: "Copy phone number", exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    number,
  );
  await page.keyboard.press("Escape");
  await input.fill("");
  await expect(summary(page)).toContainText(number);
  await save.click();
  await expect(summary(page)).toContainText("Not saved yet");
  expect(writes[1].contactNumber).toEqual({
    number: null,
    expectedNumber: number,
  });
  await page.reload();
  await expect(input).toHaveValue("");
  await page
    .locator(".topbar-actions")
    .getByRole("button", { name: "Channels", exact: true })
    .click();
  await expect(
    modal.getByRole("region", { name: "Calls", exact: true }),
  ).toContainText("saved contact card Inkbox sent in Messages");
  await expect(
    modal.getByRole("link", { name: "Call", exact: true }),
  ).toHaveCount(0);
  await expect(
    modal.getByRole("region", { name: "SMS", exact: true }),
  ).toHaveCount(0);
});

test("preserves the saved number after a failed load and both drafts after a failed merged save on mobile", async ({
  page,
}) => {
  let failLoad = true,
    failSave = true;
  let saved: string | null = number;
  const writes: any[] = [];
  await page.route("**/api/contact-number", (route) =>
    failLoad
      ? route.fulfill({
          status: 502,
          json: { error: { message: "Contact number unavailable." } },
        })
      : route.fulfill({ json: { number: saved } }),
  );
  await page.route("**/api/profile", (route) => {
    const { contactNumber, ...profile } = route.request().postDataJSON();
    writes.push({ ...profile, contactNumber });
    if (contactNumber && failSave)
      return route.fulfill({
        status: 502,
        json: { error: { message: "Couldn’t save these changes. Try again." } },
      });
    if (contactNumber) saved = contactNumber.number;
    return route.fulfill({
      json: {
        profile,
        ...(contactNumber ? { contactNumber: { number: saved } } : {}),
      },
    });
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/settings");
  const form = editor(page),
    input = form.getByLabel("Pip’s contact number"),
    save = form.getByRole("button", { name: "Save changes", exact: true });
  await expect(form.getByRole("alert")).toHaveText(
    "Contact number unavailable.",
  );
  await expect(input).toBeDisabled();
  await expect(summary(page)).toContainText("Unavailable");
  await save.click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].contactNumber).toBeUndefined();
  expect(saved).toBe(number);
  failLoad = false;
  await form.getByRole("button", { name: "Reload number" }).click();
  await expect(input).toHaveValue(number);
  await expect(summary(page)).toContainText(number);
  for (const invalid of [
    "4165550188",
    "+1 (416) 555-0123",
    "+1 (416) 555-0100",
  ]) {
    await input.fill(invalid);
    await expect(save).toBeDisabled();
    await expect(form.getByRole("alert")).toBeVisible();
  }
  expect(writes).toHaveLength(1);
  await form.getByLabel("Your name", { exact: true }).fill("Unsaved profile");
  const next = "+14165550189";
  await input.fill(next);
  await save.click();
  await expect(form.getByRole("alert")).toContainText("Try again");
  await expect(input).toHaveValue(next);
  await expect(form.getByLabel("Your name", { exact: true })).toHaveValue(
    "Unsaved profile",
  );
  await expect(summary(page)).toContainText(number);
  failSave = false;
  await save.click();
  await expect(summary(page)).toContainText(next);
  await expect(form.getByRole("alert")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .locator(".settings-layout")
    .screenshot({ path: ".cache/settings-merged-contact-mobile.png" });
});
