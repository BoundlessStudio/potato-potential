import type { Agent } from "@boundless/shared";
import type { Dependencies } from "./app";
import { HttpError } from "./security";

export function suspensionPending(agent: Agent) {
  return agent.suspensionOperation?.phase === "pending";
}
export function accessPaused(agent: Agent) {
  // Both pause and resume stay closed until the provider's actual state is confirmed.
  return !!agent.suspended || suspensionPending(agent);
}

/** Caller holds the customer lease. Intent is saved before provider side effects. */
export async function reconcileSuspensionLocked(
  dep: Dependencies,
  agent: Agent,
) {
  const op = agent.suspensionOperation;
  if (
    !agent.instanceId ||
    !op ||
    !suspensionPending(agent) ||
    ["deleting", "deleted"].includes(agent.status)
  )
    return;
  const instance = await dep.a37.instance(agent.instanceId);
  const desiredStatus = op.suspended ? "stopped" : "running";
  if (instance.status !== desiredStatus) {
    try {
      if (op.suspended) await dep.a37.stop(agent.instanceId);
      else await dep.a37.start(agent.instanceId);
    } catch (error) {
      // The provider may have applied the action before its reply was lost.
      if ((await dep.a37.instance(agent.instanceId)).status !== desiredStatus)
        throw error;
    }
  }
  if ((await dep.a37.instance(agent.instanceId)).status !== desiredStatus)
    throw new HttpError(
      503,
      "suspension_pending",
      "The computer is still changing state. Your request is saved and will be retried.",
    );
  if (!op.suspended) await dep.lifecycle.healthy(agent.instanceId);
  if (!op.suspended && agent.status !== "ready")
    await dep.queue.send("provision", agent.ownerId);
  agent.suspended = op.suspended;
  op.phase = "completed";
  await dep.repo.saveAgent(agent);
}
