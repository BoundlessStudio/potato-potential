"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { phoneSchema } from "@boundless/shared";
import { api, request } from "@/lib/client";
import styles from "./contact-number-settings.module.css";

export function ContactNumberSettings({
  agentName,
  ownNumber,
  routerNumber,
  onSuccess,
}: {
  agentName: string;
  ownNumber: string;
  routerNumber?: string;
  onSuccess: (message: string) => void;
}) {
  const [number, setNumber] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const parsed = phoneSchema.safeParse(value);
  const next = !value.trim() ? null : parsed.success ? parsed.data : undefined;
  const validation =
    next === undefined
      ? "Enter the full number, including + and its country code."
      : next &&
          [ownNumber, routerNumber].some((value) => {
            const phone = phoneSchema.safeParse(value);
            return phone.success && phone.data === next;
          })
        ? `Use ${agentName}’s number from their contact card, rather than your number or the Inkbox connection number.`
        : "";
  const busy = loading || saving;
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const response = await request("/contact-number", { signal });
      const result = (await response.json()) as { number: string | null };
      if (!signal?.aborted) {
        setNumber(result.number);
        setValue(result.number || "");
        setLoaded(true);
      }
    } catch (cause) {
      if (!signal?.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Couldn’t load the contact number.",
        );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  async function save(next: string | null) {
    if (busy || !loaded) return;
    setSaving(true);
    setError("");
    try {
      const result = await api<{ number: string | null }>(
        "/contact-number",
        "PUT",
        { number: next, expectedNumber: number },
      );
      setNumber(result.number);
      setValue(result.number || "");
      onSuccess(
        result.number
          ? `${agentName}’s contact number saved.`
          : "Saved contact number removed.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn’t save the contact number. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (next !== undefined && !validation && next !== number) void save(next);
  }
  return (
    <form
      className={styles.form}
      onSubmit={submit}
      aria-label="Companion contact number"
      aria-busy={busy}
    >
      <label htmlFor="companion-contact-number">
        {agentName}’s contact number
      </label>
      <input
        id="companion-contact-number"
        type="tel"
        autoComplete="off"
        placeholder="+1 234 567 8900"
        value={value}
        disabled={busy || !loaded}
        aria-describedby="companion-contact-number-help"
        aria-invalid={Boolean(validation)}
        onChange={(event) => {
          setValue(event.target.value);
          setError("");
        }}
      />
      <p id="companion-contact-number-help" className="fine-print">
        Copy the number from {agentName}’s saved contact card in Messages. It’s
        used for Call and SMS links.
      </p>
      {loading && (
        <p role="status" className="fine-print">
          Loading contact number…
        </p>
      )}
      {(validation || error) && (
        <p role="alert" className="error-inline">
          {validation || error}
        </p>
      )}
      <div className={styles.actions}>
        <button
          type="submit"
          className="button button-primary"
          disabled={busy || !loaded || Boolean(validation) || next === number}
        >
          {saving ? (
            <Loader2 size={15} className="spin" />
          ) : (
            <Check size={15} />
          )}{" "}
          Save number
        </button>
        {number && (
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => void save(null)}
          >
            Clear number
          </button>
        )}
        {error && (
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => void load()}
          >
            <RefreshCw size={15} /> Reload number
          </button>
        )}
      </div>
    </form>
  );
}
