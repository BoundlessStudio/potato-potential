import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

async function expectInlineUploadToolbar(page: Page) {
  const composer = await page.locator(".composer").boundingBox();
  const controls = await Promise.all(
    [
      "Attach files",
      "Upload file",
      "Upload destination folder",
      "Send message",
    ].map((name) =>
      page.getByRole("button", { name, exact: true }).boundingBox(),
    ),
  );
  const middle = controls[0]!.y + controls[0]!.height / 2;
  for (const control of controls) {
    expect(Math.abs(control!.y + control!.height / 2 - middle)).toBeLessThan(1);
    expect(control!.x).toBeGreaterThanOrEqual(composer!.x);
    expect(control!.x + control!.width).toBeLessThanOrEqual(
      composer!.x + composer!.width,
    );
  }
  await expect(
    page.getByText("A little help starts here.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Up to 100 MB · Drop or paste files", { exact: true }),
  ).toHaveCount(0);
}

test("folder picker defaults to uploads, navigates Home and cancels changes", async ({
  page,
}) => {
  await page.goto("/");
  const destination = page.getByRole("button", {
    name: "Upload destination folder",
  });
  const attach = page.getByRole("button", {
    name: "Attach files",
    exact: true,
  });
  const options = page.getByRole("region", { name: "File attachment options" });
  await expect(attach).toHaveAttribute("aria-expanded", "false");
  await expect(options).not.toBeVisible();
  await expect(destination).not.toBeVisible();
  await page.getByLabel("Message your companion").fill("Keep this draft");
  const inputBounds = await page
    .getByLabel("Message your companion")
    .boundingBox();
  const attachBounds = await attach.boundingBox();
  expect(attachBounds!.y).toBeGreaterThanOrEqual(
    inputBounds!.y + inputBounds!.height,
  );
  await attach.click();
  await expect(attach).toHaveAttribute("aria-expanded", "true");
  await expect(options).toBeVisible();
  await expectInlineUploadToolbar(page);
  await page
    .locator(".composer")
    .screenshot({ path: ".cache/inline-upload-desktop.png" });
  await attach.click();
  await expect(options).not.toBeVisible();
  await expect(page.getByLabel("Message your companion")).toHaveValue(
    "Keep this draft",
  );
  await attach.press("Space");
  await expect(destination).toHaveText("/home/node/uploads/");
  await expect(
    page.getByRole("textbox", { name: "Upload destination folder" }),
  ).toHaveCount(0);
  await destination.click();
  const dialog = page.getByRole("dialog", { name: "Choose upload folder" });
  await expect(
    dialog.getByRole("button", { name: "Use this folder" }),
  ).toBeEnabled();
  await expect(
    dialog.getByRole("navigation", { name: "Current folder" }),
  ).toHaveText("/home/nodeuploads");
  await expect(
    dialog.getByRole("button", { name: "Linuxbrew", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Up one folder" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Home", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Up one folder" }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Open .hermes", exact: true }),
  ).toHaveCount(0);
  await dialog.getByLabel("Show hidden folders").check();
  await expect(
    dialog.getByRole("button", { name: "Open .hermes", exact: true }),
  ).toBeVisible();
  await dialog.getByLabel("Filter folders").fill("work");
  await expect(
    dialog.getByRole("button", { name: "Open outputs", exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Open work", exact: true }).click();
  await expect(dialog.getByLabel("Filter folders")).toHaveValue("");
  await dialog.getByRole("button", { name: "Open 客户", exact: true }).click();
  await dialog.getByRole("button", { name: "Up one folder" }).click();
  await expect(
    dialog.getByRole("navigation", { name: "Current folder" }),
  ).toHaveText("/home/nodework");
  await dialog
    .getByRole("navigation", { name: "Current folder" })
    .getByRole("button", { name: "/home/node", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Open outputs", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: ".cache/upload-folder-picker-desktop.png" });
  await dialog
    .getByRole("button", { name: "Open outputs", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(destination).toHaveText("/home/node/uploads/");
  await expect(destination).toBeFocused();
  await destination.click();
  await expect(dialog.getByText("No subfolders here.")).toBeVisible();
  await dialog.getByRole("button", { name: "Use this folder" }).click();
  await expect(destination).toHaveText("/home/node/uploads/");
  const choose = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload file", exact: true }).click();
  await (
    await choose
  ).setFiles({
    name: "uploads-picker.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(0),
  });
  await expect(
    page.getByText(/Saved to \/home\/node\/uploads\/uploads-picker.*\.txt/),
  ).toBeVisible();
  await attach.click();
  await expect(options).not.toBeVisible();
  await expect(
    page.getByRole("list", { name: "Pending attachments" }),
  ).toBeVisible();
  await attach.click();
  await destination.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(destination).toBeFocused();
});
test("folder failures require recovery and the picker fits a narrow mobile screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  let fail = true;
  await page.route("**/api/files/directories**", async (route) => {
    if (fail)
      await route.fulfill({
        status: 404,
        json: {
          error: {
            code: "directory_not_found",
            message: "This folder no longer exists. Choose another folder.",
          },
        },
      });
    else await route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Attach files", exact: true }).click();
  await page.getByRole("button", { name: "Upload destination folder" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose upload folder" });
  await expect(dialog.getByRole("alert")).toContainText(
    "This folder no longer exists",
  );
  await expect(
    dialog.getByRole("button", { name: "Use this folder" }),
  ).toBeDisabled();
  fail = false;
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Use this folder" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Home", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Open work", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Open work", exact: true }).click();
  await dialog.getByRole("button", { name: "Open 客户", exact: true }).click();
  await expect(dialog.getByText("No subfolders here.")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".cache/upload-folder-picker-mobile.png" });
  await dialog.getByRole("button", { name: "Use this folder" }).click();
  await expect(
    page.getByRole("button", { name: "Upload destination folder" }),
  ).toHaveText("/home/node/work/客户/");
  await expectInlineUploadToolbar(page);
  await page
    .locator(".composer")
    .screenshot({ path: ".cache/inline-upload-mobile.png" });
});
test("uploads immediately, sends exact native paths, and downloads from saved history", async ({
  page,
}) => {
  const bytes = Buffer.alloc(5_000_001);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
  let submitted: any;
  await page.route("**/api/responses", async (route) => {
    submitted = route.request().postDataJSON();
    await route.continue();
  });
  await page.goto("/");
  const destination = page.getByRole("button", {
    name: "Upload destination folder",
  });
  await page.getByRole("button", { name: "Attach files", exact: true }).click();
  await expect(destination).toHaveText("/home/node/uploads/");
  await destination.click();
  const folders = page.getByRole("dialog", { name: "Choose upload folder" });
  await folders.getByRole("button", { name: "Home", exact: true }).click();
  await folders.getByRole("button", { name: "Open work", exact: true }).click();
  await folders.getByRole("button", { name: "Open 客户", exact: true }).click();
  await folders.getByRole("button", { name: "Use this folder" }).click();
  await expect(destination).toHaveText("/home/node/work/客户/");
  await page.getByLabel("Choose files to upload").setInputFiles([
    { name: "résumé.csv", mimeType: "application/octet-stream", buffer: bytes },
    { name: "empty.txt", mimeType: "text/plain", buffer: Buffer.alloc(0) },
  ]);
  await expect(
    page.getByText("Attached to your next message", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("list", { name: "Pending attachments" }),
  ).toHaveCount(0);
  expect(submitted.files).toHaveLength(2);
  expect(submitted.files[0]).toMatch(
    /^\/home\/node\/work\/客户\/résumé.*\.csv$/,
  );
  await expect(page.getByRole("button", { name: "Stop response" })).toHaveCount(
    0,
  );
  await page.reload();
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "résumé.csv", exact: true })
    .first()
    .click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^résumé.*\.csv$/);
  const downloaded = await readFile((await download.path())!);
  expect(createHash("sha256").update(downloaded).digest("hex")).toBe(
    createHash("sha256").update(bytes).digest("hex"),
  );
});
test("retains the draft and attachments before acceptance, and removal excludes a saved file", async ({
  page,
}) => {
  let fail = true,
    submitted: any;
  await page.route("**/api/responses", async (route) => {
    submitted = route.request().postDataJSON();
    if (fail)
      await route.fulfill({
        status: 404,
        json: {
          error: {
            code: "file_not_found",
            message: "The selected file is missing.",
          },
        },
      });
    else await route.continue();
  });
  await page.goto("/");
  await page.getByLabel("Choose files to upload").setInputFiles({
    name: "keep.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("saved"),
  });
  await expect(
    page.getByText("Attached to your next message", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Message your companion").fill("Keep this draft");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText("The selected file is missing.")).toBeVisible();
  expect(await page.getByLabel("Message your companion").inputValue()).toBe(
    "Keep this draft",
  );
  await expect(
    page.getByRole("list", { name: "Pending attachments" }),
  ).toBeVisible();
  const path = submitted.files[0];
  await page.getByRole("button", { name: "Remove keep.txt" }).click();
  fail = false;
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop response" })).toHaveCount(
    0,
  );
  expect(submitted.files).toEqual([]);
  const saved = await page.evaluate(async (path) => {
    const account = await (
      await fetch("http://localhost:4000/api/me", {
        headers: { Authorization: "Bearer demo" },
      })
    ).json();
    return (
      await fetch(
        `http://localhost:4000/api/files/content?${new URLSearchParams({ instance: account.agent.instanceId, path })}`,
        { headers: { Authorization: "Bearer demo" } },
      )
    ).status;
  }, path);
  expect(saved).toBe(200);
});
test("blocks sends during failed uploads, resumes after reselecting on reload and fits mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  let fail = true;
  await page.route("**/api/files/uploads/*/chunks/*", async (route) => {
    if (fail)
      await route.fulfill({
        status: 503,
        json: {
          error: { code: "interrupted", message: "Upload interrupted." },
        },
      });
    else await route.continue();
  });
  await page.goto("/");
  const file = {
    name: "resume.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("same original"),
  };
  await page.getByLabel("Choose files to upload").setInputFiles(file);
  await expect(page.getByText("Upload interrupted.")).toBeVisible();
  await page.getByLabel("Message your companion").fill("Use this file");
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.getByText("Reselect the original file to resume."),
  ).toBeVisible();
  fail = false;
  const choose = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Retry resume.txt" }).click();
  await (await choose).setFiles(file);
  await expect(
    page.getByText("Attached to your next message", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".cache/file-uploads-mobile.png",
    fullPage: true,
  });
});
test("supports dropped and pasted files", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Attach files", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "File attachment options" }),
  ).not.toBeVisible();
  await page.locator(".chat-column").evaluate((element) => {
    const data = new DataTransfer();
    data.items.add(new File(["drop"], "dropped.txt"));
    element.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
      }),
    );
  });
  await page.getByLabel("Message your companion").evaluate((element) => {
    const data = new DataTransfer();
    data.items.add(new File(["paste"], "pasted.txt"));
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  });
  await expect(
    page
      .getByRole("list", { name: "Pending attachments" })
      .getByText("Attached to your next message", { exact: false }),
  ).toHaveCount(2);
});
test("retries cancellation after a lease conflict and lost reply without restoring the removed attachment", async ({
  page,
}) => {
  await page.route("**/api/files/uploads/*/chunks/*", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: "interrupted", message: "Interrupted piece." } },
    }),
  );
  let attempts = 0;
  await page.route("**/api/files/uploads/*", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.continue();
      return;
    }
    attempts++;
    if (attempts === 1)
      await route.fulfill({
        status: 409,
        json: {
          error: { code: "operation_running", message: "Computer is busy." },
        },
      });
    else if (attempts === 2) {
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await page.goto("/");
  await page.getByLabel("Choose files to upload").setInputFiles({
    name: "cancel.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("cancel staging"),
  });
  await expect(page.getByText("Interrupted piece.")).toBeVisible();
  await page.getByRole("button", { name: "Remove cancel.txt" }).click();
  await expect.poll(() => attempts).toBe(2);
  await page.reload();
  await expect.poll(() => attempts).toBe(3);
  await expect(
    page.getByRole("list", { name: "Pending attachments" }),
  ).toHaveCount(0);
});
test("recovers the requested download after the passwordless callback returns to chat", async ({
  page,
}) => {
  const next =
    "/api/files/content?instance=abcdefghij&path=%2Fhome%2Fnode%2Foutputs%2Freport.txt";
  await page.addInitScript(() => {
    if (!localStorage.getItem("boundless-download-return"))
      localStorage.setItem("boundless-demo-user", "signed-out");
  });
  await page.goto(`/signin?${new URLSearchParams({ next })}`);
  await page.getByLabel("Email address").fill("alex@example.com");
  await page.getByRole("button", { name: "Send a sign-in link" }).click();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("boundless-download-return"),
    ),
  ).toBe(next);
  await page.goto("/signin?auth_error=1");
  await page.getByLabel("Email address").fill("alex@example.com");
  await page.getByRole("button", { name: "Send a sign-in link" }).click();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("boundless-download-return"),
    ),
  ).toBe(next);
  await page.evaluate(() =>
    localStorage.setItem("boundless-demo-user", "demo"),
  );
  let requested = "";
  await page.route("**/api/files/content?*", async (route) => {
    requested =
      new URL(route.request().url()).pathname +
      new URL(route.request().url()).search;
    await route.fulfill({
      status: 200,
      headers: {
        "Content-Disposition": 'attachment; filename="report.txt"',
        "Content-Type": "text/plain",
      },
      body: "Recovered file",
    });
  });
  const download = page.waitForEvent("download");
  await page.goto("/");
  expect((await download).suggestedFilename()).toBe("report.txt");
  expect(requested).toBe(next);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("boundless-download-return"),
    ),
  ).toBeNull();
});
