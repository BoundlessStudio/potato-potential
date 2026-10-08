import { z } from "zod";

export const routineAgents = [
  "hermes",
  "openclaw",
  "claude-code",
  "codex",
  "opencode",
  "grok",
  "pi",
] as const;

export const routineNotificationSuffix =
  "\nIf there is useful news, notify the owner via Inkbox and mirror it with node ~/.boundless/workspace.mjs notify.";

export const routinePatchSchema = z
  .strictObject({
    name: z.string().max(80).optional(),
    prompt: z
      .string()
      .min(1, "Give your routine something to do.")
      .max(8000)
      .optional(),
    schedule: z
      .string()
      .refine(
        (value) => value.trim().split(/\s+/).length === 5,
        "Use five schedule fields: minute, hour, day, month, weekday.",
      )
      .optional(),
    timezone: z
      .string()
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Choose a valid timezone, such as America/Toronto.")
      .optional(),
    enabled: z.boolean().optional(),
    agent: z.enum(routineAgents).nullable().optional(),
    profile: z
      .string()
      .regex(
        /^[a-z0-9_-]+$/,
        "Profile names use lowercase letters, numbers, - or _.",
      )
      .nullable()
      .optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Choose something to change first.",
  );

export type RoutinePatch = z.infer<typeof routinePatchSchema>;
