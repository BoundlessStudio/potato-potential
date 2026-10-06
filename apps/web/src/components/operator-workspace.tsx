"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, X } from "lucide-react";
import { api, ApiError } from "@/lib/client";
import { Brand } from "./companion";
import { Invitations } from "./invitations";
import { Operator } from "./views";

type Access = "checking" | "allowed" | "signed-out" | "denied" | "error";

export function OperatorWorkspace({
  operations = false,
}: {
  operations?: boolean;
}) {
  const [access, setAccess] = useState<Access>("checking");
  const [message, setMessage] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const onError = useCallback(
    (text: string) => setMessage({ text, error: true }),
    [],
  );
  const onSuccess = useCallback(
    (text: string) => setMessage({ text, error: false }),
    [],
  );

  useEffect(() => {
    let active = true;
    // This flag comes from the verified account; operator APIs also enforce it.
    api<{ operator: boolean }>("/me")
      .then(({ operator }) => {
        if (active) setAccess(operator ? "allowed" : "denied");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setAccess(
          error instanceof ApiError && error.status === 401
            ? "signed-out"
            : "error",
        );
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  return (
    <main className="standalone operator-workspace">
      <header className="operator-page-header">
        <Brand />
        <Link href="/" className="button button-secondary">
          <ArrowLeft size={16} />
          Back to companion
        </Link>
      </header>
      {access === "checking" ? (
        <p className="operator-access" role="status">
          <Loader2 size={18} className="spin" /> Checking your account…
        </p>
      ) : access === "allowed" ? (
        operations ? (
          <Operator onError={onError} onSuccess={onSuccess} />
        ) : (
          <Invitations onError={onError} onSuccess={onSuccess} />
        )
      ) : (
        <section className="settings-card operator-access-card">
          <h1>
            {access === "signed-out"
              ? operations
                ? "Sign in to manage the beta."
                : "Sign in to manage invitations."
              : access === "denied"
                ? "Operator access only."
                : "Couldn’t check your access."}
          </h1>
          <p>
            {access === "error"
              ? "Try checking your account again."
              : "Beta invitations are available only to the verified operator account."}
          </p>
          {access === "error" ? (
            <button
              className="button button-primary"
              onClick={() => {
                setAccess("checking");
                setAttempt((value) => value + 1);
              }}
            >
              Try again
            </button>
          ) : (
            <Link href="/" className="button button-primary">
              {access === "signed-out" ? "Sign in" : "Back to companion"}
            </Link>
          )}
        </section>
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
