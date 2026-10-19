import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { storageFixture } from "./storage-fixture";

const db = new PGlite({ extensions: { btree_gist } });
await db.exec(
  `create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`,
);
await db.exec(storageFixture);
for (const name of (await readdir("supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort())
  await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
const exists = await db.query<{ existing: string | null }>(
  "select to_regclass('public.support_tickets')::text as existing",
);
if (!exists.rows[0].existing)
  await db.exec(await readFile("supabase/drafts/help_center.sql", "utf8"));
const ownerA = randomUUID(),
  ownerB = randomUUID(),
  employee = randomUUID(),
  manager = randomUUID(),
  admin = randomUUID();
await db.query("insert into auth.users(id) values($1),($2),($3),($4),($5)", [
  ownerA,
  ownerB,
  employee,
  manager,
  admin,
]);
async function as(user: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
}
async function scalar(sql: string, args: unknown[] = []) {
  return String(
    Object.values(
      (await db.query<Record<string, unknown>>(sql, args)).rows[0],
    )[0],
  );
}
let passed = 0;
async function check(name: string, run: () => Promise<void>) {
  await run();
  passed++;
  console.log(`PASS help: ${name}`);
}
await as(ownerA);
const ca = await scalar("select public.create_company('Help A teste','salao')");
await as(ownerB);
const cb = await scalar("select public.create_company('Help B teste','salao')");
await db.exec("reset role");
await db.query(
  "insert into public.memberships values($1,$2,'EMPLOYEE'),($1,$3,'MANAGER')",
  [ca, employee, manager],
);
await db.query("insert into private.platform_admins values($1)", [admin]);
const draft = await scalar(
  "insert into public.help_articles(title,module,kind,body) values('Rascunho restrito','agenda','faq','Este rascunho deve ser visto apenas pelo administrador.') returning id",
);
const open = (
  company: string,
  key = randomUUID(),
  subject = "Dúvida de teste",
) =>
  scalar(
    "select public.open_support_ticket($1,$2,'agenda',$3,'Preciso de ajuda com os horários da agenda.')",
    [company, key, subject],
  );
await as(ownerA);
await check("published articles readable but drafts hidden", async () => {
  assert.ok(
    Number(await scalar("select count(*) from public.help_articles")) >= 12,
  );
  assert.equal(
    await scalar("select count(*) from public.help_articles where id=$1", [
      draft,
    ]),
    "0",
  );
});
await check("client cannot publish an article", async () => {
  await assert.rejects(
    () =>
      db.query(
        "insert into public.help_articles(title,module,kind,body,published) values('Teste indevido','agenda','faq','Conteúdo que o cliente não pode publicar.',true)",
      ),
    /row-level security/,
  );
});
await check("client cannot edit published content", async () => {
  assert.equal(
    (
      await db.query(
        "update public.help_articles set title='Modificação indevida' returning id",
      )
    ).rows.length,
    0,
  );
});
const requestKey = randomUUID();
const ticketA = await open(ca, requestKey);
await check("idempotent retry returns the same ticket", async () => {
  assert.equal(await open(ca, requestKey), ticketA);
  assert.equal(
    await scalar("select count(*) from public.support_tickets"),
    "1",
  );
});
await check("idempotency key cannot overwrite original content", async () => {
  await assert.rejects(
    () => open(ca, requestKey, "Outro assunto diferente"),
    /request key conflict/,
  );
});
await check("foreign company support submission denied", async () => {
  await assert.rejects(() => open(cb), /not authorized/);
});
await check("invalid module and message rejected in DB", async () => {
  await assert.rejects(
    () =>
      db.query(
        "select public.open_support_ticket($1,$2,'admin','Assunto','Mensagem longa mas módulo não autorizado.')",
        [ca, randomUUID()],
      ),
    /invalid ticket/,
  );
  await assert.rejects(
    () =>
      db.query(
        "select public.open_support_ticket($1,$2,'agenda','Assunto','curta')",
        [ca, randomUUID()],
      ),
    /invalid ticket/,
  );
});
await check(
  "direct insert cannot bypass rate limit and authorization",
  async () => {
    await assert.rejects(
      () =>
        db.query(
          "insert into public.support_tickets(company_id,requester_id,request_key,module,subject,message) values($1,$2,$3,'agenda','Tentativa direta','Uma mensagem com tamanho suficiente.')",
          [ca, ownerA, randomUUID()],
        ),
      /permission denied/,
    );
  },
);
await check("client cannot change ticket status or responses", async () => {
  await assert.rejects(
    () =>
      db.query(
        "update public.support_tickets set status='resolved' where id=$1",
        [ticketA],
      ),
    /permission denied/,
  );
  await assert.rejects(
    () =>
      db.query(
        "select public.respond_support_ticket($1,'resolved','Resolvido indevidamente.')",
        [ticketA],
      ),
    /not authorized/,
  );
});
await as(ownerB);
const ticketB = await open(cb);
await check("other tenant tickets are invisible", async () => {
  assert.equal(
    await scalar("select count(*) from public.support_tickets where id=$1", [
      ticketA,
    ]),
    "0",
  );
  assert.equal(
    await scalar("select count(*) from public.support_tickets"),
    "1",
  );
});
await as(employee);
const ticketEmployee = await open(ca);
await check("employee reads only own requests", async () => {
  assert.equal(
    await scalar("select count(*) from public.support_tickets"),
    "1",
  );
  assert.equal(
    await scalar("select id from public.support_tickets"),
    ticketEmployee,
  );
  assert.equal(
    await scalar("select count(*) from public.support_tickets where id=$1", [
      ticketA,
    ]),
    "0",
  );
});
await as(manager);
await check("manager reads own company requests only", async () => {
  assert.equal(
    await scalar("select count(*) from public.support_tickets"),
    "2",
  );
  assert.equal(
    await scalar("select count(*) from public.support_tickets where id=$1", [
      ticketB,
    ]),
    "0",
  );
});
await db.exec("reset role");
await db.query("update public.companies set status='suspended' where id=$1", [
  ca,
]);
await as(ownerA);
await check("support stays available for blocked subscriptions", async () => {
  await open(ca);
});
await check(
  "server rate limit allows five submissions and rejects sixth",
  async () => {
    await open(ca);
    await open(ca);
    await open(ca);
    await assert.rejects(() => open(ca), /support rate limit/);
  },
);
await check("idempotent retry still succeeds at rate limit", async () => {
  assert.equal(await open(ca, requestKey), ticketA);
});
await as(admin);
await check("super admin can see all requests and draft articles", async () => {
  assert.equal(
    await scalar("select count(*) from public.support_tickets"),
    "7",
  );
  assert.equal(
    await scalar("select count(*) from public.help_articles where id=$1", [
      draft,
    ]),
    "1",
  );
});
await check(
  "super admin publishes and unpublishes existing article",
  async () => {
    assert.equal(
      (
        await db.query(
          "update public.help_articles set published=true where id=$1 returning id",
          [draft],
        )
      ).rows.length,
      1,
    );
    await db.query(
      "update public.help_articles set published=false where id=$1",
      [draft],
    );
  },
);
await check("resolution requires a substantive response", async () => {
  await assert.rejects(
    () =>
      db.query("select public.respond_support_ticket($1,'resolved','')", [
        ticketA,
      ]),
    /invalid response/,
  );
});
await check(
  "super admin response becomes visible to company owner",
  async () => {
    await db.query(
      "select public.respond_support_ticket($1,'resolved','Confira a disponibilidade do profissional.')",
      [ticketA],
    );
    await as(ownerA);
    assert.equal(
      await scalar("select response from public.support_tickets where id=$1", [
        ticketA,
      ]),
      "Confira a disponibilidade do profissional.",
    );
    assert.equal(
      await scalar("select status from public.support_tickets where id=$1", [
        ticketA,
      ]),
      "resolved",
    );
  },
);
await db.exec("reset role");
await db.query(
  "delete from public.memberships where company_id=$1 and user_id=$2",
  [ca, employee],
);
await as(employee);
await check("removed member cannot read or open tickets", async () => {
  assert.equal(
    await scalar("select count(*) from public.support_tickets"),
    "0",
  );
  await assert.rejects(() => open(ca), /not authorized/);
});
await db.exec("reset role; set role anon");
await check("anonymous access to support data and RPCs denied", async () => {
  await assert.rejects(
    () => db.query("select * from public.support_tickets"),
    /permission denied/,
  );
  await assert.rejects(
    () => db.query("select * from public.help_articles"),
    /permission denied/,
  );
  await assert.rejects(() => open(ca), /permission denied/);
});
await db.close();
console.log(`PASS ${passed} help database checks`);
