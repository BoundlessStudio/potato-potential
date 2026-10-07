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
} from "lucide-react";
import type {
  ComputerMetrics,
  ComputerService,
  Profile,
  PublicComputerLink,
} from "@boundless/shared";
import { api } from "@/lib/client";
import { Computer } from "./computer";
import { ComputerSettings, type ComputerStatus } from "./computer-settings";
import { Modal } from "./modal";
import styles from "./computer-workspace.module.css";

const durations = [
  { value: 900, label: "15 minutes" },
  { value: 3600, label: "One hour" },
  { value: 86400, label: "24 hours" },
  { value: 604800, label: "Seven days" },
];
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
  onReturn,
  onError,
  requestId,
}: {
  profile: Profile;
  onReturn: () => void;
  onError: (message: string) => void;
  requestId?: string;
}) {
  const [status, setStatus] = useState<ComputerStatus | null>(null);
  const [data, setData] = useState<Services | null>(null);
  const [metrics, setMetrics] = useState<ComputerMetrics | null>(null);
  const [metricsError, setMetricsError] = useState("");
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
  const refresh = useCallback(async () => {
    try {
      setData(await api<Services>("/computer/services"));
      setLoadError("");
    } catch (cause) {
      setLoadError(message(cause));
    }
  }, []);
  const refreshMetrics = useCallback(async () => {
    try {
      setMetrics(await api<ComputerMetrics>("/computer/metrics"));
      setMetricsError("");
    } catch (cause) {
      setMetricsError(message(cause));
    }
  }, []);
  useEffect(() => {
    void refresh();
    void refreshMetrics();
  }, [refresh, refreshMetrics]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (requestId && data)
      document
        .getElementById(`computer-request-${requestId}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [requestId, data]);
  const maintenance =
    !!status?.operation &&
    ["queued", "applying", "checking"].includes(status.operation.phase);
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
      <header>
        <span className="eyebrow">Their space to work</span>
        <h1>Computer</h1>
        <p className="muted">
          Watch your companion work, manage their computer, and share services
          when you’re ready.
        </p>
      </header>
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
      <div className={styles.overview}>
        <div className={styles.desktop}>
          <Computer
            profile={profile}
            autoConnect={false}
            available={!!status && status.canManage !== false && !maintenance}
            onReturn={onReturn}
            onError={onError}
          />
        </div>
        <div className={styles.details}>
          <ComputerSettings onStatus={setStatus} />
          <section className={styles.section} aria-label="Resource metrics">
            <div className={styles.heading}>
              <h2>Resource usage</h2>
              <button
                className="text-button"
                onClick={() => void refreshMetrics()}
              >
                <RefreshCw size={14} /> Refresh metrics
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
        </div>
      </div>
      <section className={styles.section} aria-label="Publication requests">
        <h2>Publication requests</h2>
        {pending.length ? (
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
                    ? "Requested by your companion"
                    : "Created by you"}{" "}
                  ·{" "}
                  {row.kind === "signed"
                    ? `Signed link · ${durations.find((item) => item.value === row.ttlSeconds)?.label}`
                    : "Permanent public link"}{" "}
                  · {row.status}
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
                        ? "Retry approval"
                        : "Review request"}
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
                      Reject
                    </button>
                  </>
                )}
              </div>
            </article>
          ))
        ) : (
          <p className="muted">No requests waiting for approval.</p>
        )}
      </section>
      <section className={styles.section} aria-label="Registered services">
        <div className={styles.heading}>
          <h2>Services</h2>
          <button
            className="button button-secondary"
            disabled={busy || !allowed}
            onClick={() => setRegister(true)}
          >
            <Plus size={15} /> Register service
          </button>
        </div>
        <p className="muted">
          Registered services only. Checking or publishing a service can wake
          the computer.
        </p>
        {!data ? (
          <p>Loading services…</p>
        ) : !data.services.length ? (
          <p className="muted">
            Register an HTTP service by its port, or let your companion request
            a link.
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
                      : service.state.replaceAll("_", " ")}
                  </span>
                </div>
                <p className="fine-print">
                  {service.checkedAt
                    ? `Last checked ${new Date(service.checkedAt).toLocaleString()}`
                    : "Service availability hasn’t been checked yet."}
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
                    Check service
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
                    <LinkIcon size={14} /> Create link
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
                        ? "Retry disabling public link"
                        : "Disable public link"}
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
                    {service.publicRemoval.error || "Disabling public link…"}
                  </p>
                )}
                {links.length > 0 && (
                  <ul className={styles.links}>
                    {links.slice(0, 10).map((link) => (
                      <li key={link.id}>
                        <div>
                          <strong>
                            {link.kind === "signed"
                              ? "Signed preview"
                              : "Public link"}
                          </strong>
                          <small>
                            {link.status}
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
                                    .catch((cause) => setError(message(cause)))
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
          Desktop, browser debugging, Inkbox, and native channel endpoints are
          managed by the application.
        </p>
      </section>
      {register && (
        <Modal
          title="Register an HTTP service"
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
              Service name
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                required
                maxLength={64}
                placeholder="Project preview"
              />
            </label>
            <label>
              Port
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
              Registration records the service. Use Check service to verify it
              is running.
            </p>
            <button className="button button-primary" disabled={busy}>
              {busy ? "Saving…" : "Register service"}
            </button>
          </form>
        </Modal>
      )}
      {create && (
        <Modal
          title={`Create a link for ${create.label}`}
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
              Link type
              <select
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value as "signed" | "public")
                }
              >
                <option value="signed">Signed preview</option>
                <option value="public" disabled={!!create.publicRemoval}>
                  Permanent public link
                </option>
              </select>
            </label>
            {kind === "signed" && (
              <label>
                Expiry
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
                ? "Anyone with the link can open this service until it expires. It cannot be disabled early."
                : "Anyone with the public URL can access this service until you disable it. Public traffic can wake the computer and keep it running."}
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
                  ? "Create signed link"
                  : "Create public link"}
            </button>
          </div>
        </Modal>
      )}
      {decision && (
        <Modal
          title="Approve this service link?"
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
                ? `This signed link will last ${durations.find((item) => item.value === decision.ttlSeconds)?.label.toLowerCase()}. Anyone with it can access the service until expiry; it cannot be disabled early.`
                : "This creates a permanent public link. Anyone with the URL can access the service until you disable it; traffic may wake the computer."}
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
              {busy ? "Approving…" : "Approve link"}
            </button>
          </div>
        </Modal>
      )}
      {disable && (
        <Modal
          title="Disable this public link?"
          onClose={() => {
            if (!busy) setDisable(null);
          }}
        >
          <p>
            The public URL for {disable.label} will stop working. Signed links
            remain valid until their expiry.
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
            {busy ? "Disabling…" : "Disable public link"}
          </button>
        </Modal>
      )}
    </div>
  );
}
