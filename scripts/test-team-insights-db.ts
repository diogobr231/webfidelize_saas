import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { storageFixture } from "./storage-fixture";
import { installLegacyTrialFixtures } from "./legacy-trial-fixture";

// All rows and historical fixtures live only in this disposable PostgreSQL.
const db = new PGlite({ extensions: { btree_gist } });
await db.exec(`create role anon nologin; create role authenticated nologin;
  create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
await db.exec(storageFixture);
for (const name of (await readdir("supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort()) {
  await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
}
await installLegacyTrialFixtures(db);
const users = {
  owner: randomUUID(),
  other: randomUUID(),
  employee: randomUUID(),
  archived: randomUUID(),
  manager: randomUUID(),
  admin: randomUUID(),
  detached: randomUUID(),
};
async function scalar<T = unknown>(
  query: string,
  args: unknown[] = [],
): Promise<T> {
  const { rows } = await db.query<Record<string, T>>(query, args);
  return Object.values(rows[0])[0];
}
async function postgres(user: string | null = null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    user ?? "",
  ]);
}
async function as(user: string | null) {
  await postgres(user);
  await db.exec(user === null ? "set role anon" : "set role authenticated");
}
for (const user of Object.values(users))
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
    [user, `${user}@example.invalid`],
  );
await as(users.owner);
const company = await scalar<string>(
  "select public.create_company('Team insights synthetic A','salao')",
);
await as(users.other);
const otherCompany = await scalar<string>(
  "select public.create_company('Team insights synthetic B','salao')",
);
await postgres();
await db.query("insert into private.platform_admins(user_id) values($1)", [
  users.admin,
]);
await db.query(
  "update public.companies set plan_id='empresarial' where id=$1",
  [company],
);
await db.query(
  "insert into public.memberships(company_id,user_id,role) values($1,$2,'EMPLOYEE'),($1,$3,'EMPLOYEE'),($1,$4,'MANAGER'),($1,$5,'EMPLOYEE')",
  [company, users.employee, users.archived, users.manager, users.detached],
);

async function fixture(c: string, owner: string) {
  await as(owner);
  const customer = await scalar<string>(
    "insert into public.customers(company_id,name,phone) values($1,'Private synthetic customer','11999999999') returning id",
    [c],
  );
  const service = await scalar<string>(
    "insert into public.services(company_id,name,duration_minutes,price_cents) values($1,'Private synthetic service',30,999999) returning id",
    [c],
  );
  return { c, customer, service };
}
const a = await fixture(company, users.owner);
const b = await fixture(otherCompany, users.other);
async function professional(
  name: string,
  user: string | null = null,
  c = company,
  owner = users.owner,
) {
  await postgres(owner);
  return scalar<string>(
    "insert into public.professionals(company_id,name,user_id) values($1,$2,$3) returning id",
    [c, name, user],
  );
}
const employeePro = await professional(
  "Employee synthetic professional",
  users.employee,
);
const ownerPro = await professional(
  "Owner synthetic professional",
  users.owner,
);
const zeroPro = await professional("Zero synthetic professional");
const archivedPro = await professional(
  "Archived synthetic professional",
  users.archived,
);
const archivedEmptyPro = await professional(
  "Archived empty synthetic professional",
);
const detachedPro = await professional(
  "Detached synthetic professional",
  users.detached,
);
const otherPro = await professional(
  "Other private professional",
  users.other,
  otherCompany,
  users.other,
);

// Historical appointment insertion needs only the temporal validator disabled.
// Foreign keys and overlap constraints remain enabled. Production triggers are
// restored before every assertion below.
await postgres();
await db.exec(
  "alter table public.appointments disable trigger validate_appointment",
);
async function appointment(
  pro: string,
  start: string,
  minutes: number,
  status = "scheduled",
  confirmed = false,
  f = a,
) {
  return scalar<string>(
    `insert into public.appointments(company_id,customer_id,service_id,professional_id,starts_at,ends_at,status,attendance_confirmed_at)
    values($1,$2,$3,$4,$5::timestamptz,$5::timestamptz+make_interval(mins=>$6),$7,case when $8 then $5::timestamptz-interval '1 day' else null end) returning id`,
    [f.c, f.customer, f.service, pro, start, minutes, status, confirmed],
  );
}
const before = await appointment(employeePro, "2026-01-10T02:30:00Z", 30);
const first = await appointment(
  employeePro,
  "2026-01-10T03:00:00Z",
  30,
  "scheduled",
  true,
);
await appointment(employeePro, "2026-01-10T14:00:00Z", 60, "completed", true);
const canceled = await appointment(
  employeePro,
  "2026-01-10T16:00:00Z",
  30,
  "canceled",
  true,
);
const last = await appointment(employeePro, "2026-01-11T02:30:00Z", 30);
const after = await appointment(employeePro, "2026-01-11T03:00:00Z", 30);
const ownerAppointment = await appointment(
  ownerPro,
  "2026-01-10T15:00:00Z",
  30,
);
await appointment(archivedPro, "2026-01-10T18:00:00Z", 45, "completed");
const archivedScheduled = await appointment(
  archivedPro,
  "2026-01-09T18:00:00Z",
  30,
);
const detachedAppointment = await appointment(
  detachedPro,
  "2026-01-09T20:00:00Z",
  30,
);
const otherAppointment = await appointment(
  otherPro,
  "2026-01-10T18:00:00Z",
  30,
  "completed",
  true,
  b,
);
const futureStart = await scalar<string>("select now()+interval '2 days'");
const future = await appointment(employeePro, futureStart, 30);
await db.exec(
  "alter table public.appointments enable trigger validate_appointment",
);
await as(users.owner);
await scalar(
  "select public.archive_business_record($1,'professionals',$2,1,true)",
  [company, archivedPro],
);
await scalar(
  "select public.archive_business_record($1,'professionals',$2,1,true)",
  [company, archivedEmptyPro],
);
await scalar("select public.assign_professional_member($1,$2,null,$3,true)", [
  company,
  detachedPro,
  users.detached,
]);

type Counts = {
  total: number;
  scheduled: number;
  completed: number;
  canceled: number;
  confirmed: number;
  booked_minutes: number;
};
type Report = {
  period: { from: string; to: string };
  timezone: string;
  max_days: number;
  professionals: (Counts & {
    professional_id: string;
    name: string;
    archived: boolean;
  })[];
  totals: Counts;
};
const report = (
  from: string | null = "2026-01-10",
  to: string | null = "2026-01-10",
  c = company,
  exportReport = false,
) =>
  scalar<Report>(
    `select public.${exportReport ? "company_team_export" : "company_team_insights"}($1,$2::date,$3::date)`,
    [c, from, to],
  );
const complete = (id: string, c = company) =>
  scalar<string>("select public.complete_my_appointment($1,$2)", [c, id]);
let passed = 0;
async function check(name: string, run: () => Promise<void>) {
  await run();
  passed++;
  console.log(`PASS team insights: ${name}`);
}

await check(
  "published plan benefits are real and never editable by customer roles",
  async () => {
    await as(null);
    const rows = (
      await db.query(
        "select id,team_insights,team_export from public.plans order by id",
      )
    ).rows;
    assert.deepEqual(rows, [
      { id: "empresarial", team_insights: true, team_export: true },
      { id: "essencial", team_insights: false, team_export: false },
      { id: "profissional", team_insights: true, team_export: false },
    ]);
    await as(users.owner);
    await assert.rejects(
      () =>
        scalar(
          "update public.plans set team_export=true where id='essencial' returning id",
        ),
      /permission denied/,
    );
  },
);
await check(
  "owner report uses São Paulo day boundaries and actual appointment states",
  async () => {
    await as(users.owner);
    const result = await report();
    assert.deepEqual(result.period, { from: "2026-01-10", to: "2026-01-10" });
    assert.equal(result.timezone, "America/Sao_Paulo");
    assert.equal(result.max_days, 90);
    assert.deepEqual(result.totals, {
      total: 6,
      scheduled: 3,
      completed: 2,
      canceled: 1,
      confirmed: 2,
      booked_minutes: 195,
    });
    const employee = result.professionals.find(
      (p) => p.professional_id === employeePro,
    )!;
    assert.deepEqual(employee, {
      professional_id: employeePro,
      name: "Employee synthetic professional",
      archived: false,
      total: 4,
      scheduled: 2,
      completed: 1,
      canceled: 1,
      confirmed: 2,
      booked_minutes: 120,
    });
  },
);
await check(
  "active zero rows and archived history are useful without exposing empty archived records",
  async () => {
    const result = await report();
    assert.equal(
      result.professionals.find((p) => p.professional_id === zeroPro)?.total,
      0,
    );
    assert.equal(
      result.professionals.find((p) => p.professional_id === archivedPro)
        ?.archived,
      true,
    );
    assert.equal(
      result.professionals.find((p) => p.professional_id === archivedPro)
        ?.completed,
      1,
    );
    assert.equal(
      result.professionals.some((p) => p.professional_id === archivedEmptyPro),
      false,
    );
    const empty = await report("2025-01-01", "2025-01-01");
    assert.deepEqual(empty.totals, {
      total: 0,
      scheduled: 0,
      completed: 0,
      canceled: 0,
      confirmed: 0,
      booked_minutes: 0,
    });
    assert.equal(
      empty.professionals.some((p) => p.archived),
      false,
    );
  },
);
await check(
  "report contains no customer contacts, prices, appointment identities or foreign company data",
  async () => {
    const result = await report();
    const text = JSON.stringify(result);
    for (const secret of [
      a.customer,
      a.service,
      otherCompany,
      otherPro,
      otherAppointment,
      "Private synthetic customer",
      "11999999999",
      "999999",
      first,
      last,
    ])
      assert.equal(
        text.includes(secret),
        false,
        `Unexpected report data: ${secret}`,
      );
    assert.deepEqual(Object.keys(result).sort(), [
      "max_days",
      "period",
      "professionals",
      "timezone",
      "totals",
    ]);
  },
);
await check(
  "manager can report and export; employees, outsiders and platform-only admin cannot",
  async () => {
    await as(users.manager);
    assert.deepEqual(
      await report(),
      await report("2026-01-10", "2026-01-10", company, true),
    );
    for (const user of [users.employee, users.other, users.admin]) {
      await as(user);
      await assert.rejects(() => report(), /not authorized/);
      await assert.rejects(
        () => report("2026-01-10", "2026-01-10", company, true),
        /not authorized/,
      );
    }
    await as(null);
    await assert.rejects(() => report(), /permission denied/);
    await as(users.owner);
    await assert.rejects(
      () => report("2026-01-10", "2026-01-10", otherCompany),
      /not authorized/,
    );
    await assert.rejects(
      () =>
        scalar(
          "select private.collect_team_insights($1,'2026-01-10','2026-01-10',false)",
          [company],
        ),
      /permission denied/,
    );
  },
);
await check(
  "inclusive period limit and invalid dates are validated on the server",
  async () => {
    await as(users.owner);
    assert.equal((await report("2026-01-01", "2026-03-31")).max_days, 90);
    await assert.rejects(
      () => report("2026-01-01", "2026-04-01"),
      /team report period limit/,
    );
    for (const [from, to] of [
      [null, "2026-01-10"],
      ["2026-01-10", null],
      ["2026-01-11", "2026-01-10"],
      ["-infinity", "2026-01-10"],
      ["2026-01-10", "infinity"],
      ["1899-12-31", "1900-01-01"],
      ["2099-12-31", "2100-01-01"],
    ]) {
      await assert.rejects(
        () => report(from, to),
        /invalid team report period/,
      );
    }
  },
);
await check(
  "upgrades, downgrades and configured plan flags immediately control report and export access",
  async () => {
    await postgres();
    await db.query(
      "update public.companies set plan_id='profissional' where id=$1",
      [company],
    );
    await as(users.owner);
    assert.equal((await report("2026-01-01", "2026-01-31")).max_days, 31);
    await assert.rejects(
      () => report("2026-01-01", "2026-02-01"),
      /team report period limit/,
    );
    await assert.rejects(
      () => report("2026-01-10", "2026-01-10", company, true),
      /plan feature unavailable/,
    );
    await postgres();
    await db.query(
      "update public.companies set plan_id='essencial' where id=$1",
      [company],
    );
    await as(users.owner);
    await assert.rejects(() => report(), /plan feature unavailable/);
    await postgres();
    await db.query(
      "update public.companies set plan_id='empresarial' where id=$1",
      [company],
    );
    await db.exec(
      "update public.plans set team_insights=false where id='empresarial'",
    );
    await as(users.owner);
    await assert.rejects(() => report(), /plan feature unavailable/);
    await assert.rejects(
      () => report("2026-01-10", "2026-01-10", company, true),
      /plan feature unavailable/,
    );
    await postgres();
    await db.exec(
      "update public.plans set team_insights=true where id='empresarial'",
    );
    await as(users.owner);
    assert.equal(
      (await report("2026-01-10", "2026-01-10", company, true)).max_days,
      90,
    );
  },
);
await check(
  "employee completes only their ended appointment, preserving all other fields and confirmation",
  async () => {
    await as(users.employee);
    const previous = await scalar<Record<string, unknown>>(
      "select to_jsonb(a) from public.appointments a where id=$1",
      [first],
    );
    assert.equal(await complete(first), first);
    const updated = await scalar<Record<string, unknown>>(
      "select to_jsonb(a) from public.appointments a where id=$1",
      [first],
    );
    assert.deepEqual(updated, { ...previous, status: "completed" });
    assert.equal(await complete(first), first);
    assert.deepEqual(
      await scalar(
        "select to_jsonb(a) from public.appointments a where id=$1",
        [first],
      ),
      updated,
    );
  },
);
await check(
  "future, canceled, other professional, cross-company and missing appointments are denied",
  async () => {
    await as(users.employee);
    await assert.rejects(() => complete(future), /appointment has not ended/);
    await assert.rejects(() => complete(canceled), /appointment is terminal/);
    for (const id of [ownerAppointment, otherAppointment, randomUUID()])
      await assert.rejects(() => complete(id), /appointment not found/);
    await assert.rejects(
      () => complete(otherAppointment, otherCompany),
      /not authorized/,
    );
  },
);
await check(
  "employee cannot escalate to manager mutations or edit data via direct UPDATE",
  async () => {
    await as(users.employee);
    for (const action of ["complete", "cancel", "reschedule"])
      await assert.rejects(
        () =>
          scalar("select public.manage_appointment($1,$2,$3)", [
            company,
            last,
            action,
          ]),
        /not authorized/,
      );
    for (const assignment of [
      "status='completed'",
      "status='canceled'",
      "attendance_confirmed_at=now()",
      "starts_at=starts_at+interval '1 day'",
      "customer_id=null",
    ])
      await assert.rejects(
        () =>
          scalar(
            `update public.appointments set ${assignment} where id=$1 returning id`,
            [last],
          ),
        /permission denied/,
      );
    for (const user of [users.owner, users.manager, users.admin]) {
      await as(user);
      await assert.rejects(() => complete(last), /not authorized/);
    }
    await as(null);
    await assert.rejects(() => complete(last), /permission denied/);
  },
);
await check(
  "appointment trigger rejects employee field tampering even in a privileged fixture path",
  async () => {
    // Use the database owner with the employee identity to exercise the trigger
    // independently of the separately verified Data API privileges.
    await postgres(users.employee);
    for (const assignment of [
      "status='completed',attendance_confirmed_at=now()",
      "status='completed',customer_id=null",
      "status='canceled'",
      "status='completed',ends_at=ends_at+interval '1 minute'",
    ]) {
      await assert.rejects(
        () =>
          scalar(
            `update public.appointments set ${assignment} where id=$1 returning id`,
            [last],
          ),
        /not authorized/,
      );
    }
    assert.equal(
      await scalar("select status from public.appointments where id=$1", [
        last,
      ]),
      "scheduled",
    );
  },
);
await check(
  "archived or detached professional cannot use an old employee identity",
  async () => {
    await as(users.archived);
    await assert.rejects(
      () => complete(archivedScheduled),
      /appointment not found/,
    );
    await as(users.detached);
    await assert.rejects(
      () => complete(detachedAppointment),
      /appointment not found/,
    );
  },
);
await check(
  "expired or suspended subscription blocks employee completion and leaves data unchanged",
  async () => {
    for (const status of ["trialing", "past_due", "suspended", "canceled"]) {
      await postgres();
      await db.query(
        "update public.companies set status=$2,trial_ends_at=now()-interval '1 second' where id=$1",
        [company, status],
      );
      await as(users.employee);
      await assert.rejects(() => complete(last), /subscription blocked/);
      assert.equal(
        await scalar("select status from public.appointments where id=$1", [
          last,
        ]),
        "scheduled",
      );
    }
    await postgres();
    await db.query(
      "update public.companies set status='trialing',trial_ends_at=now()+interval '7 days' where id=$1",
      [company],
    );
  },
);
await check(
  "owner and manager completion retain their existing permission and historical behavior",
  async () => {
    await as(users.owner);
    assert.equal(
      await scalar("select public.manage_appointment($1,$2,'complete')", [
        company,
        ownerAppointment,
      ]),
      ownerAppointment,
    );
    await as(users.manager);
    assert.equal(
      await scalar("select public.manage_appointment($1,$2,'complete')", [
        company,
        archivedScheduled,
      ]),
      archivedScheduled,
    );
  },
);
await check(
  "membership revocation immediately removes employee completion and manager report access",
  async () => {
    await as(users.owner);
    await scalar("select public.revoke_company_member($1,$2,true)", [
      company,
      users.employee,
    ]);
    await as(users.employee);
    await assert.rejects(() => complete(last), /not authorized/);
    await assert.rejects(() => complete(first), /not authorized/);
    assert.equal(
      Number(
        await scalar(
          "select count(*) from public.appointments where company_id=$1",
          [company],
        ),
      ),
      0,
    );
    await as(users.owner);
    await scalar("select public.revoke_company_member($1,$2,true)", [
      company,
      users.manager,
    ]);
    await as(users.manager);
    await assert.rejects(() => report(), /not authorized/);
    await assert.rejects(
      () => report("2026-01-10", "2026-01-10", company, true),
      /not authorized/,
    );
    await postgres();
    assert.equal(
      await scalar("select status from public.appointments where id=$1", [
        last,
      ]),
      "scheduled",
    );
    assert.equal(
      await scalar("select status from public.appointments where id=$1", [
        before,
      ]),
      "scheduled",
    );
    assert.equal(
      await scalar("select status from public.appointments where id=$1", [
        after,
      ]),
      "scheduled",
    );
  },
);

// Each plan gets its own realistic company, owner and invited employee. In the
// Essencial fixture the owner manages the business without occupying an agenda.
// No test upgrades the plan while retaining an over-capacity roster.
for (const [plan, capacity, maxDays] of [
  ["essencial", 1, 0],
  ["profissional", 3, 31],
  ["empresarial", 10, 90],
] as const) {
  const owner = randomUUID();
  const employee = randomUUID();
  await postgres();
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now())",
    [
      owner,
      `${owner}@example.invalid`,
      employee,
      `${employee}@example.invalid`,
    ],
  );
  await as(owner);
  const target = await scalar<string>(
    "select public.create_company($1,'salao')",
    [`Matrix synthetic ${plan}`],
  );
  await postgres();
  await db.query("update public.companies set plan_id=$2 where id=$1", [
    target,
    plan,
  ]);
  await db.query(
    "insert into public.memberships(company_id,user_id,role) values($1,$2,'EMPLOYEE')",
    [target, employee],
  );
  const records = await fixture(target, owner);
  const visibleCustomer = records.customer;
  const unassignedCustomer = await scalar<string>(
    "insert into public.customers(company_id,name) values($1,'Unassigned private customer') returning id",
    [target],
  );
  const assigned = await professional(
    `Assigned ${plan}`,
    employee,
    target,
    owner,
  );
  await postgres();
  await db.exec(
    "alter table public.appointments disable trigger validate_appointment",
  );
  const employeeAppointment = await appointment(
    assigned,
    "2026-01-10T12:00:00Z",
    30,
    "scheduled",
    false,
    records,
  );
  const managerAppointment = await appointment(
    assigned,
    "2026-01-10T13:00:00Z",
    30,
    "scheduled",
    true,
    records,
  );
  await db.exec(
    "alter table public.appointments enable trigger validate_appointment",
  );

  await check(
    `${plan}: owner keeps CRM, future booking and actual staff capacity`,
    async () => {
      await as(owner);
      assert.equal(
        Number(
          await scalar(
            "select count(*) from public.customers where company_id=$1",
            [target],
          ),
        ),
        2,
      );
      const upcomingMonday = await scalar<string>(
        `select (((now() at time zone 'America/Sao_Paulo')::date + 7 - (extract(isodow from now() at time zone 'America/Sao_Paulo')::int - 1))::timestamp + interval '10 hours') at time zone 'America/Sao_Paulo'`,
      );
      assert.ok(
        await scalar("select public.book_appointment($1,$2,$3,$4,$5)", [
          target,
          visibleCustomer,
          records.service,
          assigned,
          upcomingMonday,
        ]),
      );
      for (let i = 1; i < capacity; i++)
        await scalar(
          "insert into public.professionals(company_id,name) values($1,$2) returning id",
          [target, `Extra synthetic ${i}`],
        );
      await assert.rejects(
        () =>
          scalar(
            "insert into public.professionals(company_id,name) values($1,'Over capacity') returning id",
            [target],
          ),
        /professional limit reached/,
      );
      assert.equal(
        Number(
          await scalar(
            "select count(*) from public.professionals where company_id=$1 and archived_at is null",
            [target],
          ),
        ),
        capacity,
      );
      if (maxDays === 0) {
        await assert.rejects(
          () => report("2026-01-10", "2026-01-10", target),
          /plan feature unavailable/,
        );
      } else {
        const result = await report("2026-01-10", "2026-01-10", target);
        assert.equal(result.max_days, maxDays);
        assert.deepEqual(result.totals, {
          total: 2,
          scheduled: 2,
          completed: 0,
          canceled: 0,
          confirmed: 1,
          booked_minutes: 60,
        });
      }
      if (plan === "empresarial")
        assert.equal(
          (await report("2026-01-10", "2026-01-10", target, true)).totals.total,
          2,
        );
      else
        await assert.rejects(
          () => report("2026-01-10", "2026-01-10", target, true),
          /plan feature unavailable/,
        );
    },
  );

  await check(
    `${plan}: employee only sees assigned customer data and cannot access management or reports`,
    async () => {
      await as(employee);
      assert.equal(
        Number(
          await scalar(
            "select count(*) from public.appointments where company_id=$1",
            [target],
          ),
        ),
        3,
      );
      assert.equal(
        Number(
          await scalar("select count(*) from public.customers where id=$1", [
            visibleCustomer,
          ]),
        ),
        1,
      );
      assert.equal(
        Number(
          await scalar("select count(*) from public.customers where id=$1", [
            unassignedCustomer,
          ]),
        ),
        0,
      );
      assert.equal(
        Number(
          await scalar(
            "select count(*) from public.appointments where company_id=$1",
            [company],
          ),
        ),
        0,
      );
      await assert.rejects(
        () =>
          scalar(
            "insert into public.customers(company_id,name) values($1,'Unauthorized') returning id",
            [target],
          ),
        /row-level security/,
      );
      await assert.rejects(
        () =>
          scalar("select public.manage_appointment($1,$2,'complete')", [
            target,
            employeeAppointment,
          ]),
        /not authorized/,
      );
      await assert.rejects(
        () => report("2026-01-10", "2026-01-10", target),
        /not authorized/,
      );
      await assert.rejects(
        () => report("2026-01-10", "2026-01-10", target, true),
        /not authorized/,
      );
    },
  );

  await check(
    `${plan}: employee completion and owner completion both persist without losing other fields`,
    async () => {
      await as(employee);
      const snapshot = await scalar<Record<string, unknown>>(
        "select to_jsonb(a) from public.appointments a where id=$1",
        [employeeAppointment],
      );
      assert.equal(
        await complete(employeeAppointment, target),
        employeeAppointment,
      );
      assert.equal(
        await complete(employeeAppointment, target),
        employeeAppointment,
      );
      assert.deepEqual(
        await scalar(
          "select to_jsonb(a) from public.appointments a where id=$1",
          [employeeAppointment],
        ),
        { ...snapshot, status: "completed" },
      );
      await as(owner);
      assert.equal(
        await scalar("select public.manage_appointment($1,$2,'complete')", [
          target,
          managerAppointment,
        ]),
        managerAppointment,
      );
      if (maxDays)
        assert.equal(
          (await report("2026-01-10", "2026-01-10", target)).totals.completed,
          2,
        );
      assert.equal(
        Number(
          await scalar(
            "select count(*) from public.appointments where company_id=$1 and status='completed'",
            [target],
          ),
        ),
        2,
      );
    },
  );
}

await db.close();
console.log(
  `${passed} team benefits database groups passed; no remote writes.`,
);
