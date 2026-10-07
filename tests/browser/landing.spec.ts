import { expect, test } from "@playwright/test";

test("big possibilities supports keyboard exploration and keeps signup as a separate action", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("boundless-demo-user", "signed-out"),
  );
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/"))
      mutations.push(request.url());
  });
  await page.goto("/");
  await page
    .getByRole("link", { name: "Big possibilities", exact: true })
    .click();
  await expect(page).toHaveURL(/#big-possibilities$/);
  const section = page.getByRole("region", { name: "Big possibilities." });
  await expect(
    section.getByRole("heading", { name: "Big possibilities." }),
  ).toBeInViewport();
  for (const [name, service, example] of [
    ["Brave", "freshness filters", "Compare three newsletter platforms"],
    ["Composio", "examples from the app catalog", "project updates from Slack"],
    ["Perflo", "live catalog", "coworking-space listings"],
    ["Inkbox", "iMessage connection", "forwarded the venue’s email"],
  ]) {
    const partner = section.getByRole("article", { name, exact: true });
    await expect(
      partner.getByRole("heading", { name: "What’s available" }),
    ).toBeVisible();
    await expect(partner.getByText(service, { exact: false })).toBeVisible();
    await expect(
      partner.getByRole("heading", { name: "Try asking" }),
    ).toBeVisible();
    await expect(partner.getByText(example, { exact: false })).toBeVisible();
    await expect(partner.locator("details")).toHaveCount(0);
    const logo = partner.getByRole("img", {
      name: `${name} logo`,
      exact: true,
    });
    await logo.scrollIntoViewIfNeeded();
    await expect(logo).toBeVisible();
    await expect(logo).toHaveJSProperty("complete", true);
    expect(
      await logo.evaluate((image: HTMLImageElement) => image.naturalWidth),
    ).toBeGreaterThan(0);
  }
  const machinery = page.getByRole("region", {
    name: "A peek at the machinery.",
  });
  await expect(machinery.locator("details")).toHaveCount(7);
  for (const name of ["Brave", "Composio", "Perflo", "Inkbox"])
    await expect(
      machinery
        .locator("summary")
        .filter({ hasText: `${name}: under the hood` }),
    ).toBeVisible();

  // Native disclosures work with a keyboard, including reopening and closing.
  const voice = machinery
    .locator("details")
    .filter({ hasText: "Inkbox: under the hood" });
  const voiceSummary = voice.locator("summary");
  await expect(voice.getByRole("link")).not.toBeVisible();
  await voiceSummary.focus();
  await page.keyboard.press("Enter");
  await expect(voice).toHaveAttribute("open", "");
  await expect(voice).toContainText("rather than reading its memory live");
  await expect(voice.getByRole("link")).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  await page.keyboard.press("Enter");
  await expect(voice).not.toHaveAttribute("open", "");
  await expect(voice.getByRole("link")).not.toBeVisible();

  const memory = section
    .locator("details")
    .filter({ hasText: "Memory & your shared workspace" });
  await memory.locator("summary").click();
  await expect(memory).toHaveAttribute("open", "");
  await expect(memory.locator("code").first()).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  const progress = section
    .locator("details")
    .filter({ hasText: "Tool discovery & live progress" });
  await expect(progress).toHaveAttribute("open", "");
  await expect(progress).toContainText("recover interrupted streams");

  await page
    .getByRole("link", { name: "Let’s grow something good", exact: true })
    .click();
  await expect(page).toHaveURL(/#join-beta$/);
  await expect(
    page.getByLabel("Email address", { exact: true }),
  ).toBeInViewport();
  expect(mutations).toEqual([]);
});

for (const width of [1280, 390]) {
  test(`homepage shows every little possibility and the studio link at ${width}px without creating work`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() =>
      localStorage.setItem("boundless-demo-user", "signed-out"),
    );
    const mutations: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET" && request.url().includes("/api/"))
        mutations.push(request.url());
    });
    await page.goto(width > 640 ? "/" : "/#possibilities");
    if (width > 640) {
      await page
        .getByRole("link", { name: "Little possibilities", exact: true })
        .click();
    }
    const possibilities = page.locator("#possibilities");
    await expect(
      possibilities.getByRole("heading", {
        name: "Little possibilities",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: /What’s on/ })).toHaveCount(
      0,
    );
    await expect(possibilities.getByRole("article")).toHaveCount(3);
    await expect(possibilities.getByRole("button")).toHaveCount(0);
    for (const [name, prompt, artifact] of [
      ["Tasks", "My week is a bit of a jumble", "A little breathing room"],
      ["Wiki", "I have an idea, three notes", "The idea garden"],
      [
        "Routines",
        "Can we make Sunday planning a thing?",
        "Sunday, a little softer",
      ],
    ]) {
      const example = possibilities.getByRole("article", { name, exact: true });
      await expect(
        example.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
      await expect(example.getByText(prompt, { exact: false })).toBeVisible();
      await expect(
        example.getByRole("heading", { name: artifact }),
      ).toBeVisible();
      if (width > 640) {
        await expect(
          example.getByRole("heading", { name, exact: true }),
        ).toBeInViewport();
      }
    }
    // All content is rendered without selecting a tab, including on a phone.
    for (const article of await page
      .locator("#possibilities article, #big-possibilities article")
      .all()) {
      const bounds = await article.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    const studio = page
      .locator("footer")
      .getByRole("link", { name: "Venatio Studios 2026", exact: true });
    await expect(studio).toBeVisible();
    await expect(studio).toHaveAttribute("href", "https://venatiostudios.com/");
    await expect(
      page.getByText("A little help. A lot of possibility.", { exact: true }),
    ).toHaveCount(0);
    await expect(page.locator("#faq-title")).toHaveCount(0);
    await expect(
      page.getByText("How does the beta work?", { exact: true }),
    ).toHaveCount(0);
    for (const [name, services] of [
      ["Composio", ["Gmail", "Google Calendar", "Slack", "Notion", "GitHub"]],
      ["Perflo", ["Apify", "Exa", "Google Maps"]],
      ["Inkbox", ["Email", "iMessage", "Voice calls"]],
    ] as const) {
      const integrations = page.getByRole("list", {
        name: `${name} integrations`,
        exact: true,
      });
      await integrations.scrollIntoViewIfNeeded();
      for (const service of services)
        await expect(
          integrations.getByText(service, { exact: true }),
        ).toBeVisible();
      for (const image of await integrations.locator("img").all()) {
        await expect(image).toHaveJSProperty("complete", true);
        expect(
          await image.evaluate(
            (element: HTMLImageElement) => element.naturalWidth,
          ),
        ).toBeGreaterThan(0);
      }
    }
    const partners = page
      .getByRole("article", { name: "Brave", exact: true })
      .locator("..");
    await partners.screenshot({
      path: `.cache/homepage-partner-icons-${width}.png`,
    });
    const machinery = page.getByRole("region", {
      name: "A peek at the machinery.",
    });
    for (const summary of await machinery.locator("summary").all())
      await summary.click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await machinery.screenshot({
      path: `.cache/homepage-machinery-expanded-${width}.png`,
    });
    await page
      .getByRole("link", { name: "Let’s grow something good", exact: true })
      .click();
    await expect(page).toHaveURL(/#join-beta$/);
    await expect(
      page.getByLabel("Email address", { exact: true }),
    ).toBeInViewport();
    expect(mutations).toEqual([]);
  });
}
