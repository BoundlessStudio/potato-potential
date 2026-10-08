import type { Config } from "./config";
import { requireInvitationEmail, type InvitationEmail } from "./invitations";
import { HttpError } from "./security";

export async function sendSignInEmail(
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
        "Idempotency-Key": `auth-signin/${digest}`,
      },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        from: `Potato Potential <${config.invitationFrom}>`,
        to: [email],
        subject: "Your sign-in link to Potato Potential",
        text: `Sign in to Potato Potential\n\nOpen your sign-in link: ${url}\n\nThis link verifies ${email} and can be used once. Open it in the browser where you requested it.\n\nIf you didn’t request this email, you can ignore it.`,
        html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:32px auto;padding:28px;background:#ffffff;color:#000000"><img src="${escape(config.webOrigin)}/brand/potato-potential-wordmark.png" width="220" height="65" alt="Potato Potential" style="display:block;width:220px;max-width:100%;height:auto;margin-bottom:28px" /><h1 style="font-size:28px;line-height:36px">Make yourself at home.</h1><p>Here’s your link to sign in to Potato Potential.</p><p style="margin:28px 0"><a href="${escape(url)}" style="display:inline-block;background:#9574ED;color:#000000;padding:18px 24px;border-radius:12px;font-weight:bold;text-decoration:none">Sign in to Potato Potential</a></p><p>This link verifies <strong>${escape(email)}</strong> and can be used once. Open it in the browser where you requested it.</p><p style="font-size:13px;line-height:22px">Button not working? <a href="${escape(url)}" style="color:#000000">Open your sign-in link</a>.</p><p style="font-size:12px;line-height:20px">If you didn’t request this email, you can ignore it.</p></div>`,
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || typeof body?.id !== "string")
      throw new Error("Email not acknowledged");
  } catch {
    throw new HttpError(
      502,
      "signin_email_failed",
      "Couldn’t confirm sending your sign-in email. Please try again.",
    );
  }
}
