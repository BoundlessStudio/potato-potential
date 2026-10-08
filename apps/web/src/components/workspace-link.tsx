"use client";

import type { ReactNode } from "react";
import type { WorkspacePage } from "@/lib/workspace-routes";

export function WorkspaceLink({
  page,
  active,
  label,
  onNavigate,
  children,
}: {
  page: WorkspacePage;
  active: boolean;
  label?: string;
  onNavigate: (page: WorkspacePage) => void;
  children: ReactNode;
}) {
  return (
    <a
      href={`/${page}`}
      aria-label={label}
      className={`nav-item ${active ? "active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        onNavigate(page);
      }}
    >
      {children}
    </a>
  );
}
