"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Loader2, Mail, RefreshCw } from "lucide-react";
import { api } from "@/lib/client";

type Invitation = {
  email: string;
  status: "accepted" | "pending" | "expired";
  accountExists: boolean;
};

export function Invitations({
  onError,
  onSuccess,
}: {
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}) {
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ invitations: Invitation[] }>(
        "/operator/invitations",
      );
      setInvitations(data.invitations);
      setLoadError("");
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Couldn’t load your invitations.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    try {
      const result = await api<{ email: string; demo: boolean }>(
        "/operator/invitations/send",
        "POST",
        { email: email.trim() },
      );
      setEmail("");
      onSuccess(
        result.demo
          ? `Preview invitation created for ${result.email}.`
          : `Invitation sent to ${result.email}.`,
      );
      await load();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "Couldn’t send this invitation.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="invitations-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">A little room for more people</span>
          <h1>Beta invitations.</h1>
          <p>Invite someone and see whether they’ve joined.</p>
        </div>
      </div>
      <section className="settings-card">
        <h2>Send a new invitation</h2>
        <form onSubmit={send} className="invite-form">
          <label>
            Email address
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              disabled={sending}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="someone@example.com"
            />
          </label>
          <button
            className="button button-primary"
            disabled={sending || !email.trim()}
          >
            {sending ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Mail size={16} />
            )}
            {sending ? "Sending…" : "Send invitation"}
          </button>
        </form>
        <p className="fine-print">
          We’ll email an invitation to this address. Invitations expire after
          seven days.
        </p>
      </section>
      <div className="section-heading">
        <h2>Invited users</h2>
        <button
          className="text-button"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw size={15} className={loading ? "spin" : ""} /> Refresh
        </button>
      </div>
      {loadError && (
        <p className="error-inline" role="alert">
          {loadError}
        </p>
      )}
      {invitations === null ? (
        !loadError && (
          <p className="fine-print" role="status">
            Loading invitations…
          </p>
        )
      ) : invitations.length === 0 ? (
        <div className="settings-card invitation-empty">
          <p>No invitations yet. Send your first one above.</p>
        </div>
      ) : (
        <div className="invitation-table-wrap">
          <table className="invitation-table">
            <caption className="sr-only">
              Invited users and their invitation and account status
            </caption>
            <thead>
              <tr>
                <th scope="col">Email address</th>
                <th scope="col">Invitation</th>
                <th scope="col">User account</th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((invitation) => (
                <tr key={invitation.email}>
                  <td data-label="Email address">{invitation.email}</td>
                  <td data-label="Invitation">
                    <span
                      className={`status-tag ${invitation.status === "accepted" ? "completed" : "needs_you"}`}
                    >
                      {invitation.status === "accepted"
                        ? "Accepted"
                        : invitation.status === "expired"
                          ? "Expired"
                          : "Pending"}
                    </span>
                  </td>
                  <td data-label="User account">
                    {invitation.accountExists ? "Created" : "Not created"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
