import type { Express, Request } from "express";
import type { Dependencies } from "./app";
import { HttpError } from "./security";

export function registerUsageRoutes(
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
        "Finish setting up your companion to see usage.",
      );
    return agent.instanceId;
  }
  app.get("/api/usage", async (req, res) => {
    const instanceId = await current(req);
    const usage = await a37.getUsage(instanceId);
    // Check ownership and account lifecycle again after the remote read.
    if ((await current(req)) !== instanceId)
      throw new HttpError(
        409,
        "usage_changed",
        "Your computer changed. Refresh usage.",
      );
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ usage });
  });
}
