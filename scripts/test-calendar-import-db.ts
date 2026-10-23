import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { storageFixture } from "./storage-fixture";
import { installLegacyTrialFixtures } from "./legacy-trial-fixture";

const db = new PGlite({ extensions: { btree_gist } });
await db.exec(`create role anon nologin; create role authenticated nologin;
  create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`);
await db.exec(storageFixture);
for (const file of (await readdir("supabase/migrations"))
  .filter((n) => n.endsWith(".sql"))
  .sort())
  await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
await installLegacyTrialFixtures(db);
async function scalar(sql: string, args: unknown[] = []) {
  const { rows } = await db.query<Record<string, unknown>>(sql, args);
  return Object.values(rows[0])[0];
}
async function as(user: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    user || "",
  ]);
  await db.exec(user ? "set role authenticated" : "set role anon");
}
let checks = 0;
async function check(label: string, fn: () => Promise<void>) {
  await fn();
  console.log(`PASS import: ${label}`);
  checks++;
}
const owner = randomUUID(),
  other = randomUUID(),
  employee = randomUUID(),
  manager = randomUUID();
for (const user of [owner, other, employee, manager])
  await db.query("insert into auth.users values($1,$2,now())", [
    user,
    `${user}@example.invalid`,
  ]);
await as(owner);
const company = String(
  await scalar("select create_company('QA import','academia')"),
);
const professional = String(
  await scalar(
    "insert into professionals(company_id,name) values($1,'QA profissional') returning id",
    [company],
  ),
);
const customer = String(
  await scalar(
    "insert into customers(company_id,name) values($1,'QA cliente') returning id",
    [company],
  ),
);
const service = String(
  await scalar(
    "insert into services(company_id,name,duration_minutes,price_cents) values($1,'QA serviço',30,0) returning id",
    [company],
  ),
);
await as(other);
const foreign = String(
  await scalar("select create_company('QA outra','salao')"),
);
const foreignProfessional = String(
  await scalar(
    "insert into professionals(company_id,name) values($1,'QA outro') returning id",
    [foreign],
  ),
);
await db.exec("reset role");
await db.query(
  "insert into memberships values($1,$2,'EMPLOYEE'),($1,$3,'MANAGER')",
  [company, employee, manager],
);
await db.query("delete from availability where company_id=$1", [company]);
await db.query(
  "insert into availability(company_id,professional_id,weekday,start_minute,end_minute) select $1,$2,n,480,1200 from generate_series(1,7) n",
  [company, professional],
);
await as(owner);
const day = String(await scalar("select (current_date + 2)::text"));
const key = (v: string) => createHash("sha256").update(v).digest("hex");
const item = (id: string, hour: number, kind = "block") => ({
  source_key: key(id),
  professional_id: professional,
  starts_at: `${day}T${hour}:00:00-03:00`,
  ends_at: `${day}T${hour}:30:00-03:00`,
  kind,
  ...(kind === "appointment"
    ? { customer_id: customer, service_id: service }
    : {}),
});
type Result = {
  items: { source_key: string; status: string; reason: string | null }[];
  imported: number;
  duplicates: number;
  conflicts: number;
  invalid: number;
};
const run = async (items: unknown[], dry = true, c = company) =>
  (await scalar("select import_calendar_entries($1,$2::jsonb,$3)", [
    c,
    JSON.stringify(items),
    dry,
  ])) as Result;
const count = async (table: string) =>
  Number(
    await scalar(`select count(*) from ${table} where company_id=$1`, [
      company,
    ]),
  );
await check(
  "preview validates without storing blocks or idempotency entries",
  async () => {
    const r = await run([item("a", 10), item("b", 11)]);
    assert.equal(r.imported, 0);
    assert.ok(
      r.items.every((x) => x.status === "ready"),
      JSON.stringify(r),
    );
    assert.equal(await count("schedule_blocks"), 0);
  },
);
await check(
  "atomic batch copies occupancy and same source retry creates no duplicate",
  async () => {
    const r = await run([item("a", 10), item("b", 11)], false);
    assert.equal(r.imported, 2);
    assert.equal(await count("schedule_blocks"), 2);
    const again = await run([item("a", 10), item("b", 11)], false);
    assert.equal(again.imported, 0);
    assert.equal(again.duplicates, 2);
  },
);
await check(
  "changed source cannot overwrite previous imported event",
  async () => {
    const r = await run([item("a", 12)], false);
    assert.equal(r.conflicts, 1);
    assert.equal(r.items[0].reason, "source_changed");
    assert.equal(await count("schedule_blocks"), 2);
  },
);
await check(
  "conflict rolls back every ready entry in the submitted batch",
  async () => {
    const r = await run([item("rollback", 12), item("conflict", 10)], false);
    assert.equal(r.conflicts, 1);
    assert.equal(r.imported, 0);
    assert.equal(await count("schedule_blocks"), 2);
    assert.equal((await run([item("rollback", 12)], false)).imported, 1);
  },
);
await check("overlap inside the batch is rejected atomically", async () => {
  const r = await run([item("same1", 13), item("same2", 13)], false);
  assert.equal(r.conflicts, 1);
  assert.equal(r.imported, 0);
  assert.equal(await count("schedule_blocks"), 3);
});
await check(
  "appointments require explicit same-company mapping and exact duration",
  async () => {
    assert.equal(
      (
        await run(
          [{ ...item("no-client", 14, "appointment"), customer_id: null }],
          false,
        )
      ).invalid,
      1,
    );
    assert.equal(
      (
        await run(
          [
            {
              ...item("duration", 14, "appointment"),
              ends_at: `${day}T15:00:00-03:00`,
            },
          ],
          false,
        )
      ).items[0].reason,
      "invalid_service_duration",
    );
    assert.equal(await count("appointments"), 0);
  },
);
await check(
  "mapped appointment uses existing appointment rules and survives retry",
  async () => {
    assert.equal(
      (await run([item("mapped", 14, "appointment")], false)).imported,
      1,
    );
    assert.equal(
      (await run([item("mapped", 14, "appointment")], false)).duplicates,
      1,
    );
    assert.equal(await count("appointments"), 1);
    assert.equal((await run([item("busy", 14)], false)).conflicts, 1);
  },
);
await check(
  "tenant and role restrictions apply on preview and commit",
  async () => {
    assert.equal(
      (
        await run(
          [{ ...item("cross", 15), professional_id: foreignProfessional }],
          false,
        )
      ).invalid,
      1,
    );
    await assert.rejects(
      () => run([item("bad", 15)], false, foreign),
      /not authorized/,
    );
    await as(employee);
    await assert.rejects(() => run([item("bad", 15)]), /not authorized/);
    await as(null);
    await assert.rejects(() => run([item("bad", 15)]), /permission denied/);
    await as(manager);
    assert.equal((await run([item("manager", 15)], false)).imported, 1);
    await as(owner);
  },
);
await check(
  "duplicates in one batch, malformed intervals and oversized batches fail closed",
  async () => {
    assert.equal(
      (await run([item("same", 16), item("same", 16)], false)).invalid,
      1,
    );
    assert.equal(
      (
        await run(
          [{ ...item("past", 16), starts_at: "2000-01-01T00:00:00Z" }],
          false,
        )
      ).invalid,
      1,
    );
    await assert.rejects(
      () =>
        run(
          Array.from({ length: 201 }, (_, i) => item(String(i), 16)),
          false,
        ),
      /invalid import batch/,
    );
    await assert.rejects(() => run([], false), /invalid import batch/);
  },
);
await check(
  "private source ledger is not readable to customers or anonymous clients",
  async () => {
    await assert.rejects(
      () => db.query("select * from private.calendar_import_entries"),
      /permission denied/,
    );
  },
);
await check(
  "class conflicts stop preview and commit atomically for imported appointments and blocks",
  async () => {
    const session = await scalar(
      "select save_class_session($1,null,null,$2,$3,'Turma import QA',$4,5,false)",
      [company, service, professional, `${day}T18:00:00-03:00`],
    );
    const beforeBlocks = await count("schedule_blocks");
    const beforeAppointments = await count("appointments");
    await db.exec("reset role");
    const beforeLedger = await count("private.calendar_import_entries");
    await as(owner);
    for (const kind of ["block", "appointment"])
      for (const dry of [true, false]) {
        const r = await run(
          [
            item(`ready-${kind}-${dry}`, 17),
            item(`class-${kind}-${dry}`, 18, kind),
          ],
          dry,
        );
        assert.equal(r.conflicts, 1);
        assert.equal(r.imported, 0);
        assert.equal(r.items[1].reason, "schedule_conflict");
        assert.equal(await count("schedule_blocks"), beforeBlocks);
        assert.equal(await count("appointments"), beforeAppointments);
        await db.exec("reset role");
        assert.equal(
          await count("private.calendar_import_entries"),
          beforeLedger,
        );
        await as(owner);
      }
    await scalar("select manage_class_session($1,$2,1,'cancel')", [
      company,
      session,
    ]);
    assert.equal((await run([item("class-released", 18)], false)).imported, 1);
  },
);
await check(
  "blocked subscription cannot import, including preview",
  async () => {
    await db.exec("reset role");
    await db.query("update companies set status='suspended' where id=$1", [
      company,
    ]);
    await as(owner);
    await assert.rejects(
      () => run([item("blocked", 17)], false),
      /subscription blocked/,
    );
  },
);
await db.close();
console.log(
  `${checks} calendar import database checks passed (disposable PostgreSQL).`,
);
