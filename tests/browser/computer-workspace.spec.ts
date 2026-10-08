import { expect, test, type Page } from "@playwright/test";
const stamp = Math.floor(Date.now() / 1000);
const metrics = {
  series: {
    cpu_cores: [
      [stamp - 300, 0.4],
      [stamp - 240, 0.5],
      [stamp - 60, 0.2],
    ],
    memory_bytes: [],
    disk_bytes: [[stamp - 60, 1024 ** 3]],
  },
  limits: {
    cpu_cores: 2,
    memory_bytes: 4 * 1024 ** 3,
    disk_bytes: 20 * 1024 ** 3,
  },
  hours: 24,
  step_seconds: 60,
  fetched_at: stamp,
};
const status = {
  installedTemplate: "boundless-hermes-desktop@4",
  availableTemplate: "boundless-hermes-desktop@4",
  updateAvailable: false,
  instanceStatus: "running",
  screen: { width: 540, height: 1140 },
  operation: null,
  canManage: true,
};
const service = {
  ownerId: "11111111-1111-4111-8111-111111111111",
  instanceId: "test123456",
  port: 8788,
  label: "Project preview",
  createdAt: new Date().toISOString(),
  state: "unknown",
};
async function fixture(page: Page) {
  await page.route("**/api/computer/status", (route) =>
    route.fulfill({ json: status }),
  );
  await page.route("**/api/computer/metrics", (route) =>
    route.fulfill({ json: metrics }),
  );
  await page.route("**/api/computer/services", (route) =>
    route.fulfill({
      json: { services: [], requests: [], publicationAllowed: true },
    }),
  );
}
async function open(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "Computer", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Computer", exact: true }),
  ).toBeVisible();
}
test("shows resource limits and sampling gaps without automatically connecting the desktop", async ({
  page,
}) => {
  await fixture(page);
  await open(page);
  const controls = page.getByRole("group", {
    name: "Computer controls",
    exact: true,
  });
  await expect(
    controls.getByRole("button", { name: "Connect to desktop", exact: true }),
  ).toBeEnabled();
  await expect(
    controls.getByRole("button", { name: "Take over", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("region", { name: "Resource metrics" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Ready to share?" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Remote access" }),
  ).toHaveCount(0);
  await controls
    .getByRole("button", { name: "Connect to desktop", exact: true })
    .click();
  await expect(
    controls.getByRole("button", { name: "Reconnect computer", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Take over", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Resource usage", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resource usage", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Connect to desktop" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("img", { name: /CPU usage/ }).locator("path"),
  ).toHaveAttribute("d", /M.*L.*M/);
  await expect(page.getByText("No samples yet")).toBeVisible();
  await expect(page.getByText(/Fetched/)).toBeVisible();
  await page
    .locator(".workspace-page")
    .screenshot({ path: ".cache/computer-resources-desktop.png" });
  await page
    .getByRole("button", { name: "Remote access", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Resource metrics" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Ready to share?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Remote access" }),
  ).toBeVisible();
});

test("one status panel refresh updates status and metrics, connects the desktop, and stays busy until both reads finish", async ({
  page,
}) => {
  await fixture(page);
  let statusReads = 0,
    metricReads = 0;
  let changed = false;
  let releaseMetrics!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseMetrics = resolve;
  });
  await page.route("**/api/computer/status", (route) => {
    statusReads++;
    return route.fulfill({
      json: {
        ...status,
        screen: changed ? { width: 1440, height: 900 } : status.screen,
      },
    });
  });
  await page.route("**/api/computer/metrics", async (route) => {
    metricReads++;
    if (changed) await held;
    await route.fulfill({
      json: {
        ...metrics,
        series: {
          ...metrics.series,
          cpu_cores: [[stamp, changed ? 0.8 : 0.2]],
        },
      },
    });
  });
  await open(page);
  const snapshot = page.getByRole("region", { name: "Resource snapshot" });
  await expect(snapshot).toHaveCount(0);
  expect(
    await page
      .locator(".preview-desktop")
      .evaluate((screen) =>
        Math.abs(
          screen.getBoundingClientRect().height -
            Math.min(innerHeight * 0.65, 660),
        ),
      ),
  ).toBeLessThan(1);
  await expect(page.locator(".computer-details")).toContainText("540 × 1140");
  const portrait = await page.locator(".preview-desktop").boundingBox();
  expect(portrait!.width / portrait!.height).toBeCloseTo(540 / 1140, 3);
  await expect(
    page.getByRole("button", {
      name: /Check computer status|Refresh metrics/,
    }),
  ).toHaveCount(0);
  const refresh = page.getByRole("button", {
    name: "Refresh computer",
    exact: true,
  });
  await expect(refresh).toHaveCount(1);
  const startStatus = statusReads,
    startMetrics = metricReads;
  changed = true;
  await refresh.click();
  await expect(
    page.getByRole("button", { name: "Refreshing…", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Take over", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".computer-details")).toContainText("1440 × 900");
  const landscape = await page.locator(".preview-desktop").boundingBox();
  expect(landscape!.width / landscape!.height).toBeCloseTo(1440 / 900, 3);
  expect(statusReads).toBe(startStatus + 1);
  expect(metricReads).toBe(startMetrics + 1);
  releaseMetrics();
  await expect(refresh).toBeEnabled();
  await expect(snapshot).toHaveCount(0);
  await page
    .locator(".workspace-page")
    .screenshot({ path: "test-results/computer-overview-desktop.png" });
  await page
    .getByRole("button", { name: "Resource usage", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Resource metrics" }),
  ).toContainText("0.80 cores");
  await expect(
    page.getByRole("button", { name: "Refresh metrics" }),
  ).toBeEnabled();
});

test("refresh keeps independent failures visible and does not connect during maintenance", async ({
  page,
}) => {
  await fixture(page);
  let statusFail = true,
    metricsFail = false,
    maintaining = false;
  await page.route("**/api/computer/status", (route) =>
    route.fulfill(
      statusFail
        ? {
            status: 503,
            json: { error: { message: "Status temporarily unavailable." } },
          }
        : {
            json: {
              ...status,
              operation: maintaining
                ? { action: "update", phase: "checking" }
                : null,
            },
          },
    ),
  );
  await page.route("**/api/computer/metrics", (route) =>
    route.fulfill(
      metricsFail
        ? {
            status: 503,
            json: { error: { message: "Metrics temporarily unavailable." } },
          }
        : { json: metrics },
    ),
  );
  await open(page);
  await expect(
    page.locator(".computer-settings").getByRole("alert"),
  ).toContainText("Status temporarily unavailable.");
  await expect(
    page.getByRole("region", { name: "Resource snapshot" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Take over", exact: true }),
  ).toBeDisabled();
  statusFail = false;
  metricsFail = true;
  await page.getByRole("button", { name: "Refresh computer" }).click();
  await expect(
    page.getByRole("button", { name: "Take over", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Resource usage", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Resource metrics" }),
  ).toContainText("Metrics temporarily unavailable.");
  await expect(
    page.getByRole("region", { name: "Resource metrics" }),
  ).toContainText("Showing the previous snapshot.");
  await expect(
    page.getByRole("region", { name: "Resource metrics" }),
  ).toContainText("0.20 cores");
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(
    page.locator(".computer-settings").getByRole("alert"),
  ).toHaveCount(0);
  metricsFail = false;
  maintaining = true;
  await page.getByRole("button", { name: "Refresh computer" }).click();
  await expect(
    page.getByRole("button", { name: "Take over", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Restart computer", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Refresh computer" }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Resource usage", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Resource metrics" }),
  ).not.toContainText("Metrics temporarily unavailable.");
});

test("refresh releases desktop control and the overview fits at 320 pixels", async ({
  page,
}) => {
  await fixture(page);
  await page.route("**/api/computer/takeover", (route) =>
    route.fulfill({ json: { control: "customer" } }),
  );
  await open(page);
  await page.getByRole("button", { name: "Refresh computer" }).click();
  await page.getByRole("button", { name: "Take over", exact: true }).click();
  await expect(
    page
      .getByRole("group", { name: "Computer controls", exact: true })
      .getByRole("button", { name: "Return control", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("You have control", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Refresh computer" }).click();
  await expect(page.getByText("You have control", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Take over", exact: true }),
  ).toBeEnabled();
  await expect(
    page
      .getByRole("group", { name: "Computer controls", exact: true })
      .getByRole("button", { name: "Take over", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.setViewportSize({ width: 320, height: 720 });
  const mobileScreen = await page.locator(".preview-desktop").boundingBox();
  expect(mobileScreen!.width / mobileScreen!.height).toBeCloseTo(540 / 1140, 3);
  expect(mobileScreen!.height).toBeLessThanOrEqual(380);
  await page.getByRole("button", { name: "Dismiss message" }).click();
  await expect(
    page.getByRole("button", { name: "Refresh computer" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.locator(".workspace-page").screenshot({
    path: "test-results/computer-overview-mobile.png",
    animations: "disabled",
  });
});
test("registers a service without probing and creates seven-day signed and confirmed public links", async ({
  page,
}) => {
  await fixture(page);
  let registered = false;
  const grants: any[] = [];
  let probes = 0;
  await page.route("**/api/computer/services", (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({
        port: 8788,
        label: "Project preview",
      });
      registered = true;
      return route.fulfill({ status: 201, json: { service } });
    }
    return route.fulfill({
      json: {
        services: registered ? [service] : [],
        requests: [],
        publicationAllowed: true,
      },
    });
  });
  await page.route("**/api/computer/services/8788/check", (route) => {
    probes++;
    return route.fulfill({ json: { service } });
  });
  await page.route("**/api/computer/requests", (route) => {
    grants.push(route.request().postDataJSON());
    return route.fulfill({ status: 202, json: { queued: true } });
  });
  await open(page);
  await page
    .getByRole("button", { name: "Remote access", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add a doorway", exact: true })
    .click();
  const register = page.getByRole("dialog");
  await register.getByLabel("What’s it called?").fill("Project preview");
  await register
    .getByRole("button", { name: "Add a doorway", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /Project preview/ }),
  ).toBeVisible();
  expect(probes).toBe(0);
  await page.getByRole("button", { name: "Make a link", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Keep it open for")).toHaveValue("3600");
  await dialog.getByLabel("Keep it open for").selectOption("604800");
  await expect(dialog.getByText(/cannot be disabled early/)).toBeVisible();
  await dialog.getByRole("button", { name: "Make temporary link" }).click();
  expect(grants[0]).toMatchObject({
    port: 8788,
    kind: "signed",
    ttl_seconds: 604800,
  });
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Make a link", exact: true }).click();
  await dialog
    .getByLabel("How would you like to share it?")
    .selectOption("public");
  await expect(dialog.getByText(/Anyone with this public link/)).toBeVisible();
  expect(grants).toHaveLength(1);
  await dialog.getByRole("button", { name: "Make public link" }).click();
  expect(grants[1]).toMatchObject({ port: 8788, kind: "public" });
  expect(grants[1].ttl_seconds).toBeUndefined();
});
test("opens an agent request from notifications and approves only after review", async ({
  page,
}) => {
  await fixture(page);
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let decision = "pending";
  const actions: string[] = [];
  const request = {
    ...service,
    id,
    reason: "Preview the site I built.",
    source: "agent",
    kind: "signed",
    ttlSeconds: 604800,
    status: "pending",
  };
  await page.route("**/api/notifications", (route) =>
    route.fulfill({
      json: {
        notifications: [
          {
            id: "note",
            ownerId: service.ownerId,
            text: "Project preview needs approval",
            createdAt: service.createdAt,
            target: { view: "computer", requestId: id },
          },
        ],
      },
    }),
  );
  await page.route("**/api/computer/services", (route) =>
    route.fulfill({
      json: {
        services: [service],
        requests: [{ ...request, status: decision }],
        publicationAllowed: true,
      },
    }),
  );
  await page.route(`**/api/computer/requests/${id}/approve`, (route) => {
    actions.push(route.request().method());
    expect(route.request().postDataJSON()).toEqual({});
    decision = "publishing";
    return route.fulfill({
      json: { request: { ...request, status: decision } },
    });
  });
  await open(page);
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await page
    .getByRole("button", { name: "Notifications", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Project preview needs approval/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Computer", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remote access", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`#computer-request-${id}`)).toContainText(
    "Seven days",
  );
  expect(actions).toEqual([]);
  await page.getByRole("button", { name: "Review link" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Give this link the go-ahead?",
  });
  await expect(dialog.getByText(/cannot be disabled early/)).toBeVisible();
  await dialog
    .getByRole("button", { name: "Give the go-ahead", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(actions).toEqual(["POST"]);
  await expect(page.locator(`#computer-request-${id}`)).toContainText(
    "Making your link…",
  );
});
test("disables public access while preserving signed links and handles expired links", async ({
  page,
}) => {
  await fixture(page);
  let removed = false;
  let deletes = 0;
  const links = [
    {
      id: "public",
      kind: "public",
      status: "approved",
      url: "https://public.agent37.app",
    },
    {
      id: "signed",
      kind: "signed",
      status: "approved",
      url: "https://test123456-8788.agent37.app/?a37_token=fixture",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
    {
      id: "expired",
      kind: "signed",
      status: "expired",
      expiresAt: new Date(Date.now() - 3600000).toISOString(),
    },
  ];
  await page.route("**/api/computer/services", (route) =>
    route.fulfill({
      json: {
        services: [{ ...service, state: "running" }],
        requests: links.map((link) => ({
          ...service,
          ...link,
          ...(removed && link.id === "public"
            ? { status: "revoked", url: undefined }
            : {}),
        })),
        publicationAllowed: true,
      },
    }),
  );
  await page.route("**/api/computer/services/8788/public-link", (route) => {
    expect(route.request().method()).toBe("DELETE");
    deletes++;
    removed = true;
    return route.fulfill({ status: 202, json: { queued: true } });
  });
  await open(page);
  await page
    .getByRole("button", { name: "Remote access", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Open", exact: true }),
  ).toHaveCount(2);
  await expect(page.getByText(/Expired · Expires/)).toBeVisible();
  await page
    .getByRole("button", { name: "Close public link", exact: true })
    .click();
  expect(deletes).toBe(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close public link", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Open", exact: true }),
  ).toHaveCount(1);
  expect(deletes).toBe(1);
  await expect(
    page.getByRole("link", { name: "Open", exact: true }),
  ).toHaveAttribute("href", /a37_token=fixture/);
});
test("returns desktop control when navigating away and tells the next chat turn to inspect it", async ({
  page,
}) => {
  await fixture(page);
  await page.route("**/api/computer/takeover", (route) =>
    route.fulfill({ json: { control: "customer" } }),
  );
  let sent: any;
  await page.route("**/api/responses", (route) => {
    sent = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'event: response.completed\ndata: {"type":"response.completed"}\n\n',
    });
  });
  await open(page);
  await page.getByRole("button", { name: "Refresh computer" }).click();
  await page.getByRole("button", { name: "Take over", exact: true }).click();
  await expect(page.getByText("You have control")).toBeVisible();
  await page
    .getByRole("link", { name: "Your conversation", exact: true })
    .click();
  await page.getByPlaceholder(/A thought, a task/).fill("Please continue.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => sent?.takeover).toBe(true);
  await page
    .getByRole("button", { name: "Preview computer", exact: true })
    .click();
  await expect(page.getByText("You have control")).toHaveCount(0);
});
test("shows metrics failures, empty samples and responsive services on mobile", async ({
  page,
}) => {
  await fixture(page);
  let failing = true;
  let releaseMetrics!: () => void;
  const heldMetrics = new Promise<void>((resolve) => {
    releaseMetrics = resolve;
  });
  await page.route("**/api/computer/metrics", async (route) => {
    if (!failing) await heldMetrics;
    return route.fulfill(
      failing
        ? {
            status: 503,
            json: {
              error: {
                code: "metrics_unavailable",
                message: "Metrics are temporarily unavailable.",
              },
            },
          }
        : {
            json: {
              ...metrics,
              series: { cpu_cores: [], memory_bytes: [], disk_bytes: [] },
            },
          },
    );
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Computer", exact: true }).click();
  await page
    .getByRole("button", { name: "Resource usage", exact: true })
    .click();
  await expect(
    page.getByText("Metrics are temporarily unavailable."),
  ).toBeVisible();
  failing = false;
  const refresh = page
    .getByRole("region", { name: "Resource metrics" })
    .getByRole("button", { name: "Refresh metrics", exact: true });
  await expect(refresh).toHaveText("");
  await refresh.click();
  await expect(
    page.getByRole("button", { name: "Refreshing metrics…", exact: true }),
  ).toBeDisabled();
  releaseMetrics();
  await expect(refresh).toBeEnabled();
  await expect(page.getByText("No samples yet")).toHaveCount(3);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .locator(".workspace-page")
    .screenshot({ path: ".cache/computer-workspace-mobile.png" });
  await page
    .getByRole("button", { name: "Remote access", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add a doorway", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
