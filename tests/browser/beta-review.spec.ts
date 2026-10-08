import { expect, test } from "@playwright/test";

const betaToken = "beta-browser-fixture-token";
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("boundless-demo-user", "signed-out"),
  );
});
async function unlock(page: import("@playwright/test").Page) {
  await page.getByLabel("Access token", { exact: true }).fill(betaToken);
  await page
    .getByRole("button", { name: "Open beta list", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Beta list.", exact: true }),
  ).toBeVisible();
}

test("opens /beta publicly with a token form, without account authentication or application links", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      requests.push(request.url());
  });
  await page.goto("/beta");
  await expect(
    page.getByRole("heading", { name: "Open the beta list." }),
  ).toBeVisible();
  await expect(page.getByLabel("Access token")).toHaveAttribute(
    "type",
    "password",
  );
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("link")).toHaveCount(0);
  expect(requests).toEqual([]);
});

test("rejects a wrong token without storing it or exposing the request list", async ({
  page,
}) => {
  await page.route("**/api/beta/requests", (route) => {
    expect(route.request().headers().authorization).toBe(
      "Bearer invalid-token",
    );
    return route.fulfill({
      status: 401,
      json: {
        error: {
          code: "unauthorized",
          message: "The access token is invalid.",
        },
      },
    });
  });
  await page.goto("/beta");
  await page.getByLabel("Access token").fill("invalid-token");
  await page
    .getByRole("button", { name: "Open beta list", exact: true })
    .click();
  await expect(page.locator('.toast[role="alert"]')).toContainText(
    "access token is invalid",
  );
  await expect(page.getByRole("table")).toHaveCount(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("boundless-beta-access")),
  ).toBeNull();
  expect(page.url()).not.toContain("invalid-token");
});

test("shows a searchable request list, protects existing accounts, and sends approved invitations without a user login", async ({
  page,
}) => {
  const errors: string[] = [],
    accountRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/me" ||
      new URL(request.url()).pathname.includes("/auth/v1/")
    )
      accountRequests.push(request.url());
  });
  const people = [
    {
      email: "joined@example.com",
      status: "accepted",
      accountExists: true,
      requestedAt: "2026-01-01T00:00:00Z",
    },
    {
      email: "waiting@example.com",
      status: "awaiting_review",
      accountExists: false,
      requestedAt: "2026-01-02T00:00:00Z",
    },
    {
      email: "existing@example.com",
      status: "awaiting_review",
      accountExists: true,
      requestedAt: "2026-01-03T00:00:00Z",
    },
    {
      email: "invited@example.com",
      status: "pending",
      accountExists: false,
      requestedAt: "2026-01-04T00:00:00Z",
    },
  ];
  let loads = 0,
    sends = 0;
  await page.route("**/api/beta/requests", (route) => {
    expect(route.request().method()).toBe("GET");
    expect(route.request().headers().authorization).toBe(`Bearer ${betaToken}`);
    loads++;
    return route.fulfill({ json: { requests: people } });
  });
  await page.route("**/api/beta/invitations", (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers().authorization).toBe(`Bearer ${betaToken}`);
    expect(route.request().postDataJSON()).toEqual({
      email: "waiting@example.com",
    });
    sends++;
    people[1].status = "pending";
    return route.fulfill({
      status: 201,
      json: { email: "waiting@example.com", sent: true, demo: false },
    });
  });
  await page.goto("/beta");
  await unlock(page);
  await expect(page.getByRole("link")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add email" })).toHaveCount(0);
  for (const email of [
    "joined@example.com",
    "existing@example.com",
    "invited@example.com",
  ])
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: email })
        .getByRole("button", {
          name: /Approve and invite|Send invitation to/,
        }),
    ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Remove .+ from beta list/ }),
  ).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: /Close account for/ }),
  ).toHaveCount(2);
  await page
    .getByRole("searchbox", { name: "Search requests" })
    .fill(" WAITING@EXAMPLE ");
  await expect(page.getByRole("row")).toHaveCount(2);
  expect(loads).toBe(1);
  await page
    .getByRole("button", {
      name: "Approve and invite waiting@example.com",
      exact: true,
    })
    .click();
  await expect(page.locator('.toast[role="status"]')).toContainText(
    "Invitation sent to waiting@example.com.",
  );
  await expect(
    page.getByRole("row").filter({ hasText: "waiting@example.com" }),
  ).toContainText("Invited");
  expect(sends).toBe(1);
  await page.getByRole("searchbox").fill("no-match");
  await expect(
    page.getByText("No requests match your search.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("searchbox").fill("");
  await page.screenshot({
    path: ".cache/beta-review-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".cache/beta-review-mobile.png",
    fullPage: true,
  });
  expect(accountRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("restores token access in the tab, clears it on lock, and expires it when the server rejects it", async ({
  page,
}) => {
  let expired = false;
  await page.route("**/api/beta/requests", (route) =>
    route.fulfill(
      expired
        ? {
            status: 401,
            json: {
              error: {
                code: "unauthorized",
                message: "The access token is invalid.",
              },
            },
          }
        : { json: { requests: [] } },
    ),
  );
  await page.goto("/beta");
  await unlock(page);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Beta list.", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Lock beta list" }).click();
  await expect(
    page.getByRole("heading", { name: "Open the beta list." }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("boundless-beta-access")),
  ).toBeNull();
  await unlock(page);
  expired = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Open the beta list." }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("boundless-beta-access")),
  ).toBeNull();
});

test("removes waiting and invited people from the list and updates the count", async ({
  page,
}) => {
  const people = [
    {
      email: "waiting@example.com",
      status: "awaiting_review",
      accountExists: false,
      requestedAt: "2026-01-01T00:00:00Z",
    },
    {
      email: "invited@example.com",
      status: "pending",
      accountExists: false,
      requestedAt: "2026-01-01T00:00:00Z",
    },
  ];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const removed: string[] = [];
  await page.route("**/api/beta/requests", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: {
          requests: people.filter((person) => !removed.includes(person.email)),
        },
      });
    expect(route.request().method()).toBe("DELETE");
    expect(route.request().headers().authorization).toBe(`Bearer ${betaToken}`);
    const { email } = route.request().postDataJSON();
    await gate;
    removed.push(email);
    return route.fulfill({ json: { email, removed: true } });
  });
  await page.goto("/beta");
  await unlock(page);
  const first = page.getByRole("button", {
    name: "Remove waiting@example.com from beta list",
    exact: true,
  });
  await first.click();
  await expect(first).toBeDisabled();
  await expect(first).toHaveText("Removing…");
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", {
      name: "Approve and invite waiting@example.com",
      exact: true,
    }),
  ).toBeDisabled();
  release();
  for (const person of people) {
    if (person !== people[0])
      await page
        .getByRole("button", {
          name: `Remove ${person.email} from beta list`,
          exact: true,
        })
        .click();
    await expect(
      page.getByRole("row").filter({ hasText: person.email }),
    ).toHaveCount(0);
    await expect(page.locator('.toast[role="status"]')).toContainText(
      `${person.email} removed from the beta list.`,
    );
    await expect(page.locator(".beta-review-count")).toHaveText(
      "0 awaiting review",
    );
  }
  expect(removed).toEqual(people.map((person) => person.email));
  await expect(
    page.getByText("No beta requests yet.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("No beta requests yet.", { exact: true }),
  ).toBeVisible();
});

test("confirms existing-account closure, retains the entry while closing, and refreshes after cleanup", async ({
  page,
}) => {
  const person = {
    email: "joined@example.com",
    status: "accepted",
    accountExists: true,
    accountClosing: false,
    requestedAt: "2026-01-01T00:00:00Z",
  };
  let submissions = 0,
    completed = false,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/beta/requests", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { requests: completed ? [] : [person] } });
    expect(route.request().postDataJSON()).toEqual({
      email: person.email,
      closeAccount: true,
    });
    expect(route.request().headers().authorization).toBe(`Bearer ${betaToken}`);
    submissions++;
    await gate;
    person.accountClosing = true;
    return route.fulfill({
      status: 202,
      json: { email: person.email, removed: false, queued: true },
    });
  });
  await page.goto("/beta");
  await unlock(page);
  const close = page.getByRole("button", {
    name: `Close account for ${person.email}`,
    exact: true,
  });
  await close.click();
  const dialog = page.getByRole("dialog", { name: "Close this account?" });
  await expect(dialog).toContainText(person.email);
  await expect(dialog).toContainText("This cannot be undone.");
  await dialog
    .getByRole("button", { name: "Keep account", exact: true })
    .click();
  expect(submissions).toBe(0);
  await close.click();
  await dialog
    .getByRole("button", { name: "Close account and remove", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Closing account…", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Keep account", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  release();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("row").filter({ hasText: person.email }),
  ).toContainText("Closing account");
  await expect(close).toHaveText("Retry account closure");
  await expect(page.locator('.toast[role="status"]')).toContainText(
    "will be removed when cleanup finishes",
  );
  expect(submissions).toBe(1);
  completed = true;
  await expect(
    page.getByText("No beta requests yet.", { exact: true }),
  ).toBeVisible({ timeout: 10000 });
});

test("offers a closure retry after queue dispatch fails", async ({ page }) => {
  const person = {
    email: "retry-close@example.com",
    status: "accepted",
    accountExists: true,
    accountClosing: false,
    requestedAt: "2026-01-01T00:00:00Z",
  };
  let submissions = 0;
  await page.route("**/api/beta/requests", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { requests: [person] } });
    submissions++;
    person.accountClosing = true;
    return route.fulfill(
      submissions === 1
        ? {
            status: 503,
            json: {
              error: { message: "Cleanup could not be queued. Retry shortly." },
            },
          }
        : {
            status: 202,
            json: { email: person.email, removed: false, queued: true },
          },
    );
  });
  await page.goto("/beta");
  await unlock(page);
  await page
    .getByRole("button", {
      name: `Close account for ${person.email}`,
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", { name: "Close this account?" });
  await dialog
    .getByRole("button", { name: "Close account and remove", exact: true })
    .click();
  await expect(page.locator('.toast[role="alert"]')).toContainText(
    "Cleanup could not be queued.",
  );
  await expect(
    dialog.getByRole("button", {
      name: "Close account and remove",
      exact: true,
    }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "Close account and remove", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: `Close account for ${person.email}`,
      exact: true,
    }),
  ).toHaveText("Retry account closure");
  expect(submissions).toBe(2);
});

for (const status of [500, 401])
  test(`handles beta removal failure ${status} without reporting success`, async ({
    page,
  }) => {
    const person = {
      email: "keep@example.com",
      status: "awaiting_review",
      accountExists: false,
      requestedAt: "2026-01-01T00:00:00Z",
    };
    await page.route("**/api/beta/requests", (route) =>
      route.fulfill(
        route.request().method() === "GET"
          ? { json: { requests: [person] } }
          : {
              status,
              json: { error: { message: "Removal failed. Please try again." } },
            },
      ),
    );
    await page.goto("/beta");
    await unlock(page);
    await page
      .getByRole("button", {
        name: "Remove keep@example.com from beta list",
        exact: true,
      })
      .click();
    await expect(page.locator('.toast[role="alert"]')).toContainText(
      "Removal failed. Please try again.",
    );
    await expect(page.locator('.toast[role="status"]')).toHaveCount(0);
    if (status === 401) {
      await expect(
        page.getByRole("heading", { name: "Open the beta list." }),
      ).toBeVisible();
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem("boundless-beta-access"),
        ),
      ).toBeNull();
    } else {
      await expect(
        page.getByRole("row").filter({ hasText: person.email }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Remove keep@example.com from beta list",
          exact: true,
        }),
      ).toBeEnabled();
    }
  });

test("retains approval and offers an invitation retry after a failed send", async ({
  page,
}) => {
  const person = {
    email: "retry@example.com",
    status: "awaiting_review",
    accountExists: false,
    requestedAt: "2026-01-01T00:00:00Z",
  };
  await page.route("**/api/beta/requests", (route) =>
    route.fulfill({ json: { requests: [person] } }),
  );
  let release!: () => void,
    sends = 0;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/beta/invitations", async (route) => {
    expect(route.request().headers().authorization).toBe(`Bearer ${betaToken}`);
    sends++;
    if (sends === 1) {
      await waiting;
      person.status = "approved";
      return route.fulfill({
        status: 502,
        json: {
          error: {
            code: "invitation_email_failed",
            message:
              "Couldn’t confirm sending this invitation. Please try again.",
          },
        },
      });
    }
    person.status = "pending";
    return route.fulfill({
      status: 201,
      json: { email: person.email, sent: true, demo: false },
    });
  });
  await page.goto("/beta");
  await unlock(page);
  const approve = page.getByRole("button", {
    name: "Approve and invite retry@example.com",
    exact: true,
  });
  await approve.click();
  await expect(approve).toBeDisabled();
  release();
  await expect(page.locator('.toast[role="alert"]')).toContainText(
    "Couldn’t confirm sending",
  );
  const retry = page.getByRole("button", {
    name: "Send invitation to retry@example.com",
    exact: true,
  });
  await expect(retry).toHaveText("Retry invitation");
  await expect(page.getByText(/Invitation sent to/)).toHaveCount(0);
  await retry.click();
  await expect(
    page.getByRole("row").filter({ hasText: person.email }),
  ).toContainText("Invited");
  expect(sends).toBe(2);
});

test("excludes beta management from discovery and retires the old route", async ({
  page,
}) => {
  await page.goto("/beta");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex.*nofollow/,
  );
  await expect(page.locator('meta[name="googlebot"]')).toHaveAttribute(
    "content",
    /noindex.*nofollow/,
  );
  expect(await (await page.request.get("/sitemap.xml")).text()).not.toContain(
    "/beta",
  );
  expect(await (await page.request.get("/robots.txt")).text()).toContain(
    "Disallow: /beta",
  );
  expect((await page.goto("/operator/invitations"))?.status()).toBe(404);
});

test("connects public signup to the guarded beta page and approval through the actual preview API", async ({
  page,
}) => {
  const email = "beta-browser-request@example.com";
  for (const value of [email, ` ${email.toUpperCase()} `]) {
    const response = await page.request.post("http://127.0.0.1:4000/api/beta", {
      data: { email: value },
    });
    expect(response.status()).toBe(202);
  }
  await page.goto("/beta");
  await unlock(page);
  await page.getByRole("searchbox", { name: "Search requests" }).fill(email);
  await expect(page.getByRole("row")).toHaveCount(2);
  await page
    .getByRole("button", { name: `Approve and invite ${email}`, exact: true })
    .click();
  await expect(page.locator('.toast[role="status"]')).toContainText(
    `Preview invitation created for ${email}.`,
  );
  await expect(page.getByRole("row").filter({ hasText: email })).toContainText(
    "Invited",
  );
  await page
    .getByRole("button", {
      name: `Remove ${email} from beta list`,
      exact: true,
    })
    .click();
  await expect(page.getByRole("row").filter({ hasText: email })).toHaveCount(0);
  await expect(page.locator('.toast[role="status"]')).toContainText(
    `${email} removed from the beta list.`,
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: email })).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("boundless-demo-user")),
  ).toBe("signed-out");
});
