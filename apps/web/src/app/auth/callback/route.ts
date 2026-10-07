import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { downloadDestination } from "@/lib/download-destination";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = downloadDestination(url.searchParams.get("next"));
  if (
    code &&
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
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  return NextResponse.redirect(
    new URL(
      `/signin?${new URLSearchParams({ auth_error: "1", ...(next !== "/" ? { next } : {}) })}`,
      request.url,
    ),
  );
}
