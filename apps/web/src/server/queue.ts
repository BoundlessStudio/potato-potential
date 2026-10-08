import { start } from "workflow/api";
import { liveDependencies } from "@boundless/control-plane/runtime";
import {
  SupabaseJobs,
  recoverPendingWork,
} from "@boundless/control-plane/jobs";
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
      await recoverPendingWork(dep, jobs);
    },
  });
}
