"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import {
  routineAgents,
  routineNotificationSuffix,
  routinePatchSchema,
  type Cron,
  type RoutinePatch,
} from "@boundless/shared";
import { api } from "@/lib/client";
import { Modal } from "./modal";
import styles from "./routine-editor.module.css";

export function RoutineEditor({
  routine,
  onClose,
  onSaved,
}: {
  routine: Cron;
  onClose: () => void;
  onSaved: () => void;
}) {
  const notify = routine.prompt.endsWith(routineNotificationSuffix);
  const [name, setName] = useState(routine.name);
  const [prompt, setPrompt] = useState(
    notify
      ? routine.prompt.slice(0, -routineNotificationSuffix.length)
      : routine.prompt,
  );
  const [schedule, setSchedule] = useState(routine.schedule);
  const [timezone, setTimezone] = useState(routine.timezone);
  const [enabled, setEnabled] = useState(routine.enabled);
  const [agent, setAgent] = useState(routine.agent || "");
  const [profile, setProfile] = useState(routine.profile || "");
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const sending = useRef(false);
  const choicesId = useId();
  const next = {
    name,
    prompt: prompt + (notify ? routineNotificationSuffix : ""),
    schedule,
    timezone,
    enabled,
    agent: agent || null,
    profile: profile || null,
  };
  const patch: RoutinePatch = {};
  for (const key of Object.keys(next) as (keyof typeof next)[]) {
    const before =
      key === "agent" || key === "profile"
        ? (routine[key] ?? null)
        : routine[key];
    if (next[key] !== before) Object.assign(patch, { [key]: next[key] });
  }
  const changed = Object.keys(patch).length > 0;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (sending.current || !changed) return;
    const result = routinePatchSchema.safeParse(patch);
    if (!result.success) {
      setError(result.error.issues.map((issue) => issue.message).join(" "));
      return;
    }
    sending.current = true;
    setSaving(true);
    setError("");
    try {
      await api(`/routines/${routine.id}`, "PATCH", result.data);
      onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn’t save your changes. Try again.",
      );
    } finally {
      sending.current = false;
      setSaving(false);
    }
  }
  return (
    <Modal
      title="A little change of rhythm"
      onClose={() => {
        if (!sending.current) onClose();
      }}
    >
      <p>
        Give this routine a little tune-up. Its past check-ins will stay right
        here.
      </p>
      <form className="stack" onSubmit={save}>
        <fieldset disabled={saving} className={styles.fields}>
          <label>
            Name
            <input
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            What should your agent do?
            <textarea
              required
              maxLength={8000 - (notify ? routineNotificationSuffix.length : 0)}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          <label>
            Schedule
            <input
              required
              value={schedule}
              onChange={(event) => setSchedule(event.target.value)}
              spellCheck={false}
            />
            <small>
              Minute, hour, day, month, weekday. For example, 30 8 * * 1-5 means
              weekdays at 8:30.
            </small>
          </label>
          <label>
            Timezone
            <input
              required
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              spellCheck={false}
            />
            <small>
              Keep its rhythm in the right part of the world, such as
              America/Toronto.
            </small>
          </label>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span>
              Keep this routine on the schedule
              <small>Switch off to give it a pause.</small>
            </span>
          </label>
          <button
            type="button"
            className={`text-button ${styles.more}`}
            aria-expanded={advanced}
            aria-controls={choicesId}
            onClick={() => setAdvanced(!advanced)}
          >
            More choices <ChevronDown size={15} aria-hidden="true" />
          </button>
          {advanced && (
            <div className={styles.choices} id={choicesId}>
              <p>
                Most routines can keep the usual setup. Other agents and
                profiles must already be on your companion’s computer.
              </p>
              <label>
                Agent for this routine
                <select
                  value={agent}
                  onChange={(event) => {
                    setAgent(event.target.value);
                    if (event.target.value && event.target.value !== "hermes")
                      setProfile("");
                  }}
                >
                  <option value="">Computer’s usual agent</option>
                  {routineAgents.map((value) => (
                    <option key={value} value={value}>
                      {
                        {
                          hermes: "Hermes",
                          openclaw: "OpenClaw",
                          "claude-code": "Claude Code",
                          codex: "Codex",
                          opencode: "OpenCode",
                          grok: "Grok",
                          pi: "Pi",
                        }[value]
                      }
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Profile
                <input
                  value={profile}
                  disabled={!!agent && agent !== "hermes"}
                  onChange={(event) => setProfile(event.target.value)}
                  placeholder="Agent’s usual setup"
                  spellCheck={false}
                />
                <small>
                  Hermes profiles use lowercase letters, numbers, - or _. Leave
                  blank to use its usual setup.
                </small>
              </label>
            </div>
          )}
        </fieldset>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={`modal-actions ${styles.actions}`}>
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
            disabled={saving}
          >
            Keep as it was
          </button>
          <button
            className="button button-primary"
            disabled={saving || !changed}
          >
            {saving ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Check size={16} />
            )}{" "}
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
