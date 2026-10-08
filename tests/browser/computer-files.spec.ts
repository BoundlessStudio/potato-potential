import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
const files = (page: Page) =>
  page.getByRole("region", { name: "Computer files", exact: true });
async function openFiles(page: Page) {
  await page.goto("/computer");
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await expect(
    files(page).getByRole("button", { name: "weekly-plan.md", exact: true }),
  ).toBeVisible();
}
async function upload(page: Page, name: string, content: string) {
  await files(page)
    .getByLabel("Choose files for this folder")
    .setInputFiles({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from(content),
    });
  await expect(
    files(page).getByRole("list", { name: "File transfers" }),
  ).toContainText("Saved to");
  await expect(
    files(page).getByRole("button", { name, exact: true }),
  ).toBeVisible();
  await files(page)
    .getByRole("button", { name: `Dismiss ${name}`, exact: true })
    .click();
}
test("browses, previews, uploads, renames, downloads and deletes files while retaining the folder across views", async ({
  page,
}) => {
  await openFiles(page);
  const pane = files(page),
    folder = "Research " + Date.now(),
    name = "Notes " + Date.now() + ".txt";
  await pane
    .getByRole("button", { name: "weekly-plan.md", exact: true })
    .dblclick();
  const preview = page.getByRole("dialog", { name: "weekly-plan.md" });
  await expect(preview).toContainText("Protect a quiet morning");
  await preview.getByRole("button", { name: "Close dialog" }).click();
  await pane.getByRole("button", { name: "New folder", exact: true }).click();
  let modal = page.getByRole("dialog", { name: "New folder", exact: true });
  await modal.getByRole("textbox", { name: "Folder name" }).fill(folder);
  await modal
    .getByRole("button", { name: "Create folder", exact: true })
    .click();
  await pane.getByRole("button", { name: folder, exact: true }).dblclick();
  await expect(
    pane.getByRole("navigation", { name: "Folder path" }),
  ).toContainText(folder);
  await upload(page, name, "A saved research note");
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Refresh computer", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Resource usage", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Resource metrics" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Remote access", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Remote access" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await expect(
    pane.getByRole("navigation", { name: "Folder path" }),
  ).toContainText(folder);
  await pane.getByRole("row").filter({ hasText: name }).click();
  await pane.getByRole("button", { name: "Rename", exact: true }).click();
  modal = page.getByRole("dialog", { name: "Rename item" });
  await modal.getByRole("textbox", { name: "New name" }).fill("Renamed.txt");
  await modal.getByRole("button", { name: "Save name" }).click();
  const row = pane.getByRole("row").filter({ hasText: "Renamed.txt" });
  await expect(row).toBeVisible();
  await row.click();
  const download = page.waitForEvent("download");
  await pane
    .getByRole("link", { name: "Download Renamed.txt", exact: true })
    .click();
  const result = await download;
  expect((await readFile((await result.path())!)).toString()).toBe(
    "A saved research note",
  );
  await pane.getByRole("button", { name: "Delete", exact: true }).click();
  modal = page.getByRole("dialog", { name: "Delete this item?" });
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(row).toBeVisible();
  await pane.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Delete this item?" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(
    pane.getByText("This folder is empty", { exact: true }),
  ).toBeVisible();
  await pane.getByRole("button", { name: "Up one folder" }).click();
  await pane.getByRole("row").filter({ hasText: folder }).click();
  const archive = page.waitForEvent("download");
  await pane
    .getByRole("link", { name: `Download ${folder} as archive` })
    .click();
  expect((await archive).suggestedFilename()).toBe(folder + ".tar.gz");
  await page.screenshot({
    path: "test-results/computer-files-desktop.png",
    fullPage: true,
  });
});
test("does not overwrite a name collision and sandboxes HTML previews", async ({
  page,
}) => {
  await openFiles(page);
  const pane = files(page),
    stem = Date.now();
  await upload(page, `first-${stem}.txt`, "Keep the first file");
  await upload(page, `second-${stem}.txt`, "Keep the second file");
  await pane
    .getByRole("row")
    .filter({ hasText: `first-${stem}.txt` })
    .click();
  await pane.getByRole("button", { name: "Rename", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Rename item" });
  await modal
    .getByRole("textbox", { name: "New name" })
    .fill(`second-${stem}.txt`);
  await modal.getByRole("button", { name: "Save name" }).click();
  await expect(modal.getByRole("alert")).toContainText(
    "already uses that name",
  );
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await upload(
    page,
    `preview-${stem}.html`,
    "<h1>Saved report</h1><script>parent.previewExecuted=true</script>",
  );
  await pane
    .getByRole("button", { name: `preview-${stem}.html`, exact: true })
    .dblclick();
  const frame = page.getByRole("dialog").locator("iframe");
  await expect(frame).toHaveAttribute("sandbox", "");
  await expect(
    frame.contentFrame().getByRole("heading", { name: "Saved report" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).previewExecuted),
  ).toBeUndefined();
});
test("keeps the file explorer usable on mobile, supports grid and hidden files, and leaves chat drafts alone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/chat");
  await page
    .getByLabel("Message your companion")
    .fill("Keep my web chat draft");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Computer", exact: true }).click();
  await page.getByRole("button", { name: "Files", exact: true }).click();
  const pane = files(page);
  await pane.getByRole("button", { name: "Grid view" }).click();
  await expect(
    pane.getByRole("button", { name: "weekly-plan.md", exact: true }),
  ).toBeVisible();
  await pane.getByRole("button", { name: "Home", exact: true }).first().click();
  await expect(
    pane.getByRole("button", { name: ".hermes", exact: true }),
  ).toHaveCount(0);
  await pane.getByRole("button", { name: "Show hidden files" }).click();
  await expect(
    pane.getByRole("button", { name: ".hermes", exact: true }),
  ).toBeVisible();
  await pane.getByRole("button", { name: "Uploads", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/computer-files-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("link", { name: "Your conversation", exact: true })
    .click();
  await expect(page.getByLabel("Message your companion")).toHaveValue(
    "Keep my web chat draft",
  );
  await expect(page.getByRole("list", { name: "Attachments" })).toHaveCount(0);
});
test("retries failed listings and ignores a late listing after navigation", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/files/list?*", async (route) => {
    const path = new URL(route.request().url()).searchParams.get("path");
    if (fail && path === "/home/node/outputs")
      await route.fulfill({
        status: 502,
        json: { error: { message: "Files are temporarily unavailable." } },
      });
    else await route.continue();
  });
  await page.goto("/computer");
  await page.getByRole("button", { name: "Files", exact: true }).click();
  const pane = files(page);
  await expect(pane.getByRole("alert")).toContainText(
    "temporarily unavailable",
  );
  fail = false;
  await pane.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    pane.getByRole("button", { name: "weekly-plan.md", exact: true }),
  ).toBeVisible();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/files/list?*", async (route) => {
    const path = new URL(route.request().url()).searchParams.get("path");
    if (path === "/home/node/outputs") {
      await held;
      await route.fulfill({
        json: {
          path,
          parentPath: "/home/node",
          entries: [
            {
              name: "Late old file",
              path: path + "/late.txt",
              type: "file",
              size: 4,
              modified: 0,
              hidden: false,
            },
          ],
          truncated: false,
        },
      });
    } else await route.continue();
  });
  await pane.getByRole("button", { name: "Refresh files" }).click();
  await pane.getByRole("button", { name: "Uploads", exact: true }).click();
  release();
  await expect(
    pane.getByRole("navigation", { name: "Folder path" }),
  ).toContainText("uploads");
  await expect(
    pane.getByRole("button", { name: "Late old file", exact: true }),
  ).toHaveCount(0);
});
