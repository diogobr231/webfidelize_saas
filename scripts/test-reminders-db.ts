import { installLegacyTrialFixtures } from "./legacy-trial-fixture";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { storageFixture } from "./storage-fixture";

// Disposable PostgreSQL engine only: no secrets, customers, messages or remote writes.
process.on("uncaughtException", (error) => { console.error(error.message); process.exit(1); });
const db = new PGlite({ extensions: { btree_gist } });
await db.exec(`create role anon nologin; create role authenticated nologin;
  create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
await db.exec(storageFixture);
for (const name of (await readdir("supabase/migrations")).filter((name) => name.endsWith(".sql")).sort()) {
  await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
}
await installLegacyTrialFixtures(db);
const ids = { owner: randomUUID(), other: randomUUID(), manager: randomUUID(), employee: randomUUID(), admin: randomUUID() };
const sql = (query: string, args: unknown[] = []) => db.query<Record<string, unknown>>(query, args);
async function value<T = unknown>(query: string, args: unknown[] = []): Promise<T> { return Object.values((await db.query<Record<string, T>>(query, args)).rows[0])[0]; }
async function postgres() { await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)"); }
async function as(user: string) { await postgres(); await sql("select set_config('request.jwt.claim.sub',$1,false)", [user]); await db.exec("set role authenticated"); }
async function anon() { await postgres(); await db.exec("set role anon"); }
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const secret = "test-only-whatsapp-gateway-local-1234567890";
const bookingSecret = "test-only-booking-gateway-local-1234567890";
for (const user of Object.values(ids)) await sql("insert into auth.users(id) values($1)", [user]);
await as(ids.owner);
const company = await value<string>("select public.create_company('WhatsApp test A','salao')");
await as(ids.other);
const otherCompany = await value<string>("select public.create_company('WhatsApp test B','clinica')");
await postgres();
await sql("insert into public.memberships values($1,$2,'MANAGER'),($1,$3,'EMPLOYEE')", [company, ids.manager, ids.employee]);
await sql("insert into private.platform_admins values($1)", [ids.admin]);
await db.exec("update public.plans set staff_limit=1000");
await sql("update public.companies set booking_slug=case when id=$1 then 'whatsapp-test-a' else 'whatsapp-test-b' end,booking_enabled=true", [company]);
await sql("insert into private.booking_gateway values(true,$1)", [hash(bookingSecret)]);
await sql("update private.whatsapp_gateway_config set secret_hash=$1", [hash(secret)]);
const start = await value<string>("select (((now() at time zone 'America/Sao_Paulo')::date+1)::timestamp+interval '12 hours') at time zone 'America/Sao_Paulo'");
const offset = Number(await value("select floor(extract(epoch from ($1::timestamptz-now()))/60)::integer", [start]));
// Exact due time is seconds after now for floor; ceil keeps it inside the current grace window.
const minutes = offset + 1;
const save = (c = company, enabled = true, offsets = [minutes], limit = 1000) => value("select public.save_whatsapp_settings($1,$2,$3::int[],$4)", [c, enabled, offsets, limit]);
const consent = (customer: string, allowed = true, c = company) => value("select public.set_whatsapp_consent($1,$2,$3)", [c, customer, allowed]);
const cap = (limit: number, c = company) => value("select public.admin_set_whatsapp_limit($1,$2)", [c, limit]);
const usage = (c = company) => value<{ month: string; consumed: number; effective_limit: number }>("select public.whatsapp_usage($1)", [c]);
type Job = { job_id: string; company_id: string; appointment_id: string; starts_at: string; recipient: string; offset_minutes: number };
const claim = (companies = [company], credential: string | null = secret, batch = 25) => value<Job[]>("select public.claim_whatsapp_reminders($1,$2::uuid[],$3)", [credential, companies, batch]);
const prepare = (job: string, token = randomUUID()) => value<Job | null>("select public.prepare_whatsapp_reminder($1,$2,$3)", [secret, job, hash(token)]);
const finish = (job: string, status = "accepted", message: string | null = `wamid.${randomUUID()}`, error: string | null = null) => value<boolean>("select public.finish_whatsapp_reminder($1,$2,$3,$4,$5)", [secret, job, status, message, error]);
const delivery = (job: string, message: string, status: string, c = company) => value<boolean>("select public.whatsapp_delivery_event($1,$2,$3,$4,$5,$6)", [secret, c, job, message, status, status === "failed" ? "delivery_failed" : null]);
const confirmation = (token: string, action = "view") => value<{ company_name: string; starts_at: string; confirmed: boolean; opted_out: boolean } | null>("select public.whatsapp_confirmation($1,$2,$3)", [secret, hash(token), action]);
async function state(job: string) { await postgres(); return value<string>("select status from public.whatsapp_reminders where id=$1", [job]); }
async function fixture(allowed = true, c = company, appointmentStart = start) {
  await as(c === company ? ids.owner : ids.other);
  const customer = await value<string>("insert into public.customers(company_id,name,phone) values($1,'Cliente sintético','(11) 99000-0001') returning id", [c]);
  const professional = await value<string>("insert into public.professionals(company_id,name) values($1,'Profissional sintético') returning id", [c]);
  const service = await value<string>("insert into public.services(company_id,name,duration_minutes,price_cents) values($1,'Serviço teste',30,5000) returning id", [c]);
  await sql("delete from public.availability where company_id=$1 and professional_id=$2", [c, professional]);
  await sql("insert into public.availability(company_id,professional_id,weekday,start_minute,end_minute) select $1,$2,d,0,1440 from generate_series(1,7) d", [c, professional]);
  const appointment = await value<string>("select public.book_appointment($1,$2,$3,$4,$5)", [c, customer, service, professional, appointmentStart]);
  if (allowed) await consent(customer, true, c);
  await anon();
  return { customer, professional, service, appointment };
}
let passed = 0;
async function check(name: string, run: () => Promise<void>) { await run(); passed++; console.log(`PASS reminders: ${name}`); }
await check("owner settings preserve closed platform ceiling and validate offsets", async () => {
  await as(ids.owner); await save();
  assert.equal((await usage()).effective_limit, 0);
  for (const offsets of [[], [29], [10081], [60, 60], [60, 120, 180, 240], [null]]) await assert.rejects(() => value("select public.save_whatsapp_settings($1,true,$2::int[],100)", [company, offsets]), /invalid whatsapp settings/);
  await assert.rejects(() => save(company, true, [minutes], 100001), /invalid whatsapp settings/);
  await assert.rejects(() => cap(1000), /not authorized/);
  await as(ids.admin); await cap(1000); await cap(1000, otherCompany);
  await as(ids.other); await save(otherCompany);
  await as(ids.owner); assert.equal((await usage()).effective_limit, 1000);
});
await check("manager allowed, employee and cross-company settings denied", async () => {
  await as(ids.manager); await save();
  await as(ids.employee); await assert.rejects(() => save(), /not authorized/); await assert.rejects(() => usage(), /not authorized/);
  await as(ids.other); await assert.rejects(() => save(), /not authorized/); await assert.rejects(() => usage(), /not authorized/);
  assert.equal(Number(await value("select count(*) from public.whatsapp_settings where company_id=$1", [company])), 0);
  await anon(); await assert.rejects(() => save(), /permission denied/);
});
await check("no browser writes, no private payloads and gateway required", async () => {
  await as(ids.owner);
  await assert.rejects(() => sql("update public.whatsapp_settings set platform_limit=99999 where company_id=$1", [company]), /permission denied/);
  await assert.rejects(() => sql("select * from private.whatsapp_payloads"), /permission denied/);
  await assert.rejects(() => sql("select private.whatsapp_job_data($1)", [randomUUID()]), /permission denied/);
  await assert.rejects(() => claim([company], null), /gateway unauthorized/);
  await anon(); await assert.rejects(() => claim([company], "incorrect-credential-at-least-32-characters"), /gateway unauthorized/);
  await assert.rejects(() => claim([], secret), /invalid whatsapp batch/);
});
await check("no consent means no automatic message; valid Brazilian phone normalization", async () => {
  const f = await fixture(false); assert.equal((await claim()).length, 0);
  await as(ids.other); await assert.rejects(() => consent(f.customer), /not authorized/);
  await as(ids.employee); await assert.rejects(() => consent(f.customer), /not authorized/);
  await as(ids.owner); await consent(f.customer); await anon();
  const jobs = await claim(); assert.equal(jobs.length, 1); assert.equal(jobs[0].recipient, "5511990000001");
  assert.ok(await prepare(jobs[0].job_id)); await finish(jobs[0].job_id);
});
await check("claims and quota are idempotent under overlapping worker calls", async () => {
  const f = await fixture();
  const claims = await Promise.all([claim(), claim(), claim()]);
  const jobs = claims.flat().filter((j) => j.appointment_id === f.appointment);
  assert.equal(jobs.length, 1);
  const results = await Promise.all([prepare(jobs[0].job_id), prepare(jobs[0].job_id)]);
  assert.equal(results.filter(Boolean).length, 1);
  await finish(jobs[0].job_id, "unknown", null, "network_unknown");
  assert.equal(await prepare(jobs[0].job_id), null);
  assert.equal((await claim()).length, 0);
  await as(ids.owner); assert.equal((await usage()).consumed, 2);
});
await check("quota ceiling is atomic and is not refunded after failure", async () => {
  await as(ids.owner); const previous = (await usage()).consumed; await save(company, true, [minutes], previous + 1);
  await as(ids.admin); await cap(previous + 2);
  await fixture(); await fixture(); const jobs = await claim(); assert.equal(jobs.length, 2);
  const results = await Promise.all(jobs.map((j) => prepare(j.job_id)));
  assert.equal(results.filter(Boolean).length, 1);
  const accepted = results.find(Boolean)!;
  await finish(accepted.job_id, "failed", null, "provider_rejected");
  await as(ids.owner); assert.equal((await usage()).consumed, previous + 1);
  await save(); await as(ids.admin); await cap(1000); await anon();
  assert.equal((await claim()).length, 0, "increasing a cap does not replay a missed/failed reminder");
});
await check("jobs and consent are tenant isolated and employee private", async () => {
  await as(ids.other); assert.equal(Number(await value("select count(*) from public.whatsapp_reminders where company_id=$1", [company])), 0);
  assert.equal(Number(await value("select count(*) from public.whatsapp_consents where company_id=$1", [company])), 0);
  await as(ids.employee); assert.equal(Number(await value("select count(*) from public.whatsapp_reminders")), 0);
  await anon(); await assert.rejects(() => sql("select * from public.whatsapp_reminders"), /permission denied/);
});
await check("revoking consent after claim prevents provider dispatch", async () => {
  const f = await fixture(); const [job] = await claim(); await as(ids.owner); await consent(f.customer, false); await anon();
  assert.equal(await prepare(job.job_id), null); assert.equal(await state(job.job_id), "canceled");
});
await check("phone change invalidates old consent and claimed recipient", async () => {
  const f = await fixture(); const [job] = await claim(); await as(ids.owner);
  await value("select public.update_business_record($1,'customers',$2,1,'Cliente sintético','11990000002',null,null)", [company, f.customer]);
  await anon(); assert.equal(await prepare(job.job_id), null);
  await as(ids.owner); assert.equal(await value("select phone from public.whatsapp_consents where customer_id=$1", [f.customer]), "5511990000001");
  assert.ok(await value("select revoked_at from public.whatsapp_consents where customer_id=$1", [f.customer]));
  await value("select public.update_business_record($1,'customers',$2,2,'Cliente sintético','11990000001',null,null)", [company, f.customer]);
  assert.ok(await value("select revoked_at from public.whatsapp_consents where customer_id=$1", [f.customer]), "changing a number back never restores opt-in");
});
await check("disabled settings and suspended company prevent sending", async () => {
  await fixture(); const [job] = await claim(); await as(ids.owner); await save(company, false); await anon(); assert.equal(await prepare(job.job_id), null);
  await as(ids.owner); await save(); const f = await fixture(); const [other] = await claim(); await postgres();
  await sql("update public.companies set status='suspended' where id=$1", [company]); await anon(); assert.equal(await prepare(other.job_id), null);
  await as(ids.owner); await assert.rejects(() => consent(f.customer, true), /subscription blocked/); await consent(f.customer, false);
  assert.ok(await value("select revoked_at from public.whatsapp_consents where customer_id=$1", [f.customer]));
  await postgres(); await sql("update public.companies set status='trialing' where id=$1", [company]);
});
await check("archived customer or professional is not eligible", async () => {
  const f = await fixture(); const [job] = await claim(); await postgres();
  await sql("update public.customers set archived_at=now() where id=$1", [f.customer]); await anon(); assert.equal(await prepare(job.job_id), null);
  const g = await fixture(); await as(ids.owner); await db.exec("reset role"); await sql("update public.professionals set archived_at=now() where id=$1", [g.professional]); await anon(); assert.equal((await claim()).length, 0);
});
await check("cancellation between claim and send invalidates job", async () => {
  const f = await fixture(); const [job] = await claim(); await as(ids.owner); await value("select public.manage_appointment($1,$2,'cancel')", [company, f.appointment]);
  await anon(); assert.equal(await prepare(job.job_id), null);
});
await check("GET-style view does not confirm; confirmation is idempotent", async () => {
  const f = await fixture(); const [job] = await claim(); const token = randomUUID(); await prepare(job.job_id, token); await finish(job.job_id);
  assert.equal((await confirmation(token))?.confirmed, false);
  assert.equal((await confirmation(token, "confirm"))?.confirmed, true);
  await postgres(); const first = await value("select attendance_confirmed_at from public.appointments where id=$1", [f.appointment]); await anon();
  assert.equal((await confirmation(token, "confirm"))?.confirmed, true);
  await postgres(); assert.deepEqual(await value("select attendance_confirmed_at from public.appointments where id=$1", [f.appointment]), first);
  await as(ids.owner); await assert.rejects(() => sql("update public.appointments set attendance_confirmed_at=now() where id=$1", [f.appointment]), /permission denied/);
});
await check("reschedule clears attendance and makes old confirmation token unusable", async () => {
  const f = await fixture(); const [job] = await claim(); const token = randomUUID(); await prepare(job.job_id, token); await finish(job.job_id); await confirmation(token, "confirm");
  await as(ids.owner); await value("select public.manage_appointment($1,$2,'reschedule',$3::timestamptz+interval '1 hour')", [company, f.appointment, start]);
  assert.equal(await value("select attendance_confirmed_at from public.appointments where id=$1", [f.appointment]), null);
  await anon(); assert.equal(await confirmation(token), null); assert.equal(await confirmation(token, "confirm"), null);
  await as(ids.owner); await value("select public.manage_appointment($1,$2,'reschedule',$3::timestamptz)", [company, f.appointment, start]);
  await anon(); assert.equal(await confirmation(token, "confirm"), null, "moving away and back cannot revive a token");
  assert.equal((await confirmation(token, "optout"))?.opted_out, true);
});
await check("canceled appointment cannot confirm, but can still opt out", async () => {
  const f = await fixture(); const [job] = await claim(); const token = randomUUID(); await prepare(job.job_id, token); await finish(job.job_id);
  await as(ids.owner); await value("select public.manage_appointment($1,$2,'cancel')", [company, f.appointment]); await anon();
  assert.equal(await confirmation(token, "confirm"), null); assert.equal((await confirmation(token, "optout"))?.opted_out, true);
});
await check("expired/random tokens never disclose or confirm appointments", async () => {
  await fixture(); const [job] = await claim(); const token = randomUUID(); await prepare(job.job_id, token); await finish(job.job_id); await postgres();
  await sql("update private.whatsapp_payloads set token_expires_at=now()-interval '1 minute' where job_id=$1", [job.job_id]); await anon();
  assert.equal(await confirmation(token), null); assert.equal(await confirmation(randomUUID()), null);
  assert.equal(await value("select public.whatsapp_confirmation($1,'bad-hash','confirm')", [secret]), null);
});
await check("recipient phone changes permanently revoke old confirmation capabilities", async () => {
  const f = await fixture(); const [job] = await claim(); const token = randomUUID(); await prepare(job.job_id, token); await finish(job.job_id);
  await as(ids.owner);
  await value("select public.update_business_record($1,'customers',$2,1,'Cliente sintético','11990000002',null,null)", [company, f.customer]);
  await value("select public.update_business_record($1,'customers',$2,2,'Cliente sintético','11990000001',null,null)", [company, f.customer]);
  await anon(); assert.equal(await confirmation(token, "confirm"), null);
});
await check("delivery webhook scope, duplicates and out-of-order receipts", async () => {
  await fixture(); const [job] = await claim(); await prepare(job.job_id); const message = `wamid.${randomUUID()}`;
  assert.equal(await delivery(job.job_id, message, "sent", otherCompany), false);
  assert.equal(await delivery(job.job_id, message, "delivered"), true);
  assert.equal(await finish(job.job_id, "accepted", message), true, "webhook may arrive before HTTP success");
  assert.equal(await delivery(job.job_id, message, "sent"), true); assert.equal(await state(job.job_id), "delivered"); await anon();
  await delivery(job.job_id, message, "failed"); assert.equal(await state(job.job_id), "delivered"); await anon();
  await delivery(job.job_id, message, "read"); await delivery(job.job_id, message, "read");
  assert.equal(await value("select public.whatsapp_delivery_event($1,$2,null,$3,'read',null)", [secret, company, message]), true);
  assert.equal(await value("select public.whatsapp_delivery_event($1,$2,null,$3,'read',null)", [secret, otherCompany, message]), false);
  assert.equal(await state(job.job_id), "read"); await anon(); assert.equal(await delivery(job.job_id, "different-id", "read"), false);
});
await check("timeout acceptance resolves only from verified same-job message", async () => {
  await fixture(); const [job] = await claim(); await prepare(job.job_id); await finish(job.job_id, "unknown", null, "network_unknown");
  assert.equal(await prepare(job.job_id), null); await delivery(job.job_id, `wamid.${randomUUID()}`, "delivered"); assert.equal(await state(job.job_id), "delivered");
});
await check("provider errors cannot store secrets or arbitrary logs", async () => {
  await fixture(); const [job] = await claim(); await prepare(job.job_id);
  await assert.rejects(() => finish(job.job_id, "failed", null, "private-token-accidentally-logged"), /invalid whatsapp result/);
  await finish(job.job_id, "failed", null, "provider_rejected");
});
await check("late worker does not send an expired reminder", async () => {
  const late = await value<string>("select $1::timestamptz-interval '1 hour'", [start]); const f = await fixture(true, company, late);
  assert.equal((await claim()).find((j) => j.appointment_id === f.appointment), undefined);
});
await check("stalled sending remains consumed and is never retried", async () => {
  await fixture(); const [job] = await claim(); await prepare(job.job_id); await postgres();
  await sql("update public.whatsapp_reminders set updated_at=now()-interval '20 minutes' where id=$1", [job.job_id]); await anon();
  assert.equal((await claim()).length, 0); assert.equal(await state(job.job_id), "unknown"); await anon(); assert.equal(await prepare(job.job_id), null);
});
await check("public opt-in is scoped to receipt+slug, retry cannot undo opt-out", async () => {
  const f = await fixture(false); const request = randomUUID(); await postgres();
  await sql("insert into private.booking_requests values($1,$2,$3)", [company, request, f.appointment]); await anon();
  const optin = (slug: string, key = request, credential = bookingSecret) => value<boolean>("select public.public_booking_whatsapp_consent($1,$2,$3,true)", [slug, key, credential]);
  assert.equal(await optin("whatsapp-test-b"), false); assert.equal(await optin("whatsapp-test-a", randomUUID()), false);
  await assert.rejects(() => optin("whatsapp-test-a", request, secret), /gateway unauthorized/);
  assert.equal(await optin("whatsapp-test-a"), true); assert.equal(await optin("whatsapp-test-a"), true);
  await as(ids.owner); await consent(f.customer, false); await anon(); assert.equal(await optin("whatsapp-test-a"), false);
});
await check("inbound opt-out applies to matching phone only within its company", async () => {
  const a = await fixture(); const b = await fixture(true, otherCompany);
  assert.equal(await value("select public.whatsapp_opt_out($1,$2,$3)", [secret, company, "5511990000001"]), true);
  await as(ids.owner); assert.ok(await value("select revoked_at from public.whatsapp_consents where customer_id=$1", [a.customer]));
  await as(ids.other); assert.equal(await value("select revoked_at from public.whatsapp_consents where customer_id=$1", [b.customer]), null);
  await anon(); const jobs = await claim([otherCompany]); assert.equal(jobs.length, 1); assert.equal(jobs[0].company_id, otherCompany);
});
await check("month usage is bounded to Sao Paulo calendar and scope", async () => {
  await as(ids.owner); const previous = await usage(); await postgres();
  const old = await value<string>("select id from public.whatsapp_reminders where company_id=$1 and consumed_at is not null limit 1", [company]);
  await sql("update public.whatsapp_reminders set consumed_at=(date_trunc('month',now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')-interval '1 second' where id=$1", [old]);
  await as(ids.owner); assert.equal((await usage()).consumed, previous.consumed - 1); assert.match((await usage()).month, /^\d{4}-\d{2}$/);
});
console.log(`PASS ${passed} WhatsApp database groups; all migrations applied in disposable PGlite. Concurrent calls are serialized by PGlite; real multi-connection load remains a staging check.`);
await db.close();
