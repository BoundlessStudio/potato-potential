"use client";
import { useState } from "react";
import {
  CircleArrowUp,
  CircleCheck,
  Download,
  Loader2,
  Monitor,
  RefreshCw,
} from "lucide-react";
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
  status,
  statusError,
  onRefresh,
  refreshing,
}: {
  status: ComputerStatus | null;
  statusError: string;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const busy =
    !!status?.operation &&
    ["queued", "applying", "checking"].includes(status.operation.phase);
  const phase = status?.operation?.phase;
  const versionStatus = status?.updateAvailable
    ? `Update available: ${status.availableTemplate}`
    : "Up to date";
  return (
    <section className="settings-card computer-settings">
      <div className="computer-settings-heading">
        <div>
          <span className="eyebrow">Status and maintenance</span>
          <h2>
            <Monitor size={19} /> Keeping things running.
          </h2>
        </div>
        <button
          type="button"
          className="icon-button computer-settings-refresh"
          aria-label={refreshing ? "Refreshing…" : "Refresh computer"}
          disabled={refreshing}
          onClick={onRefresh}
          title="Refresh status and metrics. Reconnect the desktop on Overview."
        >
          <RefreshCw size={16} className={refreshing ? "spin" : ""} />
        </button>
      </div>
      {status ? (
        <>
          <dl className="computer-details">
            <div>
              <dt>Status</dt>
              <dd>
                {busy
                  ? status.operation?.action === "backup"
                    ? "Backing up"
                    : status.operation?.action === "restore"
                      ? "Restoring"
                      : "Restarting"
                  : status.instanceStatus}
              </dd>
            </div>
            <div>
              <dt>Installed version</dt>
              <dd className="computer-version">
                <span>{status.installedTemplate}</span>
                <span
                  className={`computer-version-status ${status.updateAvailable ? "update-available" : "current"}`}
                  role="img"
                  aria-label={versionStatus}
                  title={versionStatus}
                >
                  {status.updateAvailable ? (
                    <CircleArrowUp size={16} aria-hidden="true" />
                  ) : (
                    <CircleCheck size={16} aria-hidden="true" />
                  )}
                </span>
              </dd>
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
          {status.suspended && (
            <p className="muted">
              Your operator has paused this computer. Its status remains
              available.
            </p>
          )}
          {status.operation && phase !== "completed" && (
            <p
              className={
                phase === "failed" ? "error-inline" : "computer-operation"
              }
              role="status"
            >
              {busy && <Loader2 size={15} className="spin" />}
              {phase === "queued"
                ? "Waiting to start…"
                : phase === "applying"
                  ? status.operation.action === "backup"
                    ? "Saving a checkpoint…"
                    : status.operation.action === "restore"
                      ? "Restoring the checkpoint…"
                      : "Restarting the computer…"
                  : phase === "checking"
                    ? "Checking that everything is ready…"
                    : status.operation.error}
            </p>
          )}
        </>
      ) : !statusError ? (
        <p className="muted">Checking the computer…</p>
      ) : null}
      {statusError && (
        <p className="error-inline" role="alert">
          {statusError}
        </p>
      )}
    </section>
  );
}

export function ComputerMaintenance({
  blocked = false,
  status,
  statusError,
  refresh,
  refreshing,
  onError,
  className,
}: {
  blocked?: boolean;
  status: ComputerStatus | null;
  statusError: string;
  refresh: () => Promise<ComputerStatus | null>;
  refreshing: boolean;
  onError: (message: string) => void;
  className: string;
}) {
  const [confirm, setConfirm] = useState<"restart" | "update" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const busy =
    !!status?.operation &&
    ["queued", "applying", "checking"].includes(status.operation.phase);
  const disabled =
    !status ||
    !!statusError ||
    busy ||
    submitting ||
    refreshing ||
    status.canManage === false;
  async function submit() {
    if (!confirm || submitting) return;
    setSubmitting(true);
    try {
      await api("/computer/maintenance", "POST", { action: confirm });
      setConfirm(null);
      await refresh();
    } catch (cause) {
      onError(
        cause instanceof Error
          ? cause.message
          : "Couldn’t start the operation.",
      );
      setConfirm(null);
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <>
      <div className={className} role="group" aria-label="Computer maintenance">
        <button
          type="button"
          className="button button-secondary"
          aria-label="Restart computer"
          title="Restart computer"
          disabled={disabled || blocked}
          onClick={() => setConfirm("restart")}
        >
          <RefreshCw size={15} />
          <span>Restart</span>
        </button>
        <button
          type="button"
          className="button button-primary"
          aria-label="Update computer"
          title="Update computer"
          disabled={disabled || blocked || !status?.updateAvailable}
          onClick={() => setConfirm("update")}
        >
          <Download size={15} />
          <span>Update</span>
        </button>
      </div>
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
    </>
  );
}
