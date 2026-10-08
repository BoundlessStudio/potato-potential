import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Dependencies, Queue } from "./app";
import { reconcileLocked } from "./app";
import { HttpError } from "./security";
import { reconcileSuspensionLocked, suspensionPending } from "./suspension";
import {
  reconcileComputerLinksLocked,
  computerLinkWorkPending,
} from "./computer-services";
import {
  failComputerOperation,
  computerOperationPending,
  maintainComputerLocked,
} from "./computer-maintenance";

export type ApplicationJob = {
  id: string;
  owner_id: string;
  kind: "provision" | "cleanup" | "reconcile" | "maintenance";
  status: "queued" | "running" | "completed" | "failed";
  failures: number;
};
export class SupabaseJobs implements Queue {
  constructor(
    public client: SupabaseClient,
    private start: (id: string, token: string) => Promise<string>,
  ) {}
  private check<T>(result: { data: T; error: unknown }): T {
    if (result.error)
      throw new HttpError(
        502,
        "job_store_unavailable",
        "Background work could not be queued. Retry shortly.",
      );
    return result.data;
  }
  async send(kind: ApplicationJob["kind"], ownerId: string) {
    const job = this.check(
      await this.client.rpc("enqueue_application_job", {
        p_owner_id: ownerId,
        // Computer maintenance is desired-state reconciliation on the existing outbox.
        p_kind: kind === "maintenance" ? "reconcile" : kind,
      }),
    ) as ApplicationJob;
    await this.dispatch(job.id);
  }
  async dispatch(id: string) {
    const worker = randomUUID();
    const claimed = this.check(
      await this.client.rpc("claim_job_dispatch", {
        p_id: id,
        p_token: worker,
      }),
    );
    if (!claimed) return;
    try {
      const runId = await this.start(id, worker);
      this.check(
        await this.client
          .from("application_jobs")
          .update({ run_id: runId })
          .eq("id", id)
          .eq("dispatch_token", worker),
      );
    } catch {
      // A start may have succeeded before the reply was lost. Any redelivery uses the DB lease.
      this.check(
        await this.client
          .from("application_jobs")
          .update({
            dispatch_after: new Date(Date.now() + 30_000).toISOString(),
            error_code: "workflow_dispatch_interrupted",
          })
          .eq("id", id)
          .eq("dispatch_token", worker),
      );
      throw new HttpError(
        503,
        "workflow_dispatch_interrupted",
        "Your setup is saved. Retry shortly to resume background work.",
      );
    }
  }
  async claim(id: string, worker: string): Promise<ApplicationJob | null> {
    return this.check(
      await this.client.rpc("claim_application_job", {
        p_id: id,
        p_token: worker,
      }),
    );
  }
  async get(id: string): Promise<ApplicationJob | null> {
    return this.check(
      await this.client
        .from("application_jobs")
        .select("*")
        .eq("id", id)
        .maybeSingle(),
    );
  }
  async finish(id: string, worker: string, outcome: string, error?: string) {
    this.check(
      await this.client.rpc("finish_application_job", {
        p_id: id,
        p_token: worker,
        p_outcome: outcome,
        p_error: error || null,
      }),
    );
  }
  async repair() {
    const jobs = this.check(
      await this.client
        .from("application_jobs")
        .select("id")
        .in("status", ["queued", "running"])
        .lte("dispatch_after", new Date().toISOString())
        .limit(100),
    );
    await this.dispatchPending(jobs || []);
  }
  async recover(ownerId: string) {
    const jobs = this.check(
      await this.client
        .from("application_jobs")
        .select("id")
        .eq("owner_id", ownerId)
        .in("status", ["queued", "running"])
        .lte("dispatch_after", new Date().toISOString()),
    );
    await this.dispatchPending(jobs || []);
  }
  private async dispatchPending(jobs: { id: string }[]) {
    let failure: unknown;
    for (const job of jobs) {
      try {
        await this.dispatch(job.id);
      } catch (error) {
        failure ||= error;
      }
    }
    // Preserve the failure signal after attempting every independent account.
    if (failure) throw failure;
  }
}

export async function recoverPendingWork(
  dep: Pick<Dependencies, "repo">,
  jobs: Pick<SupabaseJobs, "repair" | "send">,
) {
  let failure: unknown;
  try {
    await jobs.repair();
  } catch (error) {
    failure = error;
  }
  for (const agent of await dep.repo.agents()) {
    const kind =
      agent.status === "deleting"
        ? "cleanup"
        : ["new", "provisioning"].includes(agent.status)
          ? "provision"
          : agent.status === "ready"
            ? "reconcile"
            : null;
    if (!kind) continue;
    try {
      await jobs.send(kind, agent.ownerId);
    } catch (error) {
      failure ||= error;
    }
  }
  if (failure) throw failure;
}

/** One bounded, idempotent slice. Provider ownership is persisted before remote side effects. */
export async function executeJobSlice(
  dep: Dependencies,
  jobs: SupabaseJobs,
  id: string,
  worker: string,
): Promise<"continue" | "complete" | "busy" | "retry"> {
  const job = await jobs.claim(id, worker);
  if (!job) {
    const current = await jobs.get(id);
    return !current || ["completed", "failed"].includes(current.status)
      ? "complete"
      : "busy";
  }
  let maintenanceOperationId: string | undefined;
  try {
    if (job.kind === "reconcile" || job.kind === "maintenance") {
      return await dep.repo.locked(job.owner_id, async () => {
        await reconcileComputerLinksLocked(dep, job.owner_id, true);
        let agent = await dep.repo.agent(job.owner_id);
        if (agent && suspensionPending(agent)) {
          await reconcileSuspensionLocked(dep, agent);
          agent = await dep.repo.agent(job.owner_id);
        }
        let more = false;
        if (agent && computerOperationPending(agent)) {
          maintenanceOperationId = agent.computerOperation!.id;
          more = await maintainComputerLocked(dep, job.owner_id);
        } else more = !!(await reconcileLocked(dep, job.owner_id));
        more = more || (await computerLinkWorkPending(dep, job.owner_id));
        // Finish under the same lease as the state read. A newly requested operation
        // cannot be swallowed by an ordinary reconciliation that is about to finish.
        await jobs.finish(id, worker, more ? "continue" : "completed");
        return more ? "continue" : "complete";
      });
    }
    let more = false;
    if (job.kind === "provision") {
      await dep.lifecycle.provision(job.owner_id, true);
      const agent = await dep.repo.agent(job.owner_id);
      more = !!agent && agent.status === "provisioning";
      // The ready phase marks status before sending an introduction, but only finishes after it returns.
      if (agent?.status === "ready") more = !agent.completed.includes("ready");
    } else if (job.kind === "cleanup")
      await dep.lifecycle.cleanup(job.owner_id);
    await jobs.finish(id, worker, more ? "continue" : "completed");
    return more ? "continue" : "complete";
  } catch (error) {
    const retry =
      !(error instanceof HttpError) ||
      error.status >= 500 ||
      [409, 429].includes(error.status);
    // Store codes only: remote exec errors can contain runtime credentials.
    await jobs.finish(
      id,
      worker,
      retry ? "retry" : "failed",
      error instanceof HttpError ? error.code : "operation_interrupted",
    );
    if (maintenanceOperationId && (!retry || job.failures >= 4))
      await failComputerOperation(dep, job.owner_id, maintenanceOperationId);
    return retry ? "retry" : "complete";
  }
}
