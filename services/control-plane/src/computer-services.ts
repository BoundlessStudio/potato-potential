import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Express, Request } from "express";
import type {
  Agent,
  ComputerLinkRequest,
  ComputerService,
  PublicComputerLink,
} from "@boundless/shared";
import type { Dependencies } from "./app";
import { computerBusy } from "./computer-maintenance";
import { accessPaused } from "./suspension";
import { HttpError, matchesHash, seal, unseal } from "./security";

// Includes provider-reserved ports and this image's private desktop/channel services.
export const protectedPorts = new Set([
  3737, 9119, 7681, 8080, 6080, 7890, 22022, 6901, 5900, 9222, 8765, 8443, 8644,
]);
export const COMPUTER_HELPER_VERSION = 1;
export const servicePort = z
  .number()
  .int()
  .min(1)
  .max(65535)
  .refine(
    (port) => !protectedPorts.has(port),
    "This port is managed by the application.",
  );
const serviceSchema = z
  .object({ port: servicePort, label: z.string().trim().min(1).max(64) })
  .strict();
const duration = z.union([
  z.literal(900),
  z.literal(3600),
  z.literal(86400),
  z.literal(604800),
]);
const fields = {
  id: z.uuid(),
  ...serviceSchema.shape,
  reason: z.string().trim().min(1).max(1000),
};
export const linkRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...fields,
      kind: z.literal("signed"),
      ttl_seconds: duration.default(3600),
    })
    .strict(),
  z.object({ ...fields, kind: z.literal("public") }).strict(),
]);
type Input = z.infer<typeof linkRequestSchema>;
const now = () => new Date().toISOString();
const key = (dep: Dependencies) =>
  dep.config.demo ? "a".repeat(64) : dep.config.encryptionKey;
export function publishable(
  agent: Agent | null,
): asserts agent is Agent & { instanceId: string } {
  if (!agent?.instanceId || agent.status !== "ready")
    throw new HttpError(409, "agent_not_ready", "The computer is not ready.");
  if (accessPaused(agent))
    throw new HttpError(
      403,
      "agent_suspended",
      "Your operator has paused this companion.",
    );
  if (computerBusy(agent))
    throw new HttpError(
      409,
      "computer_maintenance",
      "Wait for computer maintenance to finish.",
    );
}
export function publicLink(
  dep: Dependencies,
  row: ComputerLinkRequest,
): PublicComputerLink {
  const { urlBox, attempts: _attempts, notificationId: _note, ...safe } = row;
  const expired =
    row.kind === "signed" &&
    row.status === "approved" &&
    !!row.expiresAt &&
    Date.parse(row.expiresAt) <= Date.now();
  return {
    ...safe,
    status: expired ? "expired" : row.status,
    ...(row.status === "approved" && !expired && urlBox
      ? { url: unseal(urlBox, key(dep)) }
      : {}),
  };
}
async function registered(
  dep: Dependencies,
  agent: Agent & { instanceId: string },
  port: number,
) {
  const row = (await dep.repo.computerServices(agent.ownerId)).find(
    (row) => row.port === port && row.instanceId === agent.instanceId,
  );
  if (!row)
    throw new HttpError(
      404,
      "service_not_found",
      "Register this service first.",
    );
  return row;
}
async function notifyRequest(dep: Dependencies, row: ComputerLinkRequest) {
  if (row.source === "agent" && row.notificationId)
    await dep.repo.notify({
      id: row.notificationId,
      ownerId: row.ownerId,
      text: `${row.label} needs your approval for a ${row.kind === "signed" ? "signed preview" : "public"} link on port ${row.port}.`,
      createdAt: row.createdAt,
      target: { view: "computer", requestId: row.id },
    });
}
export async function createLinkRequestLocked(
  dep: Dependencies,
  agent: Agent,
  input: Input,
  source: "owner" | "agent",
) {
  publishable(agent);
  const prior = await dep.repo.computerRequest(agent.ownerId, input.id);
  if (prior) {
    if (
      prior.instanceId !== agent.instanceId ||
      prior.port !== input.port ||
      prior.kind !== input.kind ||
      prior.label !== input.label ||
      prior.reason !== input.reason ||
      prior.ttlSeconds !==
        (input.kind === "signed" ? input.ttl_seconds : undefined) ||
      prior.source !== source
    )
      throw new HttpError(
        409,
        "request_conflict",
        "Request id already used for different details.",
      );
    await notifyRequest(dep, prior);
    return prior;
  }
  const requests = (await dep.repo.computerRequests(agent.ownerId)).filter(
    (row) => row.instanceId === agent.instanceId,
  );
  if (
    requests.some(
      (row) =>
        row.port === input.port &&
        row.kind === input.kind &&
        ["pending", "publishing"].includes(row.status),
    )
  )
    throw new HttpError(
      409,
      "request_pending",
      "This service already has a request pending. Check its status.",
    );
  if (
    requests.filter((row) => ["pending", "publishing"].includes(row.status))
      .length >= 50
  )
    throw new HttpError(
      409,
      "request_limit",
      "Review existing requests before adding more.",
    );
  const services = await dep.repo.computerServices(agent.ownerId);
  const service = services.find((row) => row.port === input.port);
  if (input.kind === "public" && service?.publicRemoval)
    throw new HttpError(
      409,
      "public_removal_pending",
      "Finish disabling the public link first.",
    );
  if (!service) {
    if (source === "owner")
      throw new HttpError(
        404,
        "service_not_found",
        "Register this service first.",
      );
    await dep.repo.saveComputerService({
      ownerId: agent.ownerId,
      instanceId: agent.instanceId,
      port: input.port,
      label: input.label,
      state: "unknown",
      createdAt: now(),
    });
  } else if (service.instanceId !== agent.instanceId)
    throw new HttpError(
      409,
      "service_conflict",
      "Service belongs to another computer.",
    );
  const row: ComputerLinkRequest = {
    id: input.id,
    ownerId: agent.ownerId,
    instanceId: agent.instanceId,
    port: input.port,
    label: input.label,
    reason: input.reason,
    kind: input.kind,
    ...(input.kind === "signed" ? { ttlSeconds: input.ttl_seconds } : {}),
    source,
    status: source === "agent" ? "pending" : "publishing",
    createdAt: now(),
    ...(source === "owner"
      ? { decidedAt: now() }
      : { notificationId: randomUUID() }),
    attempts: 0,
  };
  await dep.repo.saveComputerRequest(row);
  await notifyRequest(dep, row);
  return row;
}
async function checkLocked(
  dep: Dependencies,
  agent: Agent & { instanceId: string },
  port: number,
) {
  const service = await registered(dep, agent, port);
  const running = await dep.a37.checkService(agent.instanceId, port);
  service.state = running ? "running" : "not_running";
  service.checkedAt = now();
  await dep.repo.saveComputerService(service);
  return service;
}
async function schedule(dep: Dependencies, ownerId: string) {
  // Intent is already persisted; a dropped dispatch is recovered by the maintenance sweep.
  await dep.queue.send("reconcile", ownerId);
}

/** Runs before ordinary cron reconciliation, while holding the existing customer lease. */
export async function reconcileComputerLinksLocked(
  dep: Dependencies,
  ownerId: string,
  removalsOnly = false,
): Promise<boolean> {
  const agent = await dep.repo.agent(ownerId);
  if (!agent?.instanceId || agent.status !== "ready") return false;
  const services = (await dep.repo.computerServices(ownerId)).filter(
    (row) => row.instanceId === agent.instanceId,
  );
  const requests = (await dep.repo.computerRequests(ownerId)).filter(
    (row) => row.instanceId === agent.instanceId,
  );
  const removal = services.find((row) => row.publicRemoval?.phase === "queued");
  if (removal) {
    servicePort.parse(removal.port);
    const op = removal.publicRemoval!;
    op.attempts++;
    await dep.repo.saveComputerService(removal);
    try {
      try {
        await dep.a37.removePublicPort(agent.instanceId, removal.port);
      } catch (error) {
        if (!(error instanceof HttpError && error.status === 404)) {
          if (
            (await dep.a37.publicPorts(agent.instanceId)).some(
              (row) => row.port === removal.port,
            )
          )
            throw error;
        }
      }
      for (const row of requests.filter(
        (row) =>
          row.port === removal.port &&
          row.kind === "public" &&
          row.status === "approved",
      )) {
        row.status = "revoked";
        delete row.urlBox;
        await dep.repo.saveComputerRequest(row);
      }
      delete removal.publicRemoval;
      await dep.repo.saveComputerService(removal);
    } catch {
      if (op.attempts >= 5) {
        op.phase = "failed";
        op.error = "Couldn’t disable the public link. Retry disabling it.";
      }
      await dep.repo.saveComputerService(removal);
    }
    return (
      services.some((row) => row.publicRemoval?.phase === "queued") ||
      requests.some((row) => row.status === "publishing")
    );
  }
  if (removalsOnly || accessPaused(agent) || computerBusy(agent)) return false;
  const row = requests.find((row) => row.status === "publishing");
  if (!row) return false;
  servicePort.parse(row.port);
  row.attempts++;
  await dep.repo.saveComputerRequest(row);
  try {
    let url: string;
    // A process may exit after the create succeeded but its reply was lost.
    const existing =
      row.kind === "public"
        ? (await dep.a37.publicPorts(agent.instanceId)).find(
            (entry) => entry.port === row.port,
          )
        : undefined;
    if (
      !existing &&
      (
        await checkLocked(
          dep,
          agent as Agent & { instanceId: string },
          row.port,
        )
      ).state !== "running"
    )
      throw new HttpError(
        409,
        "service_not_running",
        "Start the service before creating a link.",
      );
    if (row.kind === "signed") {
      const signed = await dep.a37.signedUrl(
        agent.instanceId,
        row.port,
        row.ttlSeconds!,
      );
      url = signed.url;
      row.expiresAt = new Date(signed.expires_at * 1000).toISOString();
    } else {
      let entry = existing;
      if (!entry) {
        try {
          entry = await dep.a37.createPublicPort(
            agent.instanceId,
            row.port,
            row.label,
          );
        } catch (error) {
          // A successful create may have lost its reply, including on a previous worker.
          entry = (await dep.a37.publicPorts(agent.instanceId)).find(
            (entry) => entry.port === row.port,
          );
          if (!entry) throw error;
        }
      }
      url = entry.url;
    }
    row.urlBox = seal(url, key(dep));
    row.status = "approved";
    delete row.error;
  } catch (error) {
    const retryable =
      !(error instanceof HttpError) ||
      error.status >= 500 ||
      error.status === 429;
    if (!retryable || row.attempts >= 5) {
      row.status = "failed";
      row.error =
        error instanceof HttpError && error.code === "service_not_running"
          ? error.message
          : "Couldn’t create the link. Review the service and retry approval.";
    }
  }
  await dep.repo.saveComputerRequest(row);
  return requests.some((request) => request.status === "publishing");
}
export async function computerLinkWorkPending(
  dep: Dependencies,
  ownerId: string,
) {
  const agent = await dep.repo.agent(ownerId);
  if (!agent?.instanceId || agent.status !== "ready") return false;
  return (
    (await dep.repo.computerServices(ownerId)).some(
      (row) =>
        row.instanceId === agent.instanceId &&
        row.publicRemoval?.phase === "queued",
    ) ||
    (!accessPaused(agent) &&
      !computerBusy(agent) &&
      (await dep.repo.computerRequests(ownerId)).some(
        (row) =>
          row.instanceId === agent.instanceId && row.status === "publishing",
      ))
  );
}

export function registerAgentComputerRoutes(app: Express, dep: Dependencies) {
  app.post("/api/agent/computer", async (req, res) => {
    const { instance_id, command, ...payload } = z
      .object({
        instance_id: z.string().regex(/^[a-z0-9]{10}$/),
        command: z.enum(["request", "status"]),
      })
      .passthrough()
      .parse(req.body);
    const credential = (req.headers.authorization || "").replace(
      /^Bearer\s+/i,
      "",
    );
    const found = await dep.repo.byInstance(instance_id);
    if (
      !found ||
      found.status !== "ready" ||
      accessPaused(found) ||
      !matchesHash(credential, found.callbackHash)
    )
      throw new HttpError(403, "forbidden", "Invalid computer credential.");
    if (command === "status") {
      const query = z
        .object({ id: z.uuid().optional() })
        .strict()
        .parse(payload);
      const rows = query.id
        ? [await dep.repo.computerRequest(found.ownerId, query.id)]
        : await dep.repo.computerRequests(found.ownerId);
      if (query.id && (!rows[0] || rows[0].instanceId !== instance_id))
        throw new HttpError(404, "request_not_found", "Request not found.");
      res.json({
        requests: rows
          .filter(
            (row): row is ComputerLinkRequest =>
              !!row && row.instanceId === instance_id,
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 100)
          .map((row) => publicLink(dep, row)),
      });
      return;
    }
    const input = linkRequestSchema.parse(payload);
    const row = await dep.repo.locked(found.ownerId, async () => {
      const current = await dep.repo.agent(found.ownerId);
      if (
        !current ||
        current.instanceId !== instance_id ||
        !matchesHash(credential, current.callbackHash)
      )
        throw new HttpError(403, "forbidden", "Invalid computer credential.");
      return createLinkRequestLocked(dep, current, input, "agent");
    });
    res.status(202).json({ request: publicLink(dep, row) });
  });
}
export function registerComputerRoutes(
  app: Express,
  dep: Dependencies,
  owner: (req: Request) => string,
  account: (req: Request) => Promise<unknown>,
) {
  const own = async (req: Request) => {
    await account(req);
    const agent = await dep.repo.agent(owner(req));
    if (!agent?.instanceId || agent.status !== "ready")
      throw new HttpError(409, "agent_not_ready", "The computer is not ready.");
    return agent as Agent & { instanceId: string };
  };
  const read = async (req: Request) => {
    const agent = await own(req);
    const requests = (await dep.repo.computerRequests(agent.ownerId)).filter(
      (row) => row.instanceId === agent.instanceId,
    );
    return { agent, requests };
  };
  app.get("/api/computer/services", async (req, res) => {
    const { agent, requests } = await read(req);
    res.json({
      services: (await dep.repo.computerServices(agent.ownerId)).filter(
        (row) => row.instanceId === agent.instanceId,
      ),
      requests: requests
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((row) => publicLink(dep, row)),
      publicationAllowed: !accessPaused(agent) && !computerBusy(agent),
    });
  });
  app.post("/api/computer/services", async (req, res) => {
    const input = serviceSchema.parse(req.body);
    const agent = await own(req);
    const row = await dep.repo.locked(agent.ownerId, async () => {
      const fresh = await own(req);
      publishable(fresh);
      const existing = (await dep.repo.computerServices(agent.ownerId)).find(
        (row) => row.port === input.port,
      );
      if (existing) return existing;
      const service: ComputerService = {
        ...input,
        ownerId: fresh.ownerId,
        instanceId: fresh.instanceId,
        createdAt: now(),
        state: "unknown",
      };
      await dep.repo.saveComputerService(service);
      return service;
    });
    res.status(201).json({ service: row });
  });
  app.post("/api/computer/services/:port/check", async (req, res) => {
    const port = servicePort.parse(Number(req.params.port));
    const agent = await own(req);
    const service = await dep.repo.locked(agent.ownerId, async () => {
      const fresh = await own(req);
      publishable(fresh);
      return checkLocked(dep, fresh, port);
    });
    res.json({ service });
  });
  app.get("/api/computer/metrics", async (req, res) => {
    const agent = await own(req);
    try {
      res.json(await dep.a37.metrics(agent.instanceId));
    } catch {
      throw new HttpError(
        503,
        "metrics_unavailable",
        "Resource metrics are temporarily unavailable. Retry shortly.",
      );
    }
  });
  app.get("/api/computer/requests", async (req, res) => {
    const { requests } = await read(req);
    res.json({ requests: requests.map((row) => publicLink(dep, row)) });
  });
  app.post("/api/computer/requests", async (req, res) => {
    const input = linkRequestSchema.parse(req.body);
    const agent = await own(req);
    const row = await dep.repo.locked(agent.ownerId, async () =>
      createLinkRequestLocked(dep, await own(req), input, "owner"),
    );
    if (row.status === "publishing") await schedule(dep, agent.ownerId);
    res.status(202).json({ request: publicLink(dep, row) });
  });
  for (const action of ["approve", "reject"] as const)
    app.post(`/api/computer/requests/:id/${action}`, async (req, res) => {
      z.object({})
        .strict()
        .parse(req.body || {});
      const id = z.uuid().parse(req.params.id);
      const agent = await own(req);
      const row = await dep.repo.locked(agent.ownerId, async () => {
        const fresh = await own(req);
        const request = await dep.repo.computerRequest(fresh.ownerId, id);
        if (!request || request.instanceId !== fresh.instanceId)
          throw new HttpError(404, "request_not_found", "Request not found.");
        if (action === "approve") {
          publishable(fresh);
          const service = await registered(dep, fresh, request.port);
          if (request.kind === "public" && service.publicRemoval)
            throw new HttpError(
              409,
              "public_removal_pending",
              "Finish disabling the public link first.",
            );
          if (["approved", "publishing"].includes(request.status))
            return request;
          if (!["pending", "failed"].includes(request.status))
            throw new HttpError(
              409,
              "request_closed",
              "Create a new request for another link.",
            );
          if (
            (await dep.repo.computerRequests(fresh.ownerId)).some(
              (other) =>
                other.id !== id &&
                other.port === request.port &&
                other.kind === request.kind &&
                ["pending", "publishing"].includes(other.status),
            )
          )
            throw new HttpError(
              409,
              "request_pending",
              "Another request is pending for this service.",
            );
          if (
            request.status === "failed" &&
            (await dep.repo.computerRequests(fresh.ownerId)).filter((other) =>
              ["pending", "publishing"].includes(other.status),
            ).length >= 50
          )
            throw new HttpError(
              409,
              "request_limit",
              "Review existing requests before adding more.",
            );
          request.status = "publishing";
          request.attempts = 0;
          delete request.error;
        } else {
          if (request.status === "rejected") return request;
          if (!["pending", "failed"].includes(request.status))
            throw new HttpError(
              409,
              "request_closed",
              "This request has already been decided.",
            );
          request.status = "rejected";
          delete request.error;
        }
        request.decidedAt = now();
        await dep.repo.saveComputerRequest(request);
        return request;
      });
      if (row.status === "publishing") await schedule(dep, agent.ownerId);
      res.json({ request: publicLink(dep, row) });
    });
  app.delete("/api/computer/services/:port/public-link", async (req, res) => {
    const port = servicePort.parse(Number(req.params.port));
    const agent = await own(req);
    await dep.repo.locked(agent.ownerId, async () => {
      const fresh = await own(req);
      const service = await registered(dep, fresh, port);
      if (service.publicRemoval?.phase === "queued") return;
      if (
        !(await dep.repo.computerRequests(fresh.ownerId)).some(
          (row) =>
            row.instanceId === fresh.instanceId &&
            row.port === port &&
            row.kind === "public" &&
            row.status === "approved",
        )
      )
        throw new HttpError(
          404,
          "public_link_not_found",
          "No public link to disable.",
        );
      if (
        (await dep.repo.computerRequests(fresh.ownerId)).some(
          (row) =>
            row.port === port &&
            row.kind === "public" &&
            row.status === "publishing",
        )
      )
        throw new HttpError(
          409,
          "computer_busy",
          "Wait for publishing to finish.",
        );
      service.publicRemoval = { phase: "queued", attempts: 0 };
      await dep.repo.saveComputerService(service);
    });
    await schedule(dep, agent.ownerId);
    res.status(202).json({ queued: true });
  });
}
