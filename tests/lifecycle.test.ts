import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Profile } from "@boundless/shared";
import { MemoryRepository } from "../services/control-plane/src/repository";
import { DemoAgent37, DemoInkbox } from "../services/control-plane/src/demo";
import { Lifecycle } from "../services/control-plane/src/lifecycle";
import { loadConfig } from "../services/control-plane/src/config";
import { HttpError } from "../services/control-plane/src/security";
import {
  reconcile,
  type Dependencies,
} from "../services/control-plane/src/app";

let repo: MemoryRepository,
  a37: DemoAgent37,
  inkbox: DemoInkbox,
  lifecycle: Lifecycle,
  profile: Profile;
beforeEach(async () => {
  repo = new MemoryRepository();
  a37 = new DemoAgent37();
  inkbox = new DemoInkbox();
  lifecycle = new Lifecycle(
    loadConfig({ DEMO_MODE: "true" }),
    repo,
    a37,
    inkbox,
  );
  profile = {
    id: randomUUID(),
    name: "Jamie",
    email: "jamie@example.com",
    agentName: "Fern",
    phone: "+14165550123",
    timezone: "America/Toronto",
    avatar: "sprout",
    color: "#7659e8",
    personality: "Thoughtful",
    preferences: "Quiet mornings",
    createdAt: new Date().toISOString(),
  };
  await repo.saveProfile(profile);
});
async function finish() {
  await lifecycle.provision(profile.id);
  await lifecycle.verifyPhone(profile.id);
  await lifecycle.provision(profile.id);
  return (await repo.agent(profile.id))!;
}
describe("durable lifecycle", () => {
  it("deletes an invited account that has not provisioned provider resources", async () => {
    await lifecycle.cleanup(profile.id);
    expect(await repo.profile(profile.id)).toBeNull();
    expect(a37.instances.size).toBe(0);
    expect(inkbox.identities.size).toBe(0);
  });
  it("serializes repeated setup and owns exactly one identity/computer", async () => {
    await Promise.all([
      lifecycle.provision(profile.id),
      lifecycle.provision(profile.id),
    ]);
    expect(a37.instances.size).toBe(1);
    expect(inkbox.identities.size).toBe(1);
    expect((await repo.agent(profile.id))!.status).toBe("awaiting_phone");
    const agent = await finish();
    await lifecycle.provision(profile.id);
    expect(agent.status).toBe("ready");
    expect(a37.instances.size).toBe(1);
    expect(inkbox.identities.size).toBe(1);
    expect(
      a37.histories
        .get(agent.mainSessionId!)!
        .history.filter((row) => row.role === "assistant"),
    ).toHaveLength(1);
  });
  it("reconciles a remote create whose response was lost", async () => {
    const create = a37.createInstance.bind(a37);
    vi.spyOn(a37, "createInstance").mockImplementationOnce(async (body) => {
      await create(body);
      throw new Error("connection dropped");
    });
    await expect(lifecycle.provision(profile.id)).rejects.toThrow("dropped");
    expect(a37.instances.size).toBe(1);
    await lifecycle.provision(profile.id);
    expect(a37.instances.size).toBe(1);
    expect((await repo.agent(profile.id))!.status).toBe("awaiting_phone");
  });
  it("does not repeat the introduction after a lost completed response", async () => {
    await lifecycle.provision(profile.id);
    await lifecycle.verifyPhone(profile.id);
    const responses = a37.responses.bind(a37);
    vi.spyOn(a37, "responses").mockImplementationOnce(async (id, body) => {
      await responses(id, body);
      throw new Error("lost result");
    });
    await expect(lifecycle.provision(profile.id)).rejects.toThrow();
    await lifecycle.provision(profile.id);
    expect(
      a37.histories
        .get((await repo.agent(profile.id))!.mainSessionId!)!
        .history.filter((row) => row.role === "assistant"),
    ).toHaveLength(1);
  });
  it("retains ownership after partial deletion and resumes only outstanding deletion", async () => {
    await finish();
    const remove = vi.spyOn(a37, "removeInstance");
    vi.spyOn(inkbox, "removeIdentity").mockRejectedValueOnce(
      new HttpError(502, "carrier_unavailable", "Temporary carrier outage"),
    );
    await expect(lifecycle.cleanup(profile.id)).rejects.toThrow();
    expect(await repo.profile(profile.id)).not.toBeNull();
    expect((await repo.agent(profile.id))!.deletion).toEqual({
      instance: true,
      identity: false,
    });
    await lifecycle.cleanup(profile.id);
    expect(await repo.profile(profile.id)).toBeNull();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(inkbox.identities.size).toBe(0);
  });
  it("waits for the single computer and identity to be removed before erasing the account", async () => {
    const agent = await finish();
    const order: string[] = [];
    const removeInstance = a37.removeInstance.bind(a37);
    const removeIdentity = inkbox.removeIdentity.bind(inkbox);
    const removeCustomer = repo.removeCustomer.bind(repo);
    vi.spyOn(a37, "removeInstance").mockImplementation(async (id) => {
      order.push("computer");
      expect(id).toBe(agent.instanceId);
      await removeInstance(id);
    });
    vi.spyOn(inkbox, "removeIdentity").mockImplementation(async (handle) => {
      order.push("identity");
      expect(await repo.profile(profile.id)).not.toBeNull();
      expect(a37.instances.size).toBe(0);
      await removeIdentity(handle);
    });
    vi.spyOn(repo, "removeCustomer").mockImplementation(async (id) => {
      order.push("account");
      expect(inkbox.identities.size).toBe(0);
      await removeCustomer(id);
    });
    await lifecycle.cleanup(profile.id);
    expect(order).toEqual(["computer", "identity", "account"]);
  });
  it("preserves the identity and account when computer deletion fails", async () => {
    await finish();
    vi.spyOn(a37, "removeInstance").mockRejectedValueOnce(
      new HttpError(503, "unavailable", "Computer unavailable"),
    );
    const removeIdentity = vi.spyOn(inkbox, "removeIdentity");
    const removeCustomer = vi.spyOn(repo, "removeCustomer");
    await expect(lifecycle.cleanup(profile.id)).rejects.toThrow();
    expect(removeIdentity).not.toHaveBeenCalled();
    expect(removeCustomer).not.toHaveBeenCalled();
    expect((await repo.agent(profile.id))!.status).toBe("deleting");
    expect(a37.instances.size).toBe(1);
    expect(inkbox.identities.size).toBe(1);
    await lifecycle.cleanup(profile.id);
    expect(await repo.profile(profile.id)).toBeNull();
  });
  it("recovers the one owned computer after a lost create reply and leaves other owners alone", async () => {
    const create = a37.createInstance.bind(a37);
    vi.spyOn(a37, "createInstance").mockImplementationOnce(async (body) => {
      await create(body);
      throw new Error("Lost create reply");
    });
    await expect(lifecycle.provision(profile.id)).rejects.toThrow();
    expect((await repo.agent(profile.id))!.instanceId).toBeUndefined();
    const other = await create({ user: randomUUID(), template: "preview" });
    const remove = vi.spyOn(a37, "removeInstance");
    await lifecycle.cleanup(profile.id);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(a37.instances.has(other.id)).toBe(true);
    expect(await repo.profile(profile.id)).toBeNull();
  });
  it("finds the same Inkbox identity by UUID after its handle changed", async () => {
    const agent = await finish();
    const identity = inkbox.identities.get(agent.handle!);
    inkbox.identities.delete(agent.handle!);
    identity.agent_handle = "renamed-identity";
    inkbox.identities.set(identity.agent_handle, identity);
    await inkbox.request("/identities", {
      method: "POST",
      body: JSON.stringify({ agent_handle: "unrelated-identity" }),
    });
    const remove = vi.spyOn(inkbox, "removeIdentity");
    await lifecycle.cleanup(profile.id);
    expect(remove).toHaveBeenCalledWith("renamed-identity");
    expect(inkbox.identities.has("renamed-identity")).toBe(false);
    expect(inkbox.identities.has("unrelated-identity")).toBe(true);
  });
  it("retries only account erasure after both provider deletions succeeded", async () => {
    await finish();
    const computer = vi.spyOn(a37, "removeInstance");
    const identity = vi.spyOn(inkbox, "removeIdentity");
    vi.spyOn(repo, "removeCustomer").mockRejectedValueOnce(
      new Error("Auth unavailable"),
    );
    await expect(lifecycle.cleanup(profile.id)).rejects.toThrow(
      "Auth unavailable",
    );
    expect(await repo.profile(profile.id)).not.toBeNull();
    expect((await repo.agent(profile.id))!.deletion).toEqual({
      instance: true,
      identity: true,
    });
    await lifecycle.cleanup(profile.id);
    expect(computer).toHaveBeenCalledTimes(1);
    expect(identity).toHaveBeenCalledTimes(1);
    expect(await repo.profile(profile.id)).toBeNull();
  });
  it("accepts a missing computer on retry after its successful delete reply was lost", async () => {
    await finish();
    const remove = a37.removeInstance.bind(a37);
    vi.spyOn(a37, "removeInstance").mockImplementation(async (id) => {
      if (!a37.instances.has(id))
        throw new HttpError(404, "not_found", "Already deleted");
      await remove(id);
      throw new Error("Lost delete reply");
    });
    await expect(lifecycle.cleanup(profile.id)).rejects.toThrow(
      "Lost delete reply",
    );
    expect(inkbox.identities.size).toBe(1);
    await lifecycle.cleanup(profile.id);
    expect(await repo.profile(profile.id)).toBeNull();
  });
  it("surfaces native Inkbox recovery actions and preserves its identity and retry key", async () => {
    await lifecycle.provision(profile.id);
    await lifecycle.verifyPhone(profile.id);
    const exec = a37.exec.bind(a37);
    vi.spyOn(a37, "exec").mockImplementation(async (id, command) =>
      command.includes("inkbox bootstrap")
        ? {
            exit_code: 0,
            stderr: "",
            stdout: JSON.stringify({
              status: "requires_human",
              human_actions: ["Verify this identity in Inkbox, then retry."],
            }),
          }
        : exec(id, command),
    );
    await expect(lifecycle.provision(profile.id)).rejects.toThrow(
      "Verify this identity",
    );
    const agent = (await repo.agent(profile.id))!;
    expect(agent.error).toContain("plugin_requires_human");
    expect(agent.runtimeKeyBox).toBeTruthy();
    expect(inkbox.identities.size).toBe(1);
  });
  it("retains a dated reminder whose run was skipped rather than triggered", async () => {
    const agent = await finish();
    const cron = await a37.createCron(agent.instanceId!, {
      name: "Reminder",
      schedule: "0 9 6 10 *",
      timezone: "America/Toronto",
      agent: "hermes",
      prompt: "Check in",
    });
    cron.last_run = 1;
    vi.spyOn(a37, "cronRuns").mockResolvedValue([
      {
        cronId: cron.id,
        name: cron.name,
        ran_at: 1,
        status: "skipped",
        session_id: null,
      },
    ]);
    const remove = vi.spyOn(a37, "removeCron");
    await reconcile(
      {
        repo,
        a37,
        inkbox,
        lifecycle,
        config: lifecycle.config,
        queue: { send: async () => {} },
      },
      profile.id,
    );
    expect(remove).not.toHaveBeenCalled();
  });
  it("archives fired one-time runs before removal, preserving running and unknown outcomes", async () => {
    const agent = await finish();
    const cron = await a37.createCron(agent.instanceId!, {
      name: "Reminder",
      schedule: "0 9 6 10 *",
      timezone: "America/Toronto",
      agent: "hermes",
      prompt: "Check in",
    });
    cron.last_run = 1;
    const run = {
      cronId: cron.id,
      name: cron.name,
      ran_at: 1,
      status: "triggered" as const,
      session_id: "b".repeat(32),
    };
    vi.spyOn(a37, "cronRuns").mockResolvedValue([run]);
    a37.histories.set(run.session_id, {
      id: run.session_id,
      history: [],
      active_response_id: "c".repeat(32),
    });
    const dep = {
      repo,
      a37,
      inkbox,
      lifecycle,
      config: lifecycle.config,
      queue: { send: async () => {} },
    } as Dependencies;
    vi.spyOn(repo, "archive").mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    await expect(reconcile(dep, profile.id)).rejects.toThrow();
    expect(await a37.crons(agent.instanceId!)).toHaveLength(1);
    await reconcile(dep, profile.id);
    expect(await a37.crons(agent.instanceId!)).toHaveLength(0);
    expect((await repo.archived(profile.id))[0].outcome).toBe("running");
    a37.histories.get(run.session_id)!.active_response_id = null;
    await reconcile(dep, profile.id);
    expect((await repo.archived(profile.id))[0].outcome).toBe("unknown");
  });
});
