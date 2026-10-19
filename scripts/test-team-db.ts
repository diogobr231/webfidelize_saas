import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { storageFixture } from "./storage-fixture";

const db = new PGlite({ extensions: { btree_gist } });
await db.exec(
  `create role anon nologin;create role authenticated nologin;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`,
);
await db.exec(storageFixture);
for (const name of (await readdir("supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort())
  await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
const exists = await db.query<{ existing: string | null }>(
  "select to_regprocedure('public.assign_professional_member(uuid,uuid,uuid,uuid,boolean)')::text as existing",
);
if (!exists.rows[0].existing)
  await db.exec(
    await readFile("supabase/drafts/professional_membership.sql", "utf8"),
  );
const a = randomUUID(),
  b = randomUUID(),
  employee = randomUUID(),
  manager = randomUUID(),
  replacement = randomUUID();
await db.query(
  "insert into auth.users(id,email,email_confirmed_at) values($1,'owner-a@example.invalid',now()),($2,'owner-b@example.invalid',now()),($3,'employee@example.invalid',now()),($4,'manager@example.invalid',now()),($5,'replacement@example.invalid',now())",
  [a, b, employee, manager, replacement],
);
async function as(user: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    user || "",
  ]);
  await db.exec(user ? "set role authenticated" : "set role anon");
}
async function scalar(sql: string, args: unknown[] = []) {
  const result = await db.query<Record<string, unknown>>(sql, args);
  return Object.values(result.rows[0])[0];
}
let checks = 0;
async function check(name: string, run: () => Promise<void>) {
  await run();
  checks++;
  console.log(`PASS team: ${name}`);
}
await as(a);
const ca = String(
  await scalar("select create_company('Empresa A teste','salao')"),
);
await as(b);
const cb = String(
  await scalar("select create_company('Empresa B teste','salao')"),
);
await db.exec("reset role");
await db.query("update companies set plan_id='profissional' where id=$1", [ca]);
await db.query(
  "insert into memberships values($1,$2,'EMPLOYEE'),($1,$3,'MANAGER'),($1,$4,'EMPLOYEE')",
  [ca, employee, manager, replacement],
);
await as(a);
const pa = String(
  await scalar(
    "insert into professionals(company_id,name) values($1,'Profissional A teste') returning id",
    [ca],
  ),
);
const pa2 = String(
  await scalar(
    "insert into professionals(company_id,name) values($1,'Profissional A2 teste') returning id",
    [ca],
  ),
);
const customer = String(
  await scalar(
    "insert into customers(company_id,name) values($1,'Cliente atribuído teste') returning id",
    [ca],
  ),
);
const unrelated = String(
  await scalar(
    "insert into customers(company_id,name) values($1,'Cliente não atribuído teste') returning id",
    [ca],
  ),
);
const service = String(
  await scalar(
    "insert into services(company_id,name,duration_minutes,price_cents) values($1,'Serviço teste',30,1000) returning id",
    [ca],
  ),
);
const appointment = String(
  await scalar(
    "select book_appointment($1,$2,$3,$4,'2099-01-05T10:00:00-03:00')",
    [ca, customer, service, pa],
  ),
);
await db.query(
  "select book_appointment($1,$2,$3,$4,'2099-01-05T10:00:00-03:00')",
  [ca, unrelated, service, pa2],
);
await as(b);
const pb = String(
  await scalar(
    "insert into professionals(company_id,name) values($1,'Profissional B teste') returning id",
    [cb],
  ),
);
const assign = (
  company: string,
  professional: string,
  member: string | null,
  expected: string | null = null,
  confirmed = false,
) =>
  db.query("select assign_professional_member($1,$2,$3,$4,$5)", [
    company,
    professional,
    member,
    expected,
    confirmed,
  ]);
const revoke = (company: string, member: string, confirmed = false) =>
  db.query("select revoke_company_member($1,$2,$3)", [
    company,
    member,
    confirmed,
  ]);
await as(a);
await check(
  "owner directory includes emails only from its own company",
  async () => {
    const rows = (
      await db.query<{ email: string }>(
        "select * from company_team_directory($1)",
        [ca],
      )
    ).rows;
    assert.equal(rows.length, 4);
    assert.ok(rows.some((row) => row.email === "employee@example.invalid"));
    assert.ok(!rows.some((row) => row.email === "owner-b@example.invalid"));
    await assert.rejects(
      () => db.query("select * from company_team_directory($1)", [cb]),
      /not authorized/,
    );
  },
);
await check(
  "cross-company professional and account assignment rejected",
  async () => {
    await assert.rejects(
      () => assign(ca, pb, employee),
      /professional not found/,
    );
    await assert.rejects(() => assign(cb, pb, b), /not authorized/);
    await assert.rejects(() => assign(ca, pa, b), /member not found/);
  },
);
await check("owner assignment preserves counts and plan", async () => {
  await assign(ca, pa, employee);
  assert.equal(
    Number(
      await scalar("select count(*) from professionals where company_id=$1", [
        ca,
      ]),
    ),
    2,
  );
  assert.equal(
    await scalar("select plan_id from companies where id=$1", [ca]),
    "profissional",
  );
  await assert.rejects(
    () => assign(ca, pa2, employee),
    /member already assigned/,
  );
});
await as(employee);
await check(
  "assigned employee reads only the linked agenda and related customer",
  async () => {
    assert.equal(Number(await scalar("select count(*) from appointments")), 1);
    assert.equal(await scalar("select id from appointments"), appointment);
    assert.equal(Number(await scalar("select count(*) from customers")), 1);
    assert.equal(await scalar("select id from customers"), customer);
    assert.equal(Number(await scalar("select count(*) from professionals")), 1);
    assert.equal(Number(await scalar("select count(*) from availability")), 5);
  },
);
await check(
  "employee cannot enumerate emails, reassign or revoke access",
  async () => {
    await assert.rejects(
      () => db.query("select * from company_team_directory($1)", [ca]),
      /not authorized/,
    );
    await assert.rejects(
      () => assign(ca, pa, replacement, employee, true),
      /not authorized/,
    );
    await assert.rejects(() => revoke(ca, manager, true), /not authorized/);
  },
);
await as(manager);
await check(
  "manager cannot alter access through RPC or direct Data API",
  async () => {
    await assert.rejects(
      () => db.query("select * from company_team_directory($1)", [ca]),
      /not authorized/,
    );
    await assert.rejects(
      () => assign(ca, pa, replacement, employee, true),
      /not authorized/,
    );
    await assert.rejects(() => revoke(ca, employee, true), /not authorized/);
    await assert.rejects(
      () =>
        db.query("update professionals set user_id=$1 where id=$2", [
          manager,
          pa,
        ]),
      /permission denied/,
    );
    await assert.rejects(
      () =>
        db.query(
          "insert into professionals(company_id,name,user_id) values($1,'Tentativa', $2)",
          [ca, manager],
        ),
      /permission denied/,
    );
    assert.equal(
      Number(
        await scalar("select count(*) from appointments where company_id=$1", [
          ca,
        ]),
      ),
      2,
    );
  },
);
await as(a);
await check(
  "remap and unlink require confirmation and reject stale submissions",
  async () => {
    await assert.rejects(
      () => assign(ca, pa, replacement, employee),
      /confirmation required/,
    );
    await assert.rejects(
      () => assign(ca, pa, null, employee),
      /confirmation required/,
    );
    await assign(ca, pa, replacement, employee, true);
    await assert.rejects(
      () => assign(ca, pa, employee, employee, true),
      /assignment version conflict/,
    );
  },
);
await as(employee);
await check(
  "remapping immediately removes old employee visibility",
  async () => {
    assert.equal(Number(await scalar("select count(*) from appointments")), 0);
    assert.equal(Number(await scalar("select count(*) from customers")), 0);
  },
);
await as(a);
await assign(ca, pa, null, replacement, true);
await check("unlink preserves professional and all appointments", async () => {
  assert.equal(
    await scalar("select user_id from professionals where id=$1", [pa]),
    null,
  );
  assert.equal(
    Number(
      await scalar(
        "select count(*) from appointments where professional_id=$1",
        [pa],
      ),
    ),
    1,
  );
  await assign(ca, pa, employee);
});
await check(
  "direct inserts cannot assign access and ordinary creation keeps plan limits",
  async () => {
    await assert.rejects(
      () =>
        db.query(
          "insert into professionals(company_id,name,user_id) values($1,'Tentativa owner',$2)",
          [ca, replacement],
        ),
      /permission denied/,
    );
    await db.query(
      "insert into professionals(company_id,name) values($1,'Terceiro profissional teste')",
      [ca],
    );
    await assert.rejects(
      () =>
        db.query(
          "insert into professionals(company_id,name) values($1,'Além do plano teste')",
          [ca],
        ),
      /professional limit/,
    );
  },
);
await check(
  "revocation cannot target owner or foreign members and needs confirmation",
  async () => {
    await assert.rejects(() => revoke(ca, employee), /confirmation required/);
    await assert.rejects(() => revoke(ca, a, true), /cannot revoke owner/);
    await assert.rejects(() => revoke(cb, b, true), /not authorized/);
    await assert.rejects(() => revoke(ca, b, true), /member not found/);
  },
);
const invitation = String(
  await scalar(
    "select invite_member($1,'employee@example.invalid','EMPLOYEE')",
    [ca],
  ),
);
await revoke(ca, employee, true);
await check(
  "revocation preserves schedule and expires outstanding invitations",
  async () => {
    assert.equal(
      await scalar("select user_id from professionals where id=$1", [pa]),
      null,
    );
    assert.equal(
      Number(
        await scalar(
          "select count(*) from appointments where professional_id=$1",
          [pa],
        ),
      ),
      1,
    );
    assert.equal(
      Number(
        await scalar(
          "select count(*) from availability where professional_id=$1",
          [pa],
        ),
      ),
      5,
    );
    assert.equal(
      Number(
        await scalar(
          "select count(*) from invitations where company_id=$1 and email='employee@example.invalid' and expires_at>now() and accepted_at is null",
          [ca],
        ),
      ),
      0,
    );
  },
);
await as(employee);
await check(
  "still-valid user identity loses tenant visibility immediately after revocation",
  async () => {
    assert.equal(await scalar("select auth.uid()::text"), employee);
    for (const table of [
      "companies",
      "memberships",
      "professionals",
      "appointments",
      "customers",
      "availability",
    ])
      assert.equal(
        Number(
          await scalar(
            `select count(*) from public.${table} where ${table === "companies" ? "id" : "company_id"}=$1`,
            [ca],
          ),
        ),
        0,
      );
    await assert.rejects(
      () => db.query("select accept_invitation($1)", [invitation]),
      /invalid invitation/,
    );
  },
);
await as(a);
await revoke(ca, manager, true);
await as(manager);
await check(
  "revoked manager loses all company appointment access",
  async () => {
    assert.equal(
      Number(
        await scalar("select count(*) from appointments where company_id=$1", [
          ca,
        ]),
      ),
      0,
    );
    await assert.rejects(
      () =>
        db.query(
          "insert into customers(company_id,name) values($1,'Tentativa revogada')",
          [ca],
        ),
      /row-level security/,
    );
  },
);
for (const status of ["past_due", "suspended", "trialing"]) {
  await db.exec("reset role");
  await db.query(
    "update companies set status=$2,trial_ends_at=now()-interval '1 day' where id=$1",
    [ca, status],
  );
  await db.query(
    "insert into memberships(company_id,user_id,role) values($1,$2,'EMPLOYEE') on conflict do nothing",
    [ca, replacement],
  );
  await db.query("update professionals set user_id=$1 where id=$2", [
    replacement,
    pa,
  ]);
  await as(a);
  await check(
    `owner can revoke access after ${status === "trialing" ? "trial expiration" : status} without changing data or ownership`,
    async () => {
      await assert.rejects(
        () => assign(ca, pa, replacement),
        /subscription blocked/,
      );
      await assert.rejects(() => revoke(ca, a, true), /cannot revoke owner/);
      await assert.rejects(
        () => revoke(ca, replacement),
        /confirmation required/,
      );
      await revoke(ca, replacement, true);
      assert.equal(
        await scalar("select user_id from professionals where id=$1", [pa]),
        null,
      );
      assert.equal(
        Number(
          await scalar(
            "select count(*) from memberships where company_id=$1 and user_id=$2",
            [ca, replacement],
          ),
        ),
        0,
      );
      assert.equal(
        await scalar(
          "select role from memberships where company_id=$1 and user_id=$2",
          [ca, a],
        ),
        "OWNER",
      );
      assert.equal(
        Number(
          await scalar(
            "select count(*) from appointments where company_id=$1",
            [ca],
          ),
        ),
        2,
      );
      assert.equal(
        Number(
          await scalar(
            "select count(*) from professionals where company_id=$1",
            [ca],
          ),
        ),
        3,
      );
      assert.equal(
        Number(
          await scalar("select count(*) from customers where company_id=$1", [
            ca,
          ]),
        ),
        2,
      );
    },
  );
}
await as(null);
await check("anonymous RPC invocation denied", async () => {
  await assert.rejects(
    () => db.query("select * from company_team_directory($1)", [ca]),
    /permission denied/,
  );
  await assert.rejects(() => assign(ca, pa, replacement), /permission denied/);
  await assert.rejects(
    () => revoke(ca, replacement, true),
    /permission denied/,
  );
});
await db.close();
console.log(`${checks} team access / RLS checks passed`);
