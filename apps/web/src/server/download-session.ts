import { createServerClient, serializeCookieHeader } from "@supabase/ssr";
import type { NextApiRequest, NextApiResponse } from "next";
import { downloadDestination } from "../lib/download-destination";

export async function downloadSession(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (
    req.method !== "GET" ||
    new URL(req.url || "/", "https://boundless.invalid").pathname !==
      "/api/files/content" ||
    req.headers.authorization
  )
    return true;
  res.setHeader("Cache-Control", "private, no-store");
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () =>
          Object.entries(req.cookies).map(([name, value]) => ({
            name,
            value: value || "",
          })),
        setAll: (values) => {
          res.setHeader(
            "Set-Cookie",
            values.map(({ name, value, options }) =>
              serializeCookieHeader(name, value, options),
            ),
          );
        },
      },
    },
  );
  const { data, error } = await client.auth.getUser();
  if (!error && data.user?.email_confirmed_at) {
    const session = await client.auth.getSession();
    if (session.data.session?.access_token) {
      req.headers.authorization = `Bearer ${session.data.session.access_token}`;
      return true;
    }
  }
  res.redirect(
    303,
    `/signin?${new URLSearchParams({ next: downloadDestination(req.url) })}`,
  );
  return false;
}
