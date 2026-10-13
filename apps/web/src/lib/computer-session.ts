export type DesktopConnection = EventTarget & {
  viewOnly: boolean;
  scaleViewport: boolean;
  resizeSession: boolean;
  disconnect: () => void;
};

type Screen = { width: number; height: number };
type Snapshot = {
  requested: boolean;
  state: string;
  screen: Screen;
};
type Options = {
  preview: boolean;
  createTarget: () => HTMLDivElement;
  load: () => Promise<{
    ws: string;
    screen?: Screen;
    RFB: new (target: HTMLElement, ws: string) => DesktopConnection;
  }>;
  onError: (message: string) => void;
};

// The workspace owns the transport. Viewers only borrow its DOM surface, so
// changing pages or closing a preview does not tear down the desktop socket.
export class ComputerSession {
  connection: DesktopConnection | null = null;
  private target: HTMLDivElement | null = null;
  private listeners = new Set<() => void>();
  private snapshot: Snapshot = {
    requested: false,
    state: "Connecting",
    screen: { width: 540, height: 1140 },
  };
  private active = true;
  private available = true;
  private visible = true;
  private generation = 0;
  private connecting = false;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;

  constructor(private options: Options) {}

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private update(next: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...next };
    this.listeners.forEach((listener) => listener());
  }

  attach(target: HTMLDivElement) {
    this.target ??= this.options.createTarget();
    target.appendChild(this.target);
    if (this.connection) this.connection.scaleViewport = true;
    return () => {
      if (this.target?.parentElement === target) {
        this.setViewOnly();
        this.target.remove();
      }
    };
  }

  setViewOnly() {
    if (this.connection) this.connection.viewOnly = true;
  }

  start() {
    if (!this.snapshot.requested) this.update({ requested: true });
    void this.connect();
  }

  refresh() {
    this.stop();
    this.failures = 0;
    this.update({ requested: true, state: "Connecting" });
    void this.connect();
  }

  setAvailable(available: boolean) {
    this.available = available;
    if (!available) this.stop();
    else void this.connect();
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    if (!visible) {
      this.setViewOnly();
      clearTimeout(this.retry);
      this.retry = undefined;
    } else if (!this.connection) {
      clearTimeout(this.retry);
      this.retry = undefined;
      void this.connect();
    }
  }

  resume() {
    this.active = true;
    void this.connect();
  }

  dispose() {
    this.active = false;
    this.stop();
    this.target?.remove();
  }

  private stop() {
    ++this.generation;
    clearTimeout(this.retry);
    this.retry = undefined;
    this.connecting = false;
    const connection = this.connection;
    this.connection = null;
    connection?.disconnect();
    this.update({ state: "Disconnected" });
  }

  private reconnect() {
    if (!this.active || !this.available || !this.visible || this.retry) return;
    this.retry = setTimeout(
      () => {
        this.retry = undefined;
        void this.connect();
      },
      Math.min(1000 * 2 ** this.failures++, 30000),
    );
  }

  private async connect() {
    if (
      !this.active ||
      !this.available ||
      !this.visible ||
      !this.snapshot.requested ||
      this.connection ||
      this.connecting
    )
      return;
    if (this.options.preview) {
      this.update({ state: "Preview computer" });
      return;
    }
    this.connecting = true;
    const generation = this.generation;
    this.update({ state: "Connecting" });
    try {
      const { ws, screen, RFB } = await this.options.load();
      if (generation !== this.generation) return;
      this.target ??= this.options.createTarget();
      if (screen) this.update({ screen });
      const connection = new RFB(this.target, ws);
      this.connection = connection;
      connection.viewOnly = true;
      connection.scaleViewport = true;
      connection.resizeSession = false;
      connection.addEventListener("connect", () => {
        if (this.connection !== connection) return;
        this.failures = 0;
        this.update({ state: "Connected" });
      });
      connection.addEventListener("disconnect", () => {
        if (this.connection !== connection) return;
        this.connection = null;
        this.update({ state: "Reconnecting…" });
        this.reconnect();
      });
      connection.addEventListener("securityfailure", () => {
        if (this.connection !== connection) return;
        this.options.onError(
          "The desktop connection could not be authenticated. Reconnecting with a fresh token.",
        );
      });
    } catch (error) {
      if (generation !== this.generation) return;
      this.update({ state: "Connection interrupted — retrying…" });
      if (!this.failures)
        this.options.onError(
          error instanceof Error ? error.message : "Desktop connection failed.",
        );
      this.reconnect();
    } finally {
      if (generation === this.generation) this.connecting = false;
    }
  }
}
