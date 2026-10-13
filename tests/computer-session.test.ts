import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ComputerSession,
  type DesktopConnection,
} from "../apps/web/src/lib/computer-session";

class Surface {
  parentElement: Surface | null = null;
  children = new Set<Surface>();
  appendChild(child: Surface) {
    child.remove();
    child.parentElement = this;
    this.children.add(child);
  }
  remove() {
    this.parentElement?.children.delete(this);
    this.parentElement = null;
  }
}
const element = (surface: Surface) => surface as unknown as HTMLDivElement;
let connections: FakeConnection[];
let sessions: ComputerSession[];
class FakeConnection extends EventTarget implements DesktopConnection {
  viewOnly = false;
  scaleViewport = false;
  resizeSession = true;
  constructor(
    public target: HTMLElement,
    public ws: string,
  ) {
    super();
    connections.push(this);
  }
  disconnect = vi.fn(() => this.dispatchEvent(new Event("disconnect")));
}
function fixture() {
  const surface = new Surface();
  const load = vi.fn(async () => ({
    ws: "wss://desktop.example/token-1",
    screen: { width: 1440, height: 900 },
    RFB: FakeConnection,
  }));
  const onError = vi.fn();
  const session = new ComputerSession({
    preview: false,
    createTarget: () => element(surface),
    load,
    onError,
  });
  sessions.push(session);
  return { session, surface, load, onError };
}
async function connected(session: ComputerSession) {
  session.start();
  await Promise.resolve();
  connections.at(-1)!.dispatchEvent(new Event("connect"));
  return connections.at(-1)!;
}

beforeEach(() => {
  vi.useFakeTimers();
  connections = [];
  sessions = [];
});
afterEach(() => {
  sessions.forEach((session) => session.dispose());
  vi.useRealTimers();
});

it("does not open a connection until requested", async () => {
  const { session, load } = fixture();
  session.attach(element(new Surface()));
  session.resume();
  session.setVisible(true);
  session.setAvailable(true);
  await vi.advanceTimersByTimeAsync(60000);
  expect(load).not.toHaveBeenCalled();
  expect(session.getSnapshot().requested).toBe(false);
});

it("moves the same desktop between viewers and keeps it connected with no viewer", async () => {
  const { session, surface, load } = fixture();
  const chat = new Surface(),
    computer = new Surface();
  const closeChat = session.attach(element(chat));
  const connection = await connected(session);
  connection.viewOnly = false;
  closeChat();
  expect(connection.viewOnly).toBe(true);
  expect(connection.disconnect).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60000);
  session.attach(element(computer));
  session.start();
  expect(computer.children.has(surface)).toBe(true);
  expect(chat.children.size).toBe(0);
  expect(session.connection).toBe(connection);
  expect(load).toHaveBeenCalledTimes(1);
  expect(session.getSnapshot()).toMatchObject({
    requested: true,
    state: "Connected",
    screen: { width: 1440, height: 900 },
  });
});

it("releases input while hidden without disconnecting or minting another token", async () => {
  const { session, load } = fixture();
  const connection = await connected(session);
  connection.viewOnly = false;
  session.setVisible(false);
  expect(connection.viewOnly).toBe(true);
  await vi.advanceTimersByTimeAsync(60000);
  session.setVisible(true);
  expect(session.connection).toBe(connection);
  expect(connection.disconnect).not.toHaveBeenCalled();
  expect(load).toHaveBeenCalledTimes(1);
  expect(session.getSnapshot().state).toBe("Connected");
});

it("finishes an in-flight connection when its tab becomes hidden", async () => {
  const { session, load } = fixture();
  const desktop = await load();
  load.mockClear();
  let resolve!: (value: typeof desktop) => void;
  load.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  session.start();
  session.setVisible(false);
  resolve(desktop);
  await Promise.resolve();
  expect(connections).toHaveLength(1);
  expect(session.connection).toBe(connections[0]);
  expect(connections[0].viewOnly).toBe(true);
  session.setVisible(true);
  expect(load).toHaveBeenCalledTimes(1);
});

it("recovers a background disconnect on return with a fresh token", async () => {
  const { session, load } = fixture();
  const old = await connected(session);
  session.setVisible(false);
  old.dispatchEvent(new Event("disconnect"));
  await vi.advanceTimersByTimeAsync(60000);
  expect(load).toHaveBeenCalledTimes(1);
  load.mockResolvedValueOnce({
    ws: "wss://desktop.example/token-2",
    RFB: FakeConnection,
    screen: { width: 1440, height: 900 },
  });
  session.setVisible(true);
  await Promise.resolve();
  expect(load).toHaveBeenCalledTimes(2);
  expect(session.connection).not.toBe(old);
  expect(connections[1].ws).toContain("token-2");
  expect(connections[1].viewOnly).toBe(true);
});

it("retries dropped connections with backoff capped at thirty seconds", async () => {
  const { session, load, onError } = fixture();
  const old = await connected(session);
  load.mockRejectedValue(new Error("Offline"));
  old.dispatchEvent(new Event("disconnect"));
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    const before = load.mock.calls.length;
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(load).toHaveBeenCalledTimes(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(before + 1);
  }
  expect(onError.mock.calls.length).toBeLessThanOrEqual(1);
  session.dispose();
  await vi.advanceTimersByTimeAsync(60000);
  expect(load).toHaveBeenCalledTimes(8);
});

it("pauses scheduled recovery in the background and resumes immediately on return", async () => {
  const { session, load } = fixture();
  const old = await connected(session);
  old.dispatchEvent(new Event("disconnect"));
  session.setVisible(false);
  await vi.advanceTimersByTimeAsync(60000);
  expect(load).toHaveBeenCalledTimes(1);
  session.setVisible(true);
  await Promise.resolve();
  expect(load).toHaveBeenCalledTimes(2);
});

it("disconnects for maintenance and disposal, and ignores stale connection events", async () => {
  const { session, load } = fixture();
  const old = await connected(session);
  session.setAvailable(false);
  expect(old.disconnect).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60000);
  expect(load).toHaveBeenCalledTimes(1);
  session.setAvailable(true);
  await Promise.resolve();
  const next = connections[1];
  next.dispatchEvent(new Event("connect"));
  old.dispatchEvent(new Event("disconnect"));
  old.dispatchEvent(new Event("connect"));
  expect(session.connection).toBe(next);
  expect(session.getSnapshot().state).toBe("Connected");
  session.dispose();
  expect(next.disconnect).toHaveBeenCalledTimes(1);
  session.setVisible(true);
  await vi.advanceTimersByTimeAsync(60000);
  expect(load).toHaveBeenCalledTimes(2);
});

it("ignores a token request that finishes after logout", async () => {
  const { session, load } = fixture();
  const desktop = await load();
  load.mockClear();
  let resolve!: (value: typeof desktop) => void;
  load.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  session.start();
  session.dispose();
  resolve(desktop);
  await Promise.resolve();
  expect(connections).toHaveLength(0);
  expect(session.connection).toBeNull();
});

it("explicit refresh replaces the connection and never restores input control", async () => {
  const { session, load } = fixture();
  const old = await connected(session);
  old.viewOnly = false;
  session.refresh();
  session.start();
  await Promise.resolve();
  expect(old.disconnect).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledTimes(2);
  expect(session.connection?.viewOnly).toBe(true);
});
