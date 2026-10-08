import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AgentProvider, InkboxProvider } from "./providers";
import type {
  Connection,
  ComputerMetrics,
  Cron,
  CronRun,
  Session,
  Toolkit,
  FileEntry,
  DirectoryListing,
  FileUpload,
  InstanceBudget,
  InstanceUsage,
} from "@boundless/shared";
import { ProviderError } from "./providers";
import { MemoryRepository } from "./repository";
import { screenForTemplate } from "./computer-maintenance";
import { visibleMessage } from "@boundless/shared";
import { uploadDirectory } from "./file-transfer";
import { posix } from "node:path";

export const DEMO_USER = "11111111-1111-4111-8111-111111111111";
export const DEMO_NEW_USER = "22222222-2222-4222-8222-222222222222";
export const DEMO_EMAIL = "alex@example.com";
const hex = () => randomBytes(16).toString("hex");
export class DemoAgent37 implements AgentProvider {
  async stop(id: string) {
    this.instances.get(id)!.status = "stopped";
  }
  async start(id: string) {
    this.instances.get(id)!.status = "running";
  }
  instances = new Map<string, any>();
  histories = new Map<string, Session>();
  buffers = new Map<string, string>();
  responseSessions = new Map<string, string>();
  files = new Map<string, { content: string; modified: number }>();
  binaryFiles = new Map<string, Uint8Array>();
  async listDirectories(id: string, path: string): Promise<DirectoryListing> {
    path = uploadDirectory(path);
    const directories = new Set([
      "/home/node",
      "/home/node/uploads",
      "/home/node/outputs",
      "/home/node/work",
      "/home/node/work/客户",
      "/home/node/.hermes",
      "/home/linuxbrew",
    ]);
    for (const key of this.binaryFiles.keys()) {
      if (!key.startsWith(`${id}:`)) continue;
      let parent = posix.dirname(key.slice(id.length + 1));
      while (parent !== "/home" && parent !== "/") {
        directories.add(parent);
        parent = posix.dirname(parent);
      }
    }
    if (!directories.has(path))
      throw new ProviderError(
        404,
        "directory_not_found",
        "This folder no longer exists. Choose another folder.",
      );
    return {
      path,
      parentPath: ["/home/node", "/home/linuxbrew"].includes(path)
        ? null
        : posix.dirname(path),
      directories: [...directories]
        .filter((p) => posix.dirname(p) === path)
        .map((p) => ({
          path: p,
          name: posix.basename(p),
          hidden: posix.basename(p).startsWith("."),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      truncated: false,
    };
  }
  responseRequests: { instanceId: string; body: Record<string, unknown> }[] =
    [];
  async statFile(id: string, path: string): Promise<FileEntry> {
    path = path.replace(/^~(?=\/|$)/, "/home/node");
    const bytes = this.binaryFiles.get(`${id}:${path}`);
    if (!bytes)
      throw new ProviderError(
        404,
        "file_not_found",
        "File not found or not a regular file.",
      );
    return {
      name: path.split("/").pop()!,
      path,
      size: bytes.length,
      type: "file",
      modified: Date.now(),
      hidden: false,
    };
  }
  async writeBinary(id: string, path: string, bytes: Uint8Array) {
    this.binaryFiles.set(`${id}:${path}`, new Uint8Array(bytes));
    return this.statFile(id, path);
  }
  async downloadFile(id: string, path: string) {
    const file = await this.statFile(id, path);
    return new Response(
      new Uint8Array(this.binaryFiles.get(`${id}:${file.path}`)!),
    );
  }
  schedules = new Map<string, Cron[]>();
  connectionsMap = new Map<string, Connection[]>();
  budgets = new Map<string, InstanceBudget>();
  constructor() {
    this.files.set("~/.hermes/SOUL.md", {
      content: "# Hermes\nBe helpful and use your native tools.\n",
      modified: Date.now() + 0.125,
    });
    this.files.set("~/.hermes/memories/USER.md", {
      content:
        "Alex likes a clear plan, quiet mornings, and a little curiosity.\n",
      modified: Date.now() + 0.25,
    });
    this.files.set("~/.hermes/memories/MEMORY.md", {
      content: "Keep ongoing work visible and share useful updates.\n",
      modified: Date.now() + 0.5,
    });
  }
  async listInstances() {
    return [...this.instances.values()];
  }
  async createInstance(body: Record<string, unknown>) {
    const id = `demo${randomBytes(3).toString("hex")}`;
    const row = {
      ...body,
      id,
      status: "running",
      public_ports: [{ port: 8765, url: `https://${id}-8765.example.test` }],
    };
    this.instances.set(id, row);
    const cap =
      (body.budget as { monthly_cap_micros?: number } | undefined)
        ?.monthly_cap_micros || 0;
    const consumed = Math.min(cap, 1_280_000);
    this.budgets.set(id, {
      monthlyCapMicros: cap,
      monthlyConsumedMicros: consumed,
      monthlyRemainingMicros: cap - consumed,
      monthlyPeriod: new Date().toISOString().slice(0, 7),
      creditRemainingMicros: 0,
    });
    return row;
  }
  async instance(id: string) {
    const value = this.instances.get(id);
    if (!value)
      throw new ProviderError(404, "not_found", "Computer not found.");
    return value;
  }
  async removeInstance(id: string) {
    this.instances.delete(id);
  }
  async restart(id: string) {
    const instance = await this.instance(id);
    instance.boot = (instance.boot || 1) + 1;
    instance.status = "running";
  }
  async update(id: string, template: string) {
    const instance = await this.instance(id);
    instance.template = template;
    await this.restart(id);
  }
  async healthy() {
    return true;
  }
  serviceStates = new Map<string, boolean>();
  async checkService(id: string, port: number) {
    await this.instance(id);
    return this.serviceStates.get(`${id}:${port}`) ?? true;
  }
  async signedUrl(id: string, port: number, ttlSeconds: number) {
    await this.instance(id);
    return {
      port,
      url: `https://${id}-${port}.agent37.app/?a37_token=${hex()}`,
      expires_at: Math.floor(Date.now() / 1000) + ttlSeconds,
    };
  }
  async publicPorts(id: string) {
    return structuredClone((await this.instance(id)).public_ports);
  }
  async createPublicPort(id: string, port: number, label: string) {
    const instance = await this.instance(id);
    if (instance.public_ports.some((row: any) => row.port === port))
      throw new ProviderError(
        409,
        "public_port_exists",
        "Port already public.",
      );
    if (instance.public_ports.length >= 50)
      throw new ProviderError(
        400,
        "public_port_limit",
        "Public port limit reached.",
      );
    const row = {
      port,
      label,
      url: `https://${randomBytes(10).toString("hex")}.agent37.app`,
      created: Math.floor(Date.now() / 1000),
    };
    instance.public_ports.push(row);
    return structuredClone(row);
  }
  async removePublicPort(id: string, port: number) {
    const instance = await this.instance(id);
    if (!instance.public_ports.some((row: any) => row.port === port))
      throw new ProviderError(404, "not_found", "Port not public.");
    instance.public_ports = instance.public_ports.filter(
      (row: any) => row.port !== port,
    );
  }
  async metrics(id: string): Promise<ComputerMetrics> {
    const instance = await this.instance(id);
    const now = Math.floor(Date.now() / 1000);
    const points = (value: number): [number, number][] =>
      Array.from({ length: 24 }, (_, i) => [
        now - (23 - i) * 3600,
        value * (0.6 + 0.3 * Math.sin(i)),
      ]);
    return {
      series: {
        cpu_cores: instance.status === "running" ? points(0.5) : [],
        memory_bytes: instance.status === "running" ? points(1e9) : [],
        disk_bytes: points(2e9),
      },
      limits: { cpu_cores: 2, memory_bytes: 4e9, disk_bytes: 20e9 },
      hours: 24,
      step_seconds: 3600,
      fetched_at: now,
    };
  }
  async exec(id?: string, command?: string) {
    if (command?.includes("file-upload.mjs")) {
      const args = command
        .match(/'([^']*)'/g)!
        .map((value) => value.slice(1, -1));
      const u = JSON.parse(
        Buffer.from(args[2], "base64url").toString(),
      ) as FileUpload & { index?: number };
      const operation = args[1],
        stage = `/home/node/.boundless/file-uploads/${u.id}/`;
      if (operation === "cleanup")
        for (const key of this.binaryFiles.keys()) {
          if (key.startsWith(`${id}:${stage}`)) this.binaryFiles.delete(key);
        }
      if (operation === "complete") {
        if (!this.binaryFiles.has(`${id}:${stage}receipt`)) {
          if (this.binaryFiles.has(`${id}:${u.target}`))
            return {
              stdout: JSON.stringify({
                code: "file_exists",
                error: "File exists.",
              }),
              stderr: "",
              exit_code: 1,
            };
          const bytes = Buffer.concat(
            Array.from({ length: Math.ceil(u.size / 2097152) }, (_, index) =>
              Buffer.from(
                this.binaryFiles.get(`${id}:${stage}${index}.part`) || [],
              ),
            ),
          );
          if (
            bytes.length !== u.size ||
            createHash("sha256").update(bytes).digest("hex") !== u.sha256
          )
            return {
              stdout: JSON.stringify({
                code: "checksum_mismatch",
                error: "File verification failed.",
              }),
              stderr: "",
              exit_code: 1,
            };
          await this.writeBinary(id!, u.target!, bytes);
          this.binaryFiles.set(`${id}:${stage}receipt`, new Uint8Array());
        }
        return {
          stdout: JSON.stringify({ file: await this.statFile(id!, u.target!) }),
          stderr: "",
          exit_code: 0,
        };
      }
      return { stdout: '{"ok":true}', stderr: "", exit_code: 0 };
    }
    if (command?.includes("/proc/1/stat"))
      return {
        stdout: `${this.instances.get(id!)?.boot || 1}:1:1`,
        stderr: "",
        exit_code: 0,
      };
    if (command?.includes("xdpyinfo")) {
      const screen = screenForTemplate(this.instances.get(id!)?.template || "");
      return {
        stdout: `dimensions: ${screen.width}x${screen.height} pixels`,
        stderr: "",
        exit_code: 0,
      };
    }
    return { stdout: '{"status":"configured"}', stderr: "", exit_code: 0 };
  }
  async readFile(_id: string, path: string) {
    const row = this.files.get(path);
    if (!row) throw new ProviderError(404, "not_found", "File not found.");
    return { ...row };
  }
  async writeFile(
    _id: string,
    path: string,
    content: string,
    modified?: number,
  ) {
    const row = this.files.get(path);
    if (row && modified !== undefined && row.modified !== modified)
      throw new ProviderError(
        412,
        "modified",
        "The agent edited this file. Reload before saving.",
      );
    this.files.set(path, { content, modified: Date.now() + Math.random() });
  }
  async responses(_id: string, body: Record<string, unknown>) {
    this.responseRequests.push({
      instanceId: _id,
      body: structuredClone(body),
    });
    const sessionId = String(body.session_id || hex());
    const responseId = hex();
    const input = String(body.input);
    const introduction =
      input.startsWith("App context") &&
      input.includes("This is your introduction to ");
    const userInput = visibleMessage(input) || input;
    const output = introduction
      ? "Hey Alex, I’m Pip. A little curious, a lot in your corner.\n\nI can keep an eye on your week, prepare you for meetings, or turn a loose idea into a finished piece of work. What should we take on first?"
      : `I’ve got it. In this local preview, we can explore how that work would look together.\n\n**${userInput.slice(-400)}**\n\nYou can track it in Tasks, add what matters to the Wiki, or set up a Routine. A live Agent37 connection will let me carry out the work on my computer.`;
    const session = this.histories.get(sessionId) || {
      id: sessionId,
      active_response_id: null,
      history: [],
    };
    session.history.push({ role: "user", content: input });
    session.active_response_id = responseId;
    this.histories.set(sessionId, session);
    this.responseSessions.set(responseId, sessionId);
    if (!body.stream) {
      session.history.push({ role: "assistant", content: output });
      session.active_response_id = null;
      return Response.json({
        id: responseId,
        session_id: sessionId,
        output_text: output,
      });
    }
    const frames = [
      this.frame("response.created", { id: responseId, session_id: sessionId }),
      this.frame("response.tool_call.started", {
        tool: "workspace",
        label: "Reading your workspace",
      }),
      this.frame("response.tool_call.completed", {
        tool: "workspace",
        duration_ms: 380,
      }),
      ...output
        .match(/.{1,28}(?:\s|$)|.{1,28}/gs)!
        .map((text) => this.frame("response.output_text.delta", { text })),
      this.frame("response.completed", { output_text: output }),
    ];
    this.buffers.set(responseId, frames.join(""));
    // Native Agent37 turns persist independently of any HTTP viewer.
    setTimeout(() => {
      if (session.active_response_id === responseId) {
        session.history.push({ role: "assistant", content: output });
        session.active_response_id = null;
      }
    }, frames.length * 30);
    const encoder = new TextEncoder();
    let index = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        if (
          session.active_response_id !== responseId &&
          index < frames.length - 1
        )
          index = frames.length - 1;
        if (index >= frames.length) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(frames[index++]));
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream" },
    });
  }
  private frame(event: string, data: unknown) {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }
  async stream(_id: string, responseId: string) {
    const buffer = this.buffers.get(responseId);
    if (!buffer)
      throw new ProviderError(404, "response_not_found", "Response expired.");
    return new Response(buffer, {
      headers: { "Content-Type": "text/event-stream" },
    });
  }
  async cancel(_id: string, responseId: string) {
    const id = this.responseSessions.get(responseId);
    if (id) this.histories.get(id)!.active_response_id = null;
  }
  async session(_id: string, id: string) {
    return structuredClone(
      this.histories.get(id) || { id, active_response_id: null, history: [] },
    );
  }
  async sessions() {
    return [...this.histories.values()].map((session) => ({
      id: session.id,
      name: "You & Pip",
      preview: session.history[0]?.content || "",
    }));
  }
  async desktop() {
    return { ws: "demo" };
  }
  async crons(id: string) {
    return this.schedules.get(id) || [];
  }
  async createCron(id: string, body: Record<string, unknown>) {
    const cron = {
      ...body,
      id: randomBytes(6).toString("hex"),
      last_run: null,
      next_run: Math.floor(Date.now() / 1000) + 3600,
      enabled: body.enabled !== false,
    } as Cron;
    this.schedules.set(id, [...(await this.crons(id)), cron]);
    return cron;
  }
  async patchCron(id: string, cronId: string, body: Record<string, unknown>) {
    const cron = (await this.crons(id)).find((row) => row.id === cronId);
    if (!cron) throw new ProviderError(404, "not_found", "Routine not found.");
    Object.assign(cron, body);
    return cron;
  }
  async removeCron(id: string, cronId: string) {
    this.schedules.set(
      id,
      (await this.crons(id)).filter((row) => row.id !== cronId),
    );
  }
  async runCron() {
    return { status: "triggered", session_id: null };
  }
  async cronRuns(): Promise<CronRun[]> {
    return [];
  }
  async toolkits(_id: string, search: string, cursor?: string) {
    const all: Toolkit[] = [
      ["gmail", "Gmail", "A little less inbox. A little more headspace."],
      [
        "googlecalendar",
        "Google Calendar",
        "Make room for the things that matter.",
      ],
      ["slack", "Slack", "Stay in the loop without living in it."],
      ["notion", "Notion", "Your notes, projects, and ideas, connected."],
      ["github", "GitHub", "Keep an eye on what is getting built."],
      ["outlook", "Outlook", "Your email and calendar, working together."],
      [
        "googledrive",
        "Google Drive",
        "Find the right file. Get the work moving.",
      ],
      ["linear", "Linear", "Turn the next step into a little momentum."],
      ["todoist", "Todoist", "Give your to-do list a helping hand."],
      [
        "salesforce",
        "Salesforce",
        "Keep relationships and follow-ups in view.",
      ],
      ["hubspot", "HubSpot", "A useful hand with your customer work."],
      ["airtable", "Airtable", "Make sense of the details."],
    ].map(([slug, name, description]) => ({
      slug,
      name,
      description,
      enabled: true,
      isNoAuth: false,
    }));
    const rows = all.filter((row) =>
      `${row.name} ${row.description}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
    const offset = Number(cursor || 0);
    return {
      toolkits: rows.slice(offset, offset + 6),
      nextCursor: offset + 6 < rows.length ? String(offset + 6) : null,
    };
  }
  async connections(id: string) {
    return { connections: this.connectionsMap.get(id) || [] };
  }
  async connect(id: string, toolkit: string, callbackUrl: string) {
    const connections = (await this.connections(id)).connections;
    if (!connections.some((row) => row.toolkitSlug === toolkit))
      connections.push({
        id: randomUUID(),
        toolkitSlug: toolkit,
        toolkitName: toolkit,
        status: "ACTIVE",
      });
    this.connectionsMap.set(id, connections);
    const url = new URL(callbackUrl);
    url.searchParams.set("preview", "1");
    return {
      redirectUrl: url.toString(),
      connectedAccountId: connections.find(
        (row) => row.toolkitSlug === toolkit,
      )!.id,
    };
  }
  async disconnect(id: string, connectionId: string) {
    this.connectionsMap.set(
      id,
      (await this.connections(id)).connections.filter(
        (row) => row.id !== connectionId,
      ),
    );
  }
  async usage() {
    return {
      total_micros: 1280000,
      by_integration: {
        llm: { cost_micros: 930000 },
        brave: { cost_micros: 350000 },
      },
    };
  }
  async getUsage(id: string): Promise<InstanceUsage> {
    const budget = await this.getBudget(id);
    return {
      period: budget.monthlyPeriod,
      totalMicros: 1_280_000,
      byIntegration: {
        llm: {
          costMicros: 930_000,
          calls: 42,
          inputTokens: 184_032,
          outputTokens: 96_110,
        },
        brave: { costMicros: 350_000, calls: 70 },
        composio: { costMicros: 0, calls: 0 },
        perflo: { costMicros: 0, calls: 0 },
      },
    };
  }
  async getBudget(id: string) {
    const budget = this.budgets.get(id);
    if (!budget)
      throw new ProviderError(404, "not_found", "Computer not found.");
    return structuredClone(budget);
  }
  async budget(id: string, micros: number) {
    const current = await this.getBudget(id);
    const next = {
      ...current,
      monthlyCapMicros: micros,
      monthlyRemainingMicros: Math.max(
        0,
        micros - current.monthlyConsumedMicros,
      ),
    };
    this.budgets.set(id, next);
    return next;
  }
}
export class DemoInkbox implements InkboxProvider {
  async removeIdentity(handle: string) {
    await this.request(`/identities/${handle}`, { method: "DELETE" });
  }
  identities = new Map<string, any>();
  async request(path: string, init?: RequestInit): Promise<any> {
    if (path === "/identities" && (!init?.method || init.method === "GET"))
      return [...this.identities.values()].map((row) => structuredClone(row));
    if (path.includes("/imessage/assignments"))
      return [{ remote_number: "+14165550123", status: "active" }];
    if (path === "/identities" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      const row = {
        id: randomUUID(),
        email_address: `${body.agent_handle}@preview.example`,
        ...body,
      };
      this.identities.set(body.agent_handle, row);
      return row;
    }
    if (
      path.startsWith("/identities/") &&
      !path.includes("/mail-contact-rules")
    ) {
      const handle = path.split("/")[2];
      if (init?.method === "DELETE") {
        this.identities.delete(handle);
        return {};
      }
      const row = this.identities.get(handle);
      if (!row)
        throw new ProviderError(404, "not_found", "Identity not found.");
      return row;
    }
    if (path === "/api-keys")
      return { api_key: "preview-identity-key", id: randomUUID() };
    if (path.includes("triage-number"))
      return {
        number: "+14165550100",
        connect_command: "connect @pip-preview",
        sms_link: "sms:+14165550100?body=connect%20%40pip-preview",
        connect_qr_png_data_url: "",
      };
    if (path.includes("/calls"))
      return {
        calls: [
          {
            id: "preview-call",
            status: "completed",
            started_at: new Date(Date.now() - 86400000).toISOString(),
            to_number: "+14165550123",
            transcript:
              "Alex: Can you help me plan tomorrow?\nPip: Of course. Let’s start with the things you want to make room for.",
          },
        ],
      };
    return { id: randomUUID(), calls: [], transcripts: [] };
  }
  async findConfirmation() {
    return true;
  }
}
export async function seedDemo(
  repo: MemoryRepository,
  provider: DemoAgent37,
  inkbox: DemoInkbox,
) {
  const createdAt = new Date().toISOString();
  await repo.saveProfile({
    id: DEMO_USER,
    email: DEMO_EMAIL,
    name: "Alex",
    agentName: "Pip",
    avatar: "sprout",
    color: "#7659e8",
    phone: "+14165550123",
    timezone: "America/Toronto",
    personality:
      "Curious, thoughtful, and quietly optimistic. A little playful. Always useful.",
    preferences: "Protect quiet mornings. Keep updates short and useful.",
    createdAt,
  });
  const instance = await provider.createInstance({
    user: DEMO_USER,
    template: "boundless-hermes-desktop@2",
    budget: { monthly_cap_micros: 5_000_000 },
  });
  const identity = await inkbox.request("/identities", {
    method: "POST",
    body: JSON.stringify({ agent_handle: "pip-preview" }),
  });
  const mainSessionId = hex();
  await repo.saveAgent({
    ownerId: DEMO_USER,
    instanceId: instance.id,
    handle: "pip-preview",
    identityId: identity.id,
    agentEmail: "pip@preview.example",
    phase: "ready",
    completed: ["identity", "computer", "phone", "persona", "plugin", "ready"],
    status: "ready",
    budgetMicros: 5_000_000,
    mainSessionId,
    updatedAt: createdAt,
    connect: {
      number: "+14165550100",
      command: "connect @pip-preview",
      smsLink: "sms:+14165550100",
      qr: "",
    },
  });
  await repo.saveConversation({
    ownerId: DEMO_USER,
    id: mainSessionId,
    title: "You & Pip",
    channel: "web",
    createdAt,
  });
  provider.histories.set(mainSessionId, {
    id: mainSessionId,
    active_response_id: null,
    history: [
      {
        role: "assistant",
        content:
          "Hey Alex. A little more room for what matters?\n\nI can help you get ready for the week, keep an eye on something, or turn that idea you’ve been sitting on into a next step. Just say the word.",
      },
    ],
  });
  for (const [kind, title, body, status] of [
    [
      "responsibility",
      "Make mornings a little lighter",
      "A useful briefing at 8:30. Your day, the urgent things, and a little breathing room.",
      "in_progress",
    ],
    [
      "task",
      "Get ready for Thursday’s meeting",
      "Pull together the project notes and a few things worth asking.",
      "in_progress",
    ],
    [
      "task",
      "A little weekend inspiration",
      "Three nearby places to stretch your legs and switch off.",
      "completed",
    ],
    [
      "task",
      "Pick a time for the catch-up",
      "I found a few gaps next week. Choose the one that feels right.",
      "needs_you",
    ],
    [
      "wiki",
      "How you like to work",
      "## Your rhythm\nQuiet mornings for focused work. Meetings work best after 11.\n\n## Communication\nShort updates, useful details, and clear next steps.",
      "completed",
    ],
    [
      "wiki",
      "The things that matter",
      "## This season\nMake steady progress on the studio. Keep space for friends and weekends outdoors.",
      "completed",
    ],
    [
      "suggestion",
      "A small Friday ritual?",
      "I could pull your week into a short wrap-up: what moved, what needs you, and what can wait.",
      "todo",
    ],
  ] as const)
    await repo.saveItem({
      id: randomUUID(),
      ownerId: DEMO_USER,
      kind,
      title,
      body,
      status,
      metadata: {},
      createdAt,
      updatedAt: createdAt,
    });
  await repo.notify({
    id: randomUUID(),
    ownerId: DEMO_USER,
    text: "Your Thursday meeting notes are taking shape. I’ll let you know when they’re ready.",
    createdAt,
  });
  await provider.createCron(instance.id, {
    name: "A lighter morning",
    prompt:
      "Prepare a short morning briefing using whichever calendars and apps are connected.",
    schedule: "30 8 * * 1-5",
    timezone: "America/Toronto",
  });
  await provider.createCron(instance.id, {
    name: "The Friday wrap-up",
    prompt: "Review this week’s work and prepare a brief wrap-up.",
    schedule: "0 16 * * 5",
    timezone: "America/Toronto",
  });
}
