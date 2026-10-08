"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowUp,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  File as FileIcon,
  Folder,
  FolderPlus,
  Grid2X2,
  Home,
  List,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  fileDownloadUrl,
  type BrowserEntry,
  type FileListing,
} from "@boundless/shared";
import { api, ApiError, request } from "@/lib/client";
import { useChatUploads } from "./chat-uploads";
import { FileDownloadLink } from "./file-download-link";
import { Modal } from "./modal";
import styles from "./computer-files.module.css";

const roots = [
  { path: "/home/node/outputs", label: "Outputs", icon: Folder },
  { path: "/home/node/uploads", label: "Uploads", icon: Upload },
  { path: "/home/node", label: "Home", icon: Home },
];
const formatSize = (size: number | null) =>
  size === null
    ? "—"
    : size < 1024
      ? `${size} B`
      : size < 1024 ** 2
        ? `${(size / 1024).toFixed(1)} KB`
        : `${(size / 1024 ** 2).toFixed(1)} MB`;
const formatDate = (value: number) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "This request was interrupted. Try again.";
type Action =
  { kind: "create" } | { kind: "rename" | "delete"; entry: BrowserEntry };

export function ComputerFiles({
  owner,
  instance,
  available,
}: {
  owner: string;
  instance: string;
  available: boolean;
}) {
  const [path, setPath] = useState("/home/node/outputs");
  const [listing, setListing] = useState<FileListing>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [view, setView] = useState<"list" | "grid">("list");
  const [selected, setSelected] = useState<string>();
  const [preview, setPreview] = useState<BrowserEntry>();
  const [action, setAction] = useState<Action>();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null),
    resume = useRef<string | undefined>(undefined);
  const uploads = useChatUploads(owner, instance, available, setError, "files");
  const completed = useRef(new Set<string>());
  useEffect(() => {
    const ids = uploads.items
      .filter(
        (item) =>
          item.status === "completed" && !completed.current.has(item.id),
      )
      .map((item) => item.id);
    if (ids.length) {
      ids.forEach((id) => completed.current.add(id));
      setAttempt((value) => value + 1);
    }
  }, [uploads.items]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setMissing(false);
    setListing(undefined);
    setSelected(undefined);
    if (!available) {
      setLoading(false);
      return;
    }
    void request(`/files/list?${new URLSearchParams({ instance, path })}`, {
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((result: FileListing) => {
        if (!controller.signal.aborted) setListing(result);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        if (
          cause instanceof ApiError &&
          cause.status === 404 &&
          ["directory_not_found", "not_found", "file_not_found"].includes(
            cause.code,
          ) &&
          roots.slice(0, 2).some((root) => root.path === path)
        )
          setMissing(true);
        else setError(message(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, instance, attempt, available]);
  const entries = (listing?.entries || []).filter(
    (entry) => hidden || !entry.hidden,
  );
  const selectedEntry = entries.find((entry) => entry.path === selected);
  const parent =
    listing?.parentPath ||
    (path !== "/home/node" && path !== "/home/linuxbrew"
      ? path.slice(0, path.lastIndexOf("/"))
      : null);
  const crumbs = path
    .split("/")
    .filter(Boolean)
    .map((label, index, parts) => ({
      label: index === 1 && parts[0] === "home" ? "Home" : label,
      path: "/" + parts.slice(0, index + 1).join("/"),
    }))
    .filter(
      (crumb) =>
        crumb.path.startsWith("/home/node") ||
        crumb.path.startsWith("/home/linuxbrew"),
    );
  const uploadBusy = uploads.items.some((item) => item.status === "uploading");
  function navigate(next: string) {
    setPath(next);
    setPreview(undefined);
    setSelected(undefined);
  }
  function open(entry: BrowserEntry) {
    if (entry.type === "directory") navigate(entry.path);
    else if (entry.type === "file") setPreview(entry);
  }
  function chooseAction(next: Action) {
    setAction(next);
    setName(next.kind === "rename" ? next.entry.name : "");
    setActionError("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!action || saving) return;
    setSaving(true);
    setActionError("");
    try {
      await api("/files/entries", "POST", {
        instance,
        action: action.kind,
        path: action.kind === "create" ? path : action.entry.path,
        ...(action.kind !== "delete" ? { name } : {}),
        ...(action.kind !== "create"
          ? { modified: action.entry.modified }
          : {}),
      });
      setAction(undefined);
      setAttempt((value) => value + 1);
    } catch (cause) {
      setActionError(message(cause));
    } finally {
      setSaving(false);
    }
  }
  function add(files: File[]) {
    uploads.add(files, path);
  }
  function DownloadAction({ entry }: { entry: BrowserEntry }) {
    return (
      <FileDownloadLink
        className="button button-secondary"
        href={
          fileDownloadUrl(instance, entry.path) +
          (entry.type === "directory" ? "&archive=1" : "")
        }
        aria-label={`Download ${entry.name}${entry.type === "directory" ? " as archive" : ""}`}
      >
        <Download size={15} />
        Download{entry.type === "directory" ? " folder" : ""}
      </FileDownloadLink>
    );
  }

  return (
    <section
      className={styles.explorer}
      aria-label="Computer files"
      onDragOver={(event) => {
        if (available && event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (available) add(Array.from(event.dataTransfer.files));
      }}
    >
      {dragging && (
        <div className={styles.dropOverlay}>
          Drop files to upload to this folder
        </div>
      )}
      <header className={styles.heading}>
        <div>
          <h2>Your companion’s files</h2>
          <p>Find saved work, add files, and take a copy with you.</p>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className="button button-secondary"
            disabled={!available || saving}
            onClick={() => chooseAction({ kind: "create" })}
          >
            <FolderPlus size={15} />
            New folder
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={!available || saving}
            onClick={() => {
              resume.current = undefined;
              picker.current?.click();
            }}
          >
            <Upload size={15} />
            Upload files
          </button>
        </div>
      </header>
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        aria-label="Choose files for this folder"
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          if (resume.current && files[0]) {
            uploads.retry(resume.current, files[0]);
            resume.current = undefined;
          } else add(files);
          event.target.value = "";
        }}
      />
      <div className={styles.shortcuts} aria-label="File locations">
        {roots.map(({ path: root, label, icon: Icon }) => (
          <button
            type="button"
            key={root}
            aria-pressed={path === root}
            onClick={() => navigate(root)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>
      <div className={styles.toolbar}>
        <button
          type="button"
          className="icon-button"
          aria-label="Up one folder"
          title="Up one folder"
          disabled={!parent || loading}
          onClick={() => parent && navigate(parent)}
        >
          <ArrowUp size={17} />
        </button>
        <nav className={styles.breadcrumbs} aria-label="Folder path">
          {crumbs.map((crumb, index) => (
            <span key={crumb.path}>
              {index > 0 && <ChevronRight size={13} />}
              <button
                type="button"
                aria-current={crumb.path === path ? "page" : undefined}
                onClick={() => navigate(crumb.path)}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </nav>
        <div className={styles.viewActions} role="group" aria-label="File view">
          <button
            type="button"
            className="icon-button"
            aria-label="List view"
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            <List size={17} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Grid view"
            aria-pressed={view === "grid"}
            onClick={() => setView("grid")}
          >
            <Grid2X2 size={17} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={hidden ? "Hide hidden files" : "Show hidden files"}
            title={hidden ? "Hide hidden files" : "Show hidden files"}
            onClick={() => setHidden((value) => !value)}
          >
            {hidden ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Refresh files"
            title="Refresh files"
            disabled={loading}
            onClick={() => setAttempt((value) => value + 1)}
          >
            <RefreshCw size={17} className={loading ? "spin" : ""} />
          </button>
        </div>
      </div>
      <div className={styles.selection}>
        {selectedEntry ? (
          <>
            <span>{selectedEntry.name}</span>
            {["file", "directory"].includes(selectedEntry.type) && (
              <button
                type="button"
                className="text-button"
                onClick={() => open(selectedEntry)}
              >
                <Eye size={14} />
                {selectedEntry.type === "directory" ? "Open folder" : "Preview"}
              </button>
            )}
            {["file", "directory"].includes(selectedEntry.type) && (
              <DownloadAction entry={selectedEntry} />
            )}
            <button
              type="button"
              className="text-button"
              disabled={
                !available ||
                saving ||
                uploadBusy ||
                !["file", "directory"].includes(selectedEntry.type)
              }
              onClick={() =>
                chooseAction({ kind: "rename", entry: selectedEntry })
              }
            >
              <Pencil size={14} />
              Rename
            </button>
            <button
              type="button"
              className="text-button"
              disabled={
                !available ||
                saving ||
                uploadBusy ||
                !["file", "directory"].includes(selectedEntry.type)
              }
              onClick={() =>
                chooseAction({ kind: "delete", entry: selectedEntry })
              }
            >
              <Trash2 size={14} />
              Delete
            </button>
          </>
        ) : (
          <span>Select a file or folder to see its actions.</span>
        )}
      </div>
      {uploads.items.length > 0 && (
        <ul className={styles.uploads} aria-label="File transfers">
          {uploads.items.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <small>
                  {item.status === "completed"
                    ? "Saved to " + item.directory
                    : item.error || `Uploading ${item.progress}%`}
                </small>
                {item.status === "uploading" && (
                  <progress
                    max={100}
                    value={item.progress}
                    aria-label={`Uploading ${item.name}`}
                  />
                )}
              </div>
              {["failed", "needs_file"].includes(item.status) && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Retry ${item.name}`}
                  disabled={!available}
                  onClick={() => {
                    if (!uploads.retry(item.id)) {
                      resume.current = item.id;
                      picker.current?.click();
                    }
                  }}
                >
                  <RefreshCw size={15} />
                </button>
              )}
              <button
                type="button"
                className="icon-button"
                aria-label={`${item.status === "uploading" ? "Cancel" : "Dismiss"} ${item.name}`}
                onClick={() => uploads.remove(item.id)}
              >
                <X size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!available ? (
        <p className={styles.empty}>
          Files are available when your companion’s computer is ready.
        </p>
      ) : loading ? (
        <p role="status" className={styles.empty}>
          <Loader2 size={20} className="spin" />
          Loading files…
        </p>
      ) : error ? (
        <div role="alert" className={styles.empty}>
          <p>{error}</p>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      ) : entries.length === 0 ? (
        <div className={styles.empty}>
          <Folder size={32} />
          <h3>
            {missing ? "A space for saved files" : "This folder is empty"}
          </h3>
          <p>
            {missing
              ? "Upload a file or create a folder to get started here."
              : "Add files here, or ask your companion to save their work in Outputs."}
          </p>
        </div>
      ) : view === "list" ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Size</th>
              <th>Last modified</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={entry.path}
                aria-selected={selected === entry.path}
                tabIndex={0}
                onClick={() => setSelected(entry.path)}
                onDoubleClick={() => open(entry)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    open(entry);
                  }
                  if (event.key === " ") {
                    event.preventDefault();
                    setSelected(entry.path);
                  }
                }}
              >
                <td>
                  <button
                    type="button"
                    className={styles.fileName}
                    disabled={!["file", "directory"].includes(entry.type)}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelected(entry.path);
                    }}
                  >
                    {entry.type === "directory" ? (
                      <Folder size={19} />
                    ) : (
                      <FileIcon size={19} />
                    )}
                    <span>{entry.name}</span>
                  </button>
                </td>
                <td>{formatSize(entry.size)}</td>
                <td>{formatDate(entry.modified)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className={styles.grid}>
          {entries.map((entry) => (
            <div
              key={entry.path}
              className={styles.tile}
              aria-selected={selected === entry.path}
              tabIndex={0}
              onClick={() => setSelected(entry.path)}
              onDoubleClick={() => open(entry)}
              onKeyDown={(event) => {
                if (event.key === "Enter") open(entry);
                if (event.key === " ") {
                  event.preventDefault();
                  setSelected(entry.path);
                }
              }}
            >
              <button
                type="button"
                className={styles.fileName}
                disabled={!["file", "directory"].includes(entry.type)}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelected(entry.path);
                }}
              >
                {entry.type === "directory" ? (
                  <Folder size={28} />
                ) : (
                  <FileIcon size={28} />
                )}
                <span>{entry.name}</span>
              </button>
              <small>
                {entry.type === "directory" ? "Folder" : formatSize(entry.size)}{" "}
                · {formatDate(entry.modified)}
              </small>
            </div>
          ))}
        </div>
      )}
      {entries.length > 0 && (
        <p className={styles.note}>
          Select an item for actions. Double-click or press Enter to open it.
        </p>
      )}
      {listing?.truncated && (
        <p className={styles.note}>
          Showing the first 1,000 items. Open a subfolder to see more.
        </p>
      )}
      {!hidden && listing?.entries.some((entry) => entry.hidden) && (
        <p className={styles.note}>Hidden files aren’t shown.</p>
      )}
      {action && (
        <Modal
          title={
            action.kind === "create"
              ? "New folder"
              : action.kind === "rename"
                ? "Rename item"
                : "Delete this item?"
          }
          onClose={() => {
            if (!saving) setAction(undefined);
          }}
        >
          <form onSubmit={submit} className={styles.form}>
            {action.kind === "delete" ? (
              <p>
                “{action.entry.name}” will be permanently deleted
                {action.entry.type === "directory"
                  ? ", along with everything inside it"
                  : ""}
                .
              </p>
            ) : (
              <label>
                {action.kind === "create" ? "Folder name" : "New name"}
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={240}
                />
              </label>
            )}
            {actionError && (
              <p className="error-inline" role="alert">
                {actionError}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button button-secondary"
                disabled={saving}
                onClick={() => setAction(undefined)}
              >
                Cancel
              </button>
              <button
                className={`button ${action.kind === "delete" ? "button-danger" : "button-primary"}`}
                disabled={saving || !available}
              >
                {saving
                  ? "Saving…"
                  : action.kind === "delete"
                    ? "Delete"
                    : action.kind === "create"
                      ? "Create folder"
                      : "Save name"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {preview && (
        <ComputerFilePreview
          instance={instance}
          entry={preview}
          onClose={() => setPreview(undefined)}
        />
      )}
    </section>
  );
}

function ComputerFilePreview({
  instance,
  entry,
  onClose,
}: {
  instance: string;
  entry: BrowserEntry;
  onClose: () => void;
}) {
  const extension = entry.name.split(".").pop()?.toLowerCase() || "";
  const kind = ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(extension)
    ? "image"
    : ["html", "htm", "svg", "pdf"].includes(extension)
      ? "frame"
      : [
            "txt",
            "md",
            "json",
            "csv",
            "tsv",
            "log",
            "yaml",
            "yml",
            "js",
            "ts",
            "tsx",
            "jsx",
            "py",
            "css",
            "xml",
            "sh",
            "toml",
            "ini",
          ].includes(extension)
        ? "text"
        : "none";
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(kind !== "none");
  useEffect(() => {
    if (kind === "none") return;
    const controller = new AbortController();
    let objectUrl = "";
    setLoading(true);
    setError("");
    setUrl("");
    setText("");
    void request(
      `/files/preview?${new URLSearchParams({ instance, path: entry.path })}`,
      { signal: controller.signal },
    )
      .then((response) => response.blob())
      .then(async (blob) => {
        if (controller.signal.aborted) return;
        if (kind === "text") {
          const content = await blob.text();
          if (!controller.signal.aborted)
            setText(
              content.length > 500_000
                ? content.slice(0, 500_000) + "\n… (truncated)"
                : content,
            );
        } else {
          objectUrl = URL.createObjectURL(
            new Blob([blob], {
              type:
                kind === "image"
                  ? `image/${extension === "jpg" ? "jpeg" : extension}`
                  : extension === "pdf"
                    ? "application/pdf"
                    : extension === "svg"
                      ? "image/svg+xml"
                      : "text/html",
            }),
          );
          setUrl(objectUrl);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [instance, entry.path, kind, extension]);
  return (
    <Modal title={entry.name} onClose={onClose} className={styles.preview}>
      <p>{formatSize(entry.size)}</p>
      {loading ? (
        <p role="status">Loading preview…</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : kind === "image" ? (
        <img className={styles.image} src={url} alt={entry.name} />
      ) : kind === "frame" ? (
        <iframe
          className={styles.frame}
          src={url}
          sandbox=""
          referrerPolicy="no-referrer"
          title={`Preview ${entry.name}`}
        />
      ) : kind === "text" ? (
        <pre className={styles.text}>{text}</pre>
      ) : (
        <p>
          No preview is available for this file type. Download it to open it.
        </p>
      )}
      <div className="modal-actions">
        <FileDownloadLink
          className="button button-secondary"
          href={fileDownloadUrl(instance, entry.path)}
        >
          <Download size={15} />
          Download
        </FileDownloadLink>
      </div>
    </Modal>
  );
}
