"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, Loader2, Mail, Plus, RefreshCw } from "lucide-react";
import { api } from "@/lib/client";

type Applicant = {
  email: string;
  status: "awaiting_review" | "approved" | "accepted" | "pending" | "expired";
  accountExists: boolean;
  requestedAt?: string;
};
const labels = {
  awaiting_review: "Awaiting review",
  approved: "Approved · send needed",
  accepted: "Accepted",
  pending: "Invited",
  expired: "Invite expired",
};

export function Invitations({
  onError,
  onSuccess,
}: {
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}) {
  const [people, setPeople] = useState<Applicant[] | null>(null);
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ invitations: Applicant[] }>(
        "/operator/invitations",
      );
      setPeople(data.invitations);
      setLoadError("");
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Couldn’t load the beta list.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function add(event: FormEvent) {
    event.preventDefault();
    if (adding) return;
    setAdding(true);
    try {
      await api("/operator/beta", "POST", { email: email.trim() });
      setEmail("");
      onSuccess(
        "Email added for review. Approve it below to send an invitation.",
      );
      await load();
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "Couldn’t add this email.",
      );
    } finally {
      setAdding(false);
    }
  }
  async function approve(person: Applicant) {
    if (sending) return;
    setSending(person.email);
    try {
      const result = await api<{ email: string; demo: boolean }>(
        "/operator/invitations/send",
        "POST",
        { email: person.email },
      );
      onSuccess(
        result.demo
          ? `Preview invitation created for ${result.email}.`
          : `Invitation sent to ${result.email}.`,
      );
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "Couldn’t send this invitation.",
      );
    } finally {
      await load();
      setSending(null);
    }
  }
  return (
    <div className="invitations-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">A little room for more people</span>
          <h1>Beta list.</h1>
          <p>
            Review requests, approve the people you’re ready to invite, and see
            who has joined.
          </p>
        </div>
      </div>
      <section className="settings-card">
        <h2>Add someone to the list</h2>
        <form onSubmit={add} className="invite-form">
          <label>
            Email address
            <input
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              disabled={adding}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="someone@example.com"
            />
          </label>
          <button
            className="button button-primary"
            disabled={adding || !email.trim()}
          >
            {adding ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Plus size={16} />
            )}
            {adding ? "Adding…" : "Add email"}
          </button>
        </form>
        <p className="fine-print">
          Adding an email saves it for review. An invitation is sent only when
          you approve it below.
        </p>
      </section>
      <div className="section-heading">
        <h2>
          Requests & invitations
          {people && (
            <span className="beta-review-count">
              {
                people.filter((person) => person.status === "awaiting_review")
                  .length
              }{" "}
              awaiting review
            </span>
          )}
        </h2>
        <button
          className="text-button"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw size={15} className={loading ? "spin" : ""} />
          Refresh
        </button>
      </div>
      {loadError && (
        <p className="error-inline" role="alert">
          {loadError}
        </p>
      )}
      {people === null ? (
        !loadError && (
          <p className="fine-print" role="status">
            Loading the beta list…
          </p>
        )
      ) : people.length === 0 ? (
        <div className="settings-card invitation-empty">
          <p>
            No requests yet. People can join from the home page, or you can add
            an email above.
          </p>
        </div>
      ) : (
        <div className="invitation-table-wrap">
          <table className="invitation-table">
            <caption className="sr-only">
              Beta requests, approvals, invitation acceptance, and account
              status
            </caption>
            <thead>
              <tr>
                <th scope="col">Email address</th>
                <th scope="col">Requested</th>
                <th scope="col">Status</th>
                <th scope="col">User account</th>
                <th scope="col">Review</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.email}>
                  <td data-label="Email address">{person.email}</td>
                  <td data-label="Requested">
                    {person.requestedAt
                      ? new Date(person.requestedAt).toLocaleDateString()
                      : "—"}
                  </td>
                  <td data-label="Status">
                    <span
                      className={`status-tag ${person.status === "accepted" ? "completed" : "needs_you"}`}
                    >
                      {labels[person.status]}
                    </span>
                  </td>
                  <td data-label="User account">
                    {person.accountExists ? "Created" : "Not created"}
                  </td>
                  <td data-label="Review">
                    {["awaiting_review", "approved", "expired"].includes(
                      person.status,
                    ) ? (
                      <button
                        className="button button-primary beta-approve"
                        disabled={Boolean(sending)}
                        onClick={() => void approve(person)}
                        aria-label={`${person.status === "awaiting_review" ? "Approve and invite" : "Send invitation to"} ${person.email}`}
                      >
                        {sending === person.email ? (
                          <Loader2 size={14} className="spin" />
                        ) : person.status === "awaiting_review" ? (
                          <Check size={14} />
                        ) : (
                          <Mail size={14} />
                        )}
                        {sending === person.email
                          ? "Sending…"
                          : person.status === "awaiting_review"
                            ? "Approve & invite"
                            : person.status === "approved"
                              ? "Retry invitation"
                              : "Send new invitation"}
                      </button>
                    ) : person.status === "accepted" ? (
                      "Joined"
                    ) : (
                      "Waiting for acceptance"
                    )}
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
