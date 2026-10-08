import { expect, test } from "@playwright/test";
import type { PublicAgent } from "@boundless/shared";

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
  let snapshot: { agent: PublicAgent } | undefined;
  await page.route("**/api/me", async (route) => {
    if (closed)
      return route.fulfill({
        status: 401,
        json: { error: { code: "unauthorized", message: "Account removed" } },
      });
    snapshot ??= await (await route.fetch()).json();
    const account = structuredClone(snapshot!);
    if (deleting) {
      account.agent.status = "deleting";
      account.agent.deletion = { instance: true, identity: false };
    }
    await route.fulfill({ json: account });
  });
  await page.route("**/api/account", async (route) => {
    expect(route.request().method()).toBe("DELETE");
    submissions++;
    await gate;
    deleting = true;
    await route.fulfill({ status: 202, json: { queued: true } });
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
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
  await expect(page.locator(".setup-steps .done")).toHaveText([
    "Computer removed",
  ]);
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
  let snapshot: { agent: PublicAgent } | undefined;
  await page.route("**/api/me", async (route) => {
    snapshot ??= await (await route.fetch()).json();
    const account = structuredClone(snapshot!);
    if (deleting) {
      account.agent.status = "deleting";
      account.agent.deletion = { instance: true, identity: submissions > 1 };
      account.agent.error =
        submissions === 1
          ? "Cleanup is incomplete. Please retry deletion."
          : undefined;
    }
    await route.fulfill({ json: account });
  });
  await page.route("**/api/account", async (route) => {
    expect(route.request().method()).toBe("DELETE");
    submissions++;
    deleting = true;
    await route.fulfill({ status: 202, json: { queued: true } });
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
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
  await expect(page.locator(".setup-steps .done")).toHaveText([
    "Computer removed",
    "Messaging identity removed",
  ]);
  await expect(
    page.getByRole("button", { name: "Retry account deletion", exact: true }),
  ).toHaveCount(0);
});
