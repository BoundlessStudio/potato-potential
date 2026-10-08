"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Heart,
  Loader2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  ApiError,
  credential,
  joinBeta,
  sendSignInLink,
  signOut,
} from "@/lib/client";
import { Brand, Companion } from "./companion";
import { LandingPage } from "./landing-page";
import {
  downloadDestination,
  DOWNLOAD_RETURN_KEY,
} from "@/lib/download-destination";

export function PublicEntry({
  signIn = false,
  pendingEmail,
  checkingSession = false,
}: {
  signIn?: boolean;
  pendingEmail?: string;
  checkingSession?: boolean;
}) {
  const [email, setEmail] = useState(pendingEmail || "");
  const [website, setWebsite] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invitationRequired, setInvitationRequired] = useState(false);
  useEffect(() => {
    if (!signIn) return;
    const url = new URL(window.location.href);
    const invitation = url.searchParams.get("invite");
    if (invitation) localStorage.setItem("boundless-invite", invitation);
    const invitedEmail = url.searchParams.get("email");
    if (invitedEmail) setEmail(invitedEmail);
    if (url.searchParams.has("auth_error"))
      setError(
        "That sign-in link could not be used. Request a fresh one below.",
      );
    const next = downloadDestination(
      url.searchParams.get("next") || localStorage.getItem(DOWNLOAD_RETURN_KEY),
    );
    if (invitation)
      window.history.replaceState(
        {},
        "",
        `/signin${next !== "/" ? "?" + new URLSearchParams({ next }) : ""}`,
      );
    void credential()
      .then((value) => {
        if (value) window.location.replace(next);
      })
      .catch(() => {});
  }, [signIn]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || checkingSession) return;
    setBusy(true);
    setError("");
    setInvitationRequired(false);
    try {
      if (signIn)
        await sendSignInLink(
          email,
          downloadDestination(
            new URL(window.location.href).searchParams.get("next") ||
              localStorage.getItem(DOWNLOAD_RETURN_KEY),
          ),
        );
      else await joinBeta(email.trim().toLowerCase(), website);
      setSent(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please try again.");
      setInvitationRequired(
        error instanceof ApiError && error.code === "invitation_required",
      );
    } finally {
      setBusy(false);
    }
  }
  const signup = (
    <>
      <span className="eyebrow">
        {signIn ? "WELCOME BACK" : "A LITTLE TEAM OF TWO"}
      </span>
      <h2>
        {signIn
          ? "Make yourself at home."
          : pendingEmail
            ? "A little room for you."
            : "Come grow with us."}
      </h2>
      <p>
        {signIn
          ? "Use your invited email address. We’ll send you a link to sign in—no password needed."
          : pendingEmail
            ? "Your beta access is waiting for approval. Add your email below if you haven’t joined the list yet."
            : "Join the beta list. We’ll review your request and email an invitation when your place is ready."}
      </p>
      {sent ? (
        <div className="signin-confirmation" role="status">
          <CheckCircle2 size={17} />
          <span>
            {signIn
              ? "Check your email for your sign-in link. Open it in this browser to continue."
              : "You’re on the beta list. We’ll email you if your request is approved."}
          </span>
        </div>
      ) : (
        <form onSubmit={submit} className="stack">
          <label>
            Email address
            <input
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              disabled={busy || checkingSession}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </label>
          {!signIn && (
            <label className="beta-honeypot" aria-hidden="true">
              Website
              <input
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
              />
            </label>
          )}
          <button
            className="button button-primary"
            disabled={busy || checkingSession}
          >
            {busy ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <ArrowRight size={16} />
            )}
            {busy
              ? "Sending…"
              : signIn
                ? "Send a sign-in link"
                : "Join the beta list"}
          </button>
        </form>
      )}
      {error && (
        <p className="error-inline" role="alert">
          {error}
          {invitationRequired && (
            <>
              {" "}
              <Link href="/">Join the beta list</Link>
            </>
          )}
        </p>
      )}
      {sent && (
        <button
          className="text-button entry-retry"
          onClick={() => setSent(false)}
        >
          {signIn
            ? "Use another email or request a new link"
            : "Add another email"}
        </button>
      )}
      <div className="invite-note">
        <ShieldCheck size={18} />
        <span>
          {signIn
            ? "Beta access requires an approved invitation."
            : pendingEmail
              ? "Signing up joins the list. Your place needs approval."
              : "Invite-only beta. We review requests before sending invitations."}
          {(signIn || pendingEmail) && (
            <>
              <br />A little space to build something good together.
            </>
          )}
        </span>
      </div>
    </>
  );
  if (!signIn && !pendingEmail) return <LandingPage signup={signup} />;
  return (
    <main className="welcome-page">
      <div className="welcome-brand">
        <Link href="/" aria-label="Potato Potential home">
          <Brand />
        </Link>
      </div>
      <div className="welcome-navigation">
        {pendingEmail ? (
          <button className="text-button" onClick={() => void signOut()}>
            Sign out
          </button>
        ) : (
          <Link href="/" className="button button-secondary">
            Join the beta <ArrowRight size={15} />
          </Link>
        )}
      </div>
      <section className="welcome-story">
        <span className="welcome-eyebrow">
          <Sparkles size={14} />
          YOUR OWN LITTLE POSSIBILITY
        </span>
        <h1>
          A little help.
          <br />A lot of <span>possibility.</span>
        </h1>
        <p>
          A personal AI companion with a computer of their own.
          <br />
          Curious about your world. Ready to make room in it.
        </p>
        <Companion size={370} scene />
        <div className="welcome-promises">
          <span>
            <Heart size={16} />
            In your corner
          </span>
          <span>
            <Clock3 size={16} />
            Here between chats
          </span>
          <span>
            <Sparkles size={16} />
            Ready to get to work
          </span>
        </div>
      </section>
      <section className="welcome-signin">{signup}</section>
      <span className="welcome-footer">
        potato potential · good things happen together
      </span>
    </main>
  );
}
