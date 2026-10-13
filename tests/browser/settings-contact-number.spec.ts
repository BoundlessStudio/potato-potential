import { expect, test } from "@playwright/test";

const number = "+14165550188";
const editor = (page: import("@playwright/test").Page) =>
  page.getByRole("form", { name: "Companion contact number" });
const dialog = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "One companion, wherever you are" });

test("saves a contact number independently, persists after reload and uses it for messages, calls and SMS until cleared", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let saved: string | null = null;
  const writes: unknown[] = [],
    otherWrites: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      /\/api\/(profile|memory)/.test(request.url())
    )
      otherWrites.push(request.url());
  });
  await page.route("**/api/contact-number", (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      writes.push(body);
      saved = body.number;
    }
    return route.fulfill({ json: { number: saved } });
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
    save = form.getByRole("button", { name: "Save number", exact: true });
  await expect(input).toHaveValue("");
  await expect(save).toBeDisabled();
  await expect(
    page.getByText("Your verified number", { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Your name", { exact: true }).fill("Unsaved profile");
  await page
    .getByRole("textbox", { name: "About you", exact: true })
    .fill("Unsaved memory");
  await input.fill("+1 (416) 555-0188");
  await save.click();
  await expect(save).toBeDisabled();
  await expect(input).toHaveValue(number);
  expect(writes).toEqual([{ number, expectedNumber: null }]);
  expect(otherWrites).toEqual([]);
  await expect(page.getByLabel("Your name", { exact: true })).toHaveValue(
    "Unsaved profile",
  );
  await expect(
    page.getByRole("textbox", { name: "About you", exact: true }),
  ).toHaveValue("Unsaved memory");
  await page.reload();
  await expect(input).toHaveValue(number);
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
  await modal.screenshot({
    path: ".cache/channels-manual-contact-desktop.png",
  });
  await page.keyboard.press("Escape");
  await form.getByRole("button", { name: "Clear number" }).click();
  await expect(input).toHaveValue("");
  expect(writes[1]).toEqual({ number: null, expectedNumber: number });
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

test("rejects invalid, personal and router numbers and retains a draft after a failed save on mobile", async ({
  page,
}) => {
  let failLoad = true,
    failSave = true;
  const writes: unknown[] = [];
  await page.route("**/api/contact-number", (route) => {
    if (route.request().method() === "GET" && failLoad)
      return route.fulfill({
        status: 502,
        json: { error: { message: "Contact number unavailable." } },
      });
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      writes.push(body);
      if (failSave)
        return route.fulfill({
          status: 502,
          json: { error: { message: "Couldn’t save the number. Try again." } },
        });
      return route.fulfill({ json: { number: body.number } });
    }
    return route.fulfill({ json: { number: null } });
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/settings");
  const form = editor(page),
    input = form.getByLabel("Pip’s contact number"),
    save = form.getByRole("button", { name: "Save number", exact: true });
  await expect(form.getByRole("alert")).toHaveText(
    "Contact number unavailable.",
  );
  await expect(input).toBeDisabled();
  await expect(save).toBeDisabled();
  failLoad = false;
  await form.getByRole("button", { name: "Reload number" }).click();
  await expect(input).toBeEnabled();
  for (const invalid of [
    "4165550188",
    "+1 (416) 555-0123",
    "+1 (416) 555-0100",
  ]) {
    await input.fill(invalid);
    await expect(save).toBeDisabled();
    await expect(form.getByRole("alert")).toBeVisible();
  }
  expect(writes).toEqual([]);
  await input.fill(number);
  await save.click();
  await expect(form.getByRole("alert")).toContainText("Try again");
  await expect(input).toHaveValue(number);
  await expect(save).toBeEnabled();
  failSave = false;
  await save.click();
  await expect(save).toBeDisabled();
  await expect(form.getByRole("alert")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .locator(".settings-layout > .settings-card")
    .first()
    .screenshot({ path: ".cache/settings-manual-contact-mobile.png" });
});
