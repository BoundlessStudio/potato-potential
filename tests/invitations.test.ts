import { expect, it, vi } from "vitest";
import { loadConfig } from "../services/control-plane/src/config";
import { sendInvitationEmail } from "../services/control-plane/src/invitations";

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
