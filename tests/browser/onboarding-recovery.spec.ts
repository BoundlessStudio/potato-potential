import { expect, test } from "@playwright/test";
import type { Profile, PublicAgent } from "@boundless/shared";

type Account = { profile: Profile; agent: PublicAgent };

function phoneStep(account: Account): Account {
  return {
    ...account,
    agent: {
      ...account.agent,
      status: "awaiting_phone",
      phase: "phone",
      completed: ["identity", "computer"],
      phoneChallenge: "VERIFY RETRY123",
    },
  };
}

for (const failure of ["server", "authentication", "network"] as const) {
  test(`keeps the phone wizard open through a temporary ${failure} status failure`, async ({
    page,
  }) => {
    let fail = false,
      failedPolls = 0;
    let account: Account | undefined;
    await page.route("**/api/me", async (route) => {
      account ??= await (await route.fetch()).json();
      if (fail) {
        failedPolls++;
        if (failure === "network") return route.abort("failed");
        return route.fulfill({
          status: failure === "authentication" ? 401 : 502,
          json: {
            error: {
              code: "temporarily_unavailable",
              message: "Please check again.",
            },
          },
        });
      }
      await route.fulfill({ json: phoneStep(account!) });
    });
    await page.goto("/");
    await expect(
      page.getByText("VERIFY RETRY123", { exact: true }),
    ).toBeVisible();
    fail = true;
    await expect.poll(() => failedPolls).toBeGreaterThanOrEqual(2);
    await expect(
      page.getByText("VERIFY RETRY123", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /simulate phone confirmation/i }),
    ).toBeEnabled();
    expect(
      await page.evaluate(() => localStorage.getItem("boundless-demo-user")),
    ).not.toBe("signed-out");
    fail = false;
    await page.unroute("**/api/me");
    await expect(
      page.getByRole("textbox", { name: "Message your companion" }),
    ).toBeVisible();
  });
}

test("retries a delayed phone confirmation and advances despite a failed status refresh", async ({
  page,
}) => {
  let checks = 0,
    refreshFailed = false,
    continuing = false;
  let account: Account | undefined;
  await page.route("**/api/me", async (route) => {
    account ??= await (await route.fetch()).json();
    if (checks === 2 && !refreshFailed) {
      refreshFailed = true;
      return route.fulfill({
        status: 502,
        json: {
          error: {
            code: "status_unavailable",
            message: "Status temporarily unavailable.",
          },
        },
      });
    }
    await route.fulfill({
      json: continuing
        ? {
            ...account!,
            agent: {
              ...account!.agent,
              status: "provisioning",
              phase: "persona",
              completed: ["identity", "computer", "phone"],
            },
          }
        : phoneStep(account!),
    });
  });
  await page.route("**/api/onboarding/verify-phone", async (route) => {
    expect(route.request().method()).toBe("POST");
    checks++;
    await route.fulfill(
      checks === 1
        ? {
            status: 409,
            json: {
              error: {
                code: "phone_not_verified",
                message:
                  "Send the verification code from your phone, then check again.",
              },
            },
          }
        : { status: 202, json: { verified: true } },
    );
  });
  await page.goto("/");
  const confirm = page.getByRole("button", {
    name: /simulate phone confirmation/i,
  });
  await confirm.click();
  await expect(
    page.getByText(
      "Send the verification code from your phone, then check again.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText("VERIFY RETRY123", { exact: true }),
  ).toBeVisible();
  await confirm.click();
  await expect(
    page.getByText("Status temporarily unavailable.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("VERIFY RETRY123", { exact: true }),
  ).toBeVisible();
  expect(checks).toBe(2);
  continuing = true;
  await expect(page.locator(".setup-steps .current")).toHaveText(
    "A little personality",
  );
  await expect(page.locator(".setup-steps .done")).toHaveText([
    "A way to keep in touch",
    "A computer of their own",
    "Your phone connection",
  ]);
  await expect(confirm).toHaveCount(0);
  await page.unroute("**/api/me");
  await expect(
    page.getByRole("textbox", { name: "Message your companion" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("boundless-demo-user")),
  ).not.toBe("signed-out");
});
