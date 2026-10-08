import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { downloadDestination } from "../../../lib/download-destination";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const adminInvite = tokenHash && url.searchParams.get("type") === "invite";
  const next = downloadDestination(url.searchParams.get("next"));
  if (
    (code || adminInvite) &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    const jar = await cookies();
    const client = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll: () => jar.getAll(),
          setAll: (values) => {
            for (const value of values)
              jar.set(value.name, value.value, value.options);
          },
        },
      },
    );
    const { error } = code
      ? await client.auth.exchangeCodeForSession(code)
      : await client.auth.verifyOtp({ token_hash: tokenHash!, type: "invite" });
    if (!error) {
      const response = NextResponse.redirect(new URL(next, request.url));
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("Referrer-Policy", "no-referrer");
      return response;
    }
  }
  return NextResponse.redirect(
    new URL(
      `/signin?${new URLSearchParams({ auth_error: "1", ...(next !== "/" ? { next } : {}) })}`,
      request.url,
    ),
  );
}
