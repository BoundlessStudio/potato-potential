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

  // Native disclosures work with a keyboard, including reopening and closing.
  const voice = section
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

test("homepage examples and FAQs are explorable without creating work or joining the beta", async ({
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
    .getByRole("link", { name: "Little possibilities", exact: true })
    .click();
  const example = page.locator("#companion-example");
  const ideas = page.getByRole("button", {
    name: "Untangle an idea",
    exact: true,
  });
  await ideas.click();
  await expect(ideas).toHaveAttribute("aria-pressed", "true");
  await expect(example).toContainText("The idea garden");
  await expect(example).toContainText("give it a home in your wiki");
  const reminders = page.getByRole("button", {
    name: "Remember the little things",
    exact: true,
  });
  await reminders.focus();
  await page.keyboard.press("Space");
  await expect(reminders).toHaveAttribute("aria-pressed", "true");
  await expect(ideas).toHaveAttribute("aria-pressed", "false");
  await expect(example).toContainText("Sunday, a little softer");
  const planning = page.getByRole("button", {
    name: "Make room in my week",
    exact: true,
  });
  await planning.click();
  await expect(example).toContainText("A little breathing room");
  await expect(page.locator('button[aria-pressed="true"]')).toHaveCount(1);
  const betaQuestion = page.getByText("How does the beta work?", {
    exact: true,
  });
  await betaQuestion.click();
  await expect(
    page.getByText(
      "Joining the list doesn’t create an account or an agent yet.",
      { exact: false },
    ),
  ).toBeVisible();
  await betaQuestion.click();
  await expect(
    page.getByText(
      "Joining the list doesn’t create an account or an agent yet.",
      { exact: false },
    ),
  ).not.toBeVisible();
  await page
    .getByRole("link", { name: "Let’s grow something good", exact: true })
    .click();
  await expect(page).toHaveURL(/#join-beta$/);
  await expect(
    page.getByLabel("Email address", { exact: true }),
  ).toBeInViewport();
  expect(mutations).toEqual([]);
});
