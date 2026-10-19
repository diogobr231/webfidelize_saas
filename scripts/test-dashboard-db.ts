import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import type { DashboardData } from "../src/lib/dashboard";

// Disposable PostgreSQL only. Historical fixtures never touch a remote project.
const db = new PGlite({ extensions: { btree_gist } });
await db.exec(`create role anon nologin; create role authenticated nologin; create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
const migrations = (await readdir("supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort();
// This feature's fixture intentionally isolates the existing foundation from unrelated integrations.
for (const name of migrations.filter(
  (name) => name <= "20261018214604_booking_experience.sql",
)) {
  await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
}
const ownerA = "00000000-0000-4000-8000-000000000001";
const ownerB = "00000000-0000-4000-8000-000000000002";
const employee = "00000000-0000-4000-8000-000000000003";
const manager = "00000000-0000-4000-8000-000000000004";
await db.query("insert into auth.users(id) values($1),($2),($3),($4)", [
  ownerA,
  ownerB,
  employee,
  manager,
]);
async function as(user: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
}
async function scalar<T = string>(sql: string, args: unknown[] = []) {
  const result = await db.query<Record<string, T>>(sql, args);
  return Object.values(result.rows[0])[0];
}
let passed = 0;
async function check(label: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`PASS ${label}`);
}
await as(ownerA);
const ca = await scalar(
  "select public.create_company('Dashboard empresa A','salao')",
);
const customerA = await scalar(
  "insert into public.customers(company_id,name) values($1,'Cliente legado A') returning id",
  [ca],
);
await as(ownerB);
const cb = await scalar(
  "select public.create_company('Dashboard empresa B','salao')",
);
const customerB = await scalar(
  "insert into public.customers(company_id,name) values($1,'Cliente legado B') returning id",
  [cb],
);
await db.exec("reset role");
const draft = await readFile(
  "supabase/drafts/executive_dashboard.sql",
  "utf8",
).catch(async () => {
  const migration = migrations.find((name) =>
    name.includes("executive_dashboard"),
  );
  if (!migration) throw new Error("Executive dashboard migration missing");
  return readFile(`supabase/migrations/${migration}`, "utf8");
});
await db.exec(draft);
await db.query(
  "update public.companies set plan_id='profissional' where id=$1",
  [ca],
);
await db.query(
  "insert into public.memberships values($1,$2,'EMPLOYEE'),($1,$3,'MANAGER')",
  [ca, employee, manager],
);
const serviceA = await scalar(
  "insert into public.services(company_id,name,duration_minutes,price_cents) values($1,'Serviço A',30,10000) returning id",
  [ca],
);
const serviceB = await scalar(
  "insert into public.services(company_id,name,duration_minutes,price_cents) values($1,'Serviço B',30,20000) returning id",
  [cb],
);
const employeeProfessional = await scalar(
  "insert into public.professionals(company_id,name,user_id) values($1,'Profissional colaborador',$2) returning id",
  [ca, employee],
);
const ownerProfessional = await scalar(
  "insert into public.professionals(company_id,name,user_id) values($1,'Profissional proprietário',$2) returning id",
  [ca, ownerA],
);
const otherProfessional = await scalar(
  "insert into public.professionals(company_id,name,user_id) values($1,'Profissional empresa B',$2) returning id",
  [cb, ownerB],
);
// Past appointments are test fixtures. Do not loosen production validation.
await db.exec(
  "alter table public.appointments disable trigger validate_appointment",
);
for (const [company, customer, service, professional, start, status] of [
  [
    ca,
    customerA,
    serviceA,
    employeeProfessional,
    "2026-01-10T02:00:00Z",
    "scheduled",
  ],
  [
    ca,
    customerA,
    serviceA,
    employeeProfessional,
    "2026-01-10T03:00:00Z",
    "scheduled",
  ],
  [
    ca,
    customerA,
    serviceA,
    ownerProfessional,
    "2026-01-10T12:00:00Z",
    "completed",
  ],
  [
    ca,
    customerA,
    serviceA,
    ownerProfessional,
    "2026-01-11T02:30:00Z",
    "canceled",
  ],
  [
    ca,
    customerA,
    serviceA,
    ownerProfessional,
    "2026-01-11T03:00:00Z",
    "scheduled",
  ],
  [
    cb,
    customerB,
    serviceB,
    otherProfessional,
    "2026-01-10T12:00:00Z",
    "scheduled",
  ],
]) {
  await db.query(
    "insert into public.appointments(company_id,customer_id,service_id,professional_id,starts_at,ends_at,status) values($1,$2,$3,$4,$5,$5::timestamptz+interval '30 minutes',$6)",
    [company, customer, service, professional, start, status],
  );
}
await db.query(
  `insert into public.appointments(company_id,customer_id,service_id,professional_id,starts_at,ends_at,status)
   select $1,$2,$3,$4,'2026-01-12T12:00:00Z','2026-01-12T12:30:00Z','canceled' from generate_series(1,1501)`,
  [ca, customerA, serviceA, ownerProfessional],
);
await db.exec(
  "alter table public.appointments enable trigger validate_appointment",
);
const dashboard = (company: string, start = "2026-01-10", end = "2026-01-10") =>
  scalar<DashboardData>("select public.executive_dashboard($1,$2,$3)", [
    company,
    start,
    end,
  ]);
await as(ownerA);
await check(
  "owner aggregates only authorized company and São Paulo calendar boundaries",
  async () => {
    const data = await dashboard(ca);
    assert.deepEqual(data.current, {
      appointments: 3,
      scheduled: 1,
      completed: 1,
      canceled: 1,
      attended_customers: 1,
    });
    assert.equal(data.previous.appointments, 1);
    assert.equal(data.customers?.total, 1);
    assert.equal(data.customers?.new, 0);
    assert.equal(data.customers?.without_created_at, 1);
    assert.equal(data.daily.length, 1);
    assert.equal(data.daily[0].day, "2026-01-10");
    assert.equal(data.daily[0].appointments, 3);
    assert.equal(data.financial_available, false);
    assert.equal(JSON.stringify(data).includes("10000"), false);
  },
);
await check("foreign company id is rejected by RPC", async () => {
  await assert.rejects(() => dashboard(cb), /not authorized/);
});
await check(
  "aggregates include more than the Data API 1000-row default",
  async () => {
    const data = await dashboard(ca, "2026-01-12", "2026-01-12");
    assert.equal(data.current.appointments, 1501);
    assert.equal(data.current.canceled, 1501);
    assert.equal(data.daily[0].appointments, 1501);
  },
);
await check(
  "new customer creation date is generated by the backend",
  async () => {
    const created = await scalar<string>(
      "insert into public.customers(company_id,name,created_at) values($1,'Cliente novo data forjada','1900-01-01') returning created_at::text",
      [ca],
    );
    assert.ok(new Date(created).getTime() > Date.parse("2026-01-01"));
    assert.equal((await dashboard(ca)).customers?.without_created_at, 1);
    const today = await scalar<string>(
      "select (now() at time zone 'America/Sao_Paulo')::date::text",
    );
    const current = await dashboard(ca, today, today);
    assert.equal(current.customers?.new, 1);
    assert.equal(current.customers?.total, 2);
    assert.equal(current.daily[0].new_customers, 1);
  },
);
await check(
  "invalid ranges are rejected by the database independently of the UI",
  async () => {
    for (const args of [
      [null, "2026-01-10"],
      ["2026-01-10", null],
      ["2026-01-10", "2026-01-09"],
      ["2026-01-01", "2026-04-01"],
      ["2099-01-01", "2099-01-01"],
      ["1899-12-31", "1900-01-01"],
    ]) {
      await assert.rejects(
        () =>
          scalar("select public.executive_dashboard($1,$2,$3)", [ca, ...args]),
        /invalid dashboard period/,
      );
    }
  },
);
await check(
  "empty periods contain real zero counts and a complete daily series",
  async () => {
    const data = await dashboard(ca, "2026-02-01", "2026-02-07");
    assert.equal(data.current.appointments, 0);
    assert.equal(data.daily.length, 7);
    assert.ok(data.daily.every((day) => day.appointments === 0));
  },
);
await as(employee);
await check(
  "employee sees only assigned appointments and no company customer totals",
  async () => {
    const data = await dashboard(ca);
    assert.equal(data.scope, "personal");
    assert.equal(data.current.appointments, 1);
    assert.equal(data.current.completed, 0);
    assert.equal(data.previous.appointments, 1);
    assert.equal(data.customers, null);
    assert.ok(data.daily.every((day) => day.new_customers === null));
    await assert.rejects(() => dashboard(cb), /not authorized/);
  },
);
await as(manager);
await check("manager has authorized company aggregates", async () => {
  assert.equal((await dashboard(ca)).current.appointments, 3);
});
await db.exec("reset role; set role anon");
await check(
  "anonymous calls are denied even with a known company id",
  async () => {
    await assert.rejects(() => dashboard(ca), /permission denied/);
  },
);
await db.exec("reset role");
await check(
  "dashboard executes as the caller and cannot bypass RLS",
  async () => {
    assert.equal(
      await scalar<boolean>(
        "select prosecdef from pg_proc where proname='executive_dashboard'",
      ),
      false,
    );
  },
);
await db.close();
console.log(`Dashboard: ${passed} database checks passed.`);
