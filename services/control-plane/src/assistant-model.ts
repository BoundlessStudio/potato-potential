import type { Express, Request } from "express";
import { z } from "zod";
import {
  assistantModelSchema,
  type Agent,
  type AssistantModel,
  type AssistantModelCatalog,
  type AssistantModelSettings,
} from "@boundless/shared";
import type { Dependencies } from "./app";
import type { AgentProvider } from "./providers";
import { HttpError } from "./security";

export const sameModel = (
  a: AssistantModel | null,
  b: AssistantModel | null,
) =>
  a === null || b === null
    ? a === b
    : a.model === b.model && a.provider === b.provider;

export async function applyAssistantModel(
  a37: AgentProvider,
  agent: Agent,
  restoring = false,
) {
  if (
    !agent.instanceId ||
    (!agent.assistantModel &&
      !(
        (agent.assistantModelPending || restoring) &&
        agent.assistantModelOriginal
      ))
  )
    return;
  const model = agent.assistantModel || null;
  await a37.setModel(agent.instanceId, model);
  const current = await a37.models(agent.instanceId);
  if (model && !sameModel(current.defaultModel, model))
    throw new HttpError(
      502,
      "model_unconfirmed",
      "Couldn’t confirm the assistant model. Reload and try again.",
    );
}

export function registerModelRoutes(
  app: Express,
  { repo, a37, queue }: Dependencies,
  owner: (req: Request) => string,
  ready: (req: Request) => Promise<Agent & { instanceId: string }>,
) {
  const settings = (
    agent: Agent,
    catalog: AssistantModelCatalog,
  ): AssistantModelSettings => ({
    ...catalog,
    model: agent.assistantModel || null,
    applied:
      !agent.assistantModelPending &&
      (!agent.assistantModel ||
        sameModel(agent.assistantModel, catalog.defaultModel)),
  });
  app.get("/api/assistant-model", async (req, res) => {
    const agent = await ready(req);
    const catalog = await a37.models(agent.instanceId);
    const latest = await ready(req);
    if (latest.instanceId !== agent.instanceId)
      throw new HttpError(
        409,
        "model_changed",
        "Your computer changed. Reload the assistant models.",
      );
    res.setHeader("Cache-Control", "private, no-store");
    res.json(settings(latest, catalog));
  });
  app.put("/api/assistant-model", async (req, res) => {
    const body = z
      .object({
        model: assistantModelSchema.nullable(),
        expectedModel: assistantModelSchema.nullable(),
      })
      .strict()
      .parse(req.body);
    const next = await repo.locked(owner(req), async () => {
      const agent = await ready(req);
      const catalog = await a37.models(agent.instanceId);
      const current = agent.assistantModel || null;
      if (
        !sameModel(current, body.model) &&
        !sameModel(current, body.expectedModel)
      )
        throw new HttpError(
          409,
          "model_changed",
          "Your assistant model changed elsewhere. Reload before saving.",
        );
      if (
        body.model &&
        !catalog.models.some((row) => sameModel(row, body.model))
      )
        throw new HttpError(
          400,
          "model_unavailable",
          "That model is no longer available. Reload the model list.",
        );
      // Save intent before remote writes. A dropped reply or process restart can
      // be recovered from the account record, independent of computer backups.
      if (body.model && !agent.assistantModelOriginal)
        agent.assistantModelOriginal = catalog.defaultModel;
      agent.assistantModel = body.model;
      agent.assistantModelPending = true;
      await repo.saveAgent(agent);
      try {
        await applyAssistantModel(a37, agent);
        agent.assistantModelPending = false;
        await repo.saveAgent(agent);
      } catch (error) {
        await queue.send("reconcile", agent.ownerId).catch(() => {});
        throw error;
      }
      return settings(agent, await a37.models(agent.instanceId));
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.json(next);
  });
}
