import type { Agent, WorkspaceItem } from "@boundless/shared";
import { z } from "zod";
import type { AgentProvider } from "./providers";
import type { Repository } from "./repository";
import { HttpError } from "./security";

export const WORKSPACE_HELPER_VERSION = 1;
// Native Hermes/cron ids can differ from the gateway's 32-character hex ids.
export const sessionIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
export const isTask = (item: WorkspaceItem) =>
  item.kind === "task" || item.kind === "responsibility";

export async function ownedTask(repo: Repository, ownerId: string, id: string) {
  const item = await repo.item(ownerId, id);
  if (!item || !isTask(item))
    throw new HttpError(404, "not_found", "Task not found.");
  return item;
}

/** The caller holds the owner's lease. Links survive edits and are idempotent. */
export async function linkTaskSession(
  repo: Repository,
  item: WorkspaceItem,
  instanceId: string,
  sessionId: string,
) {
  const now = new Date().toISOString();
  const links = [...(item.sessionLinks || [])];
  const prior = links.find(
    (link) => link.instanceId === instanceId && link.sessionId === sessionId,
  );
  if (prior) return item;
  links.push({ instanceId, sessionId, linkedAt: now });
  const updated = { ...item, sessionLinks: links, updatedAt: now };
  await repo.saveItem(updated);
  return updated;
}

/** Full transcripts are fetched on demand, never silently truncated or injected into every turn. */
export async function taskHistory(
  repo: Repository,
  a37: AgentProvider,
  agent: Agent & { instanceId: string },
  taskId: string,
  sessionId?: string,
) {
  const item = await ownedTask(repo, agent.ownerId, taskId);
  const links = (item.sessionLinks || []).filter(
    (link) => !sessionId || link.sessionId === sessionId,
  );
  if (sessionId && !links.length)
    throw new HttpError(
      404,
      "not_found",
      "This conversation is not linked to the task.",
    );
  const conversations = [];
  for (const link of links) {
    if (link.instanceId !== agent.instanceId) {
      conversations.push({
        ...link,
        available: false,
        reason: "computer_replaced",
      });
      continue;
    }
    const session = await a37.session(agent.instanceId, link.sessionId);
    conversations.push({
      ...link,
      available: !!(session.history.length || session.active_response_id),
      ...session,
    });
  }
  return { item, conversations };
}
