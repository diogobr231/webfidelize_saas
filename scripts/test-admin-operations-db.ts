import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { storageFixture } from "./storage-fixture";
import { installLegacyTrialFixtures } from "./legacy-trial-fixture";

// Disposable PostgreSQL only: no remote writes, credentials or outgoing messages.
const db = new PGlite({ extensions: { btree_gist } });
await db.exec(`create role anon nologin; create role authenticated nologin;
  create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
await db.exec(storageFixture);
for (const file of (await readdir("supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort())
  await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
await installLegacyTrialFixtures(db);

const ids = {
  owner: randomUUID(),
  outsider: randomUUID(),
  manager: randomUUID(),
  employee: randomUUID(),
  admin: randomUUID(),
};
await db.query(
  "insert into auth.users(id) values($1),($2),($3),($4),($5)",
  Object.values(ids),
);
async function postgres() {
  await db.exec(
    "reset role; select set_config('request.jwt.claim.sub','',false)",
  );
}
async function as(user: string) {
  await postgres();
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
}
async function scalar<T = unknown>(
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
  console.log(`PASS admin operations: ${name}`);
}
type Rule = {
  id: string;
  enabled: boolean;
  threshold_hours: number;
  updated_at: string;
};
type Task = {
  id: string;
  rule_id: string;
  entity_id: string;
  context_key: string;
  status: "open" | "done" | "resolved";
  updated_at: string;
  completed_at: string | null;
  snoozed_until: string | null;
  source_label: string;
  title: string;
};
type Run = {
  id: string;
  trigger: string;
  status: "succeeded" | "failed";
  created_count: number;
  resolved_count: number;
  error_code: string | null;
  started_at: string;
  finished_at: string | null;
};
type Summary = {
  companies: Record<string, number>;
  sales: { open: number; overdue: number; new: number };
  support: { open: number; waiting: number };
  tasks: { open: number; done: number };
  last_run: Run | null;
  last_scheduled_run: Run | null;
};
const summary = () =>
  scalar<Summary>("select public.admin_operations_summary()");
const rules = () =>
  db.query<Rule>("select * from public.platform_automation_rules order by id");
const tasks = () =>
  db
    .query<{
      item: Task;
    }>(
      "select to_jsonb(t) as item from public.platform_tasks t order by created_at,id",
    )
    .then((r) => r.rows.map((row) => row.item));
const getTask = (id: string) =>
  scalar<Task>("select to_jsonb(t) from public.platform_tasks t where id=$1", [
    id,
  ]);
const rule = (id: string) =>
  scalar<Rule>(
    "select to_jsonb(r) from public.platform_automation_rules r where id=$1",
    [id],
  );
const manage = (item: Task, action: string) =>
  scalar<Task>("select public.admin_manage_task($1,$2,$3)", [
    item.id,
    action,
    item.updated_at,
  ]);
const save = (item: Rule, enabled: boolean, hours = item.threshold_hours) =>
  scalar<Rule>("select public.admin_save_automation($1,$2,$3,$4)", [
    item.id,
    enabled,
    hours,
    item.updated_at,
  ]);

await as(ids.owner);
const ca = await scalar<string>(
  "select public.create_company('Empresa A real local','salao')",
);
await as(ids.outsider);
const cb = await scalar<string>(
  "select public.create_company('Empresa B real local','clinica')",
);
await postgres();
await db.query(
  "insert into public.memberships values($1,$2,'MANAGER'),($1,$3,'EMPLOYEE')",
  [ca, ids.manager, ids.employee],
);
await db.query("insert into private.platform_admins values($1)", [ids.admin]);
const demo = await scalar<string>(
  "insert into public.companies(name,niche,is_demo) values('DEMO excluded','academia',true) returning id",
);
const pending = await scalar<string>(
  "insert into public.companies(name,niche,trial_card_required,status,trial_ends_at) values('Pending card','pet-shop',true,'pending_card',null) returning id",
);
const active = await scalar<string>(
  "insert into public.companies(name,niche) values('Active fixture','escritorio') returning id",
);
const suspended = await scalar<string>(
  "insert into public.companies(name,niche) values('Suspended fixture','restaurante') returning id",
);
const canceled = await scalar<string>(
  "insert into public.companies(name,niche) values('Canceled fixture','fornecedores') returning id",
);
await db.query(
  "update public.companies set trial_ends_at=now()+interval '24 hours' where id=$1",
  [ca],
);
await db.query(
  "update public.companies set trial_ends_at=now()-interval '1 hour' where id in ($1,$2)",
  [cb, demo],
);
await db.query("update public.companies set status='active' where id=$1", [
  active,
]);
await db.query("update public.companies set status='suspended' where id=$1", [
  suspended,
]);
await db.query("update public.companies set status='canceled' where id=$1", [
  canceled,
]);
const offer = await scalar<string>(
  "select id from public.sales_offers where slug='web-fidelize'",
);
async function lead(
  kind: "followup" | "idle" | "future" | "won",
  age = "48 hours",
) {
  await postgres();
  return scalar<string>(
    `insert into public.sales_leads(offer_id,company_name,contact_name,email,phone,source,stage,closed_at,next_contact_at,updated_at)
    values($1,'QA-OPS business','Sensitive contact','private@example.invalid','5511999999999','manual',$2,
      case when $2='won' then now() else null end,
      case when $3='followup' then now()-interval '2 hours' when $3='future' then now()+interval '1 day' else null end,
      now()-$4::interval) returning id`,
    [offer, kind === "won" ? "won" : "new", kind, age],
  );
}
const followup = await lead("followup");
const idle = await lead("idle");
await lead("future");
await lead("won");
await lead("idle", "1 hour");
async function ticket(company: string, old = true, status = "open") {
  await postgres();
  return scalar<string>(
    `insert into public.support_tickets(company_id,requester_id,request_key,module,subject,message,status,response,updated_at)
    values($1,$2,$3,'agenda','Private support subject','Private customer support body; must not be copied.',$4,
      case when $4='resolved' then 'Resolved fixture response' else '' end,
      case when $5 then now()-interval '48 hours' else now() end) returning id`,
    [company, ids.owner, randomUUID(), status, old],
  );
}
const support = await ticket(ca);
await ticket(demo);
await ticket(cb, false);
await ticket(ca, true, "resolved");

async function businessState() {
  return scalar<unknown>(`select jsonb_build_object(
    'companies',(select jsonb_agg(to_jsonb(c) order by id) from public.companies c),
    'plans',(select jsonb_agg(to_jsonb(p) order by id) from public.plans p),
    'leads',(select jsonb_agg(to_jsonb(l) order by id) from public.sales_leads l),
    'support',(select jsonb_agg(to_jsonb(s) order by id) from public.support_tickets s))`);
}
async function run(scheduled = false) {
  await postgres();
  const before = await businessState();
  if (!scheduled) await as(ids.admin);
  const result = await scalar<Run>(
    scheduled
      ? "select private.run_platform_automations('scheduled')"
      : "select public.admin_run_operations()",
  );
  await postgres();
  assert.deepEqual(
    await businessState(),
    before,
    "Automation changed a business record, card policy or plan",
  );
  await as(ids.admin);
  return result;
}

await check(
  "admin summary excludes demos, separates expired trials and shows actual source counts",
  async () => {
    await as(ids.admin);
    const data = await summary();
    assert.deepEqual(data.companies, {
      total: 6,
      demo: 1,
      pending_card: 1,
      trialing: 1,
      active: 1,
      expiring: 1,
      expired: 1,
      suspended: 1,
      canceled: 1,
    });
    assert.deepEqual(data.sales, { open: 4, overdue: 1, new: 4 });
    assert.deepEqual(data.support, { open: 2, waiting: 1 });
    assert.deepEqual(data.tasks, { open: 0, done: 0 });
    assert.equal(data.last_run, null);
    assert.equal(data.last_scheduled_run, null);
  },
);

await check(
  "owner, other company, manager, employee and forged metadata cannot see or mutate operations",
  async () => {
    for (const user of [ids.owner, ids.outsider, ids.manager, ids.employee]) {
      await as(user);
      await db.exec(
        `select set_config('request.jwt.claims','{"user_metadata":{"role":"SUPER_ADMIN"}}',false)`,
      );
      assert.equal((await rules()).rows.length, 0);
      assert.equal((await tasks()).length, 0);
      assert.equal(
        Number(
          await scalar("select count(*) from public.platform_automation_runs"),
        ),
        0,
      );
      await assert.rejects(summary, /not authorized/);
      await assert.rejects(
        () => scalar("select public.admin_run_operations()"),
        /not authorized/,
      );
      await assert.rejects(
        () =>
          scalar(
            "select public.admin_save_automation('lead_idle',false,1,now())",
          ),
        /not authorized/,
      );
      await assert.rejects(
        () =>
          scalar("select public.admin_manage_task($1,'done',now())", [
            randomUUID(),
          ]),
        /not authorized/,
      );
      await assert.rejects(
        () => scalar("select private.run_platform_automations('scheduled')"),
        /permission denied/,
      );
      await assert.rejects(
        () =>
          db.exec("update public.platform_automation_rules set enabled=false"),
        /permission denied/,
      );
    }
  },
);

await check(
  "anonymous roles cannot read internal tables or execute any public operation",
  async () => {
    await postgres();
    await db.exec("set role anon");
    for (const table of [
      "platform_tasks",
      "platform_automation_rules",
      "platform_automation_runs",
    ])
      await assert.rejects(
        () => scalar(`select count(*) from public.${table}`),
        /permission denied/,
      );
    await assert.rejects(summary, /permission denied/);
    await assert.rejects(
      () => scalar("select public.admin_run_operations()"),
      /permission denied/,
    );
    await assert.rejects(
      () =>
        scalar(
          "select public.admin_save_automation('lead_idle',false,1,now())",
        ),
      /permission denied/,
    );
    await assert.rejects(
      () =>
        scalar("select public.admin_manage_task($1,'done',now())", [
          randomUUID(),
        ]),
      /permission denied/,
    );
  },
);

await check(
  "admin can only write through guarded RPCs; scheduled worker is not exposed",
  async () => {
    await as(ids.admin);
    assert.equal((await rules()).rows.length, 4);
    for (const table of [
      "platform_tasks",
      "platform_automation_rules",
      "platform_automation_runs",
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
      () =>
        db.exec(
          "update public.platform_automation_rules set threshold_hours=1",
        ),
      /permission denied/,
    );
    await assert.rejects(
      () => scalar("select private.run_platform_automations('scheduled')"),
      /permission denied/,
    );
  },
);

await check(
  "all four rules create exactly the expected internal actions without exposing customer details",
  async () => {
    const result = await run();
    assert.equal(result.status, "succeeded");
    assert.equal(result.trigger, "manual");
    assert.equal(result.created_count, 5);
    assert.equal(result.resolved_count, 0);
    assert.equal(result.error_code, null);
    assert.ok(result.finished_at);
    const items = await tasks();
    assert.equal(items.filter((t) => t.rule_id === "lead_followup").length, 1);
    assert.equal(items.filter((t) => t.rule_id === "lead_idle").length, 1);
    assert.equal(items.filter((t) => t.rule_id === "trial_ending").length, 2);
    assert.equal(
      items.filter((t) => t.rule_id === "support_waiting").length,
      1,
    );
    assert.ok(!JSON.stringify(items).includes("Sensitive contact"));
    assert.ok(!JSON.stringify(items).includes("private@example.invalid"));
    assert.ok(!JSON.stringify(items).includes("Private support"));
    assert.ok(
      !items.some((t) => t.entity_id === demo || t.entity_id === pending),
    );
  },
);

await check(
  "repeat and scheduled runs are idempotent across connection timezones",
  async () => {
    const before = await tasks();
    await db.exec("set timezone='Pacific/Honolulu'");
    const result = await run(true);
    assert.equal(result.status, "succeeded");
    assert.equal(result.created_count, 0);
    assert.equal(result.resolved_count, 0);
    await db.exec("set timezone='UTC'");
    assert.deepEqual(await tasks(), before);
    const data = await summary();
    assert.equal(data.last_run?.id, result.id);
    assert.equal(data.last_scheduled_run?.id, result.id);
  },
);

await check(
  "done tasks stay completed across runs and require fresh versions for explicit reopening",
  async () => {
    const original = (await tasks()).find((t) => t.entity_id === followup)!;
    const done = await manage(original, "done");
    assert.equal(done.status, "done");
    assert.ok(done.completed_at);
    await assert.rejects(() => manage(original, "reopen"), /version conflict/);
    assert.equal((await run()).created_count, 0);
    assert.equal((await getTask(original.id)).status, "done");
    const reopened = await manage(done, "reopen");
    assert.equal(reopened.status, "open");
    assert.equal(reopened.completed_at, null);
    assert.equal(reopened.snoozed_until, null);
  },
);

await check(
  "snooze lasts 24 hours, survives runs, rejects stale forms and clears on completion",
  async () => {
    const original = (await tasks()).find((t) => t.entity_id === idle)!;
    const before = Date.now();
    const snoozed = await manage(original, "snooze24h");
    assert.equal(snoozed.status, "open");
    const delay = Date.parse(snoozed.snoozed_until!) - before;
    assert.ok(
      delay >= 24 * 60 * 60 * 1000 - 1000 &&
        delay <= 24 * 60 * 60 * 1000 + 5000,
    );
    await assert.rejects(() => manage(original, "done"), /version conflict/);
    await run();
    assert.equal(
      (await getTask(original.id)).snoozed_until,
      snoozed.snoozed_until,
    );
    const done = await manage(snoozed, "done");
    assert.equal(done.snoozed_until, null);
    await assert.rejects(
      () => manage(done, "snooze24h"),
      /invalid task action/,
    );
  },
);

await check(
  "changing a meaningful source deadline creates one new task and resolves only stale open work",
  async () => {
    const original = (await tasks()).find((t) => t.entity_id === followup)!;
    await postgres();
    await db.query(
      "update public.sales_leads set next_contact_at=next_contact_at-interval '1 hour' where id=$1",
      [followup],
    );
    const result = await run();
    assert.equal(result.created_count, 1);
    assert.equal(result.resolved_count, 1);
    assert.equal((await getTask(original.id)).status, "resolved");
    await assert.rejects(
      async () => manage(await getTask(original.id), "reopen"),
      /invalid task action/,
    );
    assert.equal(
      (await tasks()).filter(
        (t) => t.entity_id === followup && t.status === "open",
      ).length,
      1,
    );
    assert.equal((await run()).created_count, 0);
  },
);

await check(
  "closed leads, resolved support and changed trial deadlines retire open tasks without touching completed history",
  async () => {
    await postgres();
    await db.query(
      "update public.sales_leads set stage='won',closed_at=now() where id in ($1,$2)",
      [followup, idle],
    );
    await db.query(
      "update public.support_tickets set status='resolved',response='Answered in fixture',updated_at=now() where id=$1",
      [support],
    );
    await db.query(
      "update public.companies set trial_ends_at=now()+interval '10 days' where id=$1",
      [ca],
    );
    const result = await run();
    assert.equal(result.resolved_count, 3);
    assert.equal(
      (await tasks()).find((t) => t.entity_id === idle)?.status,
      "done",
    );
    assert.equal((await tasks()).filter((t) => t.status === "open").length, 1);
  },
);

await check(
  "paused rules retain existing work and defer new generation until enabled",
  async () => {
    let current = await rule("lead_idle");
    const paused = await save(current, false);
    await assert.rejects(() => save(current, true), /version conflict/);
    const newIdle = await lead("idle");
    await run();
    assert.ok(!(await tasks()).some((t) => t.entity_id === newIdle));
    await save(paused, true);
    assert.equal((await run()).created_count, 1);
    current = await rule("lead_idle");
    const pausedAgain = await save(current, false);
    await postgres();
    await db.query(
      "update public.sales_leads set stage='qualified' where id=$1",
      [newIdle],
    );
    assert.equal((await run()).resolved_count, 0);
    assert.equal(
      (await tasks()).find((t) => t.entity_id === newIdle)?.status,
      "open",
    );
    await save(pausedAgain, true);
    assert.equal((await run()).resolved_count, 1);
  },
);

await check(
  "threshold settings affect matching; invalid/null settings and actions are rejected",
  async () => {
    const current = await rule("lead_idle");
    await save(current, true, 1);
    assert.equal((await run()).created_count, 1);
    const now = await rule("lead_idle");
    for (const hours of [0, -1, 721])
      await assert.rejects(
        () => save(now, true, hours),
        /invalid automation settings/,
      );
    await assert.rejects(
      () =>
        scalar("select public.admin_save_automation('invented',true,1,now())"),
      /invalid automation settings/,
    );
    await assert.rejects(
      () =>
        scalar("select public.admin_save_automation('lead_idle',null,1,now())"),
      /invalid automation settings/,
    );
    await assert.rejects(
      () =>
        scalar("select public.admin_save_automation('lead_idle',true,1,null)"),
      /invalid automation settings/,
    );
    const item = (await tasks()).find((t) => t.status === "open")!;
    await assert.rejects(() => manage(item, "delete"), /invalid task action/);
    await assert.rejects(
      () =>
        scalar("select public.admin_manage_task($1,'done',null)", [item.id]),
      /invalid task action/,
    );
    await assert.rejects(
      () =>
        scalar("select public.admin_manage_task($1,'done',now())", [
          randomUUID(),
        ]),
      /task unavailable/,
    );
  },
);

await check(
  "auto-resolved work reactivates with the same identity when the source is due again; done remains done",
  async () => {
    const source = await lead("idle");
    await run();
    const original = (await tasks()).find((item) => item.entity_id === source)!;
    const previousRule = await rule("lead_idle");
    const delayed = await save(previousRule, true, 72);
    await run();
    assert.equal((await getTask(original.id)).status, "resolved");
    await save(delayed, true, 24);
    await run();
    const reopened = await getTask(original.id);
    assert.equal(reopened.status, "open");
    assert.equal(reopened.completed_at, null);
    assert.equal(
      (await tasks()).filter((item) => item.entity_id === source).length,
      1,
    );
    const completed = await manage(reopened, "done");
    await save(await rule("lead_idle"), true, 72);
    await run();
    await save(await rule("lead_idle"), true, 24);
    await run();
    assert.deepEqual(await getTask(original.id), completed);
  },
);

await check(
  "failed passes roll back all task changes while persisting a sanitized failure run",
  async () => {
    await lead("followup");
    await postgres();
    await db.exec(`create function private.operations_failure_fixture() returns trigger language plpgsql as $$begin raise exception 'secret@example.invalid PRIVATE FAILURE PAYLOAD'; end;$$;
    create trigger operations_failure_fixture before insert on public.platform_tasks for each row execute function private.operations_failure_fixture();`);
    await as(ids.admin);
    const before = await tasks();
    const result = await run();
    assert.equal(result.status, "failed");
    assert.equal(result.error_code, "operation_failed");
    assert.equal(result.created_count, 0);
    assert.equal(result.resolved_count, 0);
    assert.ok(result.finished_at);
    assert.deepEqual(await tasks(), before);
    assert.equal((await summary()).last_run?.id, result.id);
    assert.ok(!JSON.stringify(result).includes("PRIVATE FAILURE"));
    await postgres();
    await db.exec(
      "drop trigger operations_failure_fixture on public.platform_tasks; drop function private.operations_failure_fixture()",
    );
    assert.equal((await run()).created_count, 1);
  },
);

await check(
  "bounded passes progress beyond 250 candidates without starvation or duplicate work",
  async () => {
    await postgres();
    await db.query(
      `insert into public.sales_leads(offer_id,company_name,contact_name,phone,source,updated_at)
    select $1,'QA-OPS batch '||g,'Synthetic local only','5511999999999','manual',now()-interval '2 days' from generate_series(1,260) g`,
      [offer],
    );
    assert.equal((await run()).created_count, 250);
    assert.equal((await run()).created_count, 10);
    assert.equal((await run()).created_count, 0);
    assert.equal(
      (await tasks()).filter((t) => t.source_label.startsWith("QA-OPS batch"))
        .length,
      260,
    );
  },
);

await check(
  "admin removal takes effect immediately; source isolation remains unchanged",
  async () => {
    await as(ids.owner);
    const owned = await db.query<{ id: string }>(
      "select id from public.companies",
    );
    assert.deepEqual(
      owned.rows.map((r) => r.id),
      [ca],
    );
    assert.equal(
      Number(await scalar("select count(*) from public.platform_tasks")),
      0,
    );
    await postgres();
    await db.query("delete from private.platform_admins where user_id=$1", [
      ids.admin,
    ]);
    await as(ids.admin);
    await assert.rejects(summary, /not authorized/);
    await assert.rejects(
      () => scalar("select public.admin_run_operations()"),
      /not authorized/,
    );
    assert.equal(
      Number(await scalar("select count(*) from public.platform_tasks")),
      0,
    );
  },
);

await check(
  "security catalog uses invoker public wrappers and one consistent worker/config/task mutex",
  async () => {
    await postgres();
    const names = [
      "admin_run_operations",
      "admin_save_automation",
      "admin_manage_task",
      "admin_operations_summary",
    ];
    for (const name of names) {
      assert.equal(
        await scalar<boolean>(
          "select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1",
          [name],
        ),
        false,
      );
    }
    assert.equal(
      await scalar<boolean>(
        "select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='run_platform_automations'",
      ),
      false,
    );
    for (const name of [
      "run_platform_automations",
      "admin_save_automation",
      "admin_manage_task",
    ]) {
      assert.match(
        await scalar<string>(
          "select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=$1",
          [name],
        ),
        /web-fidelize:platform-operations/,
      );
    }
  },
);

await db.close();
console.log(`Admin operations: ${passed} groups passed.`);
