import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  Agent,
  ComputerService,
  ComputerLinkRequest,
  Conversation,
  CronRun,
  Notification,
  Profile,
  WorkspaceItem,
  FileUpload,
} from "@boundless/shared";
import { HttpError } from "./security";

export type BetaRequest = {
  email: string;
  createdAt: string;
  approvedAt?: string;
  sentAt?: string;
  invitationBox?: string;
  expiresAt?: string;
};

export interface Repository {
  fileUploads(ownerId: string): Promise<FileUpload[]>;
  fileUpload(ownerId: string, id: string): Promise<FileUpload | null>;
  saveFileUpload(upload: FileUpload): Promise<void>;
  profile(ownerId: string): Promise<Profile | null>;
  saveProfile(profile: Profile): Promise<void>;
  acceptInvitation(profile: Profile, digest: string): Promise<void>;
  agent(ownerId: string): Promise<Agent | null>;
  saveAgent(agent: Agent): Promise<void>;
  byInstance(id: string): Promise<Agent | null>;
  customers(): Promise<Profile[]>;
  agents(): Promise<Agent[]>;
  claimInvitation(
    ownerId: string,
    email: string,
    digest: string,
  ): Promise<void>;
  createInvitation(
    email: string,
    digest: string,
    expiresAt: string,
  ): Promise<void>;
  invitations(): Promise<any[]>;
  pendingInvitation(email: string): Promise<string | null>;
  addBetaRequest(email: string): Promise<void>;
  betaRequests(): Promise<BetaRequest[]>;
  saveBetaRequest(request: BetaRequest): Promise<void>;
  computerServices(ownerId: string): Promise<ComputerService[]>;
  saveComputerService(service: ComputerService): Promise<void>;
  computerRequests(ownerId: string): Promise<ComputerLinkRequest[]>;
  computerRequest(
    ownerId: string,
    id: string,
  ): Promise<ComputerLinkRequest | null>;
  saveComputerRequest(request: ComputerLinkRequest): Promise<void>;
  items(ownerId: string, kind?: string): Promise<WorkspaceItem[]>;
  item(ownerId: string, id: string): Promise<WorkspaceItem | null>;
  saveItem(item: WorkspaceItem): Promise<void>;
  deleteItem(ownerId: string, id: string): Promise<void>;
  notifications(ownerId: string): Promise<Notification[]>;
  notify(note: Notification): Promise<void>;
  readNotifications(ownerId: string): Promise<void>;
  conversations(ownerId: string): Promise<Conversation[]>;
  saveConversation(conversation: Conversation): Promise<void>;
  archive(ownerId: string, runs: CronRun[]): Promise<void>;
  archived(ownerId: string): Promise<CronRun[]>;
  removeCustomer(ownerId: string): Promise<void>;
  locked<T>(ownerId: string, work: () => Promise<T>): Promise<T>;
}
export class MemoryRepository implements Repository {
  uploadRows = new Map<string, FileUpload>();
  async fileUploads(ownerId: string) {
    return structuredClone(
      [...this.uploadRows.values()].filter((row) => row.ownerId === ownerId),
    );
  }
  async fileUpload(ownerId: string, id: string) {
    const row = this.uploadRows.get(id);
    return row?.ownerId === ownerId ? structuredClone(row) : null;
  }
  async saveFileUpload(row: FileUpload) {
    const prior = this.uploadRows.get(row.id);
    if (
      prior &&
      ["ownerId", "instanceId", "directory", "name", "size", "sha256"].some(
        (key) =>
          prior[key as keyof FileUpload] !== row[key as keyof FileUpload],
      )
    )
      throw new HttpError(
        409,
        "upload_conflict",
        "This upload belongs to another file.",
      );
    this.uploadRows.set(row.id, structuredClone(row));
  }
  profiles = new Map<string, Profile>();
  agentRows = new Map<string, Agent>();
  itemRows = new Map<string, WorkspaceItem>();
  notes = new Map<string, Notification>();
  threads = new Map<string, Conversation>();
  runs = new Map<string, CronRun & { ownerId: string }>();
  invites = new Map<
    string,
    { email: string; expiresAt: string; usedBy?: string }
  >();
  locks = new Map<string, Promise<void>>();
  betaRows = new Map<string, BetaRequest>();
  serviceRows = new Map<string, ComputerService>();
  requestRows = new Map<string, ComputerLinkRequest>();
  async computerServices(ownerId: string) {
    return structuredClone(
      [...this.serviceRows.values()].filter((row) => row.ownerId === ownerId),
    );
  }
  async saveComputerService(row: ComputerService) {
    const prior = this.serviceRows.get(`${row.ownerId}:${row.port}`);
    if (prior && prior.instanceId !== row.instanceId)
      throw new HttpError(
        409,
        "service_conflict",
        "Service belongs to another computer.",
      );
    this.serviceRows.set(`${row.ownerId}:${row.port}`, structuredClone(row));
  }
  async computerRequests(ownerId: string) {
    return structuredClone(
      [...this.requestRows.values()].filter((row) => row.ownerId === ownerId),
    );
  }
  async computerRequest(ownerId: string, id: string) {
    const row = this.requestRows.get(id);
    return row?.ownerId === ownerId ? structuredClone(row) : null;
  }
  async saveComputerRequest(row: ComputerLinkRequest) {
    const prior = this.requestRows.get(row.id);
    if (
      prior &&
      (prior.ownerId !== row.ownerId ||
        prior.instanceId !== row.instanceId ||
        prior.port !== row.port)
    )
      throw new HttpError(409, "request_conflict", "Request id already used.");
    this.requestRows.set(row.id, structuredClone(row));
  }
  async profile(id: string) {
    return structuredClone(this.profiles.get(id) || null);
  }
  async saveProfile(row: Profile) {
    this.profiles.set(row.id, structuredClone(row));
  }
  async agent(id: string) {
    return structuredClone(this.agentRows.get(id) || null);
  }
  async saveAgent(row: Agent) {
    this.agentRows.set(row.ownerId, structuredClone(row));
  }
  async byInstance(id: string) {
    return structuredClone(
      [...this.agentRows.values()].find((agent) => agent.instanceId === id) ||
        null,
    );
  }
  async customers() {
    return [...this.profiles.values()].map((row) => structuredClone(row));
  }
  async agents() {
    return [...this.agentRows.values()].map((row) => structuredClone(row));
  }
  async claimInvitation(ownerId: string, email: string, digest: string) {
    const invitation = this.invites.get(digest);
    if (
      !invitation ||
      invitation.email !== email.toLowerCase() ||
      Date.parse(invitation.expiresAt) < Date.now() ||
      (invitation.usedBy && invitation.usedBy !== ownerId)
    )
      throw new HttpError(
        403,
        "invalid_invitation",
        "This invitation is invalid, expired, or belongs to another email.",
      );
    invitation.usedBy = ownerId;
  }
  async acceptInvitation(profile: Profile, digest: string) {
    return this.locked(`invitation:${digest}`, async () => {
      // Match the SQL transaction: publish token use only after the profile succeeds.
      const invitation = this.invites.get(digest);
      const enrolled = this.profiles.has(profile.id);
      if (
        !invitation ||
        invitation.email !== profile.email.toLowerCase() ||
        (invitation.usedBy && invitation.usedBy !== profile.id) ||
        (!(Date.parse(invitation.expiresAt) > Date.now()) &&
          !(invitation.usedBy === profile.id && enrolled))
      )
        throw new HttpError(
          403,
          "invalid_invitation",
          "This invitation is invalid, expired, or belongs to another email.",
        );
      if (!enrolled) await this.saveProfile(profile);
      invitation.usedBy = profile.id;
    });
  }
  async createInvitation(email: string, digest: string, expiresAt: string) {
    if (!this.invites.has(digest))
      this.invites.set(digest, { email: email.toLowerCase(), expiresAt });
  }
  async invitations() {
    return [...this.invites.entries()].map(([token_hash, row]) => ({
      ...row,
      token_hash,
    }));
  }
  async pendingInvitation(email: string) {
    return (
      [...this.invites.entries()].find(
        ([, invitation]) =>
          invitation.email === email.toLowerCase() &&
          !invitation.usedBy &&
          Date.parse(invitation.expiresAt) > Date.now(),
      )?.[0] || null
    );
  }
  async addBetaRequest(email: string) {
    email = email.trim().toLowerCase();
    if (!this.betaRows.has(email))
      this.betaRows.set(email, { email, createdAt: new Date().toISOString() });
  }
  async betaRequests() {
    return [...this.betaRows.values()].map((row) => structuredClone(row));
  }
  async saveBetaRequest(request: BetaRequest) {
    this.betaRows.set(request.email, structuredClone(request));
  }
  async items(ownerId: string, kind?: string) {
    return [...this.itemRows.values()]
      .filter((row) => row.ownerId === ownerId && (!kind || row.kind === kind))
      .map((row) => structuredClone(row));
  }
  async item(ownerId: string, id: string) {
    const row = this.itemRows.get(id);
    return row?.ownerId === ownerId ? structuredClone(row) : null;
  }
  async saveItem(row: WorkspaceItem) {
    const previous = this.itemRows.get(row.id);
    if (previous && previous.ownerId !== row.ownerId)
      throw new HttpError(404, "not_found", "Item not found.");
    this.itemRows.set(row.id, structuredClone(row));
  }
  async deleteItem(ownerId: string, id: string) {
    if (!(await this.item(ownerId, id)))
      throw new HttpError(404, "not_found", "Item not found.");
    this.itemRows.delete(id);
  }
  async notifications(ownerId: string) {
    return [...this.notes.values()]
      .filter((row) => row.ownerId === ownerId)
      .map((row) => structuredClone(row));
  }
  async notify(note: Notification) {
    const prior = this.notes.get(note.id);
    if (prior && prior.ownerId !== note.ownerId)
      throw new HttpError(
        409,
        "event_conflict",
        "Notification id already used.",
      );
    if (!prior) this.notes.set(note.id, structuredClone(note));
  }
  async readNotifications(ownerId: string) {
    for (const note of this.notes.values())
      if (note.ownerId === ownerId) note.readAt = new Date().toISOString();
  }
  async conversations(ownerId: string) {
    return [...this.threads.values()]
      .filter((row) => row.ownerId === ownerId)
      .map((row) => structuredClone(row));
  }
  async saveConversation(row: Conversation) {
    this.threads.set(`${row.ownerId}:${row.id}`, structuredClone(row));
  }
  async archive(ownerId: string, runs: CronRun[]) {
    for (const run of runs)
      this.runs.set(
        `${ownerId}:${run.cronId}:${run.session_id}:${run.ran_at}`,
        { ...run, ownerId },
      );
  }
  async archived(ownerId: string) {
    return [...this.runs.values()].filter((row) => row.ownerId === ownerId);
  }
  async removeCustomer(ownerId: string) {
    const email = this.profiles.get(ownerId)?.email.toLowerCase();
    for (const [digest, invitation] of this.invites)
      if (invitation.usedBy === ownerId || invitation.email === email)
        this.invites.delete(digest);
    this.profiles.delete(ownerId);
    this.agentRows.delete(ownerId);
    for (const map of [
      this.itemRows,
      this.notes,
      this.threads,
      this.runs,
      this.serviceRows,
      this.requestRows,
      this.uploadRows,
    ])
      for (const [key, value] of map)
        if (value.ownerId === ownerId) map.delete(key);
  }
  async locked<T>(ownerId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(ownerId) || Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(ownerId, next);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.locks.get(ownerId) === next) this.locks.delete(ownerId);
    }
  }
}

export class SupabaseRepository implements Repository {
  async fileUploads(ownerId: string): Promise<FileUpload[]> {
    return (
      this.check(
        await this.client
          .from("file_uploads")
          .select("upload")
          .eq("owner_id", ownerId),
      ) || []
    ).map((row) => row.upload);
  }
  async fileUpload(ownerId: string, id: string): Promise<FileUpload | null> {
    const row = this.check(
      await this.client
        .from("file_uploads")
        .select("upload")
        .eq("owner_id", ownerId)
        .eq("id", id)
        .maybeSingle(),
    );
    return row?.upload || null;
  }
  async saveFileUpload(upload: FileUpload) {
    this.check(
      await this.client
        .from("file_uploads")
        .upsert({
          id: upload.id,
          owner_id: upload.ownerId,
          instance_id: upload.instanceId,
          state: upload.state,
          expires_at: upload.expiresAt,
          upload,
        }),
    );
  }
  client: SupabaseClient;
  constructor(url: string, key: string) {
    this.client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  private check<T>(result: { data: T; error: any }): T {
    if (result.error)
      throw new HttpError(
        500,
        "database_error",
        "The workspace could not be saved. Please retry.",
      );
    return result.data;
  }
  async computerServices(ownerId: string): Promise<ComputerService[]> {
    return (
      this.check(
        await this.client
          .from("computer_services")
          .select("service")
          .eq("owner_id", ownerId),
      ) || []
    ).map((row) => row.service);
  }
  async saveComputerService(row: ComputerService) {
    this.check(
      await this.client.from("computer_services").upsert(
        {
          owner_id: row.ownerId,
          instance_id: row.instanceId,
          port: row.port,
          service: row,
        },
        { onConflict: "owner_id,port" },
      ),
    );
  }
  async computerRequests(ownerId: string): Promise<ComputerLinkRequest[]> {
    return (
      this.check(
        await this.client
          .from("computer_link_requests")
          .select("request")
          .eq("owner_id", ownerId)
          .order("created_at", { ascending: false }),
      ) || []
    ).map((row) => row.request);
  }
  async computerRequest(
    ownerId: string,
    id: string,
  ): Promise<ComputerLinkRequest | null> {
    const row = this.check(
      await this.client
        .from("computer_link_requests")
        .select("request")
        .eq("owner_id", ownerId)
        .eq("id", id)
        .maybeSingle(),
    );
    return row?.request || null;
  }
  async saveComputerRequest(row: ComputerLinkRequest) {
    const result = await this.client.from("computer_link_requests").upsert({
      id: row.id,
      owner_id: row.ownerId,
      instance_id: row.instanceId,
      port: row.port,
      kind: row.kind,
      status: row.status,
      created_at: row.createdAt,
      request: row,
    });
    if (result.error?.code === "23505")
      throw new HttpError(
        409,
        "request_conflict",
        "A request is already pending for that service.",
      );
    this.check(result);
  }
  async profile(ownerId: string) {
    const row = this.check(
      await this.client
        .from("customers")
        .select("profile")
        .eq("id", ownerId)
        .maybeSingle(),
    );
    return row?.profile || null;
  }
  async saveProfile(profile: Profile) {
    this.check(
      await this.client
        .from("customers")
        .upsert({ id: profile.id, email: profile.email, profile }),
    );
  }
  async agent(ownerId: string) {
    const row = this.check(
      await this.client
        .from("agents")
        .select("state")
        .eq("owner_id", ownerId)
        .maybeSingle(),
    );
    return row?.state || null;
  }
  async saveAgent(agent: Agent) {
    this.check(
      await this.client.from("agents").upsert({
        owner_id: agent.ownerId,
        instance_id: agent.instanceId || null,
        inkbox_handle: agent.handle || null,
        state: agent,
        updated_at: agent.updatedAt,
      }),
    );
  }
  async byInstance(id: string) {
    const row = this.check(
      await this.client
        .from("agents")
        .select("state")
        .eq("instance_id", id)
        .maybeSingle(),
    );
    return row?.state || null;
  }
  async customers() {
    return (
      this.check(await this.client.from("customers").select("profile")) || []
    ).map((row) => row.profile);
  }
  async agents() {
    return (
      this.check(await this.client.from("agents").select("state")) || []
    ).map((row) => row.state);
  }
  async claimInvitation(ownerId: string, email: string, digest: string) {
    const result = await this.client.rpc("claim_invitation", {
      p_owner_id: ownerId,
      p_email: email.toLowerCase(),
      p_hash: digest,
    });
    if (result.error)
      throw new HttpError(
        403,
        "invalid_invitation",
        "This invitation is invalid, expired, or belongs to another email.",
      );
  }
  async acceptInvitation(profile: Profile, digest: string) {
    const result = await this.client.rpc("accept_invitation", {
      p_owner_id: profile.id,
      p_email: profile.email.toLowerCase(),
      p_hash: digest,
      p_profile: profile,
    });
    if (result.error?.code === "P0001")
      throw new HttpError(
        403,
        "invalid_invitation",
        "This invitation is invalid, expired, or belongs to another email.",
      );
    this.check(result);
  }
  async createInvitation(email: string, digest: string, expiresAt: string) {
    this.check(
      await this.client.from("invitations").upsert(
        {
          email: email.toLowerCase(),
          token_hash: digest,
          expires_at: expiresAt,
        },
        { onConflict: "token_hash", ignoreDuplicates: true },
      ),
    );
  }
  async invitations() {
    return (
      this.check(
        await this.client
          .from("invitations")
          .select("id,email,expires_at,used_by,created_at,token_hash")
          .order("created_at", { ascending: false }),
      ) || []
    );
  }
  async pendingInvitation(email: string) {
    const rows = this.check(
      await this.client
        .from("invitations")
        .select("token_hash")
        .eq("email", email.toLowerCase())
        .is("used_by", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1),
    );
    return rows?.[0]?.token_hash || null;
  }
  async addBetaRequest(email: string) {
    this.check(
      await this.client
        .from("beta_requests")
        .upsert(
          { email: email.trim().toLowerCase() },
          { onConflict: "email", ignoreDuplicates: true },
        ),
    );
  }
  async betaRequests(): Promise<BetaRequest[]> {
    const rows = this.check(
      await this.client
        .from("beta_requests")
        .select("*")
        .order("created_at", { ascending: false }),
    );
    return (rows || []).map((row) => ({
      email: row.email,
      createdAt: row.created_at,
      approvedAt: row.approved_at || undefined,
      sentAt: row.sent_at || undefined,
      invitationBox: row.invitation_box || undefined,
      expiresAt: row.expires_at || undefined,
    }));
  }
  async saveBetaRequest(request: BetaRequest) {
    this.check(
      await this.client.from("beta_requests").upsert({
        email: request.email,
        created_at: request.createdAt,
        approved_at: request.approvedAt || null,
        sent_at: request.sentAt || null,
        invitation_box: request.invitationBox || null,
        expires_at: request.expiresAt || null,
      }),
    );
  }
  async items(ownerId: string, kind?: string) {
    let query = this.client
      .from("workspace_items")
      .select("item")
      .eq("owner_id", ownerId)
      .order("updated_at", { ascending: false });
    if (kind) query = query.eq("kind", kind);
    return (this.check(await query) || []).map((row) => row.item);
  }
  async item(ownerId: string, id: string) {
    const row = this.check(
      await this.client
        .from("workspace_items")
        .select("item")
        .eq("owner_id", ownerId)
        .eq("id", id)
        .maybeSingle(),
    );
    return row?.item || null;
  }
  async saveItem(item: WorkspaceItem) {
    // An explicit owner read prevents service-role upsert from taking another tenant's UUID.
    const prior = this.check(
      await this.client
        .from("workspace_items")
        .select("owner_id")
        .eq("id", item.id)
        .maybeSingle(),
    );
    if (prior && prior.owner_id !== item.ownerId)
      throw new HttpError(404, "not_found", "Item not found.");
    this.check(
      await this.client.from("workspace_items").upsert({
        id: item.id,
        owner_id: item.ownerId,
        kind: item.kind,
        item,
        updated_at: item.updatedAt,
      }),
    );
  }
  async deleteItem(ownerId: string, id: string) {
    this.check(
      await this.client
        .from("workspace_items")
        .delete()
        .eq("owner_id", ownerId)
        .eq("id", id),
    );
  }
  async notifications(ownerId: string) {
    return (
      this.check(
        await this.client
          .from("notifications")
          .select("note")
          .eq("owner_id", ownerId)
          .order("created_at", { ascending: false }),
      ) || []
    ).map((row) => row.note);
  }
  async notify(note: Notification) {
    this.check(
      await this.client
        .from("notifications")
        .upsert(
          { id: note.id, owner_id: note.ownerId, note },
          { onConflict: "id", ignoreDuplicates: true },
        ),
    );
  }
  async readNotifications(ownerId: string) {
    const rows = await this.notifications(ownerId);
    for (const note of rows.filter((row) => !row.readAt))
      this.check(
        await this.client
          .from("notifications")
          .update({ note: { ...note, readAt: new Date().toISOString() } })
          .eq("owner_id", ownerId)
          .eq("id", note.id),
      );
  }
  async conversations(ownerId: string) {
    return (
      this.check(
        await this.client
          .from("conversations")
          .select("conversation")
          .eq("owner_id", ownerId)
          .order("created_at", { ascending: false }),
      ) || []
    ).map((row) => row.conversation);
  }
  async saveConversation(conversation: Conversation) {
    this.check(
      await this.client.from("conversations").upsert(
        {
          owner_id: conversation.ownerId,
          session_id: conversation.id,
          conversation,
        },
        { onConflict: "owner_id,session_id" },
      ),
    );
  }
  async archive(ownerId: string, runs: CronRun[]) {
    if (!runs.length) return;
    this.check(
      await this.client.from("cron_archive").upsert(
        runs.map((run) => ({
          owner_id: ownerId,
          run_key: `${run.cronId}:${run.session_id}:${run.ran_at}`,
          run,
        })),
        { onConflict: "owner_id,run_key" },
      ),
    );
  }
  async archived(ownerId: string) {
    return (
      this.check(
        await this.client
          .from("cron_archive")
          .select("run")
          .eq("owner_id", ownerId),
      ) || []
    ).map((row) => row.run);
  }
  async removeCustomer(ownerId: string) {
    // The Auth deletion trigger requires both provider confirmations, erases
    // signup/invitation/job/lease records, and cascades the workspace atomically.
    const result = await this.client.auth.admin.deleteUser(ownerId);
    if (result.error && result.error.status !== 404)
      throw new HttpError(
        500,
        "auth_cleanup_failed",
        "Account cleanup needs another retry.",
      );
    this.check(await this.client.from("customers").delete().eq("id", ownerId));
  }
  async locked<T>(ownerId: string, work: () => Promise<T>): Promise<T> {
    const lease = randomUUID();
    const claim = this.check(
      await this.client.rpc("claim_customer_lease", {
        p_owner_id: ownerId,
        p_token: lease,
      }),
    );
    if (!claim)
      throw new HttpError(
        409,
        "operation_running",
        "Another operation is running for this account. Retry shortly.",
      );
    const heartbeat = setInterval(() => {
      void this.client.rpc("renew_customer_lease", {
        p_owner_id: ownerId,
        p_token: lease,
      });
    }, 30_000);
    try {
      return await work();
    } finally {
      clearInterval(heartbeat);
      await this.client.rpc("release_customer_lease", {
        p_owner_id: ownerId,
        p_token: lease,
      });
    }
  }
}
