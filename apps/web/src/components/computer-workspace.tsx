"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowUpRight,
  Copy,
  Link as LinkIcon,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type {
  ComputerMetrics,
  ComputerService,
  Profile,
  PublicComputerLink,
  PublicAgent,
} from "@boundless/shared";
import { api } from "@/lib/client";
import { Computer, type ComputerHandle } from "./computer";
import { ComputerWorkspaceArt } from "./computer-workspace-art";
import {
  ComputerMaintenance,
  ComputerSettings,
  type ComputerStatus,
} from "./computer-settings";
import { Modal } from "./modal";
import styles from "./computer-workspace.module.css";
import { ComputerFiles } from "./computer-files";
import {
  BackupButton,
  ComputerCheckpoints,
  useComputerBackups,
} from "./computer-backups";

const durations = [
  { value: 900, label: "15 minutes" },
  { value: 3600, label: "One hour" },
  { value: 86400, label: "24 hours" },
  { value: 604800, label: "Seven days" },
];
const linkStatuses: Record<PublicComputerLink["status"], string> = {
  pending: "Waiting for your go-ahead",
  publishing: "Making your link…",
  approved: "Ready to open",
  rejected: "Not shared",
  failed: "Needs another try",
  revoked: "Closed",
  expired: "Expired",
};
type Services = {
  services: ComputerService[];
  requests: PublicComputerLink[];
  publicationAllowed: boolean;
};
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "This request was interrupted. Try again.";
function ResourceChart({
  label,
  points,
  limit,
  metrics,
  bytes = false,
}: {
  label: string;
  points: [number, number][];
  limit: number;
  metrics: ComputerMetrics;
  bytes?: boolean;
}) {
  const format = (value: number) =>
    bytes
      ? `${(value / 1024 ** 3).toFixed(2)} GiB`
      : `${value.toFixed(2)} cores`;
  const latest = points.at(-1);
  const ceiling = Math.max(limit, ...points.map((point) => point[1]), 1);
  const end = metrics.fetched_at;
  const start = end - metrics.hours * 3600;
  const segments: string[] = [];
  let previous: number | undefined;
  for (const [time, value] of points) {
    if (time < start || time > end) continue;
    const x = 10 + ((time - start) / (end - start)) * 280,
      y = 90 - (value / ceiling) * 75;
    const gap =
      previous === undefined || time - previous > metrics.step_seconds * 1.5;
    segments.push(`${gap ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`);
    previous = time;
  }
  return (
    <article className={styles.metric}>
      <h3>{label}</h3>
      <p>
        {latest ? format(latest[1]) : "No samples yet"}{" "}
        <small>of {format(limit)}</small>
      </p>
      <svg
        viewBox="0 0 300 105"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label} usage over the past 24 hours; resource limit ${format(limit)}`}
      >
        <line
          x1="10"
          x2="290"
          y1={90 - (limit / ceiling) * 75}
          y2={90 - (limit / ceiling) * 75}
          className={styles.ceiling}
        />
        <path d={segments.join(" ")} className={styles.trace} />
      </svg>
      <small>
        {latest
          ? `Last sample: ${new Date(latest[0] * 1000).toLocaleString()}`
          : "A new or sleeping computer may have no live samples."}
      </small>
    </article>
  );
}
export function ComputerWorkspace({
  profile,
  agent,
  onReturn,
  onError,
  onRestored,
  requestId,
}: {
  profile: Profile;
  agent: PublicAgent;
  onReturn: () => void;
  onError: (message: string) => void;
  onRestored: () => void;
  requestId?: string;
}) {
  const [view, setView] = useState<
    "overview" | "files" | "services" | "resources" | "checkpoints"
  >("overview");
  const [filesVisited, setFilesVisited] = useState(false);
  const [status, setStatus] = useState<ComputerStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const desktopRef = useRef<ComputerHandle>(null);
  const statusRead = useRef(0);
  const metricsRead = useRef(0);
  const [data, setData] = useState<Services | null>(null);
  const [metrics, setMetrics] = useState<ComputerMetrics | null>(null);
  const [metricsError, setMetricsError] = useState("");
  const [metricsRefreshing, setMetricsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [register, setRegister] = useState(false);
  const [port, setPort] = useState("8788");
  const [label, setLabel] = useState("");
  const [create, setCreate] = useState<ComputerService | null>(null);
  const [kind, setKind] = useState<"signed" | "public">("signed");
  const [ttl, setTtl] = useState(3600);
  const [decision, setDecision] = useState<PublicComputerLink | null>(null);
  const [disable, setDisable] = useState<ComputerService | null>(null);
  const createId = useRef("");
  const backups = useComputerBackups();
  const restoredOperation = useRef("");
  const maintenance =
    (!!status?.operation &&
      status.operation.action !== "backup" &&
      ["queued", "applying", "checking"].includes(status.operation.phase)) ||
    (backups.working && backups.data?.operation?.action === "restore") ||
    !!backups.data?.operation?.needsReconnect;
  const refreshStatus = useCallback(async () => {
    const read = ++statusRead.current;
    try {
      const next = await api<ComputerStatus>("/computer/status");
      if (read === statusRead.current) {
        setStatus(next);
        setStatusError("");
      }
      return next;
    } catch (cause) {
      if (read === statusRead.current) setStatusError(message(cause));
      return null;
    }
  }, []);
  const refresh = useCallback(async () => {
    try {
      setData(await api<Services>("/computer/services"));
      setLoadError("");
    } catch (cause) {
      setLoadError(message(cause));
    }
  }, []);
  const refreshMetrics = useCallback(async () => {
    const read = ++metricsRead.current;
    setMetricsRefreshing(true);
    try {
      const next = await api<ComputerMetrics>("/computer/metrics");
      if (read === metricsRead.current) {
        setMetrics(next);
        setMetricsError("");
      }
    } catch (cause) {
      if (read === metricsRead.current) setMetricsError(message(cause));
    } finally {
      if (read === metricsRead.current) setMetricsRefreshing(false);
    }
  }, []);
  useEffect(() => {
    const op = backups.data?.operation;
    if (
      op?.action !== "restore" ||
      op.phase !== "completed" ||
      restoredOperation.current === op.id
    )
      return;
    restoredOperation.current = op.id;
    onRestored();
    void Promise.all([refreshStatus(), refreshMetrics(), refresh()]);
  }, [
    backups.data?.operation,
    onRestored,
    refreshStatus,
    refreshMetrics,
    refresh,
  ]);
  useEffect(() => {
    void refresh();
    void refreshMetrics();
    void refreshStatus();
  }, [refresh, refreshMetrics, refreshStatus]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (requestId) setView("services");
  }, [requestId]);
  useEffect(() => {
    const timer = setInterval(
      () => {
        if (!document.hidden && !refreshingRef.current) void refreshStatus();
      },
      maintenance ? 2500 : 15000,
    );
    return () => clearInterval(timer);
  }, [maintenance, refreshStatus]);
  useEffect(() => {
    if (requestId && data && view === "services") {
      document
        .getElementById(`computer-request-${requestId}`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [requestId, data, view]);
  async function refreshComputer() {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await Promise.all([
        refreshStatus().then((next) => {
          if (
            next &&
            next.canManage !== false &&
            !agent.suspended &&
            !["queued", "applying", "checking"].includes(
              next.operation?.phase || "",
            )
          )
            desktopRef.current?.refresh();
        }),
        refreshMetrics(),
      ]);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }
  const allowed =
    !!data?.publicationAllowed && status?.canManage !== false && !maintenance;
  async function act(work: () => Promise<unknown>) {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      await work();
      setCreate(null);
      setDecision(null);
      setDisable(null);
      setRegister(false);
      await refresh();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  function registerService(event: FormEvent) {
    event.preventDefault();
    void act(() =>
      api("/computer/services", "POST", { port: Number(port), label }),
    );
  }
  const pending =
    data?.requests.filter((row) =>
      ["pending", "failed", "publishing"].includes(row.status),
    ) || [];
  return (
    <div className={styles.workspace}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className="eyebrow">
            <Sparkles size={13} /> A little room for big things
          </span>
          <h1>Computer</h1>
          <p className="muted">
            {profile.agentName}’s own little workspace. Take a peek, lend a
            hand, and see what’s taking shape.
          </p>
        </div>
        <div className={styles.heroArt} aria-hidden="true">
          <ComputerWorkspaceArt />
        </div>
        <div className={styles.heroActions}>
          <BackupButton
            backups={backups}
            available={!agent.suspended && !maintenance}
            onError={onError}
          />
          <ComputerMaintenance
            blocked={
              backups.working ||
              backups.submitting ||
              !!backups.data?.operation?.needsReconnect
            }
            status={status}
            statusError={statusError}
            refresh={refreshStatus}
            refreshing={refreshing}
            onError={onError}
            className={styles.maintenanceActions}
          />
        </div>
      </header>
      <div className={styles.tabs} role="group" aria-label="Computer view">
        <button
          type="button"
          aria-pressed={view === "overview"}
          onClick={() => setView("overview")}
        >
          Overview
        </button>
        <button
          type="button"
          aria-pressed={view === "files"}
          onClick={() => {
            setFilesVisited(true);
            setView("files");
          }}
        >
          Files
        </button>
        <button
          type="button"
          aria-pressed={view === "services"}
          onClick={() => setView("services")}
        >
          Remote access
        </button>
        <button
          type="button"
          aria-pressed={view === "resources"}
          onClick={() => setView("resources")}
        >
          Resource usage
        </button>
        <button
          type="button"
          aria-pressed={view === "checkpoints"}
          onClick={() => setView("checkpoints")}
        >
          Checkpoints
        </button>
      </div>
      {view === "checkpoints" && (
        <ComputerCheckpoints
          backups={backups}
          name={profile.agentName}
          onRestored={() => {
            void Promise.all([refreshStatus(), refreshMetrics(), refresh()]);
            setView("overview");
          }}
        />
      )}
      {filesVisited && (
        <div hidden={view !== "files"}>
          <ComputerFiles
            key={agent.instanceId}
            owner={profile.id}
            instance={agent.instanceId!}
            available={
              !agent.suspended && status?.canManage !== false && !maintenance
            }
          />
        </div>
      )}
      {view === "overview" && (
        <div className={styles.overview}>
          <div className={styles.desktop}>
            <Computer
              ref={desktopRef}
              profile={profile}
              autoConnect={false}
              screenSize={status?.screen}
              available={
                !!status &&
                !statusError &&
                !agent.suspended &&
                status.canManage !== false &&
                !maintenance
              }
              onReturn={onReturn}
              onError={onError}
            />
          </div>
          <div className={styles.details}>
            <ComputerSettings
              status={status}
              statusError={statusError}
              onRefresh={() => void refreshComputer()}
              refreshing={refreshing}
            />
          </div>
        </div>
      )}
      {view === "resources" && (
        <section className={styles.section} aria-label="Resource metrics">
          <div className={styles.heading}>
            <h2>Resource usage</h2>
            <button
              type="button"
              className={`icon-button ${styles.metricsRefresh}`}
              aria-label={
                metricsRefreshing ? "Refreshing metrics…" : "Refresh metrics"
              }
              title="Refresh resource usage"
              disabled={metricsRefreshing}
              onClick={() => void refreshMetrics()}
            >
              <RefreshCw
                size={16}
                className={metricsRefreshing ? "spin" : ""}
              />
            </button>
          </div>
          <p className="muted">
            Past 24 hours. Dashed lines show limits; gaps show periods without
            samples.
          </p>
          {metricsError && (
            <p role="status" className="error-inline">
              {metricsError}
            </p>
          )}
          {metrics ? (
            <>
              <div className={styles.metrics}>
                <ResourceChart
                  label="CPU"
                  points={metrics.series.cpu_cores}
                  limit={metrics.limits.cpu_cores}
                  metrics={metrics}
                />
                <ResourceChart
                  label="Memory"
                  points={metrics.series.memory_bytes}
                  limit={metrics.limits.memory_bytes}
                  metrics={metrics}
                  bytes
                />
                <ResourceChart
                  label="Disk"
                  points={metrics.series.disk_bytes}
                  limit={metrics.limits.disk_bytes}
                  metrics={metrics}
                  bytes
                />
              </div>
              <p className="fine-print">
                Fetched {new Date(metrics.fetched_at * 1000).toLocaleString()}
                {metricsError ? " · Showing the previous snapshot." : ""}
              </p>
            </>
          ) : (
            !metricsError && <p>Loading resource metrics…</p>
          )}
        </section>
      )}
      {view === "services" && (
        <>
          {loadError && (
            <p className="error-inline" role="alert">
              {loadError}
            </p>
          )}
          {error && !register && !create && !decision && !disable && (
            <p className="error-inline" role="alert">
              {error}
            </p>
          )}
          <section className={styles.section} aria-label="Ready to share?">
            <h2>Ready to share?</h2>
            <p className="muted">
              {profile.agentName} asks here before making a link to something on
              their computer. Take a look, then give the go-ahead.
            </p>
            {!data ? (
              <p className="muted">Gathering link requests…</p>
            ) : pending.length ? (
              pending.map((row) => (
                <article
                  key={row.id}
                  id={`computer-request-${row.id}`}
                  className={`${styles.request} ${requestId === row.id ? styles.highlight : ""}`}
                >
                  <div>
                    <h3>
                      {row.label} <small>Port {row.port}</small>
                    </h3>
                    <p>{row.reason}</p>
                    <p className="muted">
                      {row.source === "agent"
                        ? `${profile.agentName} would like to share this`
                        : "Created by you"}{" "}
                      ·{" "}
                      {row.kind === "signed"
                        ? `Temporary link · ${durations.find((item) => item.value === row.ttlSeconds)?.label || "Expires automatically"}`
                        : "Public link · Open until you close it"}{" "}
                      · {linkStatuses[row.status]}
                    </p>
                    {row.error && <p className="error-inline">{row.error}</p>}
                  </div>
                  <div className={styles.actions}>
                    {["pending", "failed"].includes(row.status) && (
                      <>
                        <button
                          className="button button-primary"
                          disabled={busy || !allowed}
                          onClick={() => setDecision(row)}
                        >
                          {row.status === "failed"
                            ? "Try again"
                            : "Review link"}
                        </button>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            void act(() =>
                              api(
                                `/computer/requests/${row.id}/reject`,
                                "POST",
                                {},
                              ),
                            )
                          }
                        >
                          Decline
                        </button>
                      </>
                    )}
                  </div>
                </article>
              ))
            ) : (
              <p className="muted">Nothing needs your go-ahead just now.</p>
            )}
          </section>
          <section className={styles.section} aria-label="Remote access">
            <div className={styles.heading}>
              <h2>Remote access</h2>
              <button
                className="button button-secondary"
                disabled={busy || !allowed}
                onClick={() => setRegister(true)}
              >
                <Plus size={15} /> Add a doorway
              </button>
            </div>
            <p className="muted">
              Websites, dashboards, and other little helpers from{" "}
              {profile.agentName}’s computer. Make a link and let someone take a
              peek.
            </p>
            <p className="muted">
              Choose a temporary link for a quick peek, or a public link that
              stays open until you close it.
            </p>
            {!data ? (
              <p>Gathering things to share…</p>
            ) : !data.services.length ? (
              <p className="muted">
                Nothing here yet. Ask {profile.agentName} to set something up,
                or add a doorway to something that’s already on their computer.
              </p>
            ) : (
              data.services.map((service) => {
                const links = data.requests.filter(
                  (row) =>
                    row.port === service.port &&
                    ["approved", "expired", "revoked"].includes(row.status),
                );
                const publicLink = links.find(
                  (row) => row.kind === "public" && row.status === "approved",
                );
                return (
                  <article className={styles.service} key={service.port}>
                    <div className={styles.heading}>
                      <h3>
                        {service.label} <small>Port {service.port}</small>
                      </h3>
                      <span>
                        {status?.instanceStatus !== "running"
                          ? `Computer ${status?.instanceStatus || "unknown"}`
                          : {
                              unknown: "Not checked yet",
                              running: "Ready for a peek",
                              not_running: "Not running right now",
                            }[service.state]}
                      </span>
                    </div>
                    <p className="fine-print">
                      {service.checkedAt
                        ? `Last checked ${new Date(service.checkedAt).toLocaleString()}`
                        : "Take a peek to see if this is ready to open."}
                    </p>
                    <div className={styles.actions}>
                      <button
                        className="text-button"
                        disabled={busy || !allowed}
                        onClick={() =>
                          void act(() =>
                            api(
                              `/computer/services/${service.port}/check`,
                              "POST",
                              {},
                            ),
                          )
                        }
                      >
                        Check it’s ready
                      </button>
                      <button
                        className="button button-secondary"
                        disabled={busy || !allowed}
                        onClick={() => {
                          createId.current = crypto.randomUUID();
                          setKind("signed");
                          setTtl(3600);
                          setCreate(service);
                        }}
                      >
                        <LinkIcon size={14} /> Make a link
                      </button>
                      {publicLink && (
                        <button
                          className="text-button"
                          disabled={
                            busy || service.publicRemoval?.phase === "queued"
                          }
                          onClick={() => setDisable(service)}
                        >
                          {service.publicRemoval?.phase === "failed"
                            ? "Try closing link again"
                            : "Close public link"}
                        </button>
                      )}
                    </div>
                    {service.publicRemoval && (
                      <p
                        role="status"
                        className={
                          service.publicRemoval.phase === "failed"
                            ? "error-inline"
                            : "muted"
                        }
                      >
                        {service.publicRemoval.error || "Closing public link…"}
                      </p>
                    )}
                    {links.length > 0 && (
                      <ul className={styles.links}>
                        {links.slice(0, 10).map((link) => (
                          <li key={link.id}>
                            <div>
                              <strong>
                                {link.kind === "signed"
                                  ? "Temporary link"
                                  : "Public link"}
                              </strong>
                              <small>
                                {linkStatuses[link.status]}
                                {link.expiresAt
                                  ? ` · Expires ${new Date(link.expiresAt).toLocaleString()}`
                                  : ""}
                              </small>
                            </div>
                            {link.url &&
                              (link.kind === "signed" ||
                                !service.publicRemoval) && (
                                <div className={styles.actions}>
                                  <a
                                    href={link.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-button"
                                  >
                                    Open <ArrowUpRight size={14} />
                                  </a>
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      void navigator.clipboard
                                        .writeText(link.url!)
                                        .catch((cause) =>
                                          setError(message(cause)),
                                        )
                                    }
                                  >
                                    <Copy size={13} /> Copy
                                  </button>
                                </div>
                              )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                );
              })
            )}
            <p className="fine-print">
              Checking if it’s ready or making a link can wake{" "}
              {profile.agentName}’s computer. Visits through a public link can
              keep it awake.
            </p>
          </section>
        </>
      )}
      {register && (
        <Modal
          title="Add a doorway"
          onClose={() => {
            if (!busy) setRegister(false);
          }}
        >
          <form onSubmit={registerService} className={styles.form}>
            {error && (
              <p className="error-inline" role="alert">
                {error}
              </p>
            )}
            <label>
              What’s it called?
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                required
                maxLength={64}
                placeholder="My little dashboard"
              />
            </label>
            <label>
              Port number
              <input
                type="number"
                min={1}
                max={65535}
                step={1}
                value={port}
                onChange={(event) => setPort(event.target.value)}
                required
              />
            </label>
            <p className="muted">
              Choose what’s behind the door: a website, dashboard, or handy tool
              on {profile.agentName}’s computer. Adding it here doesn’t start it
              or share it yet. Make a link when you’re ready to let someone in.
              Not sure which port it uses? Ask {profile.agentName}.
            </p>
            <button className="button button-primary" disabled={busy}>
              {busy ? "Adding…" : "Add a doorway"}
            </button>
          </form>
        </Modal>
      )}
      {create && (
        <Modal
          title={`Share ${create.label}`}
          onClose={() => {
            if (!busy) setCreate(null);
          }}
        >
          <div className={styles.form}>
            {error && (
              <p className="error-inline" role="alert">
                {error}
              </p>
            )}
            <label>
              How would you like to share it?
              <select
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value as "signed" | "public")
                }
              >
                <option value="signed">Temporary link · a quick peek</option>
                <option value="public" disabled={!!create.publicRemoval}>
                  Public link · keep the door open
                </option>
              </select>
            </label>
            {kind === "signed" && (
              <label>
                Keep it open for
                <select
                  value={ttl}
                  onChange={(event) => setTtl(Number(event.target.value))}
                >
                  {durations.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p>
              {kind === "signed"
                ? `A quick peek, with a time limit. Anyone with this link can open ${create.label} until it expires. It cannot be disabled early.`
                : `Keep the door open to ${create.label}. Anyone with this public link can visit until you close it. Visits can wake ${profile.agentName}’s computer and keep it running.`}
            </p>
            <button
              className="button button-primary"
              disabled={busy || !allowed}
              onClick={() =>
                void act(() =>
                  api("/computer/requests", "POST", {
                    id: createId.current,
                    port: create.port,
                    label: create.label,
                    reason: "Owner created a service link.",
                    kind,
                    ...(kind === "signed" ? { ttl_seconds: ttl } : {}),
                  }),
                )
              }
            >
              {busy
                ? "Creating…"
                : kind === "signed"
                  ? "Make temporary link"
                  : "Make public link"}
            </button>
          </div>
        </Modal>
      )}
      {decision && (
        <Modal
          title="Give this link the go-ahead?"
          onClose={() => {
            if (!busy) setDecision(null);
          }}
        >
          <div className={styles.form}>
            <p>
              <strong>{decision.label}</strong> · Port {decision.port}
            </p>
            {error && (
              <p className="error-inline" role="alert">
                {error}
              </p>
            )}
            <p>{decision.reason}</p>
            <p>
              {decision.kind === "signed"
                ? `A temporary link for a little peek. Anyone with it can open ${decision.label} for ${durations.find((item) => item.value === decision.ttlSeconds)?.label.toLowerCase() || "the requested time"}. It cannot be disabled early.`
                : `A public link keeps the door open to ${decision.label}. Anyone with it can visit until you close it. Visits can wake ${profile.agentName}’s computer and keep it running.`}
            </p>
            <button
              className="button button-primary"
              disabled={busy || !allowed}
              onClick={() =>
                void act(() =>
                  api(`/computer/requests/${decision.id}/approve`, "POST", {}),
                )
              }
            >
              {busy ? "Giving the go-ahead…" : "Give the go-ahead"}
            </button>
          </div>
        </Modal>
      )}
      {disable && (
        <Modal
          title="Close this public link?"
          onClose={() => {
            if (!busy) setDisable(null);
          }}
        >
          <p>
            The public link to {disable.label} will stop letting visitors in.
            Any temporary links will still work until they expire.
          </p>
          {error && (
            <p className="error-inline" role="alert">
              {error}
            </p>
          )}
          <button
            className="button button-danger"
            disabled={busy}
            onClick={() =>
              void act(() =>
                api(`/computer/services/${disable.port}/public-link`, "DELETE"),
              )
            }
          >
            {busy ? "Closing…" : "Close public link"}
          </button>
        </Modal>
      )}
    </div>
  );
}
