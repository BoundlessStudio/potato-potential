import { start } from "workflow/api";
import { liveDependencies } from "@boundless/control-plane/runtime";
import { SupabaseJobs } from "@boundless/control-plane/jobs";
import type { SupabaseRepository } from "../../../../services/control-plane/src/repository";
import { applicationJob } from "@/workflows/jobs";

export function productionQueue() {
  const dep = liveDependencies({ async send() {} });
  const jobs = new SupabaseJobs(
    (dep.repo as SupabaseRepository).client,
    async (id, worker) => (await start(applicationJob, [id, worker])).runId,
  );
  return Object.assign(jobs, {
    async maintenance() {
      await jobs.repair();
      for (const agent of await dep.repo.agents()) {
        if (agent.status === "deleting")
          await jobs.send("cleanup", agent.ownerId);
        else if (agent.status === "ready" && !agent.suspended)
          await jobs.send("reconcile", agent.ownerId);
      }
    },
  });
}
