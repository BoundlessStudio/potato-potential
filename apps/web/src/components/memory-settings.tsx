"use client";

import { useCallback, useEffect, useState } from "react";
import { BookOpen, Check, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { api, request } from "@/lib/client";

const memoryFiles = [
  {
    file: "user",
    title: "About you",
    filename: "USER.md",
    description:
      "The things your companion remembers about you, your preferences, and your life.",
    icon: BookOpen,
  },
  {
    file: "memory",
    title: "Agent notes",
    filename: "MEMORY.md",
    description:
      "Ongoing work, useful discoveries, and context carried between conversations.",
    icon: Sparkles,
  },
] as const;

type NativeMemory = { content: string; modified: number };

function MemoryEditor({
  file,
  title,
  filename,
  description,
  icon: Icon,
  onSuccess,
}: (typeof memoryFiles)[number] & { onSuccess: (message: string) => void }) {
  const [memory, setMemory] = useState<NativeMemory | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = memory !== null && content !== memory.content;
  const busy = loading || saving;
  const editorId = `memory-${file}`;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const response = await request(`/memory/${file}`, { signal });
        const next: NativeMemory = await response.json();
        if (signal?.aborted) return;
        setMemory(next);
        setContent(next.content);
      } catch (cause) {
        if (!signal?.aborted)
          setError(
            cause instanceof Error ? cause.message : "Couldn’t load this file.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [file],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function save() {
    if (!memory || busy || !dirty) return;
    setSaving(true);
    setError("");
    let saved = false;
    try {
      await api(`/memory/${file}`, "PUT", {
        content,
        modified: memory.modified,
      });
      saved = true;
      const next = await api<NativeMemory>(`/memory/${file}`);
      setMemory(next);
      setContent(next.content);
      onSuccess(`${title} saved.`);
    } catch (cause) {
      if (saved) {
        setMemory(null);
        setError(
          "Saved, but couldn’t reload the latest version. Reload before editing again.",
        );
      } else {
        setError(
          cause instanceof Error ? cause.message : "Couldn’t save this file.",
        );
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="memory-editor" aria-labelledby={`${editorId}-title`}>
      <div className="memory-editor-heading">
        <h3 id={`${editorId}-title`}>
          <Icon size={18} />
          {title}
        </h3>
        <span className="memory-filename">{filename}</span>
      </div>
      <p id={`${editorId}-description`} className="memory-description">
        {description}
      </p>
      <textarea
        id={editorId}
        aria-labelledby={`${editorId}-title`}
        aria-describedby={`${editorId}-description`}
        aria-busy={busy}
        className="memory-content"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        disabled={busy || !memory}
        placeholder={
          loading
            ? `Loading ${title.toLowerCase()}…`
            : !memory
              ? "Reload to open this file."
              : "There’s room to add something here."
        }
        maxLength={60000}
        spellCheck={false}
      />
      {error && (
        <p className="error-inline memory-error" role="alert">
          {error}
        </p>
      )}
      <div className="memory-editor-footer">
        <span className="memory-editor-status" role="status">
          {loading
            ? "Loading…"
            : saving
              ? "Saving…"
              : dirty
                ? "Unsaved changes"
                : memory
                  ? "No unsaved changes"
                  : "File unavailable"}
        </span>
        <div className="memory-editor-actions">
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => void load()}
          >
            <RefreshCw size={15} />
            {dirty ? "Discard edits & reload" : "Reload latest"}
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={busy || !dirty}
            onClick={() => void save()}
          >
            {saving ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <Check size={15} />
            )}
            Save {title}
          </button>
        </div>
      </div>
    </article>
  );
}

export function MemorySettings({
  onSuccess,
}: {
  onSuccess: (message: string) => void;
}) {
  return (
    <section
      className="settings-card memory-settings"
      aria-labelledby="memory-settings-title"
    >
      <span className="eyebrow">A little room to remember</span>
      <h2 id="memory-settings-title">What they know.</h2>
      <p className="muted">
        Read and edit what your companion knows about you and remembers. Each
        file saves separately.
      </p>
      <div className="memory-editors">
        {memoryFiles.map((file) => (
          <MemoryEditor key={file.file} {...file} onSuccess={onSuccess} />
        ))}
      </div>
      <p className="fine-print">
        If your companion updates a file while you’re editing, saving pauses so
        you can reload the latest version.
      </p>
    </section>
  );
}
