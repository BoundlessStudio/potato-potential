import express, {
  type Request,
  type Response as ExpressResponse,
} from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createClient, isAuthRetryableFetchError } from "@supabase/supabase-js";
import {
  isFiredOneTime,
  itemSchema,
  parseSse,
  profileSchema,
  publicAgent,
  routineNotificationSuffix,
  routinePatchSchema,
  type Agent,
  type CronRun,
  type Conversation,
  type Profile,
  type WorkspaceItem,
  fileAttachmentText,
} from "@boundless/shared";
import type { Config } from "./config";
import type { Repository } from "./repository";
import type { AgentProvider, InkboxProvider } from "./providers";
import { Lifecycle, WORKSPACE_HELPER_VERSION } from "./lifecycle";
import { DEMO_EMAIL, DEMO_NEW_USER, DEMO_USER } from "./demo";
import { HttpError, hash, matchesHash, token, seal, unseal } from "./security";
import { boundedSse } from "./streams";
import {
  computerBusy,
  computerOperationPending,
  screenForTemplate,
} from "./computer-maintenance";
import { registerBackupRoutes } from "./computer-backups";
import { registerBetaRoutes } from "./beta";
import { registerSignInRoutes } from "./sign-in";
import { registerFileRoutes, cleanUploadsLocked } from "./files";
import { registerBudgetRoutes } from "./budget";
import { registerUsageRoutes } from "./usage";
import { FILE_TRANSFER_VERSION } from "./file-transfer";
import {
  registerAgentComputerRoutes,
  registerComputerRoutes,
  reconcileComputerLinksLocked,
  COMPUTER_HELPER_VERSION,
} from "./computer-services";
import {
  accessPaused,
  suspensionPending,
  reconcileSuspensionLocked,
} from "./suspension";
import type { InvitationEmail } from "./invitations";

export type Queue = {
  send(
    kind: "provision" | "cleanup" | "reconcile" | "maintenance",
    ownerId: string,
  ): Promise<void>;
  maintenance?(): Promise<void>;
  recover?(ownerId: string): Promise<void>;
};
export type Dependencies = {
  config: Config;
  repo: Repository;
  a37: AgentProvider;
  inkbox: InkboxProvider;
  lifecycle: Lifecycle;
  queue: Queue;
  invitationEmail?: (input: InvitationEmail) => Promise<void>;
  signInEmail?: (input: InvitationEmail) => Promise<void>;
};
type Actor = { id: string; email: string; operator: boolean };
type AuthRequest = Request & { actor: Actor };
const actor = (req: Request) => (req as AuthRequest).actor;
const uuid = z.uuid();
const remoteId = z.string().regex(/^[a-f0-9]{32}$/);
// Native Hermes/cron notification ids can differ from gateway session ids.
const sessionIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const cronId = z.string().regex(/^[a-f0-9]{12}$/);
const date = () => new Date().toISOString();
const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export async function reconcile(dep: Dependencies, ownerId: string) {
  return dep.repo.locked(ownerId, () => reconcileLocked(dep, ownerId));
}

// The job worker already holds the customer lease through job completion.
export async function reconcileLocked(dep: Dependencies, ownerId: string) {
  const agent = await dep.repo.agent(ownerId);
  await reconcileComputerLinksLocked(dep, ownerId, true);
  if (agent && suspensionPending(agent))
    await reconcileSuspensionLocked(dep, agent);
  if (!agent?.instanceId || agent.status !== "ready") return;
  if (
    !computerBusy(agent) &&
    (await reconcileComputerLinksLocked(dep, ownerId))
  )
    return true;
  if (accessPaused(agent) || computerBusy(agent)) return;
  if (
    (agent.computerHelperVersion || 0) < COMPUTER_HELPER_VERSION ||
    (agent.workspaceHelperVersion || 0) < WORKSPACE_HELPER_VERSION ||
    (agent.fileTransferVersion || 0) < FILE_TRANSFER_VERSION
  ) {
    const profile = await dep.repo.profile(ownerId);
    if (profile) {
      await dep.lifecycle.configurePersona(profile, agent);
      await dep.repo.saveAgent(agent);
    }
  }
  await cleanUploadsLocked(dep, ownerId, agent.instanceId);
  const archived = await dep.repo.archived(ownerId);
  const pending = new Map(
    archived
      .filter(
        (run) =>
          run.outcome === "running" ||
          (run.outcome === "unknown" && Date.now() / 1000 - run.ran_at < 900),
      )
      .map((run) => [`${run.cronId}:${run.session_id}:${run.ran_at}`, run]),
  );
  const crons = await dep.a37.crons(agent.instanceId);
  for (const cron of crons) {
    if (!cron.last_run) continue;
    const runs = (await dep.a37.cronRuns(agent.instanceId, cron.id)).map(
      (run) => ({
        ...run,
        cronId: cron.id,
        name: cron.name,
        outcome: "unknown" as const,
      }),
    );
    for (const run of runs) {
      const prior = archived.find(
        (row) =>
          row.cronId === run.cronId &&
          row.session_id === run.session_id &&
          row.ran_at === run.ran_at,
      );
      if (
        prior?.outcome &&
        prior.outcome !== "running" &&
        !(prior.outcome === "unknown" && Date.now() / 1000 - prior.ran_at < 900)
      ) {
        run.outcome = prior.outcome as any;
        continue;
      }
      if (run.status === "skipped") continue;
      if (run.session_id) {
        const session = await dep.a37.session(agent.instanceId, run.session_id);
        run.outcome = (
          session.active_response_id
            ? "running"
            : session.history.some((message) => message.role === "assistant")
              ? "completed"
              : "unknown"
        ) as any;
        await dep.repo.saveConversation({
          ownerId,
          id: run.session_id,
          title: cron.name,
          channel: "scheduled",
          createdAt: new Date(run.ran_at * 1000).toISOString(),
        });
      }
      pending.delete(`${run.cronId}:${run.session_id}:${run.ran_at}`);
    }
    // Archive first. A provider DELETE destroys its history; a failed archive must stop deletion.
    await dep.repo.archive(ownerId, runs);
    if (isFiredOneTime(cron) && runs.some((run) => run.status === "triggered"))
      await dep.a37.removeCron(agent.instanceId, cron.id);
  }
  // A one-time cron may already be removed while its turn is still running.
  for (const run of pending.values()) {
    if (!run.session_id) continue;
    const session = await dep.a37.session(agent.instanceId, run.session_id);
    if (!session.active_response_id)
      await dep.repo.archive(ownerId, [
        {
          ...run,
          outcome: session.history.some(
            (message) => message.role === "assistant",
          )
            ? "completed"
            : "unknown",
        },
      ]);
  }
}

export function createApp(dep: Dependencies) {
  const { config, repo, a37, inkbox, lifecycle, queue } = dep;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(
    cors({
      origin(origin, callback) {
        callback(
          null,
          !origin ||
            origin === config.webOrigin ||
            (config.demo &&
              ["http://127.0.0.1:3000", "http://localhost:3000"].includes(
                origin,
              )),
        );
      },
      exposedHeaders: ["Content-Type"],
    }),
  );
  const json = express.json({ limit: "96kb" });
  app.use((req, res, next) =>
    /^\/api\/files\/uploads\/[^/]+\/chunks\/[^/]+$/.test(req.path)
      ? next()
      : json(req, res, next),
  );
  app.use((_req, res, next) => {
    res.locals.startedAt = Date.now();
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    next();
  });
  app.get("/health", (_req, res) =>
    res.json({ healthy: true, demo: config.demo }),
  );
  app.get("/api/health", (_req, res) =>
    res.json({ healthy: true, demo: config.demo }),
  );
  // This route precedes customer auth; only Vercel's private cron credential can call it.
  app.get("/api/internal/maintenance", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (
      !secret ||
      !matchesHash(
        (req.headers.authorization || "").replace(/^Bearer /, ""),
        hash(secret),
      )
    )
      throw new HttpError(401, "unauthorized", "Authentication required.");
    await queue.maintenance?.();
    res.json({ queued: true });
  });
  app.get("/api/config", (_req, res) =>
    res.json({ demo: config.demo, sms: config.sms }),
  );
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: config.demo ? 1000 : 180,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );

  registerAgentComputerRoutes(app, dep);
  app.post("/api/agent/workspace", async (req, res) => {
    const body = z
      .object({
        instance_id: z.string().regex(/^[a-z0-9]{10}$/),
        event_id: uuid,
        command: z.enum(["list", "save", "notify"]),
        item: itemSchema.optional(),
        text: z.string().max(10000).optional(),
        session_id: sessionIdSchema.optional(),
      })
      .parse(req.body);
    const agent = await repo.byInstance(body.instance_id);
    const credential =
      req.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
    if (
      !agent ||
      agent.status !== "ready" ||
      accessPaused(agent) ||
      computerBusy(agent) ||
      !matchesHash(credential, agent.callbackHash)
    )
      throw new HttpError(403, "forbidden", "Callback authentication failed.");
    if (body.command === "list")
      return res.json({ items: await repo.items(agent.ownerId) });
    if (body.command === "notify") {
      if (!body.text?.trim())
        throw new HttpError(
          400,
          "invalid_request",
          "A notification needs text.",
        );
      await repo.notify({
        id: body.event_id,
        ownerId: agent.ownerId,
        text: body.text,
        sessionId: body.session_id,
        createdAt: date(),
      });
      await queue.send("reconcile", agent.ownerId);
      return res.json({ ok: true });
    }
    const item = await repo.locked(agent.ownerId, async () => {
      const current = await repo.byInstance(body.instance_id);
      if (
        !current ||
        current.status !== "ready" ||
        accessPaused(current) ||
        !matchesHash(credential, current.callbackHash)
      )
        throw new HttpError(
          403,
          "forbidden",
          "Callback authentication failed.",
        );
      if (!body.item)
        throw new HttpError(400, "invalid_request", "An item is required.");
      const id = body.item.id || body.event_id;
      const previous = await repo.item(current.ownerId, id);
      if (body.item.id && !previous)
        throw new HttpError(404, "not_found", "Item not found.");
      const saved: WorkspaceItem = {
        ...body.item,
        id,
        ownerId: current.ownerId,
        createdAt: previous?.createdAt || date(),
        updatedAt: date(),
      };
      await repo.saveItem(saved);
      return saved;
    });
    res.json({ item });
  });

  app.post(
    "/api/beta",
    rateLimit({
      windowMs: 60 * 60_000,
      limit: config.demo ? 1000 : 12,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        error: {
          code: "rate_limited",
          message: "Please try joining the beta list again later.",
        },
      },
    }),
    async (req, res) => {
      const { email, website } = z
        .object({ email: emailSchema, website: z.string().max(500).optional() })
        .parse(req.body);
      if (!website) await repo.addBetaRequest(email);
      // Same response for a new request or an email already on the list.
      // Signup never creates an invitation, an Auth account, or a provider instance.
      res.status(202).json({ saved: true });
    },
  );

  const authClient = config.demo
    ? null
    : createClient(config.supabaseUrl, config.supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
  registerSignInRoutes(app, dep, authClient);
  registerBetaRoutes(app, dep, authClient);
  app.use("/api", async (req, _res, next) => {
    const credential =
      req.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
    if (config.demo) {
      if (!["demo", "demo-new"].includes(credential))
        throw new HttpError(401, "unauthorized", "Sign in to continue.");
      (req as AuthRequest).actor = {
        id: credential === "demo" ? DEMO_USER : DEMO_NEW_USER,
        email: credential === "demo" ? DEMO_EMAIL : "new@example.com",
        operator: credential === "demo",
      };
    } else {
      const { data, error } = await authClient!.auth.getUser(credential);
      if (
        error &&
        (isAuthRetryableFetchError(error) ||
          !error.status ||
          error.status === 429 ||
          error.status >= 500)
      )
        throw new HttpError(
          502,
          "auth_unavailable",
          "Sign-in checks are temporarily unavailable. Please try again.",
        );
      if (error || !data.user?.email || !data.user.email_confirmed_at)
        throw new HttpError(
          401,
          "unauthorized",
          "Use your verified invitation email to sign in.",
        );
      (req as AuthRequest).actor = {
        id: data.user.id,
        email: data.user.email.toLowerCase(),
        operator: config.operators.includes(data.user.email.toLowerCase()),
      };
    }
    next();
  });
  async function account(req: Request, allowDeleting = false) {
    const profile = await repo.profile(actor(req).id);
    if (!profile)
      throw new HttpError(
        403,
        "invitation_required",
        "Accept your invitation to create an agent.",
      );
    if (
      !allowDeleting &&
      (await repo.agent(actor(req).id))?.status === "deleting"
    )
      throw new HttpError(
        409,
        "account_deleting",
        "Your account is closing. Retry deletion if cleanup is interrupted.",
      );
    return profile;
  }
  async function ready(req: Request, allowMaintenance = false) {
    await account(req);
    const agent = await repo.agent(actor(req).id);
    if (!agent?.instanceId || agent.status !== "ready")
      throw new HttpError(
        409,
        "agent_not_ready",
        "Finish setting up your companion first.",
      );
    if (accessPaused(agent))
      throw new HttpError(
        403,
        "agent_suspended",
        "Your operator has paused this companion.",
      );
    if (!allowMaintenance && computerBusy(agent))
      throw new HttpError(
        409,
        "computer_maintenance",
        "Your companion’s computer is being looked after. Try again when it is ready.",
      );
    return agent as Agent & { instanceId: string };
  }
  function operator(req: Request) {
    if (!actor(req).operator)
      throw new HttpError(403, "forbidden", "Operator access is required.");
  }
  registerComputerRoutes(app, dep, (req) => actor(req).id, account);
  registerBackupRoutes(app, dep, (req) => actor(req).id, account);
  registerFileRoutes(app, dep, (req) => actor(req).id, ready);
  registerBudgetRoutes(app, dep, (req) => actor(req).id, account);
  registerUsageRoutes(app, dep, (req) => actor(req).id, account);

  app.get("/api/me", async (req, res) => {
    const profile = await repo.profile(actor(req).id);
    let agent = await repo.agent(actor(req).id);
    // Recover a request interrupted between saving setup and creating its first
    // outbox job. Existing jobs are deduplicated by the queue.
    if (agent && ["new", "provisioning"].includes(agent.status))
      await queue.send("provision", actor(req).id).catch(() => {});
    if (agent?.status === "deleting")
      await queue.send("cleanup", actor(req).id).catch(() => {});
    if (agent && suspensionPending(agent))
      await queue.send("reconcile", actor(req).id).catch(() => {});
    if (
      agent &&
      (["new", "provisioning", "failed", "deleting"].includes(agent.status) ||
        computerOperationPending(agent))
    )
      await queue.recover?.(actor(req).id).catch(() => {});
    let challenge: string | undefined;
    if (agent?.status === "awaiting_phone")
      await repo.locked(actor(req).id, async () => {
        // Refresh after taking the lease; cleanup may have started since the first read.
        agent = await repo.agent(actor(req).id);
        if (agent?.status === "awaiting_phone")
          challenge = await lifecycle.challenge(agent);
      });
    res.json({
      profile,
      agent: agent ? publicAgent(agent, challenge) : null,
      email: actor(req).email,
      operator: actor(req).operator,
      invited:
        !profile && Boolean(await repo.pendingInvitation(actor(req).email)),
      demo: config.demo,
    });
  });
  app.post("/api/invitations/accept", async (req, res) => {
    const { invitation } = z
      .object({ invitation: z.string().min(16).max(200).optional() })
      .parse(req.body);
    await repo.locked(actor(req).id, async () => {
      // A tokenless retry after a lost successful response is already enrolled.
      if (!invitation && (await repo.profile(actor(req).id))) return;
      const digest = invitation
        ? hash(invitation)
        : await repo.pendingInvitation(actor(req).email);
      if (!digest)
        throw new HttpError(
          403,
          "invitation_required",
          "Your beta request is waiting for approval. Sign in after you receive an invitation.",
        );
      await repo.acceptInvitation(
        {
          id: actor(req).id,
          email: actor(req).email,
          name: "",
          agentName: "Pip",
          avatar: "sprout",
          color: "#7659e8",
          phone: "",
          timezone: "UTC",
          personality: "",
          preferences: "",
          createdAt: date(),
        },
        digest,
      );
    });
    res.json({ accepted: true });
  });
  app.post("/api/onboarding", async (req, res) => {
    const data = profileSchema.parse(req.body);
    // A verified operator can enroll their own companion; other customers need an invitation.
    if (!config.demo && !actor(req).operator) await account(req);
    await repo.locked(actor(req).id, async () => {
      const existing = await repo.agent(actor(req).id);
      if (
        existing &&
        (existing.instanceId ||
          existing.handle ||
          existing.identityId ||
          existing.completed.includes("identity") ||
          ["deleting", "deleted"].includes(existing.status))
      )
        throw new HttpError(
          409,
          "agent_exists",
          "Continue your existing setup rather than creating a second agent.",
        );
      const current = await repo.profile(actor(req).id);
      await repo.saveProfile({
        ...data,
        id: actor(req).id,
        email: actor(req).email,
        createdAt: current?.createdAt || date(),
      });
      await lifecycle.newAgent(actor(req).id);
    });
    await queue.send("provision", actor(req).id);
    res.status(202).json({ queued: true });
  });
  app.post("/api/onboarding/retry", async (req, res) => {
    await account(req);
    await queue.send("provision", actor(req).id);
    res.status(202).json({ queued: true });
  });
  app.post("/api/onboarding/verify-phone", async (req, res) => {
    await account(req);
    await lifecycle.verifyPhone(actor(req).id);
    await queue.send("provision", actor(req).id);
    res.status(202).json({ verified: true });
  });
  app.put("/api/profile", async (req, res) => {
    const current = await account(req);
    const data = profileSchema.parse(req.body);
    const agent = await ready(req);
    if (data.phone !== current.phone)
      throw new HttpError(
        409,
        "phone_change_requires_verification",
        "Contact-number changes need a new verified connection. Keep the current number while updating personality.",
      );
    const updated = { ...current, ...data };
    await lifecycle.configurePersona(updated, agent);
    await repo.saveProfile(updated);
    res.json({ profile: updated });
  });
  app.delete("/api/account", async (req, res) => {
    await account(req, true);
    await lifecycle.requestCleanup(actor(req).id);
    await queue.send("cleanup", actor(req).id);
    res.status(202).json({ queued: true });
  });

  app.get("/api/items", async (req, res) => {
    await account(req);
    res.json({
      items: await repo.items(
        actor(req).id,
        typeof req.query.kind === "string" ? req.query.kind : undefined,
      ),
    });
  });
  app.post("/api/items", async (req, res) => {
    await account(req);
    const input = itemSchema.parse(req.body);
    const item = await repo.locked(actor(req).id, async () => {
      const prior = input.id ? await repo.item(actor(req).id, input.id) : null;
      if (input.id && !prior)
        throw new HttpError(404, "not_found", "Item not found.");
      const item: WorkspaceItem = {
        ...input,
        ownerId: actor(req).id,
        id: input.id || randomUUID(),
        createdAt: prior?.createdAt || date(),
        updatedAt: date(),
      };
      await repo.saveItem(item);
      return item;
    });
    res.json({ item });
  });
  app.delete("/api/items/:id", async (req, res) => {
    await account(req);
    await repo.locked(actor(req).id, () =>
      repo.deleteItem(actor(req).id, uuid.parse(req.params.id)),
    );
    res.json({ deleted: true });
  });
  app.get("/api/notifications", async (req, res) => {
    await account(req);
    res.json({ notifications: await repo.notifications(actor(req).id) });
  });
  app.post("/api/notifications/read", async (req, res) => {
    await account(req);
    await repo.readNotifications(actor(req).id);
    res.json({ ok: true });
  });

  app.get("/api/sessions", async (req, res) => {
    const agent = await ready(req);
    const indexed = await repo.conversations(actor(req).id);
    const remote = await a37.sessions(agent.instanceId);
    for (const row of remote) {
      const existing = indexed.find((item) => item.id === row.id);
      const title = row.title || row.name;
      if (existing) {
        if (existing.channel === "web" && title && title !== existing.title)
          await repo.saveConversation({ ...existing, title });
      } else {
        const session = await a37.session(agent.instanceId, row.id);
        const marker =
          session.history.find((message) => message.role === "user")?.content ||
          "";
        const channel = marker.includes("[inkbox:email")
          ? "email"
          : marker.includes("[inkbox:imessage")
            ? "imessage"
            : marker.includes("[inkbox:voice")
              ? "voice"
              : marker.includes("[inkbox:sms")
                ? "sms"
                : "scheduled";
        await repo.saveConversation({
          ownerId: actor(req).id,
          id: row.id,
          title: row.name || row.title || row.preview || "Agent activity",
          channel,
          createdAt: date(),
        });
      }
    }
    res.json({
      sessions: (await repo.conversations(actor(req).id)).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    });
  });
  async function selectWebSession(
    req: Request,
    id: string,
    create: boolean,
    expectedSessionId?: string,
  ): Promise<Conversation> {
    return repo.locked(actor(req).id, async () => {
      const agent = await ready(req);
      const existing = (await repo.conversations(agent.ownerId)).find(
        (row) => row.id === id,
      );
      if (!create && !existing)
        throw new HttpError(404, "not_found", "Conversation not found.");
      if (existing && existing.channel !== "web")
        throw new HttpError(
          409,
          "session_read_only",
          "Continue this conversation in its original channel.",
        );
      // Retrying a successful selection is safe even after its reply was lost.
      if (agent.mainSessionId !== id) {
        if (expectedSessionId && expectedSessionId !== agent.mainSessionId)
          throw new HttpError(
            409,
            "conversation_changed",
            "Your conversation changed in another tab. Reload and try again.",
          );
        if (
          agent.mainSessionId &&
          (await a37.session(agent.instanceId, agent.mainSessionId))
            .active_response_id
        )
          throw new HttpError(
            409,
            "session_busy",
            "Finish or stop the current response before changing conversations.",
          );
      }
      const conversation: Conversation = existing || {
        ownerId: agent.ownerId,
        id,
        title: "New conversation",
        channel: "web",
        createdAt: date(),
      };
      // Hermes creates the native session on its first message. Reserving the
      // id first gives empty conversations history entries without a model call.
      await repo.saveConversation(conversation);
      if (agent.mainSessionId !== id) {
        agent.mainSessionId = id;
        await repo.saveAgent(agent);
      }
      return conversation;
    });
  }
  app.post("/api/sessions", async (req, res) => {
    const body = z
      .object({ id: remoteId, expectedSessionId: remoteId.optional() })
      .strict()
      .parse(req.body);
    const session = await selectWebSession(
      req,
      body.id,
      true,
      body.expectedSessionId,
    );
    res.status(201).json({ session });
  });
  app.post("/api/sessions/:id/activate", async (req, res) => {
    const body = z
      .object({ expectedSessionId: remoteId.optional() })
      .strict()
      .parse(req.body);
    res.json({
      session: await selectWebSession(
        req,
        remoteId.parse(req.params.id),
        false,
        body.expectedSessionId,
      ),
    });
  });
  app.get("/api/sessions/:id", async (req, res) => {
    const agent = await ready(req);
    res.json(
      await a37.session(agent.instanceId, remoteId.parse(req.params.id)),
    );
  });
  async function relay(
    req: Request,
    res: ExpressResponse,
    upstream: globalThis.Response,
    agent: Agent,
  ) {
    if (!upstream.body)
      throw new HttpError(502, "empty_stream", "The agent returned no stream.");
    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    let disconnected = false;
    const connection = new AbortController();
    res.on("close", () => {
      disconnected = true;
      connection.abort();
    });
    const heartbeat = setInterval(() => {
      if (!disconnected) res.write(":keepalive\n\n");
    }, 15_000);
    try {
      const window = Math.max(
        10,
        config.streamWindowMs - (Date.now() - res.locals.startedAt),
      );
      for await (const event of parseSse(
        boundedSse(upstream.body, window, connection.signal),
      )) {
        if (event.event === "response.created") {
          const id = String(event.data.session_id);
          remoteId.parse(id);
          if (
            !(await repo.conversations(agent.ownerId)).some(
              (row) => row.id === id,
            )
          )
            await repo.saveConversation({
              ownerId: agent.ownerId,
              id,
              title: "Your conversation",
              channel: "web",
              createdAt: date(),
            });
        }
        if (!disconnected)
          res.write(
            `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`,
          );
      }
      await queue.send("reconcile", agent.ownerId);
    } catch (error) {
      if (!disconnected)
        res.write(
          `event: response.failed\ndata: ${JSON.stringify({ error: { code: "stream_interrupted", message: "Connection interrupted. Reconnect to recover your response." } })}\n\n`,
        );
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  }
  app.post("/api/responses", async (req, res) => {
    const agent = await ready(req);
    const body = z
      .object({
        input: z.string().trim().max(30000).default(""),
        files: z
          .array(z.string().startsWith("/").max(4096))
          .max(100)
          .default([]),
        takeover: z.boolean().optional(),
        notificationId: uuid.optional(),
        sessionId: remoteId.optional(),
      })
      .parse(req.body);
    if (!body.input && !body.files.length)
      throw new HttpError(
        400,
        "empty_turn",
        "Write a message or attach a file.",
      );
    const context: string[] = [];
    if (body.takeover)
      context.push(
        "Your person used the computer and returned control. Inspect the browser before continuing.",
      );
    if (body.notificationId) {
      const note = (await repo.notifications(agent.ownerId)).find(
        (row) => row.id === body.notificationId,
      );
      if (!note)
        throw new HttpError(404, "not_found", "Notification not found.");
      context.push(
        `Your person is replying to this check-in: ${JSON.stringify(note.text)}`,
      );
    }
    const upstream = await repo.locked(agent.ownerId, async () => {
      const current = await ready(req);
      if (body.sessionId && body.sessionId !== current.mainSessionId)
        throw new HttpError(
          409,
          "conversation_changed",
          "Your conversation changed in another tab. Reload before sending this message.",
        );
      const files = [];
      for (const path of body.files) {
        const file = await a37.statFile(current.instanceId, path);
        if (file.path !== path)
          throw new HttpError(
            400,
            "invalid_path",
            "Use the exact saved path returned by the upload.",
          );
        files.push(file);
      }
      const message =
        (body.input || "I’ve uploaded these files.") +
        (files.length ? fileAttachmentText(current.instanceId, files) : "");
      const input = context.length
        ? `App context (from Boundless):\n${context.join("\n")}\nEnd of app context.\n\n${message}`
        : message;
      const conversation = (await repo.conversations(current.ownerId)).find(
        (row) => row.id === current.mainSessionId,
      );
      if (conversation?.title === "New conversation")
        await repo.saveConversation({
          ...conversation,
          title: (body.input || files[0]?.name || "Your conversation")
            .replace(/\s+/g, " ")
            .slice(0, 80),
        });
      return a37.responses(current.instanceId, {
        input,
        session_id: current.mainSessionId,
        stream: true,
        agent: "hermes",
        ...(body.files.length ? { files: body.files } : {}),
      });
    });
    await relay(req, res, upstream, agent);
  });
  app.get("/api/responses/:id/stream", async (req, res) => {
    const agent = await ready(req);
    await relay(
      req,
      res,
      await a37.stream(agent.instanceId, remoteId.parse(req.params.id)),
      agent,
    );
  });
  app.post("/api/responses/:id/cancel", async (req, res) => {
    const agent = await ready(req);
    await a37.cancel(agent.instanceId, remoteId.parse(req.params.id));
    res.json({ cancelled: true });
  });
  app.post("/api/computer", async (req, res) => {
    const agent = await ready(req);
    const [desktop, instance] = await Promise.all([
      a37.desktop(agent.instanceId),
      a37.instance(agent.instanceId),
    ]);
    res.json({
      ...desktop,
      screen:
        agent.computerScreen || screenForTemplate(instance.template || ""),
    });
  });
  app.get(
    ["/api/computer/maintenance", "/api/computer/status"],
    async (req, res) => {
      await account(req);
      const agent = await repo.agent(actor(req).id);
      if (!agent?.instanceId || agent.status !== "ready")
        throw new HttpError(
          409,
          "agent_not_ready",
          "The computer is not ready.",
        );
      if (computerOperationPending(agent))
        await queue.recover?.(agent.ownerId).catch(() => {});
      const instance = await a37.instance(agent.instanceId);
      const {
        bootBefore: _boot,
        acknowledged: _ack,
        backupsBefore: _backups,
        ...operation
      } = agent.computerOperation || {};
      res.json({
        installedTemplate: instance.template,
        availableTemplate: config.desktopTemplate,
        updateAvailable: instance.template !== config.desktopTemplate,
        instanceStatus: instance.status,
        canManage: !accessPaused(agent),
        suspended: accessPaused(agent),
        screen:
          agent.computerScreen || screenForTemplate(instance.template || ""),
        operation: agent.computerOperation ? operation : null,
      });
    },
  );
  app.post("/api/computer/maintenance", async (req, res) => {
    const { action } = z
      .object({ action: z.enum(["restart", "update"]) })
      .strict()
      .parse(req.body);
    const own = await ready(req, true);
    await repo.locked(own.ownerId, async () => {
      const agent = await repo.agent(own.ownerId);
      if (!agent?.instanceId || agent.status !== "ready" || accessPaused(agent))
        throw new HttpError(
          409,
          "agent_not_ready",
          "The computer is not available for maintenance.",
        );
      if (computerOperationPending(agent)) {
        if (agent.computerOperation?.action !== action)
          throw new HttpError(
            409,
            "computer_busy",
            "A computer operation is already in progress.",
          );
        return;
      }
      if (computerBusy(agent))
        throw new HttpError(
          409,
          "restore_not_reconnected",
          "Finish reconnecting your companion in Checkpoints before restarting or updating.",
        );
      if (
        agent.mainSessionId &&
        (await a37.session(agent.instanceId!, agent.mainSessionId))
          .active_response_id
      )
        throw new HttpError(
          409,
          "agent_busy",
          "Your companion is working. Finish or stop the response, then try again.",
        );
      const instance = await a37.instance(agent.instanceId!);
      if (action === "update" && instance.template === config.desktopTemplate)
        throw new HttpError(
          409,
          "already_current",
          "The computer already has the current update.",
        );
      agent.computerOperation = {
        id: randomUUID(),
        action,
        phase: "queued",
        targetTemplate:
          action === "update" ? config.desktopTemplate : instance.template,
        requestedAt: date(),
      };
      await repo.saveAgent(agent);
    });
    try {
      await queue.send("maintenance", own.ownerId);
    } catch (error) {
      await repo.locked(own.ownerId, async () => {
        const agent = (await repo.agent(own.ownerId))!;
        if (agent.computerOperation?.phase === "queued") {
          agent.computerOperation.phase = "failed";
          agent.computerOperation.error =
            "Couldn’t schedule the restart. Try again.";
          await repo.saveAgent(agent);
        }
      });
      throw error;
    }
    res.status(202).json({ queued: true });
  });
  app.post("/api/computer/takeover", async (req, res) => {
    await repo.locked(actor(req).id, async () => {
      const agent = await ready(req);
      if (!agent.mainSessionId) return;
      let session = await a37.session(agent.instanceId, agent.mainSessionId);
      if (!session.active_response_id) return;
      await a37.cancel(agent.instanceId, session.active_response_id);
      const deadline = Date.now() + (config.demo ? 200 : 15_000);
      do {
        session = await a37.session(agent.instanceId, agent.mainSessionId);
        if (!session.active_response_id) return;
        await new Promise((resolve) =>
          setTimeout(resolve, config.demo ? 10 : 250),
        );
      } while (Date.now() < deadline);
      throw new HttpError(
        409,
        "cancellation_pending",
        "Your companion is still stopping. Try taking over again shortly.",
      );
    });
    res.json({ control: "customer" });
  });

  app.get("/api/memory/:file", async (req, res) => {
    const agent = await ready(req);
    const file = z.enum(["user", "memory", "persona"]).parse(req.params.file);
    const paths = {
      user: "~/.hermes/memories/USER.md",
      memory: "~/.hermes/memories/MEMORY.md",
      persona: "~/.hermes/SOUL.md",
    };
    res.json(await a37.readFile(agent.instanceId, paths[file]));
  });
  app.put("/api/memory/:file", async (req, res) => {
    const agent = await ready(req);
    const file = z.enum(["user", "memory", "persona"]).parse(req.params.file);
    const body = z
      .object({ content: z.string().max(60000), modified: z.number().finite() })
      .parse(req.body);
    const paths = {
      user: "~/.hermes/memories/USER.md",
      memory: "~/.hermes/memories/MEMORY.md",
      persona: "~/.hermes/SOUL.md",
    };
    await a37.writeFile(
      agent.instanceId,
      paths[file],
      body.content,
      body.modified,
    );
    res.json({ saved: true });
  });
  app.get("/api/routines", async (req, res) => {
    const agent = await ready(req);
    await queue.send("reconcile", agent.ownerId);
    res.json({
      routines: await a37.crons(agent.instanceId),
      runs: await repo.archived(agent.ownerId),
    });
  });
  app.post("/api/routines", async (req, res) => {
    const agent = await ready(req);
    const profile = await account(req);
    const body = z
      .object({
        name: z.string().min(1).max(80),
        prompt: z.string().min(1).max(7800),
        schedule: z.string().max(120).optional(),
        when: z.iso.datetime().optional(),
      })
      .parse(req.body);
    let schedule = body.schedule;
    if (body.when) {
      if (Date.parse(body.when) <= Date.now())
        throw new HttpError(
          400,
          "past_reminder",
          "Choose a future reminder time.",
        );
      if (Date.parse(body.when) > Date.now() + 364 * 86400000)
        throw new HttpError(
          400,
          "reminder_too_far",
          "Choose a reminder within the next 364 days.",
        );
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: profile.timezone,
        minute: "numeric",
        hour: "numeric",
        hourCycle: "h23",
        day: "numeric",
        month: "numeric",
      }).formatToParts(new Date(body.when));
      const part = (type: string) =>
        Number(parts.find((value) => value.type === type)!.value);
      schedule = `${part("minute")} ${part("hour")} ${part("day")} ${part("month")} *`;
    }
    if (!schedule || schedule.trim().split(/\s+/).length !== 5)
      throw new HttpError(
        400,
        "invalid_schedule",
        "Use a five-field schedule or choose a reminder time.",
      );
    const cron = await a37.createCron(agent.instanceId, {
      name: body.name,
      prompt: body.prompt + routineNotificationSuffix,
      schedule,
      timezone: profile.timezone,
      agent: "hermes",
    });
    res.status(201).json({ routine: cron });
  });
  app.patch("/api/routines/:id", async (req, res) => {
    const agent = await ready(req);
    const body = routinePatchSchema.parse(req.body);
    const id = cronId.parse(req.params.id);
    const routine = await repo.locked(agent.ownerId, async () => {
      const own = await ready(req);
      const current = (await a37.crons(own.instanceId)).find(
        (row) => row.id === id,
      );
      if (!current)
        throw new HttpError(
          404,
          "not_found",
          "This routine couldn’t be found.",
        );
      if ("agent" in body || "profile" in body) {
        const next = { ...current, ...body };
        if (next.profile && next.agent && next.agent !== "hermes")
          throw new HttpError(
            400,
            "invalid_request",
            "Profiles work with Hermes. Clear the profile to choose another agent.",
          );
      }
      // Forward only supplied keys: schedule, timezone and enabled reset next_run upstream.
      return a37.patchCron(own.instanceId, id, body);
    });
    res.json({ routine });
  });
  app.delete("/api/routines/:id", async (req, res) => {
    const agent = await ready(req);
    const id = cronId.parse(req.params.id);
    const cron = (await a37.crons(agent.instanceId)).find(
      (row) => row.id === id,
    );
    const runs = await a37.cronRuns(agent.instanceId, id);
    await repo.archive(
      agent.ownerId,
      runs.map((row) => ({
        ...row,
        cronId: id,
        name: cron?.name || "Routine",
      })),
    );
    await a37.removeCron(agent.instanceId, id);
    res.json({ deleted: true });
  });
  app.post("/api/routines/:id/run", async (req, res) => {
    const agent = await ready(req);
    const result = await a37.runCron(
      agent.instanceId,
      cronId.parse(req.params.id),
    );
    await queue.send("reconcile", agent.ownerId);
    res.status(202).json(result);
  });
  app.post("/api/routines/sync", async (req, res) => {
    const agent = await ready(req);
    await queue.send("reconcile", agent.ownerId);
    res.status(202).json({ queued: true });
  });

  app.get("/api/apps", async (req, res) => {
    const agent = await ready(req);
    const query = z
      .object({
        search: z
          .string()
          .trim()
          .max(100)
          .refine(
            (value) => !value || value.length >= 3,
            "Enter at least three characters to search apps.",
          )
          .default(""),
        cursor: z.string().max(300).optional(),
      })
      .parse(req.query);
    res.json(await a37.toolkits(agent.instanceId, query.search, query.cursor));
  });
  app.get("/api/apps/connections", async (req, res) => {
    const agent = await ready(req);
    res.json(await a37.connections(agent.instanceId));
  });
  app.post("/api/apps/connect", async (req, res) => {
    const agent = await ready(req);
    const { toolkit } = z
      .object({
        toolkit: z
          .string()
          .min(1)
          .max(100)
          .regex(/^[a-z0-9_-]+$/i),
      })
      .parse(req.body);
    const result = await a37.connect(
      agent.instanceId,
      toolkit,
      `${config.demo && ["http://localhost:3000", "http://127.0.0.1:3000"].includes(req.headers.origin || "") ? req.headers.origin : config.webOrigin}/connected?toolkit=${encodeURIComponent(toolkit)}`,
    );
    res.json({
      redirectUrl: result.redirectUrl,
      connectedAccountId: result.connectedAccountId,
    });
  });
  app.delete("/api/apps/connections/:id", async (req, res) => {
    const agent = await ready(req);
    const id = z.string().min(1).max(160).parse(req.params.id);
    await a37.disconnect(agent.instanceId, id);
    res.json({ deleted: true });
  });
  app.get("/api/channels", async (req, res) => {
    const agent = await ready(req);
    const profile = await account(req);
    const assignments = await inkbox.request(
      `/imessage/assignments?agent_identity_id=${encodeURIComponent(agent.identityId!)}&limit=200`,
    );
    const imessage = (
      Array.isArray(assignments) ? assignments : assignments.assignments || []
    ).some(
      (row: any) =>
        row.remote_number === profile.phone && row.status === "active",
    );
    const sms = agent.sms
      ? await inkbox.request(
          `/phone/numbers/${encodeURIComponent(agent.sms.id)}`,
        )
      : null;
    res.json({
      web: "ready",
      email: agent.agentEmail ? "ready" : "pending",
      imessage: imessage ? "connected" : "connect_required",
      voice: "hosted",
      sms: sms ? { number: sms.number, status: sms.sms_status } : null,
    });
  });
  app.get("/api/calls", async (req, res) => {
    const agent = await ready(req);
    const result = await inkbox.request(
      `/phone/calls?agent_identity_id=${encodeURIComponent(agent.identityId!)}`,
    );
    res.json({
      calls: Array.isArray(result) ? result : result.calls || result.data || [],
    });
  });
  app.get("/api/calls/:id/transcript", async (req, res) => {
    const agent = await ready(req);
    const id = z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,120}$/)
      .parse(req.params.id);
    // The admin transcript endpoint does not honor an identity filter. Check membership first.
    const result = await inkbox.request(
      `/phone/calls?agent_identity_id=${encodeURIComponent(agent.identityId!)}&limit=200`,
    );
    const calls = Array.isArray(result)
      ? result
      : result.calls || result.data || [];
    if (!calls.some((call: any) => call.id === id))
      throw new HttpError(404, "not_found", "Call not found.");
    const segments = await inkbox.request(`/phone/calls/${id}/transcripts`);
    res.json({
      transcript: Array.isArray(segments)
        ? segments
            .map(
              (segment) =>
                `${segment.party === "remote" ? "You" : "Agent"}: ${segment.text}`,
            )
            .join("\n\n")
        : segments.transcript || "",
      segments,
    });
  });

  app.get("/api/operator", async (req, res) => {
    operator(req);
    const profiles = await repo.customers();
    const agents = await repo.agents();
    res.json({
      customers: profiles.map((profile) => ({
        profile,
        agent: agents.find((agent) => agent.ownerId === profile.id)
          ? publicAgent(agents.find((agent) => agent.ownerId === profile.id)!)
          : null,
      })),
    });
  });
  app.post("/api/operator/:ownerId/retry", async (req, res) => {
    operator(req);
    const ownerId = uuid.parse(req.params.ownerId);
    const agent = await repo.agent(ownerId);
    if (!agent) throw new HttpError(404, "not_found", "Customer not found.");
    await queue.send(
      agent.status === "deleting"
        ? "cleanup"
        : suspensionPending(agent)
          ? "reconcile"
          : "provision",
      ownerId,
    );
    res.status(202).json({ queued: true });
  });
  app.get("/api/operator/:ownerId/health", async (req, res) => {
    operator(req);
    const agent = await repo.agent(uuid.parse(req.params.ownerId));
    if (!agent?.instanceId)
      throw new HttpError(404, "not_found", "Computer not created yet.");
    res.json({
      instance: await a37.instance(agent.instanceId),
      usage: await a37.usage(agent.instanceId),
    });
  });
  app.put("/api/operator/:ownerId/budget", async (req, res) => {
    operator(req);
    const ownerId = uuid.parse(req.params.ownerId);
    const { micros } = z
      .object({ micros: z.number().int().min(0).max(100_000_000) })
      .parse(req.body);
    await repo.locked(ownerId, async () => {
      const agent = await repo.agent(ownerId);
      if (!agent?.instanceId)
        throw new HttpError(404, "not_found", "Computer not created yet.");
      await a37.budget(agent.instanceId, micros);
      agent.budgetMicros = micros;
      await repo.saveAgent(agent);
    });
    res.json({ saved: true });
  });
  app.put("/api/operator/:ownerId/suspension", async (req, res) => {
    operator(req);
    const ownerId = uuid.parse(req.params.ownerId);
    const { suspended } = z.object({ suspended: z.boolean() }).parse(req.body);
    await repo.locked(ownerId, async () => {
      const agent = await repo.agent(ownerId);
      if (!agent?.instanceId)
        throw new HttpError(404, "not_found", "Computer not created yet.");
      if (["deleting", "deleted"].includes(agent.status))
        throw new HttpError(
          409,
          "agent_deleting",
          "This companion is being deleted.",
        );
      agent.suspensionOperation = {
        id: randomUUID(),
        suspended,
        phase: "pending",
        requestedAt: date(),
      };
      await repo.saveAgent(agent);
      // The outbox can reconcile even if this request disappears during the provider call.
      await queue.send("reconcile", ownerId);
      await reconcileSuspensionLocked(dep, agent);
    });
    res.json({ saved: true });
  });

  app.use(
    (
      error: any,
      _req: Request,
      res: ExpressResponse,
      _next: express.NextFunction,
    ) => {
      if (res.headersSent) return res.end();
      if (error?.type === "entity.too.large")
        return res.status(413).json({
          error: {
            code: "payload_too_large",
            message:
              "This request is too large. Upload file pieces of at most 2 MiB.",
          },
        });
      if (error instanceof z.ZodError)
        return res.status(400).json({
          error: {
            code: "invalid_request",
            message: error.issues.map((issue) => issue.message).join(" "),
          },
        });
      if (error instanceof HttpError)
        return res
          .status(error.status >= 500 ? 502 : error.status)
          .json({ error: { code: error.code, message: error.message } });
      // Remote exec can carry credentials. Never print exceptions, scripts, or provider payloads.
      console.error("Request failed:", error?.constructor?.name || "Error");
      res.status(500).json({
        error: {
          code: "internal_error",
          message: "Something interrupted this request. Please try again.",
        },
      });
    },
  );
  return app;
}
