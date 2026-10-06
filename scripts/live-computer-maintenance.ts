import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import express from "express";
import { chromium } from "@playwright/test";
import { Agent37 } from "../services/control-plane/src/providers";
import { MemoryRepository } from "../services/control-plane/src/repository";
import {
  bootCommand,
  maintainComputer,
} from "../services/control-plane/src/computer-maintenance";
import type { Dependencies } from "../services/control-plane/src/app";

// Explicit live validation on a disposable zero-managed-budget computer.
// Never loads a customer account or sends model calls or external messages.
if (!process.env.AGENT37_API_KEY)
  throw new Error("AGENT37_API_KEY is required.");
const provider = new Agent37(process.env.AGENT37_API_KEY);
const user = `boundless-maintenance-${randomUUID()}`;
const repo = new MemoryRepository();
const owner = randomUUID();
const record = ".cache/live-computer-maintenance.json";
await mkdir(".cache", { recursive: true });
let instanceId: string | undefined;
const persist = (phase: string) =>
  writeFile(record, JSON.stringify({ user, instanceId, phase }));
await persist("creating");
const delay = () => new Promise((resolve) => setTimeout(resolve, 5000));
try {
  const instance = await provider.createInstance({
    template: "boundless-hermes-desktop@2",
    name: "Boundless temporary maintenance validation",
    user,
    budget: { monthly_cap_micros: 0 },
    auto_sleep: true,
    idle_timeout_seconds: 600,
  });
  instanceId = instance.id;
  await persist("checking");
  console.log("Temporary maintenance-validation computer created.");
  let healthy = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      healthy = await provider.healthy(instanceId!);
    } catch {}
    if (healthy) break;
    await delay();
  }
  if (!healthy) throw new Error("Temporary gateway did not become healthy.");
  const memoryPath = "~/.boundless-maintenance-check/memory.md";
  await provider.writeFile(
    instanceId!,
    memoryPath,
    "Memory retained across updates and restarts.",
    0,
  );
  await repo.saveAgent({
    ownerId: owner,
    instanceId,
    phase: "ready",
    status: "ready",
    completed: ["ready"],
    budgetMicros: 0,
    updatedAt: new Date().toISOString(),
  });
  let updates = 0,
    restarts = 0;
  const a37 = Object.create(provider) as Agent37;
  a37.update = async (id, template) => {
    updates++;
    await provider.update(id, template);
    // Deliberately drop the reply. The production worker must reconcile, not reapply.
    throw new Error("Simulated dropped provider reply");
  };
  a37.restart = async (id) => {
    restarts++;
    await provider.restart(id);
  };
  const dep = { repo, a37 } as Dependencies;
  for (const action of ["update", "restart"] as const) {
    await persist(action);
    const before = (
      await provider.exec(instanceId!, bootCommand)
    ).stdout.trim();
    const agent = (await repo.agent(owner))!;
    agent.computerOperation = {
      id: randomUUID(),
      action,
      targetTemplate: "boundless-hermes-desktop@4",
      phase: "queued",
      requestedAt: new Date().toISOString(),
    };
    await repo.saveAgent(agent);
    for (let attempt = 0; attempt < 60; attempt++) {
      if (!(await maintainComputer(dep, owner))) break;
      await delay();
    }
    const finished = (await repo.agent(owner))!;
    if (finished.computerOperation?.phase !== "completed")
      throw new Error(
        finished.computerOperation?.error || "Maintenance did not complete.",
      );
    if (
      finished.computerScreen?.width !== 540 ||
      finished.computerScreen.height !== 1140
    )
      throw new Error("Actual desktop is not portrait.");
    if (
      (await provider.exec(instanceId!, bootCommand)).stdout.trim() === before
    )
      throw new Error("Computer boot fingerprint did not change.");
    if (
      (await provider.readFile(instanceId!, memoryPath)).content !==
      "Memory retained across updates and restarts."
    )
      throw new Error("Saved home file was not retained.");
    console.log(
      `${action} completed: 540 × 1140 desktop, changed boot, retained home file.`,
    );
  }
  if (updates !== 1 || restarts !== 1)
    throw new Error("Provider operation was duplicated.");
  // Read Chromium's actual headed window and content viewport through local CDP.
  const cdpProbe = `
    const version=await (await fetch('http://127.0.0.1:9222/json/version')).json();
    const ws=new WebSocket(version.webSocketDebuggerUrl);let id=0;const pending=new Map();
    const timeout=setTimeout(()=>process.exit(1),15000);
    ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}});
    await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve);ws.addEventListener('error',reject)});
    const rpc=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});ws.send(JSON.stringify({id:next,method,params,sessionId}))});
    const pages=(await rpc('Target.getTargets')).targetInfos.filter(t=>t.type==='page');
    const windows=await Promise.all(pages.map(async t=>({...await rpc('Browser.getWindowForTarget',{targetId:t.targetId}),targetId:t.targetId})));
    const selected=windows.find(w=>w.bounds.windowState==='maximized')||windows[0];
    const {targetId,bounds}=selected;
    const {sessionId}=await rpc('Target.attachToTarget',{targetId,flatten:true});
    const {result}=await rpc('Runtime.evaluate',{expression:'JSON.stringify({width:innerWidth,height:innerHeight})',returnByValue:true},sessionId);
    console.log(JSON.stringify({bounds,viewport:JSON.parse(result.value),windows:windows.map(w=>w.bounds)}));clearTimeout(timeout);ws.close();
  `;
  let browserState: any;
  for (let attempt = 0; attempt < 12; attempt++) {
    const browserCheck = await provider.exec(
      instanceId!,
      `node --input-type=module -e '${cdpProbe.replaceAll("'", "'\\''")}'`,
    );
    if (browserCheck.exit_code === 0) {
      browserState = JSON.parse(browserCheck.stdout.trim());
      if (
        browserState.bounds.windowState === "maximized" &&
        browserState.viewport.width <= 540 &&
        browserState.viewport.height >= 800
      )
        break;
    }
    await delay();
  }
  console.log("Headed window inspection:", JSON.stringify(browserState));
  if (
    !browserState ||
    browserState.bounds.windowState !== "maximized" ||
    browserState.viewport.width > 540 ||
    browserState.viewport.height < 800
  )
    throw new Error("Chromium is not maximized in the portrait desktop.");
  console.log(
    "Headed Chromium maximized:",
    JSON.stringify(browserState.viewport),
  );
  const { ws } = await provider.desktop(instanceId!);
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
    await page.waitForFunction(
      () => {
        const canvas = document.querySelector("canvas");
        return canvas?.width === 540 && canvas?.height === 1140;
      },
      {},
      { timeout: 30000 },
    );
    await page.waitForFunction(
      () => {
        const canvas = document.querySelector("canvas");
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return false;
        const pixel = context.getImageData(
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
    await page.screenshot({ path: ".cache/live-portrait-desktop.png" });
    await page.evaluate(() => {
      (window as any).rfb.viewOnly = false;
      (window as any).rfb.viewOnly = true;
      (window as any).rfb.disconnect();
    });
    await page.waitForFunction(() => (window as any).disconnected === true);
    console.log(
      "Portrait noVNC framebuffer connected, switched control mode, and disconnected.",
    );
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await persist("validated");
} finally {
  instanceId ||= (await provider.listInstances()).find(
    (row) => row.user === user && row.status !== "deleted",
  )?.id;
  if (instanceId) await provider.removeInstance(instanceId);
  await persist("removed");
  console.log("Temporary maintenance-validation computer removed.");
}
