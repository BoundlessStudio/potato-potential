import { expect, test } from "@playwright/test";
import type { Profile, PublicAgent } from "@boundless/shared";

type Account = { profile: Profile; agent: PublicAgent };
function phoneStep(account: Account, connected = false): Account {
  return {
    ...account,
    agent: {
      ...account.agent,
      status: "awaiting_phone",
      phase: "phone",
      completed: ["identity", "computer"],
      phoneVerifiedAt: undefined,
      phoneLink: {
        identityId: account.agent.identityId!,
        phone: account.profile.phone,
        startedAt: "2026-10-12T12:00:00.000Z",
        status: connected ? "waiting_message" : "waiting_connection",
      },
      connect: {
        number: "+14165550100",
        command: "connect @pip-preview",
        smsLink: "sms:+14165550100?body=connect%20%40pip-preview",
        qr: "",
      },
    },
  };
}

for (const failure of ["server", "authentication", "network"] as const) {
  test(`automatically recovers a temporary ${failure} check failure without losing phone setup`, async ({
    page,
  }) => {
    let fail = false,
      failedPolls = 0,
      recover = false;
    let account: Account;
    await page.route("**/api/me", async (route) => {
      account ??= await (await route.fetch()).json();
      await route.fulfill({ json: phoneStep(account) });
    });
    await page.route("**/api/onboarding/phone-connection", async (route) => {
      expect(route.request().method()).toBe("POST");
      if (recover) return route.fulfill({ json: { agent: account.agent } });
      if (fail) {
        failedPolls++;
        if (failure === "network") return route.abort("failed");
        return route.fulfill({
          status: failure === "authentication" ? 401 : 502,
          json: {
            error: { code: "unavailable", message: "Temporarily unavailable." },
          },
        });
      }
      await route.fulfill({ json: { agent: phoneStep(account).agent } });
    });
    await page.goto("/");
    await expect(
      page.getByText("Waiting for connection", { exact: true }),
    ).toBeVisible();
    fail = true;
    await expect.poll(() => failedPolls).toBeGreaterThanOrEqual(1);
    await expect(
      page.getByText(
        "Connection check interrupted. We’ll retry automatically.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Connect in Messages" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => localStorage.getItem("boundless-demo-user")),
    ).not.toBe("signed-out");
    recover = true;
    await expect(
      page.getByRole("textbox", { name: "Message your companion" }),
    ).toBeVisible();
  });
}

test("connects, waits for Hi, and resumes setup automatically without codes or confirmation clicks", async ({
  page,
}) => {
  let connected = false,
    confirmed = false,
    ready = false,
    checks = 0;
  let account: Account;
  await page.route("**/api/me", async (route) => {
    account ??= await (await route.fetch()).json();
    await route.fulfill({ json: ready ? account : phoneStep(account) });
  });
  await page.route("**/api/onboarding/phone-connection", async (route) => {
    checks++;
    const pending = phoneStep(account, connected).agent;
    await route.fulfill({
      json: {
        agent: confirmed
          ? {
              ...pending,
              status: "provisioning",
              phase: "persona",
              completed: ["identity", "computer", "phone"],
              phoneVerifiedAt: new Date().toISOString(),
            }
          : pending,
      },
    });
  });
  await page.goto("/");
  await expect(
    page.getByText("Waiting for connection", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Connect in Messages" }),
  ).toHaveAttribute("href", "sms:+14165550100?body=connect%20%40pip-preview");
  await expect(page.locator(".verification-code")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: /check connection|simulate phone|sent the code/i,
    }),
  ).toHaveCount(0);
  connected = true;
  await expect(
    page.getByText("Connected; send Hi", { exact: true }),
  ).toBeVisible();
  const beforeReload = checks;
  await page.reload();
  await expect(
    page.getByText("Connected; send Hi", { exact: true }),
  ).toBeVisible();
  expect(checks).toBeGreaterThan(beforeReload);
  confirmed = true;
  await expect(
    page.getByText("Phone confirmed. Finishing setup for your companion.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".setup-steps .done")).toHaveText([
    "A way to keep in touch",
    "A computer of their own",
    "Your phone connection",
  ]);
  ready = true;
  await expect(
    page.getByRole("textbox", { name: "Message your companion" }),
  ).toBeVisible();
});

test("a lost confirmation reply and failed refresh recover without another phone action", async ({
  page,
}) => {
  let checks = 0,
    statusFailures = 0,
    interrupted = true;
  let account: Account;
  await page.route("**/api/me", async (route) => {
    account ??= await (await route.fetch()).json();
    if (checks >= 2 && !statusFailures++)
      return route.fulfill({
        status: 502,
        json: {
          error: {
            code: "status_unavailable",
            message: "Status temporarily unavailable.",
          },
        },
      });
    await route.fulfill({ json: checks >= 2 ? account : phoneStep(account) });
  });
  await page.route("**/api/onboarding/phone-connection", async (route) => {
    checks++;
    if (interrupted) return route.abort("failed");
    await route.fulfill({
      json: {
        agent: {
          ...account.agent,
          status: "provisioning",
          phase: "persona",
          completed: ["identity", "computer", "phone"],
          phoneVerifiedAt: new Date().toISOString(),
        },
      },
    });
  });
  await page.goto("/");
  await expect(
    page.getByText("Connection check interrupted. We’ll retry automatically.", {
      exact: true,
    }),
  ).toBeVisible();
  interrupted = false;
  await expect(
    page.getByRole("textbox", { name: "Message your companion" }),
  ).toBeVisible({ timeout: 20000 });
  expect(checks).toBeGreaterThanOrEqual(2);
  expect(statusFailures).toBeGreaterThanOrEqual(1);
});

test("shows long connect commands, the saved number and recovery guidance on narrow phone screens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let account: Account;
  await page.route("**/api/me", async (route) => {
    account ??= await (await route.fetch()).json();
    const pending = phoneStep(account);
    pending.agent.connect!.command = "connect @averylongcompanionna-1234567890";
    await route.fulfill({ json: pending });
  });
  await page.route("**/api/onboarding/phone-connection", async (route) => {
    const pending = phoneStep(account).agent;
    pending.connect!.command = "connect @averylongcompanionna-1234567890";
    await route.fulfill({ json: { agent: pending } });
  });
  await page.goto("/");
  await page.getByText("Not connecting?", { exact: true }).click();
  await expect(
    page.getByText(/Use the phone number saved on your account:/),
  ).toContainText(account.profile.phone);
  await expect(
    page.getByText(/An Apple ID email or a different SIM won’t match/),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".cache/phone-connection-mobile.png",
    fullPage: true,
  });
});
