"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, Download, Loader2, Monitor, RefreshCw } from "lucide-react";
import type { Agent } from "@boundless/shared";
import { api } from "@/lib/client";
import { Modal } from "./modal";

export type ComputerStatus = {
  installedTemplate: string;
  availableTemplate: string;
  updateAvailable: boolean;
  instanceStatus: string;
  screen: { width: number; height: number };
  operation: Agent["computerOperation"] | null;
  canManage?: boolean;
  suspended?: boolean;
};
export function ComputerSettings({
  onStatus,
}: {
  onStatus?: (status: ComputerStatus) => void;
}) {
  const [status, setStatus] = useState<ComputerStatus | null>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<"restart" | "update" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const busy =
    !!status?.operation &&
    ["queued", "applying", "checking"].includes(status.operation.phase);
  const refresh = useCallback(async () => {
    try {
      const next = await api<ComputerStatus>("/computer/status");
      setStatus(next);
      onStatus?.(next);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn’t check the computer.",
      );
    }
  }, [onStatus]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(
      () => {
        if (!document.hidden) void refresh();
      },
      busy ? 2500 : 15000,
    );
    return () => clearInterval(timer);
  }, [busy, refresh]);
  async function submit() {
    if (!confirm || submitting) return;
    setSubmitting(true);
    try {
      await api("/computer/maintenance", "POST", { action: confirm });
      setConfirm(null);
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn’t start the operation.",
      );
      setConfirm(null);
    } finally {
      setSubmitting(false);
    }
  }
  const phase = status?.operation?.phase;
  return (
    <section className="settings-card computer-settings">
      <span className="eyebrow">Status and maintenance</span>
      <h2>
        <Monitor size={19} /> Their computer.
      </h2>
      {status ? (
        <>
          <dl className="computer-details">
            <div>
              <dt>Status</dt>
              <dd>{busy ? "Restarting" : status.instanceStatus}</dd>
            </div>
            <div>
              <dt>Installed version</dt>
              <dd>{status.installedTemplate}</dd>
            </div>
            <div>
              <dt>Screen</dt>
              <dd>
                {status.screen.width} × {status.screen.height} ·{" "}
                {status.screen.height > status.screen.width
                  ? "Portrait"
                  : "Landscape"}
              </dd>
            </div>
          </dl>
          <p className="muted">
            {status.updateAvailable
              ? `A tested update is ready: ${status.availableTemplate}.`
              : "Your computer has the current update."}
          </p>
          <div className="memory-actions">
            <button
              type="button"
              className="button button-secondary"
              disabled={busy || submitting || status.canManage === false}
              onClick={() => setConfirm("restart")}
            >
              <RefreshCw size={15} /> Restart computer
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={
                busy ||
                submitting ||
                status.canManage === false ||
                !status.updateAvailable
              }
              onClick={() => setConfirm("update")}
            >
              <Download size={15} /> Update computer
            </button>
          </div>
          {status.suspended && (
            <p className="muted">
              Your operator has paused this computer. Its status remains
              available.
            </p>
          )}
          {status.operation && (
            <p
              className={
                phase === "failed" ? "error-inline" : "computer-operation"
              }
              role="status"
            >
              {busy ? (
                <Loader2 size={15} className="spin" />
              ) : phase === "completed" ? (
                <Check size={15} />
              ) : null}
              {phase === "queued"
                ? "Waiting to start…"
                : phase === "applying"
                  ? "Restarting the computer…"
                  : phase === "checking"
                    ? "Checking that everything is ready…"
                    : phase === "completed"
                      ? `${status.operation.action === "update" ? "Update" : "Restart"} complete. The computer is ready.`
                      : status.operation.error}
            </p>
          )}
        </>
      ) : !error ? (
        <p className="muted">Checking the computer…</p>
      ) : null}
      {error && (
        <p className="error-inline" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="text-button"
        onClick={() => void refresh()}
      >
        <RefreshCw size={14} /> Check computer status
      </button>
      {confirm && (
        <Modal
          title={
            confirm === "update"
              ? "Update this computer?"
              : "Restart this computer?"
          }
          onClose={() => {
            if (!submitting) setConfirm(null);
          }}
        >
          <p>
            {confirm === "update"
              ? "This installs our tested desktop update and restarts the computer."
              : "This restarts the computer using its installed version."}{" "}
            Saved memory, files in your companion’s home folder, and connected
            accounts stay with your companion. Open browser forms and work in
            other channels may be interrupted.
          </p>
          {confirm === "update" && (
            <p>
              Software installed outside the home folders is reset by the
              desktop update.
            </p>
          )}
          <p>
            You can close this page once it starts. Come back to Computer to see
            its progress.
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="button button-secondary"
              disabled={submitting}
              onClick={() => setConfirm(null)}
            >
              Keep working
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={submitting}
              onClick={() => void submit()}
            >
              {submitting ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <RefreshCw size={15} />
              )}
              {confirm === "update"
                ? "Install update and restart"
                : "Restart now"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
