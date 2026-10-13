"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, Loader2, RefreshCw, Sparkles } from "lucide-react";
import type { AssistantModelSettings } from "@boundless/shared";
import { api, request } from "@/lib/client";
import { ModelPicker, modelKey as key } from "./model-picker";
import styles from "./model-settings.module.css";

const message = (cause: unknown) =>
  cause instanceof Error
    ? cause.message
    : "Couldn’t update the assistant model. Try again.";

export function ModelSettings({
  onSuccess,
}: {
  onSuccess: (message: string) => void;
}) {
  const [settings, setSettings] = useState<AssistantModelSettings | null>(null);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const busy = loading || saving;
  const dirty =
    !!settings && (key(settings.model) !== value || !settings.applied);
  const selected =
    value === ""
      ? null
      : settings?.models.find((model) => key(model) === value);
  function show(next: AssistantModelSettings) {
    setSettings(next);
    setValue(key(next.model));
  }
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const response = await request("/assistant-model", { signal });
      const next = (await response.json()) as AssistantModelSettings;
      if (!signal?.aborted) show(next);
    } catch (cause) {
      if (!signal?.aborted) setError(message(cause));
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
    if (!settings || selected === undefined || busy || !dirty) return;
    setSaving(true);
    setError("");
    try {
      const next = await api<AssistantModelSettings>(
        "/assistant-model",
        "PUT",
        {
          model: selected
            ? { model: selected.model, provider: selected.provider }
            : null,
          expectedModel: settings.model,
        },
      );
      show(next);
      onSuccess(
        next.model
          ? "Assistant model saved. Future messages and Routine runs will use this default."
          : "Assistant model cleared. Your companion is using the computer’s default.",
      );
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSaving(false);
    }
  }
  return (
    <section
      className={`settings-card ${styles.card}`}
      aria-labelledby="model-settings-title"
      aria-busy={busy}
    >
      <span className="eyebrow">
        <Sparkles size={14} aria-hidden="true" /> How they think
      </span>
      <h2 id="model-settings-title">Default assistant model</h2>
      <p className="muted">
        Choose the model your companion uses for web chat, iMessage, SMS, email,
        and Routines.
      </p>
      {loading && (
        <p role="status" className="fine-print">
          Loading assistant models…
        </p>
      )}
      <form className={styles.form} onSubmit={save}>
        <label id="assistant-model-label" htmlFor="assistant-model">
          Assistant model
        </label>
        <ModelPicker
          models={settings?.models || []}
          value={selected === undefined ? settings?.model || null : selected}
          disabled={busy || !settings}
          onChange={(model) => {
            setValue(key(model));
            setError("");
          }}
        />
        <p id="assistant-model-help" className="fine-print">
          Use computer default removes the saved override. Changes apply to
          future messages and Routine runs, including existing conversations
          using the default. Conversations with their own model override keep
          it.
        </p>
        {settings && !settings.applied && (
          <p role="status" className="fine-print">
            Your saved model hasn’t been confirmed on the computer yet. Reload
            its status or save to retry.
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
            disabled={busy || !settings || selected === undefined || !dirty}
          >
            {saving ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Check size={16} />
            )}{" "}
            Save model
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => void load()}
          >
            <RefreshCw size={15} />{" "}
            {dirty ? "Discard edits & reload models" : "Reload models"}
          </button>
        </div>
      </form>
      <p className="fine-print">
        Your choice stays saved through computer restarts, updates, and
        checkpoint restores.
      </p>
    </section>
  );
}
