import express, {
  type Request,
  type Response as ExpressResponse,
} from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import {
  isFiredOneTime,
  itemSchema,
  parseSse,
  profileSchema,
  publicAgent,
  type Agent,
  type CronRun,
  type Profile,
  type WorkspaceItem,
} from "@boundless/shared";
import type { Config } from "./config";
import type { Repository } from "./repository";
import type { AgentProvider, InkboxProvider } from "./providers";
import { Lifecycle } from "./lifecycle";
import { DEMO_EMAIL, DEMO_NEW_USER, DEMO_USER } from "./demo";
import { HttpError, hash, matchesHash, token, seal, unseal } from "./security";
import { boundedSse } from "./streams";
import { computerBusy, screenForTemplate } from "./computer-maintenance";
import {
  accessPaused,
  suspensionPending,
  reconcileSuspensionLocked,
} from "./suspension";
import {
  requireInvitationEmail,
  sendInvitationEmail,
  type InvitationEmail,
} from "./invitations";

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
};
type Actor = { id: string; email: string; operator: boolean };
type AuthRequest = Request & { actor: Actor };
const actor = (req: Request) => (req as AuthRequest).actor;
const uuid = z.uuid();
const remoteId = z.string().regex(/^[a-f0-9]{32}$/);
const cronId = z.string().regex(/^[a-f0-9]{12}$/);
const date = () => new Date().toISOString();
const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
const betaLease = (email: string) => {
  const value = hash(`beta:${email}`);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
};

export async function reconcile(dep: Dependencies, ownerId: string) {
  return dep.repo.locked(ownerId, () => reconcileLocked(dep, ownerId));
}

// The job worker already holds the customer lease through job completion.
export async function reconcileLocked(dep: Dependencies, ownerId: string) {
  const agent = await dep.repo.agent(ownerId);
  if (agent && suspensionPending(agent))
    await reconcileSuspensionLocked(dep, agent);
  if (!agent?.instanceId || agent.status !== "ready") return;
  if (accessPaused(agent) || computerBusy(agent)) return;
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
    if (cron.agent !== "hermes")
      await dep.a37.patchCron(agent.instanceId, cron.id, { agent: "hermes" });
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
  app.use(express.json({ limit: "96kb" }));
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

  app.post("/api/agent/workspace", async (req, res) => {
    const body = z
      .object({
        instance_id: z.string().regex(/^[a-z0-9]{10}$/),
        event_id: uuid,
        command: z.enum(["list", "save", "notify"]),
        item: itemSchema.optional(),
        text: z.string().max(10000).optional(),
        session_id: remoteId.optional(),
      })
      .parse(req.body);
    const agent = await repo.byInstance(body.instance_id);
    const credential =
      req.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
    if (
      !agent ||
      agent.status !== "ready" ||
      accessPaused(agent) ||
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
    if (!body.item)
      throw new HttpError(400, "invalid_request", "An item is required.");
    const previous = body.item.id
      ? await repo.item(agent.ownerId, body.item.id)
      : null;
    const item: WorkspaceItem = {
      ...body.item,
      id: body.item.id || body.event_id,
      ownerId: agent.ownerId,
      createdAt: previous?.createdAt || date(),
      updatedAt: date(),
    };
    await repo.saveItem(item);
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
        "Your companion’s computer is restarting. Try again when it is ready.",
      );
    return agent as Agent & { instanceId: string };
  }
  function operator(req: Request) {
    if (!actor(req).operator)
      throw new HttpError(403, "forbidden", "Operator access is required.");
  }

  app.get("/api/me", async (req, res) => {
    const profile = await repo.profile(actor(req).id);
    let agent = await repo.agent(actor(req).id);
    if (agent?.status === "deleting")
      await queue.send("cleanup", actor(req).id).catch(() => {});
    if (agent && suspensionPending(agent))
      await queue.send("reconcile", actor(req).id).catch(() => {});
    if (
      agent &&
      (["new", "provisioning", "failed", "deleting"].includes(agent.status) ||
        computerBusy(agent))
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
    res.json({ item });
  });
  app.delete("/api/items/:id", async (req, res) => {
    await account(req);
    await repo.deleteItem(actor(req).id, uuid.parse(req.params.id));
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
      if (!indexed.some((item) => item.id === row.id)) {
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
    res.json({ sessions: await repo.conversations(actor(req).id) });
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
        input: z.string().trim().min(1).max(30000),
        takeover: z.boolean().optional(),
        notificationId: uuid.optional(),
      })
      .parse(req.body);
    let input = body.input;
    if (body.takeover)
      input = `App context (from Boundless): Your person used the computer and returned control. Inspect the browser before continuing.\nEnd of app context.\n\n${input}`;
    if (body.notificationId) {
      const note = (await repo.notifications(agent.ownerId)).find(
        (row) => row.id === body.notificationId,
      );
      if (!note)
        throw new HttpError(404, "not_found", "Notification not found.");
      input = `App context (from Boundless): Your person is replying to this check-in: ${JSON.stringify(note.text)}\nEnd of app context.\n\n${input}`;
    }
    const upstream = await repo.locked(agent.ownerId, async () => {
      const current = await ready(req);
      return a37.responses(current.instanceId, {
        input,
        session_id: current.mainSessionId,
        stream: true,
        agent: "hermes",
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
  app.get("/api/computer/maintenance", async (req, res) => {
    operator(req);
    const agent = await ready(req, true);
    if (computerBusy(agent))
      await queue.recover?.(agent.ownerId).catch(() => {});
    const instance = await a37.instance(agent.instanceId);
    const {
      bootBefore: _boot,
      acknowledged: _ack,
      ...operation
    } = agent.computerOperation || {};
    res.json({
      installedTemplate: instance.template,
      availableTemplate: config.desktopTemplate,
      updateAvailable: instance.template !== config.desktopTemplate,
      instanceStatus: instance.status,
      screen:
        agent.computerScreen || screenForTemplate(instance.template || ""),
      operation: agent.computerOperation ? operation : null,
    });
  });
  app.post("/api/computer/maintenance", async (req, res) => {
    operator(req);
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
      if (computerBusy(agent)) {
        if (agent.computerOperation?.action !== action)
          throw new HttpError(
            409,
            "computer_busy",
            "A computer operation is already in progress.",
          );
        return;
      }
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
    const file = z.enum(["user", "memory"]).parse(req.params.file);
    const body = z
      .object({ content: z.string().max(60000), modified: z.number().finite() })
      .parse(req.body);
    await a37.writeFile(
      agent.instanceId,
      `~/.hermes/memories/${file === "user" ? "USER" : "MEMORY"}.md`,
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
      prompt: `${body.prompt}\nIf there is useful news, notify the owner via Inkbox and mirror it with node ~/.boundless/workspace.mjs notify.`,
      schedule,
      timezone: profile.timezone,
      agent: "hermes",
    });
    res.status(201).json({ routine: cron });
  });
  app.patch("/api/routines/:id", async (req, res) => {
    const agent = await ready(req);
    const body = z.object({ enabled: z.boolean() }).parse(req.body);
    res.json({
      routine: await a37.patchCron(
        agent.instanceId,
        cronId.parse(req.params.id),
        body,
      ),
    });
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
      invitations: await repo.invitations(),
    });
  });
  app.post("/api/operator/invitations", async (req, res) => {
    operator(req);
    const { email } = z.object({ email: z.email() }).parse(req.body);
    const invitation = token();
    await repo.createInvitation(
      email,
      hash(invitation),
      new Date(Date.now() + 7 * 86400000).toISOString(),
    );
    res
      .status(201)
      .json({ url: `${config.webOrigin}/?invite=${invitation}`, email });
  });
  app.get("/api/operator/invitations", async (req, res) => {
    operator(req);
    const invitations = await repo.invitations();
    const betaRequests = await repo.betaRequests();
    const acceptedOwners = [
      ...new Set(
        invitations.map((row) => row.used_by || row.usedBy).filter(Boolean),
      ),
    ];
    const enrolledOwners = new Set(
      (
        await Promise.all(
          acceptedOwners.map(async (id) =>
            (await repo.profile(id)) ? id : null,
          ),
        )
      ).filter(Boolean),
    );
    const accountEmails = new Set<string>(),
      accountIds = new Set<string>();
    if (invitations.length || betaRequests.length) {
      if (config.demo) {
        for (const profile of await repo.customers()) {
          accountEmails.add(profile.email.toLowerCase());
          accountIds.add(profile.id);
        }
      } else {
        // Only server-side Auth records establish whether an account currently exists.
        for (let page = 1; ; page++) {
          const { data, error } = await authClient!.auth.admin.listUsers({
            page,
            perPage: 1000,
          });
          if (error)
            throw new HttpError(
              502,
              "account_lookup_failed",
              "Couldn’t check invited user accounts. Please refresh.",
            );
          for (const user of data.users) {
            if (user.email) accountEmails.add(user.email.toLowerCase());
            accountIds.add(user.id);
          }
          if (data.users.length < 1000) break;
        }
      }
    }
    const people = new Map<
      string,
      {
        email: string;
        accepted: boolean;
        enrolled: boolean;
        accountExists: boolean;
        expiresAt: string;
      }
    >();
    for (const invitation of invitations) {
      const email = invitation.email.toLowerCase();
      const usedBy = invitation.used_by || invitation.usedBy;
      const expiresAt = invitation.expires_at || invitation.expiresAt;
      const existing = people.get(email);
      people.set(email, {
        email,
        accepted: Boolean(usedBy) || Boolean(existing?.accepted),
        enrolled: enrolledOwners.has(usedBy) || Boolean(existing?.enrolled),
        accountExists:
          accountEmails.has(email) ||
          accountIds.has(usedBy) ||
          Boolean(existing?.accountExists),
        expiresAt:
          !existing || Date.parse(expiresAt) > Date.parse(existing.expiresAt)
            ? expiresAt
            : existing.expiresAt,
      });
    }
    res.json({
      invitations: await Promise.all(
        [
          ...new Set([
            ...betaRequests.map((row) => row.email),
            ...people.keys(),
          ]),
        ].map(async (email) => {
          const person = people.get(email),
            request = betaRequests.find((row) => row.email === email);
          return {
            email,
            accountExists: person?.accountExists || accountEmails.has(email),
            // A new Auth account with this email is not the deleted customer's enrollment.
            canReinvite: Boolean(person?.accepted && !person.enrolled),
            requestedAt: request?.createdAt,
            approvedAt: request?.approvedAt,
            sentAt: request?.sentAt,
            status:
              person?.accepted && !(await repo.pendingInvitation(email))
                ? "accepted"
                : request?.approvedAt && !request.sentAt
                  ? "approved"
                  : !person
                    ? "awaiting_review"
                    : Date.parse(person.expiresAt) <= Date.now()
                      ? "expired"
                      : "pending",
          };
        }),
      ),
    });
  });
  app.post("/api/operator/beta", async (req, res) => {
    operator(req);
    const { email } = z.object({ email: emailSchema }).parse(req.body);
    await repo.addBetaRequest(email);
    res.status(201).json({ email });
  });
  app.post("/api/operator/invitations/send", async (req, res) => {
    operator(req);
    const { email } = z.object({ email: emailSchema }).parse(req.body);
    requireInvitationEmail(config);
    await repo.locked(betaLease(email), async () => {
      await repo.addBetaRequest(email);
      const request = (await repo.betaRequests()).find(
        (row) => row.email === email,
      )!;
      const previous = (await repo.invitations()).filter(
        (row) => row.email === email,
      );
      const acceptedOwners = previous
        .map((row) => row.used_by || row.usedBy)
        .filter(Boolean);
      const activeCustomers = await Promise.all(
        acceptedOwners.map((id) => repo.profile(id)),
      );
      if (activeCustomers.some(Boolean))
        throw new HttpError(
          409,
          "invitation_accepted",
          "This email has already accepted an invitation. They can use the sign-in page.",
        );
      const key = config.demo ? "a".repeat(64) : config.encryptionKey;
      const consumed =
        !!request.invitationBox &&
        previous.some(
          (row) =>
            row.token_hash === hash(unseal(request.invitationBox!, key)) &&
            (row.used_by || row.usedBy),
        );
      if (
        request.sentAt &&
        !consumed &&
        Date.parse(request.expiresAt || "") > Date.now()
      )
        return;
      if (consumed) {
        // A new approval creates a new token; historical tokens remain consumed.
        request.invitationBox = undefined;
        request.approvedAt = undefined;
        request.approvedBy = undefined;
      }
      request.approvedAt ||= date();
      request.approvedBy ||= actor(req).id;
      if (
        !request.invitationBox ||
        Date.parse(request.expiresAt || "") <= Date.now()
      ) {
        request.invitationBox = seal(token(), key);
        request.expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
        request.sentAt = undefined;
      }
      // Persist approval and the retry credential before any delivery.
      await repo.saveBetaRequest(request);
      const invitation = unseal(request.invitationBox, key),
        digest = hash(invitation);
      await repo.createInvitation(email, digest, request.expiresAt!);
      const url = `${config.webOrigin}/signin?invite=${invitation}&email=${encodeURIComponent(email)}`;
      await (
        dep.invitationEmail || ((input) => sendInvitationEmail(config, input))
      )({ email, url, digest });
      request.sentAt = date();
      await repo.saveBetaRequest(request);
    });
    res.status(201).json({ email, sent: !config.demo, demo: config.demo });
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
