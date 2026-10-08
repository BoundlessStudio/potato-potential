export const workspacePages = [
  "chat",
  "tasks",
  "wiki",
  "routines",
  "apps",
  "computer",
  "settings",
] as const;

export type WorkspacePage = (typeof workspacePages)[number];

export function workspacePage(pathname: string | null): WorkspacePage {
  return workspacePages.find((page) => pathname === `/${page}`) || "chat";
}
