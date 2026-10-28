import { installLegacyTrialFixtures } from "./legacy-trial-fixture";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";

// Disposable PostgreSQL fixture: Storage API sets the operation GUC in production.
// This verifies SQL authorization, not the external object storage HTTP service.
const db = new PGlite({ extensions: { btree_gist } });
await db.exec(`
create role anon nologin; create role authenticated nologin;
create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,created_at timestamptz default now(), unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated;
grant select on storage.objects to anon;
grant select,insert,update,delete on storage.objects to authenticated;
create function storage.allow_only_operation(operation text) returns boolean language sql stable as $$
  select coalesce(replace(current_setting('storage.operation',true),'storage.','') = replace(operation,'storage.',''),false)
$$;
grant execute on function storage.allow_only_operation(text) to anon,authenticated;
`);
const migrations = (await readdir("supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort();
for (const name of migrations)
  await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
await installLegacyTrialFixtures(db);
const a = "00000000-0000-4000-8000-000000000001",
  b = "00000000-0000-4000-8000-000000000002",
  employee = "00000000-0000-4000-8000-000000000003";
await db.query("insert into auth.users(id) values ($1),($2),($3)", [
  a,
  b,
  employee,
]);
const gateway = "fixture-only-gateway-capability";
await db.query(
  "insert into private.booking_gateway(secret_hash) values (encode(sha256(convert_to($1, 'UTF8')), 'hex'))",
  [gateway],
);
async function as(user: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    user || "",
  ]);
  await db.exec(user ? "set role authenticated" : "set role anon");
}
async function scalar(sql: string, args: unknown[] = []) {
  const result = await db.query<Record<string, unknown>>(sql, args);
  return Object.values(result.rows[0])[0];
}
async function operation(value: string) {
  await db.query("select set_config('storage.operation',$1,false)", [value]);
}
let passed = 0;
async function check(name: string, run: () => Promise<void>) {
  await run();
  passed++;
  console.log(`PASS ${name}`);
}
await as(a);
const ca = String(
  await scalar("select public.create_company('Marca A teste','salao')"),
);
await as(b);
const cb = String(
  await scalar("select public.create_company('Marca B teste','pet-shop')"),
);
const pa = `${ca}/00000000-0000-4000-8000-000000000011.png`,
  pb = `${cb}/00000000-0000-4000-8000-000000000012.png`;
const upload = (path: string) =>
  db.query(
    'insert into storage.objects(bucket_id,name,metadata) values (\'company-covers\',$1,\'{"size":100,"mimetype":"image/png"}\')',
    [path],
  );
const configure = async (
  company: string,
  path: string | null,
  published = false,
  capability = gateway,
) => {
  const current = await db.query<{ cover_path: string | null }>(
    "select cover_path from companies where id=$1",
    [company],
  );
  return db.query("select public.configure_company_cover($1,$2,$3,$4,$5)", [
    company,
    path,
    published,
    capability,
    current.rows[0]?.cover_path || null,
  ]);
};
await check(
  "storage bucket stays private and file limits are configured",
  async () => {
    await db.exec("reset role");
    const config = (
      await db.query<{
        public: boolean;
        file_size_limit: number;
        allowed_mime_types: string[];
      }>("select * from storage.buckets where id='company-covers'")
    ).rows[0];
    assert.equal(config.public, false);
    assert.equal(Number(config.file_size_limit), 768000);
    assert.deepEqual(config.allowed_mime_types, [
      "image/png",
      "image/jpeg",
      "image/webp",
    ]);
  },
);
await as(a);
await check(
  "owner saves company settings without changing commercial access",
  async () => {
    const trial = await scalar(
      "select trial_ends_at::text from companies where id=$1",
      [ca],
    );
    await db.query(
      "select public.configure_company_personalization($1,'Marca A atualizada','Descrição','Endereço','18997695445','blue','compact','day')",
      [ca],
    );
    assert.equal(
      await scalar("select display_density from companies where id=$1", [ca]),
      "compact",
    );
    assert.equal(
      await scalar("select trial_ends_at::text from companies where id=$1", [
        ca,
      ]),
      trial,
    );
    await assert.rejects(
      () =>
        db.query(
          "select public.configure_company_personalization($1,'Tentativa','Descrição','','','teal','comfortable','week')",
          [cb],
        ),
      /not authorized/,
    );
  },
);
await check(
  "storage upload isolates company prefix and rejects unsafe names",
  async () => {
    await upload(pa);
    await assert.rejects(() => upload(pb), /row-level security/);
    await assert.rejects(
      () => upload(`${ca}/../escape.png`),
      /row-level security/,
    );
    await assert.rejects(
      () => upload(`${ca}/00000000-0000-4000-8000-000000000015.svg`),
      /row-level security/,
    );
  },
);
await check(
  "cover attachment needs server capability and exact company ownership",
  async () => {
    await assert.rejects(
      () => configure(ca, pa, false, "incorrect"),
      /gateway unauthorized/,
    );
    await assert.rejects(() => configure(cb, pb), /not authorized/);
    await assert.rejects(() => configure(ca, pb), /invalid cover/);
    await assert.rejects(
      () => configure(ca, `${ca}/00000000-0000-4000-8000-000000000099.png`),
      /invalid cover/,
    );
    await configure(ca, pa);
    await assert.rejects(
      () =>
        db.query("update companies set cover_path=$1 where id=$2", [pa, ca]),
      /permission denied/,
    );
  },
);
await check(
  "oversized or unsafe stored objects cannot become a public cover",
  async () => {
    const invalid = `${ca}/00000000-0000-4000-8000-000000000088.png`;
    await db.query(
      "insert into storage.objects(bucket_id,name,metadata) values ('company-covers',$1,$2)",
      [invalid, JSON.stringify({ size: 768001, mimetype: "image/png" })],
    );
    await assert.rejects(() => configure(ca, invalid, true), /invalid cover/);
    await db.query("delete from storage.objects where name=$1", [invalid]);
    await db.query(
      "insert into storage.objects(bucket_id,name,metadata) values ('company-covers',$1,$2)",
      [invalid, JSON.stringify({ size: 100, mimetype: "image/svg+xml" })],
    );
    await assert.rejects(() => configure(ca, invalid, true), /invalid cover/);
    await db.query("delete from storage.objects where name=$1", [invalid]);
  },
);
await as(b);
await upload(pb);
await check(
  "another tenant cannot read or delete private cover files",
  async () => {
    assert.equal(
      Number(
        await scalar("select count(*) from storage.objects where name=$1", [
          pa,
        ]),
      ),
      0,
    );
    const result = await db.query(
      "delete from storage.objects where name=$1 returning id",
      [pa],
    );
    assert.equal(result.rows.length, 0);
  },
);
await as(a);
await check(
  "current cover cannot be deleted during concurrent cleanup",
  async () => {
    assert.equal(
      (
        await db.query(
          "delete from storage.objects where name=$1 returning id",
          [pa],
        )
      ).rows.length,
      0,
    );
    const replacement = `${ca}/00000000-0000-4000-8000-000000000013.webp`;
    await upload(replacement);
    assert.equal(
      await scalar("select public.configure_company_cover($1,$2,false,$3,$4)", [
        ca,
        replacement,
        gateway,
        pa,
      ]),
      pa,
    );
    await assert.rejects(
      () =>
        db.query("select public.configure_company_cover($1,$2,false,$3,$2)", [
          ca,
          pa,
          gateway,
        ]),
      /cover version conflict/,
    );
    assert.equal(
      (
        await db.query(
          "delete from storage.objects where name=$1 returning id",
          [pa],
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "delete from storage.objects where name=$1 returning id",
          [replacement],
        )
      ).rows.length,
      0,
    );
    await configure(ca, replacement, true);
  },
);
const replacement = `${ca}/00000000-0000-4000-8000-000000000013.webp`;
await db.query("select configure_booking($1,'marca-a-teste',true)", [ca]);
await as(null);
await check(
  "published cover is accessible only to exact signing operations",
  async () => {
    await operation("object.list");
    assert.equal(
      Number(await scalar("select count(*) from storage.objects")),
      0,
    );
    await operation("");
    assert.equal(
      Number(await scalar("select count(*) from storage.objects")),
      0,
    );
    await operation("object.sign");
    assert.equal(
      Number(await scalar("select count(*) from storage.objects")),
      1,
    );
    assert.equal(await scalar("select name from storage.objects"), replacement);
    assert.equal(
      (
        (await scalar("select public_catalog('marca-a-teste')")) as {
          cover_path: string;
        }
      ).cover_path,
      replacement,
    );
  },
);
await as(a);
await configure(ca, replacement, false);
await as(null);
await check(
  "unpublishing hides both catalog cover and anonymous signing",
  async () => {
    await operation("object.sign");
    assert.equal(
      Number(await scalar("select count(*) from storage.objects")),
      0,
    );
    assert.equal(
      (
        (await scalar("select public_catalog('marca-a-teste')")) as {
          cover_path: null;
        }
      ).cover_path,
      null,
    );
  },
);
await as(a);
await configure(ca, replacement, true);
await db.query("select configure_booking($1,'marca-a-teste',false)", [ca]);
await as(null);
await check(
  "disabling booking revokes the published cover and catalog",
  async () => {
    await operation("object.sign");
    assert.equal(
      Number(await scalar("select count(*) from storage.objects")),
      0,
    );
    assert.equal(await scalar("select public_catalog('marca-a-teste')"), null);
  },
);
await as(a);
await db.query("select configure_booking($1,'marca-a-teste',true)", [ca]);
await db.exec("reset role");
await db.query(
  "insert into memberships(company_id,user_id,role) values($1,$2,'EMPLOYEE')",
  [ca, employee],
);
await as(employee);
await check("employees cannot change branding or upload covers", async () => {
  await assert.rejects(() => configure(ca, replacement), /not authorized/);
  await assert.rejects(
    () => upload(`${ca}/00000000-0000-4000-8000-000000000014.png`),
    /row-level security/,
  );
  await assert.rejects(
    () =>
      db.query(
        "select public.configure_company_personalization($1,'Alteração','','','','teal','compact','day')",
        [ca],
      ),
    /not authorized/,
  );
});
await db.exec("reset role");
await db.query("update companies set status='past_due' where id=$1", [ca]);
await as(null);
await check(
  "inactive subscriptions hide public covers and catalogs",
  async () => {
    await operation("object.sign");
    assert.equal(
      Number(await scalar("select count(*) from storage.objects")),
      0,
    );
    assert.equal(await scalar("select public_catalog('marca-a-teste')"), null);
  },
);
await as(a);
await check("blocked owner cannot upload or change branding", async () => {
  await assert.rejects(
    () => upload(`${ca}/00000000-0000-4000-8000-000000000016.png`),
    /row-level security/,
  );
  await assert.rejects(
    () => configure(ca, replacement),
    /subscription blocked/,
  );
});
await db.close();
console.log(`${passed} cover / Storage RLS fixture checks passed`);
