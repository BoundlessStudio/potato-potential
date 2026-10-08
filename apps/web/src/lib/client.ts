import { createBrowserClient } from "@supabase/ssr";
import {
  isAuthApiError,
  isAuthSessionMissingError,
} from "@supabase/supabase-js";
import { parseSse, type StreamEvent } from "@boundless/shared";
import {
  downloadDestination,
  DOWNLOAD_RETURN_KEY,
} from "./download-destination";
export const demo = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
const base =
  process.env.NEXT_PUBLIC_CONTROL_URL || (demo ? "http://localhost:4000" : "");
let client: ReturnType<typeof createBrowserClient> | null = null;
let refreshing: Promise<string> | null = null;
function sessionFailure(error: unknown) {
  if (
    isAuthSessionMissingError(error) ||
    (isAuthApiError(error) &&
      [
        "refresh_token_not_found",
        "refresh_token_already_used",
        "session_not_found",
        "user_not_found",
      ].includes(error.code || ""))
  )
    return new ApiError(
      "session_expired",
      "Your session has ended. Please sign in again.",
      401,
    );
  return error;
}
export function supabase() {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key)
      throw new Error(
        "Sign-in is not configured yet. Add the public Supabase settings.",
      );
    client = createBrowserClient(url, key);
  }
  return client;
}
export async function credential() {
  if (demo) {
    const value = localStorage.getItem("boundless-demo-user");
    return value === "signed-out" ? "" : value || "demo";
  }
  const { data, error } = await supabase().auth.getSession();
  if (error) throw sessionFailure(error);
  return data.session?.access_token || "";
}
async function refreshCredential(previous: string) {
  const current = await credential();
  if (current !== previous) return current;
  refreshing ??= (async () => {
    const { data, error } = await supabase().auth.refreshSession();
    if (error) throw sessionFailure(error);
    return data.session?.access_token || "";
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}
export async function joinBeta(email: string, website = "") {
  const response = await fetch(`${base}/api/beta`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, website }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      body.error?.message ||
        "Couldn’t save your beta request. Please try again.",
    );
  }
}
export async function sendSignInLink(email: string, next?: string) {
  const destination = downloadDestination(next);
  if (destination !== "/")
    localStorage.setItem(DOWNLOAD_RETURN_KEY, destination);
  else localStorage.removeItem(DOWNLOAD_RETURN_KEY);
  const canonicalEmail = email.trim().toLowerCase();
  const approval = await fetch(`${base}/api/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: canonicalEmail }),
    cache: "no-store",
  });
  const body = await approval.json().catch(() => ({}));
  if (!approval.ok) {
    throw new ApiError(
      body.error?.code || "signin_unavailable",
      body.error?.message ||
        "Couldn’t check your beta access. Please try again.",
      approval.status,
    );
  }
  if (body.ready !== true)
    throw new Error("Couldn’t check your beta access. Please try again.");
  if (demo || body.emailSent === true) return;
  const { error } = await supabase().auth.signInWithOtp({
    email: canonicalEmail,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${window.location.origin}/auth/callback`,
    },
  });
  if (error) throw error;
}
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function request(path: string, init: RequestInit = {}) {
  const auth = await credential();
  const send = (token: string) =>
    fetch(`${base}/api${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      cache: "no-store",
    });
  let response = await send(auth);
  if (response.status === 401 && !demo && auth && !init.signal?.aborted) {
    const token = await refreshCredential(auth);
    if (token) response = await send(token);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      body.error?.code || "request_failed",
      body.error?.message || "This request was interrupted. Try again.",
      response.status,
    );
  }
  return response;
}
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  return (
    await request(path, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  ).json();
}
export async function stream(
  path: string,
  input: unknown,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
) {
  let responseId: string | null = null;
  for (let segment = 0; segment < 240; segment++) {
    const response = await request(
      segment ? `/responses/${responseId}/stream` : path,
      {
        method: segment || input === undefined ? "GET" : "POST",
        ...(!segment && input !== undefined
          ? { body: JSON.stringify(input) }
          : {}),
        signal,
      },
    );
    if (!response.body) throw new Error("Your agent returned an empty stream.");
    let terminal = false;
    let rotated = false;
    for await (const event of parseSse(response.body)) {
      if (event.event === "response.created")
        responseId = String(event.data.id);
      if (event.event === "connection.rotate") {
        rotated = true;
        continue;
      }
      if (["response.completed", "response.failed"].includes(event.event))
        terminal = true;
      onEvent(event);
    }
    if (terminal) return;
    if (rotated && responseId && !signal?.aborted) continue;
    if (!terminal)
      throw new Error(
        "Connection interrupted. Reconnect to recover your response.",
      );
  }
  throw new Error(
    "Your agent is still working. Reconnect to continue watching.",
  );
}
export async function signOut(scope: "global" | "local" = "global") {
  if (demo) localStorage.setItem("boundless-demo-user", "signed-out");
  else await supabase().auth.signOut({ scope });
  localStorage.removeItem("boundless-invite");
  window.location.assign("/");
}
