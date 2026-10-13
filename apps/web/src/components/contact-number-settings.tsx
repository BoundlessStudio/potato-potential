"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { phoneSchema } from "@boundless/shared";
import { request } from "@/lib/client";
import styles from "./contact-number-settings.module.css";

export function useContactNumberSettings({
  agentName,
  ownNumber,
  routerNumber,
}: {
  agentName: string;
  ownNumber: string;
  routerNumber?: string;
}) {
  const [number, setNumber] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
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
  const accept = useCallback((number: string | null) => {
    setNumber(number);
    setValue(number || "");
    setLoaded(true);
    setError("");
  }, []);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const response = await request("/contact-number", { signal });
        const result = (await response.json()) as { number: string | null };
        if (!signal?.aborted) accept(result.number);
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
    },
    [accept],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  return {
    number,
    value,
    setValue,
    next,
    validation,
    loading,
    loaded,
    error,
    load,
    accept,
    dirty: loaded && next !== number,
  };
}

export function ContactNumberField({
  contact,
  agentName,
  disabled,
}: {
  contact: ReturnType<typeof useContactNumberSettings>;
  agentName: string;
  disabled: boolean;
}) {
  return (
    <div
      className={styles.field}
      role="group"
      aria-label="Companion contact number"
      aria-busy={contact.loading}
    >
      <label htmlFor="companion-contact-number">
        {agentName}’s contact number
      </label>
      <input
        id="companion-contact-number"
        type="tel"
        autoComplete="off"
        placeholder="+1 234 567 8900"
        value={contact.value}
        disabled={disabled || contact.loading || !contact.loaded}
        aria-describedby="companion-contact-number-help"
        aria-invalid={Boolean(contact.validation)}
        onChange={(event) => contact.setValue(event.target.value)}
      />
      <p id="companion-contact-number-help" className="fine-print">
        Copy the number from {agentName}’s saved contact card in Messages. It’s
        used for Call and SMS links. Leave blank to remove it.
      </p>
      {contact.loading && (
        <p role="status" className="fine-print">
          Loading contact number…
        </p>
      )}
      {(contact.validation || contact.error) && (
        <p role="alert" className="error-inline">
          {contact.validation || contact.error}
        </p>
      )}
      {contact.error && (
        <button
          type="button"
          className="button button-secondary align-start"
          disabled={disabled || contact.loading}
          onClick={() => void contact.load()}
        >
          <RefreshCw size={15} /> Reload number
        </button>
      )}
    </div>
  );
}
