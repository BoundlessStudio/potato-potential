import type { Express } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Dependencies } from "./app";
import { betaLease, requireInvitationEmail } from "./invitations";
import { hash, HttpError } from "./security";
import { sendSignInEmail } from "./sign-in-email";

export function registerSignInRoutes(
  app: Express,
  { config, repo, signInEmail }: Dependencies,
  authClient: SupabaseClient | null,
) {
  async function existingUser(email: string) {
    let match = null;
    for (let page = 1; ; page++) {
      const { data, error } = await authClient!.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (error)
        throw new HttpError(
          502,
          "auth_unavailable",
          "Sign-in checks are temporarily unavailable. Please try again.",
        );
      for (const user of data.users) {
        if (user.email?.trim().toLowerCase() !== email) continue;
        if (match && match.id !== user.id)
          throw new HttpError(
            409,
            "account_ownership_conflict",
            "This email is linked to more than one account. Sign-in needs an administrator’s help. No sign-in email was sent.",
          );
        match = user;
      }
      if (data.users.length < 1000) return match;
    }
  }

  // Only approved emails may receive links. Unconfirmed users need an admin
  // invite: public OTP treats them as signups even when the Auth user exists.
  app.post(
    "/api/auth/signin",
    rateLimit({
      windowMs: 60 * 60_000,
      limit: config.demo ? 1000 : 12,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    async (req, res) => {
      const { email } = z
        .object({
          email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
        })
        .parse(req.body);
      if (config.demo) return res.json({ ready: true });
      const emailSent = await repo.locked(betaLease(email), async () => {
        let user = await existingUser(email);
        const profile = user ? await repo.profile(user.id) : null;
        const invited = await repo.pendingInvitation(email);
        if (!profile && !invited && !config.operators.includes(email))
          throw new HttpError(
            403,
            "invitation_required",
            "This email hasn’t been approved for beta access. No sign-in email was sent. Join the beta list or wait for your invitation before signing in.",
          );
        if (profile && (await repo.agent(profile.id))?.status === "deleting")
          throw new HttpError(
            409,
            "account_deleting",
            "This account is closing. No sign-in email was sent. Wait for cleanup to finish before requesting a new invitation.",
          );
        if (user?.email_confirmed_at) return false;
        requireInvitationEmail(config);
        if (!user) {
          const { data } = await authClient!.auth.admin.createUser({
            email,
            email_confirm: false,
          });
          // Resolve a lost create reply or overlapping authorized request safely.
          user = data.user || (await existingUser(email));
          if (!user)
            throw new HttpError(
              502,
              "auth_unavailable",
              "Couldn’t prepare your invited account. Please try again.",
            );
        }
        // Email ownership remains unverified until this single-use token is
        // redeemed. Neither account preparation nor email delivery accepts beta.
        const { data, error } = await authClient!.auth.admin.generateLink({
          type: "invite",
          email,
        });
        if (
          error ||
          !data.properties?.hashed_token ||
          data.properties.verification_type !== "invite" ||
          data.user?.id !== user.id
        )
          throw new HttpError(
            502,
            "auth_unavailable",
            "Couldn’t create your sign-in link. Please try again.",
          );
        const url = new URL("/auth/callback", config.webOrigin);
        url.searchParams.set("token_hash", data.properties.hashed_token);
        url.searchParams.set("type", "invite");
        const message = {
          email,
          url: url.toString(),
          digest: hash(data.properties.hashed_token),
        };
        if (signInEmail) await signInEmail(message);
        else await sendSignInEmail(config, message);
        return true;
      });
      // Credentials stay in email; never return the token or a session here.
      res.json({ ready: true, emailSent });
    },
  );
}
