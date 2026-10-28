import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { storageFixture } from "./storage-fixture";
import { installLegacyTrialFixtures } from "./legacy-trial-fixture";

// All data and credentials are synthetic in a disposable local PostgreSQL engine.
// This script has no Supabase/Meta network client and never sends a message.
process.on("uncaughtException", (error) => {
  console.error(error.message);
  process.exit(1);
});
const db = new PGlite({ extensions: { btree_gist } });
await db.exec(`create role anon nologin; create role authenticated nologin;
  create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
await db.exec(storageFixture);
for (const name of (await readdir("supabase/migrations"))
  .filter((n) => n.endsWith(".sql"))
  .sort())
  await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
await installLegacyTrialFixtures(db);
const sql = (query: string, args: unknown[] = []) =>
  db.query<Record<string, unknown>>(query, args);
async function value<T = unknown>(
  query: string,
  args: unknown[] = [],
): Promise<T> {
  return Object.values(
    (await db.query<Record<string, T>>(query, args)).rows[0],
  )[0];
}
async function postgres() {
  await db.exec(
    "reset role; select set_config('request.jwt.claim.sub','',false)",
  );
}
async function as(user: string) {
  await postgres();
  await sql("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
}
async function anon() {
  await postgres();
  await db.exec("set role anon");
}
const owner = randomUUID(),
  other = randomUUID(),
  manager = randomUUID(),
  admin = randomUUID();
for (const id of [owner, other, manager, admin])
  await sql("insert into auth.users(id) values($1)", [id]);
await as(owner);
const company = await value<string>(
  "select public.create_company('Staff synthetic A','salao')",
);
await as(other);
const otherCompany = await value<string>(
  "select public.create_company('Staff synthetic B','clinica')",
);
await postgres();
await sql("insert into public.memberships values($1,$2,'MANAGER')", [
  company,
  manager,
]);
await sql("insert into private.platform_admins values($1)", [admin]);
await db.exec("update public.plans set staff_limit=1000");
const secret = "staff-db-tests-only-gateway-secret-123456789";
await sql("update private.whatsapp_gateway_config set secret_hash=$1", [
  createHash("sha256").update(secret).digest("hex"),
]);
const today = await value<string>(
  "select to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM-DD')",
);
const nowTime = await value<string>(
  "select to_char(now() at time zone 'America/Sao_Paulo','HH24:MI')",
);
const tomorrow = await value<string>(
  "select (((now() at time zone 'America/Sao_Paulo')::date+1)+time '12:00') at time zone 'America/Sao_Paulo'",
);
type Job = {
  job_id: string;
  company_id: string;
  kind: string;
  professional_id: string;
  recipient: string;
  local_date: string;
  part_index: number;
  part_count: number;
  appointments: {
    appointment_id: string;
    starts_at: string;
    customer_name: string;
    service_name: string;
  }[];
};
const settings = (daily = false, fresh = true, time = nowTime, c = company) =>
  value("select public.save_whatsapp_staff_settings($1,$2,$3,$4)", [
    c,
    daily,
    time,
    fresh,
  ]);
const prefs = (
  phone: string | null = "11990000001",
  enabled = true,
  c = company,
) =>
  value("select public.save_my_whatsapp_staff_preferences($1,$2,$3)", [
    c,
    phone,
    enabled,
  ]);
const mine = (c = company) =>
  value<{
    phone: string | null;
    enabled: boolean;
    professional_id: string | null;
  }>("select public.get_my_whatsapp_staff_preferences($1)", [c]);
const claim = (
  companies = [company],
  batch = 100,
  credential: string | null = secret,
) =>
  value<Job[]>(
    "select public.claim_whatsapp_staff_notifications($1,$2::uuid[],$3)",
    [credential, companies, batch],
  );
const prepare = (job: string) =>
  value<Job | null>(
    "select public.prepare_whatsapp_staff_notification($1,$2)",
    [secret, job],
  );
const finish = (
  job: string,
  status = "accepted",
  message: string | null = `wamid.${randomUUID()}`,
  error: string | null = null,
) =>
  value<boolean>(
    "select public.finish_whatsapp_staff_notification($1,$2,$3,$4,$5)",
    [secret, job, status, message, error],
  );
const receipt = (job: string, message: string, status: string, c = company) =>
  value<boolean>(
    "select public.whatsapp_staff_delivery_event($1,$2,$3,$4,$5,$6)",
    [
      secret,
      c,
      job,
      message,
      status,
      status === "failed" ? "delivery_failed" : null,
    ],
  );
const usage = () =>
  value<{ consumed: number; effective_limit: number }>(
    "select public.whatsapp_usage($1)",
    [company],
  );
async function state(job: string) {
  await postgres();
  return value<string>(
    "select status from public.whatsapp_staff_notifications where id=$1",
    [job],
  );
}
async function clearQueue() {
  await postgres();
  await db.exec(
    "update public.whatsapp_staff_notifications set status='canceled' where status in ('queued','claimed')",
  );
}
async function fixture(allow = true, c = company) {
  await postgres();
  const user = randomUUID();
  await sql("insert into auth.users(id) values($1)", [user]);
  await sql("insert into public.memberships values($1,$2,'EMPLOYEE')", [
    c,
    user,
  ]);
  await as(c === company ? owner : other);
  const customer = await value<string>(
    "insert into public.customers(company_id,name,phone) values($1,'Gabriela sintética','11990000002') returning id",
    [c],
  );
  const professional = await value<string>(
    "insert into public.professionals(company_id,name) values($1,'Daniela sintética') returning id",
    [c],
  );
  const service = await value<string>(
    "insert into public.services(company_id,name,duration_minutes,price_cents) values($1,'Manicure sintética',30,5000) returning id",
    [c],
  );
  await value("select public.assign_professional_member($1,$2,$3,null,false)", [
    c,
    professional,
    user,
  ]);
  await sql(
    "delete from public.availability where company_id=$1 and professional_id=$2",
    [c, professional],
  );
  await sql(
    "insert into public.availability(company_id,professional_id,weekday,start_minute,end_minute) select $1,$2,d,0,1440 from generate_series(1,7) d",
    [c, professional],
  );
  if (allow) {
    await as(user);
    await prefs("11990000001", true, c);
  }
  return { user, customer, professional, service, company: c };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function book(f: Fixture, offset = 0) {
  await as(f.company === company ? owner : other);
  return value<string>(
    "select public.book_appointment($1,$2,$3,$4,$5::timestamptz+make_interval(mins=>$6))",
    [f.company, f.customer, f.service, f.professional, tomorrow, offset],
  );
}
async function dailyFixture(f: Fixture, count = 5) {
  await postgres();
  // Seed historical dates without testing the public booking guard here. All
  // actual permission tests below run as authenticated/anon roles.
  await db.exec("set session_replication_role=replica");
  const ids: string[] = [];
  for (let i = 0; i < count; i++)
    ids.push(
      await value<string>(
        "insert into public.appointments(company_id,customer_id,service_id,professional_id,starts_at,ends_at) values($1,$2,$3,$4,($5::date+time '08:00'+make_interval(mins=>$6)) at time zone 'America/Sao_Paulo',($5::date+time '08:30'+make_interval(mins=>$6)) at time zone 'America/Sao_Paulo') returning id",
        [f.company, f.customer, f.service, f.professional, today, i * 30],
      ),
    );
  await db.exec("set session_replication_role=origin");
  return ids;
}
let passed = 0;
async function check(name: string, run: () => Promise<void>) {
  await clearQueue();
  await run();
  passed++;
  console.log(`PASS staff notifications: ${name}`);
}
await check(
  "settings are owner/manager only; limits remain closed and time is strict",
  async () => {
    await as(owner);
    await settings();
    assert.equal((await usage()).effective_limit, 0);
    for (const time of ["8:00", "24:00", "08:60", "08:00:00", "now"])
      await assert.rejects(
        () => settings(true, true, time),
        /invalid staff whatsapp settings/,
      );
    await as(manager);
    await settings();
    await as(other);
    await assert.rejects(() => settings(), /not authorized/);
    await as(admin);
    await value("select public.admin_set_whatsapp_limit($1,1000)", [company]);
    await value("select public.admin_set_whatsapp_limit($1,1000)", [
      otherCompany,
    ]);
    await as(owner);
    await value(
      "select public.save_whatsapp_settings($1,false,array[60],1000)",
      [company],
    );
    await anon();
    await assert.rejects(() => settings(), /permission denied/);
  },
);
await check(
  "personal opt-in is self-only, linked and tenant-scoped",
  async () => {
    const f = await fixture(false);
    await as(f.user);
    assert.equal((await mine()).enabled, false);
    await assert.rejects(() => settings(), /not authorized/);
    await assert.rejects(() => prefs("invalid"), /invalid whatsapp phone/);
    await assert.rejects(() => prefs("+14155552671"), /invalid whatsapp phone/);
    await prefs();
    assert.equal((await mine()).phone, "5511990000001");
    await as(owner);
    assert.equal((await mine()).phone, null);
    await assert.rejects(() => prefs(), /professional unavailable/);
    await as(other);
    await assert.rejects(() => mine(), /not authorized/);
    await as(f.user);
    await assert.rejects(() => mine(otherCompany), /not authorized/);
    await assert.rejects(
      () => sql("select * from private.whatsapp_staff_preferences"),
      /permission denied/,
    );
  },
);
await check(
  "worker capabilities are unavailable without server gateway",
  async () => {
    await anon();
    await assert.rejects(
      () => claim([company], 25, null),
      /gateway unauthorized/,
    );
    await assert.rejects(() => claim([], 25), /invalid whatsapp batch/);
    await assert.rejects(() => claim([company], 0), /invalid whatsapp batch/);
    await assert.rejects(
      () => sql("select private.whatsapp_staff_job_data($1)", [randomUUID()]),
      /permission denied/,
    );
  },
);
await check(
  "new event captures consent only at creation; no retroactive alerts",
  async () => {
    const f = await fixture(false);
    const old = await book(f);
    await as(f.user);
    await prefs();
    await anon();
    assert.equal(
      (await claim()).filter((j) =>
        j.appointments.some((a) => a.appointment_id === old),
      ).length,
      0,
    );
    const appointment = await book(f, 60);
    await anon();
    const [job] = (await claim()).filter((j) =>
      j.appointments.some((a) => a.appointment_id === appointment),
    );
    assert.ok(job);
    assert.equal(job.kind, "new_appointment");
    assert.equal(job.recipient, "5511990000001");
    assert.equal(job.appointments.length, 1);
    assert.ok(await prepare(job.job_id));
    assert.ok(await finish(job.job_id));
  },
);
await check(
  "an empty daily run is not replayed when appointments arrive later",
  async () => {
    const f = await fixture();
    await as(owner);
    await settings(true, true);
    await anon();
    assert.equal(
      (await claim()).filter((j) => j.professional_id === f.professional)
        .length,
      0,
    );
    await postgres();
    assert.equal(
      Number(
        await value(
          "select count(*) from private.whatsapp_staff_daily_runs where company_id=$1 and professional_id=$2 and local_date=$3",
          [company, f.professional, today],
        ),
      ),
      1,
    );
    // Local-day additions are seeded independently of wall-clock time so this
    // regression also runs at 23:59. The actual INSERT trigger below queues the
    // new future appointment. Neither can re-open the already checked daily run.
    await dailyFixture(f, 1);
    const appointment = await book(f);
    await anon();
    const jobs = (await claim()).filter(
      (j) => j.professional_id === f.professional,
    );
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].kind, "new_appointment");
    assert.equal(jobs[0].appointments[0].appointment_id, appointment);
  },
);
await check(
  "daily pages contain every same-company appointment without truncation",
  async () => {
    const f = await fixture();
    const ids = await dailyFixture(f, 7);
    await as(owner);
    await settings(true, false);
    await anon();
    const first = await claim([company], 1);
    assert.equal(first.length, 1);
    const rest = await claim();
    const jobs = [...first, ...rest].filter(
      (j) => j.professional_id === f.professional,
    );
    assert.equal(jobs.length, 4);
    assert.deepEqual(
      jobs.flatMap((j) => j.appointments.map((a) => a.appointment_id)).sort(),
      ids.sort(),
    );
    assert.ok(
      jobs.every(
        (j) =>
          j.appointments.length <= 2 &&
          j.part_count === 4 &&
          j.local_date === today,
      ),
    );
    assert.deepEqual(jobs.map((j) => j.part_index).sort(), [1, 2, 3, 4]);
    for (const job of jobs) {
      assert.ok(await prepare(job.job_id));
      await finish(job.job_id);
    }
    assert.equal(
      (await claim()).filter((j) => j.professional_id === f.professional)
        .length,
      0,
    );
  },
);
await check(
  "daily selection uses Sao Paulo calendar, excludes canceled and other dates",
  async () => {
    const f = await fixture();
    const ids = await dailyFixture(f, 3);
    await postgres();
    await sql("update public.appointments set status='canceled' where id=$1", [
      ids[1],
    ]);
    await db.exec("set session_replication_role=replica");
    await sql(
      "update public.appointments set starts_at=($2::date+interval '1 day 2 hours') at time zone 'UTC',ends_at=($2::date+interval '1 day 2 hours 30 minutes') at time zone 'UTC' where id=$1",
      [ids[2], today],
    );
    await db.exec("set session_replication_role=origin");
    await book(f);
    await as(owner);
    await settings(true, false);
    await anon();
    const jobs = (await claim()).filter(
      (j) => j.professional_id === f.professional,
    );
    assert.deepEqual(
      jobs.flatMap((j) => j.appointments.map((a) => a.appointment_id)).sort(),
      [ids[0], ids[2]].sort(),
    );
  },
);
await check(
  "daily dispatcher does not send outside configured local one-hour window",
  async () => {
    const f = await fixture();
    await dailyFixture(f);
    await postgres();
    const off = await value<string>(
      "select to_char((now() at time zone 'America/Sao_Paulo')+interval '2 hours','HH24:MI')",
    );
    await as(owner);
    await settings(true, false, off);
    await anon();
    assert.equal(
      (await claim()).filter((j) => j.professional_id === f.professional)
        .length,
      0,
    );
    await as(owner);
    await settings(true, false);
    await anon();
    assert.ok(
      (await claim()).some((j) => j.professional_id === f.professional),
    );
  },
);
await check(
  "claim and reservation never duplicate under overlapping worker calls",
  async () => {
    const f = await fixture();
    await as(owner);
    await settings(false, true);
    const id = await book(f);
    await anon();
    const jobs = (await Promise.all([claim(), claim(), claim()]))
      .flat()
      .filter((j) => j.appointments.some((a) => a.appointment_id === id));
    assert.equal(jobs.length, 1);
    const sends = await Promise.all([
      prepare(jobs[0].job_id),
      prepare(jobs[0].job_id),
    ]);
    assert.equal(sends.filter(Boolean).length, 1);
    await finish(jobs[0].job_id, "unknown", null, "network_unknown");
    assert.equal(await prepare(jobs[0].job_id), null);
  },
);
await check(
  "revocation or phone change after claim blocks dispatch",
  async () => {
    for (const action of ["revoke", "phone"]) {
      const f = await fixture();
      await book(f);
      await anon();
      const [job] = (await claim()).filter(
        (j) => j.professional_id === f.professional,
      );
      await as(f.user);
      await prefs(
        action === "phone" ? "11990000003" : null,
        action === "phone",
      );
      await anon();
      assert.equal(await prepare(job.job_id), null);
      assert.equal(await state(job.job_id), "canceled");
    }
  },
);
await check(
  "revoked/unlinked professional cannot regain consent by re-linking",
  async () => {
    const f = await fixture();
    await book(f);
    await anon();
    const [job] = (await claim()).filter(
      (j) => j.professional_id === f.professional,
    );
    await as(owner);
    await value(
      "select public.assign_professional_member($1,$2,null,$3,true)",
      [company, f.professional, f.user],
    );
    await value(
      "select public.assign_professional_member($1,$2,$3,null,false)",
      [company, f.professional, f.user],
    );
    await as(f.user);
    assert.equal((await mine()).enabled, false);
    await anon();
    assert.equal(await prepare(job.job_id), null);
  },
);
await check(
  "membership revocation, archived professional and suspended company cancel sends",
  async () => {
    for (const action of ["revoke", "archive", "suspend"]) {
      const f = await fixture();
      await book(f);
      await anon();
      const [job] = (await claim()).filter(
        (j) => j.professional_id === f.professional,
      );
      await as(owner);
      if (action === "revoke")
        await value("select public.revoke_company_member($1,$2,true)", [
          company,
          f.user,
        ]);
      else {
        await db.exec("reset role");
        await sql(
          action === "archive"
            ? "update public.professionals set archived_at=now() where id=$1"
            : "update public.companies set status='suspended' where id=$1",
          [action === "archive" ? f.professional : company],
        );
      }
      await anon();
      assert.equal(await prepare(job.job_id), null);
      if (action === "suspend") {
        await as(f.user);
        await prefs(null, false);
        await assert.rejects(() => prefs(), /subscription blocked/);
        await postgres();
        await sql("update public.companies set status='trialing' where id=$1", [
          company,
        ]);
      }
    }
  },
);
await check(
  "cancellation or reschedule invalidates snapshot even if moved back",
  async () => {
    for (const action of ["cancel", "reschedule"]) {
      const f = await fixture();
      const id = await book(f);
      await anon();
      const [job] = (await claim()).filter(
        (j) => j.professional_id === f.professional,
      );
      await as(owner);
      if (action === "cancel")
        await value("select public.manage_appointment($1,$2,'cancel')", [
          company,
          id,
        ]);
      else {
        await value(
          "select public.manage_appointment($1,$2,'reschedule',$3::timestamptz+interval '1 hour')",
          [company, id, tomorrow],
        );
        await value("select public.manage_appointment($1,$2,'reschedule',$3)", [
          company,
          id,
          tomorrow,
        ]);
      }
      await anon();
      assert.equal(await prepare(job.job_id), null);
    }
  },
);
await check(
  "empty queued snapshots never poison a batch or consume its limit",
  async () => {
    const f = await fixture();
    const canceled = await book(f);
    const valid = await book(f, 60);
    await as(owner);
    await value("select public.manage_appointment($1,$2,'cancel')", [
      company,
      canceled,
    ]);
    await anon();
    const jobs = await claim([company], 1);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].appointments[0].appointment_id, valid);
    await postgres();
    assert.equal(
      await value(
        "select status from public.whatsapp_staff_notifications where appointment_id=$1",
        [canceled],
      ),
      "canceled",
    );
  },
);
await check(
  "daily preparation prunes canceled rows but preserves every remaining row",
  async () => {
    const f = await fixture();
    const ids = await dailyFixture(f, 2);
    await as(owner);
    await settings(true, false);
    await anon();
    const [job] = (await claim()).filter(
      (j) => j.professional_id === f.professional,
    );
    await postgres();
    await sql("update public.appointments set status='canceled' where id=$1", [
      ids[0],
    ]);
    await anon();
    assert.deepEqual(
      (await prepare(job.job_id))?.appointments.map((a) => a.appointment_id),
      [ids[1]],
    );
  },
);
await check(
  "both customer and staff queues consume one shared atomic ceiling",
  async () => {
    await as(owner);
    await settings(false, true);
    const before = (await usage()).consumed;
    const offset = await value<number>(
      "select ceil(extract(epoch from ($1::timestamptz-now()))/60)::integer",
      [tomorrow],
    );
    await value(
      "select public.save_whatsapp_settings($1,true,array[$2::integer],$3)",
      [company, offset, before + 1],
    );
    const f = await fixture();
    const a = await book(f);
    const b = await book(f, 60);
    await anon();
    const jobs = (await claim()).filter(
      (j) => j.professional_id === f.professional,
    );
    assert.equal(jobs.length, 2);
    const sends = await Promise.all(jobs.map((j) => prepare(j.job_id)));
    assert.equal(sends.filter(Boolean).length, 1);
    await as(owner);
    assert.equal((await usage()).consumed, before + 1);
    await value("select public.set_whatsapp_consent($1,$2,true)", [
      company,
      f.customer,
    ]);
    await anon();
    const clientJobs = await value<
      { job_id: string; appointment_id: string }[]
    >("select public.claim_whatsapp_reminders($1,array[$2::uuid],100)", [
      secret,
      company,
    ]);
    const blockedClient = clientJobs.find((j) => j.appointment_id === a)!;
    assert.ok(blockedClient);
    const token = "a".repeat(64);
    assert.equal(
      await value("select public.prepare_whatsapp_reminder($1,$2,$3)", [
        secret,
        blockedClient.job_id,
        token,
      ]),
      null,
      "customer cannot exceed a staff reservation",
    );
    await as(owner);
    await value(
      "select public.save_whatsapp_settings($1,true,array[$2::integer],$3)",
      [company, offset, before + 2],
    );
    const g = await fixture();
    const second = await book(g);
    await as(owner);
    await value("select public.set_whatsapp_consent($1,$2,true)", [
      company,
      g.customer,
    ]);
    await anon();
    const nextClient = (
      await value<{ job_id: string; appointment_id: string }[]>(
        "select public.claim_whatsapp_reminders($1,array[$2::uuid],100)",
        [secret, company],
      )
    ).find((j) => j.appointment_id === second)!;
    assert.ok(
      await value("select public.prepare_whatsapp_reminder($1,$2,$3)", [
        secret,
        nextClient.job_id,
        "b".repeat(64),
      ]),
    );
    const [staff] = (await claim()).filter(
      (j) => j.professional_id === g.professional,
    );
    assert.equal(
      await prepare(staff.job_id),
      null,
      "staff cannot exceed a customer reservation",
    );
    await as(owner);
    assert.equal((await usage()).consumed, before + 2);
    await value(
      "select public.save_whatsapp_settings($1,false,array[60],1000)",
      [company],
    );
    assert.notEqual(a, b);
  },
);
await check(
  "tenant and employee history are isolated; private payload never exposed",
  async () => {
    const f = await fixture();
    await book(f);
    await as(other);
    assert.equal(
      Number(
        await value(
          "select count(*) from public.whatsapp_staff_notifications where company_id=$1",
          [company],
        ),
      ),
      0,
    );
    await as(f.user);
    assert.equal(
      Number(
        await value("select count(*) from public.whatsapp_staff_notifications"),
      ),
      0,
    );
    await assert.rejects(
      () => sql("select * from private.whatsapp_staff_payloads"),
      /permission denied/,
    );
    await as(owner);
    await assert.rejects(
      () =>
        sql(
          "update public.whatsapp_staff_notifications set status='accepted' where company_id=$1",
          [company],
        ),
      /permission denied/,
    );
    await anon();
    await assert.rejects(
      () => sql("select * from public.whatsapp_staff_notifications"),
      /permission denied/,
    );
  },
);
await check(
  "status callbacks are idempotent, scoped and monotonic",
  async () => {
    const f = await fixture();
    await book(f);
    await anon();
    const [job] = (await claim()).filter(
      (j) => j.professional_id === f.professional,
    );
    await prepare(job.job_id);
    const message = `wamid.${randomUUID()}`;
    assert.equal(
      await receipt(job.job_id, message, "delivered", otherCompany),
      false,
    );
    assert.ok(await finish(job.job_id, "accepted", message));
    assert.ok(await finish(job.job_id, "accepted", message));
    assert.equal(await finish(job.job_id, "accepted", "wamid.other"), false);
    await receipt(job.job_id, message, "delivered");
    await receipt(job.job_id, message, "sent");
    assert.equal(await state(job.job_id), "delivered");
    await anon();
    await receipt(job.job_id, message, "failed");
    assert.equal(await state(job.job_id), "delivered");
    await anon();
    await receipt(job.job_id, message, "read");
    assert.equal(await state(job.job_id), "read");
  },
);
await check(
  "late or stalled work never sends an old event or replays a timeout",
  async () => {
    const f = await fixture();
    await book(f);
    await postgres();
    await sql(
      "update public.whatsapp_staff_notifications set created_at=now()-interval '25 hours' where professional_id=$1",
      [f.professional],
    );
    await anon();
    assert.equal(
      (await claim()).filter((j) => j.professional_id === f.professional)
        .length,
      0,
    );
    const g = await fixture();
    await book(g);
    await anon();
    const [job] = (await claim()).filter(
      (j) => j.professional_id === g.professional,
    );
    await prepare(job.job_id);
    await postgres();
    await sql(
      "update public.whatsapp_staff_notifications set updated_at=now()-interval '20 minutes' where id=$1",
      [job.job_id],
    );
    await anon();
    await claim();
    assert.equal(await state(job.job_id), "unknown");
    await anon();
    assert.equal(await prepare(job.job_id), null);
  },
);
await check(
  "inbound opt-out revokes matching staff phone only within company",
  async () => {
    const f = await fixture();
    const g = await fixture(true, otherCompany);
    await anon();
    assert.ok(
      await value("select public.whatsapp_opt_out($1,$2,'11990000001')", [
        secret,
        company,
      ]),
    );
    await as(f.user);
    assert.equal((await mine()).enabled, false);
    await as(g.user);
    assert.equal((await mine(otherCompany)).enabled, true);
  },
);
await check(
  "disabled company setting prevents a claimed new appointment send",
  async () => {
    const f = await fixture();
    await book(f);
    await anon();
    const [job] = (await claim()).filter(
      (j) => j.professional_id === f.professional,
    );
    await as(owner);
    await settings(false, false);
    await anon();
    assert.equal(await prepare(job.job_id), null);
  },
);
await db.close();
console.log(
  `PASS ${passed} staff WhatsApp database groups; disposable PGlite only. Overlapping calls are serialized by PGlite; real multi-connection load is not simulated.`,
);
