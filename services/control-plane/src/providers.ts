import type {
  Connection,
  Cron,
  CronRun,
  Session,
  Toolkit,
} from "@boundless/shared";
import { HttpError } from "./security";

export class ProviderError extends HttpError {
  constructor(
    status: number,
    code: string,
    message: string,
    public detail?: Record<string, unknown>,
  ) {
    super(status, code, message);
  }
}
export async function checkedFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = 90_000,
): Promise<Response> {
  const controller = new AbortController();
  // Keep provider calls inside Vercel's invocation budget. A lost reply is reconciled on retry.
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: init.signal
        ? AbortSignal.any([init.signal, controller.signal])
        : controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, any>;
    const error = typeof body.error === "object" ? body.error : body;
    const code =
      error.code ||
      (typeof body.error === "string" ? body.error : "provider_error");
    throw new ProviderError(
      res.status,
      code,
      error.message ||
        (typeof body.detail === "string"
          ? body.detail
          : `Provider returned ${res.status}.`),
      typeof body.detail === "object" ? body.detail : undefined,
    );
  }
  return res;
}
export interface AgentProvider {
  listInstances(): Promise<any[]>;
  createInstance(body: Record<string, unknown>): Promise<any>;
  instance(id: string): Promise<any>;
  removeInstance(id: string): Promise<void>;
  restart(id: string): Promise<void>;
  update(id: string, template: string): Promise<void>;
  stop(id: string): Promise<void>;
  start(id: string): Promise<void>;
  healthy(id: string): Promise<boolean>;
  exec(
    id: string,
    command: string,
  ): Promise<{ stdout: string; stderr: string; exit_code: number }>;
  readFile(
    id: string,
    path: string,
  ): Promise<{ content: string; modified: number }>;
  writeFile(
    id: string,
    path: string,
    content: string,
    modified?: number,
  ): Promise<void>;
  responses(id: string, body: Record<string, unknown>): Promise<Response>;
  stream(id: string, responseId: string): Promise<Response>;
  cancel(id: string, responseId: string): Promise<void>;
  session(id: string, sessionId: string): Promise<Session>;
  sessions(id: string): Promise<any[]>;
  desktop(id: string): Promise<{ ws: string }>;
  crons(id: string): Promise<Cron[]>;
  createCron(id: string, body: Record<string, unknown>): Promise<Cron>;
  patchCron(
    id: string,
    cronId: string,
    body: Record<string, unknown>,
  ): Promise<Cron>;
  removeCron(id: string, cronId: string): Promise<void>;
  runCron(id: string, cronId: string): Promise<any>;
  cronRuns(id: string, cronId: string): Promise<CronRun[]>;
  toolkits(
    id: string,
    search: string,
    cursor?: string,
  ): Promise<{ toolkits: Toolkit[]; nextCursor: string | null }>;
  connections(id: string): Promise<{ connections: Connection[] }>;
  connect(id: string, toolkit: string, callbackUrl: string): Promise<any>;
  disconnect(id: string, connectionId: string): Promise<void>;
  usage(id: string): Promise<any>;
  budget(id: string, micros: number): Promise<any>;
}
export class Agent37 implements AgentProvider {
  constructor(private key: string) {}
  private host(path: string, init: RequestInit = {}, timeoutMs = 200_000) {
    return checkedFetch(
      `https://api.agent37.com/v1${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${this.key}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      },
      timeoutMs,
    );
  }
  private agent(id: string, path: string, init: RequestInit = {}) {
    if (!/^[a-z0-9]{10}$/.test(id))
      throw new HttpError(
        400,
        "invalid_instance",
        "Invalid instance identifier.",
      );
    // A cold-storage wake takes about two minutes; allow the documented 3-minute minimum.
    return checkedFetch(
      `https://${id}.agent37.app/v1${path}`,
      {
        ...init,
        headers: { "X-Agent37-Key": this.key, ...init.headers },
      },
      200_000,
    );
  }
  private async json(res: Promise<Response>) {
    const response = await res;
    return response.status === 204 ? {} : response.json();
  }
  async listInstances() {
    return (await this.json(this.host("/instances"))).data;
  }
  createInstance(body: Record<string, unknown>) {
    return this.json(
      this.host("/instances", { method: "POST", body: JSON.stringify(body) }),
    );
  }
  instance(id: string) {
    return this.json(this.host(`/instances/${id}`));
  }
  async removeInstance(id: string) {
    await this.host(`/instances/${id}`, { method: "DELETE" });
  }
  async restart(id: string) {
    await this.host(`/instances/${id}/restart`, { method: "POST" });
  }
  async update(id: string, template: string) {
    await this.host(`/instances/${id}/update`, {
      method: "POST",
      body: JSON.stringify({ template }),
    });
  }
  async stop(id: string) {
    await this.host(`/instances/${id}/stop`, { method: "POST" });
  }
  async start(id: string) {
    await this.host(`/instances/${id}/start`, { method: "POST" });
  }
  async healthy(id: string) {
    return (await this.json(this.agent(id, "/health"))).healthy === true;
  }
  exec(id: string, command: string) {
    return this.json(
      this.host(`/instances/${id}/exec`, {
        method: "POST",
        body: JSON.stringify({ command }),
      }),
    );
  }
  async readFile(id: string, path: string) {
    const parent = path.slice(0, path.lastIndexOf("/"));
    const name = path.slice(path.lastIndexOf("/") + 1);
    let listing;
    try {
      listing = await this.json(
        this.agent(id, `/files?path=${encodeURIComponent(parent)}`),
      );
    } catch (error) {
      if (error instanceof HttpError && error.status === 404)
        return { content: "", modified: 0 };
      throw error;
    }
    const entry = (listing.entries || []).find(
      (item: any) => item.name === name,
    );
    if (!entry) return { content: "", modified: 0 };
    const response = await this.agent(
      id,
      `/files/content?path=${encodeURIComponent(path)}`,
    );
    return { content: await response.text(), modified: entry.modified };
  }
  async writeFile(
    id: string,
    path: string,
    content: string,
    modified?: number,
  ) {
    await this.agent(id, `/files/content?path=${encodeURIComponent(path)}`, {
      method: "PUT",
      body: content,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        ...(modified !== undefined
          ? { "X-Expected-Mtime": String(modified) }
          : {}),
      },
    });
  }
  responses(id: string, body: Record<string, unknown>) {
    return this.agent(id, "/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  stream(id: string, responseId: string) {
    return this.agent(
      id,
      `/responses/${encodeURIComponent(responseId)}/stream`,
      { signal: undefined },
    );
  }
  async cancel(id: string, responseId: string) {
    await this.agent(
      id,
      `/responses/${encodeURIComponent(responseId)}/cancel`,
      { method: "POST" },
    );
  }
  session(id: string, sessionId: string) {
    return this.json(
      this.agent(id, `/sessions/${encodeURIComponent(sessionId)}`),
    );
  }
  async sessions(id: string) {
    return (await this.json(this.agent(id, "/sessions"))).data;
  }
  async desktop(id: string) {
    const signed = await this.json(
      this.host(`/instances/${id}/signed-url`, {
        method: "POST",
        body: JSON.stringify({ port: 6901, ttl_seconds: 60 }),
      }),
    );
    const url = new URL(signed.url);
    if (
      !url.hostname.endsWith(".agent37.app") &&
      !url.hostname.endsWith(".agent37.com")
    )
      throw new HttpError(
        502,
        "invalid_desktop_url",
        "Unexpected desktop address.",
      );
    return {
      ws: `wss://${url.host}/websockify?a37_token=${encodeURIComponent(url.searchParams.get("a37_token") || "")}`,
    };
  }
  async crons(id: string) {
    return (await this.json(this.host(`/instances/${id}/crons`))).data;
  }
  createCron(id: string, body: Record<string, unknown>) {
    return this.json(
      this.host(`/instances/${id}/crons`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
  }
  patchCron(id: string, cronId: string, body: Record<string, unknown>) {
    return this.json(
      this.host(`/instances/${id}/crons/${cronId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    );
  }
  async removeCron(id: string, cronId: string) {
    await this.host(`/instances/${id}/crons/${cronId}`, { method: "DELETE" });
  }
  runCron(id: string, cronId: string) {
    return this.json(
      this.host(`/instances/${id}/crons/${cronId}/run`, { method: "POST" }),
    );
  }
  async cronRuns(id: string, cronId: string) {
    return (await this.json(this.host(`/instances/${id}/crons/${cronId}/runs`)))
      .data;
  }
  async toolkits(id: string, search: string, cursor?: string) {
    const query = new URLSearchParams({ limit: "24" });
    if (search.trim()) query.set("search", search.trim());
    if (cursor) query.set("cursor", cursor);
    const page = await this.json(
      this.host(`/instances/${id}/integrations/toolkits?${query}`),
    );
    if (
      !Array.isArray(page.items) ||
      (page.nextCursor !== null && typeof page.nextCursor !== "string")
    )
      throw new ProviderError(
        502,
        "invalid_catalog",
        "The app catalog could not be loaded. Please try again.",
      );
    return {
      toolkits: page.items as Toolkit[],
      nextCursor: page.nextCursor as string | null,
    };
  }
  connections(id: string) {
    return this.json(this.host(`/instances/${id}/integrations/connections`));
  }
  connect(id: string, toolkit: string, callbackUrl: string) {
    return this.json(
      this.host(`/instances/${id}/integrations/connect`, {
        method: "POST",
        body: JSON.stringify({ toolkit, callbackUrl }),
      }),
    );
  }
  async disconnect(id: string, connectionId: string) {
    await this.host(
      `/instances/${id}/integrations/connections/${encodeURIComponent(connectionId)}`,
      { method: "DELETE" },
    );
  }
  usage(id: string) {
    return this.json(this.host(`/instances/${id}/usage`));
  }
  budget(id: string, micros: number) {
    return this.json(
      this.host(`/instances/${id}/budget`, {
        method: "PATCH",
        body: JSON.stringify({ monthly_cap_micros: micros }),
      }),
    );
  }
}

export interface InkboxProvider {
  request(path: string, init?: RequestInit): Promise<any>;
  findConfirmation(
    identityId: string,
    phone: string,
    code: string,
    smsNumberId?: string,
  ): Promise<boolean>;
}
export class Inkbox implements InkboxProvider {
  constructor(private key: string) {}
  async request(path: string, init: RequestInit = {}) {
    const res = await checkedFetch(`https://inkbox.ai/api/v1${path}`, {
      ...init,
      headers: {
        "X-API-Key": this.key,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    return res.status === 204 ? {} : res.json();
  }
  async findConfirmation(
    identityId: string,
    phone: string,
    code: string,
    smsNumberId?: string,
  ) {
    const result = await this.request(
      `/imessage/messages?${new URLSearchParams({ agent_identity_id: identityId, limit: "100" })}`,
    );
    const messages = Array.isArray(result)
      ? result
      : result.messages || result.data || [];
    const verified = messages.some(
      (message: any) =>
        message.direction === "inbound" &&
        !message.is_group &&
        !message.is_blocked &&
        message.remote_number === phone &&
        String(message.content || "").trim() === code,
    );
    if (verified || !smsNumberId) return verified;
    const texts = await this.request(
      `/phone/numbers/${encodeURIComponent(smsNumberId)}/texts?limit=100`,
    );
    const own = (Array.isArray(texts) ? texts : []).filter(
      (message) =>
        message.direction === "inbound" &&
        !message.is_blocked &&
        !message.recipients &&
        message.remote_phone_number === phone,
    );
    return (
      own.some(
        (message) => String(message.text).trim().toUpperCase() === "START",
      ) && own.some((message) => String(message.text).trim() === code)
    );
  }
}
