import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const ref = new URL(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
).hostname.split(".")[0];
assert.equal(ref, "cbipuhnmxyrwfiuwfiou");
async function request(route, init = {}) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${ref}${route}`,
    {
      ...init,
      headers: {
        Authorization: "Bearer " + process.env.SUPABASE_ACCESS_TOKEN,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Supabase management request failed: ${route} (${response.status})`,
    );
  return response.json();
}
const name = process.argv[3] || "account_beta_cleanup";
assert.ok(["account_beta_cleanup", "account_email_ownership"].includes(name));
let history = await request("/database/migrations");
if (process.argv[2] !== "apply") {
  console.log(
    "Account beta cleanup migration recorded:",
    history.some((row) => row.name === name),
  );
  process.exit(0);
}
const files = (await fs.readdir("supabase/migrations")).filter((file) =>
  file.endsWith(`_${name}.sql`),
);
assert.equal(files.length, 1);
const original = "supabase/migrations/" + files[0];
if (!history.some((row) => row.name === name)) {
  await request("/database/migrations", {
    method: "POST",
    body: JSON.stringify({ name, query: await fs.readFile(original, "utf8") }),
  });
  history = await request("/database/migrations");
}
const matching = history.filter((row) => row.name === name);
assert.equal(matching.length, 1);
const version = matching[0].version;
assert.match(version, /^\d{14}$/);
const target = `supabase/migrations/${version}_${name}.sql`;
assert.equal(
  path.dirname(path.resolve(target)),
  path.resolve("supabase/migrations"),
);
if (original !== target) {
  await fs.rename(original, target);
  for (const file of ["tests/database.test.ts", "README.md"]) {
    const contents = await fs.readFile(file, "utf8");
    await fs.writeFile(file, contents.replaceAll(original, target));
  }
}
const check = await request("/database/query/read-only", {
  method: "POST",
  body: JSON.stringify({
    query: `select
    position('delete from public.beta_requests' in pg_get_functiondef('public.erase_account_links()'::regprocedure)) > 0 as removes_beta,
    position('provider cleanup must complete' in pg_get_functiondef('public.erase_account_links()'::regprocedure)) > 0 as guards_providers,
    exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass and tgfoid='public.erase_account_links()'::regprocedure and tgenabled='O') as auth_trigger,
    has_function_privilege('anon','public.erase_account_links()','execute') as public_execute,
    has_function_privilege('authenticated','public.erase_account_links()','execute') as customer_execute`,
  }),
});
assert.deepEqual(check, [
  {
    removes_beta: true,
    guards_providers: true,
    auth_trigger: true,
    public_execute: false,
    customer_execute: false,
  },
]);
if (name === "account_email_ownership") {
  const ownership = await request("/database/query/read-only", {
    method: "POST",
    body: JSON.stringify({
      query:
        "select position('from auth.users as other' in pg_get_functiondef('public.erase_account_links()'::regprocedure)) > 0 as protects_other_accounts, position('used_by is null' in pg_get_functiondef('public.erase_account_links()'::regprocedure)) > 0 as protects_other_invitations",
    }),
  });
  assert.deepEqual(ownership, [
    { protects_other_accounts: true, protects_other_invitations: true },
  ]);
}
const deployment = JSON.parse(
  await fs.readFile("infra/deployment.json", "utf8"),
);
if (!deployment.supabase.migrations.includes(version))
  deployment.supabase.migrations.push(version);
await fs.writeFile(
  "infra/deployment.json",
  JSON.stringify(deployment, null, 2) + "\n",
);
console.log(
  "PASS: account beta cleanup migration recorded as",
  version,
  "with the provider cleanup guard and protected Auth trigger.",
);
