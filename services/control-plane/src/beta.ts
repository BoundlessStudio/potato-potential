import { Router, type Express } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Dependencies } from "./app";
import { hash, HttpError, matchesHash, seal, token, unseal } from "./security";
import {
  betaLease,
  requireInvitationEmail,
  sendInvitationEmail,
} from "./invitations";

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

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
    const ids = new Set<string>();
    const byEmail = new Map<string, Set<string>>();
    const remember = (email: string, id: string) => {
      const canonical = email.trim().toLowerCase();
      const owners = byEmail.get(canonical) || new Set<string>();
      owners.add(id);
      byEmail.set(canonical, owners);
    };
    if (config.demo) {
      for (const profile of await repo.customers()) {
        ids.add(profile.id);
        remember(profile.email, profile.id);
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
          if (user.email) {
            remember(user.email, user.id);
          }
          ids.add(user.id);
        }
        if (data.users.length < 1000) break;
      }
    }
    const enrolled = new Set(
      (await repo.customers()).map((profile) => profile.id),
    );
    return { ids, byEmail, enrolled };
  }

  function accountOwners(
    email: string,
    invitations: Awaited<ReturnType<typeof repo.invitations>>,
    existing: Awaited<ReturnType<typeof accounts>>,
  ) {
    const owners = new Set(existing.byEmail.get(email));
    for (const row of invitations) {
      const owner = row.used_by || row.usedBy;
      if (row.email.toLowerCase() === email && existing.ids.has(owner))
        owners.add(owner);
    }
    return [...owners];
  }

  router.get("/requests", async (_req, res) => {
    const requests = await repo.betaRequests();
    if (!requests.length) return res.json({ requests: [] });
    const invitations = await repo.invitations();
    const existing = await accounts();
    const closing = new Set(
      (await repo.agents())
        .filter((agent) => agent.status === "deleting")
        .map((agent) => agent.ownerId),
    );
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
            [...(existing.byEmail.get(request.email) || [])].some((id) =>
              existing.enrolled.has(id),
            ) ||
            previous.some((row) => existing.ids.has(row.used_by || row.usedBy)),
          accountClosing: accountOwners(request.email, previous, existing).some(
            (owner) => closing.has(owner),
          ),
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

  router.delete("/requests", async (req, res) => {
    const { email, closeAccount } = z
      .object({
        email: emailSchema,
        closeAccount: z.boolean().default(false),
      })
      .parse(req.body);
    const queued = await repo.locked(betaLease(email), async () => {
      if (
        !(await repo.betaRequests()).some((request) => request.email === email)
      )
        return false;
      const owners = accountOwners(
        email,
        await repo.invitations(),
        await accounts(),
      );
      if (owners.length > 1)
        throw new HttpError(
          409,
          "account_ownership_conflict",
          "This email is linked to more than one account. Resolve the account ownership before closing it.",
        );
      const owner = owners[0];
      if (owner) {
        const profile = await repo.profile(owner);
        if (profile && !closeAccount)
          throw new HttpError(
            409,
            "account_exists",
            "This person has an account. Choose Close account to remove them from the beta list.",
          );
        if (profile) {
          await dep.lifecycle.requestCleanup(owner);
          await dep.queue.send("cleanup", owner);
          return true;
        }
        // Auth-only accounts have no companion resources to enqueue for cleanup.
        await dep.lifecycle.cleanup(owner, { unenrolledOnly: true });
      }
      await repo.removeBetaRequest(email);
      return false;
    });
    res.status(queued ? 202 : 200).json({ email, removed: !queued, queued });
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
      if (accountOwners(email, previous, existing).length > 1)
        throw new HttpError(
          409,
          "account_ownership_conflict",
          "This email is linked to more than one account. Resolve the account ownership before inviting it.",
        );
      if (
        [...(existing.byEmail.get(email) || [])].some((id) =>
          existing.enrolled.has(id),
        ) ||
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
