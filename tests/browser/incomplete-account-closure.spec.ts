import { expect, test } from "@playwright/test";
import type { Profile, PublicAgent } from "@boundless/shared";

const profile: Profile = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "new@example.com",
  name: "Jamie",
  agentName: "Pip",
  phone: "+14165550123",
  timezone: "America/Toronto",
  avatar: "sprout",
  color: "#7659e8",
  personality: "",
  preferences: "",
  createdAt: new Date().toISOString(),
};
for (const state of [
  "before_setup",
  "new",
  "awaiting_phone",
  "failed",
] as const) {
  test(`closes an account during ${state} and retains progress until deletion finishes`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem("boundless-demo-user"))
        localStorage.setItem("boundless-demo-user", "demo-new");
    });
    let deleted = false,
      closing = false,
      requests = 0;
    const agent: PublicAgent = {
      ownerId: profile.id,
      status: state === "before_setup" ? "new" : state,
      phase: state === "new" ? "identity" : "phone",
      completed: state === "new" ? [] : ["identity", "computer"],
      budgetMicros: 0,
      updatedAt: new Date().toISOString(),
      ...(state === "failed"
        ? { error: "Setup was interrupted. Retry to continue safely." }
        : {}),
    };
    await page.route("**/api/me", (route) =>
      deleted
        ? route.fulfill({
            status: 401,
            json: {
              error: {
                code: "unauthorized",
                message: "Authentication required.",
              },
            },
          })
        : route.fulfill({
            json: {
              profile,
              email: profile.email,
              invited: false,
              operator: false,
              demo: true,
              agent: closing
                ? {
                    ...agent,
                    status: "deleting",
                    deletion: { instance: true, identity: false },
                  }
                : state === "before_setup"
                  ? null
                  : agent,
            },
          }),
    );
    await page.route("**/api/account", (route) => {
      expect(route.request().method()).toBe("DELETE");
      requests++;
      closing = true;
      return route.fulfill({ status: 202, json: { queued: true } });
    });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Close account", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Close your account?" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Keep my account", exact: true })
      .click();
    expect(requests).toBe(0);
    await page
      .getByRole("button", { name: "Close account", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Close my account", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Saying goodbye, carefully." }),
    ).toBeVisible();
    expect(requests).toBe(1);
    await expect(
      page.getByText(
        "Ownership records stay in place until both providers confirm removal.",
      ),
    ).toBeVisible();
    await expect(page.locator(".setup-steps .done")).toHaveCount(1);
    deleted = true;
    await expect(
      page.getByRole("button", { name: "Join the beta list", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    expect(
      await page.evaluate(() => localStorage.getItem("boundless-demo-user")),
    ).toBe("signed-out");
  });
}
test("keeps checking deletion after the first status request fails before a closing agent is observed", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("boundless-demo-user", "demo-new"),
  );
  let closing = false,
    failedStatus = false;
  await page.route("**/api/me", (route) => {
    if (closing && !failedStatus) {
      failedStatus = true;
      return route.fulfill({
        status: 502,
        json: {
          error: {
            code: "status_unavailable",
            message: "Status temporarily unavailable",
          },
        },
      });
    }
    return route.fulfill({
      json: {
        profile,
        email: profile.email,
        invited: false,
        operator: false,
        demo: true,
        agent: closing
          ? {
              ownerId: profile.id,
              status: "deleting",
              phase: "identity",
              completed: [],
              budgetMicros: 0,
              updatedAt: new Date().toISOString(),
              deletion: { instance: false, identity: false },
            }
          : null,
      },
    });
  });
  await page.route("**/api/account", (route) => {
    closing = true;
    return route.fulfill({ status: 202, json: { queued: true } });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Close account", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Close my account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Saying goodbye, carefully." }),
  ).toBeVisible({ timeout: 6000 });
  expect(failedStatus).toBe(true);
});
