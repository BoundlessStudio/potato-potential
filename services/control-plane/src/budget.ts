import type { Express, Request } from "express";
import {
  budgetUpdateSchema,
  type Agent,
  type InstanceBudget,
} from "@boundless/shared";
import type { Dependencies } from "./app";
import { HttpError } from "./security";

export function registerBudgetRoutes(
  app: Express,
  { repo, a37 }: Dependencies,
  owner: (req: Request) => string,
  account: (req: Request) => Promise<unknown>,
) {
  async function current(req: Request) {
    await account(req);
    const agent = await repo.agent(owner(req));
    if (!agent?.instanceId || agent.status !== "ready")
      throw new HttpError(
        409,
        "agent_not_ready",
        "Finish setting up your companion before changing the budget.",
      );
    // Owners can still reduce their budget while the computer is paused or
    // undergoing maintenance. The hosting budget does not require a running agent.
    return agent as Agent & { instanceId: string };
  }
  async function remember(agent: Agent, budget: InstanceBudget) {
    if (agent.budgetMicros !== budget.monthlyCapMicros) {
      agent.budgetMicros = budget.monthlyCapMicros;
      await repo.saveAgent(agent);
    }
    return budget;
  }
  app.get("/api/budget", async (req, res) => {
    const agent = await current(req);
    let budget = await a37.getBudget(agent.instanceId);
    const latest = await current(req);
    if (latest.instanceId !== agent.instanceId)
      throw new HttpError(
        409,
        "budget_changed",
        "Your computer changed. Reload the current budget.",
      );
    // Ordinary reads need no lease, so opening Settings does not compete with
    // upload recovery. Only repair an out-of-date local cap under the owner lease.
    if (latest.budgetMicros !== budget.monthlyCapMicros)
      budget = await repo.locked(owner(req), async () => {
        const fresh = await current(req);
        return remember(fresh, await a37.getBudget(fresh.instanceId));
      });
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ budget });
  });
  app.put("/api/budget", async (req, res) => {
    const { micros, expectedMicros } = budgetUpdateSchema.parse(req.body);
    const budget = await repo.locked(owner(req), async () => {
      const agent = await current(req);
      let latest = await a37.getBudget(agent.instanceId);
      // Repeating a save after a lost reply is safe; a changed cap from another
      // tab or the operator must be reloaded before it can be overwritten.
      if (latest.monthlyCapMicros !== micros) {
        if (latest.monthlyCapMicros !== expectedMicros)
          throw new HttpError(
            409,
            "budget_changed",
            "Your budget changed elsewhere. Reload the current budget before saving.",
          );
        await a37.budget(agent.instanceId, micros);
        latest = await a37.getBudget(agent.instanceId);
        if (latest.monthlyCapMicros !== micros)
          throw new HttpError(
            502,
            "budget_unconfirmed",
            "Couldn’t confirm the new limit. Reload the current budget before trying again.",
          );
      }
      return remember(agent, latest);
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ budget });
  });
}
