import type { Express, Request } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Agent } from "@boundless/shared";
import type { Dependencies } from "./app";
import { ProviderError } from "./providers";
import { HttpError } from "./security";
import { accessPaused } from "./suspension";
import {
  bootCommand,
  computerBusy,
  computerOperationPending,
  screenCommand,
} from "./computer-maintenance";

export const backupCooldown = 15 * 60_000;
const backupId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const pending = (agent: Agent) => computerOperationPending(agent);

async function idle(dep: Dependencies, agent: Agent & { instanceId: string }) {
  const sessions = await dep.a37.sessions(agent.instanceId);
  const ids = new Set<string>(sessions.map((row) => row.id));
  if (agent.mainSessionId) ids.add(agent.mainSessionId);
  for (const id of ids) {
    const session = await dep.a37
      .session(agent.instanceId, id)
      .catch((error) => {
        if (error instanceof HttpError && error.status === 404) return null;
        throw error;
      });
    if (session?.active_response_id)
      throw new HttpError(
        409,
        "agent_busy",
        "Your companion is working. Finish or stop their work before restoring.",
      );
  }
}

export async function maintainBackupLocked(
  dep: Dependencies,
  agent: Agent & { instanceId: string },
): Promise<boolean> {
  const op = agent.computerOperation!;
  const save = () => dep.repo.saveAgent(agent);
  const fail = async (error: string) => {
    op.phase = "failed";
    op.error = error;
    op.finishedAt = new Date().toISOString();
    await save();
    return false;
  };
  if (accessPaused(agent))
    return fail("The computer is paused. Resume it before trying again.");
  if (op.phase === "queued") {
    if (op.action === "backup") {
      const backups = await dep.a37.backups(agent.instanceId);
      op.backupsBefore = backups.map((row) => row.id);
    } else {
      if (
        !(await dep.a37.backups(agent.instanceId)).some(
          (row) => row.id === op.backupId,
        )
      )
        return fail(
          "That checkpoint is no longer available. Choose another one.",
        );
      const instance = await dep.a37.instance(agent.instanceId);
      if (["sleeping", "stopped"].includes(instance.status))
        await dep.a37.start(agent.instanceId);
      else if (instance.status !== "running")
        return fail("The computer is still getting ready. Try again shortly.");
      if (!(await dep.a37.healthy(agent.instanceId))) return true;
      await idle(dep, agent);
      const boot = await dep.a37.exec(agent.instanceId, bootCommand);
      if (boot.exit_code || !/^[0-9.:]+$/.test(boot.stdout.trim()))
        return fail("Couldn’t check the computer before restoring. Try again.");
      op.bootBefore = boot.stdout.trim();
    }
    op.startedAt = new Date().toISOString();
    op.phase = "applying";
    if (op.action === "backup") agent.backupAttemptedAt = op.startedAt;
    await save(); // Persist ownership before either long-running provider call.
    try {
      if (op.action === "backup")
        op.backupId = (await dep.a37.backup(agent.instanceId)).id;
      else await dep.a37.restore(agent.instanceId, op.backupId!);
      op.acknowledged = true;
    } catch (error) {
      // A timeout does not cancel the operation. Never blindly issue it again.
      if (
        error instanceof ProviderError &&
        [400, 401, 403, 404, 409, 422, 429].includes(error.status)
      ) {
        op.rejected = true;
        return fail(
          error.status === 429
            ? "A manual backup can be started once every 15 minutes. Please try later."
            : "The computer couldn’t start this operation. Refresh its status and try again.",
        );
      }
      op.acknowledged = false;
    }
    op.phase = "checking";
    await save();
    return true;
  }
  op.phase = "checking";
  await save();
  if (
    Date.now() - Date.parse(op.checkingAt || op.startedAt || op.requestedAt) >
    20 * 60_000
  )
    return fail(
      op.action === "backup"
        ? "Couldn’t confirm the backup. It may still appear here; refresh before trying again."
        : "Couldn’t finish checking the restored computer. Ask your operator to help before using it.",
    );
  if (op.action === "backup") {
    const backups = await dep.a37.backups(agent.instanceId);
    const result =
      backups.find((row) => row.id === op.backupId) ||
      backups.find(
        (row) =>
          row.kind === "manual" &&
          !op.backupsBefore?.includes(row.id) &&
          row.created >= Math.floor(Date.parse(op.startedAt!) / 1000),
      );
    if (!result) return true;
    op.backupId = result.id;
  } else {
    const instance = await dep.a37.instance(agent.instanceId);
    if (instance.status === "updating" || instance.status === "waking")
      return true;
    if (instance.status !== "running")
      return fail(
        "The restore left the computer unavailable. Your checkpoints are still safe; ask your operator to help.",
      );
    if (!(await dep.a37.healthy(agent.instanceId))) return true;
    const boot = await dep.a37.exec(agent.instanceId, bootCommand);
    if (
      boot.exit_code ||
      !/^[0-9.:]+$/.test(boot.stdout.trim()) ||
      (!op.acknowledged && boot.stdout.trim() === op.bootBefore)
    )
      return true;
    op.restored = true;
    await save();
    const profile = await dep.repo.profile(agent.ownerId);
    if (!profile)
      return fail(
        "Your workspace could not be found. Ask your operator to help.",
      );
    await dep.lifecycle.restoreConfiguration(profile, agent);
    const sessions = await dep.a37.sessions(agent.instanceId);
    if (!sessions.some((row) => row.id === agent.mainSessionId))
      agent.mainSessionId = randomUUID().replaceAll("-", "");
    for (const service of await dep.repo.computerServices(agent.ownerId)) {
      if (service.instanceId === agent.instanceId)
        await dep.repo.saveComputerService({
          ...service,
          state: "unknown",
          checkedAt: undefined,
        });
    }
    const screen = await dep.a37.exec(agent.instanceId, screenCommand);
    const dimensions = screen.stdout.match(/dimensions:\s+(\d+)x(\d+)/);
    if (!screen.exit_code && dimensions)
      agent.computerScreen = { width: +dimensions[1], height: +dimensions[2] };
    op.reconciled = true;
  }
  op.phase = "completed";
  op.finishedAt = new Date().toISOString();
  op.error = undefined;
  await save();
  return false;
}

export function registerBackupRoutes(
  app: Express,
  dep: Dependencies,
  owner: (req: Request) => string,
  account: (req: Request) => Promise<unknown>,
) {
  async function own(req: Request, mutating = false) {
    await account(req);
    const agent = await dep.repo.agent(owner(req));
    if (!agent?.instanceId || agent.status !== "ready")
      throw new HttpError(
        409,
        "agent_not_ready",
        "Finish setting up your companion first.",
      );
    if (mutating && accessPaused(agent))
      throw new HttpError(
        403,
        "agent_suspended",
        "Your operator has paused this computer.",
      );
    return agent as Agent & { instanceId: string };
  }
  app.get("/api/computer/backups", async (req, res) => {
    const agent = await own(req);
    if (pending(agent)) {
      await dep.queue.send("maintenance", agent.ownerId).catch(() => {});
      await dep.queue.recover?.(agent.ownerId).catch(() => {});
    }
    const backups = await dep.a37.backups(agent.instanceId);
    const last = Math.max(
      Date.parse(agent.backupAttemptedAt || "") || 0,
      ...backups
        .filter((row) => row.kind === "manual")
        .map((row) => row.created * 1000),
    );
    const op = agent.computerOperation;
    res.json({
      backups,
      operation: op
        ? {
            id: op.id,
            action: op.action,
            phase: op.phase,
            backupId: op.backupId,
            requestedAt: op.requestedAt,
            finishedAt: op.finishedAt,
            error: op.error,
            needsReconnect:
              op.action === "restore" &&
              !!op.startedAt &&
              !op.rejected &&
              !op.reconciled,
          }
        : null,
      canManage: !accessPaused(agent),
      cooldownUntil: last
        ? new Date(last + backupCooldown).toISOString()
        : null,
    });
  });
  app.post("/api/computer/restore/reconnect", async (req, res) => {
    const { id } = z.object({ id: z.uuid() }).strict().parse(req.body);
    const initial = await own(req, true);
    await dep.repo.locked(initial.ownerId, async () => {
      const agent = await own(req, true);
      const op = agent.computerOperation;
      if (
        !op ||
        op.id !== id ||
        op.action !== "restore" ||
        !op.startedAt ||
        op.rejected ||
        op.reconciled
      )
        throw new HttpError(
          409,
          "restore_not_pending",
          "There isn’t a restore waiting to reconnect.",
        );
      if (pending(agent)) return;
      op.phase = "checking";
      op.checkingAt = new Date().toISOString();
      op.finishedAt = undefined;
      op.error = undefined;
      await dep.repo.saveAgent(agent);
    });
    await dep.queue.send("maintenance", initial.ownerId);
    res.status(202).json({ queued: true });
  });
  for (const action of ["backup", "restore"] as const) {
    app.post(
      `/api/computer/${action === "backup" ? "backups" : "restore"}`,
      async (req, res) => {
        const input = (
          action === "backup"
            ? z.object({ id: z.uuid() }).strict()
            : z
                .object({
                  id: z.uuid(),
                  backup: backupId,
                  confirm: z.literal(true),
                })
                .strict()
        ).parse(req.body);
        const selectedBackup =
          action === "restore"
            ? backupId.parse("backup" in input ? input.backup : undefined)
            : undefined;
        const initial = await own(req, true);
        await dep.repo.locked(initial.ownerId, async () => {
          const agent = await own(req, true);
          const previous =
            agent.checkpointRequests?.find((row) => row.id === input.id) ||
            (agent.computerOperation?.id === input.id
              ? agent.computerOperation
              : undefined);
          if (previous) {
            if (
              previous.action !== action ||
              (action === "restore" && previous.backupId !== selectedBackup)
            )
              throw new HttpError(
                409,
                "operation_conflict",
                "This request already belongs to another operation.",
              );
            return;
          }
          if (pending(agent) || computerBusy(agent))
            throw new HttpError(
              409,
              "computer_busy",
              "The computer is already taking care of something. Try again when it’s ready.",
            );
          if (
            action === "backup" &&
            Date.now() <
              (Date.parse(agent.backupAttemptedAt || "") || 0) + backupCooldown
          )
            throw new HttpError(
              429,
              "backup_cooldown",
              "A manual backup can be started once every 15 minutes.",
            );
          const backups = await dep.a37.backups(agent.instanceId);
          if (action === "restore") {
            if (!backups.some((row) => row.id === selectedBackup))
              throw new HttpError(
                404,
                "backup_not_found",
                "That checkpoint is no longer available.",
              );
            await idle(dep, agent);
          }
          agent.computerOperation = {
            id: input.id,
            action,
            phase: "queued",
            requestedAt: new Date().toISOString(),
            targetTemplate: "",
            ...(action === "restore" ? { backupId: selectedBackup } : {}),
          };
          // Retain receipts across subsequent operations so delayed browser retries
          // cannot repeat a destructive restore. This small journal travels with state.
          agent.checkpointRequests = [
            ...(agent.checkpointRequests || []).slice(-63),
            {
              id: input.id,
              action,
              ...(selectedBackup ? { backupId: selectedBackup } : {}),
            },
          ];
          await dep.repo.saveAgent(agent);
        });
        await dep.queue.send("maintenance", initial.ownerId);
        res.status(202).json({ queued: true });
      },
    );
  }
}
