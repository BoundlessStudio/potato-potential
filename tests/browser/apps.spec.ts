import { expect, test } from "@playwright/test";

const first = {
  slug: "alpha",
  name: "Alpha",
  description: "The first catalog page.",
};
const second = {
  slug: "beta",
  name: "Beta",
  description: "The next catalog page.",
};
const gmail = { slug: "gmail", name: "Gmail", description: "Search result." };
const composio = {
  slug: "COMPOSIO",
  name: "Composio",
  description: "Catalog service.",
};
const cursor = "next+/page=?";

test("loads apps and another page, deduplicates overlaps and guides short searches", async ({
  page,
}) => {
  const errors: string[] = [],
    queries: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/apps/connections", (route) =>
    route.fulfill({
      json: {
        connections: [
          {
            id: "catalog-service",
            toolkitSlug: "composio",
            toolkitName: "Composio",
            status: "ACTIVE",
          },
        ],
      },
    }),
  );
  await page.route("**/api/apps?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    queries.push(params.get("search") || "");
    if (params.get("search") === "gmail")
      return route.fulfill({ json: { toolkits: [gmail], nextCursor: null } });
    if (params.has("cursor")) {
      expect(params.get("cursor")).toBe(cursor);
      return route.fulfill({
        json: { toolkits: [first, second, composio], nextCursor: null },
      });
    }
    return route.fulfill({
      json: { toolkits: [first, composio], nextCursor: cursor },
    });
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Apps", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Alpha", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Composio", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Disconnect Composio", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Explore more apps" }).click();
  await expect(
    page.getByRole("heading", { name: "Beta", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Composio", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Alpha", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Explore more apps" }),
  ).toHaveCount(0);
  const search = page.getByRole("textbox", { name: "Search apps" });
  await search.fill("gm");
  await expect(page.getByRole("status")).toContainText(
    "at least three characters",
  );
  await page.waitForTimeout(350);
  expect(queries).toEqual(["", ""]);
  await search.fill("gmail");
  await expect(
    page.getByRole("heading", { name: "Gmail", exact: true }),
  ).toBeVisible();
  expect(queries).toEqual(["", "", "gmail"]);
  expect(errors).toEqual([]);
});

test("shows catalog failures with retry and preserves the first page after pagination fails", async ({
  page,
}) => {
  let initial = 0,
    next = 0;
  await page.route("**/api/apps?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const fail = params.has("cursor") ? ++next === 1 : ++initial === 1;
    if (fail)
      return route.fulfill({
        status: 502,
        json: {
          error: {
            code: "catalog_unavailable",
            message: "Catalog temporarily unavailable.",
          },
        },
      });
    return route.fulfill({
      json: {
        toolkits: params.has("cursor") ? [second] : [first],
        nextCursor: params.has("cursor") ? null : cursor,
      },
    });
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Apps", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Couldn’t load the apps." }),
  ).toBeVisible();
  await expect(
    page.getByText("No apps found just yet.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Explore more apps" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Alpha", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Explore more apps" }).click();
  await expect(page.locator('.toast[role="alert"]')).toContainText(
    "Catalog temporarily unavailable.",
  );
  await expect(
    page.getByRole("heading", { name: "Alpha", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Explore more apps" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Explore more apps" }).click();
  await expect(
    page.getByRole("heading", { name: "Beta", exact: true }),
  ).toBeVisible();
});

test("ignores an old page response after switching catalog searches", async ({
  page,
}) => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/apps?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("search") === "gmail")
      return route.fulfill({ json: { toolkits: [gmail], nextCursor: null } });
    if (params.has("cursor")) {
      await waiting;
      return route.fulfill({ json: { toolkits: [second], nextCursor: null } });
    }
    return route.fulfill({ json: { toolkits: [first], nextCursor: cursor } });
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Apps", exact: true }).click();
  await page.getByRole("button", { name: "Explore more apps" }).click();
  await expect(
    page.getByRole("button", { name: "Loading more apps" }),
  ).toBeDisabled();
  await page.getByRole("textbox", { name: "Search apps" }).fill("gmail");
  await expect(
    page.getByRole("heading", { name: "Gmail", exact: true }),
  ).toBeVisible();
  const oldResponse = page.waitForResponse((response) =>
    new URL(response.url()).searchParams.has("cursor"),
  );
  release();
  await oldResponse;
  await expect(
    page.getByRole("heading", { name: "Beta", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Gmail", exact: true }),
  ).toBeVisible();
});
