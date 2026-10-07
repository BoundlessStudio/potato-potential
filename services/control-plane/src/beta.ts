import { Router, type Express } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Dependencies } from "./app";
import { hash, HttpError, matchesHash, seal, token, unseal } from "./security";
import { requireInvitationEmail, sendInvitationEmail } from "./invitations";

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
const betaLease = (email: string) => {
  const value = hash(`beta:${email}`);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
};

export function registerBetaRoutes(
  app: Express,
  dep: Dependencies,
  authClient: SupabaseClient | null,
) {
  const { config, repo } = dep;
  const router = Router();
  router.use(
    rateLimit({
      windowMs: 15 * 60_000,
      limit: config.demo ? 1000 : 30,
      skipSuccessfulRequests: true,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        error: {
          code: "rate_limited",
          message: "Please try opening the beta list again later.",
        },
      },
    }),
  );
  router.use((req, _res, next) => {
    if (!config.betaAccessToken)
      throw new HttpError(
        503,
        "beta_not_configured",
        "Beta access is not configured yet.",
      );
    const credential =
      req.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
    if (!matchesHash(credential, hash(config.betaAccessToken)))
      throw new HttpError(401, "unauthorized", "The access token is invalid.");
    next();
  });

  async function accounts() {
    const emails = new Set<string>(),
      ids = new Set<string>();
    if (config.demo) {
      for (const profile of await repo.customers()) {
        emails.add(profile.email.toLowerCase());
        ids.add(profile.id);
      }
    } else {
      for (let page = 1; ; page++) {
        const { data, error } = await authClient!.auth.admin.listUsers({
          page,
          perPage: 1000,
        });
        if (error)
          throw new HttpError(
            502,
            "account_lookup_failed",
            "Couldn’t check user accounts. Please try again.",
          );
        for (const user of data.users) {
          if (user.email) emails.add(user.email.toLowerCase());
          ids.add(user.id);
        }
        if (data.users.length < 1000) break;
      }
    }
    return { emails, ids };
  }

  router.get("/requests", async (_req, res) => {
    const requests = await repo.betaRequests();
    if (!requests.length) return res.json({ requests: [] });
    const invitations = await repo.invitations();
    const existing = await accounts();
    res.json({
      requests: requests.map((request) => {
        const previous = invitations.filter(
          (row) => row.email.toLowerCase() === request.email,
        );
        const accepted = previous.some((row) => row.used_by || row.usedBy);
        const pending = previous.some(
          (row) =>
            !(row.used_by || row.usedBy) &&
            Date.parse(row.expires_at || row.expiresAt) > Date.now(),
        );
        return {
          email: request.email,
          requestedAt: request.createdAt,
          approvedAt: request.approvedAt,
          sentAt: request.sentAt,
          accountExists:
            existing.emails.has(request.email) ||
            previous.some((row) => existing.ids.has(row.used_by || row.usedBy)),
          status:
            request.approvedAt && !request.sentAt
              ? "approved"
              : pending
                ? "pending"
                : accepted
                  ? "accepted"
                  : previous.length
                    ? "expired"
                    : "awaiting_review",
        };
      }),
    });
  });

  router.post("/invitations", async (req, res) => {
    const { email } = z.object({ email: emailSchema }).parse(req.body);
    await repo.locked(betaLease(email), async () => {
      const request = (await repo.betaRequests()).find(
        (row) => row.email === email,
      );
      if (!request)
        throw new HttpError(
          404,
          "beta_request_not_found",
          "This email has not requested beta access.",
        );
      const previous = (await repo.invitations()).filter(
        (row) => row.email.toLowerCase() === email,
      );
      const existing = await accounts();
      if (
        existing.emails.has(email) ||
        previous.some((row) => existing.ids.has(row.used_by || row.usedBy))
      )
        throw new HttpError(
          409,
          "account_exists",
          "This email already has a user account. No invitation was sent.",
        );
      requireInvitationEmail(config);
      const key = config.demo ? "a".repeat(64) : config.encryptionKey;
      const registered = request.invitationBox
        ? previous.find(
            (row) =>
              row.token_hash === hash(unseal(request.invitationBox!, key)),
          )
        : undefined;
      const active = previous.find(
        (row) =>
          !(row.used_by || row.usedBy) &&
          Date.parse(row.expires_at || row.expiresAt) > Date.now(),
      );
      if (active && active !== registered)
        throw new HttpError(
          409,
          "invitation_pending",
          "An active invitation already exists for this email.",
        );
      if (request.sentAt && active === registered && active) return;
      if (
        !registered ||
        registered.used_by ||
        registered.usedBy ||
        Date.parse(request.expiresAt || "") <= Date.now()
      ) {
        request.invitationBox = seal(token(), key);
        request.expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
        request.sentAt = undefined;
      }
      request.approvedAt ||= new Date().toISOString();
      // Save the retry credential before delivery; failed sends reuse the same invitation.
      await repo.saveBetaRequest(request);
      const invitation = unseal(request.invitationBox!, key),
        digest = hash(invitation);
      await repo.createInvitation(email, digest, request.expiresAt!);
      const url = `${config.webOrigin}/signin?invite=${invitation}&email=${encodeURIComponent(email)}`;
      await (
        dep.invitationEmail || ((input) => sendInvitationEmail(config, input))
      )({ email, url, digest });
      request.sentAt = new Date().toISOString();
      await repo.saveBetaRequest(request);
    });
    res.status(201).json({ email, sent: !config.demo, demo: config.demo });
  });
  app.use("/api/beta", router);
}
