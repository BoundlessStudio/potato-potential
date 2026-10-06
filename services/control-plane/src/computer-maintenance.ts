import type { Agent } from "@boundless/shared";
import type { Dependencies } from "./app";
import { HttpError } from "./security";

export const bootCommand = `node -e 'const fs=require("node:fs");const s=fs.statSync("/proc/1");const t=fs.readFileSync("/proc/1/stat","utf8").split(") ").pop().split(" ")[19];console.log(s.ctimeMs+":"+s.mtimeMs+":"+t)'`;
export const screenCommand = "DISPLAY=:99 /usr/bin/xdpyinfo | grep dimensions";
export function computerBusy(agent: Agent) {
  return (
    !!agent.computerOperation &&
    ["queued", "applying", "checking"].includes(agent.computerOperation.phase)
  );
}
export function screenForTemplate(template: string) {
  if (template === "boundless-hermes-desktop@3")
    return { width: 450, height: 950 };
  return /^boundless-hermes-desktop@([4-9]|[1-9][0-9]+)$/.test(template)
    ? { width: 540, height: 1140 }
    : { width: 1440, height: 900 };
}

export async function failComputerOperation(
  dep: Dependencies,
  ownerId: string,
  operationId?: string,
) {
  await dep.repo.locked(ownerId, async () => {
    const agent = await dep.repo.agent(ownerId);
    if (
      !agent ||
      !computerBusy(agent) ||
      (operationId && agent.computerOperation?.id !== operationId)
    )
      return;
    agent.computerOperation!.phase = "failed";
    agent.computerOperation!.error =
      "Couldn’t finish checking the computer. Check its status and retry.";
    agent.computerOperation!.finishedAt = new Date().toISOString();
    await dep.repo.saveAgent(agent);
  });
}

// A provider call is issued once. After a dropped reply, reconcile the installed
// image / boot fingerprint rather than repeatedly restarting the computer.
export async function maintainComputer(
  dep: Dependencies,
  ownerId: string,
): Promise<boolean> {
  return dep.repo.locked(ownerId, () => maintainComputerLocked(dep, ownerId));
}

// Only call while holding the customer's lease; completion shares that lease.
export async function maintainComputerLocked(
  dep: Dependencies,
  ownerId: string,
): Promise<boolean> {
  const agent = await dep.repo.agent(ownerId);
  const op = agent?.computerOperation;
  if (
    !agent?.instanceId ||
    agent.status !== "ready" ||
    !op ||
    !computerBusy(agent)
  )
    return false;
  const save = () => dep.repo.saveAgent(agent);
  const fail = async (message: string) => {
    op.phase = "failed";
    op.error = message;
    op.finishedAt = new Date().toISOString();
    await save();
    return false;
  };
  if (agent.suspended)
    return fail("The computer is paused. Resume it before retrying.");
  if (op.phase === "queued") {
    if (agent.mainSessionId) {
      const session = await dep.a37.session(
        agent.instanceId,
        agent.mainSessionId,
      );
      if (session.active_response_id)
        return fail(
          "Your companion is working. Finish or stop the response, then try again.",
        );
    }
    const boot = await dep.a37.exec(agent.instanceId, bootCommand);
    if (boot.exit_code || !/^[0-9.:]+$/.test(boot.stdout.trim()))
      return fail("Couldn’t check the computer before restarting. Try again.");
    op.bootBefore = boot.stdout.trim();
    op.phase = "applying";
    op.startedAt = new Date().toISOString();
    await save();
    try {
      if (op.action === "update")
        await dep.a37.update(agent.instanceId, op.targetTemplate);
      else await dep.a37.restart(agent.instanceId);
      op.acknowledged = true;
    } catch {
      // The request may have succeeded. The next slice checks the computer.
      op.acknowledged = false;
    }
    op.phase = "checking";
    await save();
    return true;
  }
  if (Date.now() - Date.parse(op.startedAt || op.requestedAt) > 240_000)
    return fail(
      "Couldn’t confirm the computer is ready. Check its status and retry.",
    );
  // "applying" means a workflow stopped between issuing the call and storing its reply.
  op.phase = "checking";
  await save();
  try {
    const instance = await dep.a37.instance(agent.instanceId);
    if (
      instance.status !== "running" ||
      !(await dep.a37.healthy(agent.instanceId))
    )
      return true;
    const boot = await dep.a37.exec(agent.instanceId, bootCommand);
    const changed =
      boot.exit_code === 0 && boot.stdout.trim() !== op.bootBefore;
    if (!op.acknowledged && !changed) return true;
    if (op.action === "update" && instance.template !== op.targetTemplate)
      return true;
    const screen = await dep.a37.exec(agent.instanceId, screenCommand);
    const dimensions = screen.stdout.match(/dimensions:\s+(\d+)x(\d+)/);
    if (screen.exit_code || !dimensions) return true;
    const [width, height] = dimensions.slice(1).map(Number);
    if (width < 100 || height < 100) return true;
    const expected = screenForTemplate(op.targetTemplate);
    if (
      op.action === "update" &&
      (width !== expected.width || height !== expected.height)
    )
      return fail(
        "The updated computer has an unexpected screen size. Ask the operator to check it.",
      );
    agent.computerScreen = { width, height };
    op.phase = "completed";
    op.finishedAt = new Date().toISOString();
    op.error = undefined;
    await save();
    return false;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404)
      return fail("The computer is no longer available.");
    return true;
  }
}
