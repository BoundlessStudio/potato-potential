import { expect, it, vi } from "vitest";
import { loadConfig } from "../services/control-plane/src/config";
import { sendInvitationEmail } from "../services/control-plane/src/invitations";
import { sendSignInEmail } from "../services/control-plane/src/sign-in-email";

const config = {
  ...loadConfig({ DEMO_MODE: "true" }),
  demo: false,
  resendKey: "test-resend-key",
  invitationFrom: "invites@example.com",
};
const invitation = {
  email: "friend@example.com",
  url: "https://example.com/?invite=bound-to-recipient",
  digest: "invitation-digest",
};

it("sends the registered link through Resend with the verified sender and idempotency header", async () => {
  const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
    const body = JSON.parse(options!.body as string);
    expect(body).toMatchObject({
      from: "Potato Potential <invites@example.com>",
      to: [invitation.email],
    });
    expect(body.text).toContain(invitation.url);
    expect(body.html).toContain(`href="${invitation.url}"`);
    expect(body.text).toContain("seven days");
    return new Response(JSON.stringify({ id: "resend-email-id" }), {
      status: 200,
    });
  });
  await sendInvitationEmail(config, invitation, fetcher);
  expect(fetcher).toHaveBeenCalledWith(
    "https://api.resend.com/emails",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        "Idempotency-Key": `beta-invitation/${invitation.digest}`,
      }),
    }),
  );
});
it.each([
  new Response(JSON.stringify({ message: "private provider error" }), {
    status: 403,
  }),
  new Response("{}", { status: 200 }),
])(
  "rejects provider failures without exposing their payload",
  async (response) => {
    const fetcher = vi.fn<typeof fetch>(async () => response);
    await expect(
      sendInvitationEmail(config, invitation, fetcher),
    ).rejects.toMatchObject({ status: 502, code: "invitation_email_failed" });
  },
);
it("does not send email in preview or when the sender is unconfigured", async () => {
  const fetcher = vi.fn<typeof fetch>();
  await sendInvitationEmail({ ...config, demo: true }, invitation, fetcher);
  await expect(
    sendInvitationEmail({ ...config, resendKey: "" }, invitation, fetcher),
  ).rejects.toMatchObject({ code: "email_not_configured" });
  expect(fetcher).not.toHaveBeenCalled();
});

it("sends first sign-in through the registered sender with a single-use verification link and the existing branding", async () => {
  const signIn = {
    ...invitation,
    url: "https://example.com/auth/callback?token_hash=private-token&type=invite",
  };
  const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
    const body = JSON.parse(options!.body as string);
    expect(body).toMatchObject({
      from: "Potato Potential <invites@example.com>",
      to: [signIn.email],
      subject: "Your sign-in link to Potato Potential",
    });
    expect(body.text).toContain(signIn.url);
    expect(body.html).toContain(
      'href="https://example.com/auth/callback?token_hash=private-token&amp;type=invite"',
    );
    expect(body.html).toContain("#9574ED");
    expect(body.text).toContain("can be used once");
    return Response.json({ id: "signin-email-id" });
  });
  await sendSignInEmail(config, signIn, fetcher);
  expect(fetcher).toHaveBeenCalledWith(
    "https://api.resend.com/emails",
    expect.objectContaining({
      headers: expect.objectContaining({
        "Idempotency-Key": `auth-signin/${signIn.digest}`,
      }),
    }),
  );
});

it.each([503, 200])(
  "reports unacknowledged sign-in mail as an error for provider status %s",
  async (status) => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ message: "private mail-provider error" }, { status }),
    );
    await expect(
      sendSignInEmail(config, invitation, fetcher),
    ).rejects.toMatchObject({
      status: 502,
      code: "signin_email_failed",
      message: "Couldn’t confirm sending your sign-in email. Please try again.",
    });
  },
);
