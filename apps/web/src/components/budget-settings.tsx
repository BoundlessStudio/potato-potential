"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, Loader2, RefreshCw, Wallet } from "lucide-react";
import { MAX_BUDGET_MICROS, type InstanceBudget } from "@boundless/shared";
import { api, request } from "@/lib/client";
import styles from "./budget-settings.module.css";

const dollars = (micros: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 6,
  }).format(micros / 1e6);
const message = (cause: unknown) =>
  cause instanceof Error
    ? cause.message
    : "Couldn’t update your budget. Try again.";

export function BudgetSettings({
  onSuccess,
}: {
  onSuccess: (message: string) => void;
}) {
  const [budget, setBudget] = useState<InstanceBudget | null>(null);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const amount = /^(?:\d+(?:\.\d{1,6})?|\.\d{1,6})$/.test(value)
    ? Math.round(Number(value) * 1e6)
    : null;
  const valid =
    amount !== null &&
    Number.isSafeInteger(amount) &&
    amount >= 0 &&
    amount <= MAX_BUDGET_MICROS;
  const dirty = budget !== null && amount !== budget.monthlyCapMicros;
  const busy = loading || saving;
  function show(next: InstanceBudget) {
    setBudget(next);
    setValue(String(next.monthlyCapMicros / 1e6));
  }
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const response = await request("/budget", { signal });
      const next = (await response.json()) as { budget: InstanceBudget };
      if (!signal?.aborted) show(next.budget);
    } catch (cause) {
      if (!signal?.aborted) {
        setBudget(null);
        setError(message(cause));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!budget || busy || !dirty) return;
    if (!valid) {
      setError("Enter a monthly limit from $0 to $100 USD.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const next = await api<{ budget: InstanceBudget }>("/budget", "PUT", {
        micros: amount,
        expectedMicros: budget.monthlyCapMicros,
      });
      show(next.budget);
      onSuccess("Budget saved. Your new monthly limit is in effect.");
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSaving(false);
    }
  }
  return (
    <section
      className={`settings-card ${styles.card}`}
      aria-labelledby="budget-settings-title"
      aria-busy={busy}
    >
      <span className="eyebrow">
        <Wallet size={14} aria-hidden="true" /> A little peace of mind
      </span>
      <h2 id="budget-settings-title">Budget</h2>
      <p className="muted">
        Set a monthly spending limit for your companion’s AI models, searches,
        connected app calls, and paid tools. The limit resets at the start of
        each UTC month.
      </p>
      {budget && (
        <dl className={styles.summary}>
          <div>
            <dt>Current monthly limit</dt>
            <dd>{dollars(budget.monthlyCapMicros)}</dd>
          </div>
          <div>
            <dt>Spent this month</dt>
            <dd>{dollars(budget.monthlyConsumedMicros)}</dd>
          </div>
          <div>
            <dt>Monthly allowance left</dt>
            <dd>{dollars(budget.monthlyRemainingMicros)}</dd>
          </div>
        </dl>
      )}
      {loading && (
        <p role="status" className={styles.status}>
          Loading your budget…
        </p>
      )}
      <form onSubmit={save} className={styles.form}>
        <label htmlFor="monthly-budget">Monthly limit · USD</label>
        <input
          id="monthly-budget"
          type="number"
          inputMode="decimal"
          min="0"
          max={MAX_BUDGET_MICROS / 1e6}
          step="0.01"
          required
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError("");
          }}
          disabled={busy || !budget}
          aria-describedby="budget-help budget-exclusions"
        />
        <p id="budget-help" className="fine-print">
          Choose $0–$100 USD. Changes apply immediately. A $0 limit removes the
          monthly allowance.
        </p>
        {budget && budget.creditRemainingMicros > 0 && (
          <p className={styles.credit} role="note">
            This instance also has {dollars(budget.creditRemainingMicros)} in
            one-time credit. It can still be spent after the monthly allowance
            runs out, including when the limit is $0.
          </p>
        )}
        {error && (
          <p className="error-inline" role="alert">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button
            type="submit"
            className="button button-primary"
            disabled={busy || !budget || !dirty || !valid}
          >
            {saving ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Check size={16} />
            )}{" "}
            Save budget
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => void load()}
          >
            <RefreshCw size={15} />{" "}
            {dirty ? "Discard edits & reload budget" : "Reload budget"}
          </button>
        </div>
      </form>
      <p id="budget-exclusions" className="fine-print">
        Computer hosting, messaging, and services using your own API keys are
        billed separately and aren’t limited by this budget.
      </p>
    </section>
  );
}
