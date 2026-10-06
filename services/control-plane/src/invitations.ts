import type { Config } from "./config";
import { HttpError } from "./security";

export type InvitationEmail = { email: string; url: string; digest: string };

export function requireInvitationEmail(config: Config) {
  if (!config.demo && (!config.resendKey || !config.invitationFrom))
    throw new HttpError(
      503,
      "email_not_configured",
      "Invitation email is not configured yet.",
    );
}

export async function sendInvitationEmail(
  config: Config,
  { email, url, digest }: InvitationEmail,
  fetcher: typeof fetch = fetch,
) {
  requireInvitationEmail(config);
  if (config.demo) return;
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char]!,
    );
  try {
    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.resendKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `beta-invitation/${digest}`,
      },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        from: `Potato Potential <${config.invitationFrom}>`,
        to: [email],
        subject: "You’re invited to Potato Potential",
        text: `You’re invited to the Potato Potential beta.\n\nMeet a personal companion with a computer of their own.\n\nAccept your invitation: ${url}\n\nSign in with ${email}. This invitation expires in seven days.\n\nIf you weren’t expecting this invitation, you can ignore it.`,
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:32px auto;padding:28px;color:#514165"><img src="${escape(config.webOrigin)}/brand/potato-potential-wordmark.png" width="220" height="65" alt="Potato Potential" style="display:block;width:220px;max-width:100%;height:auto;margin-bottom:28px" /><h1 style="font-size:26px">A little invitation.</h1><p>You’re invited to the Potato Potential beta. Meet a personal companion with a computer of their own.</p><p style="margin:28px 0"><a href="${escape(url)}" style="background:#7659e8;color:white;padding:14px 22px;border-radius:10px;text-decoration:none">Accept invitation</a></p><p>Sign in with <strong>${escape(email)}</strong>. Your invitation expires in seven days.</p><p style="font-size:12px;color:#887897">If you weren’t expecting this invitation, you can ignore it.</p></div>`,
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || typeof body?.id !== "string")
      throw new Error("Email not acknowledged");
  } catch {
    // A timeout can happen after sending. Retain the registered invitation so its link works.
    throw new HttpError(
      502,
      "invitation_email_failed",
      "Couldn’t confirm sending this invitation. Please try again.",
    );
  }
}
