import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated; create publication supabase_realtime;`,
  );
  await db.exec(
    await readFile("supabase/migrations/202610050001_companions.sql", "utf8"),
  );
  await db.exec(
    await readFile(
      "supabase/migrations/202610050002_workflow_jobs.sql",
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      "supabase/migrations/202610050003_computer_maintenance.sql",
      "utf8",
    ),
  );
  await db.exec(
    `insert into auth.users values ('${a}'),('${b}'); insert into public.customers(id,email,profile) values ('${a}','a@example.com','{}'),('${b}','b@example.com','{}'); insert into public.agents(owner_id,state) values ('${a}','{"secret":"hidden"}'),('${b}','{}'); insert into public.workspace_items(id,owner_id,kind,item) values ('33333333-3333-4333-8333-333333333333','${a}','wiki','{"title":"A wiki"}'),('44444444-4444-4444-8444-444444444444','${b}','task','{"title":"B task"}');`,
  );
});
afterAll(async () => {
  await db.close();
});
it("executes the full migration and isolates customer reads with real Postgres RLS", async () => {
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${a}';`);
  expect(
    (await db.query("select * from public.workspace_items")).rows,
  ).toHaveLength(1);
  expect(
    (await db.query(`select * from public.customers where id='${b}'`)).rows,
  ).toHaveLength(0);
  await expect(db.query("select * from public.agents")).rejects.toThrow(
    "permission denied",
  );
  await expect(
    db.query("select * from public.application_jobs"),
  ).rejects.toThrow("permission denied");
  await expect(
    db.query(`select public.enqueue_application_job('${a}','provision')`),
  ).rejects.toThrow("permission denied");
  await expect(
    db.query(
      `insert into public.workspace_items values ('55555555-5555-4555-8555-555555555555','${a}','task','{}',now())`,
    ),
  ).rejects.toThrow();
  await expect(
    db.query(
      `select public.claim_customer_lease('${a}','55555555-5555-4555-8555-555555555555')`,
    ),
  ).rejects.toThrow("permission denied");
  await db.exec("reset role");
});
it("deduplicates queued work, serializes duplicate deliveries and resumes an expired worker", async () => {
  const first = "88888888-8888-4888-8888-888888888888",
    second = "99999999-9999-4999-8999-999999999999";
  const enqueue = async () =>
    (
      await db.query<{ job: { id: string } }>(
        `select public.enqueue_application_job('${b}','provision') as job`,
      )
    ).rows[0].job.id;
  const id = await enqueue();
  expect(await enqueue()).toBe(id);
  const maintenance = (
    await db.query<{ job: { id: string; kind: string } }>(
      `select public.enqueue_application_job('${b}','maintenance') as job`,
    )
  ).rows[0].job;
  expect(maintenance.kind).toBe("maintenance");
  expect(maintenance.id).not.toBe(id);
  expect(
    (
      await db.query<{ job: { id: string } }>(
        `select public.enqueue_application_job('${b}','maintenance') as job`,
      )
    ).rows[0].job.id,
  ).toBe(maintenance.id);
  expect(
    (
      await db.query(
        `select public.claim_job_dispatch('${id}','${first}') as claimed`,
      )
    ).rows[0],
  ).toEqual({ claimed: true });
  expect(
    (
      await db.query(
        `select public.claim_job_dispatch('${id}','${second}') as claimed`,
      )
    ).rows[0],
  ).toEqual({ claimed: false });
  expect(
    (
      await db.query(
        `select public.claim_application_job('${id}','${first}') as job`,
      )
    ).rows[0].job,
  ).toMatchObject({ status: "running" });
  expect(
    (
      await db.query(
        `select public.claim_application_job('${id}','${second}') as job`,
      )
    ).rows[0].job,
  ).toBeNull();
  await db.exec(
    `select public.finish_application_job('${id}','${second}','completed')`,
  );
  expect(await enqueue()).toBe(id);
  await db.exec(
    `update public.application_jobs set locked_until=now()-interval '1 second' where id='${id}'`,
  );
  expect(
    (
      await db.query(
        `select public.claim_application_job('${id}','${second}') as job`,
      )
    ).rows[0].job,
  ).toMatchObject({ status: "running" });
  await db.exec(
    `select public.finish_application_job('${id}','${second}','completed')`,
  );
  expect(await enqueue()).not.toBe(id);
});
it("forbids a service-role upsert from reassigning a tenant item", async () => {
  await expect(
    db.exec(
      `update public.workspace_items set owner_id='${b}' where owner_id='${a}'`,
    ),
  ).rejects.toThrow("ownership cannot change");
});
it("claims invitations once for the verified email and never reopens them on deletion", async () => {
  await db.exec(
    `insert into public.invitations(email,token_hash,expires_at) values ('a@example.com','digest',now()+interval '1 day');`,
  );
  await expect(
    db.exec(`select public.claim_invitation('${b}','b@example.com','digest')`),
  ).rejects.toThrow("invalid invitation");
  await db.exec(
    `select public.claim_invitation('${a}','a@example.com','digest'); select public.claim_invitation('${a}','a@example.com','digest');`,
  );
  await expect(
    db.exec(`select public.claim_invitation('${b}','a@example.com','digest')`),
  ).rejects.toThrow("invalid invitation");
  await db.exec(`delete from auth.users where id='${a}'`);
  expect(
    (await db.query("select used_by from public.invitations")).rows[0],
  ).toEqual({ used_by: a });
});
it("leases serialize work and only the owning token can release them", async () => {
  const first = "66666666-6666-4666-8666-666666666666",
    second = "77777777-7777-4777-8777-777777777777";
  expect(
    (
      await db.query(
        `select public.claim_customer_lease('${b}','${first}') as claimed`,
      )
    ).rows[0],
  ).toEqual({ claimed: true });
  expect(
    (
      await db.query(
        `select public.claim_customer_lease('${b}','${second}') as claimed`,
      )
    ).rows[0],
  ).toEqual({ claimed: false });
  await db.exec(`select public.release_customer_lease('${b}','${second}');`);
  expect(
    (await db.query("select * from public.customer_leases")).rows,
  ).toHaveLength(1);
  await db.exec(`select public.release_customer_lease('${b}','${first}');`);
  expect(
    (await db.query("select * from public.customer_leases")).rows,
  ).toHaveLength(0);
});
