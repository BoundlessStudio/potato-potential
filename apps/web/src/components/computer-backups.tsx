"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArchiveRestore,
  HardDriveDownload,
  Loader2,
  RefreshCw,
} from "lucide-react";
import type { Agent, ComputerBackup } from "@boundless/shared";
import { api } from "@/lib/client";
import { Modal } from "./modal";
import styles from "./computer-workspace.module.css";

type Operation = Pick<
  NonNullable<Agent["computerOperation"]>,
  "id" | "action" | "phase" | "error" | "backupId" | "requestedAt"
> & { needsReconnect?: boolean };
type Snapshot = {
  backups: ComputerBackup[];
  operation: Operation | null;
  canManage: boolean;
  cooldownUntil: string | null;
};
const active = (op?: Operation | null) =>
  !!op && ["queued", "applying", "checking"].includes(op.phase);
export function useComputerBackups() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const reads = useRef(0);
  const requestId = useRef<{ key: string; id: string } | null>(null);
  const sending = useRef(false);
  const refresh = useCallback(async () => {
    const read = ++reads.current;
    setLoading(true);
    try {
      const next = await api<Snapshot>("/computer/backups");
      if (read === reads.current) {
        setData(next);
        setError("");
      }
    } catch (cause) {
      if (read === reads.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Couldn’t gather your checkpoints. Try again.",
        );
    } finally {
      if (read === reads.current) setLoading(false);
    }
  }, []);
  const working = active(data?.operation);
  useEffect(() => {
    void refresh();
    const timer = setInterval(
      () => {
        if (!document.hidden) void refresh();
      },
      working ? 2500 : 15000,
    );
    return () => {
      clearInterval(timer);
      reads.current++;
    };
  }, [refresh, working]);
  async function start(backup?: string) {
    if (sending.current) return;
    sending.current = true;
    setSubmitting(true);
    const key = backup || "manual";
    if (requestId.current?.key !== key)
      requestId.current = { key, id: crypto.randomUUID() };
    const id = requestId.current.id;
    try {
      await api(backup ? "/computer/restore" : "/computer/backups", "POST", {
        id,
        ...(backup ? { backup, confirm: true } : {}),
      });
      ++reads.current;
      setData((old) =>
        old
          ? {
              ...old,
              operation: {
                id,
                action: backup ? "restore" : "backup",
                phase: "queued",
                requestedAt: new Date().toISOString(),
                ...(backup ? { backupId: backup } : {}),
              },
            }
          : old,
      );
      requestId.current = null;
      await refresh();
    } finally {
      sending.current = false;
      setSubmitting(false);
    }
  }
  async function reconnect() {
    if (sending.current || !data?.operation) return;
    sending.current = true;
    setSubmitting(true);
    try {
      await api("/computer/restore/reconnect", "POST", {
        id: data.operation.id,
      });
      await refresh();
    } finally {
      sending.current = false;
      setSubmitting(false);
    }
  }
  return {
    data,
    error,
    loading,
    submitting,
    working,
    refresh,
    start,
    reconnect,
  };
}
type Backups = ReturnType<typeof useComputerBackups>;
export function BackupButton({
  backups,
  compact = false,
  available = true,
  onError,
}: {
  backups: Backups;
  compact?: boolean;
  available?: boolean;
  onError: (message: string) => void;
}) {
  const { data, loading, working, submitting } = backups;
  const saving = working && data?.operation?.action === "backup";
  const cooling =
    !!data?.cooldownUntil && Date.parse(data.cooldownUntil) > Date.now();
  const retry = !data && !!backups.error;
  const label = retry
    ? "Retry backup status"
    : saving
      ? "Backing up…"
      : submitting
        ? "Starting…"
        : "Back up now";
  const title =
    cooling && !saving
      ? `Next manual backup available ${new Date(data!.cooldownUntil!).toLocaleString()}`
      : label;
  return (
    <button
      type="button"
      className={
        compact ? "icon-button computer-action" : "button button-secondary"
      }
      aria-label={label}
      title={title}
      disabled={
        !available ||
        (!data && !retry) ||
        (loading && !data) ||
        data?.canManage === false ||
        data?.operation?.needsReconnect ||
        working ||
        submitting ||
        cooling
      }
      onClick={() => {
        void (retry ? backups.refresh() : backups.start()).catch((cause) =>
          onError(
            cause instanceof Error
              ? cause.message
              : "Couldn’t start the backup. Try again.",
          ),
        );
      }}
    >
      {saving || submitting ? (
        <Loader2 size={16} className="spin" />
      ) : (
        <HardDriveDownload size={16} />
      )}
      {!compact && <span>{label}</span>}
    </button>
  );
}
export function ChatBackupButton({
  available,
  onError,
}: {
  available: boolean;
  onError: (message: string) => void;
}) {
  const backups = useComputerBackups();
  return (
    <BackupButton
      backups={backups}
      compact
      available={available}
      onError={onError}
    />
  );
}
export function ComputerCheckpoints({
  backups,
  name,
  onRestored,
}: {
  backups: Backups;
  name: string;
  onRestored: () => void;
}) {
  const [selected, setSelected] = useState<ComputerBackup | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [error, setError] = useState("");
  const { data, working, submitting, loading } = backups;
  const op = data?.operation;
  const checkpointOperation = op && ["backup", "restore"].includes(op.action);
  return (
    <section className={styles.section} aria-label="Computer checkpoints">
      <div className={styles.heading}>
        <div>
          <span className="eyebrow">A little way back</span>
          <h2>Checkpoints</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Refresh checkpoints"
          title="Refresh checkpoints"
          disabled={loading}
          onClick={() => void backups.refresh()}
        >
          <RefreshCw size={16} className={loading ? "spin" : ""} />
        </button>
      </div>
      <p className="muted">
        Little moments saved from {name}’s computer, ready to return to if you
        need them.
      </p>
      <p className="fine-print">
        Checkpoints save your companion’s home folders, where their files,
        memories, and settings live. Up to seven nightly backups and one manual
        backup. A new manual backup replaces the previous manual one. Unchanged
        backups may appear just once.
      </p>
      {checkpointOperation && (
        <p
          role="status"
          className={
            op.phase === "failed" ? "error-inline" : "computer-operation"
          }
        >
          {working && <Loader2 size={15} className="spin" />}
          {op.phase === "failed"
            ? op.error
            : op.phase === "completed"
              ? op.action === "backup"
                ? "A little peace of mind. Your checkpoint is saved."
                : "Back at their desk. The checkpoint is restored."
              : op.action === "backup"
                ? "Saving a little moment in time… You can keep chatting while we take care of it."
                : "Finding the way back… We’ll reconnect your companion when the computer is ready."}
        </p>
      )}
      {checkpointOperation &&
        op.action === "restore" &&
        op.phase === "failed" &&
        op.needsReconnect && (
          <button
            className="button button-secondary"
            disabled={submitting || !data?.canManage}
            onClick={() => {
              setError("");
              void backups
                .reconnect()
                .catch((cause) =>
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Couldn’t reconnect. Try again.",
                  ),
                );
            }}
          >
            <RefreshCw size={15} /> Check and reconnect
          </button>
        )}
      {error && !selected && (
        <p className="error-inline" role="alert">
          {error}
        </p>
      )}
      {checkpointOperation &&
        op.action === "restore" &&
        op.phase === "completed" && (
          <button className="text-button" onClick={onRestored}>
            Back to their desk <ArchiveRestore size={15} />
          </button>
        )}
      {backups.error && (
        <p role="alert" className="error-inline">
          {backups.error}
          {data ? " Showing the last available checkpoints." : ""}
        </p>
      )}
      {!data && !backups.error ? (
        <p className="muted">Gathering your checkpoints…</p>
      ) : data?.backups.length === 0 ? (
        <p className="muted">
          No little moments saved yet. Use Back up now above to save your first
          checkpoint.
        </p>
      ) : (
        data?.backups.map((row) => (
          <article key={row.id} className={styles.request}>
            <div>
              <h3>
                {row.kind === "manual" ? "Saved by you" : "Nightly backup"}
              </h3>
              <p>{new Date(row.created * 1000).toLocaleString()}</p>
              <p className="fine-print">
                {(row.size_bytes / 1024 ** 2).toFixed(1)} MiB saved
              </p>
            </div>
            <button
              className="button button-secondary"
              disabled={
                working || submitting || !data.canManage || op?.needsReconnect
              }
              onClick={() => {
                setSelected(row);
                setUnderstood(false);
                setError("");
              }}
            >
              <ArchiveRestore size={15} /> Restore checkpoint
            </button>
          </article>
        ))
      )}
      {selected && (
        <Modal
          title="Go back to this checkpoint?"
          onClose={() => {
            if (!submitting) setSelected(null);
          }}
        >
          <p>
            {name}’s computer will return to{" "}
            <strong>
              {new Date(selected.created * 1000).toLocaleString()}
            </strong>
            . Files, memories, saved conversations, and settings in their home
            folders will go back with it. Later changes on the computer will be
            lost.
          </p>
          <p>
            Your tasks, wiki notes, conversation list, and account settings stay
            as they are. We’ll reconnect {name} to your current profile and
            workspace afterward.
          </p>
          <p>
            This restarts the computer and doesn’t save its current files first.
            Other conversations, calls, and connected apps may be interrupted.
            It can take several minutes; you can close this page and check back
            here.
          </p>
          <label className={styles.restoreConsent}>
            <input
              type="checkbox"
              checked={understood}
              onChange={(event) => setUnderstood(event.target.checked)}
            />
            <span>
              I understand that later changes on the computer will be lost.
            </span>
          </label>
          {error && (
            <p className="error-inline" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button
              className="button button-secondary"
              disabled={submitting}
              onClick={() => setSelected(null)}
            >
              Stay here
            </button>
            <button
              className="button button-danger"
              disabled={
                !understood ||
                submitting ||
                working ||
                !data?.canManage ||
                op?.needsReconnect
              }
              onClick={() => {
                void backups
                  .start(selected.id)
                  .then(() => setSelected(null))
                  .catch((cause) =>
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "Couldn’t start the restore. Try again.",
                    ),
                  );
              }}
            >
              {submitting ? "Starting…" : "Restore checkpoint"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
