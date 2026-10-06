import { beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { DemoAgent37 } from "../services/control-plane/src/demo";
import { MemoryRepository } from "../services/control-plane/src/repository";
import {
  failComputerOperation,
  maintainComputer,
} from "../services/control-plane/src/computer-maintenance";
import type { Dependencies } from "../services/control-plane/src/app";
let repo: MemoryRepository, a37: DemoAgent37, dep: Dependencies;
const ownerId = randomUUID();
beforeEach(async () => {
  repo = new MemoryRepository();
  a37 = new DemoAgent37();
  const instance = await a37.createInstance({
    template: "boundless-hermes-desktop@2",
  });
  await repo.saveAgent({
    ownerId,
    instanceId: instance.id,
    phase: "ready",
    status: "ready",
    completed: ["ready"],
    budgetMicros: 0,
    updatedAt: new Date().toISOString(),
    computerOperation: {
      id: randomUUID(),
      action: "update",
      targetTemplate: "boundless-hermes-desktop@4",
      phase: "queued",
      requestedAt: new Date().toISOString(),
    },
  });
  dep = { repo, a37 } as Dependencies;
});
it("updates once, waits for health, and records the actual portrait screen", async () => {
  const update = vi.spyOn(a37, "update");
  expect(await maintainComputer(dep, ownerId)).toBe(true);
  expect((await repo.agent(ownerId))!.computerOperation?.phase).toBe(
    "checking",
  );
  const health = vi.spyOn(a37, "healthy").mockResolvedValueOnce(false);
  expect(await maintainComputer(dep, ownerId)).toBe(true);
  expect(await maintainComputer(dep, ownerId)).toBe(false);
  const agent = (await repo.agent(ownerId))!;
  expect(agent.computerOperation?.phase).toBe("completed");
  expect(agent.computerScreen).toEqual({ width: 540, height: 1140 });
  expect(update).toHaveBeenCalledTimes(1);
  expect(health).toHaveBeenCalledTimes(2);
});
it("reconciles a lost update reply without applying the image a second time", async () => {
  const original = a37.update.bind(a37);
  const update = vi.spyOn(a37, "update").mockImplementation(async (...args) => {
    await original(...args);
    throw new Error("Reply dropped");
  });
  expect(await maintainComputer(dep, ownerId)).toBe(true);
  expect(await maintainComputer(dep, ownerId)).toBe(false);
  expect((await repo.agent(ownerId))!.computerOperation?.phase).toBe(
    "completed",
  );
  expect(update).toHaveBeenCalledTimes(1);
});
it("never reissues an uncertain restart and fails visibly after the check deadline", async () => {
  const agent = (await repo.agent(ownerId))!;
  agent.computerOperation = {
    ...agent.computerOperation!,
    action: "restart",
    phase: "applying",
    bootBefore: "1:1:1",
    targetTemplate: "boundless-hermes-desktop@2",
    startedAt: new Date().toISOString(),
  };
  await repo.saveAgent(agent);
  const restart = vi.spyOn(a37, "restart");
  expect(await maintainComputer(dep, ownerId)).toBe(true);
  const pending = (await repo.agent(ownerId))!;
  pending.computerOperation!.startedAt = new Date(
    Date.now() - 250_000,
  ).toISOString();
  await repo.saveAgent(pending);
  expect(await maintainComputer(dep, ownerId)).toBe(false);
  expect((await repo.agent(ownerId))!.computerOperation?.phase).toBe("failed");
  expect(restart).not.toHaveBeenCalled();
});
it("does not restart active work or an account whose deletion has started", async () => {
  const agent = (await repo.agent(ownerId))!;
  agent.mainSessionId = "a".repeat(32);
  await repo.saveAgent(agent);
  vi.spyOn(a37, "session").mockResolvedValue({
    id: agent.mainSessionId,
    active_response_id: "b".repeat(32),
    history: [],
  });
  const update = vi.spyOn(a37, "update");
  expect(await maintainComputer(dep, ownerId)).toBe(false);
  expect((await repo.agent(ownerId))!.computerOperation?.error).toContain(
    "working",
  );
  const deleting = (await repo.agent(ownerId))!;
  deleting.status = "deleting";
  deleting.computerOperation!.phase = "queued";
  await repo.saveAgent(deleting);
  expect(await maintainComputer(dep, ownerId)).toBe(false);
  expect(update).not.toHaveBeenCalled();
});
it("leaves a retryable visible failure after an exhausted job without changing completed work", async () => {
  await failComputerOperation(dep, ownerId);
  expect((await repo.agent(ownerId))!.computerOperation?.phase).toBe("failed");
  const agent = (await repo.agent(ownerId))!;
  agent.computerOperation!.phase = "completed";
  agent.computerOperation!.error = undefined;
  await repo.saveAgent(agent);
  await failComputerOperation(dep, ownerId);
  expect((await repo.agent(ownerId))!.computerOperation?.phase).toBe(
    "completed",
  );
});
