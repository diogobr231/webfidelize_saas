import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { storageFixture } from "./storage-fixture";
const db = new PGlite({ extensions: { btree_gist } });
await db.exec(
  "create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;",
);
await db.exec(storageFixture);
for (const file of (await readdir("supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort())
  await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
const admin = randomUUID(),
  owner = randomUUID(),
  employee = randomUUID(),
  company = randomUUID(),
  other = randomUUID(),
  postId = randomUUID();
await db.query("insert into auth.users(id) values($1),($2),($3)", [
  admin,
  owner,
  employee,
]);
await db.query("insert into private.platform_admins values($1)", [admin]);
await db.query(
  "insert into public.companies(id,name,niche) values($1,'TESTE Empresa A','escritorio'),($2,'TESTE Empresa B','salao')",
  [company, other],
);
await db.query(
  "insert into public.memberships(company_id,user_id,role) values($1,$2,'OWNER'),($1,$3,'EMPLOYEE')",
  [company, owner, employee],
);
async function as(id: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id ?? "",
  ]);
  await db.exec(id ? "set role authenticated" : "set role anon");
}
async function scalar<T>(sql: string, args: unknown[] = []) {
  return Object.values(
    (await db.query<Record<string, T>>(sql, args)).rows[0],
  )[0];
}
let checks = 0;
async function check(name: string, run: () => Promise<void>) {
  await run();
  console.log(`PASS social: ${name}`);
  checks++;
}
const payload = {
  account_id: null as string | null,
  title: "TESTE conteúdo fictício",
  caption: "Legenda fictícia sem publicação real.",
  alt_text: "TESTE foto",
  asset_path: `${company}/${postId}.jpg`,
  scheduled_at: new Date(Date.now() + 3600000).toISOString(),
  time_zone: "America/Sao_Paulo",
};
let account: string, post: { version: number; status: string };
await check(
  "owner, employee and anonymous cannot read admin data or write via RPC",
  async () => {
    for (const identity of [owner, employee, null]) {
      await as(identity);
      if (identity)
        assert.equal(
          await scalar<number>(
            "select count(*)::int from public.platform_social_posts",
          ),
          0,
        );
      await assert.rejects(
        scalar("select public.social_save_post($1,$2,null,$3::jsonb)", [
          postId,
          company,
          JSON.stringify(payload),
        ]),
      );
      await assert.rejects(
        scalar(
          "select public.social_connect($1,'instagram','12345678','TESTE',$2)",
          [company, "v1." + "x".repeat(80)],
        ),
      );
    }
  },
);
await check(
  "account association cannot cross companies, even through forged identifiers",
  async () => {
    await as(admin);
    account = await scalar<string>(
      "select public.social_connect($1,'instagram','12345678','TESTE conta',$2)",
      [company, "v1." + "x".repeat(80)],
    );
    await assert.rejects(
      scalar(
        "select public.social_connect($1,'instagram','12345678','TESTE',$2)",
        [other, "v1." + "x".repeat(80)],
      ),
      /another company/,
    );
    const otherAccount = await scalar<string>(
      "select public.social_connect($1,'instagram','98765432','TESTE outra',$2)",
      [other, "v1." + "x".repeat(80)],
    );
    await assert.rejects(
      scalar("select public.social_save_post($1,$2,null,$3::jsonb)", [
        postId,
        company,
        JSON.stringify({ ...payload, account_id: otherAccount }),
      ]),
      /mismatch/,
    );
    payload.account_id = account;
  },
);
await check(
  "private media is read by admin and denied to owners/employees/anon",
  async () => {
    await as(admin);
    await db.query(
      "insert into storage.objects(bucket_id,name) values('social-assets',$1)",
      [payload.asset_path],
    );
    for (const identity of [owner, employee, null]) {
      await as(identity);
      assert.equal(
        await scalar<number>(
          "select count(*)::int from storage.objects where bucket_id='social-assets'",
        ),
        0,
      );
    }
    await as(admin);
    assert.equal(
      await scalar<number>(
        "select count(*)::int from storage.objects where bucket_id='social-assets'",
      ),
      1,
    );
  },
);
await check(
  "draft persists, replay does not duplicate, direct writes are denied",
  async () => {
    post = await scalar(
      "select public.social_save_post($1,$2,null,$3::jsonb)",
      [postId, company, JSON.stringify(payload)],
    );
    assert.equal(post.status, "draft");
    assert.equal(
      (
        await scalar<{ version: number }>(
          "select public.social_save_post($1,$2,null,$3::jsonb)",
          [postId, company, JSON.stringify(payload)],
        )
      ).version,
      1,
    );
    await assert.rejects(
      db.query(
        "update public.platform_social_posts set status='published' where id=$1",
        [postId],
      ),
    );
    await assert.rejects(db.query("select * from private.social_credentials"));
    assert.equal(
      await scalar<number>(
        "select count(*)::int from public.platform_social_posts",
      ),
      1,
    );
  },
);
await check(
  "scheduling checks future time, version, media and currently connected account",
  async () => {
    await assert.rejects(
      db.query("select public.social_transition($1,9,'scheduled')", [postId]),
      /version/,
    );
    await db.query("select public.social_transition($1,1,'planned')", [postId]);
    await db.query("select public.social_transition($1,2,'scheduled')", [
      postId,
    ]);
    assert.equal(
      await scalar<string>(
        "select status from public.platform_social_posts where id=$1",
        [postId],
      ),
      "scheduled",
    );
    await assert.rejects(
      db.query("select public.social_save_post($1,$2,3,$3::jsonb)", [
        postId,
        company,
        JSON.stringify(payload),
      ]),
      /locked/,
    );
  },
);
await check(
  "revoking a connection removes authorization of scheduled posts",
  async () => {
    await db.query("select public.social_revoke($1)", [account]);
    assert.equal(
      await scalar<string>(
        "select status from public.platform_social_posts where id=$1",
        [postId],
      ),
      "planned",
    );
    await assert.rejects(
      db.query("select public.social_transition($1,4,'scheduled')", [postId]),
      /connection/,
    );
    await scalar(
      "select public.social_connect($1,'instagram','12345678','TESTE conta',$2)",
      [company, "v1." + "x".repeat(80)],
    );
  },
);
await check(
  "stale AI response never replaces an intervening edit",
  async () => {
    const generation = await scalar<string>(
      "select public.social_begin_generation($1,4)",
      [postId],
    );
    await db.query("select public.social_save_post($1,$2,4,$3::jsonb)", [
      postId,
      company,
      JSON.stringify({
        ...payload,
        caption: "Nova legenda manual preservada.",
      }),
    ]);
    assert.equal(
      await scalar<string>(
        "select public.social_finish_generation($1,'Resposta de IA fictícia e atrasada.')",
        [generation],
      ),
      "stale",
    );
    assert.equal(
      await scalar<string>(
        "select caption from public.platform_social_posts where id=$1",
        [postId],
      ),
      "Nova legenda manual preservada.",
    );
  },
);
await check(
  "worker requires private secret and cannot falsely confirm publication without ID",
  async () => {
    await db.query("select public.social_transition($1,5,'scheduled')", [
      postId,
    ]);
    await db.exec("reset role");
    await db.query(
      "update public.platform_social_posts set scheduled_at=now()-interval '1 minute' where id=$1",
      [postId],
    );
    const secret = "TESTE_ONLY_" + "z".repeat(40);
    await db.query(
      "insert into private.social_worker_configuration(secret_hash) values($1)",
      [createHash("sha256").update(secret).digest("hex")],
    );
    await as(null);
    await assert.rejects(
      scalar("select public.social_claim('wrong')"),
      /denied/,
    );
    const job = await scalar<{ id: string; attempt_id: string }>(
      "select public.social_claim($1)",
      [secret],
    );
    assert.equal(job.id, postId);
    await assert.rejects(
      db.query("select public.social_finish($1,$2,$3,'published',null)", [
        secret,
        postId,
        job.attempt_id,
      ]),
      /outcome/,
    );
    await db.query("select public.social_finish($1,$2,$3,'unknown',null)", [
      secret,
      postId,
      job.attempt_id,
    ]);
    assert.equal(
      await scalar("select public.social_claim($1)", [secret]),
      null,
    );
    await as(admin);
    assert.equal(
      await scalar<string>(
        "select status from public.platform_social_posts where id=$1",
        [postId],
      ),
      "unknown",
    );
  },
);
await check(
  "ad budgets persist separately and never activate an external campaign",
  async () => {
    const id = randomUUID(),
      data = {
        name: "TESTE plano",
        objective: "traffic",
        ad_account_id: "12345678",
        media_budget_cents: 60000,
        management_fee_cents: 69700,
        start_date: "2027-01-01",
        end_date: "2027-01-31",
        notes: "TESTE",
      };
    await db.query("select public.social_save_ad($1,$2,null,$3::jsonb)", [
      id,
      company,
      JSON.stringify(data),
    ]);
    assert.equal(
      await scalar<string>(
        "select status from public.platform_ad_plans where id=$1",
        [id],
      ),
      "draft",
    );
    await assert.rejects(
      db.query("select public.social_save_ad($1,$2,1,$3::jsonb)", [
        id,
        other,
        JSON.stringify(data),
      ]),
      /version/,
    );
    await as(owner);
    assert.equal(
      await scalar<number>(
        "select count(*)::int from public.platform_ad_plans",
      ),
      0,
    );
  },
);
await db.close();
console.log(
  `${checks} social database groups passed on disposable PostgreSQL; no external calls or production writes.`,
);
