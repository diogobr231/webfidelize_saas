import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { storageFixture } from "./storage-fixture";
// Disposable PostgreSQL WASM. No production data or external database required.
const db = new PGlite({ extensions: { btree_gist } });
await db.exec(
  `create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`,
);
const migrations = await readdir("supabase/migrations").catch(() => []);
await db.exec(storageFixture);
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
async function as(user: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    user ?? "",
  ]);
  await db.exec(user === null ? "set role anon" : "set role authenticated");
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
await as(null);
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
await as(null);
await check(
  "public catalogue exposes no CRM or customer information",
  async () => {
    const cat = await scalar(
      "select public.public_catalog('demo-salao')::text",
    );
    assert.ok(cat.includes("services"));
    assert.equal(JSON.parse(cat).phone, "");
    assert.ok(!cat.includes("customers"));
    assert.ok(!cat.includes("appointments"));
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
await as(null);
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
await as(null);
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
const manage = "select public.manage_appointment($1,$2,$3,$4)";
const profile = "select public.configure_booking_profile($1,$2,$3,$4,$5)";
const profileValues = [
  ca,
  "Agendamento de demonstração",
  "Rua de Teste, 123",
  "11999990099",
  "violet",
];
await as(a);
await check(
  "overdue subscription blocks profile and appointment changes",
  async () => {
    await assert.rejects(
      () => db.query(profile, profileValues),
      /not authorized/,
    );
    await assert.rejects(
      () => db.query(manage, [ca, reservation, "cancel", null]),
      /subscription blocked/,
    );
  },
);
await db.exec("reset role");
await db.query("update public.companies set status='active' where id=$1", [ca]);
await as(a);
await db.query(profile, profileValues);
await check("owner publishes only explicit public profile fields", async () => {
  await as(null);
  const catalog = JSON.parse(
    await scalar("select public.public_catalog('demo-salao')::text"),
  );
  assert.deepEqual(Object.keys(catalog).sort(), [
    "address",
    "description",
    "is_demo",
    "logo_path",
    "name",
    "phone",
    "professionals",
    "services",
    "slug",
    "theme",
  ]);
  assert.equal(catalog.description, profileValues[1]);
  assert.equal(catalog.logo_path, null);
  assert.equal(catalog.address, profileValues[2]);
  assert.equal(catalog.phone, profileValues[3]);
  assert.equal(catalog.theme, "violet");
  assert.ok(!JSON.stringify(catalog).includes("11999990001"));
  assert.ok(!JSON.stringify(catalog).includes("Visitante TESTE"));
});
await check(
  "profile ownership is enforced by RPC and direct-update RLS",
  async () => {
    for (const user of [b, employee, "00000000-0000-4000-8000-000000000004"]) {
      await as(user);
      await assert.rejects(
        () => db.query(profile, profileValues),
        /not authorized/,
      );
      const result = await db.query(
        "update public.companies set booking_phone='11999991111' where id=$1 returning id",
        [ca],
      );
      assert.equal(result.rows.length, 0);
    }
    await as(a);
    assert.equal(
      await scalar("select booking_phone from public.companies where id=$1", [
        ca,
      ]),
      profileValues[3],
    );
  },
);
await check("invalid public profile rolls back every field", async () => {
  for (const invalid of [
    [ca, "x".repeat(241), "Rua", "11999990099", "teal"],
    [ca, "Alteração parcial", "x".repeat(201), "11999990099", "teal"],
    [ca, "Alteração parcial", "Rua", "telefone inválido", "teal"],
    [ca, "Alteração parcial", "Rua", "11999990099", "javascript:alert(1)"],
    [ca, null, "Rua", "11999990099", "teal"],
  ]) {
    await assert.rejects(
      () => db.query(profile, invalid),
      /check constraint|not-null constraint/,
    );
  }
  assert.equal(
    await scalar(
      "select booking_description from public.companies where id=$1",
      [ca],
    ),
    profileValues[1],
  );
});
const managedAppointment = await scalar(
  "select public.book_appointment($1,$2,$3,$4,$5)",
  [ca, customer, service, professional, "2099-01-06T09:00:00-03:00"],
);
const conflictingAppointment = await scalar(
  "select public.book_appointment($1,$2,$3,$4,$5)",
  [ca, customer, service, professional, "2099-01-06T10:00:00-03:00"],
);
const snapshot = async (appointmentId: string) =>
  (
    await db.query(
      "select company_id,customer_id,service_id,professional_id,starts_at,ends_at,status from public.appointments where company_id=$1 and id=$2",
      [ca, appointmentId],
    )
  ).rows[0];
await check("appointment direct UPDATE stays denied to clients", async () => {
  await assert.rejects(
    () =>
      db.query("update public.appointments set status='canceled' where id=$1", [
        managedAppointment,
      ]),
    /permission denied/,
  );
});
await check("foreign tenants cannot manage known appointment IDs", async () => {
  await as(b);
  await assert.rejects(
    () => db.query(manage, [ca, managedAppointment, "cancel", null]),
    /not authorized/,
  );
  await assert.rejects(
    () => db.query(manage, [cb, managedAppointment, "cancel", null]),
    /appointment not found/,
  );
});
await check("employee cannot manage appointments", async () => {
  await as(employee);
  await assert.rejects(
    () => db.query(manage, [ca, managedAppointment, "cancel", null]),
    /not authorized/,
  );
});
await check(
  "anonymous and null-auth callers cannot mutate profile or agenda",
  async () => {
    await as(null);
    await assert.rejects(
      () => db.query(manage, [ca, managedAppointment, "cancel", null]),
      /permission denied/,
    );
    await assert.rejects(
      () =>
        db.query("select private.manage_appointment($1,$2,'cancel')", [
          ca,
          managedAppointment,
        ]),
      /permission denied/,
    );
    await assert.rejects(
      () => db.query(profile, profileValues),
      /permission denied/,
    );
    await as("");
    await assert.rejects(
      () => db.query(manage, [ca, managedAppointment, "cancel", null]),
      /not authorized/,
    );
    await assert.rejects(
      () => db.query(profile, profileValues),
      /not authorized/,
    );
  },
);
await as(a);
await check(
  "appointment management validates action and date input",
  async () => {
    await assert.rejects(
      () => db.query(manage, [ca, managedAppointment, null, null]),
      /invalid action/,
    );
    await assert.rejects(
      () => db.query(manage, [ca, managedAppointment, "activate", null]),
      /invalid action/,
    );
    await assert.rejects(
      () => db.query(manage, [ca, managedAppointment, "reschedule", null]),
      /start required/,
    );
    await assert.rejects(
      () => db.query(manage, [ca, managedAppointment, "cancel", start]),
      /unexpected start/,
    );
  },
);
await check(
  "failed rescheduling keeps original interval and links",
  async () => {
    const before = await snapshot(managedAppointment);
    await assert.rejects(
      () =>
        db.query(manage, [
          ca,
          managedAppointment,
          "reschedule",
          "2099-01-06T10:15:00-03:00",
        ]),
      /exclusion constraint/,
    );
    assert.deepEqual(await snapshot(managedAppointment), before);
    await assert.rejects(
      () =>
        db.query(manage, [
          ca,
          managedAppointment,
          "reschedule",
          "2099-01-06T19:00:00-03:00",
        ]),
      /outside business hours/,
    );
    assert.deepEqual(await snapshot(managedAppointment), before);
    await assert.rejects(
      () =>
        db.query(manage, [
          ca,
          managedAppointment,
          "reschedule",
          "2000-01-03T09:00:00-03:00",
        ]),
      /invalid interval/,
    );
    assert.deepEqual(await snapshot(managedAppointment), before);
  },
);
await db.exec("reset role");
await db.query(
  "update public.services set duration_minutes=45 where company_id=$1 and id=$2",
  [ca, service],
);
await as("00000000-0000-4000-8000-000000000004");
await check(
  "manager reschedules preserving booked duration and all tenant links",
  async () => {
    const before = await snapshot(managedAppointment);
    assert.equal(
      await scalar(manage, [
        ca,
        managedAppointment,
        "reschedule",
        "2099-01-06T11:00:00-03:00",
      ]),
      managedAppointment,
    );
    const after = (await snapshot(managedAppointment)) as Record<
      string,
      unknown
    >;
    for (const field of [
      "company_id",
      "customer_id",
      "service_id",
      "professional_id",
      "status",
    ])
      assert.equal(after[field], (before as Record<string, unknown>)[field]);
    assert.equal(
      new Date(String(after.ends_at)).getTime() -
        new Date(String(after.starts_at)).getTime(),
      30 * 60_000,
    );
  },
);
await as(a);
await check("future appointment cannot be completed", async () => {
  await assert.rejects(
    () => db.query(manage, [ca, managedAppointment, "complete", null]),
    /appointment has not ended/,
  );
});
const receiptSql = "select public.public_booking_receipt($1,$2,$3)::text";
await check(
  "receipt rejects invalid gateway and returns authoritative data without PII",
  async () => {
    await as(null);
    for (const invalid of ["invalid", null])
      await assert.rejects(
        () => db.query(receiptSql, ["demo-salao", request, invalid]),
        /gateway unauthorized/,
      );
    const receipt = JSON.parse(
      await scalar(receiptSql, ["demo-salao", request, "test-only-gateway"]),
    );
    assert.deepEqual(Object.keys(receipt).sort(), [
      "ends_at",
      "id",
      "professional_name",
      "service_name",
      "starts_at",
      "status",
    ]);
    assert.equal(receipt.id, reservation);
    assert.equal(receipt.service_name, "Serviço A teste");
    assert.equal(receipt.professional_name, "Profissional A teste");
    assert.equal(
      new Date(receipt.starts_at).toISOString(),
      new Date(publicStart).toISOString(),
    );
    assert.equal(receipt.status, "scheduled");
    assert.ok(!JSON.stringify(receipt).includes("11999990001"));
    assert.ok(!JSON.stringify(receipt).includes("Visitante TESTE"));
  },
);
await check(
  "replayed booking parameters cannot alter the authoritative receipt",
  async () => {
    const replay = [...args];
    replay[1] = foreignCustomer;
    replay[3] = day + "T11:00:00-03:00";
    replay[4] = "Nome adulterado TESTE";
    replay[5] = "11999998888";
    assert.equal(await scalar(submit, replay), reservation);
    const receipt = JSON.parse(
      await scalar(receiptSql, ["demo-salao", request, "test-only-gateway"]),
    );
    assert.equal(receipt.id, reservation);
    assert.equal(receipt.service_name, "Serviço A teste");
    assert.equal(
      new Date(receipt.starts_at).toISOString(),
      new Date(publicStart).toISOString(),
    );
    assert.ok(!JSON.stringify(receipt).includes("Nome adulterado"));
  },
);
await as(b);
await db.query("select public.configure_booking($1,'demo-outro',true)", [cb]);
await check(
  "receipt rejects cross-company and unknown request lookup",
  async () => {
    await as(null);
    assert.equal(
      await scalar(receiptSql, ["demo-outro", request, "test-only-gateway"]),
      "null",
    );
    assert.equal(
      await scalar(receiptSql, [
        "demo-salao",
        "00000000-0000-4000-8000-000000000099",
        "test-only-gateway",
      ]),
      "null",
    );
  },
);
await as(a);
await check(
  "canceling frees the public slot and receipt follows database status",
  async () => {
    await db.query(manage, [ca, reservation, "cancel", null]);
    const available = await db.query<{ starts_at: Date }>(
      "select * from public.public_slots($1,$2,$3,$4)",
      ["demo-salao", service, professional, day],
    );
    assert.ok(
      available.rows.some(
        (s) =>
          new Date(s.starts_at).toISOString() ===
          new Date(publicStart).toISOString(),
      ),
    );
    const receipt = JSON.parse(
      await scalar(receiptSql, ["demo-salao", request, "test-only-gateway"]),
    );
    assert.equal(receipt.status, "canceled");
    await assert.rejects(
      () => db.query(manage, [ca, reservation, "reschedule", publicStart]),
      /appointment is terminal/,
    );
  },
);
await check(
  "cancellation remains possible after availability is removed",
  async () => {
    await db.query(
      "delete from public.availability where company_id=$1 and professional_id=$2 and weekday=2",
      [ca, professional],
    );
    await db.query(manage, [ca, conflictingAppointment, "cancel", null]);
    assert.equal(
      ((await snapshot(conflictingAppointment)) as Record<string, unknown>)
        .status,
      "canceled",
    );
  },
);
// Construct historical fixtures only inside the disposable test database.
// This models real appointments aging while shifts/service duration change.
await db.exec("reset role");
await db.exec(
  "alter table public.appointments disable trigger validate_appointment",
);
const historical = await scalar(
  "insert into public.appointments(company_id,customer_id,service_id,professional_id,starts_at,ends_at) values($1,$2,$3,$4,'2000-01-04T09:00:00-03:00','2000-01-04T09:30:00-03:00') returning id",
  [ca, customer, service, professional],
);
await db.exec(
  "alter table public.appointments enable trigger validate_appointment",
);
await as(a);
await check(
  "past appointment can complete without its old shift or service duration",
  async () => {
    const before = (await snapshot(historical)) as Record<string, unknown>;
    await db.query(manage, [ca, historical, "complete", null]);
    const after = (await snapshot(historical)) as Record<string, unknown>;
    assert.equal(after.status, "completed");
    for (const field of [
      "company_id",
      "customer_id",
      "service_id",
      "professional_id",
      "starts_at",
      "ends_at",
    ])
      assert.deepEqual(after[field], before[field]);
    await assert.rejects(
      () =>
        db.query(manage, [
          ca,
          historical,
          "reschedule",
          "2099-01-07T09:00:00-03:00",
        ]),
      /appointment is terminal/,
    );
    await assert.rejects(
      () => db.query(manage, [ca, historical, "cancel", null]),
      /appointment is terminal/,
    );
  },
);
await check(
  "disabled and unpaid public pages cannot expose a receipt",
  async () => {
    await db.query("select public.configure_booking($1,'demo-salao',false)", [
      ca,
    ]);
    assert.equal(
      await scalar(receiptSql, ["demo-salao", request, "test-only-gateway"]),
      "null",
    );
    await db.query("select public.configure_booking($1,'demo-salao',true)", [
      ca,
    ]);
    await db.exec("reset role");
    await db.query(
      "update public.companies set status='past_due' where id=$1",
      [ca],
    );
    await as(null);
    assert.equal(
      await scalar(receiptSql, ["demo-salao", request, "test-only-gateway"]),
      "null",
    );
  },
);
await db.close();
console.log(`${passed} PostgreSQL security tests passed (disposable PGlite).`);
