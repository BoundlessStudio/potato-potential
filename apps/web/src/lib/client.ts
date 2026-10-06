import { createBrowserClient } from "@supabase/ssr";
import { parseSse, type StreamEvent } from "@boundless/shared";
export const demo = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
const base =
  process.env.NEXT_PUBLIC_CONTROL_URL || (demo ? "http://localhost:4000" : "");
let client: ReturnType<typeof createBrowserClient> | null = null;
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
  if (demo) return localStorage.getItem("boundless-demo-user") || "demo";
  const { data } = await supabase().auth.getSession();
  return data.session?.access_token || "";
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
  const response = await fetch(`${base}/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await credential()}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
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
export async function signOut() {
  if (demo) localStorage.removeItem("boundless-demo-user");
  else await supabase().auth.signOut();
  window.location.assign("/");
}
