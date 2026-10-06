// Chromium can start with an unmapped initial window in the sandbox.
// Open an explicit headed window through the same local CDP Hermes uses.
let version;
for (let attempt = 0; attempt < 40; attempt++) {
  try {
    const response = await fetch("http://127.0.0.1:9222/json/version", {
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      version = await response.json();
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!version) throw new Error("Visible Chromium did not expose local CDP.");
const socket = new WebSocket(version.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();
const timeout = setTimeout(() => {
  socket.close();
  process.exit(1);
}, 20000);
socket.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);
  const waiter = pending.get(data.id);
  if (!waiter) return;
  pending.delete(data.id);
  data.error
    ? waiter.reject(new Error(data.error.message))
    : waiter.resolve(data.result);
});
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve);
  socket.addEventListener("error", reject);
});
function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
try {
  const previous = (await rpc("Target.getTargets")).targetInfos;
  const window = await rpc("Target.createTarget", {
    url: "about:blank",
    newWindow: true,
  });
  await rpc("Target.activateTarget", { targetId: window.targetId });
  const { windowId } = await rpc("Browser.getWindowForTarget", {
    targetId: window.targetId,
  });
  await rpc("Browser.setWindowBounds", {
    windowId,
    bounds: { windowState: "maximized" },
  });
  // Keep existing working tabs and the persisted profile. Drop only redundant blank tabs.
  for (const target of previous.filter(
    (row) => row.type === "page" && row.url === "about:blank",
  )) {
    await rpc("Target.closeTarget", { targetId: target.targetId });
  }
} finally {
  clearTimeout(timeout);
  socket.close();
}
