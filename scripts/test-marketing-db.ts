import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { storageFixture } from "./storage-fixture";
import { installLegacyTrialFixtures } from "./legacy-trial-fixture";

// Disposable PostgreSQL only: no provider calls, account connections or live writes.
const db = new PGlite({ extensions: { btree_gist } });
await db.exec(
  "create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;",
);
await db.exec(storageFixture);
for (const file of (await readdir("supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort())
  await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
await installLegacyTrialFixtures(db);
const admin = randomUUID(),
  admin2 = randomUUID(),
  owner = randomUUID(),
  manager = randomUUID(),
  employee = randomUUID();
await db.query("insert into auth.users(id) values($1),($2),($3),($4),($5)", [
  admin,
  admin2,
  owner,
  manager,
  employee,
]);
await db.query("insert into private.platform_admins values($1),($2)", [
  admin,
  admin2,
]);
async function as(id: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id ?? "",
  ]);
  await db.exec(id ? "set role authenticated" : "set role anon");
}
async function scalar<T = unknown>(sql: string, args: unknown[] = []) {
  const r = await db.query<Record<string, T>>(sql, args);
  return Object.values(r.rows[0])[0];
}
let checks = 0;
async function check(label: string, run: () => Promise<void>) {
  await run();
  checks++;
  console.log(`PASS marketing: ${label}`);
}
type Campaign = {
  id: string;
  version: number;
  status: string;
  body: string;
  request_id: string;
};
const request = randomUUID();
const payload = {
  name: "Campanha TESTE",
  channel: "instagram",
  goal: "demo",
  niche: "salao",
  audience: "Pequenos salões de teste",
  brief: "Dados fictícios",
  budget_cents: 30000,
  headline: "",
  body: "",
  cta: "",
};
async function save(
  data: typeof payload = payload,
  id: string | null = null,
  version: number | null = null,
  requestId = request,
) {
  return scalar<Campaign>(
    "select public.marketing_save_campaign($1,$2,$3,$4::jsonb)",
    [requestId, id, version, JSON.stringify(data)],
  );
}
async function state(c: Campaign, status: string) {
  return scalar<Campaign>("select public.marketing_change_status($1,$2,$3)", [
    c.id,
    c.version,
    status,
  ]);
}
async function reserve(c: Campaign) {
  return scalar<string>("select public.marketing_begin_generation($1,$2)", [
    c.id,
    c.version,
  ]);
}
async function finish(
  id: string,
  output: unknown = null,
  error: string | null = null,
) {
  return scalar<string>(
    "select public.marketing_finish_generation($1,$2::jsonb,$3,$4,$5)",
    [
      id,
      output === null ? null : JSON.stringify(output),
      error,
      output === null ? null : 40,
      output === null ? null : 50,
    ],
  );
}
await as(admin);
let campaign = await save();
await check(
  "admin creates a private draft with planned budget and a durable event",
  async () => {
    assert.equal(campaign.status, "draft");
    assert.equal(campaign.version, 1);
    assert.equal(
      await scalar(
        "select count(*)::int from public.platform_marketing_events where campaign_id=$1",
        [campaign.id],
      ),
      1,
    );
    assert.equal(
      await scalar(
        "select budget_cents from public.platform_marketing_campaigns where id=$1",
        [campaign.id],
      ),
      30000,
    );
  },
);
await check(
  "creation replay is idempotent and changing a repeated request is rejected",
  async () => {
    assert.equal((await save()).id, campaign.id);
    await assert.rejects(
      () => save({ ...payload, name: "Outro teste" }),
      /request conflict/,
    );
    assert.equal(
      await scalar(
        "select count(*)::int from public.platform_marketing_campaigns",
      ),
      1,
    );
  },
);
await check(
  "ordinary identities and anonymous clients cannot read or invoke marketing writes",
  async () => {
    for (const person of [owner, manager, employee]) {
      await as(person);
      assert.equal(
        await scalar(
          "select count(*)::int from public.platform_marketing_campaigns",
        ),
        0,
      );
      assert.equal(
        await scalar(
          "select count(*)::int from public.platform_marketing_events",
        ),
        0,
      );
      await assert.rejects(() => save(), /admin required/);
      await assert.rejects(() => state(campaign, "archived"), /admin required/);
      await assert.rejects(() => reserve(campaign), /admin required/);
    }
    await as(null);
    await assert.rejects(() => save(), /permission denied/);
    await assert.rejects(
      () => scalar("select * from public.platform_marketing_campaigns"),
      /permission denied/,
    );
    await as(admin);
  },
);
await check(
  "direct table INSERT UPDATE DELETE are denied even to the admin identity",
  async () => {
    await assert.rejects(
      () =>
        db.query(
          "update public.platform_marketing_campaigns set status='approved' where id=$1",
          [campaign.id],
        ),
      /permission denied/,
    );
    await assert.rejects(
      () =>
        db.query(
          "delete from public.platform_marketing_campaigns where id=$1",
          [campaign.id],
        ),
      /permission denied/,
    );
    await assert.rejects(
      () =>
        db.query(
          "insert into public.platform_marketing_campaigns(name) values('TESTE')",
        ),
      /permission denied/,
    );
  },
);
await check(
  "forged payload keys, wrong types, invalid values and missing versions roll back",
  async () => {
    for (const bad of [
      { ...payload, status: "approved" },
      { ...payload, budget_cents: 1.5 },
      { ...payload, headline: null },
      { ...payload, goal: "publish" },
      { ...payload, body: "x".repeat(2201) },
    ]) {
      await assert.rejects(() =>
        scalar(
          "select public.marketing_save_campaign($1,null,null,$2::jsonb)",
          [randomUUID(), JSON.stringify(bad)],
        ),
      );
    }
    await assert.rejects(
      () => save(payload, campaign.id, null),
      /version conflict/,
    );
    await assert.rejects(
      () => state(campaign, "approved"),
      /invalid transition/,
    );
    await assert.rejects(() => state(campaign, "review"), /copy required/);
  },
);
const copy = {
  headline: "Organize a agenda",
  body: "Conheça a demonstração com dados fictícios antes de escolher.",
  cta: "Conhecer",
};
let complete = { ...payload, ...copy };
await check(
  "review requires copy and editing approved content resets approval atomically",
  async () => {
    campaign = await save(complete, campaign.id, campaign.version);
    campaign = await state(campaign, "review");
    campaign = await state(campaign, "approved");
    assert.equal(campaign.status, "approved");
    const old = campaign;
    campaign = await save(
      { ...complete, body: copy.body + " Novo texto." },
      campaign.id,
      campaign.version,
    );
    assert.equal(campaign.status, "draft");
    assert.equal(campaign.version, old.version + 1);
    await assert.rejects(
      () => save(complete, campaign.id, old.version),
      /version conflict/,
    );
  },
);
await check(
  "archive is recoverable, blocks editing and never creates a published state",
  async () => {
    campaign = await state(campaign, "archived");
    await assert.rejects(
      () => save(complete, campaign.id, campaign.version),
      /archived/,
    );
    await assert.rejects(() => reserve(campaign), /unavailable/);
    campaign = await state(campaign, "draft");
    await assert.rejects(
      () => state(campaign, "published"),
      /invalid transition/,
    );
  },
);
let job = await reserve(campaign);
await check(
  "AI attempts are durable and cannot overlap on the same campaign",
  async () => {
    await assert.rejects(() => reserve(campaign), /generation pending/);
    await assert.rejects(
      () => finish(job, { ...copy, script: "TESTE" }),
      /invalid generation/,
    );
    assert.equal(
      await scalar(
        "select status from public.platform_marketing_generations where id=$1",
        [job],
      ),
      "reserved",
    );
  },
);
await check(
  "a different admin cannot finalize a generation it did not request",
  async () => {
    await as(admin2);
    await assert.rejects(() => finish(job, copy), /unavailable/);
    await as(admin);
  },
);
await check(
  "AI success saves a draft once and repeated completion cannot overwrite it",
  async () => {
    assert.equal(await finish(job, copy), "succeeded");
    assert.equal(
      await finish(job, {
        ...copy,
        body: "Outro texto de teste jamais aplicado",
      }),
      "succeeded",
    );
    assert.equal(
      await scalar(
        "select body from public.platform_marketing_campaigns where id=$1",
        [campaign.id],
      ),
      copy.body,
    );
    campaign = await scalar<Campaign>(
      "select to_jsonb(c) from public.platform_marketing_campaigns c where id=$1",
      [campaign.id],
    );
  },
);
await check(
  "generation results for an edited campaign stay stale and never replace newer copy",
  async () => {
    job = await reserve(campaign);
    const edited = {
      ...complete,
      body: "Texto manual novo preservado contra uma geração antiga.",
    };
    campaign = await save(edited, campaign.id, campaign.version);
    assert.equal(await finish(job, copy), "stale");
    assert.equal(
      await scalar(
        "select body from public.platform_marketing_campaigns where id=$1",
        [campaign.id],
      ),
      edited.body,
    );
  },
);
await check(
  "provider failures retain consumption and do not modify campaign copy",
  async () => {
    job = await reserve(campaign);
    assert.equal(await finish(job, null, "verification_required"), "failed");
    assert.equal(
      await scalar(
        "select count(*)::int from public.platform_marketing_generations",
      ),
      3,
    );
    job = await reserve(campaign);
    await assert.rejects(
      () => finish(job, null, "unsanitized provider token"),
      /invalid generation/,
    );
    assert.equal(await finish(job, null, "provider_failed"), "failed");
  },
);
await check(
  "revocation removes current admin privileges before finalization",
  async () => {
    job = await reserve(campaign);
    await db.exec("reset role");
    await db.query("delete from private.platform_admins where user_id=$1", [
      admin,
    ]);
    await as(admin);
    await assert.rejects(() => finish(job, copy), /admin required/);
    await db.exec("reset role");
    await db.query("insert into private.platform_admins values($1)", [admin]);
    await as(admin);
    assert.equal(await finish(job, null, "provider_failed"), "failed");
  },
);
await check(
  "failed generations consume the shared daily limit and never authorize an eleventh call",
  async () => {
    while (
      (await scalar<number>(
        "select count(*)::int from public.platform_marketing_generations",
      )) < 10
    ) {
      const next = await reserve(campaign);
      await finish(next, null, "provider_failed");
    }
    await assert.rejects(() => reserve(campaign), /generation limit/);
    assert.equal(
      await scalar(
        "select count(*)::int from public.platform_marketing_generations",
      ),
      10,
    );
  },
);
await db.close();
console.log(
  `${checks} marketing database groups passed; no external publication, messages, spend or live database writes.`,
);
