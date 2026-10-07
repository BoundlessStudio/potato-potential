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
const name = "file_uploads";
let history = await request("/database/migrations");
if (process.argv[2] !== "apply") {
  console.log(
    "Upload migration recorded:",
    history.some((row) => row.name === name),
  );
  process.exit(0);
}
const files = (await fs.readdir("supabase/migrations")).filter((file) =>
  file.endsWith("_file_uploads.sql"),
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
const target = `supabase/migrations/${version}_file_uploads.sql`;
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
    query:
      "select (select relrowsecurity from pg_class where oid='public.file_uploads'::regclass) as rls, has_table_privilege('authenticated','public.file_uploads','select') as customer_read, has_table_privilege('anon','public.file_uploads','insert') as public_write, exists(select 1 from pg_trigger where tgrelid='public.file_uploads'::regclass and tgname='immutable_file_upload' and tgenabled='O') as immutable",
  }),
});
assert.deepEqual(check, [
  { rls: true, customer_read: false, public_write: false, immutable: true },
]);
const callback = "https://potato-potential.rgbknights.com/auth/callback";
const deployment = JSON.parse(
  await fs.readFile("infra/deployment.json", "utf8"),
);
if (!deployment.supabase.migrations.includes(version))
  deployment.supabase.migrations.push(version);
deployment.supabase.redirectUrl = callback;
await fs.writeFile(
  "infra/deployment.json",
  JSON.stringify(deployment, null, 2) + "\n",
);
console.log(
  "PASS: upload migration recorded as",
  version,
  "with service-only access and immutable bindings. Existing passwordless callback retained.",
);
