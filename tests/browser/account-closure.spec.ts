import { expect, test } from "@playwright/test";

test("closes once, shows provider cleanup, and clears sign-in when the account is gone", async ({
  page,
}) => {
  let closed = false,
    deleting = false,
    submissions = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/me", async (route) => {
    if (closed)
      return route.fulfill({
        status: 401,
        json: { error: { code: "unauthorized", message: "Account removed" } },
      });
    const response = await route.fetch();
    const account = await response.json();
    if (deleting) {
      account.agent.status = "deleting";
      account.agent.deletion = { instance: true, identity: false };
    }
    await route.fulfill({ json: account });
  });
  await page.route("**/api/account", async (route) => {
    submissions++;
    await gate;
    deleting = true;
    await route.fulfill({ status: 202, json: { queued: true } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete account", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete my account", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Closing account…" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Keep my companion" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Say goodbye to this companion?" }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("heading", { name: "Saying goodbye, carefully." }),
  ).toBeVisible();
  await expect(
    page.getByText("Computer removed", { exact: true }),
  ).toBeVisible();
  expect(submissions).toBe(1);
  closed = true;
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("boundless-demo-user")),
    )
    .toBe("signed-out");
  await expect(
    page.getByRole("heading", {
      name: "Less on your plate. More possibility.",
    }),
  ).toBeVisible();
});

test("offers account deletion retry when provider cleanup is interrupted", async ({
  page,
}) => {
  let deleting = false,
    submissions = 0;
  await page.route("**/api/me", async (route) => {
    const response = await route.fetch();
    const account = await response.json();
    if (deleting) {
      account.agent.status = "deleting";
      account.agent.deletion = { instance: true, identity: false };
      account.agent.error = "Cleanup is incomplete. Please retry deletion.";
    }
    await route.fulfill({ json: account });
  });
  await page.route("**/api/account", async (route) => {
    submissions++;
    deleting = true;
    await route.fulfill({ status: 202, json: { queued: true } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete account", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete my account", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Retry account deletion", exact: true })
    .click();
  await expect.poll(() => submissions).toBe(2);
  await expect(
    page.getByRole("heading", { name: "Saying goodbye, carefully." }),
  ).toBeVisible();
});
