import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { storageFixture } from "./storage-fixture";

// Disposable PostgreSQL only. This suite never authorizes a card or accesses
// Mercado Pago, Supabase production, real customers, or payment credentials.
const db = new PGlite({ extensions: { btree_gist } });
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
  $$;
  grant usage on schema auth to authenticated,anon;
  grant execute on function auth.uid() to authenticated,anon;
`);
await db.exec(storageFixture);

const migrations = await Promise.all(
  (await readdir("supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map(async (name) => ({
      name,
      sql: await readFile(`supabase/migrations/${name}`, "utf8"),
    })),
);
const cardIndex = migrations.findIndex(({ sql }) =>
  sql.includes("trial_card_required"),
);
assert.ok(
  cardIndex > 0,
  "The versioned card requirement migration must exist after the foundation",
);
for (const migration of migrations.slice(0, cardIndex))
  await db.exec(migration.sql);

const users = {
  legacy: randomUUID(),
  owner: randomUUID(),
  other: randomUUID(),
  admin: randomUUID(),
};
async function scalar<T = unknown>(
  query: string,
  args: unknown[] = [],
): Promise<T> {
  const { rows } = await db.query<Record<string, T>>(query, args);
  return Object.values(rows[0])[0];
}
async function postgres() {
  await db.exec(
    "reset role; select set_config('request.jwt.claim.sub','',false)",
  );
}
async function as(user: string | null) {
  await postgres();
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    user ?? "",
  ]);
  await db.exec(user === null ? "set role anon" : "set role authenticated");
}
for (const user of Object.values(users)) {
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
    [user, `${user}@example.invalid`],
  );
}
await db.query("insert into private.platform_admins(user_id) values($1)", [
  users.admin,
]);
await as(users.legacy);
const legacyCompany = await scalar<string>(
  "select public.create_company('Legacy synthetic salon','salao')",
);
const legacyCustomer = await scalar<string>(
  "insert into public.customers(company_id,name) values($1,'Preserved synthetic customer') returning id",
  [legacyCompany],
);
const legacyBefore = await scalar(
  "select jsonb_build_object('id',id,'name',name,'plan_id',plan_id,'status',status,'trial_ends_at',trial_ends_at,'created_at',created_at) from public.companies where id=$1",
  [legacyCompany],
);
await postgres();
for (const migration of migrations.slice(cardIndex))
  await db.exec(migration.sql);

let passed = 0;
async function check(name: string, run: () => Promise<void>) {
  await run();
  passed++;
  console.log(`PASS card trial: ${name}`);
}

await check(
  "migration preserves existing company, trial expiry, customer and membership",
  async () => {
    await as(users.legacy);
    assert.deepEqual(
      await scalar(
        "select jsonb_build_object('id',id,'name',name,'plan_id',plan_id,'status',status,'trial_ends_at',trial_ends_at,'created_at',created_at) from public.companies where id=$1",
        [legacyCompany],
      ),
      legacyBefore,
    );
    assert.equal(
      await scalar(
        "select trial_card_required from public.companies where id=$1",
        [legacyCompany],
      ),
      false,
    );
    assert.equal(
      await scalar("select private.writable($1)", [legacyCompany]),
      true,
    );
    assert.equal(
      await scalar("select id from public.customers where id=$1", [
        legacyCustomer,
      ]),
      legacyCustomer,
    );
    assert.equal(
      await scalar(
        "select role from public.memberships where company_id=$1 and user_id=$2",
        [legacyCompany, users.legacy],
      ),
      "OWNER",
    );
  },
);

await as(users.owner);
const company = await scalar<string>(
  "select public.create_company('Card pending synthetic salon','salao')",
);
await as(users.other);
const otherCompany = await scalar<string>(
  "select public.create_company('Other pending synthetic salon','salao')",
);
await check(
  "new signup creates a pending company without consuming any trial days",
  async () => {
    await as(users.owner);
    assert.deepEqual(
      await scalar(
        "select jsonb_build_object('status',status,'trial_ends_at',trial_ends_at,'required',trial_card_required,'plan',plan_id) from public.companies where id=$1",
        [company],
      ),
      {
        status: "pending_card",
        trial_ends_at: null,
        required: true,
        plan: "essencial",
      },
    );
    assert.equal(await scalar("select private.writable($1)", [company]), false);
    assert.equal(
      await scalar(
        "select role from public.memberships where company_id=$1 and user_id=$2",
        [company, users.owner],
      ),
      "OWNER",
    );
  },
);

await check(
  "anonymous signup and repeated tenant creation cannot restart or duplicate a trial",
  async () => {
    await as(null);
    await assert.rejects(
      () =>
        scalar(
          "select public.create_company('Anonymous synthetic salon','salao')",
        ),
      /permission denied|authentication required/,
    );
    await as(users.owner);
    await assert.rejects(
      () =>
        scalar(
          "select public.create_company('Duplicate synthetic salon','salao')",
        ),
      /existing owner/,
    );
    assert.equal(
      Number(
        await scalar(
          "select count(*) from public.memberships where user_id=$1 and role='OWNER'",
          [users.owner],
        ),
      ),
      1,
    );
    assert.equal(
      await scalar("select trial_ends_at from public.companies where id=$1", [
        company,
      ]),
      null,
    );
    assert.equal(
      await scalar("select status from public.companies where id=$1", [
        company,
      ]),
      "pending_card",
    );
  },
);

await check(
  "tenant isolation remains in force while awaiting card activation",
  async () => {
    await as(users.owner);
    assert.equal(
      Number(await scalar("select count(*) from public.companies")),
      1,
    );
    assert.equal(
      Number(
        await scalar("select count(*) from public.companies where id=$1", [
          otherCompany,
        ]),
      ),
      0,
    );
    assert.equal(
      Number(
        await scalar("select count(*) from public.customers where id=$1", [
          legacyCustomer,
        ]),
      ),
      0,
    );
    await assert.rejects(
      () =>
        scalar(
          "select public.admin_company($1,'essencial','trialing',now()+interval '7 days')",
          [otherCompany],
        ),
      /not authorized/,
    );
  },
);

await check(
  "browser roles cannot alter card requirement, status, expiry or insert a company directly",
  async () => {
    for (const user of [users.owner, users.admin]) {
      await as(user);
      for (const assignment of [
        "trial_card_required=false",
        "status='trialing'",
        "status='active'",
        "trial_ends_at=now()+interval '7 days'",
      ]) {
        await assert.rejects(
          () =>
            scalar(
              `update public.companies set ${assignment} where id=$1 returning id`,
              [company],
            ),
          /permission denied/,
        );
      }
      await assert.rejects(
        () =>
          scalar(
            "insert into public.companies(name,niche,status) values('Injected company','salao','active') returning id",
          ),
        /permission denied/,
      );
    }
  },
);

await check(
  "unactivated company cannot add business records, invite staff or configure bookings",
  async () => {
    await as(users.owner);
    for (const statement of [
      "insert into public.customers(company_id,name) values($1,'Pending customer') returning id",
      "insert into public.services(company_id,name,duration_minutes,price_cents) values($1,'Pending service',30,5000) returning id",
      "insert into public.professionals(company_id,name) values($1,'Pending professional') returning id",
    ])
      await assert.rejects(
        () => scalar(statement, [company]),
        /row-level security|subscription blocked/,
      );
    await assert.rejects(
      () =>
        scalar(
          "select public.invite_member($1,'staff@example.invalid','EMPLOYEE')",
          [company],
        ),
      /not authorized|subscription blocked/,
    );
    await assert.rejects(
      () =>
        scalar(
          "select public.configure_booking($1,'pending-card-company',true)",
          [company],
        ),
      /not authorized/,
    );
    await assert.rejects(
      () =>
        scalar(
          "select public.book_appointment($1,$2,$3,$4,now()+interval '1 day')",
          [company, randomUUID(), randomUUID(), randomUUID()],
        ),
      /not authorized|subscription blocked/,
    );
    await assert.rejects(
      () =>
        scalar(
          "select public.save_whatsapp_settings($1,true,array[1440],100)",
          [company],
        ),
      /not authorized|subscription blocked/,
    );
  },
);

await check(
  "public booking does not expose pending company even if its page had been configured",
  async () => {
    await postgres();
    await db.query(
      "update public.companies set booking_slug='pending-card-company',booking_enabled=true where id=$1",
      [company],
    );
    await as(null);
    assert.equal(
      await scalar("select public.public_catalog('pending-card-company')"),
      null,
    );
    assert.equal(
      Number(
        await scalar(
          "select count(*) from public.public_slots('pending-card-company',$1,$2,current_date+1)",
          [randomUUID(), randomUUID()],
        ),
      ),
      0,
    );
  },
);

await check(
  "support remains available without granting access or starting a trial",
  async () => {
    await as(users.owner);
    const ticket = await scalar(
      "select public.open_support_ticket($1,$2,'assinatura','Card activation help','Synthetic request for help with trial activation.')",
      [company, randomUUID()],
    );
    assert.ok(ticket);
    assert.equal(
      await scalar("select status from public.companies where id=$1", [
        company,
      ]),
      "pending_card",
    );
    assert.equal(
      await scalar("select trial_ends_at from public.companies where id=$1", [
        company,
      ]),
      null,
    );
  },
);

await check(
  "super admin cannot manually authorize a new trial or invent its expiry",
  async () => {
    await as(users.admin);
    for (const status of [
      "pending_card",
      "suspended",
      "canceled",
      "trialing",
    ]) {
      await assert.rejects(
        () =>
          scalar(
            "select public.admin_company($1,'essencial',$2,now()+interval '7 days')",
            [company, status],
          ),
        /card authorization required/,
      );
    }
    await assert.rejects(
      () =>
        scalar("select public.admin_company($1,'essencial','trialing',null)", [
          company,
        ]),
      /card authorization required/,
    );
    await assert.rejects(
      () =>
        scalar("select public.admin_company($1,'essencial','active',null)", [
          company,
        ]),
      /invalid manual status|card authorization required/,
    );
  },
);

await check(
  "suspending or canceling then restoring a pending company cannot bypass card requirement",
  async () => {
    await as(users.admin);
    for (const status of ["suspended", "canceled", "pending_card"]) {
      await scalar("select public.admin_company($1,'essencial',$2,null)", [
        company,
        status,
      ]);
      await assert.rejects(
        () =>
          scalar(
            "select public.admin_company($1,'essencial','trialing',now()+interval '7 days')",
            [company],
          ),
        /card authorization required/,
      );
      assert.equal(
        await scalar("select trial_ends_at from public.companies where id=$1", [
          company,
        ]),
        null,
      );
      assert.equal(
        await scalar(
          "select trial_card_required from public.companies where id=$1",
          [company],
        ),
        true,
      );
    }
  },
);

await check(
  "database rejects trial activation and invented dates even outside the admin RPC",
  async () => {
    await postgres();
    await assert.rejects(
      () =>
        scalar(
          "update public.companies set status='trialing' where id=$1 returning id",
          [company],
        ),
      /card authorization required/,
    );
    for (const date of [
      "now()+interval '7 days'",
      "now()-interval '1 second'",
      "'infinity'::timestamptz",
    ]) {
      await assert.rejects(
        () =>
          scalar(
            `update public.companies set trial_ends_at=${date} where id=$1 returning id`,
            [company],
          ),
        /card authorization required/,
      );
    }
    const directCompany = await scalar<string>(
      "insert into public.companies(name,niche) values('Default pending synthetic company','salao') returning id",
    );
    assert.deepEqual(
      await scalar(
        "select jsonb_build_object('status',status,'required',trial_card_required,'end',trial_ends_at) from public.companies where id=$1",
        [directCompany],
      ),
      { status: "pending_card", required: true, end: null },
    );
  },
);

await check(
  "database prevents inserting an activated trial and changing the enrollment cohort",
  async () => {
    await postgres();
    for (const status of ["trialing", "active", "suspended"]) {
      await assert.rejects(
        () =>
          scalar(
            "insert into public.companies(name,niche,status) values('Injected activated company','salao',$1) returning id",
            [status],
          ),
        /card authorization required/,
      );
    }
    await assert.rejects(
      () =>
        scalar(
          "insert into public.companies(name,niche,trial_ends_at) values('Injected dated company','salao',now()+interval '7 days') returning id",
        ),
      /card authorization required/,
    );
    for (const [target, required] of [
      [company, false],
      [legacyCompany, true],
    ] as const) {
      await assert.rejects(
        () =>
          scalar(
            "update public.companies set trial_card_required=$2 where id=$1 returning id",
            [target, required],
          ),
        /trial enrollment policy is immutable/,
      );
    }
  },
);

await check(
  "legacy manual management rejects missing or unbounded trial dates",
  async () => {
    await as(users.admin);
    for (const date of [null, "infinity", "-infinity"]) {
      await assert.rejects(
        () =>
          scalar(
            "select public.admin_company($1,'essencial','trialing',$2::timestamptz)",
            [legacyCompany, date],
          ),
        /invalid trial date/,
      );
    }
  },
);

await check(
  "legacy trial management and expiration continue to work without changing new cohort",
  async () => {
    await as(users.admin);
    await scalar(
      "select public.admin_company($1,'essencial','trialing',now()+interval '7 days')",
      [legacyCompany],
    );
    await assert.rejects(
      () =>
        scalar(
          "select public.admin_company($1,'essencial','trialing',now()+interval '31 days')",
          [legacyCompany],
        ),
      /trial extension maximum/,
    );
    await as(users.legacy);
    assert.equal(
      await scalar("select private.writable($1)", [legacyCompany]),
      true,
    );
    await postgres();
    await db.query(
      "update public.companies set trial_ends_at=now()-interval '1 second' where id=$1",
      [legacyCompany],
    );
    await as(users.legacy);
    assert.equal(
      await scalar("select private.writable($1)", [legacyCompany]),
      false,
    );
    assert.equal(
      await scalar("select id from public.customers where id=$1", [
        legacyCustomer,
      ]),
      legacyCustomer,
    );
    await as(users.owner);
    assert.equal(
      await scalar("select status from public.companies where id=$1", [
        company,
      ]),
      "pending_card",
    );
    assert.equal(
      await scalar("select trial_ends_at from public.companies where id=$1", [
        company,
      ]),
      null,
    );
  },
);

await db.close();
console.log(
  `${passed} card-required trial database groups passed; no payment requests or remote writes.`,
);
