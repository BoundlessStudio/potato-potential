import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
async function computerRows(ownerId: string, instanceId: string) {
  await db.query("update public.agents set instance_id=$1 where owner_id=$2", [
    instanceId,
    ownerId,
  ]);
  const service = {
    ownerId,
    instanceId,
    port: 8788,
    label: "Test service",
    state: "running",
    createdAt: new Date().toISOString(),
  };
  const request = {
    id: randomUUID(),
    ownerId,
    instanceId,
    port: 8788,
    kind: "signed",
    status: "approved",
    urlBox: "encrypted-fixture",
  };
  await db.query(
    "insert into public.computer_services(owner_id,instance_id,port,service) values($1,$2,8788,$3)",
    [ownerId, instanceId, JSON.stringify(service)],
  );
  await db.query(
    "insert into public.computer_link_requests(id,owner_id,instance_id,port,kind,status,created_at,request) values($1,$2,$3,8788,'signed','approved',now(),$4)",
    [request.id, ownerId, instanceId, JSON.stringify(request)],
  );
  return { service, request };
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key, email text); create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated; create publication supabase_realtime;`,
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
      "supabase/migrations/202610050003_beta_requests.sql",
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      "supabase/migrations/202610060001_atomic_invitation_acceptance.sql",
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      "supabase/migrations/20261006182258_account_erasure.sql",
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      "supabase/migrations/20261006205152_independent_beta_requests.sql",
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      "supabase/migrations/20261006205153_computer_services.sql",
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      "supabase/migrations/20261007034424_file_uploads.sql",
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      "supabase/migrations/20261007135706_account_beta_cleanup.sql",
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      "supabase/migrations/20261007151028_account_email_ownership.sql",
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      "supabase/migrations/20261008120000_remove_task_session_links.sql",
      "utf8",
    ),
  );
  await db.exec(
    `insert into auth.users(id) values ('${a}'),('${b}'); insert into public.customers(id,email,profile) values ('${a}','a@example.com','{}'),('${b}','b@example.com','{}'); insert into public.agents(owner_id,state) values ('${a}','{"secret":"hidden"}'),('${b}','{}'); insert into public.workspace_items(id,owner_id,kind,item) values ('33333333-3333-4333-8333-333333333333','${a}','wiki','{"title":"A wiki"}'),('44444444-4444-4444-8444-444444444444','${b}','task','{"title":"B task"}');`,
  );
});
afterAll(async () => {
  await db.close();
});
it("removes legacy task session links without changing work details or conversation histories", async () => {
  await db.exec("begin");
  try {
    for (const kind of ["task", "responsibility", "wiki"]) {
      await db.query(
        "insert into public.workspace_items(id,owner_id,kind,item) values($1,$2,$3,$4)",
        [
          randomUUID(),
          a,
          kind,
          JSON.stringify({
            title: "Keep this work",
            body: "Budget agreed; waiting for dates. Output: ~/outputs/report.md",
            status: "needs_you",
            createdAt: "2026-10-01T12:00:00.000Z",
            updatedAt: "2026-10-07T12:00:00.000Z",
            metadata: { decision: "Use the agreed budget" },
            sessionLinks: [
              { sessionId: "legacy-session", instanceId: "oldagent01" },
            ],
          }),
        ],
      );
    }
    await db.query(
      "insert into public.conversations(owner_id,session_id,conversation) values($1,$2,$3)",
      [a, "legacy-session", JSON.stringify({ title: "Keep this history" })],
    );
    const before = await db.query<{
      id: string;
      kind: string;
      item: Record<string, unknown>;
      updated_at: string;
    }>("select * from public.workspace_items order by id");
    const histories = await db.query(
      "select * from public.conversations order by session_id",
    );
    const migration = await readFile(
      "supabase/migrations/20261008120000_remove_task_session_links.sql",
      "utf8",
    );
    await db.exec(migration);
    const expected = before.rows.map((row) => {
      const item = { ...row.item };
      if (["task", "responsibility"].includes(row.kind))
        delete item.sessionLinks;
      return { ...row, item };
    });
    expect(
      (await db.query("select * from public.workspace_items order by id")).rows,
    ).toEqual(expected);
    expect(
      (await db.query("select * from public.conversations order by session_id"))
        .rows,
    ).toEqual(histories.rows);
    await db.exec(migration);
    expect(
      (await db.query("select * from public.workspace_items order by id")).rows,
    ).toEqual(expected);
  } finally {
    await db.exec("rollback");
  }
});
it("retains the new owner's beta access when closing an account whose former email has been reused", async () => {
  const oldOwner = randomUUID(),
    newOwner = randomUUID();
  await db.exec("begin");
  try {
    await db.query(
      "insert into auth.users(id,email) values($1,'changed@example.com'),($2,'reused@example.com')",
      [oldOwner, newOwner],
    );
    await db.query(
      "insert into public.customers(id,email,profile) values($1,'reused@example.com','{}'),($2,'reused@example.com','{}')",
      [oldOwner, newOwner],
    );
    await db.query(
      "insert into public.invitations(email,token_hash,used_by,expires_at) values('reused@example.com','reuse-old',$1,now()+interval '1 day'),('reused@example.com','reuse-new',$2,now()+interval '1 day'),('reused@example.com','reuse-pending',null,now()+interval '1 day')",
      [oldOwner, newOwner],
    );
    await db.exec(
      "insert into public.beta_requests(email) values('reused@example.com'),('changed@example.com')",
    );
    await db.query("delete from auth.users where id=$1", [oldOwner]);
    expect(
      (
        await db.query(
          "select email from public.beta_requests where email in ('reused@example.com','changed@example.com') order by email",
        )
      ).rows,
    ).toEqual([{ email: "reused@example.com" }]);
    expect(
      (
        await db.query(
          "select token_hash from public.invitations where token_hash like 'reuse-%' order by token_hash",
        )
      ).rows,
    ).toEqual([{ token_hash: "reuse-new" }, { token_hash: "reuse-pending" }]);
    expect(
      (
        await db.query("select id from public.customers where id=$1", [
          newOwner,
        ])
      ).rows,
    ).toEqual([{ id: newOwner }]);
  } finally {
    await db.exec("rollback");
  }
});
it("revokes unused invitations for an unshared historical email when closing its former owner", async () => {
  const owner = randomUUID();
  await db.exec("begin");
  try {
    await db.query(
      "insert into auth.users(id,email) values($1,'current-address@example.com')",
      [owner],
    );
    await db.query(
      "insert into public.customers(id,email,profile) values($1,'current-address@example.com','{}')",
      [owner],
    );
    await db.query(
      "insert into public.invitations(email,token_hash,used_by,expires_at) values('former-address@example.com','historical-used',$1,now()+interval '1 day'),('former-address@example.com','historical-pending',null,now()+interval '1 day')",
      [owner],
    );
    await db.exec(
      "insert into public.beta_requests(email) values('former-address@example.com')",
    );
    await db.query("delete from auth.users where id=$1", [owner]);
    expect(
      (
        await db.query(
          "select * from public.beta_requests where email='former-address@example.com'",
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await db.query(
          "select * from public.invitations where token_hash like 'historical-%'",
        )
      ).rows,
    ).toEqual([]);
  } finally {
    await db.exec("rollback");
  }
});
it("keeps upload records service-only, binds ownership immutably and cascades account removal", async () => {
  const owner = randomUUID(),
    id = randomUUID(),
    instance = "upl1234567";
  const upload = {
    id,
    ownerId: owner,
    instanceId: instance,
    state: "uploading",
    directory: "/home/node/uploads",
    name: "sample.bin",
    size: 12,
    sha256: "a".repeat(64),
    chunks: {},
  };
  await db.query("insert into auth.users(id) values($1)", [owner]);
  await db.query(
    "insert into public.customers(id,email,profile) values($1,'upload@example.com','{}')",
    [owner],
  );
  await db.query(
    "insert into public.agents(owner_id,instance_id,state) values($1,$2,'{}')",
    [owner, instance],
  );
  await db.query(
    "insert into public.file_uploads(id,owner_id,instance_id,state,expires_at,upload) values($1,$2,$3,'uploading',now()+interval '24 hours',$4)",
    [id, owner, instance, JSON.stringify(upload)],
  );
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    try {
      await expect(
        db.query("select * from public.file_uploads"),
      ).rejects.toThrow("permission denied");
    } finally {
      await db.exec("reset role");
    }
  }
  await db.exec("set role service_role");
  try {
    expect(
      (await db.query("select id from public.file_uploads where id=$1", [id]))
        .rows,
    ).toHaveLength(1);
    await expect(
      db.query(
        "update public.file_uploads set upload=jsonb_set(upload,'{sha256}','\"changed\"') where id=$1",
        [id],
      ),
    ).rejects.toThrow("upload identity cannot change");
    await expect(
      db.query("update public.file_uploads set owner_id=$1 where id=$2", [
        a,
        id,
      ]),
    ).rejects.toThrow("upload identity cannot change");
  } finally {
    await db.exec("reset role");
  }
  await db.query("delete from public.customers where id=$1", [owner]);
  expect(
    (await db.query("select id from public.file_uploads where id=$1", [id]))
      .rows,
  ).toHaveLength(0);
  await db.query("delete from auth.users where id=$1", [owner]);
});
it("keeps the beta review list and approval credentials private from applicants and customers", async () => {
  await db.exec(
    "insert into public.beta_requests(email) values ('waiting@example.com'); set role anon;",
  );
  await expect(db.query("select * from public.beta_requests")).rejects.toThrow(
    "permission denied",
  );
  await expect(
    db.query(
      "insert into public.beta_requests(email) values ('self@example.com')",
    ),
  ).rejects.toThrow("permission denied");
  await db.exec("reset role; set role authenticated;");
  await expect(
    db.query("update public.beta_requests set approved_at=now()"),
  ).rejects.toThrow("permission denied");
  await db.exec("reset role; set role service_role;");
  expect(
    (await db.query("select * from public.beta_requests")).rows,
  ).toHaveLength(1);
  await db.exec("reset role;");
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
      `select public.enqueue_application_job('${b}','reconcile') as job`,
    )
  ).rows[0].job;
  expect(maintenance.kind).toBe("reconcile");
  expect(maintenance.id).not.toBe(id);
  expect(
    (
      await db.query<{ job: { id: string } }>(
        `select public.enqueue_application_job('${b}','reconcile') as job`,
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
  await db.exec(
    `update public.agents set state='{"deletion":{"instance":true,"identity":true}}' where owner_id='${a}'; delete from auth.users where id='${a}'`,
  );
  expect(
    (
      await db.query(
        "select used_by from public.invitations where token_hash='digest'",
      )
    ).rows,
  ).toEqual([]);
});
it("atomically enrolls customers and consumes invitations, rolls back failures, and restricts the RPC", async () => {
  const owner = "aaaa1111-1111-4111-8111-111111111111";
  const profile = JSON.stringify({
    id: owner,
    email: "atomic@example.com",
    name: "Original",
  });
  const accept = `select public.accept_invitation('${owner}','atomic@example.com','atomic','${profile}'::jsonb)`;
  await db.exec(
    "insert into public.invitations(email,token_hash,expires_at) values ('atomic@example.com','atomic',now()+interval '1 day')",
  );
  await db.exec("set role anon");
  await expect(db.exec(accept)).rejects.toThrow("permission denied");
  await db.exec("reset role; set role authenticated");
  await expect(db.exec(accept)).rejects.toThrow("permission denied");
  await db.exec("reset role; set role service_role");
  // Auth account is absent: inserting the customer fails and must roll back token use.
  await expect(db.exec(accept)).rejects.toThrow("foreign key");
  await db.exec("reset role");
  expect(
    (
      await db.query(
        "select used_by from public.invitations where token_hash='atomic'",
      )
    ).rows[0],
  ).toEqual({ used_by: null });
  await db.exec(`insert into auth.users(id) values('${owner}')`);
  await db.exec("set role service_role");
  await db.exec(accept);
  await db.exec(accept.replace('"Original"', '"Overwrite"'));
  await db.exec("reset role");
  expect(
    (
      await db.query<{ profile: { name: string } }>(
        `select profile from public.customers where id='${owner}'`,
      )
    ).rows[0].profile.name,
  ).toBe("Original");
  expect(
    (
      await db.query(
        "select used_by from public.invitations where token_hash='atomic'",
      )
    ).rows[0],
  ).toEqual({ used_by: owner });
  await expect(db.exec(accept.replace(owner, b))).rejects.toThrow(
    "invalid invitation",
  );
  await db.exec(`delete from auth.users where id='${owner}'`);
  await expect(db.exec(accept.replaceAll(owner, b))).rejects.toThrow(
    "invalid invitation",
  );
});

it("rejects expired and mismatched enrollment payloads without consuming the token", async () => {
  await db.exec(
    "insert into public.invitations(email,token_hash,expires_at) values ('b@example.com','expired-atomic',now()-interval '1 day'),('b@example.com','mismatch-atomic',now()+interval '1 day')",
  );
  await expect(
    db.exec(
      `select public.accept_invitation('${b}','b@example.com','expired-atomic','{"id":"${b}","email":"b@example.com"}')`,
    ),
  ).rejects.toThrow("invalid invitation");
  await expect(
    db.exec(
      `select public.accept_invitation('${b}','b@example.com','mismatch-atomic','{"id":"${a}","email":"b@example.com"}')`,
    ),
  ).rejects.toThrow("invalid invitation");
  expect(
    (
      await db.query(
        "select used_by from public.invitations where token_hash in ('expired-atomic','mismatch-atomic')",
      )
    ).rows,
  ).toEqual([{ used_by: null }, { used_by: null }]);
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

it.each([
  {
    name: "both providers outstanding",
    state: { deletion: { instance: false, identity: false } },
  },
  {
    name: "computer outstanding",
    state: { deletion: { instance: false, identity: true } },
  },
  {
    name: "identity outstanding",
    state: { deletion: { instance: true, identity: false } },
  },
  { name: "deletion flags absent", state: {} },
  {
    name: "computer confirmation absent",
    state: { deletion: { identity: true } },
  },
  {
    name: "identity confirmation absent",
    state: { deletion: { instance: true } },
  },
])("blocks Auth erasure with $name", async ({ state }) => {
  const owner = randomUUID();
  await db.exec("begin");
  try {
    await db.query("insert into auth.users(id,email) values($1,$2)", [
      owner,
      `${owner}@example.com`,
    ]);
    await db.query(
      "insert into public.customers(id,email,profile) values($1,$2,'{}')",
      [owner, `${owner}@example.com`],
    );
    await db.query("insert into public.agents(owner_id,state) values($1,$2)", [
      owner,
      JSON.stringify({ status: "deleting", ...state }),
    ]);
    await db.exec("savepoint before_erasure");
    await expect(
      db.query("delete from auth.users where id=$1", [owner]),
    ).rejects.toThrow("provider cleanup must complete");
    await db.exec("rollback to savepoint before_erasure");
    expect(
      (await db.query("select id from auth.users where id=$1", [owner])).rows,
    ).toEqual([{ id: owner }]);
    expect(
      (await db.query("select id from public.customers where id=$1", [owner]))
        .rows,
    ).toEqual([{ id: owner }]);
    expect(
      (
        await db.query("select state from public.agents where owner_id=$1", [
          owner,
        ])
      ).rows,
    ).toEqual([{ state: { status: "deleting", ...state } }]);
  } finally {
    await db.exec("rollback");
  }
});

it("guards Auth deletion until provider cleanup and erases only the closing account's data atomically", async () => {
  const owner = "cccc1111-1111-4111-8111-111111111111";
  await db.exec(`
    insert into auth.users(id,email) values('${owner}','auth-close@example.com');
    insert into public.customers(id,email,profile) values('${owner}','profile-close@example.com','{}');
    insert into public.agents(owner_id,state) values('${owner}','{"status":"deleting","deletion":{"instance":true,"identity":false}}');
    insert into public.workspace_items(id,owner_id,kind,item) values(gen_random_uuid(),'${owner}','wiki','{}');
    insert into public.notifications(id,owner_id,note) values(gen_random_uuid(),'${owner}','{}');
    insert into public.conversations(owner_id,session_id,conversation) values('${owner}','close-session','{}');
    insert into public.cron_archive(owner_id,run_key,run) values('${owner}','close-run','{}');
    insert into public.application_jobs(owner_id,kind,status) values('${owner}','cleanup','running'),('${owner}','provision','completed');
    select public.claim_customer_lease('${owner}',gen_random_uuid());
    insert into public.invitations(email,token_hash,used_by,expires_at) values
      ('profile-close@example.com','close-consumed','${owner}',now()+interval '1 day'),
      ('old-close@example.com','close-old-email','${owner}',now()+interval '1 day'),
      ('auth-close@example.com','close-pending',null,now()+interval '1 day');
    insert into public.beta_requests(email) values
      ('profile-close@example.com'),('auth-close@example.com'),('old-close@example.com'),('someone-else@example.com');
    insert into public.invitations(email,token_hash,used_by,expires_at) values
      ('b@example.com','other-pending',null,now()+interval '1 day'),
      ('b@example.com','other-consumed','${b}',now()+interval '1 day');
    insert into public.notifications(id,owner_id,note) values(gen_random_uuid(),'${b}','{"text":"Keep this notification"}');
    insert into public.conversations(owner_id,session_id,conversation) values('${b}','other-session','{"title":"Keep this conversation"}');
    insert into public.cron_archive(owner_id,run_key,run) values('${b}','other-run','{"name":"Keep this reminder"}');
    insert into public.application_jobs(owner_id,kind,status) values('${b}','cleanup','completed');
    select public.claim_customer_lease('${b}',gen_random_uuid());
    insert into public.beta_requests(email) values('b@example.com');
  `);
  const ownedTables = [
    ["auth.users", "id"],
    ["public.customers", "id"],
    ["public.agents", "owner_id"],
    ["public.workspace_items", "owner_id"],
    ["public.notifications", "owner_id"],
    ["public.conversations", "owner_id"],
    ["public.cron_archive", "owner_id"],
    ["public.application_jobs", "owner_id"],
    ["public.customer_leases", "owner_id"],
    ["public.computer_services", "owner_id"],
    ["public.computer_link_requests", "owner_id"],
  ];
  await computerRows(owner, "close12345");
  await computerRows(b, "other12345");
  const counts = async () =>
    Promise.all(
      ownedTables.map(
        async ([table, column]) =>
          (
            await db.query<{ count: number }>(
              `select count(*)::int as count from ${table} where ${column}='${owner}'`,
            )
          ).rows[0].count,
      ),
    );
  const before = await counts();
  const otherRecords = async () =>
    Promise.all(
      ownedTables.map(async ([table, column]) =>
        (
          await db.query(`select * from ${table} where ${column}=$1`, [b])
        ).rows.sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        ),
      ),
    );
  const otherInvitations = async () =>
    (
      await db.query(
        "select * from public.invitations where email='b@example.com' order by token_hash",
      )
    ).rows;
  const otherBeta = async () =>
    (
      await db.query(
        "select * from public.beta_requests where email='b@example.com'",
      )
    ).rows;
  const otherBefore = await otherRecords();
  const invitationsBefore = await otherInvitations();
  const betaBefore = await otherBeta();
  const allBetaBefore = (
    await db.query("select * from public.beta_requests order by email")
  ).rows;
  expect(otherBefore.every((rows) => rows.length > 0)).toBe(true);
  expect(invitationsBefore).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ token_hash: "other-pending", used_by: null }),
      expect.objectContaining({ token_hash: "other-consumed", used_by: b }),
    ]),
  );
  expect(before.every((count) => count > 0)).toBe(true);
  await expect(
    db.exec(`delete from auth.users where id='${owner}'`),
  ).rejects.toThrow("provider cleanup must complete");
  expect(await counts()).toEqual(before);
  expect(
    (await db.query("select * from public.beta_requests order by email")).rows,
  ).toEqual(allBetaBefore);
  expect(
    (
      await db.query(
        "select * from public.invitations where token_hash like 'close-%'",
      )
    ).rows,
  ).toHaveLength(3);
  await db.exec(
    `update public.agents set state='{"status":"deleting","deletion":{"instance":true,"identity":true}}' where owner_id='${owner}'`,
  );
  // Even after cleanup is permitted, an Auth transaction rollback restores ancillary rows.
  await db.exec(`begin; delete from auth.users where id='${owner}'; rollback;`);
  expect(await counts()).toEqual(before);
  expect(
    (await db.query("select * from public.beta_requests order by email")).rows,
  ).toEqual(allBetaBefore);
  expect(
    (
      await db.query(
        "select * from public.invitations where token_hash like 'close-%'",
      )
    ).rows,
  ).toHaveLength(3);
  await db.exec(`delete from auth.users where id='${owner}'`);
  expect(await counts()).toEqual(ownedTables.map(() => 0));
  expect(
    (
      await db.query(
        "select * from public.invitations where token_hash like 'close-%'",
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query(
        "select * from public.beta_requests where email in ('profile-close@example.com','auth-close@example.com','old-close@example.com')",
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query(
        "select email from public.beta_requests where email='someone-else@example.com'",
      )
    ).rows,
  ).toEqual([{ email: "someone-else@example.com" }]);
  expect(
    (await db.query("select * from public.beta_requests order by email")).rows,
  ).toEqual(
    allBetaBefore.filter(
      (row) =>
        row.email !== "profile-close@example.com" &&
        row.email !== "auth-close@example.com" &&
        row.email !== "old-close@example.com",
    ),
  );
  expect(
    (await db.query(`select * from public.customers where id='${b}'`)).rows,
  ).toHaveLength(1);
  expect(await otherRecords()).toEqual(otherBefore);
  expect(await otherInvitations()).toEqual(invitationsBefore);
  expect(await otherBeta()).toEqual(betaBefore);
  await expect(
    db.exec(`select public.enqueue_application_job('${owner}','provision')`),
  ).rejects.toThrow("foreign key");
  await db.exec("set role authenticated");
  await expect(db.exec("select public.erase_account_links()")).rejects.toThrow(
    "permission denied",
  );
  await db.exec("reset role");
});

it("preserves email-scoped invitation locks that are not Auth accounts", async () => {
  const lock = "dddd1111-1111-4111-8111-111111111111";
  expect(
    (
      await db.query(
        `select public.claim_customer_lease('${lock}', '${lock}') as claimed`,
      )
    ).rows,
  ).toEqual([{ claimed: true }]);
  await db.exec(`select public.release_customer_lease('${lock}','${lock}')`);
});

it("protects computer records from direct clients, foreign instance binding and duplicate pending requests", async () => {
  const owner = randomUUID(),
    instance = "schema1234";
  await db.query("insert into auth.users(id) values($1)", [owner]);
  await db.query(
    "insert into public.customers(id,email,profile) values($1,'computer@example.com','{}')",
    [owner],
  );
  await db.query("insert into public.agents(owner_id,state) values($1,'{}')", [
    owner,
  ]);
  const { service, request } = await computerRows(owner, instance);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    for (const table of ["computer_services", "computer_link_requests"]) {
      await expect(db.query(`select * from public.${table}`)).rejects.toThrow(
        "permission denied",
      );
      await expect(db.query(`delete from public.${table}`)).rejects.toThrow(
        "permission denied",
      );
    }
    await db.exec("reset role");
  }
  await expect(
    db.query(
      "update public.computer_services set instance_id='other12345' where owner_id=$1",
      [owner],
    ),
  ).rejects.toThrow("ownership cannot change");
  await expect(
    db.query(
      "insert into public.computer_services(owner_id,instance_id,port,service) values($1,'other12345',8790,$2)",
      [
        owner,
        JSON.stringify({ ...service, instanceId: "other12345", port: 8790 }),
      ],
    ),
  ).rejects.toThrow("foreign key");
  await expect(
    db.query(
      "update public.computer_services set service='{}' where owner_id=$1",
      [owner],
    ),
  ).rejects.toThrow("check constraint");
  const first = { ...request, id: randomUUID(), status: "pending" };
  const insert = (row: typeof first) =>
    db.query(
      "insert into public.computer_link_requests(id,owner_id,instance_id,port,kind,status,request,created_at) values($1,$2,$3,8788,'signed',$4,$5,now())",
      [row.id, owner, instance, row.status, JSON.stringify(row)],
    );
  await insert(first);
  const duplicate = { ...first, id: randomUUID(), status: "publishing" };
  await expect(insert(duplicate)).rejects.toThrow("duplicate key");
  await db.query(
    "update public.computer_link_requests set status='rejected',request=jsonb_set(request,'{status}','\"rejected\"') where id=$1",
    [first.id],
  );
  await insert(duplicate);
  await expect(
    db.query(
      "update public.computer_link_requests set owner_id=$1 where id=$2",
      [b, duplicate.id],
    ),
  ).rejects.toThrow("ownership cannot change");
  await db.query(
    "update public.computer_services set service=$1 where owner_id=$2",
    [JSON.stringify({ ...service, label: "Updated label" }), owner],
  );
});

it("stores a single canonical beta request per email without an Auth owner or resetting approval", async () => {
  const email = "unique-request@example.com";
  await db.query(
    "insert into public.beta_requests(email,approved_at) values($1,'2026-01-01T00:00:00Z')",
    [email],
  );
  const before = (
    await db.query("select * from public.beta_requests where email=$1", [email])
  ).rows;
  await expect(
    db.query("insert into public.beta_requests(email) values($1)", [email]),
  ).rejects.toThrow("duplicate key");
  await db.query(
    "insert into public.beta_requests(email) values(lower(btrim($1))) on conflict(email) do nothing",
    [` ${email.toUpperCase()} `],
  );
  expect(
    (
      await db.query("select * from public.beta_requests where email=$1", [
        email,
      ])
    ).rows,
  ).toEqual(before);
  expect(
    (
      await db.query(
        "select column_name from information_schema.columns where table_schema='public' and table_name='beta_requests' and column_name in ('approved_by','owner_id','user_id')",
      )
    ).rows,
  ).toEqual([]);
});
