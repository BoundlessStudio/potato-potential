import { expect, test } from "@playwright/test";

test("shows only About you and Agent notes below Pip’s details and saves each draft independently", async ({
  page,
}) => {
  const files: Record<string, { content: string; modified: number }> = {
    user: { content: "Quiet mornings and clear plans.", modified: 1 },
    memory: { content: "Keep ongoing work visible.", modified: 2 },
  };
  const reads: string[] = [];
  const saves: string[] = [];
  await page.route("**/api/memory/*", async (route) => {
    const file = route.request().url().split("/").pop()!;
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      expect(body.modified).toBe(files[file].modified);
      saves.push(file);
      files[file] = {
        content: body.content,
        modified: files[file].modified + 1,
      };
      return route.fulfill({ json: { saved: true } });
    }
    reads.push(file);
    return route.fulfill({ json: files[file] });
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const editors = [
    ["About you", "user"],
    ["Agent notes", "memory"],
  ];
  for (const [title, file] of editors) {
    await expect(
      page.getByRole("textbox", { name: title, exact: true }),
    ).toHaveValue(files[file].content);
    await expect(
      page.getByRole("button", { name: `Save ${title}`, exact: true }),
    ).toBeDisabled();
  }
  await expect(
    page.getByRole("textbox", { name: "SOUL", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save SOUL", exact: true }),
  ).toHaveCount(0);
  expect(reads.sort()).toEqual(["memory", "user"]);
  expect(
    await page
      .locator(".memory-settings")
      .evaluate(
        (section) =>
          !!(
            section.compareDocumentPosition(
              document.querySelector(".settings-layout")!,
            ) & Node.DOCUMENT_POSITION_PRECEDING
          ),
      ),
  ).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Keep in touch." }),
  ).toHaveCount(0);
  const contacts = page
    .locator(".settings-layout > .settings-card")
    .first()
    .locator(".companion-contact-details");
  await expect(contacts.locator("dd")).toHaveCount(2);
  await expect(contacts.locator("input, textarea, button, a")).toHaveCount(0);
  for (const [title] of editors) {
    await page
      .getByRole("textbox", { name: title, exact: true })
      .fill(`${title} draft`);
  }
  await page
    .getByRole("button", { name: "Save Agent notes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save Agent notes", exact: true }),
  ).toBeDisabled();
  expect(saves).toEqual(["memory"]);
  await expect(
    page.getByRole("textbox", { name: "About you", exact: true }),
  ).toHaveValue("About you draft");
  await expect(
    page.getByRole("textbox", { name: "Agent notes", exact: true }),
  ).toHaveValue("Agent notes draft");
  await page
    .getByRole("button", { name: "Save About you", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save About you", exact: true }),
  ).toBeDisabled();
  expect(saves).toEqual(["memory", "user"]);
});

test("keeps stale drafts until an explicit reload and recovers file loading failures", async ({
  page,
}) => {
  let failLoad = true;
  await page.route("**/api/me", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: {
        ...body,
        agent: { ...body.agent, agentEmail: "pip-944242936a@inkboxmail.com" },
      },
    });
  });
  await page.route("**/api/memory/*", async (route) => {
    const file = route.request().url().split("/").pop()!;
    if (file === "memory" && failLoad) {
      return route.fulfill({
        status: 503,
        json: { error: { message: "Couldn’t load agent notes. Try again." } },
      });
    }
    if (route.request().method() === "PUT") {
      return route.fulfill({
        status: 412,
        json: {
          error: {
            message: "The agent edited this file. Reload before saving.",
          },
        },
      });
    }
    return route.fulfill({
      json: { content: `Latest ${file}`, modified: 123 },
    });
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const notes = page.getByRole("article", { name: "Agent notes", exact: true });
  await expect(notes.getByRole("alert")).toContainText(
    "Couldn’t load agent notes",
  );
  await expect(notes.getByRole("textbox")).toBeDisabled();
  await page
    .getByRole("textbox", { name: "About you", exact: true })
    .fill("Unsaved about you");
  failLoad = false;
  await notes
    .getByRole("button", { name: "Reload latest", exact: true })
    .click();
  await expect(notes.getByRole("textbox")).toHaveValue("Latest memory");
  await expect(
    page.getByRole("textbox", { name: "About you", exact: true }),
  ).toHaveValue("Unsaved about you");
  await notes.getByRole("textbox").fill("My unsaved notes");
  await notes
    .getByRole("button", { name: "Save Agent notes", exact: true })
    .click();
  await expect(notes.getByRole("alert")).toContainText("Reload before saving");
  await expect(notes.getByRole("textbox")).toHaveValue("My unsaved notes");
  await expect(
    notes.getByRole("button", { name: "Save Agent notes", exact: true }),
  ).toBeEnabled();
  await notes
    .getByRole("button", { name: "Discard edits & reload", exact: true })
    .click();
  await expect(notes.getByRole("textbox")).toHaveValue("Latest memory");
  await expect(notes.getByRole("alert")).toHaveCount(0);
  await expect(
    notes.getByRole("button", { name: "Save Agent notes", exact: true }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(
    page.getByRole("textbox", { name: "About you", exact: true }),
  ).toHaveValue("Unsaved about you");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .locator(
        ".settings-layout > .settings-card, .companion-contact-details, .memory-editor",
      )
      .evaluateAll((elements) =>
        elements.every((element) => {
          const bounds = element.getBoundingClientRect();
          return (
            bounds.left >= 0 &&
            bounds.right <= innerWidth &&
            element.scrollWidth <= element.clientWidth
          );
        }),
      ),
  ).toBe(true);
});
