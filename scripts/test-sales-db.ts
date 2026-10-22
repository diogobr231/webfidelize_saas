import { installLegacyTrialFixtures } from "./legacy-trial-fixture";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { storageFixture } from "./storage-fixture";

process.on("uncaughtException", (error) => {
  console.error(error.message);
  process.exit(1);
});

// Disposable local database only: no credentials, emails or remote writes.
const db = new PGlite({ extensions: { btree_gist } });
await db.exec(`create role anon nologin; create role authenticated nologin;
  create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
await db.exec(storageFixture);
for (const name of (await readdir("supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort())
  await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
await installLegacyTrialFixtures(db);

const ownerA = randomUUID(),
  ownerB = randomUUID(),
  manager = randomUUID(),
  employee = randomUUID(),
  admin = randomUUID();
await db.query<Record<string, unknown>>(
  "insert into auth.users(id) values($1),($2),($3),($4),($5)",
  [ownerA, ownerB, manager, employee, admin],
);
async function postgres() {
  await db.exec(
    "reset role; select set_config('request.jwt.claim.sub','',false)",
  );
}
async function as(user: string) {
  await postgres();
  await db.query<Record<string, unknown>>(
    "select set_config('request.jwt.claim.sub',$1,false)",
    [user],
  );
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
async function count(table: string) {
  return Number(await value(`select count(*) from ${table}`));
}
let passed = 0;
async function check(name: string, run: () => Promise<void>) {
  await run();
  passed++;
  console.log(`PASS sales: ${name}`);
}
const saveOffer = (input: unknown, id: string | null = null) =>
  value<string>("select public.admin_save_sales_offer($1,$2::jsonb)", [
    id,
    JSON.stringify(input),
  ]);
const saveLead = (
  input: unknown,
  id: string | null = null,
  version: number | null = null,
) =>
  value<string>("select public.admin_save_sales_lead($1,$2,$3::jsonb)", [
    id,
    version,
    JSON.stringify(input),
  ]);
const note = (id: string | null, body: string | null) =>
  value<string>("select public.admin_add_sales_note($1,$2)", [id, body]);
const summary = (offer: string | null = null) =>
  value<Record<string, unknown>>("select public.admin_sales_summary($1)", [
    offer,
  ]);
const secret = "local-disposable-sales-gateway-secret-123456789";
const capture = (
  input: unknown,
  request = randomUUID(),
  credential: string | null = secret,
) =>
  value<boolean>("select public.sales_capture($1,$2,$3::jsonb)", [
    credential,
    request,
    JSON.stringify(input),
  ]);
await as(ownerA);
const ca = await value<string>(
  "select public.create_company('Sales isolated A','salao')",
);
await as(ownerB);
const cb = await value<string>(
  "select public.create_company('Sales isolated B','clinica')",
);
await postgres();
await db.query<Record<string, unknown>>(
  "insert into public.memberships values($1,$2,'MANAGER'),($1,$3,'EMPLOYEE')",
  [ca, manager, employee],
);
await db.query<Record<string, unknown>>(
  "insert into private.platform_admins values($1)",
  [admin],
);
const companiesBefore = await db.query<Record<string, unknown>>(
  "select * from public.companies order by id",
);
const plansBefore = await db.query<Record<string, unknown>>(
  "select * from public.plans order by id",
);
const seeded = await value<string>(
  "select id from public.sales_offers where slug='web-fidelize'",
);
const offerInput = {
  slug: "teste-oferta",
  title: "Oferta teste local",
  summary: "Descrição de teste em banco descartável.",
  niche: null,
  active: true,
  published: false,
  setup_price_cents: null,
  monthly_price_cents: null,
};
const minimum = (offer = seeded) => ({
  offer_id: offer,
  contact_name: "Contato teste",
  company_name: "Empresa teste",
  phone: "(18) 99769-5445",
});
const inquiry = (email = "capture@example.invalid", offer = seeded) => ({
  ...minimum(offer),
  email,
  niche: "salao",
  team_size: "2-5",
  budget_range: "explore",
  timeline: "soon",
  decision_role: "owner",
  challenge: "Preciso organizar os meus horários.",
  consent: true,
  utm_source: "local",
  utm_medium: "test",
  utm_campaign: "verification",
});
let draft: string, manual: string, publicLead: string;

await check(
  "seed contains one actual offer and no invented prices or leads",
  async () => {
    assert.equal(await count("public.sales_offers"), 1);
    assert.equal(await count("public.sales_leads"), 0);
    const offer = (
      await db.query<Record<string, unknown>>(
        "select * from public.sales_offers where id=$1",
        [seeded],
      )
    ).rows[0];
    assert.equal(offer.published, true);
    assert.equal(offer.setup_price_cents, null);
    assert.equal(offer.monthly_price_cents, null);
  },
);
await check("super admin creates and reads draft offers", async () => {
  await as(admin);
  draft = await saveOffer(offerInput);
  assert.equal(await count("public.sales_offers"), 2);
});
await check(
  "anonymous and all company roles see only published active offers",
  async () => {
    for (const user of [null, ownerA, ownerB, manager, employee]) {
      if (user) await as(user);
      else await anon();
      assert.equal(await count("public.sales_offers"), 1);
      assert.equal(
        Number(
          await value("select count(*) from public.sales_offers where id=$1", [
            draft,
          ]),
        ),
        0,
      );
    }
  },
);
await check(
  "owner manager employee cannot call any admin mutation or summary",
  async () => {
    for (const user of [ownerA, ownerB, manager, employee]) {
      await as(user);
      await assert.rejects(() => saveOffer(offerInput), /not authorized/);
      await assert.rejects(() => saveLead(minimum()), /not authorized/);
      await assert.rejects(
        () => note(randomUUID(), "Nota indevida"),
        /not authorized/,
      );
      await assert.rejects(() => summary(), /not authorized/);
    }
  },
);
await check("anonymous has no administrative function privileges", async () => {
  await anon();
  await assert.rejects(() => saveOffer(offerInput), /permission denied/);
  await assert.rejects(() => saveLead(minimum()), /permission denied/);
  await assert.rejects(() => note(null, "Teste"), /permission denied/);
  await assert.rejects(() => summary(), /permission denied/);
});
await check("metadata forgery does not confer super admin", async () => {
  await as(ownerA);
  await db.exec(
    `select set_config('request.jwt.claims','{"role":"SUPER_ADMIN","user_metadata":{"role":"SUPER_ADMIN"}}',false)`,
  );
  await assert.rejects(() => saveLead(minimum()), /not authorized/);
  await db.exec("select set_config('request.jwt.claims','',false)");
});
await check("even super admin has no direct table writes", async () => {
  for (const user of [null, ownerA, manager, employee, admin]) {
    if (user) await as(user);
    else await anon();
    await assert.rejects(
      () =>
        db.query<Record<string, unknown>>(
          "insert into public.sales_offers(slug,title,summary) values('forged','Forged','Something invalid')",
        ),
      /permission denied/,
    );
    await assert.rejects(
      () =>
        db.query<Record<string, unknown>>(
          "update public.sales_offers set published=true",
        ),
      /permission denied/,
    );
    await assert.rejects(
      () =>
        db.query<Record<string, unknown>>("delete from public.sales_offers"),
      /permission denied/,
    );
    for (const table of ["sales_leads", "sales_activities"]) {
      await assert.rejects(
        () =>
          db.query<Record<string, unknown>>(
            `insert into public.${table}(id) values($1)`,
            [randomUUID()],
          ),
        /permission denied/,
      );
      await assert.rejects(
        () =>
          db.query<Record<string, unknown>>(`update public.${table} set id=id`),
        /permission denied/,
      );
      await assert.rejects(
        () => db.query<Record<string, unknown>>(`delete from public.${table}`),
        /permission denied/,
      );
    }
  }
});
await check(
  "offer validation blocks invalid prices booleans slug and unknown keys",
  async () => {
    await as(admin);
    for (const patch of [
      { active: false, published: true },
      { active: "true" },
      { setup_price_cents: -1 },
      { setup_price_cents: 1.1 },
      { monthly_price_cents: 1000000000 },
      { niche: "invalid" },
      { slug: "../bad" },
      { title: "a" },
      { summary: "x" },
      { actor_id: admin },
    ])
      await assert.rejects(
        () => saveOffer({ ...offerInput, ...patch }),
        /invalid sales input/,
      );
    await assert.rejects(() => saveOffer(null), /invalid sales input/);
    await assert.rejects(
      () => saveOffer(offerInput, randomUUID()),
      /sales record unavailable/,
    );
    await saveOffer(
      { ...offerInput, title: "Oferta revisada", setup_price_cents: 999999999 },
      draft,
    );
    assert.equal(
      await value("select title from public.sales_offers where id=$1", [draft]),
      "Oferta revisada",
    );
  },
);
await check(
  "manual minimum does not invent consent email or qualification",
  async () => {
    manual = await saveLead(minimum());
    const lead = (
      await db.query<Record<string, unknown>>(
        "select * from public.sales_leads where id=$1",
        [manual],
      )
    ).rows[0];
    assert.equal(lead.phone, "5518997695445");
    assert.equal(lead.source, "manual");
    assert.equal(lead.consent_at, null);
    for (const key of [
      "email",
      "niche",
      "team_size",
      "budget_range",
      "timeline",
      "decision_role",
      "challenge",
      "utm_source",
    ])
      assert.equal(lead[key], "");
    assert.equal(lead.version, 1);
    assert.equal(lead.stage, "new");
    assert.equal(lead.closed_at, null);
    assert.equal(
      Number(
        await value(
          "select count(*) from public.sales_activities where lead_id=$1 and actor_id=$2",
          [manual, admin],
        ),
      ),
      1,
    );
  },
);
await check(
  "manual optional consent is timestamped only when true",
  async () => {
    const consented = await saveLead({
      ...minimum(),
      email: "LOWER@example.invalid",
      consent: true,
      source: "manual",
    });
    assert.equal(
      await value(
        "select consent_at is not null from public.sales_leads where id=$1",
        [consented],
      ),
      true,
    );
    assert.equal(
      await value("select email from public.sales_leads where id=$1", [
        consented,
      ]),
      "lower@example.invalid",
    );
  },
);
await check(
  "manual rejects malformed fields source injection null and browser timestamps",
  async () => {
    for (const patch of [
      { source: "site" },
      { consent_at: "2026-01-01" },
      { consent: "true" },
      { contact_name: null },
      { contact_name: "x" },
      { company_name: "x" },
      { phone: "180" },
      { phone: "1e999999999" },
      { email: "x@@y.z" },
      { team_size: "huge" },
      { challenge: "x".repeat(2001) },
      { offer_id: null },
      { offer_id: "bad" },
      { stage: "won" },
      { company_id: cb },
    ])
      await assert.rejects(
        () => saveLead({ ...minimum(), ...patch }),
        /invalid sales input/,
      );
    await assert.rejects(() => saveLead(null), /invalid sales input/);
    await assert.rejects(
      () => saveLead(minimum(randomUUID())),
      /sales record unavailable/,
    );
    await assert.rejects(
      () => saveLead(minimum(), null, 1),
      /invalid sales input/,
    );
  },
);
await check(
  "lead and activities RLS excludes every company role and anonymous",
  async () => {
    for (const user of [ownerA, ownerB, manager, employee]) {
      await as(user);
      assert.equal(await count("public.sales_leads"), 0);
      assert.equal(await count("public.sales_activities"), 0);
    }
    await anon();
    await assert.rejects(
      () => count("public.sales_leads"),
      /permission denied/,
    );
    await assert.rejects(
      () => count("public.sales_activities"),
      /permission denied/,
    );
    await as(admin);
    assert.equal(await count("public.sales_leads"), 2);
  },
);
await check(
  "optimistic update accepts corrected contact and preserves metadata",
  async () => {
    await saveLead(
      {
        phone: "+55 11 99999-8888",
        email: "CORRECTED@example.invalid",
        challenge: "",
        stage: "qualified",
        priority: "high",
        setup_value_cents: 123400,
        monthly_value_cents: 6990,
        next_action: "Conversar sobre a implantação",
        next_contact_at: "2020-01-01T12:00:00-03:00",
      },
      manual,
      1,
    );
    const row = (
      await db.query<Record<string, unknown>>(
        "select * from public.sales_leads where id=$1",
        [manual],
      )
    ).rows[0];
    assert.equal(row.version, 2);
    assert.equal(row.phone, "5511999998888");
    assert.equal(row.email, "corrected@example.invalid");
    assert.equal(row.consent_at, null);
    assert.equal(row.source, "manual");
    assert.equal(row.utm_source, "");
    for (const patch of [
      { source: "site" },
      { consent: true },
      { consent_at: "2026-01-01" },
      { utm_source: "changed" },
      { version: 22 },
      { created_at: "2026-01-01" },
      { actor_id: admin },
      { id: randomUUID() },
    ])
      await assert.rejects(
        () => saveLead(patch, manual, 2),
        /invalid sales input/,
      );
  },
);
await check(
  "stale and missing versions do not change row or audit history",
  async () => {
    const before = await count("public.sales_activities");
    await assert.rejects(
      () => saveLead({ stage: "won" }, manual, 1),
      /sales version conflict/,
    );
    await assert.rejects(
      () => saveLead({ stage: "won" }, manual),
      /sales version conflict/,
    );
    await assert.rejects(
      () => saveLead({ stage: "won" }, randomUUID(), 1),
      /sales record unavailable/,
    );
    assert.equal(await count("public.sales_activities"), before);
    assert.equal(
      await value("select stage from public.sales_leads where id=$1", [manual]),
      "qualified",
    );
  },
);
await check(
  "invalid edit values and empty patches fail atomically",
  async () => {
    for (const patch of [
      {},
      { stage: "fake" },
      { stage: null },
      { priority: "urgent" },
      { next_contact_at: "infinity" },
      { next_contact_at: "2026-02-31T00:00:00Z" },
      { next_contact_at: 42 },
      { setup_value_cents: -1 },
      { monthly_value_cents: "1000" },
      { next_action: "x".repeat(501) },
      { loss_reason: "x".repeat(1001) },
      { stage: "lost", loss_reason: "" },
      { stage: "lost", loss_reason: " a " },
    ])
      await assert.rejects(
        () => saveLead(patch, manual, 2),
        /invalid sales input/,
      );
    assert.equal(
      await value("select version from public.sales_leads where id=$1", [
        manual,
      ]),
      2,
    );
  },
);
await check(
  "concurrent CAS submissions yield exactly one update in local engine",
  async () => {
    const results = await Promise.allSettled([
      saveLead({ stage: "discovery" }, manual, 2),
      saveLead({ stage: "proposal" }, manual, 2),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    assert.equal(
      await value("select version from public.sales_leads where id=$1", [
        manual,
      ]),
      3,
    );
  },
);
await check("won lost and reopen have coherent closure and audit", async () => {
  await saveLead({ stage: "won" }, manual, 3);
  const closed = await value(
    "select closed_at from public.sales_leads where id=$1",
    [manual],
  );
  assert.ok(closed);
  await saveLead({ stage: "won", next_action: "Implantação" }, manual, 4);
  assert.deepEqual(
    await value("select closed_at from public.sales_leads where id=$1", [
      manual,
    ]),
    closed,
  );
  await saveLead({ stage: "negotiation" }, manual, 5);
  assert.equal(
    await value("select closed_at from public.sales_leads where id=$1", [
      manual,
    ]),
    null,
  );
  await saveLead(
    { stage: "lost", loss_reason: "Sem orçamento neste momento" },
    manual,
    6,
  );
  assert.equal(
    await value(
      "select closed_at is not null from public.sales_leads where id=$1",
      [manual],
    ),
    true,
  );
  assert.ok(
    Number(
      await value(
        "select count(*) from public.sales_activities where lead_id=$1 and kind='stage_changed'",
        [manual],
      ),
    ) >= 4,
  );
});
await check(
  "notes are attributed and reject empty oversized or missing lead",
  async () => {
    const id = await note(
      manual,
      "  Cliente pediu uma conversa na próxima semana.  ",
    );
    const row = (
      await db.query<Record<string, unknown>>(
        "select * from public.sales_activities where id=$1",
        [id],
      )
    ).rows[0];
    assert.equal(row.actor_id, admin);
    assert.equal(row.kind, "note");
    assert.equal(row.body, "Cliente pediu uma conversa na próxima semana.");
    for (const text of [null, " ", "x".repeat(2001)])
      await assert.rejects(() => note(manual, text), /invalid sales input/);
    await assert.rejects(
      () => note(randomUUID(), "Sem contato"),
      /sales record unavailable/,
    );
  },
);
await check(
  "private configuration ledger helpers remain inaccessible",
  async () => {
    for (const user of [null, ownerA, admin]) {
      if (user) await as(user);
      else await anon();
      for (const table of ["sales_gateway_config", "sales_capture_requests"])
        await assert.rejects(
          () => count(`private.${table}`),
          /permission denied/,
        );
      await assert.rejects(
        () =>
          db.query<Record<string, unknown>>(
            "select private.sales_contact('{}',false)",
          ),
        /permission denied/,
      );
      await assert.rejects(
        () =>
          db.query<Record<string, unknown>>(
            "select private.lock_sales_admin()",
          ),
        /permission denied/,
      );
    }
  },
);
await check(
  "capture gateway fails closed before provisioning and with bad secret",
  async () => {
    await anon();
    await assert.rejects(() => capture(inquiry()), /sales capture unavailable/);
    await postgres();
    await db.query<Record<string, unknown>>(
      "update private.sales_gateway_config set secret_hash=$1",
      [createHash("sha256").update(secret).digest("hex")],
    );
    await anon();
    for (const key of [
      null,
      "",
      "wrong",
      "wrong-secret-with-sufficient-length-123456789",
    ])
      await assert.rejects(
        () => capture(inquiry(), randomUUID(), key),
        /sales capture unavailable/,
      );
    await assert.rejects(
      () =>
        db.query<Record<string, unknown>>(
          "select public.sales_capture($1,null,$2::jsonb)",
          [secret, JSON.stringify(inquiry())],
        ),
      /sales capture unavailable/,
    );
  },
);
await check(
  "public capture rejects missing qualification consent and privilege fields",
  async () => {
    for (const patch of [
      { consent: false },
      { consent: "true" },
      { email: "" },
      { niche: "" },
      { team_size: "" },
      { timeline: "" },
      { decision_role: "" },
      { budget_range: "" },
      { challenge: "x" },
      { utm_medium: "x".repeat(121) },
      { stage: "won" },
      { source: "manual" },
      { setup_value_cents: 0 },
      { consent_at: "2026-01-01" },
      { id: randomUUID() },
    ])
      await assert.rejects(
        () => capture({ ...inquiry(), ...patch }),
        /invalid sales input/,
      );
    await assert.rejects(() => capture(null), /invalid sales input/);
    await assert.rejects(() => capture([]), /invalid sales input/);
    await assert.rejects(
      () => capture(inquiry("draft@example.invalid", draft)),
      /sales capture unavailable/,
    );
    await assert.rejects(
      () => capture(inquiry("foreign@example.invalid", randomUUID())),
      /sales capture unavailable/,
    );
  },
);
const firstNonce = randomUUID();
await check(
  "fresh capture returns only true and stores normalized real consent",
  async () => {
    assert.equal(
      await capture(inquiry("CAPTURE@example.invalid"), firstNonce),
      true,
    );
    await as(admin);
    const row = (
      await db.query<Record<string, unknown>>(
        "select * from public.sales_leads where email='capture@example.invalid'",
      )
    ).rows[0];
    publicLead = String(row.id);
    assert.equal(row.source, "site");
    assert.equal(row.stage, "new");
    assert.equal(row.version, 1);
    assert.ok(row.consent_at);
    assert.equal(row.utm_source, "local");
    assert.equal(row.phone, "5518997695445");
    assert.equal(
      await value(
        "select actor_id from public.sales_activities where lead_id=$1",
        [publicLead],
      ),
      null,
    );
  },
);
await check(
  "exact nonce replay is durable and divergent payload is rejected",
  async () => {
    await anon();
    assert.equal(await capture(inquiry(), firstNonce), true);
    await assert.rejects(
      () =>
        capture(
          { ...inquiry(), company_name: "Different company" },
          firstNonce,
        ),
      /sales capture unavailable/,
    );
    await postgres();
    assert.equal(await count("private.sales_capture_requests"), 1);
    assert.equal(
      Number(
        await value(
          "select count(*) from public.sales_leads where email='capture@example.invalid'",
        ),
      ),
      1,
    );
  },
);
await check(
  "dedupe does not overwrite contact consent qualification or audit",
  async () => {
    await as(admin);
    const before = (
      await db.query<Record<string, unknown>>(
        "select * from public.sales_leads where id=$1",
        [publicLead],
      )
    ).rows[0];
    const activities = await count("public.sales_activities");
    await anon();
    assert.equal(
      await capture({
        ...inquiry(),
        company_name: "Other submitted name",
        challenge: "Outro texto enviado pelo formulário.",
      }),
      true,
    );
    await as(admin);
    assert.deepEqual(
      (
        await db.query<Record<string, unknown>>(
          "select * from public.sales_leads where id=$1",
          [publicLead],
        )
      ).rows[0],
      before,
    );
    assert.equal(await count("public.sales_activities"), activities);
    await postgres();
    assert.equal(await count("private.sales_capture_requests"), 2);
  },
);
await check(
  "contact quota includes new duplicate nonces but exact retry remains safe",
  async () => {
    await anon();
    for (let i = 0; i < 3; i++) assert.equal(await capture(inquiry()), true);
    await assert.rejects(() => capture(inquiry()), /sales capture limit/);
    assert.equal(await capture(inquiry(), firstNonce), true);
    await postgres();
    assert.equal(await count("private.sales_capture_requests"), 5);
  },
);
await check(
  "capture quotas apply across authenticated and anonymous callers",
  async () => {
    await as(ownerA);
    await assert.rejects(() => capture(inquiry()), /sales capture limit/);
    await as(admin);
    await assert.rejects(() => capture(inquiry()), /sales capture limit/);
    await postgres();
    await db.exec(
      "update private.sales_capture_requests set created_at=now()-interval '2 hours'",
    );
    await as(employee);
    assert.equal(await capture(inquiry()), true);
    assert.equal(await count("public.sales_leads"), 0);
  },
);
await check(
  "expired dedupe window creates a new request without modifying history",
  async () => {
    await postgres();
    await db.query<Record<string, unknown>>(
      "update public.sales_leads set created_at=now()-interval '25 hours' where id=$1",
      [publicLead],
    );
    await anon();
    assert.equal(await capture(inquiry()), true);
    await as(admin);
    assert.equal(
      Number(
        await value(
          "select count(*) from public.sales_leads where email='capture@example.invalid'",
        ),
      ),
      2,
    );
  },
);
await check(
  "rolling global quota rejects request 101 and rejected writes leave no ledger",
  async () => {
    await postgres();
    await db.exec(
      "update private.sales_capture_requests set created_at=now()-interval '2 hours'",
    );
    await db.exec(`insert into private.sales_capture_requests(request_id,payload_hash,contact_hash,created_at)
    select gen_random_uuid(),repeat('a',64),encode(sha256(convert_to('quota-'||n::text,'UTF8')),'hex'),now() from generate_series(1,99) n`);
    await anon();
    const responses = await Promise.allSettled([
      capture(inquiry("boundary-a@example.invalid")),
      capture(inquiry("boundary-b@example.invalid")),
    ]);
    assert.equal(responses.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(responses.filter((r) => r.status === "rejected").length, 1);
    await assert.rejects(
      () => capture(inquiry("boundary-c@example.invalid")),
      /sales capture limit/,
    );
    await postgres();
    assert.equal(
      Number(
        await value(
          "select count(*) from private.sales_capture_requests where created_at>now()-interval '1 hour'",
        ),
      ),
      100,
    );
  },
);
await check(
  "unpublished offer blocks new capture while exact prior receipt stays idempotent",
  async () => {
    await as(admin);
    const seedInput = (
      await db.query<Record<string, unknown>>(
        "select slug,title,summary,niche,active,published,setup_price_cents,monthly_price_cents from public.sales_offers where id=$1",
        [seeded],
      )
    ).rows[0];
    await saveOffer({ ...seedInput, active: false, published: false }, seeded);
    await anon();
    await assert.rejects(
      () => capture(inquiry("disabled@example.invalid")),
      /sales capture unavailable/,
    );
    assert.equal(await capture(inquiry(), firstNonce), true);
    assert.equal(await count("public.sales_offers"), 0);
    await as(admin);
    await saveOffer({ ...seedInput, active: true, published: true }, seeded);
  },
);
await check(
  "summary uses actual filtered values with coherent empty counts",
  async () => {
    await as(admin);
    const won = await saveLead(minimum(draft));
    await saveLead(
      { stage: "won", setup_value_cents: 50000, monthly_value_cents: 20000 },
      won,
      1,
    );
    const overdue = await saveLead(minimum(draft));
    await saveLead(
      {
        stage: "proposal",
        setup_value_cents: 10000,
        monthly_value_cents: 3000,
        next_contact_at: "2020-01-01T00:00:00Z",
      },
      overdue,
      1,
    );
    assert.deepEqual(await summary(draft), {
      total: 2,
      open: 1,
      won: 1,
      lost: 0,
      overdue: 1,
      setup_pipeline_cents: 10000,
      monthly_pipeline_cents: 3000,
      won_setup_cents: 50000,
      won_monthly_cents: 20000,
      by_stage: {
        new: 0,
        qualified: 0,
        discovery: 0,
        proposal: 1,
        negotiation: 0,
        won: 1,
        lost: 0,
      },
    });
    const empty = await summary(randomUUID());
    assert.equal(empty.total, 0);
    assert.equal(empty.setup_pipeline_cents, 0);
    assert.equal(
      Object.values(empty.by_stage as object).reduce(
        (a: number, b: number) => a + b,
        0,
      ),
      0,
    );
    const all = await summary();
    assert.equal(all.total, await count("public.sales_leads"));
  },
);
await check(
  "revoked admin loses select and mutations with still present JWT",
  async () => {
    await postgres();
    await db.query<Record<string, unknown>>(
      "delete from private.platform_admins where user_id=$1",
      [admin],
    );
    await as(admin);
    assert.equal(await count("public.sales_leads"), 0);
    assert.equal(await count("public.sales_activities"), 0);
    await assert.rejects(() => saveLead(minimum()), /not authorized/);
    await assert.rejects(() => summary(), /not authorized/);
  },
);
await check(
  "all business billing and tenant data remains unchanged",
  async () => {
    await postgres();
    assert.deepEqual(
      (
        await db.query<Record<string, unknown>>(
          "select * from public.companies order by id",
        )
      ).rows,
      companiesBefore.rows,
    );
    assert.deepEqual(
      (
        await db.query<Record<string, unknown>>(
          "select * from public.plans order by id",
        )
      ).rows,
      plansBefore.rows,
    );
    assert.equal(
      Number(
        await value(
          "select count(*) from public.memberships where company_id=$1 and user_id=$2 and role='OWNER'",
          [ca, ownerA],
        ),
      ),
      1,
    );
    assert.equal(
      Number(
        await value(
          "select count(*) from public.memberships where company_id=$1 and user_id=$2 and role='OWNER'",
          [cb, ownerB],
        ),
      ),
      1,
    );
  },
);
await check(
  "requested plan prices and limits persist without altering billing",
  async () => {
    await postgres();
    assert.deepEqual(
      (
        await db.query(
          "select id,price_cents,staff_limit from public.plans order by price_cents",
        )
      ).rows,
      [
        { id: "essencial", price_cents: 4990, staff_limit: 1 },
        { id: "profissional", price_cents: 8990, staff_limit: 3 },
        { id: "empresarial", price_cents: 14990, staff_limit: 10 },
      ],
    );
  },
);
await check(
  "SQL accepts new plan interests, preserves legacy bands and rejects invented plans",
  async () => {
    await postgres();
    for (const budget_range of [
      "plan-essencial",
      "plan-profissional",
      "plan-empresarial",
      "other",
      "1000-3000",
    ]) {
      const result = await value<{ budget_range: string }>(
        "select private.sales_contact($1::jsonb,true)",
        [JSON.stringify({ ...inquiry(), budget_range })],
      );
      assert.equal(result.budget_range, budget_range);
    }
    await assert.rejects(
      () =>
        value("select private.sales_contact($1::jsonb,true)", [
          JSON.stringify({ ...inquiry(), budget_range: "plan-admin" }),
        ]),
      /invalid sales input/,
    );
  },
);
await db.close();
console.log(
  `${passed} sales database groups passed. PGlite serializes statements; real multi-connection lock races require separate PostgreSQL validation.`,
);
