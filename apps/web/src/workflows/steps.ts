import type { SupabaseRepository } from "../../../../services/control-plane/src/repository";

export async function runSlice(id: string, worker: string) {
  "use step";
  const { liveDependencies } = await import("@boundless/control-plane/runtime");
  const { SupabaseJobs, executeJobSlice } =
    await import("@boundless/control-plane/jobs");
  const dep = liveDependencies({ async send() {} });
  const jobs = new SupabaseJobs(
    (dep.repo as SupabaseRepository).client,
    async () => {
      throw new Error("No nested dispatch.");
    },
  );
  return executeJobSlice(dep, jobs, id, worker);
}
runSlice.maxRetries = 5;

export async function exhaustJob(id: string, worker: string) {
  "use step";
  const { liveDependencies } = await import("@boundless/control-plane/runtime");
  const { SupabaseJobs } = await import("@boundless/control-plane/jobs");
  const dep = liveDependencies({ async send() {} });
  const jobs = new SupabaseJobs(
    (dep.repo as SupabaseRepository).client,
    async () => "",
  );
  const job = await jobs.claim(id, worker);
  if (job) {
    await jobs.finish(id, worker, "failed", "workflow_retry_limit");
    if (job.kind === "maintenance" || job.kind === "reconcile") {
      const { failComputerOperation } =
        await import("../../../../services/control-plane/src/computer-maintenance");
      await failComputerOperation(dep, job.owner_id);
    }
  }
}
