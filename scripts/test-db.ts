import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
// Disposable PostgreSQL WASM. No production data or external database required.
const db = new PGlite({ extensions: { btree_gist } });
await db.exec(
  `create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`,
);
const migrations = await readdir("supabase/migrations").catch(() => []);
for (const name of migrations.filter((n) => n.endsWith(".sql")).sort())
  await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));

if (!migrations.length) throw new Error("Versioned migrations missing");

const a = "00000000-0000-4000-8000-000000000001",
  b = "00000000-0000-4000-8000-000000000002",
  employee = "00000000-0000-4000-8000-000000000003";
await db.query("insert into auth.users(id) values ($1),($2),($3)", [
  a,
  b,
  employee,
]);
async function as(user: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
}
async function scalar(sql: string, args: unknown[] = []) {
  const r = await db.query<Record<string, unknown>>(sql, args);
  return String(Object.values(r.rows[0])[0]);
}
let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}
await as(a);
const ca = await scalar(
  "select public.create_company('Empresa A teste','salao')",
);
await as(b);
const cb = await scalar(
  "select public.create_company('Empresa B teste','pet-shop')",
);
await check("company isolation: tenant B sees only B", async () => {
  assert.equal(await scalar("select count(*) from public.companies"), "1");
  assert.equal(await scalar("select id from public.companies"), cb);
});
await as(a);
const customer = await scalar(
  "insert into public.customers(company_id,name) values($1,'Cliente A teste') returning id",
  [ca],
);
const service = await scalar(
  "insert into public.services(company_id,name,duration_minutes,price_cents) values($1,'Serviço A teste',30,5000) returning id",
  [ca],
);
const professional = await scalar(
  "insert into public.professionals(company_id,name) values($1,'Profissional A teste') returning id",
  [ca],
);
await check("plan limit enforced by database", async () => {
  await assert.rejects(
    () =>
      db.query(
        "insert into public.professionals(company_id,name) values($1,'Extra teste')",
        [ca],
      ),
    /limit/,
  );
});
await check("cross-company insert denied", async () => {
  await assert.rejects(
    () =>
      db.query(
        "insert into public.customers(company_id,name) values($1,'Ataque teste')",
        [cb],
      ),
    /row-level security/,
  );
});
await check("client cannot activate subscription", async () => {
  await assert.rejects(
    () =>
      db.query("update public.companies set status='active' where id=$1", [ca]),
    /permission denied/,
  );
});
await check("client cannot self-promote", async () => {
  await assert.rejects(
    () =>
      db.query("insert into public.memberships values($1,$2,'OWNER')", [cb, a]),
    /permission denied/,
  );
});
await check("one trial company per owner", async () => {
  await assert.rejects(
    () => db.query("select public.create_company('Trial extra','salao')"),
    /existing owner/,
  );
});
// Monday in far future, fixed São Paulo offset, safely beyond test execution date.
const start = "2099-01-05T10:00:00-03:00";
await db.query("select public.book_appointment($1,$2,$3,$4,$5)", [
  ca,
  customer,
  service,
  professional,
  start,
]);
await check(
  "overlapping appointment denied by PostgreSQL exclusion",
  async () => {
    await assert.rejects(
      () =>
        db.query("select public.book_appointment($1,$2,$3,$4,$5)", [
          ca,
          customer,
          service,
          professional,
          "2099-01-05T10:15:00-03:00",
        ]),
      /exclusion constraint/,
    );
  },
);
await check("adjacent appointments allowed", async () => {
  await db.query("select public.book_appointment($1,$2,$3,$4,$5)", [
    ca,
    customer,
    service,
    professional,
    "2099-01-05T10:30:00-03:00",
  ]);
});
await check("outside availability denied", async () => {
  await assert.rejects(
    () =>
      db.query("select public.book_appointment($1,$2,$3,$4,$5)", [
        ca,
        customer,
        service,
        professional,
        "2099-01-05T19:00:00-03:00",
      ]),
    /outside business hours/,
  );
});
await as(b);
await check("customer and schedule isolation", async () => {
  assert.equal(await scalar("select count(*) from public.customers"), "0");
  assert.equal(await scalar("select count(*) from public.appointments"), "0");
});
await check("cross-company scheduling denied", async () => {
  await assert.rejects(
    () =>
      db.query("select public.book_appointment($1,$2,$3,$4,$5)", [
        ca,
        customer,
        service,
        professional,
        start,
      ]),
    /not authorized/,
  );
});
const foreignCustomer = await scalar(
  "insert into public.customers(company_id,name) values($1,'Cliente B teste') returning id",
  [cb],
);
await as(a);
await check("composite foreign key rejects foreign customer", async () => {
  await assert.rejects(
    () =>
      db.query("select public.book_appointment($1,$2,$3,$4,$5)", [
        ca,
        foreignCustomer,
        service,
        professional,
        "2099-01-05T11:00:00-03:00",
      ]),
    /foreign key/,
  );
});
await db.exec("reset role");
await db.query("insert into public.memberships values($1,$2,'EMPLOYEE')", [
  ca,
  employee,
]);
await as(employee);
await check(
  "employee cannot create customers or see unrelated customers",
  async () => {
    assert.equal(await scalar("select count(*) from public.customers"), "0");
    await assert.rejects(
      () =>
        db.query(
          "insert into public.customers(company_id,name) values($1,'Proibido')",
          [ca],
        ),
      /row-level security/,
    );
  },
);
await check("employee cannot book appointments", async () => {
  await assert.rejects(
    () =>
      db.query("select public.book_appointment($1,$2,$3,$4,$5)", [
        ca,
        customer,
        service,
        professional,
        "2099-01-05T12:00:00-03:00",
      ]),
    /not authorized/,
  );
});
await db.exec("reset role");
await db.query(
  "update public.companies set trial_ends_at=now()-interval '1 second' where id=$1",
  [ca],
);
await as(a);
await check("expired trial blocks direct database writes", async () => {
  await assert.rejects(
    () =>
      db.query(
        "insert into public.customers(company_id,name) values($1,'Expirado')",
        [ca],
      ),
    /row-level security/,
  );
});
await check("expired company remains readable", async () => {
  assert.equal(await scalar("select count(*) from public.customers"), "1");
});
await db.exec("reset role; set role anon");
await check("anonymous has no customer access or privileged RPC", async () => {
  await assert.rejects(
    () => db.query("select * from public.customers"),
    /permission denied/,
  );
  await assert.rejects(
    () => db.query("select public.create_company('Anônimo','salao')"),
    /permission denied/,
  );
});
await db.exec("reset role");
await db.query(
  "insert into auth.users(id,email,email_confirmed_at) values('00000000-0000-4000-8000-000000000004','invite@example.invalid',now())",
);
await db.query(
  "update public.companies set status='active',plan_id='profissional' where id=$1",
  [ca],
);
await as(a);
const token = await scalar(
  "select public.invite_member($1,'invite@example.invalid','MANAGER')",
  [ca],
);
await check("invitation cannot grant OWNER", async () => {
  await assert.rejects(
    () =>
      db.query(
        "select public.invite_member($1,'invite@example.invalid','OWNER')",
        [ca],
      ),
    /invalid invitation/,
  );
});
await as(b);
await check(
  "foreign tenant cannot issue invitation or accept another email",
  async () => {
    await assert.rejects(
      () =>
        db.query(
          "select public.invite_member($1,'invite@example.invalid','EMPLOYEE')",
          [ca],
        ),
      /not authorized/,
    );
    await assert.rejects(
      () => db.query("select public.accept_invitation($1)", [token]),
      /invalid invitation/,
    );
  },
);
await as("00000000-0000-4000-8000-000000000004");
await check("matching verified email can accept invitation", async () => {
  assert.equal(
    await scalar("select public.accept_invitation($1)", [token]),
    ca,
  );
});
await check("invitation is single-use", async () => {
  await assert.rejects(
    () => db.query("select public.accept_invitation($1)", [token]),
    /invalid invitation/,
  );
});
await check(
  "manager cannot invite or invoke super admin function",
  async () => {
    await assert.rejects(
      () =>
        db.query(
          "select public.invite_member($1,'another@example.invalid','EMPLOYEE')",
          [ca],
        ),
      /not authorized/,
    );
    await assert.rejects(
      () =>
        db.query(
          "select public.admin_company($1,'essencial','trialing',now())",
          [ca],
        ),
      /not authorized/,
    );
  },
);
await db.exec("reset role");
await db.query(
  "insert into private.admin_bootstrap values('bootstrap@example.invalid')",
);
await db.query(
  "insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000005','bootstrap@example.invalid')",
);
await as("00000000-0000-4000-8000-000000000005");
await check("bootstrap never elevates unconfirmed email", async () => {
  assert.equal(await scalar("select public.is_super_admin()"), "false");
});
await db.exec("reset role");
await db.query(
  "update auth.users set email_confirmed_at=now() where id='00000000-0000-4000-8000-000000000005'",
);
await as("00000000-0000-4000-8000-000000000005");
await check("one-time verified bootstrap grants admin", async () => {
  assert.equal(await scalar("select public.is_super_admin()"), "true");
});
await db.exec("reset role");
await check("bootstrap address consumed and cannot be reused", async () => {
  assert.equal(
    await scalar("select count(*) from private.admin_bootstrap"),
    "0",
  );
});
await db.exec("reset role");
await db.query(
  "insert into private.booking_gateway values(true,encode(sha256(convert_to('test-only-gateway','UTF8')),'hex'))",
);
await as(a);
await db.query("select public.configure_booking($1,'demo-salao',true)", [ca]);
await check("foreign tenant cannot edit public booking settings", async () => {
  await as(b);
  await assert.rejects(
    () => db.query("select public.configure_booking($1,'hijacked',true)", [ca]),
    /not authorized/,
  );
});
await as(a);
await db.query(
  "delete from public.availability where company_id=$1 and weekday=1",
  [ca],
);
await db.query(
  "insert into public.availability(company_id,professional_id,weekday,start_minute,end_minute) values($1,$2,480,480,600)".replace(
    "480,480",
    "1,480",
  ),
  [ca, professional],
);
await db.query(
  "insert into public.availability(company_id,professional_id,weekday,start_minute,end_minute) values($1,$2,1,660,720)",
  [ca, professional],
);
await check("overlapping shifts rejected", async () => {
  await assert.rejects(
    () =>
      db.query(
        "insert into public.availability(company_id,professional_id,weekday,start_minute,end_minute) values($1,$2,1,500,620)",
        [ca, professional],
      ),
    /exclusion constraint/,
  );
});
await as(employee);
await check("employee cannot change availability", async () => {
  await assert.rejects(
    () =>
      db.query(
        "insert into public.availability(company_id,professional_id,weekday,start_minute,end_minute) values($1,$2,7,480,600)",
        [ca, professional],
      ),
    /row-level security|row level security/,
  );
});
await db.exec("reset role; set role anon");
await check(
  "public catalogue exposes no CRM or customer information",
  async () => {
    const cat = await scalar(
      "select public.public_catalog('demo-salao')::text",
    );
    assert.ok(cat.includes("services"));
    assert.ok(!cat.includes("phone"));
    await assert.rejects(
      () => db.query("select * from public.customers"),
      /permission denied/,
    );
  },
);
const nextMonday = new Date();
nextMonday.setUTCDate(
  nextMonday.getUTCDate() + ((8 - nextMonday.getUTCDay()) % 7 || 7),
);
const day = nextMonday.toISOString().slice(0, 10);
const slots = await db.query<{ starts_at: Date }>(
  "select * from public.public_slots($1,$2,$3,$4)",
  ["demo-salao", service, professional, day],
);
await check(
  "public slots reflect configured shifts and lunch break",
  async () => {
    assert.ok(slots.rows.length > 0);
    assert.ok(
      !slots.rows.some((s) => new Date(s.starts_at).getUTCHours() === 13),
    );
  },
);
const publicStart = day + "T08:30:00-03:00";
const request = "00000000-0000-4000-8000-000000000077";
const args = [
  "demo-salao",
  service,
  professional,
  publicStart,
  "Visitante TESTE",
  "11999990001",
  request,
  "test-only-gateway",
  "a".repeat(64),
];
const submit =
  "select public.submit_public_booking($1,$2,$3,$4,$5,$6,$7,$8,$9)";
await check(
  "direct anonymous booking without gateway credential denied",
  async () => {
    const invalid = [...args];
    invalid[7] = "invalid";
    await assert.rejects(
      () => db.query(submit, invalid),
      /gateway unauthorized/,
    );
  },
);
const reservation = await scalar(submit, args);
await check("retry is idempotent and produces one appointment", async () => {
  assert.equal(await scalar(submit, args), reservation);
});
await check("competing reservation cannot take occupied slot", async () => {
  const duplicate = [...args];
  duplicate[6] = "00000000-0000-4000-8000-000000000078";
  await assert.rejects(() => db.query(submit, duplicate), /slot unavailable/);
});
await check("forged service from another company denied", async () => {
  const invalid = [...args];
  invalid[1] = foreignCustomer;
  invalid[6] = "00000000-0000-4000-8000-000000000079";
  await assert.rejects(() => db.query(submit, invalid), /slot unavailable/);
});
await check(
  "public callers cannot read shifts or private booking requests",
  async () => {
    await assert.rejects(
      () => db.query("select * from public.availability"),
      /permission denied/,
    );
    await assert.rejects(
      () => db.query("select * from private.booking_requests"),
      /permission denied/,
    );
  },
);
await db.exec("reset role");
await db.query(
  "insert into private.booking_limits values($1,date_trunc('hour',now()),10) on conflict(key,bucket) do update set hits=10",
  ["ip:" + "a".repeat(64)],
);
await db.exec("set role anon");
await check("server-enforced IP quota blocks excess bookings", async () => {
  const limited = [...args];
  limited[3] = day + "T08:00:00-03:00";
  limited[6] = "00000000-0000-4000-8000-000000000080";
  await assert.rejects(() => db.query(submit, limited), /booking rate limit/);
});
await db.exec("reset role");
await db.query("update public.companies set status='past_due' where id=$1", [
  ca,
]);
await db.exec("set role anon");
await check(
  "unpaid company has no public catalogue or bookable slots",
  async () => {
    assert.equal(
      await scalar("select public.public_catalog('demo-salao')"),
      "null",
    );
    assert.equal(
      (
        await db.query("select * from public.public_slots($1,$2,$3,$4)", [
          "demo-salao",
          service,
          professional,
          day,
        ])
      ).rows.length,
      0,
    );
  },
);
await db.close();
console.log(`${passed} PostgreSQL security tests passed (disposable PGlite).`);
