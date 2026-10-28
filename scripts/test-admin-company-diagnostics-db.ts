import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { storageFixture } from "./storage-fixture";
import { installLegacyTrialFixtures } from "./legacy-trial-fixture";

const db = new PGlite({ extensions: { btree_gist } });
await db.exec(`create role anon nologin;create role authenticated nologin;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,last_sign_in_at timestamptz,encrypted_password text,raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
await db.exec(storageFixture);
for (const file of (await readdir("supabase/migrations"))
  .filter((n) => n.endsWith(".sql"))
  .sort())
  await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
await installLegacyTrialFixtures(db);
async function scalar(sql: string, args: unknown[] = []) {
  return Object.values(
    (await db.query<Record<string, unknown>>(sql, args)).rows[0],
  )[0];
}
async function as(user: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    user ?? "",
  ]);
  await db.exec(user ? "set role authenticated" : "set role anon");
}
let checks = 0;
async function check(name: string, run: () => Promise<void>) {
  await run();
  checks++;
  console.log(`PASS admin diagnostics: ${name}`);
}
const owner = randomUUID(),
  foreignOwner = randomUUID(),
  employee = randomUUID(),
  manager = randomUUID(),
  admin = randomUUID();
for (const [id, email] of [
  [owner, "owner-a@example.invalid"],
  [foreignOwner, "owner-b@example.invalid"],
  [employee, "employee@example.invalid"],
  [manager, "manager@example.invalid"],
  [admin, "admin@example.invalid"],
])
  await db.query(
    'insert into auth.users(id,email,email_confirmed_at,last_sign_in_at,encrypted_password,raw_user_meta_data) values($1,$2,now(),now()-interval \'1 hour\',\'NEVER_EXPOSE_PASSWORD_HASH\',\'{"role":"SUPER_ADMIN","reset_token":"NEVER_EXPOSE_RESET_TOKEN"}\')',
    [id, email],
  );
await as(owner);
const company = String(
  await scalar("select create_company('Diagnóstico A QA','salao')"),
);
await as(foreignOwner);
const foreign = String(
  await scalar("select create_company('Diagnóstico B QA','clinica')"),
);
await db.exec("reset role");
await db.query(
  "insert into memberships values($1,$2,'EMPLOYEE'),($1,$3,'MANAGER')",
  [company, employee, manager],
);
await db.query("insert into private.platform_admins values($1)", [admin]);
await db.query("update companies set plan_id='empresarial' where id=$1", [
  company,
]);
await as(owner);
await scalar(
  "insert into customers(company_id,name,phone) values($1,'PRIVATE CUSTOMER QA','11999999999') returning id",
  [company],
);
await scalar(
  "insert into services(company_id,name,duration_minutes,price_cents) values($1,'Serviço QA',30,4500) returning id",
  [company],
);
await scalar(
  "insert into professionals(company_id,name) values($1,'Profissional QA') returning id",
  [company],
);
await scalar(
  "select create_team_invitation($1,'invited@example.invalid','EMPLOYEE')",
  [company],
);
const query = "select admin_company_diagnostics($1)";
await check(
  "anonymous, owner, manager, employee and foreign tenant cannot read diagnostics or forge admin metadata",
  async () => {
    for (const who of [null, owner, foreignOwner, employee, manager]) {
      await as(who);
      await assert.rejects(
        () => db.query(query, [company]),
        who ? /not authorized/ : /permission denied/,
      );
      if (who)
        await assert.rejects(
          () => db.query(query, [randomUUID()]),
          /not authorized/,
        );
    }
  },
);
type Diagnostic = {
  company: Record<string, unknown>;
  owners: {
    email: string;
    confirmed: boolean;
    last_sign_in_at: string | null;
  }[];
  counts: Record<string, number>;
  access: { writable: boolean; reason: string };
};
await check(
  "super admin gets bounded owner/account status and exact tenant counts, never credentials or CRM PII",
  async () => {
    await as(admin);
    const result = (await scalar(query, [company])) as Diagnostic;
    assert.equal(result.company.id, company);
    assert.equal(result.access.writable, true);
    assert.equal(result.access.reason, "trialing");
    assert.deepEqual(result.counts, {
      customers: 1,
      services: 1,
      professionals: 1,
      appointments: 0,
      classes: 0,
      blocks: 0,
      pending_invitations: 1,
    });
    assert.deepEqual(Object.keys(result.owners[0]).sort(), [
      "confirmed",
      "email",
      "last_sign_in_at",
    ]);
    assert.equal(result.owners[0].email, "owner-a@example.invalid");
    assert.equal(result.owners[0].confirmed, true);
    assert.equal(typeof result.owners[0].last_sign_in_at, "string");
    const output = JSON.stringify(result);
    for (const prohibited of [
      owner,
      foreignOwner,
      "owner-b@example.invalid",
      "employee@example.invalid",
      "NEVER_EXPOSE",
      "PRIVATE CUSTOMER QA",
      "11999999999",
      "encrypted_password",
      "raw_user_meta_data",
    ])
      assert.equal(output.includes(prohibited), false);
    assert.equal(await scalar("select count(*) from customers"), 0);
    assert.equal(await scalar(query, [randomUUID()]), null);
    const other = (await scalar(query, [foreign])) as Diagnostic;
    assert.equal(other.owners[0].email, "owner-b@example.invalid");
    assert.equal(other.counts.customers, 0);
  },
);
await check(
  "current confirmation and access state diagnose pending card, expired trial and suspension without changing them",
  async () => {
    for (const [status, reason] of [
      ["pending_card", "pending_card"],
      ["trialing", "trial_expired"],
      ["suspended", "suspended"],
      ["past_due", "past_due"],
      ["canceled", "canceled"],
    ]) {
      await db.exec("reset role");
      await db.query(
        "update companies set status=$2,trial_ends_at=case when $2='pending_card' then null else now()-interval '1 day' end where id=$1",
        [company, status],
      );
      await as(admin);
      const result = (await scalar(query, [company])) as Diagnostic;
      assert.equal(result.access.writable, false);
      assert.equal(result.access.reason, reason);
      assert.equal(
        await scalar("select status from companies where id=$1", [company]),
        status,
      );
    }
    await db.exec("reset role");
    await db.query(
      "update auth.users set email_confirmed_at=null,last_sign_in_at=null where id=$1",
      [owner],
    );
    await as(admin);
    const result = (await scalar(query, [company])) as Diagnostic;
    assert.deepEqual(result.owners, [
      {
        email: "owner-a@example.invalid",
        confirmed: false,
        last_sign_in_at: null,
      },
    ]);
  },
);
await check(
  "owner list is bounded and admin revocation immediately denies subsequent reads",
  async () => {
    await db.exec("reset role");
    for (let i = 0; i < 22; i++) {
      const id = randomUUID();
      await db.query("insert into auth.users(id,email) values($1,$2)", [
        id,
        `extra-${String(i).padStart(2, "0")}@example.invalid`,
      ]);
      await db.query("insert into memberships values($1,$2,'OWNER')", [
        foreign,
        id,
      ]);
    }
    await as(admin);
    assert.equal(
      ((await scalar(query, [foreign])) as Diagnostic).owners.length,
      20,
    );
    await db.exec("reset role");
    await db.query("delete from private.platform_admins where user_id=$1", [
      admin,
    ]);
    await as(admin);
    await assert.rejects(() => db.query(query, [company]), /not authorized/);
  },
);
await db.close();
console.log(
  `${checks} read-only admin diagnostics groups passed; no remote writes or external messages.`,
);
