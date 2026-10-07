"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown,
  FileUp,
  Folder,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_CHUNK_BYTES,
  DEFAULT_UPLOAD_DIRECTORY,
  type FileUpload,
} from "@boundless/shared";
import { request, ApiError } from "@/lib/client";
import { UploadFolderPicker } from "./upload-folder-picker";

async function uploadRequest(path: string, init: RequestInit) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request(path, init);
    } catch (error) {
      if (
        init.signal?.aborted ||
        attempt >= 5 ||
        !(error instanceof ApiError) ||
        !["operation_running", "upload_busy"].includes(error.code)
      )
        throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(4000, 500 * 2 ** attempt)),
      );
    }
  }
}

type Attachment = {
  id: string;
  name: string;
  size: number;
  directory: string;
  sha256?: string;
  upload?: FileUpload;
  status: "uploading" | "completed" | "failed" | "needs_file";
  progress: number;
  error?: string;
};
export function useChatUploads(
  owner?: string,
  instance?: string,
  enabled = false,
  onError: (message: string) => void = () => {},
) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [directory, setDirectory] = useState(DEFAULT_UPLOAD_DIRECTORY);
  const entries = useRef<Attachment[]>([]),
    originals = useRef(new Map<string, File>()),
    controllers = useRef(new Map<string, AbortController>());
  const key = owner && instance ? `boundless-uploads:${owner}:${instance}` : "";
  const storageKey = useRef("");
  const transferQueue = useRef(Promise.resolve());
  const cancelled = useRef(new Set<string>()),
    dismissed = useRef(new Set<string>());
  function persistCancelled() {
    if (storageKey.current)
      localStorage.setItem(
        storageKey.current + ":cancelled",
        JSON.stringify([...cancelled.current]),
      );
  }
  async function cancel(id: string) {
    const scope = storageKey.current,
      pending = cancelled.current;
    try {
      await uploadRequest(`/files/uploads/${id}`, { method: "DELETE" });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) {
        onError(
          error instanceof Error
            ? error.message
            : "Cleanup will retry when you return to chat.",
        );
        return;
      }
    }
    pending.delete(id);
    localStorage.setItem(scope + ":cancelled", JSON.stringify([...pending]));
  }
  function update(work: (items: Attachment[]) => Attachment[]) {
    entries.current = work(entries.current);
    setItems(entries.current);
    if (storageKey.current)
      localStorage.setItem(storageKey.current, JSON.stringify(entries.current));
  }
  const patch = (id: string, values: Partial<Attachment>) =>
    update((rows) =>
      rows.map((row) => (row.id === id ? { ...row, ...values } : row)),
    );
  useEffect(() => {
    for (const controller of controllers.current.values()) controller.abort();
    controllers.current.clear();
    originals.current.clear();
    storageKey.current = key;
    setDirectory(DEFAULT_UPLOAD_DIRECTORY);
    try {
      cancelled.current = new Set(
        JSON.parse(localStorage.getItem(key + ":cancelled") || "[]"),
      );
    } catch {
      cancelled.current = new Set();
    }
    dismissed.current = new Set(cancelled.current);
    let rows: Attachment[] = [];
    try {
      rows = JSON.parse(localStorage.getItem(key) || "[]");
      if (!Array.isArray(rows)) rows = [];
    } catch {
      /* A damaged local draft must not prevent chat. */
    }
    rows = rows
      .filter((row) => row.id && row.name)
      .map((row) =>
        row.status === "completed"
          ? row
          : {
              ...row,
              status: "needs_file",
              error: "Reselect the original file to resume.",
            },
      );
    entries.current = rows;
    setItems(rows);
    return () => {
      for (const controller of controllers.current.values()) controller.abort();
    };
  }, [key]);
  useEffect(() => {
    if (!enabled || !key) return;
    for (const id of cancelled.current) void cancel(id);
    let mounted = true;
    void uploadRequest("/files/uploads", { method: "GET" })
      .then((response) => response.json() as Promise<{ uploads: FileUpload[] }>)
      .then(({ uploads }) => {
        if (!mounted) return;
        update((rows) => [
          ...rows,
          ...uploads
            .filter(
              (upload) =>
                !dismissed.current.has(upload.id) &&
                !rows.some((row) => row.id === upload.id),
            )
            .map((upload) => ({
              id: upload.id,
              name: upload.name,
              size: upload.size,
              directory: upload.directory,
              sha256: upload.sha256,
              upload,
              status: "needs_file" as const,
              progress: Math.floor(
                (Object.keys(upload.chunks).length /
                  Math.max(1, Math.ceil(upload.size / UPLOAD_CHUNK_BYTES))) *
                  100,
              ),
              error: "Reselect the original file to resume.",
            })),
        ]);
      })
      .catch((error) => onError(error.message));
    return () => {
      mounted = false;
    };
  }, [enabled, key]);
  async function transfer(id: string, file: File) {
    if (controllers.current.has(id)) return;
    const row = entries.current.find((item) => item.id === id);
    if (!row) return;
    const controller = new AbortController();
    controllers.current.set(id, controller);
    originals.current.set(id, file);
    patch(id, { status: "uploading", error: undefined });
    const previous = transferQueue.current;
    let release!: () => void;
    transferQueue.current = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      if (controller.signal.aborted) return;
      if (file.size > MAX_UPLOAD_BYTES)
        throw new Error("Files can be up to 100 MB each.");
      const checksum = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
        ),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      if (controller.signal.aborted) return;
      if (
        file.name !== row.name ||
        file.size !== row.size ||
        (row.sha256 && row.sha256 !== checksum)
      )
        throw new Error(
          "Select the same original file; its name, size, and checksum must match.",
        );
      patch(id, { sha256: checksum });
      let { upload } = (await (
        await uploadRequest("/files/uploads", {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({
            id,
            name: file.name,
            size: file.size,
            directory: row.directory,
            sha256: checksum,
          }),
        })
      ).json()) as { upload: FileUpload };
      patch(id, { upload });
      if (upload.state !== "completed") {
        const count = Math.ceil(file.size / UPLOAD_CHUNK_BYTES);
        for (let index = 0; index < count; index++) {
          if (!upload.chunks[index]) {
            const response = await uploadRequest(
              `/files/uploads/${id}/chunks/${index}`,
              {
                method: "PUT",
                signal: controller.signal,
                headers: { "Content-Type": "application/octet-stream" },
                body: file.slice(
                  index * UPLOAD_CHUNK_BYTES,
                  Math.min(file.size, (index + 1) * UPLOAD_CHUNK_BYTES),
                ),
              },
            );
            upload = (await response.json()).upload;
          }
          patch(id, {
            upload,
            progress: Math.round(((index + 1) / count) * 99),
          });
        }
        upload = (
          await (
            await uploadRequest(`/files/uploads/${id}/complete`, {
              method: "POST",
              signal: controller.signal,
              body: "{}",
            })
          ).json()
        ).upload;
      }
      if (!upload.file?.path)
        throw new Error(
          "The computer returned no saved file path. Retry completion.",
        );
      patch(id, { upload, progress: 100, status: "completed" });
    } catch (error) {
      if (!controller.signal.aborted)
        patch(id, {
          status: "failed",
          error:
            error instanceof Error
              ? error.message
              : "Upload interrupted. Retry to continue.",
        });
    } finally {
      release();
      if (controllers.current.get(id) === controller)
        controllers.current.delete(id);
    }
  }
  function add(files: File[]) {
    if (!enabled) return;
    for (const file of files) {
      if (entries.current.length >= 100) {
        onError("Attach up to 100 files to a turn.");
        break;
      }
      const id = crypto.randomUUID();
      update((rows) => [
        ...rows,
        {
          id,
          name: file.name,
          size: file.size,
          directory,
          status: "uploading",
          progress: 0,
        },
      ]);
      void transfer(id, file);
    }
  }
  function remove(id: string) {
    const row = entries.current.find((row) => row.id === id);
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
    originals.current.delete(id);
    dismissed.current.add(id);
    update((rows) => rows.filter((row) => row.id !== id));
    if (row?.sha256 && row.status !== "completed") {
      cancelled.current.add(id);
      persistCancelled();
      void cancel(id);
    }
  }
  function retry(id: string, selected?: File) {
    const file = selected || originals.current.get(id);
    if (file) void transfer(id, file);
    return !!file;
  }
  function accepted(ids: string[]) {
    update((rows) => rows.filter((row) => !ids.includes(row.id)));
    for (const id of ids) originals.current.delete(id);
  }
  return {
    items,
    directory,
    setDirectory,
    add,
    remove,
    retry,
    accepted,
    blocked: items.some((row) => row.status !== "completed"),
    files: items
      .filter((row) => row.status === "completed")
      .map((row) => row.upload!.file!),
    instance,
  };
}
export function ChatUploads({
  uploads,
  disabled,
  expanded,
  toggle,
  sendButton,
}: {
  uploads: ReturnType<typeof useChatUploads>;
  disabled: boolean;
  expanded: boolean;
  toggle: ReactNode;
  sendButton: ReactNode;
}) {
  const picker = useRef<HTMLInputElement>(null),
    resume = useRef<string | null>(null);
  const [choosingFolder, setChoosingFolder] = useState(false);
  return (
    <div className="chat-uploads">
      <input
        ref={picker}
        type="file"
        multiple={!resume.current}
        aria-label="Choose files to upload"
        className="upload-picker"
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          if (resume.current) {
            if (files[0]) uploads.retry(resume.current, files[0]);
            resume.current = null;
          } else uploads.add(files);
          event.target.value = "";
        }}
      />
      {choosingFolder && !disabled && uploads.instance && (
        <UploadFolderPicker
          key={uploads.instance}
          instance={uploads.instance}
          initialPath={uploads.directory}
          onClose={() => setChoosingFolder(false)}
          onSelect={(path) => {
            uploads.setDirectory(path);
            setChoosingFolder(false);
          }}
        />
      )}
      {uploads.items.length > 0 && (
        <ul className="attachment-list" aria-label="Pending attachments">
          {uploads.items.map((row) => (
            <li key={row.id} className="attachment-chip">
              <div className="attachment-details">
                <strong>{row.name}</strong>
                {row.status === "completed" ? (
                  <span>
                    Saved to {row.upload!.file!.path} · Attached to your next
                    message
                  </span>
                ) : (
                  <span>
                    {row.error ||
                      `Uploading ${row.progress}% to ${row.directory}`}
                  </span>
                )}
                {row.status === "uploading" && (
                  <progress
                    max={100}
                    value={row.progress}
                    aria-label={`Uploading ${row.name}`}
                  />
                )}
              </div>
              {row.status === "uploading" && (
                <Loader2 size={14} className="spin" />
              )}
              {["failed", "needs_file"].includes(row.status) && (
                <button
                  type="button"
                  className="icon-button"
                  disabled={disabled}
                  aria-label={`Retry ${row.name}`}
                  onClick={() => {
                    if (!uploads.retry(row.id)) {
                      resume.current = row.id;
                      picker.current!.multiple = false;
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
                disabled={disabled}
                aria-label={`Remove ${row.name}`}
                onClick={() => uploads.remove(row.id)}
              >
                <X size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="composer-bottom">
        <div className="composer-actions">
          {toggle}
          <div
            id="chat-upload-options"
            className="upload-controls"
            role="region"
            aria-label="File attachment options"
            hidden={!expanded}
          >
            <button
              type="button"
              className="text-button upload-button"
              aria-label="Upload file"
              title="Upload file"
              disabled={disabled}
              onClick={() => {
                resume.current = null;
                picker.current!.multiple = true;
                picker.current?.click();
              }}
            >
              <FileUp size={16} aria-hidden="true" />
              <span>Upload file</span>
            </button>
            <div className="upload-destination">
              <span className="upload-destination-label">Save to</span>
              <button
                type="button"
                aria-label="Upload destination folder"
                aria-haspopup="dialog"
                aria-expanded={choosingFolder}
                title={uploads.directory + "/"}
                disabled={disabled}
                onClick={() => setChoosingFolder(true)}
              >
                <Folder size={14} aria-hidden="true" />
                <span>{uploads.directory}/</span>
                <ChevronDown size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
        {sendButton}
      </div>
    </div>
  );
}
