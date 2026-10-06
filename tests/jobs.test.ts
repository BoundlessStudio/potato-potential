import { beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Dependencies } from "../services/control-plane/src/app";
import { DemoAgent37 } from "../services/control-plane/src/demo";
import { MemoryRepository } from "../services/control-plane/src/repository";
import {
  executeJobSlice,
  SupabaseJobs,
} from "../services/control-plane/src/jobs";
import { ProviderError } from "../services/control-plane/src/providers";

const owner = randomUUID(),
  jobId = randomUUID(),
  worker = randomUUID();
let repo: MemoryRepository, a37: DemoAgent37, dep: Dependencies;
beforeEach(async () => {
  repo = new MemoryRepository();
  a37 = new DemoAgent37();
  const instance = await a37.createInstance({
    template: "boundless-hermes-desktop@2",
  });
  await repo.saveAgent({
    ownerId: owner,
    instanceId: instance.id,
    phase: "ready",
    status: "ready",
    completed: ["ready"],
    budgetMicros: 0,
    updatedAt: new Date().toISOString(),
  });
  dep = { repo, a37 } as Dependencies;
});
async function requestUpdate() {
  const agent = (await repo.agent(owner))!;
  agent.computerOperation = {
    id: randomUUID(),
    action: "update",
    targetTemplate: "boundless-hermes-desktop@4",
    phase: "queued",
    requestedAt: new Date().toISOString(),
  };
  await repo.saveAgent(agent);
}
function jobQueue(finish = vi.fn().mockResolvedValue(undefined), failures = 0) {
  return {
    claim: vi.fn().mockResolvedValue({
      id: jobId,
      owner_id: owner,
      kind: "reconcile",
      status: "running",
      failures,
    }),
    finish,
  } as unknown as SupabaseJobs;
}

it("recovers saved pause intent after an interrupted provider call through the durable outbox", async () => {
  const agent = (await repo.agent(owner))!;
  agent.suspensionOperation = {
    id: randomUUID(),
    suspended: true,
    phase: "pending",
    requestedAt: new Date().toISOString(),
  };
  await repo.saveAgent(agent);
  const stop = vi
    .spyOn(a37, "stop")
    .mockRejectedValueOnce(
      new ProviderError(503, "unavailable", "Unavailable"),
    );
  const crons = vi.spyOn(a37, "crons");
  const jobs = jobQueue();
  expect(await executeJobSlice(dep, jobs, jobId, worker)).toBe("retry");
  expect((await repo.agent(owner))!.suspensionOperation?.phase).toBe("pending");
  expect(await executeJobSlice(dep, jobs, jobId, worker)).toBe("complete");
  expect((await repo.agent(owner))!.suspended).toBe(true);
  expect(crons).not.toHaveBeenCalled();
  expect(stop).toHaveBeenCalledTimes(2);
});

it("keeps a recovered resume closed until healthy and avoids repeating an already applied start", async () => {
  const agent = (await repo.agent(owner))!;
  await a37.stop(agent.instanceId!);
  agent.suspended = true;
  agent.suspensionOperation = {
    id: randomUUID(),
    suspended: false,
    phase: "pending",
    requestedAt: new Date().toISOString(),
  };
  await repo.saveAgent(agent);
  const healthy = vi
    .fn()
    .mockRejectedValueOnce(new ProviderError(503, "booting", "Still booting"))
    .mockResolvedValue(undefined);
  dep.lifecycle = { healthy } as unknown as Dependencies["lifecycle"];
  const start = vi.spyOn(a37, "start");
  const jobs = jobQueue();
  expect(await executeJobSlice(dep, jobs, jobId, worker)).toBe("retry");
  expect((await repo.agent(owner))!.suspended).toBe(true);
  expect((await repo.agent(owner))!.suspensionOperation?.phase).toBe("pending");
  expect(await executeJobSlice(dep, jobs, jobId, worker)).toBe("complete");
  expect(start).toHaveBeenCalledTimes(1);
  expect(healthy).toHaveBeenCalledTimes(2);
  expect((await repo.agent(owner))!.suspended).toBe(false);
});

it("maps maintenance to the reconciliation kind supported by the deployed database", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: { id: jobId }, error: null });
  const jobs = new SupabaseJobs(
    { rpc } as unknown as SupabaseClient,
    async () => "unused",
  );
  const dispatch = vi.spyOn(jobs, "dispatch").mockResolvedValue();
  await jobs.send("maintenance", owner);
  expect(rpc).toHaveBeenCalledWith("enqueue_application_job", {
    p_owner_id: owner,
    p_kind: "reconcile",
  });
  expect(dispatch).toHaveBeenCalledWith(jobId);
});

it("runs a saved computer update through reconciliation slices without duplicate provider calls", async () => {
  await requestUpdate();
  const jobs = jobQueue(),
    update = vi.spyOn(a37, "update");
  expect(await executeJobSlice(dep, jobs, jobId, worker)).toBe("continue");
  expect(await executeJobSlice(dep, jobs, jobId, worker)).toBe("complete");
  expect(update).toHaveBeenCalledTimes(1);
  expect((await repo.agent(owner))!.computerOperation?.phase).toBe("completed");
  expect((await repo.agent(owner))!.computerScreen).toEqual({
    width: 540,
    height: 1140,
  });
});

it("finishes ordinary reconciliation under the owner lease before a new update can be saved", async () => {
  let finishEntered!: () => void, allowFinish!: () => void;
  const entered = new Promise<void>((resolve) => {
    finishEntered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    allowFinish = resolve;
  });
  const jobs = jobQueue(
    vi.fn().mockImplementation(async () => {
      finishEntered();
      await gate;
    }),
  );
  const slice = executeJobSlice(dep, jobs, jobId, worker);
  await entered;
  let saved = false;
  const newRequest = repo.locked(owner, async () => {
    await requestUpdate();
    saved = true;
  });
  await Promise.resolve();
  expect(saved).toBe(false);
  allowFinish();
  expect(await slice).toBe("complete");
  await newRequest;
  expect(saved).toBe(true);
  const next = jobQueue();
  expect(await executeJobSlice(dep, next, randomUUID(), worker)).toBe(
    "continue",
  );
});

it("surfaces exhausted maintenance retries without exposing provider exec errors", async () => {
  await requestUpdate();
  vi.spyOn(a37, "exec").mockRejectedValue(
    new ProviderError(503, "exec_unavailable", "private runtime credentials"),
  );
  const jobs = jobQueue(undefined, 4);
  expect(await executeJobSlice(dep, jobs, jobId, worker)).toBe("retry");
  expect(jobs.finish).toHaveBeenCalledWith(
    jobId,
    worker,
    "retry",
    "exec_unavailable",
  );
  const operation = (await repo.agent(owner))!.computerOperation!;
  expect(operation.phase).toBe("failed");
  expect(operation.error).not.toContain("private runtime credentials");
});
