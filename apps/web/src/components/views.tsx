"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ExternalLink,
  FileText,
  Lightbulb,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  avatars,
  colors,
  type Connection,
  type Cron,
  type CronRun,
  type Profile,
  type PublicAgent,
  type Toolkit,
  type WorkspaceItem,
} from "@boundless/shared";
import { api, demo } from "@/lib/client";
import { Companion } from "./companion";
import { FileDownloadLink } from "./file-download-link";

type Feedback = {
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
};
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "This request was interrupted.";
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => <FileDownloadLink {...props} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
export { Modal } from "./modal";
import { Modal } from "./modal";
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Empty({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="empty-state">
      {icon}
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
export function ItemEditor({
  item,
  kind,
  onClose,
  onSave,
  ...feedback
}: {
  item?: WorkspaceItem;
  kind: WorkspaceItem["kind"];
  onClose: () => void;
  onSave: () => void;
} & Feedback) {
  const [title, setTitle] = useState(item?.title || "");
  const [body, setBody] = useState(item?.body || "");
  const [status, setStatus] = useState(item?.status || "todo");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api("/items", "POST", {
        id: item?.id,
        kind,
        title,
        body,
        status,
        metadata: item?.metadata || {},
      });
      onSave();
      onClose();
      feedback.onSuccess(
        kind === "wiki" ? "Your wiki is up to date." : "Your work is saved.",
      );
    } catch (error) {
      feedback.onError(errorText(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={`${item ? "Edit" : "Add"} ${kind === "wiki" ? "wiki page" : "task"}`}
      onClose={onClose}
    >
      <form onSubmit={submit} className="stack">
        <label>
          Title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            maxLength={160}
            placeholder={
              kind === "wiki"
                ? "Something worth remembering"
                : "What should we take care of?"
            }
          />
        </label>
        <label>
          {kind === "wiki"
            ? "Your notes · Markdown welcome"
            : "A little context"}
          <textarea
            className={kind === "wiki" ? "large-textarea" : ""}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="The details that help…"
          />
        </label>
        {kind !== "wiki" && (
          <label>
            Status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as any)}
            >
              <option value="todo">To do</option>
              <option value="in_progress">In progress</option>
              <option value="needs_you">Needs you</option>
              <option value="completed">Completed</option>
              <option value="failed">Needs another try</option>
            </select>
          </label>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button button-primary" disabled={saving}>
            {saving ? <Loader2 size={16} /> : <Check size={16} />}Save{" "}
            {kind === "wiki" ? "page" : "task"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function Tasks({
  items,
  refresh,
  ...feedback
}: { items: WorkspaceItem[]; refresh: () => void } & Feedback) {
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<WorkspaceItem | null | undefined>();
  const rows = items.filter(
    (item) =>
      ["task", "responsibility"].includes(item.kind) &&
      (filter === "all" || item.status === filter),
  );
  async function complete(item: WorkspaceItem) {
    try {
      await api("/items", "POST", {
        ...item,
        status: item.status === "completed" ? "todo" : "completed",
      });
      refresh();
    } catch (error) {
      feedback.onError(errorText(error));
    }
  }
  async function remove(item: WorkspaceItem) {
    try {
      await api(`/items/${item.id}`, "DELETE");
      refresh();
      feedback.onSuccess("Task removed.");
    } catch (error) {
      feedback.onError(errorText(error));
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="A little momentum"
        title="Good things, getting done."
        description="The work you’ve handed over. The next steps you’re taking together."
        action={
          <button
            className="button button-primary"
            onClick={() => setEditing(null)}
          >
            <Plus size={17} />
            Add a task
          </button>
        }
      />
      <div className="filter-tabs">
        {[
          ["all", "All your work"],
          ["in_progress", "In progress"],
          ["needs_you", "Needs you"],
          ["completed", "Completed"],
        ].map(([value, label]) => (
          <button
            key={value}
            className={filter === value ? "active" : ""}
            onClick={() => setFilter(value)}
          >
            {label}
            <span>
              {
                items.filter(
                  (item) =>
                    ["task", "responsibility"].includes(item.kind) &&
                    (value === "all" || item.status === value),
                ).length
              }
            </span>
          </button>
        ))}
      </div>
      <div className="task-list">
        {rows.map((item) => (
          <div
            key={item.id}
            className={`task-row ${item.status === "completed" ? "task-done" : ""}`}
          >
            <button
              className={`task-check ${item.status === "completed" ? "checked" : ""}`}
              aria-label={`${item.status === "completed" ? "Reopen" : "Complete"} ${item.title}`}
              onClick={() => void complete(item)}
            >
              {item.status === "completed" && <Check size={14} />}
            </button>
            <button className="task-content" onClick={() => setEditing(item)}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              <span className={`status-tag ${item.status}`}>
                {item.kind === "responsibility"
                  ? "Ongoing responsibility"
                  : item.status.replaceAll("_", " ")}
              </span>
            </button>
            <button
              className="icon-button"
              onClick={() => void remove(item)}
              aria-label={`Delete ${item.title}`}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      {!rows.length && (
        <Empty
          icon={<CheckCircle2 size={34} />}
          title="A little room for what’s next."
          text="Add a task, or hand your companion something to take care of."
        />
      )}
      {editing !== undefined && (
        <ItemEditor
          item={editing || undefined}
          kind={editing?.kind || "task"}
          onClose={() => setEditing(undefined)}
          onSave={refresh}
          {...feedback}
        />
      )}
    </>
  );
}
export function Wiki({
  items,
  refresh,
  ...feedback
}: { items: WorkspaceItem[]; refresh: () => void } & Feedback) {
  const rows = items.filter((item) => item.kind === "wiki");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<WorkspaceItem | null | undefined>();
  const page = rows.find((item) => item.id === selected) || rows[0];
  async function remove() {
    if (!page) return;
    try {
      await api(`/items/${page.id}`, "DELETE");
      refresh();
      setSelected(null);
    } catch (error) {
      feedback.onError(errorText(error));
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="The things that make you, you"
        title="A shared little memory."
        description="Your world, your rhythms, and the details your companion is learning."
        action={
          <button
            className="button button-primary"
            onClick={() => setEditing(null)}
          >
            <Plus size={17} />
            New page
          </button>
        }
      />
      {rows.length ? (
        <div className="wiki-layout">
          <div className="wiki-index">
            <span className="eyebrow">Your pages</span>
            {rows.map((row) => (
              <button
                key={row.id}
                className={page?.id === row.id ? "selected" : ""}
                onClick={() => setSelected(row.id)}
              >
                <FileText size={16} />
                {row.title}
              </button>
            ))}
          </div>
          <article className="wiki-document">
            <div className="wiki-document-heading">
              <div>
                <span className="eyebrow">
                  Last updated{" "}
                  {new Date(page.updatedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <h2>{page.title}</h2>
              </div>
              <div className="inline-actions">
                <button
                  className="button button-secondary"
                  onClick={() => setEditing(page)}
                >
                  Edit page
                </button>
                <button
                  className="icon-button"
                  onClick={() => void remove()}
                  aria-label="Delete wiki page"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            <Markdown>
              {page.body ||
                "A blank page. A little room for something worth remembering."}
            </Markdown>
          </article>
        </div>
      ) : (
        <Empty
          icon={<BookOpen size={34} />}
          title="Your story starts here."
          text="Add what matters. Your companion can keep learning and adding to it."
        />
      )}
      {editing !== undefined && (
        <ItemEditor
          item={editing || undefined}
          kind="wiki"
          onClose={() => setEditing(undefined)}
          onSave={refresh}
          {...feedback}
        />
      )}
    </>
  );
}
export function Routines({
  routines,
  runs,
  refresh,
  profile,
  initialPrompt,
  clearPrompt,
  openSession,
  ...feedback
}: {
  routines: Cron[];
  runs: CronRun[];
  refresh: () => void;
  profile: Profile;
  initialPrompt?: string;
  clearPrompt: () => void;
  openSession: (id: string) => void;
} & Feedback) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [schedule, setSchedule] = useState("30 8 * * 1-5");
  const [once, setOnce] = useState(false);
  const [when, setWhen] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (initialPrompt) {
      setPrompt(initialPrompt);
      setName("A new little routine");
      setAdding(true);
      clearPrompt();
    }
  }, [initialPrompt, clearPrompt]);
  function preset(title: string, text: string, expression: string) {
    setName(title);
    setPrompt(text);
    setSchedule(expression);
    setOnce(false);
    setAdding(true);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api("/routines", "POST", {
        name,
        prompt,
        ...(once ? { when: new Date(when).toISOString() } : { schedule }),
      });
      refresh();
      setAdding(false);
      feedback.onSuccess("Your routine has a place on the schedule.");
    } catch (error) {
      feedback.onError(errorText(error));
    } finally {
      setSaving(false);
    }
  }
  async function action(cron: Cron, type: "pause" | "run" | "delete") {
    try {
      await api(
        `/routines/${cron.id}${type === "run" ? "/run" : ""}`,
        type === "run" ? "POST" : type === "delete" ? "DELETE" : "PATCH",
        type === "pause" ? { enabled: !cron.enabled } : undefined,
      );
      refresh();
      feedback.onSuccess(
        type === "run"
          ? "Check-in started. Its result will appear when the agent finishes."
          : type === "delete"
            ? "Routine removed."
            : cron.enabled
              ? "Routine paused."
              : "Routine resumed.",
      );
    } catch (error) {
      feedback.onError(errorText(error));
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="A helping hand, on repeat"
        title="Make a little rhythm."
        description="Good habits for your agent. More headspace for you."
        action={
          <button
            className="button button-primary"
            onClick={() => {
              setName("");
              setPrompt("");
              setAdding(true);
            }}
          >
            <Plus size={17} />
            New routine
          </button>
        }
      />
      <div className="routine-presets">
        {[
          [
            "A lighter morning",
            "Your day, the urgent things, a clear next step.",
            "Prepare a concise morning briefing using the calendars, inboxes, and apps connected by the owner.",
            "30 8 * * 1-5",
          ],
          [
            "The Friday wrap-up",
            "What moved. What matters. What can wait.",
            "Review work from this week and share a short wrap-up.",
            "0 16 * * 5",
          ],
          [
            "Keep an eye on something",
            "A useful update when something changes.",
            "Monitor the topic or responsibility the owner specifies. Notify only when there is something useful to know.",
            "0 9 * * *",
          ],
        ].map(([title, caption, text, expression], index) => (
          <button
            key={title}
            className="preset-card"
            onClick={() => preset(title, text, expression)}
          >
            <span className={`preset-icon preset-${index}`}>
              <Sparkles size={21} />
            </span>
            <h3>{title}</h3>
            <p>{caption}</p>
            <span>
              Make it yours <ArrowRight size={14} />
            </span>
          </button>
        ))}
      </div>
      <div className="section-heading">
        <h2>
          Your routines <span>{routines.length}</span>
        </h2>
        <button
          className="text-button"
          onClick={async () => {
            try {
              await api("/routines/sync", "POST");
              refresh();
              feedback.onSuccess(
                "Checking recent runs. Refresh shortly to see their results.",
              );
            } catch (error) {
              feedback.onError(errorText(error));
            }
          }}
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>
      <div className="routine-list">
        {routines.map((cron) => (
          <div className="routine-row" key={cron.id}>
            <span className="routine-symbol">
              <Clock3 size={22} />
            </span>
            <div>
              <h3>{cron.name}</h3>
              <p>
                <span
                  className={`status-dot ${cron.enabled ? "" : "paused"}`}
                />
                {cron.enabled ? "On the schedule" : "Paused"} · {cron.schedule}{" "}
                · {cron.timezone}
              </p>
              {cron.next_run && (
                <small>
                  Next:{" "}
                  {new Date(cron.next_run * 1000).toLocaleString(undefined, {
                    timeZone: cron.timezone,
                  })}
                </small>
              )}
            </div>
            <div className="inline-actions">
              <button
                className="icon-button"
                aria-label={`Run ${cron.name}`}
                onClick={() => void action(cron, "run")}
              >
                <Play size={16} />
              </button>
              <button
                className="icon-button"
                aria-label={`${cron.enabled ? "Pause" : "Resume"} ${cron.name}`}
                onClick={() => void action(cron, "pause")}
              >
                {cron.enabled ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <button
                className="icon-button"
                aria-label={`Delete ${cron.name}`}
                onClick={() => void action(cron, "delete")}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {!routines.length && (
        <Empty
          icon={<Clock3 size={32} />}
          title="Find your rhythm."
          text="Start with a little routine above, or ask your companion to make one."
        />
      )}
      <div className="section-heading">
        <h2>Past check-ins</h2>
        <span className="fine-print">
          A started run is still work in progress.
        </span>
      </div>
      {runs.length ? (
        <div className="routine-list">
          {runs.map((run, index) => (
            <button
              className="run-row"
              key={`${run.cronId}-${index}`}
              disabled={!run.session_id}
              onClick={() => run.session_id && openSession(run.session_id)}
            >
              <span>{run.name}</span>
              <span>
                {run.status === "skipped"
                  ? `Skipped · ${run.reason || "Unavailable"}`
                  : run.outcome === "completed"
                    ? "Finished"
                    : run.outcome === "running"
                      ? "Working"
                      : "Started · result pending"}
              </span>
              <small>{new Date(run.ran_at * 1000).toLocaleString()}</small>
            </button>
          ))}
        </div>
      ) : (
        <p className="quiet-note">
          Your agent’s check-ins will appear here as they happen.
        </p>
      )}
      {adding && (
        <Modal title="A little routine" onClose={() => setAdding(false)}>
          <form onSubmit={submit} className="stack">
            <label>
              Name
              <input
                required
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="What should we call it?"
              />
            </label>
            <label>
              What should your agent do?
              <textarea
                required
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="A useful, self-contained instruction…"
              />
            </label>
            <div className="segmented">
              <button
                type="button"
                className={!once ? "active" : ""}
                onClick={() => setOnce(false)}
              >
                Repeating routine
              </button>
              <button
                type="button"
                className={once ? "active" : ""}
                onClick={() => setOnce(true)}
              >
                One-time reminder
              </button>
            </div>
            {once ? (
              <label>
                When · your device’s local time
                <input
                  type="datetime-local"
                  required
                  value={when}
                  onChange={(event) => setWhen(event.target.value)}
                />
              </label>
            ) : (
              <label>
                Schedule · {profile.timezone}
                <input
                  required
                  value={schedule}
                  onChange={(event) => setSchedule(event.target.value)}
                />
                <small>
                  Minute, hour, day, month, weekday. For example: 30 8 * * 1-5.
                </small>
              </label>
            )}
            <button className="button button-primary" disabled={saving}>
              {saving ? <Loader2 size={16} /> : <Clock3 size={16} />}Make it a
              routine
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
function AppLogo({
  toolkit,
}: {
  toolkit: Pick<Toolkit, "slug" | "name" | "logo">;
}) {
  const source = toolkit.logo?.startsWith("https://")
    ? toolkit.logo
    : `https://logos.composio.dev/api/${encodeURIComponent(toolkit.slug)}`;
  const [failedSource, setFailedSource] = useState<string | null>(null);
  return (
    <span className="app-logo" aria-hidden="true">
      {failedSource === source ? (
        <span className="app-letter">
          {toolkit.name.slice(0, 1).toUpperCase()}
        </span>
      ) : (
        <img
          src={source}
          alt=""
          width={32}
          height={32}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedSource(source)}
        />
      )}
    </span>
  );
}

function isComposio(slug: string, name?: string) {
  return [slug, name].some(
    (value) => value?.trim().toLowerCase() === "composio",
  );
}

export function Apps(feedback: Feedback) {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Toolkit[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const catalogVersion = useRef(0);
  const query = search.trim();
  const shortSearch = query.length > 0 && query.length < 3;
  const [connecting, setConnecting] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const visibleRows = rows.filter((row) => !isComposio(row.slug, row.name));
  const visibleConnections = connections.filter(
    (connection) => !isComposio(connection.toolkitSlug, connection.toolkitName),
  );
  const reloadConnections = useCallback(async () => {
    try {
      setConnections((await api("/apps/connections")).connections || []);
    } catch (error) {
      feedback.onError(errorText(error));
    }
  }, [feedback.onError]);
  useEffect(() => {
    let valid = true;
    catalogVersion.current++;
    setRows([]);
    setCursor(null);
    setLoadingMore(false);
    setCatalogError(null);
    setLoading(!shortSearch);
    if (shortSearch) return;
    const timer = setTimeout(() => {
      void api(`/apps?search=${encodeURIComponent(query)}`)
        .then((data) => {
          if (valid) {
            setRows(data.toolkits || []);
            setCursor(data.nextCursor);
          }
        })
        .catch((error) => {
          if (valid) setCatalogError(errorText(error));
        })
        .finally(() => {
          if (valid) setLoading(false);
        });
    }, 220);
    return () => {
      valid = false;
      clearTimeout(timer);
    };
  }, [query, shortSearch, retry]);
  useEffect(() => {
    void reloadConnections();
    const focus = () => void reloadConnections();
    function message(event: MessageEvent) {
      if (
        event.origin === window.location.origin &&
        event.data?.type === "boundless-connected"
      )
        void reloadConnections();
    }
    window.addEventListener("focus", focus);
    window.addEventListener("message", message);
    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("message", message);
    };
  }, [reloadConnections]);
  async function connect(toolkit: Toolkit) {
    const popup = window.open(
      "about:blank",
      "boundless-connect",
      "popup,width=650,height=780",
    );
    setConnecting(toolkit.slug);
    try {
      const data = await api("/apps/connect", "POST", {
        toolkit: toolkit.slug,
      });
      const url = new URL(data.redirectUrl);
      if (
        url.protocol !== "https:" &&
        !(demo && url.origin === window.location.origin)
      )
        throw new Error(
          "The connection returned an unexpected sign-in address.",
        );
      if (popup) popup.location.href = url.href;
      else setFallback(url.href);
      if (demo) await reloadConnections();
    } catch (error) {
      popup?.close();
      feedback.onError(errorText(error));
    } finally {
      setConnecting(null);
    }
  }
  async function disconnect(connection: Connection) {
    try {
      await api(`/apps/connections/${connection.id}`, "DELETE");
      await reloadConnections();
      feedback.onSuccess("App disconnected.");
    } catch (error) {
      feedback.onError(errorText(error));
    }
  }
  async function more() {
    if (!cursor || loading || loadingMore || shortSearch) return;
    const version = catalogVersion.current;
    setLoadingMore(true);
    try {
      const data = await api(
        `/apps?search=${encodeURIComponent(query)}&cursor=${encodeURIComponent(cursor)}`,
      );
      if (version !== catalogVersion.current) return;
      setRows((current) => [
        ...new Map(
          [...current, ...data.toolkits].map((toolkit: Toolkit) => [
            toolkit.slug,
            toolkit,
          ]),
        ).values(),
      ]);
      setCursor(data.nextCursor);
    } catch (error) {
      if (version === catalogVersion.current)
        feedback.onError(errorText(error));
    } finally {
      if (version === catalogVersion.current) setLoadingMore(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="Bring your world along"
        title="Good company for your companion."
        description="Connect the tools you already use. Your agent can work across all of them."
      />
      <div className="apps-toolbar">
        <label className="search-field">
          <Search size={19} />
          <input
            placeholder="Search apps, e.g. Gmail, Slack, GitHub…"
            aria-label="Search apps"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button
          className="text-button"
          onClick={() => void reloadConnections()}
        >
          <RefreshCw size={15} />
          Check connections
        </button>
      </div>
      {visibleConnections.length > 0 && (
        <div className="connected-strip">
          <span className="eyebrow">In your world</span>
          {visibleConnections.map((connection) => (
            <span key={connection.id} className="connection-chip">
              <span
                className={`status-dot ${connection.status === "ACTIVE" ? "" : "paused"}`}
              />
              {connection.toolkitName || connection.toolkitSlug}
              <small>
                {connection.status === "ACTIVE"
                  ? "Connected"
                  : connection.status}
              </small>
              <button
                className="icon-button"
                aria-label={`Disconnect ${connection.toolkitName || connection.toolkitSlug}`}
                onClick={() => void disconnect(connection)}
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
      {catalogError ? (
        <div className="settings-card" role="alert">
          <h2>Couldn’t load the apps.</h2>
          <p className="fine-print">{catalogError}</p>
          <button
            className="button button-secondary"
            onClick={() => setRetry((value) => value + 1)}
          >
            <RefreshCw size={15} /> Try again
          </button>
        </div>
      ) : shortSearch ? (
        <p className="quiet-note" role="status">
          Type at least three characters to search, or clear the search to
          browse all apps.
        </p>
      ) : loading ? (
        <div className="loading-inline">
          <Loader2 className="spin" size={24} />
          Finding good company…
        </div>
      ) : (
        <div className="app-grid">
          {visibleRows.map((toolkit) => {
            const connection = connections.find(
              (row) =>
                row.toolkitSlug.toLowerCase() === toolkit.slug.toLowerCase() &&
                row.status === "ACTIVE",
            );
            return (
              <div className="app-card" key={toolkit.slug}>
                <AppLogo toolkit={toolkit} />
                <div className="app-details">
                  <h3 title={toolkit.name}>{toolkit.name}</h3>
                  <p title={toolkit.description}>{toolkit.description}</p>
                </div>
                {toolkit.isNoAuth ? (
                  <span
                    className="status-tag completed"
                    title="Available without sign-in"
                  >
                    <Check size={13} /> Ready
                  </span>
                ) : (
                  <button
                    className={`button ${connection?.status === "ACTIVE" ? "button-connected" : "button-secondary"}`}
                    disabled={
                      Boolean(connection?.status === "ACTIVE") ||
                      connecting === toolkit.slug
                    }
                    onClick={() => void connect(toolkit)}
                  >
                    {connecting === toolkit.slug ? (
                      <Loader2 className="spin" size={13} />
                    ) : connection?.status === "ACTIVE" ? (
                      <Check size={13} />
                    ) : (
                      <ExternalLink size={13} />
                    )}{" "}
                    {connection?.status === "ACTIVE" ? "Connected" : "Connect"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {!loading && !catalogError && !shortSearch && !visibleRows.length && (
        <Empty
          icon={<Search size={32} />}
          title="No apps found just yet."
          text="Try another name or a broader search."
        />
      )}
      {!loading && !catalogError && !shortSearch && cursor && (
        <button
          className="button button-secondary load-more"
          onClick={() => void more()}
          disabled={loadingMore}
        >
          {loadingMore ? (
            <>
              Loading more apps <Loader2 className="spin" size={16} />
            </>
          ) : (
            <>
              Explore more apps <ChevronDown size={16} />
            </>
          )}
        </button>
      )}
      <p className="catalog-note">
        {demo
          ? "Try connecting an app in this preview."
          : "Connect an app to bring it into your companion’s world."}
      </p>
      {fallback && (
        <Modal
          title="Continue connecting your app"
          onClose={() => setFallback(null)}
        >
          <p>
            Your browser blocked the sign-in window. Continue with the link
            below.
          </p>
          <a
            href={fallback}
            target="_blank"
            rel="noopener noreferrer"
            className="button button-primary"
          >
            Continue to sign-in <ExternalLink size={16} />
          </a>
        </Modal>
      )}
    </>
  );
}
export function Settings({
  profile,
  agent,
  operator = false,
  refresh,
  closeAccount,
  ...feedback
}: {
  profile: Profile;
  agent: PublicAgent;
  operator?: boolean;
  refresh: () => void;
  closeAccount: () => Promise<void>;
} & Feedback) {
  const [draft, setDraft] = useState(profile);
  const [saving, setSaving] = useState(false);
  const [memory, setMemory] = useState<{
    content: string;
    modified: number;
  } | null>(null);
  const [memoryFile, setMemoryFile] = useState<"user" | "memory">("user");
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [closing, setClosing] = useState(false);
  const [channels, setChannels] = useState<any>(null);
  useEffect(() => setDraft(profile), [profile]);
  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api("/profile", "PUT", draft);
      refresh();
      feedback.onSuccess(
        "A little more you. New conversations will use these preferences.",
      );
    } catch (error) {
      feedback.onError(errorText(error));
    } finally {
      setSaving(false);
    }
  }
  async function readMemory(file: "user" | "memory") {
    try {
      setMemory(await api(`/memory/${file}`));
      setMemoryFile(file);
      setMemoryOpen(true);
    } catch (error) {
      feedback.onError(errorText(error));
    }
  }
  async function saveMemory() {
    try {
      await api(`/memory/${memoryFile}`, "PUT", memory);
      setMemory(await api(`/memory/${memoryFile}`));
      feedback.onSuccess("Memory saved.");
    } catch (error) {
      feedback.onError(errorText(error));
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="Make it feel like you"
        title="A companion of your own."
        description="A name, a personality, and a little space to keep learning together."
      />
      <form className="settings-layout" onSubmit={save}>
        <div className="settings-card">
          <div className="personalization-preview">
            <Companion avatar={draft.avatar} color={draft.color} size={140} />
            <div>
              <h2>{draft.agentName}</h2>
              <p>A little curious. Always in your corner.</p>
            </div>
          </div>
          <span className="field-label">A familiar little face</span>
          <div className="avatar-options">
            {avatars.map((avatar) => (
              <button
                type="button"
                key={avatar}
                aria-label={`Choose ${avatar}`}
                aria-pressed={draft.avatar === avatar}
                className={draft.avatar === avatar ? "selected" : ""}
                onClick={() => setDraft((current) => ({ ...current, avatar }))}
              >
                <Companion avatar={avatar} color={draft.color} size={54} />
              </button>
            ))}
          </div>
          <span className="field-label">Their favorite color</span>
          <div className="color-options">
            {colors.map((color) => (
              <button
                type="button"
                key={color}
                style={{ background: color }}
                aria-label={`Choose color ${color}`}
                aria-pressed={draft.color === color}
                className={draft.color === color ? "selected" : ""}
                onClick={() => setDraft((current) => ({ ...current, color }))}
              >
                {draft.color === color && <Check size={15} />}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-card stack">
          <div className="form-two">
            <label>
              Your name
              <input
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                required
              />
            </label>
            <label>
              Your companion’s name
              <input
                value={draft.agentName}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    agentName: event.target.value,
                  }))
                }
                required
              />
            </label>
          </div>
          <label>
            Personality
            <textarea
              value={draft.personality}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  personality: event.target.value,
                }))
              }
            />
          </label>
          <label>
            The way you like things
            <textarea
              value={draft.preferences}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  preferences: event.target.value,
                }))
              }
              placeholder="Your rhythms, preferences, and when you’d like them to ask…"
            />
          </label>
          <label>
            Timezone
            <input
              value={draft.timezone}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  timezone: event.target.value,
                }))
              }
            />
          </label>
          <button
            className="button button-primary align-start"
            disabled={saving}
          >
            {saving ? <Loader2 size={16} /> : <Check size={16} />}Save changes
          </button>
        </div>
      </form>
      <div className="settings-bottom">
        <div className="settings-card">
          <span className="eyebrow">One relationship, wherever you are</span>
          <h2>Keep in touch.</h2>
          <div className="channel-lines">
            <p>
              <span>Web chat</span>
              <span className="status-tag completed">Ready</span>
            </p>
            <p>
              <span>Agent email</span>
              <a href={`mailto:${agent.agentEmail}`}>{agent.agentEmail}</a>
            </p>
            <p>
              <span>Your verified number</span>
              <strong>{profile.phone}</strong>
            </p>
            <p>
              <span>iMessage & calls</span>
              <strong>
                {agent.phoneVerifiedAt || demo
                  ? "Connected through Inkbox"
                  : "Finish phone setup"}
              </strong>
            </p>
            <p>
              <span>Voice</span>
              <strong>Hosted voice + transcript</strong>
            </p>
            {agent.sms && (
              <p>
                <span>SMS</span>
                <strong>
                  {agent.sms.number} · {agent.sms.status}
                </strong>
              </p>
            )}
          </div>
          <p className="fine-print">
            Hermes keeps its native tools, approvals, and enforcement. Phone
            calls use Inkbox Voice AI and share their transcript afterwards.
          </p>
        </div>
        <div className="settings-card">
          <span className="eyebrow">A little room to remember</span>
          <h2>What they know.</h2>
          <p className="muted">
            See and edit the notes your agent keeps across conversations.
          </p>
          <div className="memory-actions">
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void readMemory("user")}
            >
              <BookOpen size={16} />
              About you
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void readMemory("memory")}
            >
              <Sparkles size={16} />
              Agent notes
            </button>
          </div>
        </div>
      </div>
      <div className="danger-zone">
        <div>
          <h3>Close your account</h3>
          <p>
            This removes your agent’s computer, identity, and workspace.
            Provider backups follow their retention policy.
          </p>
        </div>
        <button
          className="button button-danger"
          onClick={() => setDeleting(true)}
        >
          Delete account
        </button>
      </div>
      {memoryOpen && memory && (
        <Modal
          title={
            memoryFile === "user"
              ? "The things they know about you"
              : "Your agent’s notes"
          }
          onClose={() => setMemoryOpen(false)}
        >
          <label>
            Native Hermes memory
            <textarea
              className="large-textarea"
              value={memory.content}
              onChange={(event) =>
                setMemory((current) =>
                  current
                    ? { ...current, content: event.target.value }
                    : current,
                )
              }
            />
          </label>
          <div className="modal-actions">
            <button
              className="button button-secondary"
              onClick={() => void readMemory(memoryFile)}
            >
              <RefreshCw size={15} />
              Reload latest
            </button>
            <button
              className="button button-primary"
              onClick={() => void saveMemory()}
            >
              Save memory
            </button>
          </div>
          <p className="fine-print">
            If your agent edited these notes meanwhile, saving pauses so you can
            reload the latest version.
          </p>
        </Modal>
      )}
      {deleting && (
        <Modal
          title="Say goodbye to this companion?"
          onClose={() => {
            if (!closing) setDeleting(false);
          }}
        >
          <p>
            The computer, phone identity, and your workspace will be removed.
            This cannot be undone.
          </p>
          <div className="modal-actions">
            <button
              className="button button-secondary"
              disabled={closing}
              onClick={() => setDeleting(false)}
            >
              Keep my companion
            </button>
            <button
              className="button button-danger"
              disabled={closing}
              onClick={async () => {
                setClosing(true);
                try {
                  await closeAccount();
                  setDeleting(false);
                  feedback.onSuccess(
                    "Account cleanup started. We’ll keep the record until both providers confirm deletion.",
                  );
                } catch (error) {
                  feedback.onError(errorText(error));
                } finally {
                  setClosing(false);
                }
              }}
            >
              {closing ? "Closing account…" : "Delete my account"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function Operator(feedback: Feedback) {
  const [data, setData] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const load = useCallback(async () => {
    try {
      setData(await api("/operator"));
    } catch (error) {
      feedback.onError(errorText(error));
    }
  }, [feedback.onError]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <>
      <PageHeading
        eyebrow="Keep the beta in good hands"
        title="A little behind the scenes."
        description="Customer agents and the things that need attention."
      />
      <div className="section-heading">
        <h2>Your beta companions</h2>
        <button className="text-button" onClick={() => void load()}>
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>
      <div className="operator-list">
        {data?.customers.map(({ profile, agent }: any) => (
          <div className="operator-row" key={profile.id}>
            <Companion
              avatar={profile.avatar}
              color={profile.color}
              size={54}
            />
            <div>
              <h3>{profile.agentName || "Setting up"}</h3>
              <p>{profile.email}</p>
              <span
                className={`status-tag ${agent?.status === "ready" ? "completed" : "needs_you"}`}
              >
                {agent?.suspensionOperation?.phase === "pending"
                  ? agent.suspensionOperation.suspended
                    ? "Pausing"
                    : "Resuming"
                  : agent?.suspended
                    ? "Paused"
                    : agent?.status || "Awaiting onboarding"}
              </span>
              {agent?.error && <p className="error-inline">{agent.error}</p>}
            </div>
            <label className="budget-input">
              Monthly managed cap · USD
              <input
                aria-label={`Budget for ${profile.agentName}`}
                type="number"
                min="0"
                max="100"
                step="1"
                defaultValue={agent ? agent.budgetMicros / 1e6 : 5}
                onBlur={async (event) => {
                  if (!agent?.instanceId) return;
                  try {
                    await api(`/operator/${profile.id}/budget`, "PUT", {
                      micros: Math.round(Number(event.target.value) * 1e6),
                    });
                    feedback.onSuccess("Managed-service cap updated.");
                  } catch (error) {
                    feedback.onError(errorText(error));
                  }
                }}
              />
            </label>
            <div className="inline-actions">
              <button
                className="button button-secondary"
                disabled={
                  !agent?.instanceId ||
                  agent.status !== "ready" ||
                  agent.suspensionOperation?.phase === "pending"
                }
                onClick={async () => {
                  try {
                    await api(`/operator/${profile.id}/suspension`, "PUT", {
                      suspended: !agent.suspended,
                    });
                    feedback.onSuccess(
                      agent.suspended
                        ? "Companion resumed."
                        : "Companion paused.",
                    );
                  } catch (error) {
                    feedback.onError(errorText(error));
                  } finally {
                    void load();
                  }
                }}
              >
                {agent?.suspended ? "Resume" : "Suspend"}
              </button>
              <button
                className="button button-secondary"
                disabled={!agent?.instanceId}
                onClick={async () => {
                  try {
                    setHealth(await api(`/operator/${profile.id}/health`));
                  } catch (error) {
                    feedback.onError(errorText(error));
                  }
                }}
              >
                Health & usage
              </button>
              <button
                className="icon-button"
                disabled={!agent}
                aria-label={`Retry ${profile.agentName}`}
                onClick={async () => {
                  try {
                    await api(`/operator/${profile.id}/retry`, "POST");
                    feedback.onSuccess("Recovery queued.");
                    void load();
                  } catch (error) {
                    feedback.onError(errorText(error));
                  }
                }}
              >
                <RefreshCw size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="section-heading">
        <h2>Invitations</h2>
      </div>
      <div className="routine-list">
        {data?.invitations.map((row: any, index: number) => (
          <div className="run-row" key={row.id || index}>
            <span>{row.email}</span>
            <span>{row.used_by || row.usedBy ? "Accepted" : "Available"}</span>
            <small>
              Expires{" "}
              {new Date(row.expires_at || row.expiresAt).toLocaleDateString()}
            </small>
          </div>
        ))}
      </div>
      {health && (
        <Modal
          title="Computer health & managed usage"
          onClose={() => setHealth(null)}
        >
          <div className="health-summary">
            <p>
              <span>Computer</span>
              <strong>{health.instance.status}</strong>
            </p>
            <p>
              <span>Billing suspension</span>
              <strong>
                {health.instance.past_due
                  ? "Suspended — top up Agent37 wallet"
                  : "No suspension reported"}
              </strong>
            </p>
            <p>
              <span>Managed spend reported</span>
              <strong>
                ${((health.usage.total_micros || 0) / 1e6).toFixed(2)}
              </strong>
            </p>
          </div>
          <p className="fine-print">
            The managed cap is separate from compute costs and Inkbox charges.
          </p>
        </Modal>
      )}
    </>
  );
}
