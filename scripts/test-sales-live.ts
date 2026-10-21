import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

// Explicit opt-in. Synthetic commercial records only; never sends messages or
// charges. Cleanup IDs are printed, without contact details or session tokens.
const enabled = process.env.TEST_SALES_LIVE === "1";
const password = process.env.SEED_PASSWORD;
const adminEmail = process.env.SALES_ADMIN_EMAIL;
process.loadEnvFile(".env.local");
let phase = "configuration",
  checks = 0;
const cleanup: { offers: string[]; leads: string[]; marker: string } = {
  offers: [],
  leads: [],
  marker: "QA-SALES-" + randomUUID(),
};
const decode = (v: string) =>
  v
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
const attrs = (tag: string) =>
  Object.fromEntries(
    [...tag.matchAll(/([\w$:-]+)\s*=\s*"([^"]*)"/g)].map((m) => [
      m[1],
      decode(m[2]),
    ]),
  );
function actionForm(html: string, field: string) {
  const source = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map((m) => m[0])
    .find((v) => v.includes('name="' + field + '"'));
  assert.ok(source, "Missing form for " + field);
  const form = new FormData();
  for (const m of source.matchAll(/<input\b[^>]*>/g)) {
    const input = attrs(m[0]);
    if (input.type === "hidden" && input.name)
      form.append(input.name, input.value || "");
  }
  assert.ok([...form.keys()].some((key) => key.startsWith("$ACTION_")));
  return form;
}
function fill(form: FormData, values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}
function pass(message: string) {
  checks++;
  console.log("PASS sales live: " + message);
}

async function main() {
  assert.ok(
    enabled && password && adminEmail,
    "Provide explicit opt-in and existing admin credentials through the process.",
  );
  const base = new URL(process.env.TEST_BASE_URL || "http://localhost:3000");
  assert.ok(
    ["localhost", "127.0.0.1"].includes(base.hostname) &&
      !base.username &&
      !base.password,
  );
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  assert.ok(url && key);
  function session() {
    const jar = new Map<string, string>();
    const db = createServerClient(url, key, {
      auth: { autoRefreshToken: false },
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (items) =>
          items.forEach(({ name, value, options }) =>
            !value || options.maxAge === 0
              ? jar.delete(name)
              : jar.set(name, value),
          ),
      },
    });
    return { jar, db };
  }
  const admin = session(),
    owner = session(),
    anonymous = session();
  const anon = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  async function request(
    client: ReturnType<typeof session>,
    path: string,
    form?: FormData,
  ) {
    const target = new URL(path, base);
    assert.equal(target.origin, base.origin);
    if (form)
      assert.ok(
        target.pathname === "/diagnostico" ||
          target.pathname.startsWith("/admin/comercial"),
      );
    const response = await fetch(target, {
      method: form ? "POST" : "GET",
      body: form,
      redirect: "manual",
      signal: AbortSignal.timeout(45000),
      headers: {
        Accept: "text/html",
        Cookie: [...client.jar].map(([n, v]) => n + "=" + v).join("; "),
        ...(form ? { Origin: base.origin, Referer: target.href } : {}),
      },
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0],
        index = pair.indexOf("=");
      if (index > 0)
        client.jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return response;
  }
  async function html(client: ReturnType<typeof session>, path: string) {
    const response = await request(client, path);
    assert.equal(response.status, 200);
    return response.text();
  }
  const outcome = async (r: Response) => ({
    status: r.status,
    html: await r.text(),
  });
  try {
    phase = "existing admin and owner authentication";
    assert.equal(
      (await admin.db.auth.signInWithPassword({ email: adminEmail, password }))
        .error,
      null,
    );
    assert.equal(
      (
        await owner.db.auth.signInWithPassword({
          email: "salao@example.invalid",
          password,
        })
      ).error,
      null,
    );
    assert.equal((await admin.db.rpc("is_super_admin")).data, true);
    const snapshot = async () => {
      const r = await admin.db
        .from("companies")
        .select("id,status,plan_id,trial_ends_at")
        .order("id");
      assert.equal(r.error, null);
      return createHash("sha256").update(JSON.stringify(r.data)).digest("hex");
    };
    const beforeCompanies = await snapshot();
    pass(
      "existing privileged account authenticated without changing credentials",
    );

    phase = "admin offer form and publication";
    const offerForm = fill(
      actionForm(await html(admin, "/admin/comercial/ofertas"), "slug"),
      {
        id: "",
        slug: cleanup.marker.toLowerCase(),
        title: cleanup.marker,
        summary: "Oferta sintética exclusiva de validação. Não contratar.",
        niche: "salao",
        active: "on",
        published: "on",
        setup_price: "2500,90",
        monthly_price: "",
      },
    );
    await outcome(await request(admin, "/admin/comercial/ofertas", offerForm));
    const offer = await admin.db
      .from("sales_offers")
      .select("*")
      .eq("slug", cleanup.marker.toLowerCase())
      .single();
    assert.ok(offer.data && !offer.error);
    const offerId = offer.data.id as string;
    cleanup.offers.push(offerId);
    assert.equal(offer.data.setup_price_cents, 250090);
    assert.equal(offer.data.monthly_price_cents, null);
    assert.equal(
      (await anon.from("sales_offers").select("id").eq("id", offerId)).data
        ?.length,
      1,
    );
    pass("admin offer form persists quotes and publication");

    phase = "public capture and qualification";
    const capture = fill(
      actionForm(
        await html(
          anonymous,
          "/diagnostico?produto=" + cleanup.marker.toLowerCase(),
        ),
        "request_id",
      ),
      {
        offer_id: offerId,
        contact_name: cleanup.marker,
        company_name: cleanup.marker,
        email: cleanup.marker.toLowerCase() + "@example.invalid",
        phone: "5518999990000",
        niche: "salao",
        team_size: "2-5",
        budget_range: "1000-3000",
        timeline: "30-days",
        decision_role: "owner",
        challenge:
          "Registro sintético para validar o fluxo comercial completo.",
        consent: "yes",
        website: "",
        utm_source: "qa",
        utm_medium: "test",
        utm_campaign: "sales-live",
      },
    );
    capture.set("consent", "");
    await outcome(await request(anonymous, "/diagnostico", capture));
    assert.equal(
      (await admin.db.from("sales_leads").select("id").eq("offer_id", offerId))
        .data?.length,
      0,
    );
    capture.set("consent", "yes");
    assert.match(
      (await outcome(await request(anonymous, "/diagnostico", capture))).html,
      /Solicitação recebida/,
    );
    const leadResult = await admin.db
      .from("sales_leads")
      .select("*")
      .eq("offer_id", offerId)
      .single();
    assert.ok(leadResult.data && !leadResult.error);
    const lead = leadResult.data;
    cleanup.leads.push(lead.id);
    assert.equal(lead.stage, "new");
    assert.equal(lead.source, "site");
    assert.equal(lead.utm_source, "qa");
    assert.ok(lead.consent_at);
    pass(
      "public form validates consent and persists real qualification and attribution",
    );

    phase = "public retries and RLS";
    await outcome(await request(anonymous, "/diagnostico", capture));
    capture.set("request_id", randomUUID());
    await outcome(await request(anonymous, "/diagnostico", capture));
    assert.equal(
      (await admin.db.from("sales_leads").select("id").eq("offer_id", offerId))
        .data?.length,
      1,
    );
    for (const client of [anon, owner.db]) {
      const selected = await client
        .from("sales_leads")
        .select("id")
        .eq("id", lead.id);
      assert.ok(selected.error || selected.data?.length === 0);
      assert.ok(
        (
          await client.rpc("admin_add_sales_note", {
            p_lead_id: lead.id,
            p_body: "Forbidden QA note",
          })
        ).error,
      );
    }
    const privatePage = await outcome(await request(owner, "/admin/comercial"));
    assert.ok(
      privatePage.status === 404 ||
        /NEXT_HTTP_ERROR_FALLBACK;404/.test(privatePage.html),
    );
    pass(
      "idempotency prevents duplicates and tenant users cannot access the funnel",
    );

    phase = "pipeline and optimistic locking";
    const detailPath = "/admin/comercial/" + lead.id;
    const detail = await html(admin, detailPath);
    assert.ok(detail.includes(cleanup.marker));
    const edit = fill(actionForm(detail, "version"), {
      id: lead.id,
      version: String(lead.version),
      stage: "proposal",
      priority: "high",
      setup_value: "3500,50",
      monthly_value: "199,90",
      next_action: "Reunião QA",
      next_contact_at: "2026-10-22T14:00",
      loss_reason: "",
    });
    await outcome(await request(admin, detailPath, edit));
    const updated = (
      await admin.db.from("sales_leads").select("*").eq("id", lead.id).single()
    ).data!;
    assert.equal(updated.stage, "proposal");
    assert.equal(updated.setup_value_cents, 350050);
    assert.equal(updated.monthly_value_cents, 19990);
    assert.equal(updated.version, lead.version + 1);
    assert.equal(
      new Date(updated.next_contact_at).toISOString(),
      "2026-10-22T17:00:00.000Z",
    );
    edit.set("stage", "won");
    assert.match(
      (await outcome(await request(admin, detailPath, edit))).html,
      /outra aba/,
    );
    assert.equal(
      (
        await admin.db
          .from("sales_leads")
          .select("stage")
          .eq("id", lead.id)
          .single()
      ).data?.stage,
      "proposal",
    );
    pass(
      "stage, quote and Brasília follow-up persist; stale saves are rejected",
    );

    phase = "history, closing and subscription preservation";
    const detail2 = await html(admin, detailPath);
    const note = fill(actionForm(detail2, "body"), {
      lead_id: lead.id,
      body: "Anotação sintética de QA, sem envio de mensagem.",
    });
    await outcome(await request(admin, detailPath, note));
    const closing = fill(actionForm(detail2, "version"), {
      id: lead.id,
      version: String(updated.version),
      stage: "won",
    });
    await outcome(await request(admin, detailPath, closing));
    const won = (
      await admin.db
        .from("sales_leads")
        .select("stage,closed_at")
        .eq("id", lead.id)
        .single()
    ).data!;
    assert.equal(won.stage, "won");
    assert.ok(won.closed_at);
    const summary = await admin.db.rpc("admin_sales_summary", {
      p_offer_id: offerId,
    });
    assert.equal(summary.error, null);
    assert.equal(summary.data.won, 1);
    assert.equal(summary.data.won_setup_cents, 350050);
    const history = await admin.db
      .from("sales_activities")
      .select("id")
      .eq("lead_id", lead.id);
    assert.ok(history.data && history.data.length >= 4);
    assert.equal(await snapshot(), beforeCompanies);
    pass(
      "history and closed-deal metrics update without any billing or subscription changes",
    );

    phase = "archiving";
    const archive = fill(
      actionForm(
        await html(admin, "/admin/comercial/ofertas?editar=" + offerId),
        "slug",
      ),
      {
        id: offerId,
        slug: cleanup.marker.toLowerCase(),
        title: cleanup.marker,
        summary: "Oferta sintética exclusiva de validação. Não contratar.",
        niche: "salao",
        setup_price: "2500,90",
        monthly_price: "",
        confirm_action: "yes",
      },
    );
    await outcome(await request(admin, "/admin/comercial/ofertas", archive));
    assert.equal(
      (await anon.from("sales_offers").select("id").eq("id", offerId)).data
        ?.length,
      0,
    );
    pass("archiving hides the offer and preserves its history");
    console.log("PASS sales live: " + checks + " groups");
  } finally {
    await Promise.allSettled([
      admin.db.auth.signOut({ scope: "local" }),
      owner.db.auth.signOut({ scope: "local" }),
    ]);
    console.log("SALES_TEST_CLEANUP " + JSON.stringify(cleanup));
  }
}
main().catch(() => {
  console.error(
    "FAIL sales live at " +
      phase +
      "; credentials, contact data and provider details omitted.",
  );
  process.exitCode = 1;
});
