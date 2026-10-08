import { expect, test, type Page } from "@playwright/test";
const stamp = Math.floor(Date.now() / 1000);
const checkpoints = [
  {
    id: "manual123",
    kind: "manual",
    created: stamp - 3600,
    size_bytes: 500 * 1024 ** 2,
  },
  {
    id: "nightly123",
    kind: "automatic",
    created: stamp - 86400,
    size_bytes: 450 * 1024 ** 2,
  },
];
async function fixture(page: Page, initial: Record<string, any> = {}) {
  const state = {
    backups: checkpoints,
    operation: null as any,
    canManage: true,
    cooldownUntil: null,
    ...initial,
  };
  const posts: { path: string; body: any }[] = [];
  let failed = false;
  await page.route("**/api/computer/backups", (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      posts.push({ path: "backup", body });
      state.operation = {
        id: body.id,
        action: "backup",
        phase: "checking",
        requestedAt: new Date().toISOString(),
      };
      return route.fulfill({ status: 202, json: { queued: true } });
    }
    return failed
      ? route.fulfill({
          status: 502,
          json: { error: { message: "Couldn’t gather checkpoints." } },
        })
      : route.fulfill({ json: state });
  });
  await page.route("**/api/computer/restore", (route) => {
    const body = route.request().postDataJSON();
    posts.push({ path: "restore", body });
    state.operation = {
      id: body.id,
      action: "restore",
      phase: "checking",
      needsReconnect: true,
      requestedAt: new Date().toISOString(),
    };
    return route.fulfill({ status: 202, json: { queued: true } });
  });
  await page.route("**/api/computer/restore/reconnect", (route) => {
    posts.push({ path: "reconnect", body: route.request().postDataJSON() });
    state.operation = {
      ...state.operation,
      phase: "completed",
      needsReconnect: false,
    };
    return route.fulfill({ status: 202, json: { queued: true } });
  });
  await page.route("**/api/computer/status", (route) =>
    route.fulfill({
      json: {
        installedTemplate: "boundless-hermes-desktop@4",
        availableTemplate: "boundless-hermes-desktop@5",
        updateAvailable: true,
        instanceStatus: "running",
        screen: { width: 540, height: 1140 },
        operation: null,
        canManage: state.canManage,
      },
    }),
  );
  await page.route("**/api/computer/services", (route) =>
    route.fulfill({
      json: { services: [], requests: [], publicationAllowed: true },
    }),
  );
  return {
    state,
    posts,
    fail: () => {
      failed = true;
    },
  };
}
async function open(page: Page) {
  await page.goto("/computer");
  await expect(
    page.getByRole("heading", { name: "Computer", exact: true }),
  ).toBeVisible();
}
const tab = (page: Page) =>
  page.getByRole("button", { name: "Checkpoints", exact: true });

test("starts a manual backup from the banner and shows progress in Checkpoints", async ({
  page,
}) => {
  const { posts, state } = await fixture(page);
  await open(page);
  const banner = page.locator("header:has(h1)");
  await banner
    .getByRole("button", { name: "Back up now", exact: true })
    .click();
  await expect(
    banner.getByRole("button", { name: "Backing up…", exact: true }),
  ).toBeDisabled();
  await expect(
    banner.getByRole("button", { name: "Restart computer", exact: true }),
  ).toBeDisabled();
  expect(posts).toHaveLength(1);
  expect(posts[0].body.id).toMatch(/^[0-9a-f-]{36}$/);
  await tab(page).click();
  const panel = page.getByRole("region", { name: "Computer checkpoints" });
  await expect(panel.getByRole("status")).toContainText(
    "You can keep chatting",
  );
  await expect(panel.getByText("Saved by you", { exact: true })).toBeVisible();
  await expect(
    panel.getByText("Nightly backup", { exact: true }),
  ).toBeVisible();
  await expect(panel.getByText("500.0 MiB saved")).toBeVisible();
  state.operation.phase = "completed";
  state.cooldownUntil = new Date(Date.now() + 14 * 60_000).toISOString();
  await panel.getByRole("button", { name: "Refresh checkpoints" }).click();
  await expect(panel.getByRole("status")).toContainText(
    "Your checkpoint is saved",
  );
  await expect(
    banner.getByRole("button", { name: "Back up now", exact: true }),
  ).toBeDisabled();
});

test("requires a clear restore confirmation and blocks overlapping controls", async ({
  page,
}) => {
  const { posts } = await fixture(page);
  await open(page);
  await tab(page).click();
  const panel = page.getByRole("region", { name: "Computer checkpoints" });
  await panel
    .getByRole("button", { name: "Restore checkpoint", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Go back to this checkpoint?",
  });
  await expect(dialog).toContainText(
    "Later changes on the computer will be lost",
  );
  await expect(dialog).toContainText(
    "Your tasks, wiki notes, conversation list, and account settings stay as they are",
  );
  await expect(
    dialog.getByRole("button", { name: "Restore checkpoint", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Stay here" }).click();
  expect(posts).toHaveLength(0);
  await panel
    .getByRole("button", { name: "Restore checkpoint", exact: true })
    .first()
    .click();
  await dialog.getByRole("checkbox").check();
  await dialog
    .getByRole("button", { name: "Restore checkpoint", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    path: "restore",
    body: { backup: "manual123", confirm: true },
  });
  await expect(panel.getByRole("status")).toContainText("Finding the way back");
  await expect(
    panel
      .getByRole("button", { name: "Restore checkpoint", exact: true })
      .first(),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Back up now", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Restart computer", exact: true }),
  ).toBeDisabled();
});

test("retries reconnection without starting another restore", async ({
  page,
}) => {
  const id = "11111111-1111-4111-8111-111111111111";
  const newSession = "fedcba0987654321fedcba0987654321";
  let restored = false;
  await page.route("**/api/me", async (route) => {
    const body = await (await route.fetch()).json();
    await route.fulfill({
      json: restored
        ? { ...body, agent: { ...body.agent, mainSessionId: newSession } }
        : body,
    });
  });
  await page.route(`**/api/sessions/${newSession}`, (route) =>
    route.fulfill({
      json: {
        id: newSession,
        history: [
          {
            role: "assistant",
            content: "Home again, with a fresh conversation.",
          },
        ],
      },
    }),
  );
  const { posts } = await fixture(page, {
    operation: {
      id,
      action: "restore",
      phase: "failed",
      needsReconnect: true,
      error: "Couldn’t reconnect yet.",
    },
  });
  await open(page);
  await tab(page).click();
  await expect(
    page.getByRole("button", { name: "Back up now", exact: true }),
  ).toBeDisabled();
  restored = true;
  await page
    .getByRole("button", { name: "Check and reconnect", exact: true })
    .click();
  expect(posts).toEqual([{ path: "reconnect", body: { id } }]);
  await expect(page.getByRole("status")).toContainText(
    "The checkpoint is restored",
  );
  await page.getByRole("button", { name: "Back to their desk" }).click();
  await expect(
    page.getByRole("button", { name: "Overview", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("link", { name: "Your conversation", exact: true })
    .click();
  await expect(
    page.getByText("Home again, with a fresh conversation.", { exact: true }),
  ).toBeVisible();
});

test("keeps the last checkpoints when refresh fails and respects paused access", async ({
  page,
}) => {
  const { fail } = await fixture(page, { canManage: false });
  await open(page);
  await tab(page).click();
  const panel = page.getByRole("region", { name: "Computer checkpoints" });
  await expect(
    panel
      .getByRole("button", { name: "Restore checkpoint", exact: true })
      .first(),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Back up now", exact: true }),
  ).toBeDisabled();
  fail();
  await panel.getByRole("button", { name: "Refresh checkpoints" }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "Showing the last available checkpoints",
  );
  await expect(
    panel.getByText("Nightly backup", { exact: true }),
  ).toBeVisible();
});

test("provides an icon-only backup control at the top right of the chat computer panel", async ({
  page,
}) => {
  const { posts } = await fixture(page);
  await page.goto("/chat");
  await page
    .getByRole("button", { name: "Preview computer", exact: true })
    .click();
  const controls = page.getByRole("group", {
    name: "Computer controls",
    exact: true,
  });
  const button = controls.getByRole("button", {
    name: "Back up now",
    exact: true,
  });
  await expect(button).toBeEnabled();
  await expect(button).toHaveText("");
  await expect(button).toHaveAttribute("title", "Back up now");
  await button.click();
  await expect(
    controls.getByRole("button", { name: "Backing up…", exact: true }),
  ).toBeDisabled();
  expect(posts).toHaveLength(1);
});

test("keeps banner controls aligned and checkpoints readable on a narrow phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await fixture(page);
  await open(page);
  const banner = page.locator("header:has(h1)");
  const boxes = await Promise.all(
    ["Back up now", "Restart computer", "Update computer"].map((name) =>
      banner.getByRole("button", { name, exact: true }).boundingBox(),
    ),
  );
  for (const box of boxes) {
    expect(box!.x).toBeCloseTo(boxes[0]!.x, 0);
    expect(box!.width).toBeCloseTo(boxes[0]!.width, 0);
  }
  await tab(page).click();
  await expect(
    page.getByRole("heading", { name: "Checkpoints", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".cache/computer-checkpoints-320.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Restore checkpoint", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const consent = page.getByRole("dialog").getByRole("checkbox").locator("..");
  expect(
    await consent.evaluate((label) =>
      [...label.children].every((child) => {
        const parent = label.getBoundingClientRect(),
          box = child.getBoundingClientRect();
        return box.left >= parent.left && box.right <= parent.right + 1;
      }),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".cache/computer-restore-320.png",
    fullPage: true,
  });
});
