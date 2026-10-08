"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Check, Loader2, Lock, Mail, RefreshCw, Trash2, X } from "lucide-react";
import { Brand } from "./companion";
import { Modal } from "./modal";

type Applicant = {
  email: string;
  requestedAt: string;
  status: "awaiting_review" | "approved" | "accepted" | "pending" | "expired";
  accountExists: boolean;
  accountClosing?: boolean;
};
const labels = {
  awaiting_review: "Awaiting review",
  approved: "Approved · send needed",
  accepted: "Accepted",
  pending: "Invited",
  expired: "Invite expired",
};
const storageKey = "boundless-beta-access";
const base =
  process.env.NEXT_PUBLIC_CONTROL_URL ||
  (process.env.NEXT_PUBLIC_DEMO_MODE === "true" ? "http://localhost:4000" : "");

class BetaError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function betaApi<T>(
  credential: string,
  path: string,
  options: {
    email?: string;
    signal?: AbortSignal;
    method?: "GET" | "POST" | "DELETE";
    closeAccount?: boolean;
  } = {},
): Promise<T> {
  const { email, signal } = options;
  const response = await fetch(`${base}/api/beta${path}`, {
    method: options.method || (email ? "POST" : "GET"),
    headers: {
      Authorization: `Bearer ${credential}`,
      "Content-Type": "application/json",
    },
    ...(email
      ? {
          body: JSON.stringify({
            email,
            ...(options.closeAccount ? { closeAccount: true } : {}),
          }),
        }
      : {}),
    cache: "no-store",
    signal,
  });
  const body = await response.json();
  if (!response.ok)
    throw new BetaError(
      response.status,
      body.error?.message || "Couldn’t load the beta list.",
    );
  return body;
}

export function BetaWorkspace() {
  const [access, setAccess] = useState("");
  const [input, setInput] = useState("");
  const [people, setPeople] = useState<Applicant[] | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [closingPerson, setClosingPerson] = useState<Applicant | null>(null);
  const busy = loading || Boolean(sending) || Boolean(removing);
  const [message, setMessage] = useState<{
    text: string;
    error: boolean;
  } | null>(null);

  function lock() {
    sessionStorage.removeItem(storageKey);
    setAccess("");
    setPeople(null);
    setSearch("");
    setClosingPerson(null);
  }
  function onError(error: unknown) {
    if (error instanceof BetaError && error.status === 401) lock();
    setMessage({
      text:
        error instanceof Error
          ? error.message
          : "This request was interrupted. Please try again.",
      error: true,
    });
  }
  async function load(credential: string, signal?: AbortSignal) {
    setLoading(true);
    try {
      const result = await betaApi<{ requests: Applicant[] }>(
        credential,
        "/requests",
        { signal },
      );
      if (signal?.aborted) return false;
      sessionStorage.setItem(storageKey, credential);
      setAccess(credential);
      setPeople(result.requests);
      setInput("");
      return true;
    } catch (error) {
      if (signal?.aborted) return false;
      onError(error);
      return false;
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    const credential = sessionStorage.getItem(storageKey);
    if (credential) void load(credential, controller.signal);
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!access || busy || !people?.some((person) => person.accountClosing))
      return;
    const timer = setTimeout(() => void load(access), 3000);
    return () => clearTimeout(timer);
  }, [access, people, busy]);
  async function unlock(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    setMessage(null);
    await load(input.trim());
  }
  async function approve(person: Applicant) {
    if (busy || person.accountExists) return;
    setSending(person.email);
    setMessage(null);
    let authorized = true;
    try {
      const result = await betaApi<{ email: string; demo: boolean }>(
        access,
        "/invitations",
        { email: person.email },
      );
      setMessage({
        text: result.demo
          ? `Preview invitation created for ${result.email}.`
          : `Invitation sent to ${result.email}.`,
        error: false,
      });
    } catch (error) {
      authorized = !(error instanceof BetaError && error.status === 401);
      onError(error);
    } finally {
      if (authorized) await load(access);
      setSending(null);
    }
  }
  async function remove(person: Applicant) {
    if (busy) return;
    setRemoving(person.email);
    setMessage(null);
    try {
      const result = await betaApi<{
        email: string;
        removed: boolean;
        queued?: boolean;
      }>(access, "/requests", {
        email: person.email,
        method: "DELETE",
        closeAccount: person.accountExists,
      });
      setPeople(
        (current) =>
          (result.queued
            ? current?.map((row) =>
                row.email === result.email
                  ? { ...row, accountClosing: true }
                  : row,
              )
            : current?.filter((row) => row.email !== result.email)) ?? null,
      );
      setClosingPerson(null);
      setMessage({
        text: result.queued
          ? `Account closure started for ${result.email}. The beta entry will be removed when cleanup finishes.`
          : `${result.email} removed from the beta list.`,
        error: false,
      });
    } catch (error) {
      onError(error);
      if (!(error instanceof BetaError && error.status === 401))
        await load(access);
    } finally {
      setRemoving(null);
    }
  }
  const filtered = people?.filter((person) =>
    person.email.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <main className="standalone operator-workspace">
      <header className="operator-page-header">
        <Brand />
        {access && (
          <button
            className="button button-secondary"
            onClick={() => {
              lock();
              setMessage(null);
            }}
            disabled={busy}
          >
            <Lock size={16} /> Lock beta list
          </button>
        )}
      </header>
      {!access ? (
        <section className="settings-card operator-access-card">
          <h1>Open the beta list.</h1>
          <p>Enter your access token to review beta requests.</p>
          <form className="invite-form" onSubmit={unlock}>
            <label>
              Access token
              <input
                type="password"
                required
                autoComplete="current-password"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                disabled={loading}
              />
            </label>
            <button
              className="button button-primary"
              disabled={loading || !input.trim()}
            >
              {loading ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <Lock size={16} />
              )}
              {loading ? "Opening…" : "Open beta list"}
            </button>
          </form>
        </section>
      ) : (
        <div className="invitations-page">
          <div className="page-heading">
            <div>
              <h1>Beta list.</h1>
              <p>Review the people who requested beta access.</p>
            </div>
          </div>
          <div className="section-heading">
            <h2>
              Beta requests{" "}
              <span className="beta-review-count">
                {
                  people?.filter(
                    (person) =>
                      person.status === "awaiting_review" &&
                      !person.accountExists,
                  ).length
                }{" "}
                awaiting review
              </span>
            </h2>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                setMessage(null);
                void load(access);
              }}
            >
              <RefreshCw size={15} className={loading ? "spin" : ""} /> Refresh
            </button>
          </div>
          <label className="beta-search">
            Search requests
            <input
              type="search"
              placeholder="Search by email"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {!filtered?.length ? (
            <div className="settings-card invitation-empty">
              <p>
                {people?.length
                  ? "No requests match your search."
                  : "No beta requests yet."}
              </p>
            </div>
          ) : (
            <div className="invitation-table-wrap">
              <table className="invitation-table">
                <caption className="sr-only">
                  Beta requests and invitation status
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Email address</th>
                    <th scope="col">Requested</th>
                    <th scope="col">Status</th>
                    <th scope="col">User account</th>
                    <th scope="col">Review</th>
                    <th scope="col">Removal</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((person) => (
                    <tr key={person.email}>
                      <td data-label="Email address">{person.email}</td>
                      <td data-label="Requested">
                        {new Date(person.requestedAt).toLocaleDateString()}
                      </td>
                      <td data-label="Status">
                        <span
                          className={`status-tag ${person.status === "accepted" ? "completed" : "needs_you"}`}
                        >
                          {labels[person.status]}
                        </span>
                      </td>
                      <td data-label="User account">
                        {person.accountClosing
                          ? "Closing account"
                          : person.accountExists
                            ? "Created"
                            : "Not accepted"}
                      </td>
                      <td data-label="Review">
                        {person.accountExists ? (
                          "Already a user"
                        ) : person.status === "pending" ? (
                          "Waiting for acceptance"
                        ) : (
                          <button
                            className="button button-primary beta-approve"
                            disabled={busy}
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
                        )}
                      </td>
                      <td data-label="Removal">
                        <button
                          className={`button ${person.accountExists ? "button-danger" : "button-secondary"} beta-remove`}
                          disabled={busy}
                          onClick={() => {
                            if (person.accountExists) setClosingPerson(person);
                            else void remove(person);
                          }}
                          aria-label={
                            person.accountExists
                              ? `Close account for ${person.email}`
                              : `Remove ${person.email} from beta list`
                          }
                        >
                          {removing === person.email ? (
                            <Loader2 size={14} className="spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                          {removing === person.email
                            ? "Removing…"
                            : person.accountClosing
                              ? "Retry account closure"
                              : person.accountExists
                                ? "Close account"
                                : "Remove from beta list"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {closingPerson && (
        <Modal
          title="Close this account?"
          onClose={() => {
            if (!removing) setClosingPerson(null);
          }}
        >
          <p>
            Close the account for <strong>{closingPerson.email}</strong>? Their
            computer, phone identity, workspace, and beta entry will be removed.
            This cannot be undone.
          </p>
          <div className="modal-actions">
            <button
              className="button button-secondary"
              disabled={Boolean(removing)}
              onClick={() => setClosingPerson(null)}
            >
              Keep account
            </button>
            <button
              className="button button-danger"
              disabled={Boolean(removing)}
              onClick={() => void remove(closingPerson)}
            >
              {removing ? "Closing account…" : "Close account and remove"}
            </button>
          </div>
        </Modal>
      )}
      {message && (
        <div
          role={message.error ? "alert" : "status"}
          className={`toast ${message.error ? "toast-error" : ""}`}
        >
          <span>{message.text}</span>
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => setMessage(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </main>
  );
}
