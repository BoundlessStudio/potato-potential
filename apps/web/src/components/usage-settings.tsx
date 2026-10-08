"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart3, RefreshCw } from "lucide-react";
import type { InstanceUsage } from "@boundless/shared";
import { request } from "@/lib/client";
import styles from "./usage-settings.module.css";

const dollars = (micros: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 6,
  }).format(micros / 1e6);
const count = (value: number) => new Intl.NumberFormat("en-US").format(value);
const services = [
  ["llm", "AI models"],
  ["brave", "Web search"],
  ["composio", "Connected apps"],
  ["perflo", "Paid tools"],
] as const;

export function UsageSettings() {
  const [usage, setUsage] = useState<InstanceUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const response = await request("/usage", { signal });
      const next = (await response.json()) as { usage: InstanceUsage };
      if (!signal?.aborted) setUsage(next.usage);
    } catch (cause) {
      if (!signal?.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Couldn’t load usage. Try again.",
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
  const month =
    usage &&
    new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${usage.period}-01T00:00:00Z`));
  const calls = usage
    ? services.reduce((sum, [key]) => sum + usage.byIntegration[key].calls, 0)
    : 0;
  const tokens = usage
    ? usage.byIntegration.llm.inputTokens + usage.byIntegration.llm.outputTokens
    : 0;
  return (
    <section
      className={`settings-card ${styles.card}`}
      aria-labelledby="usage-settings-title"
      aria-busy={loading}
    >
      <span className="eyebrow">
        <BarChart3 size={14} aria-hidden="true" /> The bigger picture
      </span>
      <h2 id="usage-settings-title">Usage</h2>
      <p className="muted">
        {usage
          ? `Managed-service activity for ${month} (UTC).`
          : "Your companion’s managed-service activity this month."}{" "}
        All spending is shown in USD.
      </p>
      {loading && (
        <p role="status" className="fine-print">
          {usage ? "Refreshing usage…" : "Loading usage…"}
        </p>
      )}
      {error && (
        <p role="alert" className="error-inline">
          {error}
          {usage && " Showing the last loaded figures."}
        </p>
      )}
      {usage && (
        <>
          <dl className={styles.summary}>
            <div>
              <dt>Total spent</dt>
              <dd>{dollars(usage.totalMicros)}</dd>
            </div>
            <div>
              <dt>Service calls</dt>
              <dd>{count(calls)}</dd>
            </div>
            <div>
              <dt>AI tokens</dt>
              <dd>{count(tokens)}</dd>
            </div>
          </dl>
          <table className={styles.breakdown}>
            <caption>By service</caption>
            <thead>
              <tr>
                <th scope="col">Service</th>
                <th scope="col">Calls</th>
                <th scope="col">Spent · USD</th>
              </tr>
            </thead>
            <tbody>
              {services.map(([key, label]) => (
                <tr key={key}>
                  <th scope="row">{label}</th>
                  <td>{count(usage.byIntegration[key].calls)}</td>
                  <td>{dollars(usage.byIntegration[key].costMicros)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="fine-print">
            AI tokens: {count(usage.byIntegration.llm.inputTokens)} input ·{" "}
            {count(usage.byIntegration.llm.outputTokens)} output.
          </p>
          {usage.totalMicros === 0 && calls === 0 && (
            <p className="fine-print">
              No managed-service usage recorded for this month yet.
            </p>
          )}
        </>
      )}
      <button
        type="button"
        className="button button-secondary"
        onClick={() => void load()}
        disabled={loading}
      >
        <RefreshCw size={15} aria-hidden="true" /> Refresh usage
      </button>
      <p className="fine-print">
        This includes managed-service spending from monthly allowance and
        one-time credit. Computer hosting, messaging, and services using your
        own API keys aren’t included.
      </p>
    </section>
  );
}
