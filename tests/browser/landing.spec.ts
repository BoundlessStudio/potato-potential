import { expect, test } from "@playwright/test";

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
    .getByRole("link", { name: "Find your little sidekick", exact: true })
    .click();
  await expect(page).toHaveURL(/#join-beta$/);
  await expect(
    page.getByLabel("Email address", { exact: true }),
  ).toBeInViewport();
  expect(mutations).toEqual([]);
});
