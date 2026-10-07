import type {
  Connection,
  ComputerMetrics,
  Cron,
  CronRun,
  Session,
  Toolkit,
  FileEntry,
  DirectoryListing,
} from "@boundless/shared";
import { HttpError, shellQuote } from "./security";
import { z } from "zod";
import {
  filePath,
  fileStatScript,
  directoryStatScript,
  uploadDirectory,
} from "./file-transfer";
import { posix } from "node:path";

export type SignedPortUrl = { url: string; port: number; expires_at: number };
export type PublicPortUrl = {
  url: string;
  port: number;
  label?: string | null;
  created?: number;
};
const metricPoints = z
  .array(
    z.tuple([
      z.number().finite().nonnegative(),
      z.number().finite().nonnegative(),
    ]),
  )
  .max(10000);
const metricsSchema = z.object({
  series: z.object({
    cpu_cores: metricPoints,
    memory_bytes: metricPoints,
    disk_bytes: metricPoints,
  }),
  limits: z.object({
    cpu_cores: z.number().finite().nonnegative(),
    memory_bytes: z.number().finite().nonnegative(),
    disk_bytes: z.number().finite().nonnegative(),
  }),
  hours: z.number().int().positive(),
  step_seconds: z.number().int().positive(),
  fetched_at: z.number().int().nonnegative(),
});
export function validatePortUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !/^[a-z0-9-]+\.agent37\.(app|com)$/.test(url.hostname)
  )
    throw new HttpError(
      502,
      "invalid_service_url",
      "Unexpected service address.",
    );
  return url;
}

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
  statFile(id: string, path: string): Promise<FileEntry>;
  listDirectories(id: string, path: string): Promise<DirectoryListing>;
  writeBinary(id: string, path: string, bytes: Uint8Array): Promise<FileEntry>;
  downloadFile(id: string, path: string): Promise<Response>;
  stream(id: string, responseId: string): Promise<Response>;
  cancel(id: string, responseId: string): Promise<void>;
  session(id: string, sessionId: string): Promise<Session>;
  sessions(id: string): Promise<any[]>;
  desktop(id: string): Promise<{ ws: string }>;
  signedUrl(
    id: string,
    port: number,
    ttlSeconds: number,
  ): Promise<SignedPortUrl>;
  publicPorts(id: string): Promise<PublicPortUrl[]>;
  createPublicPort(
    id: string,
    port: number,
    label: string,
  ): Promise<PublicPortUrl>;
  removePublicPort(id: string, port: number): Promise<void>;
  metrics(id: string): Promise<ComputerMetrics>;
  checkService(id: string, port: number): Promise<boolean>;
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
    const result = await this.json(
      this.host(`/instances/${id}`, { method: "DELETE" }),
    );
    if (result.id !== id || result.deleted !== true)
      throw new HttpError(
        502,
        "instance_deletion_unconfirmed",
        "The computer provider has not confirmed deletion. Retry shortly.",
      );
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
  async listDirectories(id: string, path: string): Promise<DirectoryListing> {
    path = uploadDirectory(path);
    const result = await this.exec(
      id,
      `node -e ${shellQuote(directoryStatScript)} ${shellQuote(Buffer.from(path).toString("base64url"))}`,
    );
    const checked = JSON.parse(result.stdout);
    if (result.exit_code)
      throw new HttpError(
        checked.code === "directory_not_found" ? 404 : 400,
        checked.code,
        checked.error,
      );
    if (checked.path !== path)
      throw new HttpError(
        502,
        "invalid_directory_listing",
        "The computer returned an unexpected folder.",
      );
    const listing = z
      .object({
        path: z.literal(path),
        entries: z
          .array(
            z.object({
              name: z.string(),
              path: z.string(),
              hidden: z.boolean(),
              type: z.enum(["file", "directory", "symlink", "other"]),
            }),
          )
          .max(1000),
        truncated: z.boolean(),
      })
      .parse(
        await this.json(
          this.agent(id, `/files?${new URLSearchParams({ path })}`),
        ),
      );
    const parent = posix.dirname(path);
    return {
      path,
      parentPath: ["/home/node", "/home/linuxbrew"].includes(path)
        ? null
        : parent,
      directories: listing.entries
        .filter(
          (entry) =>
            entry.type === "directory" &&
            !/[\x00-\x1f/\\]/.test(entry.name) &&
            !["", ".", ".."].includes(entry.name) &&
            entry.path === `${path}/${entry.name}`,
        )
        .map(({ name, path, hidden }) => ({ name, path, hidden })),
      truncated: listing.truncated,
    };
  }
  async statFile(id: string, path: string): Promise<FileEntry> {
    const result = await this.exec(
      id,
      `node -e ${shellQuote(fileStatScript)} ${shellQuote(Buffer.from(filePath(path)).toString("base64url"))}`,
    );
    if (result.exit_code)
      throw new HttpError(
        404,
        "file_not_found",
        "File not found or not a regular file.",
      );
    return JSON.parse(result.stdout);
  }
  async writeBinary(
    id: string,
    path: string,
    bytes: Uint8Array,
  ): Promise<FileEntry> {
    return this.json(
      this.agent(
        id,
        `/files/content?path=${encodeURIComponent(filePath(path))}`,
        {
          method: "PUT",
          body: new Uint8Array(bytes),
          headers: { "Content-Type": "application/octet-stream" },
        },
      ),
    );
  }
  downloadFile(id: string, path: string) {
    return this.agent(
      id,
      `/files/content?${new URLSearchParams({ path: filePath(path), disposition: "attachment" })}`,
    );
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
    const signed = await this.signedUrl(id, 6901, 60);
    const url = new URL(signed.url);
    return {
      ws: `wss://${url.host}/websockify?a37_token=${encodeURIComponent(url.searchParams.get("a37_token") || "")}`,
    };
  }
  async signedUrl(
    id: string,
    port: number,
    ttlSeconds: number,
  ): Promise<SignedPortUrl> {
    const data = await this.json(
      this.host(`/instances/${id}/signed-url`, {
        method: "POST",
        body: JSON.stringify({ port, ttl_seconds: ttlSeconds }),
      }),
    );
    const url = validatePortUrl(data.url);
    if (
      url.hostname !== `${id}-${port}.agent37.app` &&
      url.hostname !== `${id}-${port}.agent37.com`
    )
      throw new HttpError(
        502,
        "invalid_service_url",
        "Unexpected service address.",
      );
    if (
      !url.searchParams.get("a37_token") ||
      data.port !== port ||
      !Number.isSafeInteger(data.expires_at) ||
      data.expires_at <= Date.now() / 1000 ||
      data.expires_at > Date.now() / 1000 + ttlSeconds + 60
    )
      throw new HttpError(
        502,
        "invalid_service_url",
        "Invalid service access response.",
      );
    return { url: url.toString(), port, expires_at: data.expires_at };
  }
  async publicPorts(id: string): Promise<PublicPortUrl[]> {
    const data = await this.json(this.host(`/instances/${id}/public-ports`));
    return z
      .array(
        z.object({
          port: z.number().int().min(1).max(65535),
          url: z.string(),
          label: z.string().nullable().optional(),
          created: z.number().optional(),
        }),
      )
      .max(50)
      .parse(data.data)
      .map((row) => ({ ...row, url: validatePortUrl(row.url).toString() }));
  }
  async createPublicPort(
    id: string,
    port: number,
    label: string,
  ): Promise<PublicPortUrl> {
    const data = await this.json(
      this.host(`/instances/${id}/public-ports`, {
        method: "POST",
        body: JSON.stringify({ port, label }),
      }),
    );
    if (data.port !== port)
      throw new HttpError(
        502,
        "invalid_service_url",
        "Unexpected service port.",
      );
    return { port, url: validatePortUrl(data.url).toString(), label };
  }
  async removePublicPort(id: string, port: number) {
    const data = await this.json(
      this.host(`/instances/${id}/public-ports/${port}`, { method: "DELETE" }),
    );
    if (data.port !== port || data.deleted !== true)
      throw new HttpError(
        502,
        "public_removal_unconfirmed",
        "Couldn’t confirm the public link was disabled.",
      );
  }
  async metrics(id: string): Promise<ComputerMetrics> {
    return metricsSchema.parse(
      await this.json(this.host(`/instances/${id}/metrics?hours=24`)),
    );
  }
  async checkService(id: string, port: number) {
    // Fixed local HTTP targets, no redirects, bodies, command input, or infrastructure secrets.
    const script = `const http=require('node:http');const port=Number(process.argv[1]);const probe=host=>new Promise(resolve=>{const req=http.request({host,port,method:'HEAD',path:'/',timeout:2500},res=>{res.destroy();resolve(true)});req.on('timeout',()=>req.destroy());req.on('error',()=>resolve(false));req.end()});(async()=>console.log(JSON.stringify({running:await probe('127.0.0.1')||await probe('::1')})))()`;
    const result = await this.exec(
      id,
      `node -e ${shellQuote(script)} ${shellQuote(String(z.number().int().min(1).max(65535).parse(port)))}`,
    );
    if (result.exit_code)
      throw new HttpError(
        502,
        "service_check_failed",
        "Couldn’t check the service.",
      );
    return z.object({ running: z.boolean() }).parse(JSON.parse(result.stdout))
      .running;
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
  removeIdentity(handle: string): Promise<void>;
  findConfirmation(
    identityId: string,
    phone: string,
    code: string,
    smsNumberId?: string,
  ): Promise<boolean>;
}
export class Inkbox implements InkboxProvider {
  constructor(private key: string) {}
  private fetch(path: string, init: RequestInit = {}) {
    return checkedFetch(`https://inkbox.ai/api/v1${path}`, {
      ...init,
      headers: {
        "X-API-Key": this.key,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  }
  async request(path: string, init: RequestInit = {}) {
    const res = await this.fetch(path, init);
    return res.status === 204 ? {} : res.json();
  }
  async removeIdentity(handle: string) {
    const res = await this.fetch(`/identities/${encodeURIComponent(handle)}`, {
      method: "DELETE",
    });
    if (res.status !== 204)
      throw new HttpError(
        502,
        "identity_deletion_unconfirmed",
        "The identity provider has not confirmed deletion. Retry shortly.",
      );
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
