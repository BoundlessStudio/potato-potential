import assert from "node:assert/strict";

const url = new URL(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
);
assert.ok(
  url.hostname.endsWith(".supabase.co"),
  "Expected a hosted Supabase project URL.",
);
const ref = url.hostname.split(".")[0];
assert.ok(
  process.env.SUPABASE_ACCESS_TOKEN,
  "SUPABASE_ACCESS_TOKEN with Auth configuration access is required.",
);
assert.ok(
  !process.argv[2] || process.argv[2] === "apply",
  "Use no argument to inspect, or apply to disable public signup.",
);

async function config(init = {}) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/config/auth`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok)
    throw new Error(`Auth configuration request failed (${response.status}).`);
  return response.json();
}

try {
  if (process.argv[2] === "apply") {
    await config({
      method: "PATCH",
      body: JSON.stringify({ disable_signup: true }),
    });
  }
  const result = await config();
  if (process.argv[2] === "apply") assert.equal(result.disable_signup, true);
  console.log(`Public Auth signup disabled: ${result.disable_signup === true}.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
