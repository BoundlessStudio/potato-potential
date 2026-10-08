import { z } from "zod";
import { parsePhoneNumberFromString } from "libphonenumber-js/min";
export {
  MAX_BUDGET_MICROS,
  budgetUpdateSchema,
  type InstanceBudget,
} from "./budget";
export type { InstanceUsage, ServiceUsage } from "./usage";
export {
  routineAgents,
  routineNotificationSuffix,
  routinePatchSchema,
  type RoutinePatch,
} from "./routines";

export const phoneSchema = z
  .string()
  .trim()
  .max(80)
  .transform((value, ctx) => {
    const phone = value.startsWith("+")
      ? parsePhoneNumberFromString(value, { extract: false })
      : undefined;
    if (!phone?.isPossible() || phone.ext) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a complete mobile number with its country code.",
      });
      return z.NEVER;
    }
    return phone.number;
  });

export const avatars = ["sprout", "orbit", "pebble", "spark"] as const;
export const colors = [
  "#7659e8",
  "#e87952",
  "#328a78",
  "#d45d9c",
  "#497bbf",
] as const;
export const profileSchema = z.object({
  name: z.string().trim().min(1).max(60),
  agentName: z.string().trim().min(1).max(40),
  avatar: z.enum(avatars),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  phone: phoneSchema,
  timezone: z
    .string()
    .max(80)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "Choose a valid timezone."),
  personality: z.string().trim().max(4000),
  preferences: z.string().max(4000).default(""),
});
export type ProfileInput = z.infer<typeof profileSchema>;
export type Profile = ProfileInput & {
  id: string;
  email: string;
  createdAt: string;
};
export type SetupPhase =
  "identity" | "computer" | "phone" | "plugin" | "persona" | "ready";
export type Agent = {
  ownerId: string;
  instanceId?: string;
  handle?: string;
  identityId?: string;
  agentEmail?: string;
  webhookUrl?: string;
  phase: SetupPhase;
  completed: SetupPhase[];
  status:
    | "new"
    | "provisioning"
    | "awaiting_phone"
    | "ready"
    | "failed"
    | "deleting"
    | "deleted";
  error?: string;
  callbackHash?: string;
  callbackSecretBox?: string;
  runtimeKeyBox?: string;
  runtimeKeyId?: string;
  phoneChallengeBox?: string;
  phoneChallengeExpires?: string;
  phoneVerifiedAt?: string;
  budgetMicros: number;
  mainSessionId?: string;
  suspended?: boolean;
  suspensionOperation?: {
    id: string;
    suspended: boolean;
    phase: "pending" | "completed";
    requestedAt: string;
  };
  computerOperation?: {
    id: string;
    action: "restart" | "update" | "backup" | "restore";
    phase: "queued" | "applying" | "checking" | "completed" | "failed";
    targetTemplate: string;
    requestedAt: string;
    startedAt?: string;
    finishedAt?: string;
    bootBefore?: string;
    acknowledged?: boolean;
    rejected?: boolean;
    checkingAt?: string;
    error?: string;
    backupId?: string;
    backupsBefore?: string[];
    restored?: boolean;
    reconciled?: boolean;
  };
  backupAttemptedAt?: string;
  checkpointRequests?: {
    id: string;
    action: "backup" | "restore";
    backupId?: string;
  }[];
  computerScreen?: { width: number; height: number };
  computerHelperVersion?: number;
  workspaceHelperVersion?: number;
  fileTransferVersion?: number;
  connect?: { number: string; command: string; smsLink: string; qr: string };
  sms?: { id: string; number: string; status: string };
  deletion?: { instance: boolean; identity: boolean };
  updatedAt: string;
};
export type PublicAgent = Omit<
  Agent,
  | "callbackHash"
  | "callbackSecretBox"
  | "runtimeKeyBox"
  | "runtimeKeyId"
  | "phoneChallengeBox"
  | "checkpointRequests"
> & { phoneChallenge?: string };
export function publicAgent(
  agent: Agent,
  phoneChallenge?: string,
): PublicAgent {
  const {
    callbackHash: _hash,
    callbackSecretBox: _secret,
    runtimeKeyBox: _runtime,
    runtimeKeyId: _key,
    phoneChallengeBox: _challenge,
    checkpointRequests: _receipts,
    ...safe
  } = agent;
  return { ...safe, ...(phoneChallenge ? { phoneChallenge } : {}) };
}
export const itemKinds = [
  "task",
  "wiki",
  "suggestion",
  "responsibility",
] as const;
export const itemStatuses = [
  "todo",
  "in_progress",
  "needs_you",
  "completed",
  "failed",
] as const;
export const itemSchema = z.object({
  id: z.uuid().optional(),
  kind: z.enum(itemKinds),
  title: z.string().trim().min(1).max(160),
  body: z.string().max(30000).default(""),
  status: z.enum(itemStatuses).default("todo"),
  dueAt: z.iso.datetime().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type WorkspaceItem = z.infer<typeof itemSchema> & {
  id: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
};
export type Notification = {
  id: string;
  ownerId: string;
  text: string;
  createdAt: string;
  readAt?: string;
  sessionId?: string;
  target?: { view: "computer"; requestId: string };
};

export const signedLinkDurations = [900, 3600, 86400, 604800] as const;
export type ComputerMetrics = {
  series: {
    cpu_cores: [number, number][];
    memory_bytes: [number, number][];
    disk_bytes: [number, number][];
  };
  limits: { cpu_cores: number; memory_bytes: number; disk_bytes: number };
  hours: number;
  step_seconds: number;
  fetched_at: number;
};
export type ComputerBackup = {
  id: string;
  kind: "automatic" | "manual";
  created: number;
  size_bytes: number;
};
export type ComputerService = {
  ownerId: string;
  instanceId: string;
  port: number;
  label: string;
  createdAt: string;
  state: "unknown" | "running" | "not_running";
  checkedAt?: string;
  publicRemoval?: {
    phase: "queued" | "failed";
    attempts: number;
    error?: string;
  };
};
export type ComputerLinkRequest = {
  id: string;
  ownerId: string;
  instanceId: string;
  port: number;
  label: string;
  reason: string;
  kind: "signed" | "public";
  ttlSeconds?: number;
  source: "owner" | "agent";
  status:
    "pending" | "publishing" | "approved" | "rejected" | "failed" | "revoked";
  createdAt: string;
  decidedAt?: string;
  expiresAt?: string;
  urlBox?: string;
  notificationId?: string;
  attempts: number;
  error?: string;
};
export type PublicComputerLink = Omit<
  ComputerLinkRequest,
  "urlBox" | "notificationId" | "attempts" | "status"
> & {
  status: ComputerLinkRequest["status"] | "expired";
  url?: string;
};
export type Conversation = {
  ownerId: string;
  id: string;
  title: string;
  channel: "web" | "imessage" | "email" | "sms" | "voice" | "scheduled";
  createdAt: string;
};
export type Message = { role: string; content: string; timestamp?: number };
export const UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 100_000_000;
export const DEFAULT_UPLOAD_DIRECTORY = "/home/node/uploads";
export type DirectoryListing = {
  path: string;
  parentPath: string | null;
  directories: { name: string; path: string; hidden: boolean }[];
  truncated: boolean;
};
export type FileEntry = {
  name: string;
  path: string;
  type: "file";
  size: number;
  modified: number;
  hidden: boolean;
};
export type BrowserEntry = Omit<FileEntry, "type" | "size"> & {
  type: "file" | "directory" | "symlink" | "other";
  size: number | null;
};
export type FileListing = {
  path: string;
  parentPath: string | null;
  entries: BrowserEntry[];
  truncated: boolean;
};
export type FileUpload = {
  id: string;
  ownerId: string;
  instanceId: string;
  directory: string;
  name: string;
  purpose?: "chat" | "files";
  size: number;
  sha256: string;
  chunks: Record<string, string>;
  state: "uploading" | "finalizing" | "completed" | "cancelled" | "expired";
  target?: string;
  file?: FileEntry;
  createdAt: string;
  expiresAt: string;
  cleanedAt?: string;
};
export function fileDownloadUrl(instance: string, path: string) {
  return `/api/files/content?${new URLSearchParams({ instance, path })}`;
}
export function fileAttachmentText(
  instance: string,
  files: { name: string; path: string }[],
) {
  return files.length
    ? "\n\nUploaded files:\n" +
        files
          .map(
            (file) =>
              `- [${file.name.replace(/[\\\[\]]/g, "\\$&").replace(/[\r\n]/g, " ")}](${fileDownloadUrl(instance, file.path)})`,
          )
          .join("\n")
    : "";
}
export type Session = {
  id: string;
  active_response_id: string | null;
  history: Message[];
};
export type Cron = {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  timezone: string;
  enabled: boolean;
  last_run: number | null;
  next_run: number | null;
  agent?: string | null;
  profile?: string | null;
  once?: boolean;
};
export type CronRun = {
  cronId: string;
  name: string;
  ran_at: number;
  status: "triggered" | "skipped";
  session_id: string | null;
  reason?: string | null;
  outcome?: "running" | "completed" | "failed" | "unknown";
};
export type Toolkit = {
  slug: string;
  name: string;
  description: string;
  logo?: string;
  enabled?: boolean;
  isNoAuth?: boolean;
};
export type Connection = {
  id: string;
  toolkitSlug: string;
  toolkitName?: string;
  status: string;
};
export type StreamEvent = { event: string; data: Record<string, unknown> };

// Frame-based parsing handles split UTF-8 chunks, CRLF, comments and multiline data.
export async function* parseSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const boundary = /\r?\n\r?\n/g;
      let match: RegExpExecArray | null;
      while ((match = boundary.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        boundary.lastIndex = 0;
        const lines = frame.split(/\r?\n/);
        const event = lines
          .find((line) => line.startsWith("event:"))
          ?.slice(6)
          .trim();
        const payload = lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (event && payload)
          yield { event, data: JSON.parse(payload) as Record<string, unknown> };
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

export const personaStart = "<!-- boundless:persona -->";
export const personaEnd = "<!-- /boundless:persona -->";
export function mergePersona(current: string, block: string): string {
  const start = current.indexOf(personaStart);
  const end = current.indexOf(personaEnd);
  if (start >= 0 !== end >= 0 || (start >= 0 && end < start))
    throw new Error("Persona markers are damaged. Repair them before saving.");
  const rest =
    start < 0
      ? current
      : current.slice(0, start) + current.slice(end + personaEnd.length);
  return `${personaStart}\n${block}\n${personaEnd}\n\n${rest.trim()}\n`;
}
export function ownerIdFromCallback(
  instanceId: string,
  agents: Agent[],
): string | undefined {
  return agents.find(
    (agent) => agent.instanceId === instanceId && agent.status !== "deleted",
  )?.ownerId;
}
export function isFiredOneTime(cron: Cron): boolean {
  if (!cron.last_run || /^Yearly\b/i.test(cron.name)) return false;
  const fields = cron.schedule.trim().split(/\s+/);
  const datePinned =
    fields.length === 5 &&
    fields.slice(0, 4).every((field) => /^\d+$/.test(field)) &&
    fields[4] === "*";
  if (!datePinned) return cron.once === true;
  // PATCH keeps last_run. An older firing must not remove a rescheduled reminder.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: cron.timezone,
    minute: "numeric",
    hour: "numeric",
    hourCycle: "h23",
    day: "numeric",
    month: "numeric",
  }).formatToParts(new Date(cron.last_run * 1000));
  const part = (type: string) =>
    Number(parts.find((value) => value.type === type)!.value);
  return (
    part("day") === Number(fields[2]) &&
    part("month") === Number(fields[3]) &&
    part("hour") * 60 + part("minute") >=
      Number(fields[1]) * 60 + Number(fields[0])
  );
}
export function visibleMessage(content: string): string | null {
  if (!content.startsWith("App context (from Boundless")) return content;
  const marker = "End of app context.";
  const end = content.indexOf(marker);
  return end < 0 ? null : content.slice(end + marker.length).trim() || null;
}
