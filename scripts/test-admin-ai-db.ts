import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFile, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { storageFixture } from "./storage-fixture";
import { installLegacyTrialFixtures } from "./legacy-trial-fixture";

process.on("uncaughtException", (error) => {
  console.error(error.message);
  process.exit(1);
});

// Disposable PostgreSQL only. All model results below are explicit test fixtures;
// this suite neither calls an AI provider nor writes production data.
const db = new PGlite({ extensions: { btree_gist } });
await db.exec(`create role anon nologin; create role authenticated nologin;
  create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
await db.exec(storageFixture);
for (const file of (await readdir("supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort())
  await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
await installLegacyTrialFixtures(db);
const ids = {
  admin: randomUUID(),
  admin2: randomUUID(),
  owner: randomUUID(),
  outsider: randomUUID(),
  manager: randomUUID(),
  employee: randomUUID(),
};
await db.query(
  "insert into auth.users(id) values($1),($2),($3),($4),($5),($6)",
  Object.values(ids),
);
await db.query("insert into private.platform_admins values($1),($2)", [
  ids.admin,
  ids.admin2,
]);
async function postgres() {
  await db.exec(
    "reset role; select set_config('request.jwt.claim.sub','',false)",
  );
}
async function as(id: string) {
  await postgres();
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
async function anon() {
  await postgres();
  await db.exec("set role anon");
}
async function value<T = unknown>(
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  return Object.values(
    (await db.query<Record<string, T>>(sql, params)).rows[0],
  )[0];
}
let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`PASS admin AI: ${name}`);
}
type Settings = {
  enabled: boolean;
  auto_enqueue: boolean;
  authorized_by: string | null;
  authorization_id: string;
  updated_at: string;
  daily_limit: number;
  monthly_limit: number;
  last_error_code: string | null;
};
type Job = {
  id: string;
  status: string;
  source_type: string;
  source_id: string;
  source_fingerprint: string;
  attempt: number;
  output: unknown;
  reviewed_body: string;
  updated_at: string;
  applied_note_id: string | null;
  usage_input_tokens: number | null;
  usage_output_tokens: number | null;
  consumed_at: string | null;
  error_code: string | null;
  leased_until: string | null;
};
type Claim = {
  job: { id: string; source_type: string; source_id: string };
  claim_token: string;
  snapshot: { kind: string; facts: Record<string, unknown>; task: unknown };
};
type Summary = {
  settings: Settings;
  quota: {
    daily_used: number;
    monthly_used: number;
    daily_remaining: number;
    monthly_remaining: number;
  };
  last_error_code: string | null;
  last_run: {
    trigger: string;
    processed: number;
    failed: number;
    error_code: string | null;
  } | null;
};
const settings = () =>
  value<Settings>("select to_jsonb(s) from public.platform_ai_settings s");
const job = (id: string) =>
  value<Job>("select to_jsonb(j) from public.platform_ai_jobs j where id=$1", [
    id,
  ]);
const summary = () => value<Summary>("select public.admin_ai_summary()");
const request = (type: string, id: string) =>
  value<string>("select public.admin_ai_request($1,$2)", [type, id]);
const retry = (item: Job) =>
  value<string>("select public.admin_ai_retry($1,$2)", [
    item.id,
    item.updated_at,
  ]);
const review = (
  item: Job,
  action: string,
  body = "Reviewed internal note with local test content.",
) =>
  value<Job>("select public.admin_ai_review($1,$2,$3,$4)", [
    item.id,
    action,
    body,
    item.updated_at,
  ]);
const save = (
  item: Settings,
  enabled = true,
  auto = false,
  daily = 50,
  monthly = 500,
) =>
  value<Settings>("select public.admin_ai_settings_save($1,$2,$3,$4,$5)", [
    enabled,
    auto,
    daily,
    monthly,
    item.updated_at,
  ]);
const secret = "isolated-ai-worker-test-secret-not-production-1234567890";
const claim = () =>
  value<Claim | null>("select public.platform_ai_claim($1)", [secret]);
const enqueue = (limit = 3) =>
  value<{ enqueued: number }>("select public.platform_ai_enqueue($1,$2)", [
    secret,
    limit,
  ]);
const fixture = {
  output: {
    summary: "Synthetic model fixture for a disposable local database only.",
    next_action: "Review this synthetic lead internally.",
    priority: "normal",
    suggested_reply: "Draft only. No real recipient or message is sent.",
  },
  model: "isolated-fixture-model",
  input_tokens: 25,
  output_tokens: 40,
};
const finish = (
  item: Claim,
  result: unknown = fixture,
  error: string | null = null,
) =>
  value<boolean>("select public.platform_ai_finish($1,$2,$3,$4::jsonb,$5)", [
    secret,
    item.job.id,
    item.claim_token,
    result === null ? null : JSON.stringify(result),
    error,
  ]);
await as(ids.owner);
const ca = await value<string>(
  "select public.create_company('AI owner tenant','salao')",
);
await as(ids.outsider);
const cb = await value<string>(
  "select public.create_company('AI outsider tenant','clinica')",
);
await postgres();
await db.query(
  "insert into public.memberships values($1,$2,'MANAGER'),($1,$3,'EMPLOYEE')",
  [ca, ids.manager, ids.employee],
);
const offer = await value<string>(
  "select id from public.sales_offers where slug='web-fidelize'",
);
const demo = await value<string>(
  "insert into public.companies(name,niche,is_demo) values('Demo excluded','academia',true) returning id",
);
async function lead() {
  await postgres();
  return value<string>(
    `insert into public.sales_leads(offer_id,contact_name,company_name,email,phone,source,challenge,next_contact_at)
    values($1,'Sensitive contact secret','Sensitive company secret','secret@example.invalid','5511999999999','manual','Improve scheduling for the business.',now()-interval '2 hours') returning id`,
    [offer],
  );
}
async function ticket(company = ca) {
  await postgres();
  return value<string>(
    `insert into public.support_tickets(company_id,requester_id,request_key,module,subject,message,updated_at)
    values($1,$2,$3,'agenda','Schedule configuration','Need help configuring available appointment times.',now()-interval '2 days') returning id`,
    [company, ids.owner, randomUUID()],
  );
}
async function newJob(type = "lead", source?: string) {
  const sourceId = source ?? (await lead());
  await as(ids.admin);
  const id = await request(type, sourceId);
  return { source: sourceId, id };
}
async function nextClaim(id: string) {
  await anon();
  const item = await claim();
  assert.ok(item);
  assert.equal(item.job.id, id);
  return item;
}
const initialLead = await lead();

await check(
  "default settings require explicit authorization and an independent worker secret",
  async () => {
    await as(ids.admin);
    assert.equal((await settings()).authorized_by, null);
    await assert.rejects(
      () => request("lead", initialLead),
      /not authorized or disabled/,
    );
    await anon();
    await assert.rejects(claim, /worker unavailable/);
    await postgres();
    await db.query("update private.platform_ai_gateway set secret_hash=$1", [
      createHash("sha256").update(secret).digest("hex"),
    ]);
    await anon();
    assert.equal(await claim(), null);
    assert.deepEqual(await enqueue(), { enqueued: 0 });
    for (const wrong of [null, "short", "a".repeat(40)])
      await assert.rejects(
        () => value("select public.platform_ai_claim($1)", [wrong]),
        /worker unavailable/,
      );
  },
);

await check(
  "every tenant role and anonymous caller are isolated from admin jobs, drafts, settings and mutations",
  async () => {
    for (const user of [ids.owner, ids.outsider, ids.manager, ids.employee]) {
      await as(user);
      await db.exec(
        `select set_config('request.jwt.claims','{"user_metadata":{"role":"SUPER_ADMIN"}}',false)`,
      );
      for (const table of [
        "platform_ai_settings",
        "platform_ai_jobs",
        "platform_ai_runs",
      ])
        assert.equal(
          Number(await value(`select count(*) from public.${table}`)),
          0,
        );
      await assert.rejects(summary, /not authorized/);
      await assert.rejects(
        () => request("lead", initialLead),
        /not authorized/,
      );
      await assert.rejects(
        () =>
          value("select public.admin_ai_review($1,'approve','Forged',now())", [
            randomUUID(),
          ]),
        /not authorized/,
      );
      await assert.rejects(
        () => value("select public.admin_ai_retry($1,now())", [randomUUID()]),
        /not authorized/,
      );
      await assert.rejects(
        () =>
          value("select public.admin_ai_settings_save(true,true,10,100,now())"),
        /not authorized/,
      );
      await assert.rejects(
        () => value("select * from private.platform_ai_payloads"),
        /permission denied/,
      );
      await assert.rejects(
        () =>
          value("select private.platform_ai_source('lead',$1)", [initialLead]),
        /permission denied/,
      );
    }
    await anon();
    for (const table of [
      "platform_ai_settings",
      "platform_ai_jobs",
      "platform_ai_runs",
    ])
      await assert.rejects(
        () => value(`select count(*) from public.${table}`),
        /permission denied/,
      );
    await assert.rejects(summary, /permission denied/);
    await assert.rejects(
      () => request("lead", initialLead),
      /permission denied/,
    );
  },
);

await check(
  "admin settings use CAS, validate limits, and never allow direct table or snapshot writes",
  async () => {
    await as(ids.admin);
    const original = await settings();
    const updated = await save(original);
    assert.equal(updated.authorized_by, ids.admin);
    await assert.rejects(() => save(original), /version conflict/);
    await assert.rejects(
      () => save(updated, true, false, 51),
      /invalid ai settings/,
    );
    await assert.rejects(
      () => save(updated, true, false, 50, 501),
      /invalid ai settings/,
    );
    for (const table of [
      "platform_ai_settings",
      "platform_ai_jobs",
      "platform_ai_runs",
    ]) {
      await assert.rejects(
        () => db.exec(`delete from public.${table}`),
        /permission denied/,
      );
      await assert.rejects(
        () => db.exec(`insert into public.${table} default values`),
        /permission denied/,
      );
    }
    await assert.rejects(
      () => value("select * from private.platform_ai_gateway"),
      /permission denied/,
    );
  },
);

await check(
  "requests deduplicate snapshots; claim reserves quota once and omits direct contact identifiers",
  async () => {
    const id = await request("lead", initialLead);
    assert.equal(await request("lead", initialLead), id);
    await as(ids.admin);
    const before = await summary();
    const claimed = await nextClaim(id);
    assert.equal(claimed.snapshot.kind, "lead");
    assert.equal(claimed.snapshot.task, null);
    const data = JSON.stringify(claimed.snapshot);
    for (const forbidden of [
      "Sensitive contact",
      "Sensitive company",
      "secret@example.invalid",
      "5511999999999",
      "contact_name",
      "email",
      "phone",
      "company_name",
    ])
      assert.ok(!data.includes(forbidden));
    assert.equal(await claim(), null);
    await as(ids.admin);
    assert.equal(
      (await summary()).quota.daily_used,
      before.quota.daily_used + 1,
    );
    const stored = await job(id);
    assert.equal(stored.status, "processing");
    assert.ok(stored.consumed_at);
    assert.ok(!JSON.stringify(stored).includes(claimed.claim_token));
    await anon();
    await assert.rejects(
      () =>
        value("select public.platform_ai_finish($1,$2,$3,$4::jsonb,null)", [
          secret,
          id,
          "f".repeat(64),
          JSON.stringify(fixture),
        ]),
      /claim unavailable/,
    );
    assert.equal(await finish(claimed), true);
    assert.equal(await finish(claimed), true);
    await assert.rejects(
      () => finish(claimed, { ...fixture, input_tokens: 100 }),
      /result conflict/,
    );
    await as(ids.admin);
    assert.equal((await job(id)).status, "draft");
    assert.equal((await job(id)).usage_input_tokens, 25);
  },
);

await check(
  "save keeps a reviewable draft; approval creates exactly one internal sales note and no source updates",
  async () => {
    await as(ids.admin);
    const id = await request("lead", initialLead);
    const original = await job(id);
    const saved = await review(original, "save");
    assert.equal(saved.status, "draft");
    assert.equal(saved.applied_note_id, null);
    await assert.rejects(() => review(original, "approve"), /version conflict/);
    const before = await value(
      "select to_jsonb(l) from public.sales_leads l where id=$1",
      [initialLead],
    );
    const approved = await review(saved, "approve");
    assert.equal(approved.status, "approved");
    assert.ok(approved.applied_note_id);
    assert.deepEqual(
      await value("select to_jsonb(l) from public.sales_leads l where id=$1", [
        initialLead,
      ]),
      before,
    );
    assert.equal(
      (await review(saved, "approve")).applied_note_id,
      approved.applied_note_id,
    );
    assert.equal(
      Number(
        await value(
          "select count(*) from public.sales_activities where lead_id=$1 and kind='note'",
          [initialLead],
        ),
      ),
      1,
    );
    assert.equal(
      await request("lead", initialLead),
      id,
      "approved notes must not cause an automatic analysis loop",
    );
    await assert.rejects(
      () => review(approved, "approve", "Different body rejected"),
      /draft unavailable/,
    );
  },
);

await check(
  "closed/missing/demo sources and arbitrary source types cannot be queued",
  async () => {
    const demoTicket = await ticket(demo);
    await as(ids.admin);
    await assert.rejects(
      () => request("customer", randomUUID()),
      /invalid ai source/,
    );
    await assert.rejects(
      () => request("lead", randomUUID()),
      /source unavailable/,
    );
    await assert.rejects(
      () => request("ticket", demoTicket),
      /source unavailable/,
    );
  },
);

await check(
  "source changes before claim cancel stale work without consuming quota",
  async () => {
    const item = await newJob();
    await as(ids.admin);
    const before = (await summary()).quota.daily_used;
    await postgres();
    await db.query(
      "update public.sales_leads set version=version+1,challenge='Changed source' where id=$1",
      [item.source],
    );
    await anon();
    assert.equal(await claim(), null);
    await as(ids.admin);
    assert.equal((await job(item.id)).status, "stale");
    assert.equal((await summary()).quota.daily_used, before);
  },
);

await check(
  "changed source after an AI request discards its response and retains consumed quota",
  async () => {
    const item = await newJob();
    const claimed = await nextClaim(item.id);
    await postgres();
    await db.query(
      "update public.sales_leads set version=version+1 where id=$1",
      [item.source],
    );
    await anon();
    assert.equal(await finish(claimed), false);
    await as(ids.admin);
    const stored = await job(item.id);
    assert.equal(stored.status, "stale");
    assert.equal(stored.output, null);
    assert.ok(stored.consumed_at);
  },
);

await check(
  "changed source before approval rejects the stale draft and writes no note",
  async () => {
    const item = await newJob();
    const claimed = await nextClaim(item.id);
    await finish(claimed);
    await as(ids.admin);
    const draft = await job(item.id);
    await postgres();
    await db.query(
      "update public.sales_leads set version=version+1 where id=$1",
      [item.source],
    );
    await as(ids.admin);
    assert.equal((await review(draft, "approve")).status, "stale");
    assert.equal(
      Number(
        await value(
          "select count(*) from public.sales_activities where lead_id=$1",
          [item.source],
        ),
      ),
      0,
    );
  },
);

await check(
  "provider output rejects injected action fields, invalid types and excess size",
  async () => {
    const item = await newJob();
    const claimed = await nextClaim(item.id);
    for (const invalid of [
      null,
      [],
      "unexpected",
      { ...fixture, output: null },
      { ...fixture, output: [] },
      { ...fixture, output: { ...fixture.output, summary: null } },
      { ...fixture, input_tokens: "oops" },
      { ...fixture, output_tokens: null },
      { ...fixture, output: { ...fixture.output, company_id: ca } },
      { ...fixture, output: { ...fixture.output, priority: "admin" } },
      { ...fixture, output: { ...fixture.output, summary: "tiny" } },
      {
        ...fixture,
        output: { ...fixture.output, suggested_reply: "x".repeat(2001) },
      },
      { ...fixture, input_tokens: -1 },
      { ...fixture, input_tokens: 1.5 },
      { ...fixture, output_tokens: 1000001 },
      { ...fixture, model: "x".repeat(121) },
      { ...fixture, execute: "DROP TABLE" },
    ])
      await assert.rejects(() => finish(claimed, invalid), /invalid ai result/);
    assert.equal(await finish(claimed, null, "invalid_output"), true);
  },
);

await check(
  "lease expiry fails once without retry; late responses and injected raw errors are rejected",
  async () => {
    const item = await newJob();
    const claimed = await nextClaim(item.id);
    await assert.rejects(
      () => finish(claimed, null, "secret raw error text"),
      /invalid ai result/,
    );
    await postgres();
    await db.query(
      "update public.platform_ai_jobs set leased_until=now()-interval '1 second' where id=$1",
      [item.id],
    );
    await anon();
    assert.equal(await claim(), null);
    assert.equal(await finish(claimed), false);
    await as(ids.admin);
    assert.equal((await job(item.id)).status, "failed");
    assert.equal((await job(item.id)).error_code, "worker_interrupted");
    assert.equal(await request("lead", item.source), item.id);
  },
);

await check(
  "critical provider failure pauses generation without fabricated output or refunded quota",
  async () => {
    const item = await newJob();
    const claimed = await nextClaim(item.id);
    assert.equal(await finish(claimed, null, "verification_required"), true);
    await as(ids.admin);
    const stored = await job(item.id);
    assert.equal(stored.status, "failed");
    assert.equal(stored.output, null);
    assert.equal(stored.usage_input_tokens, null);
    assert.ok(stored.consumed_at);
    const paused = await summary();
    assert.equal(paused.settings.enabled, false);
    assert.equal(paused.last_error_code, "verification_required");
    await anon();
    assert.equal(await claim(), null);
    await value(
      "select public.platform_ai_worker_report($1,'scheduled','verification_required',0,1)",
      [secret],
    );
    await value(
      "select public.platform_ai_worker_report($1,'scheduled',null,0,0)",
      [secret],
    );
    await as(ids.admin);
    assert.equal((await summary()).last_error_code, "verification_required");
    assert.equal((await summary()).last_run?.processed, 0);
    await save(await settings());
  },
);

await check(
  "explicit retries preserve every reservation, reject duplicate requests and cap attempts per source/day",
  async () => {
    const item = await newJob();
    let claimed = await nextClaim(item.id);
    await finish(claimed, null, "provider_failed");
    await as(ids.admin);
    const first = await job(item.id);
    const before = (await summary()).quota.daily_used;
    const secondId = await retry(first);
    assert.equal((await job(secondId)).attempt, 2);
    await assert.rejects(() => retry(first), /already requested/);
    claimed = await nextClaim(secondId);
    await finish(claimed, null, "provider_failed");
    await as(ids.admin);
    const thirdId = await retry(await job(secondId));
    claimed = await nextClaim(thirdId);
    await finish(claimed, null, "provider_failed");
    await as(ids.admin);
    assert.equal((await summary()).quota.daily_used, before + 2);
    await assert.rejects(
      async () => retry(await job(thirdId)),
      /retry daily limit/,
    );
    assert.equal(await request("lead", item.source), thirdId);
  },
);

await check(
  "daily and monthly quotas are enforced before a new claim and survive setting reductions",
  async () => {
    const item = await newJob();
    await as(ids.admin);
    const before = await summary();
    await save(await settings(), true, false, before.quota.daily_used, 500);
    await anon();
    assert.equal(await claim(), null);
    await as(ids.admin);
    assert.equal((await job(item.id)).consumed_at, null);
    await save(await settings(), true, false, 50, before.quota.monthly_used);
    await anon();
    assert.equal(await claim(), null);
    await as(ids.admin);
    await save(await settings());
    const claimed = await nextClaim(item.id);
    await finish(claimed);
    await as(ids.admin);
    await review(await job(item.id), "discard", "");
  },
);

await check(
  "ticket drafts can be saved and approved internally without publishing a support response",
  async () => {
    const source = await ticket();
    const item = await newJob("ticket", source);
    const claimed = await nextClaim(item.id);
    assert.equal(claimed.snapshot.kind, "ticket");
    await finish(claimed);
    await as(ids.admin);
    const before = await value(
      "select to_jsonb(t) from public.support_tickets t where id=$1",
      [source],
    );
    const approved = await review(await job(item.id), "approve");
    assert.equal(approved.status, "approved");
    assert.equal(approved.applied_note_id, null);
    assert.deepEqual(
      await value(
        "select to_jsonb(t) from public.support_tickets t where id=$1",
        [source],
      ),
      before,
    );
  },
);

await check(
  "task-linked analysis resolves its authorized source and approval only adds an internal lead note",
  async () => {
    const source = await lead();
    await as(ids.admin);
    await value("select public.admin_run_operations()");
    const taskId = await value<string>(
      "select id from public.platform_tasks where rule_id='lead_followup' and entity_id=$1",
      [source],
    );
    const item = await newJob("task", taskId);
    const claimed = await nextClaim(item.id);
    assert.equal(claimed.snapshot.kind, "lead");
    assert.ok(claimed.snapshot.task);
    await finish(claimed);
    await as(ids.admin);
    const before = await value(
      "select to_jsonb(t) from public.platform_tasks t where id=$1",
      [taskId],
    );
    const approved = await review(await job(item.id), "approve");
    assert.ok(approved.applied_note_id);
    assert.deepEqual(
      await value(
        "select to_jsonb(t) from public.platform_tasks t where id=$1",
        [taskId],
      ),
      before,
    );
  },
);

await check(
  "pause preserves queued jobs and reviewed drafts, cancels only in-flight work, and allows explicit retry",
  async () => {
    const item = await newJob();
    const claimed = await nextClaim(item.id);
    const waiting = await newJob();
    const draftItem = await newJob();
    // Pick the waiting item first and complete it as a reviewable fixture.
    const waitingClaim = await nextClaim(waiting.id);
    await finish(waitingClaim);
    await as(ids.admin);
    await save(await settings(), false);
    assert.equal((await job(item.id)).status, "stale");
    assert.equal((await job(item.id)).error_code, "integration_paused");
    assert.equal((await job(draftItem.id)).status, "queued");
    assert.equal((await job(waiting.id)).status, "draft");
    assert.equal(
      (await review(await job(waiting.id), "approve")).status,
      "approved",
    );
    await anon();
    assert.equal(await claim(), null);
    await as(ids.admin);
    await save(await settings(), true);
    await anon();
    assert.equal(await finish(claimed), false);
    const resumed = await nextClaim(draftItem.id);
    await finish(resumed);
    await as(ids.admin);
    const retryId = await retry(await job(item.id));
    const retried = await nextClaim(retryId);
    await finish(retried);
    await as(ids.admin);
    assert.equal((await job(retryId)).status, "draft");
    assert.equal((await job(item.id)).status, "stale");
  },
);

await check(
  "a different admin replaces authority, invalidates old context, and can explicitly request a fresh attempt",
  async () => {
    const item = await newJob();
    await as(ids.admin);
    const original = await settings();
    await as(ids.admin2);
    const changed = await save(await settings(), false);
    assert.notEqual(changed.authorization_id, original.authorization_id);
    assert.equal((await job(item.id)).status, "stale");
    assert.equal((await job(item.id)).error_code, "authorization_revoked");
    await assert.rejects(
      async () => retry(await job(item.id)),
      /not authorized or disabled/,
    );
    await save(await settings(), true);
    const retryId = await retry(await job(item.id));
    const claimed = await nextClaim(retryId);
    await finish(claimed);
    await as(ids.admin2);
    assert.equal((await job(retryId)).status, "draft");
    assert.equal((await job(item.id)).output, null);
    await as(ids.admin);
    await save(await settings());
  },
);

await check(
  "revoked requesting administrator invalidates processing even when another admin owns settings",
  async () => {
    const source = await lead();
    await as(ids.admin2);
    const id = await request("lead", source);
    const claimed = await nextClaim(id);
    await postgres();
    await db.query("delete from private.platform_admins where user_id=$1", [
      ids.admin2,
    ]);
    await anon();
    assert.equal(await finish(claimed), false);
    await as(ids.admin);
    assert.equal((await job(id)).status, "stale");
    assert.equal((await job(id)).error_code, "authorization_revoked");
  },
);

await check(
  "revoked global authorization stops worker and new manual approvals immediately",
  async () => {
    const item = await newJob();
    const claimed = await nextClaim(item.id);
    await finish(claimed);
    await as(ids.admin);
    const draft = await job(item.id);
    await postgres();
    await db.query("delete from private.platform_admins where user_id=$1", [
      ids.admin,
    ]);
    await anon();
    assert.equal(await claim(), null);
    await as(ids.admin);
    await assert.rejects(() => review(draft, "approve"), /not authorized/);
    assert.equal(
      Number(await value("select count(*) from public.platform_ai_jobs")),
      0,
    );
    await postgres();
    await db.query("insert into private.platform_admins values($1)", [
      ids.admin,
    ]);
    await as(ids.admin);
    assert.equal((await job(item.id)).status, "stale");
    await save(await settings());
  },
);

await check(
  "automatic enqueue is bounded, disabled by flag, idempotent and records honest idle runs",
  async () => {
    await as(ids.admin);
    await save(await settings(), true, false);
    await anon();
    assert.deepEqual(await enqueue(), { enqueued: 0 });
    await as(ids.admin);
    await save(await settings(), true, true);
    await anon();
    const result = await enqueue(2);
    assert.ok(result.enqueued <= 2);
    await assert.rejects(() => enqueue(51), /invalid ai batch/);
    await value(
      "select public.platform_ai_worker_report($1,'scheduled',null,0,0)",
      [secret],
    );
    await assert.rejects(
      () =>
        value(
          "select public.platform_ai_worker_report($1,'scheduled',null,2,2)",
          [secret],
        ),
      /invalid ai report/,
    );
    await as(ids.admin);
    const data = await summary();
    assert.equal(data.last_run?.trigger, "scheduled");
    assert.equal(data.last_run?.processed, 0);
    assert.equal(data.last_run?.failed, 0);
  },
);

await db.close();
console.log(`Admin AI: ${passed} groups passed.`);
