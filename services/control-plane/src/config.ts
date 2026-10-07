import { z } from "zod";
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const demo = env.DEMO_MODE === "true";
  if (demo && (env.NODE_ENV === "production" || env.VERCEL))
    throw new Error("Demo mode is local-only and cannot be deployed.");
  const raw = {
    demo,
    workflows: env.VERCEL === "1" || env.CONTROL_RUNTIME === "workflow",
    streamWindowMs: Number(env.STREAM_WINDOW_MS || 240_000),
    port: Number(env.PORT || 4000),
    webOrigin: env.WEB_ORIGIN || "http://localhost:3000",
    publicUrl: env.PUBLIC_CONTROL_URL || "http://localhost:4000",
    supabaseUrl: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "",
    supabaseKey: env.SUPABASE_SERVICE_ROLE_KEY || "",
    databaseUrl: env.DATABASE_URL || "",
    agent37Key: env.AGENT37_API_KEY || "",
    inkboxKey: env.INKBOX_ADMIN_KEY || "",
    resendKey: env.RESEND_API_KEY || "",
    invitationFrom: env.INVITATION_FROM_EMAIL || env.SMTP_FROM_EMAIL || "",
    betaAccessToken: env.BETA_ACCESS_TOKEN || "",
    desktopTemplate: env.DESKTOP_TEMPLATE || "boundless-hermes-desktop@4",
    encryptionKey: env.PROVISIONING_ENCRYPTION_KEY || "",
    operators: (env.OPERATOR_EMAILS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
    budget: Number(env.DEFAULT_BUDGET_MICROS || 5_000_000),
    sms: env.ENABLE_SMS === "true",
  };
  if (!demo) {
    for (const key of [
      "supabaseUrl",
      "supabaseKey",
      "agent37Key",
      "inkboxKey",
    ] as const) {
      if (!raw[key])
        throw new Error(
          `Missing configuration: ${key}. See .env.example, or use npm run demo locally.`,
        );
    }
    z.url().startsWith("https://").parse(raw.publicUrl);
    z.url().startsWith("https://").parse(raw.webOrigin);
    if (!/^[a-f0-9]{64}$/i.test(raw.encryptionKey))
      throw new Error(
        "PROVISIONING_ENCRYPTION_KEY must contain 32 bytes encoded as hex.",
      );
    if (!raw.operators.length)
      throw new Error("At least one OPERATOR_EMAILS address is required.");
    if (!/^[a-z0-9-]+@[a-zA-Z0-9.]+$/.test(raw.desktopTemplate))
      throw new Error(
        "DESKTOP_TEMPLATE must pin a published template revision, such as boundless-hermes-desktop@4.",
      );
  }
  if (!Number.isSafeInteger(raw.budget) || raw.budget < 0)
    throw new Error("DEFAULT_BUDGET_MICROS must be a nonnegative integer.");
  if (
    !Number.isFinite(raw.streamWindowMs) ||
    raw.streamWindowMs < 10 ||
    raw.streamWindowMs > 240_000
  )
    throw new Error("STREAM_WINDOW_MS must be between 10 and 240000.");
  return raw;
}
export type Config = ReturnType<typeof loadConfig>;
