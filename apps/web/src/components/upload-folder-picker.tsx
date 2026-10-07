"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, ChevronRight, Folder, Home, Loader2 } from "lucide-react";
import { type DirectoryListing } from "@boundless/shared";
import { request } from "@/lib/client";
import { Modal } from "./modal";

export function UploadFolderPicker({
  instance,
  initialPath,
  onSelect,
  onClose,
}: {
  instance: string;
  initialPath: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [path, setPath] = useState(initialPath);
  const [listing, setListing] = useState<DirectoryListing>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState("");
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setListing(undefined);
    setError("");
    setFilter("");
    void request(
      `/files/directories?${new URLSearchParams({ instance, path })}`,
      {
        signal: controller.signal,
      },
    )
      .then((response) => response.json() as Promise<DirectoryListing>)
      .then((value) => {
        if (!controller.signal.aborted) setListing(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "Couldn’t load folders. Try again.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [instance, path, attempt]);
  const ready = !loading && listing?.path === path;
  const root = "/home/node";
  const crumbs = [root, ...path.slice(root.length).split("/").filter(Boolean)];
  const directories =
    listing?.directories.filter(
      (folder) =>
        (hidden || !folder.hidden) &&
        folder.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
    ) || [];
  return createPortal(
    <Modal title="Choose upload folder" onClose={onClose}>
      <p>Choose where to save files on your computer.</p>
      <div className="folder-picker">
        <div className="folder-roots" aria-label="Storage folders">
          <button
            type="button"
            className="button button-secondary"
            aria-pressed={path === root}
            onClick={() => setPath(root)}
          >
            <Home size={16} /> Home
          </button>
        </div>
        <nav className="folder-breadcrumbs" aria-label="Current folder">
          {crumbs.map((name, index) => {
            const destination = crumbs.slice(0, index + 1).join("/");
            return (
              <span key={destination}>
                {index > 0 && <ChevronRight size={12} aria-hidden="true" />}
                {index === crumbs.length - 1 ? (
                  <span aria-current="location">{name}</span>
                ) : (
                  <button type="button" onClick={() => setPath(destination)}>
                    {name}
                  </button>
                )}
              </span>
            );
          })}
        </nav>
        <div className="folder-tools">
          <button
            type="button"
            className="text-button"
            disabled={!ready || !listing.parentPath}
            onClick={() => listing?.parentPath && setPath(listing.parentPath)}
          >
            <ArrowUp size={15} /> Up one folder
          </button>
          <label>
            <input
              type="checkbox"
              checked={hidden}
              onChange={(event) => setHidden(event.target.checked)}
            />{" "}
            Show hidden folders
          </label>
        </div>
        <input
          type="search"
          aria-label="Filter folders"
          placeholder="Filter folders"
          value={filter}
          disabled={!ready}
          onChange={(event) => setFilter(event.target.value)}
        />
        <div className="folder-list" aria-busy={loading}>
          {loading ? (
            <p className="folder-status" role="status">
              <Loader2 size={18} className="spin" /> Loading folders…
            </p>
          ) : error ? (
            <div className="folder-status">
              <p role="alert">{error}</p>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setAttempt((value) => value + 1)}
              >
                Retry
              </button>
            </div>
          ) : directories.length ? (
            <ul aria-label="Folders">
              {directories.map((folder) => (
                <li key={folder.path}>
                  <button
                    type="button"
                    aria-label={`Open ${folder.name}`}
                    onClick={() => setPath(folder.path)}
                  >
                    <Folder size={18} />
                    <span>{folder.name}</span>
                    <ChevronRight size={16} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="folder-status">
              {filter ? "No matching folders." : "No subfolders here."}
            </p>
          )}
        </div>
        {listing?.truncated && (
          <p className="fine-print">
            This folder has more entries than the computer can list at once.
          </p>
        )}
      </div>
      <div className="modal-actions">
        <button
          type="button"
          className="button button-secondary"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={!ready}
          onClick={() => onSelect(listing!.path)}
        >
          Use this folder
        </button>
      </div>
    </Modal>,
    document.body,
  );
}
