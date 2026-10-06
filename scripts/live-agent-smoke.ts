import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import express from "express";
import { chromium } from "@playwright/test";
import { Agent37 } from "../services/control-plane/src/providers";

// Explicit live check: creates a temporary zero-managed-budget instance, then deletes it.
// No customer identities, phone numbers, model calls or external messages are involved.
if (!process.env.AGENT37_API_KEY)
  throw new Error("AGENT37_API_KEY is required.");
const a37 = new Agent37(process.env.AGENT37_API_KEY);
const user = `boundless-smoke-${randomUUID()}`;
await mkdir(".cache", { recursive: true });
await writeFile(
  ".cache/live-agent-smoke.json",
  JSON.stringify({ user, phase: "creating" }),
);
let instanceId: string | undefined;
try {
  const instance = await a37.createInstance({
    template: "boundless-hermes-desktop@4",
    name: "Boundless temporary validation",
    user,
    budget: { monthly_cap_micros: 0 },
    auto_sleep: true,
    idle_timeout_seconds: 600,
  });
  instanceId = instance.id;
  await writeFile(
    ".cache/live-agent-smoke.json",
    JSON.stringify({ user, instanceId, phase: "checking" }),
  );
  console.log("Temporary image-validation instance created:", instanceId);
  let healthy = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      healthy = await a37.healthy(instanceId!);
    } catch {}
    if (healthy) break;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  if (!healthy) throw new Error("Gateway did not become healthy.");
  const result = await a37.exec(
    instanceId!,
    `set -e\n/usr/local/lib/hermes/hermes-agent/venv/bin/python -c 'import inkbox, aiohttp, segno'\ntest -f /opt/boundless/inkbox/plugin.yaml\ncurl -sf http://127.0.0.1:9222/json/version >/dev/null\ncurl -sf http://127.0.0.1:6901/vnc.html >/dev/null\necho "Pinned plugin, SDK, visible Chromium, and noVNC are ready"`,
  );
  if (result.exit_code)
    throw new Error("Desktop or packaged plugin check failed.");
  console.log(result.stdout.trim());
  const activation = await a37.exec(
    instanceId!,
    [
      "set -e",
      "mkdir -p ~/.hermes/plugins",
      "cp -R /opt/boundless/inkbox ~/.hermes/plugins/inkbox",
      "hermes plugins enable inkbox </dev/null >/dev/null",
      "hermes config set display.platforms.inkbox.show_reasoning false >/dev/null",
      'echo "Pinned plugin activation succeeded"',
    ].join("\n"),
  );
  if (activation.exit_code) throw new Error("Pinned plugin activation failed.");
  console.log(activation.stdout.trim());
  const file = "~/.boundless-validation/memory.md";
  const missing = await a37.readFile(instanceId!, file);
  if (missing.modified !== 0)
    throw new Error("Unexpected validation file already exists.");
  await a37.writeFile(instanceId!, file, "First memory", missing.modified);
  const original = await a37.readFile(instanceId!, file);
  if (original.content !== "First memory")
    throw new Error("Native file read/write failed.");
  await a37.writeFile(instanceId!, file, "Updated memory", original.modified);
  let staleRejected = false;
  try {
    await a37.writeFile(instanceId!, file, "Stale edit", original.modified);
  } catch (error) {
    if ((error as any).status === 412) staleRejected = true;
    else throw error;
  }
  if (!staleRejected)
    throw new Error(
      "Native modification-time guard did not reject a stale edit.",
    );
  console.log("Native file creation and stale-edit rejection succeeded.");
  const { ws } = await a37.desktop(instanceId!);
  const app = express();
  app.use("/novnc", express.static(path.resolve("node_modules/@novnc/novnc")));
  app.get("/", (_req, res) =>
    res
      .type("html")
      .send(
        `<html><body style="margin:0"><div id="screen" style="width:270px;height:570px"></div><script type="module">import RFB from '/novnc/core/rfb.js';const rfb=new RFB(document.querySelector('#screen'),${JSON.stringify(ws)});rfb.viewOnly=true;rfb.scaleViewport=true;rfb.resizeSession=false;rfb.addEventListener('connect',()=>window.connected=true);rfb.addEventListener('disconnect',()=>window.disconnected=true);window.rfb=rfb;</script></body></html>`,
      ),
  );
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 270, height: 570 },
    });
    await page.goto(`http://127.0.0.1:${(server.address() as any).port}`);
    await page.waitForFunction(
      () => (window as any).connected === true,
      {},
      { timeout: 60000 },
    );
    try {
      await page.waitForFunction(
        () => {
          const canvas = document.querySelector("canvas");
          if (!canvas?.width || !canvas?.height) return false;
          const ctx = canvas.getContext("2d");
          if (!ctx) return false;
          const pixel = ctx.getImageData(
            Math.floor(canvas.width / 2),
            Math.floor(canvas.height / 2),
            1,
            1,
          ).data;
          return pixel[3] > 200 && pixel[0] + pixel[1] + pixel[2] > 650;
        },
        {},
        { timeout: 30000 },
      );
    } catch (error) {
      console.log(
        "Framebuffer diagnostics:",
        await page.evaluate(() => {
          const canvas = document.querySelector("canvas");
          return {
            canvas: canvas?.outerHTML,
            connected: (window as any).connected,
            disconnected: (window as any).disconnected,
            screen: document.querySelector("#screen")?.innerHTML.slice(0, 1200),
          };
        }),
      );
      const diagnostics = await a37.exec(
        instanceId!,
        "tail -n 18 /tmp/chromium.log /tmp/x11vnc.log /tmp/novnc.log /tmp/visible-window.log; DISPLAY=:99 xwininfo -root -tree | head -n 35; ps -eo comm,args | rg 'chromium|Xvfb' | head -n 8",
      );
      console.log("Display diagnostics:", diagnostics.stdout);
      await page.screenshot({ path: ".cache/live-desktop-failed.png" });
      throw error;
    }
    await page.screenshot({ path: ".cache/live-desktop.png" });
    await page.evaluate(() => {
      (window as any).rfb.viewOnly = false;
      (window as any).rfb.viewOnly = true;
      (window as any).rfb.disconnect();
    });
    await page.waitForFunction(() => (window as any).disconnected === true);
    console.log(
      "Live noVNC connected, switched view/control mode, and disconnected.",
    );
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await writeFile(
    ".cache/live-agent-smoke.json",
    JSON.stringify({ user, instanceId, phase: "validated" }),
  );
} finally {
  instanceId ||= (await a37.listInstances()).find(
    (row) => row.user === user && row.status !== "deleted",
  )?.id;
  if (instanceId) {
    await a37.removeInstance(instanceId);
    console.log("Temporary validation instance removed.");
  }
  await writeFile(
    ".cache/live-agent-smoke.json",
    JSON.stringify({ user, instanceId, phase: "removed" }),
  );
}
