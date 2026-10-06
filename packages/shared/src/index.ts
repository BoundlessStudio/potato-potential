import { z } from "zod";
import { parsePhoneNumberFromString } from "libphonenumber-js/min";

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
    action: "restart" | "update";
    phase: "queued" | "applying" | "checking" | "completed" | "failed";
    targetTemplate: string;
    requestedAt: string;
    startedAt?: string;
    finishedAt?: string;
    bootBefore?: string;
    acknowledged?: boolean;
    error?: string;
  };
  computerScreen?: { width: number; height: number };
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
};
export type Conversation = {
  ownerId: string;
  id: string;
  title: string;
  channel: "web" | "imessage" | "email" | "sms" | "voice" | "scheduled";
  createdAt: string;
};
export type Message = { role: string; content: string; timestamp?: number };
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
  agent?: string;
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
  const fields = cron.schedule.trim().split(/\s+/);
  const datePinned =
    fields.length === 5 &&
    fields.slice(0, 4).every((field) => /^\d+$/.test(field)) &&
    fields[4] === "*";
  return (
    Boolean(cron.last_run) &&
    !/^Yearly\b/i.test(cron.name) &&
    (cron.once === true || datePinned)
  );
}
export function visibleMessage(content: string): string | null {
  if (!content.startsWith("App context (from Boundless")) return content;
  const marker = "End of app context.";
  const end = content.indexOf(marker);
  return end < 0 ? null : content.slice(end + marker.length).trim() || null;
}
