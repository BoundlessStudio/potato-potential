import { expect, test, type WebSocketRoute } from "@playwright/test";
import { buildSync } from "esbuild";

// Exercise the installed noVNC client against a small RFB server, including
// framebuffer updates while its canvas is detached from the current viewer.
const client = buildSync({
  stdin: {
    contents:
      'import { ComputerSession } from "./apps/web/src/lib/computer-session"; import RFB from "@novnc/novnc"; window.desktopHarness = { ComputerSession, RFB };',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  platform: "browser",
  format: "esm",
  write: false,
}).outputFiles[0].text;

function serverInit() {
  const name = Buffer.from("Test desktop");
  const message = Buffer.alloc(24 + name.length);
  message.writeUInt16BE(640, 0);
  message.writeUInt16BE(480, 2);
  message.set([32, 24, 0, 1], 4);
  for (const offset of [8, 10, 12]) message.writeUInt16BE(255, offset);
  message.set([0, 8, 16], 14);
  message.writeUInt32BE(name.length, 20);
  message.set(name, 24);
  return message;
}

function frame(shade: number) {
  const message = Buffer.alloc(16 + 4 * 4 * 4);
  message.writeUInt16BE(1, 2); // One raw rectangle, four pixels square.
  message.writeUInt16BE(4, 8);
  message.writeUInt16BE(4, 10);
  for (let offset = 16; offset < message.length; offset += 4)
    message.set([shade, shade, shade, 0], offset);
  return message;
}

test("keeps the real noVNC socket and canvas alive when hidden and moved between viewers", async ({
  page,
}) => {
  let socket!: WebSocketRoute;
  let opened = 0,
    closed = 0;
  await page.routeWebSocket("wss://desktop.example/**", (route) => {
    socket = route;
    opened++;
    let step = 0;
    route.onMessage(() => {
      if (step === 0) route.send(Buffer.from([1, 1]));
      if (step === 1) route.send(Buffer.alloc(4));
      if (step === 2) route.send(serverInit());
      step++;
    });
    route.onClose(() => {
      closed++;
    });
    route.send(Buffer.from("RFB 003.008\n"));
  });
  await page.goto("/chat");
  // Playwright's routed WebSocket inherits some members an extra level down.
  // noVNC validates only own members and the immediate prototype.
  await page.evaluate(() => {
    const RoutedWebSocket = window.WebSocket;
    window.WebSocket = class extends RoutedWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        for (const key of [
          "send",
          "close",
          "binaryType",
          "onerror",
          "onmessage",
          "onopen",
          "protocol",
          "readyState",
        ]) {
          let prototype = Object.getPrototypeOf(this);
          while (prototype) {
            const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
            if (descriptor) {
              Object.defineProperty(this, key, {
                ...descriptor,
                enumerable: true,
              });
              break;
            }
            prototype = Object.getPrototypeOf(prototype);
          }
        }
      }
    };
  });
  await page.addScriptTag({ content: client, type: "module" });
  await page.waitForFunction(() => !!(window as any).desktopHarness);
  await page.evaluate(() => {
    const runtime = window as any;
    const { ComputerSession, RFB } = runtime.desktopHarness;
    const viewer = document.createElement("div");
    viewer.className = "vnc-screen";
    viewer.style.width = "640px";
    viewer.style.aspectRatio = "640 / 480";
    document.body.appendChild(viewer);
    const session = new ComputerSession({
      preview: false,
      createTarget: () => {
        const target = document.createElement("div");
        target.style.width = "100%";
        target.style.height = "100%";
        return target;
      },
      load: async () => ({ ws: "wss://desktop.example/token", RFB }),
      onError: (error: string) => {
        throw new Error(error);
      },
    });
    runtime.liveDesktop = { session, viewer, detach: session.attach(viewer) };
    session.start();
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).liveDesktop.session.getSnapshot().state,
      ),
    )
    .toBe("Connected");
  const pixel = () =>
    page.evaluate(() => {
      const canvas = (window as any).liveDesktop.canvas as HTMLCanvasElement;
      return canvas.getContext("2d")!.getImageData(0, 0, 1, 1).data[0];
    });
  await page.evaluate(() => {
    const desktop = (window as any).liveDesktop;
    desktop.canvas = desktop.viewer.querySelector("canvas");
    desktop.connection = desktop.session.connection;
  });
  socket.send(frame(80));
  await expect.poll(pixel).toBe(80);
  await page.evaluate(() => {
    const { session, detach } = (window as any).liveDesktop;
    session.connection.viewOnly = false;
    session.setVisible(false);
    detach();
  });
  socket.send(frame(180));
  await expect.poll(pixel).toBe(180);
  await page.evaluate(() => {
    const desktop = (window as any).liveDesktop;
    desktop.viewer.style.width = "320px";
    desktop.detach = desktop.session.attach(desktop.viewer);
    desktop.session.setVisible(true);
  });
  const result = await page.evaluate(() => {
    const { viewer, canvas, session, connection } = (window as any).liveDesktop;
    return {
      sameCanvas: viewer.querySelector("canvas") === canvas,
      sameConnection: session.connection === connection,
      viewOnly: session.connection.viewOnly,
      state: session.getSnapshot().state,
    };
  });
  expect(result).toEqual({
    sameCanvas: true,
    sameConnection: true,
    viewOnly: true,
    state: "Connected",
  });
  await expect(page.locator(".vnc-screen canvas")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".vnc-screen canvas")
        .evaluate((canvas) => Math.round(canvas.getBoundingClientRect().width)),
    )
    .toBe(320);
  expect(opened).toBe(1);
  expect(closed).toBe(0);
  await page.evaluate(() => (window as any).liveDesktop.session.dispose());
  await expect.poll(() => closed).toBe(1);
});
