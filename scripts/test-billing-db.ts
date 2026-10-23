import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { storageFixture } from "./storage-fixture";

process.on(
  "uncaughtException",
  (error: Error & { position?: string; where?: string }) => {
    console.error(
      JSON.stringify({
        error: error.message,
        position: error.position,
        context: error.where,
      }),
    );
    process.exit(1);
  },
);

// This suite uses disposable PostgreSQL and synthetic provider responses only.
// It never contacts Mercado Pago/Supabase or uses any production credential.
const db = new PGlite({ extensions: { btree_gist } });
await db.exec(`create role anon nologin; create role authenticated nologin;
  create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
await db.exec(storageFixture);
const files = (await readdir("supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();
const migration = files.find((f) => f.endsWith("_mercado_pago_billing.sql"));
assert.ok(migration);
for (const file of files.filter((f) => f < migration))
  await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
async function scalar<T = unknown>(
  sql: string,
  args: unknown[] = [],
): Promise<T> {
  const result = await db.query<Record<string, T>>(sql, args);
  return Object.values(result.rows[0])[0];
}
async function postgres() {
  await db.exec(
    "reset role; select set_config('request.jwt.claim.sub','',false)",
  );
}
async function as(user: string | null) {
  await postgres();
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    user ?? "",
  ]);
  await db.exec(user ? "set role authenticated" : "set role anon");
}
let passed = 0;
async function check(name: string, run: () => Promise<void>) {
  await run();
  passed++;
  console.log(`PASS billing db: ${name}`);
}
const users = {
  a: randomUUID(),
  b: randomUUID(),
  card: randomUUID(),
  manager: randomUUID(),
  employee: randomUUID(),
  admin: randomUUID(),
};
for (const [name, id] of Object.entries(users))
  await db.query("insert into auth.users values($1,$2,now())", [
    id,
    `${name}@billing.example.invalid`,
  ]);
await db.query("insert into private.platform_admins values($1)", [users.admin]);
const companies: Record<string, string> = {};
for (const key of ["a", "b", "card"] as const) {
  await as(users[key]);
  companies[key] = await scalar<string>(
    "select public.create_company($1,'salao')",
    [`Synthetic billing ${key}`],
  );
}
await postgres();
await db.query(
  "insert into public.memberships values($1,$2,'MANAGER'),($1,$3,'EMPLOYEE')",
  [companies.a, users.manager, users.employee],
);
const original = await scalar(
  "select jsonb_agg(jsonb_build_object('id',id,'status',status,'trial',trial_ends_at,'plan',plan_id) order by id) from public.companies",
);
await db.exec(await readFile(`supabase/migrations/${migration}`, "utf8"));
for (const file of files.filter((f) => f > migration))
  await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
const secret = "isolated-billing-test-secret-at-least-32-characters";
type Checkout = {
  id: string;
  external_reference: string;
  provider_id: string | null;
  environment: string;
  status: string;
  amount_cents: number;
  method: "pix" | "card";
  create_allowed?: boolean;
};
async function gateway(
  operation: string,
  payload: object = {},
  supplied = secret,
) {
  return scalar<any>("select public.billing_gateway($1,$2,$3::jsonb)", [
    supplied,
    operation,
    JSON.stringify(payload),
  ]);
}
async function begin(company: string, plan = "profissional", method = "pix") {
  return scalar<Checkout>("select public.billing_begin_checkout($1,$2,$3)", [
    company,
    plan,
    method,
  ]);
}
async function snapshot(company: string) {
  return scalar<any>("select public.billing_snapshot($1)", [company]);
}
function payment(checkout: Checkout, overrides: Record<string, unknown> = {}) {
  const stamp = new Date().toISOString();
  return {
    external_reference: checkout.external_reference,
    provider_id: `pay-${checkout.id}`,
    status: "approved",
    amount_cents: checkout.amount_cents,
    currency: "BRL",
    collector_id: "123456",
    environment: checkout.environment,
    method: checkout.method,
    approved_at: stamp,
    last_modified: stamp,
    ...overrides,
  };
}
await check(
  "migration preserves every trial and disabled configuration fails closed",
  async () => {
    assert.deepEqual(
      await scalar(
        "select jsonb_agg(jsonb_build_object('id',id,'status',status,'trial',trial_ends_at,'plan',plan_id) order by id) from public.companies",
      ),
      original,
    );
    await as(users.a);
    assert.equal((await snapshot(companies.a)).configuration.enabled, false);
    await assert.rejects(begin(companies.a), /billing unavailable/);
  },
);
await check(
  "remote read-only verification script runs and rolls back its session context",
  async () => {
    await postgres();
    const verified = await db.exec(
      await readFile("scripts/verify-billing-remote.sql", "utf8"),
    );
    const verdict = verified
      .flatMap((r) => r.rows)
      .find((r: any) => r.billing_verification) as
      | { billing_verification: { status: string }[] }
      | undefined;
    assert.ok(verdict);
    assert.ok(
      verdict.billing_verification.every((item) => item.status === "passed"),
    );
    assert.equal(
      await scalar(
        "select current_setting('webfidelize.billing_verification',true)",
      ),
      "",
    );
    assert.equal(await scalar("select current_user"), "postgres");
  },
);
await check(
  "effective access RPC exposes only a boolean to authorized members and admins",
  async () => {
    for (const user of [users.a, users.manager, users.employee, users.admin]) {
      await as(user);
      assert.equal(
        await scalar("select public.company_access_state($1)", [companies.a]),
        true,
      );
    }
    await as(users.b);
    await assert.rejects(
      scalar("select public.company_access_state($1)", [companies.a]),
      /company access denied/,
    );
    await assert.rejects(
      scalar("select public.company_access_state($1)", [randomUUID()]),
      /company access denied/,
    );
    await as(null);
    await assert.rejects(
      scalar("select public.company_access_state($1)", [companies.a]),
      /permission denied/,
    );
  },
);
await postgres();
await db.query(
  "update private.billing_config set enabled=true,environment='live',collector_id='123456',secret_hash=$1",
  [createHash("sha256").update(secret).digest("hex")],
);
await check(
  "running free trials cannot be charged; browser cannot alter expiry or billing fields",
  async () => {
    await as(users.a);
    await assert.rejects(begin(companies.a), /trial still running/);
    await assert.rejects(
      db.query(
        "update public.companies set paid_until=now()+interval '1 year',status='active' where id=$1",
        [companies.a],
      ),
      /permission denied/,
    );
    await assert.rejects(
      db.query("update public.companies set trial_ends_at=now() where id=$1", [
        companies.a,
      ]),
      /permission denied/,
    );
  },
);
await postgres();
await db.exec(
  "update public.companies set trial_ends_at=now()-interval '1 day'",
);
await check(
  "OWNER isolation; manager, employee, anonymous, and wrong secret denied",
  async () => {
    for (const user of [users.manager, users.employee, users.b, null]) {
      await as(user);
      await assert.rejects(
        begin(companies.a),
        /billing owner required|permission denied/,
      );
      await assert.rejects(
        snapshot(companies.a),
        /billing owner required|permission denied/,
      );
      await assert.rejects(
        db.query("select * from private.billing_payments"),
        /permission denied/,
      );
    }
    await assert.rejects(
      gateway("list_pending", {}, "bad-secret"),
      /gateway unauthorized/,
    );
    await as(users.admin);
    assert.equal((await snapshot(companies.a)).company.id, companies.a);
  },
);
let pix: Checkout;
await check(
  "a changed displayed quote creates no orphan checkout",
  async () => {
    await as(users.a);
    await assert.rejects(
      scalar(
        "select public.billing_begin_checkout($1,'profissional','pix',4990)",
        [companies.a],
      ),
      /billing price changed/,
    );
    await postgres();
    assert.equal(
      await scalar("select count(*)::int from private.billing_checkouts"),
      0,
    );
  },
);
await check(
  "checkout quotes authoritative price, preserves trial, and deduplicates simultaneous submissions",
  async () => {
    await as(users.a);
    const [first, second] = await Promise.all([
      begin(companies.a),
      begin(companies.a),
    ]);
    assert.equal(first.id, second.id);
    pix = first;
    assert.equal(first.amount_cents, 8990);
    assert.equal(first.environment, "live");
    await assert.rejects(
      begin(companies.a, "empresarial"),
      /checkout already open/,
    );
    await assert.rejects(
      begin(companies.a, "profissional", "card"),
      /checkout already open/,
    );
    assert.equal((await snapshot(companies.a)).company.status, "trialing");
    await postgres();
    assert.equal(
      await scalar(
        "select count(*)::int from private.billing_checkouts where company_id=$1",
        [companies.a],
      ),
      1,
    );
  },
);
await check(
  "a pending checkout retains its frozen quote after catalog changes",
  async () => {
    await postgres();
    await db.exec(
      "update public.plans set price_cents=9990 where id='profissional'",
    );
    await as(users.a);
    const resumed = await scalar<Checkout>(
      "select public.billing_begin_checkout($1,'profissional','pix',8990)",
      [companies.a],
    );
    assert.equal(resumed.id, pix.id);
    assert.equal(resumed.amount_cents, 8990);
    await assert.rejects(
      scalar(
        "select public.billing_begin_checkout($1,'profissional','pix',9990)",
        [companies.a],
      ),
      /billing price changed/,
    );
    await postgres();
    await db.exec(
      "update public.plans set price_cents=8990 where id='profissional'",
    );
  },
);
await check(
  "creation claim lease prevents duplicate concurrent outbound calls and readonly context does not claim",
  async () => {
    await as(null);
    const read = await gateway("checkout_context", {
      checkout_id: pix.id,
      claim: false,
    });
    assert.equal(read.create_allowed, false);
    const [first, second] = await Promise.all([
      gateway("checkout_context", { checkout_id: pix.id }),
      gateway("checkout_context", { checkout_id: pix.id }),
    ]);
    assert.equal([first, second].filter((r) => r.create_allowed).length, 1);
    assert.equal(first.idempotency_key, pix.id);
    assert.match(first.payer_email, /example\.invalid$/);
    await gateway("checkout_failed", {
      checkout_id: pix.id,
      error_code: "creation_unknown",
      uncertain: true,
    });
    const retry = await gateway("checkout_context", { checkout_id: pix.id });
    assert.equal(retry.create_allowed, true);
    assert.equal(retry.idempotency_key, pix.id);
  },
);
await check(
  "revoked owner cannot start an already-created outbound checkout",
  async () => {
    await postgres();
    await db.query(
      "update public.memberships set role='MANAGER' where company_id=$1 and user_id=$2",
      [companies.a, users.a],
    );
    await db.query(
      "update private.billing_checkouts set leased_until=null where id=$1",
      [pix.id],
    );
    await as(null);
    assert.equal(
      (await gateway("checkout_context", { checkout_id: pix.id }))
        .create_allowed,
      false,
    );
    await postgres();
    await db.query(
      "update public.memberships set role='OWNER' where company_id=$1 and user_id=$2",
      [companies.a, users.a],
    );
    await as(null);
  },
);
await check(
  "provider identity, price, currency, mode, and external reference mismatch roll back",
  async () => {
    for (const change of [
      { amount_cents: 1 },
      { currency: "USD" },
      { collector_id: "999" },
      { environment: "test" },
      { external_reference: randomUUID() },
    ]) {
      await assert.rejects(
        gateway("record_payment", payment(pix, change)),
        /provider mismatch|checkout unknown/,
      );
    }
    await postgres();
    assert.equal(
      await scalar("select count(*)::int from private.billing_payments"),
      0,
    );
    assert.equal(
      await scalar("select paid_until from public.companies where id=$1", [
        companies.a,
      ]),
      null,
    );
    await as(null);
    await assert.rejects(
      gateway("checkout_created", {
        checkout_id: pix.id,
        provider_id: `pay-${pix.id}`,
        checkout_url: "https://mercadopago.com.br.evil.invalid/",
      }),
      /url invalid/,
    );
  },
);
await check(
  "pending payment never grants access; approved Pix grants exactly one finite month",
  async () => {
    await gateway("checkout_created", {
      checkout_id: pix.id,
      provider_id: `pay-${pix.id}`,
      qr_code: "SYNTHETIC-PIX-NOT-PAYABLE",
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });
    await gateway(
      "record_payment",
      payment(pix, { status: "pending", approved_at: null }),
    );
    await as(users.a);
    assert.equal(
      await scalar("select private.writable($1)", [companies.a]),
      false,
    );
    await assert.rejects(
      db.query(
        "insert into public.customers(company_id,name) values($1,'Blocked synthetic')",
        [companies.a],
      ),
      /row-level security/,
    );
    await as(null);
    const approved = payment(pix);
    await gateway("record_payment", approved);
    const duplicate = await gateway("record_payment", approved);
    await as(users.a);
    const state = await snapshot(companies.a);
    assert.equal(state.company.status, "active");
    assert.equal(state.company.plan_id, "profissional");
    assert.equal(state.company.access, true);
    assert.equal(state.company.paid_until, duplicate.paid_until);
    await db.query(
      "insert into public.customers(company_id,name) values($1,'Allowed synthetic')",
      [companies.a],
    );
    for (const user of [users.a, users.manager, users.employee]) {
      await as(user);
      assert.equal(
        await scalar("select public.company_access_state($1)", [companies.a]),
        true,
      );
    }
    await postgres();
    assert.equal(
      await scalar("select count(*)::int from private.billing_entitlements"),
      1,
    );
    assert.equal(
      await scalar(
        "select bool_and(ends_at=starts_at+interval '1 month') from private.billing_entitlements",
      ),
      true,
    );
  },
);
await check(
  "renewal is same-plan Pix only and duplicate approvals cannot extend it twice",
  async () => {
    await as(users.a);
    await assert.rejects(
      begin(companies.a, "empresarial"),
      /current period still running/,
    );
    await assert.rejects(
      begin(companies.a, "profissional", "card"),
      /current period still running/,
    );
    const renewal = await begin(companies.a);
    assert.notEqual(renewal.id, pix.id);
    await as(null);
    await gateway("record_payment", payment(renewal));
    const first = await gateway("record_payment", payment(renewal));
    const repeated = await gateway("record_payment", payment(renewal));
    assert.equal(first.paid_until, repeated.paid_until);
    await postgres();
    assert.equal(
      await scalar(
        "select count(*)::int from private.billing_entitlements where company_id=$1",
        [companies.a],
      ),
      2,
    );
    // A refunded current period must not let a later renewal masquerade as access today.
    // This temporary isolated fixture leaves only the future period valid.
    await db.query(
      "update private.billing_entitlements set revoked_at=now() where payment_id in(select id from private.billing_payments where checkout_id=$1)",
      [pix.id],
    );
    await as(users.a);
    assert.equal((await snapshot(companies.a)).company.access, false);
    await assert.rejects(begin(companies.a), /current period still running/);
    for (const user of [users.a, users.manager, users.employee]) {
      await as(user);
      assert.equal(
        await scalar("select public.company_access_state($1)", [companies.a]),
        false,
      );
    }
    await postgres();
    assert.equal(
      await scalar(
        "select count(*)::int from private.billing_checkouts where company_id=$1",
        [companies.a],
      ),
      2,
    );
    await db.query(
      "update private.billing_entitlements set revoked_at=null where payment_id in(select id from private.billing_payments where checkout_id=$1)",
      [pix.id],
    );
    // Refund the advance renewal so the next tests can exercise the current period independently.
    await as(null);
    await gateway("record_payment", payment(renewal, { status: "refunded" }));
  },
);
await check(
  "out-of-order failures cannot undo approval; suspension survives reconciliation",
  async () => {
    await as(null);
    assert.equal(
      (await gateway("record_payment", payment(pix, { status: "rejected" })))
        .applied,
      false,
    );
    await postgres();
    await db.query(
      "update public.companies set status='suspended' where id=$1",
      [companies.a],
    );
    await as(null);
    await gateway("record_payment", payment(pix));
    await as(users.a);
    assert.equal((await snapshot(companies.a)).company.status, "suspended");
    assert.equal(
      await scalar("select private.writable($1)", [companies.a]),
      false,
    );
    await postgres();
    await db.query("update public.companies set status='active' where id=$1", [
      companies.a,
    ]);
  },
);
await check(
  "paid expiry is checked on reads and RLS without cron or stored status changes",
  async () => {
    await postgres();
    await db.query(
      "update public.companies set booking_enabled=true,booking_slug='billing-synthetic-a' where id=$1",
      [companies.a],
    );
    const before = await scalar<any>(
      "select private.public_catalog('billing-synthetic-a')",
    );
    assert.ok(before);
    await db.query(
      "update private.billing_entitlements set starts_at=now()-interval '2 months',ends_at=now()-interval '1 month' where company_id=$1 and revoked_at is null",
      [companies.a],
    );
    await db.query(
      "update public.companies set paid_until=now()-interval '1 month' where id=$1",
      [companies.a],
    );
    assert.equal(
      await scalar("select status from public.companies where id=$1", [
        companies.a,
      ]),
      "active",
    );
    assert.equal(
      await scalar("select private.public_catalog('billing-synthetic-a')"),
      null,
    );
    await as(users.a);
    assert.equal(
      await scalar("select private.writable($1)", [companies.a]),
      false,
    );
    for (const user of [users.a, users.manager, users.employee]) {
      await as(user);
      assert.equal(
        await scalar("select public.company_access_state($1)", [companies.a]),
        false,
      );
    }
    await as(users.a);
    await assert.rejects(
      db.query(
        "insert into public.customers(company_id,name) values($1,'Expired synthetic')",
        [companies.a],
      ),
      /row-level security/,
    );
  },
);
await check(
  "refund/chargeback is terminal and cannot be reversed by stale approved notification",
  async () => {
    await as(null);
    await gateway("record_payment", payment(pix, { status: "charged_back" }));
    assert.equal(
      (await gateway("record_payment", payment(pix))).applied,
      false,
    );
    await as(users.a);
    assert.equal((await snapshot(companies.a)).company.access, false);
  },
);
let card: Checkout;
await check(
  "card creation ambiguity never permits a second outbound creation",
  async () => {
    await as(users.card);
    card = await begin(companies.card, "empresarial", "card");
    await as(null);
    assert.equal(
      (await gateway("checkout_context", { checkout_id: card.id }))
        .create_allowed,
      true,
    );
    await gateway("checkout_failed", {
      checkout_id: card.id,
      error_code: "creation_unknown",
      uncertain: true,
    });
    assert.equal(
      (await gateway("checkout_context", { checkout_id: card.id }))
        .create_allowed,
      false,
    );
  },
);
const subscriptionPayload = () => ({
  external_reference: card.external_reference,
  provider_id: `sub-${card.id}`,
  status: "authorized",
  amount_cents: card.amount_cents,
  currency: "BRL",
  collector_id: "123456",
  environment: "live",
  last_modified: new Date().toISOString(),
});
await check(
  "pending card checkout can be resumed without creating another contract",
  async () => {
    await gateway("record_subscription", {
      ...subscriptionPayload(),
      status: "pending",
    });
    await as(users.card);
    assert.equal(
      (await begin(companies.card, "empresarial", "card")).id,
      card.id,
    );
    await as(null);
  },
);
await check(
  "card authorization is not payment; contract blocks duplicate checkout and invoice proof is required",
  async () => {
    await gateway("record_subscription", subscriptionPayload());
    await as(users.card);
    assert.equal((await snapshot(companies.card)).company.access, false);
    await assert.rejects(
      begin(companies.card, "empresarial", "card"),
      /card contract exists/,
    );
    await assert.rejects(
      begin(companies.card, "empresarial", "pix"),
      /card contract exists/,
    );
    await as(null);
    await assert.rejects(
      gateway(
        "record_payment",
        payment(card, { subscription_id: `sub-${card.id}` }),
      ),
      /invoice proof required/,
    );
    await gateway(
      "record_payment",
      payment(card, {
        subscription_id: `sub-${card.id}`,
        status: "pending",
        approved_at: null,
      }),
    );
    await assert.rejects(
      gateway(
        "record_payment",
        payment(card, { subscription_id: `sub-${card.id}` }),
      ),
      /invoice proof required/,
    );
    await gateway(
      "record_payment",
      payment(card, {
        subscription_id: `sub-${card.id}`,
        authorized_payment_id: "invoice-synthetic-1",
      }),
    );
    await as(users.card);
    assert.equal((await snapshot(companies.card)).company.access, true);
  },
);
await check(
  "canceling recurrence preserves the already-paid period; stale authorization cannot resurrect contract",
  async () => {
    await as(users.card);
    const before = (await snapshot(companies.card)).company.paid_until;
    await as(null);
    await gateway("record_subscription", {
      ...subscriptionPayload(),
      status: "cancelled",
    });
    assert.equal(
      (await gateway("record_subscription", subscriptionPayload())).applied,
      false,
    );
    await as(users.card);
    const state = await snapshot(companies.card);
    assert.equal(state.company.paid_until, before);
    assert.equal(state.company.access, true);
  },
);
await check(
  "resource lookup and event inbox are bounded, durable, and idempotent",
  async () => {
    await as(null);
    const resource = await gateway("resource_context", {
      provider_id: `pay-${card.id}`,
      resource_type: "payment",
    });
    assert.equal(resource.id, card.id);
    assert.equal(
      await gateway("resource_context", {
        provider_id: "unknown",
        resource_type: "payment",
      }),
      null,
    );
    const event = {
      event_key: "synthetic-event-1",
      event_type: "payment",
      resource_id: `pay-${card.id}`,
    };
    assert.deepEqual(await gateway("record_event", event), {
      processed: false,
    });
    assert.deepEqual(await gateway("record_event", event), {
      processed: false,
    });
    await assert.rejects(
      gateway("record_event", { ...event, resource_id: "other" }),
      /event conflict/,
    );
    await gateway("event_done", { event_key: event.event_key });
    assert.deepEqual(await gateway("record_event", event), { processed: true });
    assert.ok(
      Array.isArray((await gateway("list_pending", { limit: 3 })).events),
    );
  },
);
await check(
  "bounded reconciliation rotates beyond unfinished events rather than starving later items",
  async () => {
    await as(null);
    for (let i = 0; i < 4; i++)
      await gateway("record_event", {
        event_key: `rotation-${i}`,
        event_type: "payment",
        resource_id: `synthetic-${i}`,
      });
    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const batch = await gateway("list_pending", { limit: 1 });
      assert.ok(
        batch.checkouts.length <= 1 &&
          batch.subscriptions.length <= 1 &&
          batch.payments.length <= 1 &&
          batch.events.length <= 1,
      );
      seen.add(batch.events[0].event_key);
    }
    assert.equal(seen.size, 4);
  },
);
await check(
  "test environment approvals are recorded but never grant real access",
  async () => {
    await postgres();
    await db.exec("update private.billing_config set environment='test'");
    await as(users.b);
    const test = await begin(companies.b, "essencial", "pix");
    await as(null);
    await gateway("record_payment", payment(test));
    await as(users.b);
    const state = await snapshot(companies.b);
    assert.equal(state.company.access, false);
    assert.equal(state.company.paid_until, null);
    assert.equal(state.payments[0].status, "approved");
    await postgres();
    assert.equal(
      await scalar(
        "select count(*)::int from private.billing_entitlements where company_id=$1",
        [companies.b],
      ),
      0,
    );
  },
);
await check(
  "switching test to live isolates open checkouts and contracts while preserving all history",
  async () => {
    await as(users.b);
    const testCard = await begin(companies.b, "essencial", "card");
    const subscription = (checkout: Checkout, status = "pending") => ({
      external_reference: checkout.external_reference,
      provider_id: `sub-${checkout.id}`,
      status,
      amount_cents: checkout.amount_cents,
      currency: "BRL",
      collector_id: "123456",
      environment: checkout.environment,
      last_modified: new Date().toISOString(),
    });
    await as(null);
    await gateway("record_subscription", subscription(testCard));
    await as(users.b);
    assert.equal((await snapshot(companies.b)).company.access, false);
    assert.equal(
      (await snapshot(companies.b)).subscription.environment,
      "test",
    );
    await postgres();
    const testHistory = await scalar(
      "select to_jsonb(s) from private.billing_subscriptions s where checkout_id=$1",
      [testCard.id],
    );
    await db.exec("update private.billing_config set environment='live'");
    await as(users.b);
    const initialLive = await snapshot(companies.b);
    assert.equal(initialLive.checkout, null);
    assert.equal(initialLive.subscription, null);
    assert.equal(initialLive.company.access, false);
    assert.equal(initialLive.payments[0].environment, "test");
    const [live, duplicate] = await Promise.all([
      begin(companies.b, "essencial", "card"),
      begin(companies.b, "essencial", "card"),
    ]);
    assert.equal(live.id, duplicate.id);
    assert.equal(live.environment, "live");
    assert.notEqual(live.id, testCard.id);
    await as(null);
    assert.equal(
      (await gateway("checkout_context", { checkout_id: testCard.id }))
        .create_allowed,
      false,
    );
    assert.equal(
      (await gateway("checkout_context", { checkout_id: live.id }))
        .create_allowed,
      true,
    );
    await gateway("record_subscription", subscription(live));
    await as(users.b);
    assert.equal((await begin(companies.b, "essencial", "card")).id, live.id);
    const pendingLive = await snapshot(companies.b);
    assert.equal(pendingLive.checkout.id, live.id);
    assert.equal(pendingLive.subscription.environment, "live");
    await as(null);
    await gateway("record_subscription", subscription(live, "authorized"));
    await as(users.b);
    await assert.rejects(
      begin(companies.b, "essencial", "card"),
      /card contract exists/,
    );
    assert.equal((await snapshot(companies.b)).company.access, false);
    await as(null);
    await gateway(
      "record_payment",
      payment(testCard, {
        subscription_id: `sub-${testCard.id}`,
        authorized_payment_id: `invoice-${testCard.id}`,
      }),
    );
    await as(users.b);
    assert.equal((await snapshot(companies.b)).company.access, false);
    await as(null);
    await gateway(
      "record_payment",
      payment(live, {
        subscription_id: `sub-${live.id}`,
        authorized_payment_id: `invoice-${live.id}`,
      }),
    );
    await as(users.b);
    const settledLive = await snapshot(companies.b);
    assert.equal(settledLive.company.access, true);
    assert.equal(settledLive.subscription.provider_id, `sub-${live.id}`);
    assert.ok(
      settledLive.payments.some(
        (p: { environment: string }) => p.environment === "test",
      ),
    );
    assert.ok(
      settledLive.payments.some(
        (p: { environment: string }) => p.environment === "live",
      ),
    );
    await postgres();
    assert.deepEqual(
      await scalar(
        "select to_jsonb(s) from private.billing_subscriptions s where checkout_id=$1",
        [testCard.id],
      ),
      testHistory,
    );
    assert.equal(
      await scalar(
        "select count(*)::int from private.billing_entitlements where company_id=$1",
        [companies.b],
      ),
      1,
    );
    assert.equal(
      await scalar(
        "select count(*)::int from private.billing_subscriptions where company_id=$1 and status<>'cancelled'",
        [companies.b],
      ),
      2,
    );
  },
);
await check(
  "new bookings and operational writes use the shared finite entitlement check",
  async () => {
    await postgres();
    const names = [
      "validate_appointment",
      "public_catalog",
      "public_slots",
      "submit_public_booking",
      "is_public_company_logo",
      "public_booking_whatsapp_consent",
      "claim_whatsapp_reminders",
      "prepare_whatsapp_reminder",
      "whatsapp_confirmation",
      "queue_whatsapp_staff_new_appointment",
      "claim_whatsapp_staff_notifications",
      "prepare_whatsapp_staff_notification",
      "is_public_company_cover",
      "public_classes",
      "submit_public_class_booking",
      "admin_company_diagnostics",
    ];
    // Existing signed receipts remain readable after expiry; their capability
    // and tenant checks are exercised by the booking/class receipt suites.
    for (const name of names)
      assert.equal(
        await scalar(
          "select bool_and(position('company_access_valid' in prosrc)>0) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=$1",
          [name],
        ),
        true,
        name,
      );
    await as(null);
    await assert.rejects(
      db.query("select private.billing_refresh_company($1)", [companies.a]),
      /permission denied/,
    );
  },
);
await postgres();
await db.close();
console.log(
  `Billing SQL: ${passed} checks passed; no external services contacted.`,
);
