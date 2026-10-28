import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

// Opt-ins and credentials must come from the invoking process, not .env.local.
// This test expects a real blocked provider. It never invents a generated draft,
// publishes content, sends a message, changes a subscription, or processes a
// pre-existing queued job. Successful draft review belongs to isolated DB tests.
const enabled = process.env.TEST_ADMIN_AI_LIVE === "1";
const remoteEnabled = process.env.TEST_ADMIN_AI_REMOTE === "1";
const expectBlocked = process.env.TEST_ADMIN_AI_EXPECT_BLOCKED === "1";
const requestedBase = process.env.TEST_BASE_URL || "http://localhost:3000";
const password = process.env.SEED_PASSWORD;
const adminEmail = process.env.SALES_ADMIN_EMAIL;
try {
  process.loadEnvFile(".env.local");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

let phase = "configuration";
let checks = 0;
const cleanup = {
  marker: "QA-AI-" + randomUUID(),
  leads: [] as string[],
  jobs: [] as string[],
  settings_restored: true,
};
function pass(message: string) {
  checks++;
  console.log("PASS admin AI live: " + message);
}
function baseOrigin() {
  const url = new URL(requestedBase);
  assert.equal(requestedBase, requestedBase.trim());
  assert.ok(!url.username && !url.password && !url.search && !url.hash);
  assert.equal(url.pathname, "/");
  assert.ok(["http:", "https:"].includes(url.protocol));
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      (remoteEnabled &&
        url.origin === "https://webfidelize-saas.vercel.app" &&
        [
          "https://webfidelize-saas.vercel.app",
          "https://webfidelize-saas.vercel.app/",
        ].includes(requestedBase)),
    "Remote tests require explicit opt-in and the exact stable production origin.",
  );
  return url;
}
const decode = (value: string) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
const attributes = (tag: string): Record<string, string> =>
  Object.fromEntries(
    [...tag.matchAll(/([\w$:-]+)\s*=\s*"([^"]*)"/g)].map((match) => [
      match[1],
      decode(match[2]),
    ]),
  );
function actionForm(html: string, matches: (source: string) => boolean) {
  const candidates = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map(([source]) => source)
    .filter(matches);
  assert.equal(candidates.length, 1, "Expected one real server action form.");
  const form = new FormData();
  for (const [tag] of candidates[0].matchAll(/<input\b[^>]*>/g)) {
    const input = attributes(tag);
    if (input.type === "hidden" && input.name)
      form.append(input.name, input.value || "");
  }
  assert.ok([...form.keys()].some((key) => key.startsWith("$ACTION_")));
  return form;
}
const hasName = (source: string, name: string) =>
  source.includes(`name="${name}"`);
function denied(response: { status: number; body: string; location: string }) {
  return (
    [401, 403, 404].includes(response.status) ||
    /NEXT_HTTP_ERROR_FALLBACK;404/.test(response.body) ||
    ([302, 303, 307, 308].includes(response.status) &&
      /^(?:\/entrar|\/painel)(?:[/?]|$)/.test(response.location))
  );
}

async function main() {
  assert.ok(
    enabled && expectBlocked && password && adminEmail,
    "Explicit opt-ins and existing credentials required.",
  );
  const base = baseOrigin();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  assert.ok(url && key);
  const path = "/admin/ia";
  function session() {
    const jar = new Map<string, string>();
    const db = createServerClient(url!, key!, {
      auth: { autoRefreshToken: false },
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (items) => {
          for (const { name, value, options } of items)
            if (!value || options.maxAge === 0) jar.delete(name);
            else jar.set(name, value);
        },
      },
    });
    return { jar, db };
  }
  const admin = session();
  const owner = session();
  const anonymous = session();
  const anon = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  async function request(
    client: ReturnType<typeof session>,
    query = "",
    form?: FormData,
  ) {
    const target = new URL(path + query, base);
    assert.equal(target.origin, base.origin);
    assert.equal(target.pathname, path);
    const response = await fetch(target, {
      method: form ? "POST" : "GET",
      body: form,
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
      headers: {
        Accept: "text/html",
        Cookie: [...client.jar]
          .map(([name, value]) => name + "=" + value)
          .join("; "),
        ...(form ? { Origin: base.origin, Referer: target.href } : {}),
      },
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      const index = pair.indexOf("=");
      if (index > 0) {
        const name = pair.slice(0, index),
          value = pair.slice(index + 1);
        if (value) client.jar.set(name, value);
        else client.jar.delete(name);
      }
    }
    return {
      status: response.status,
      body: await response.text(),
      location: response.headers.get("location") || "",
    };
  }
  async function page(query = "") {
    const result = await request(admin, query);
    assert.equal(result.status, 200);
    for (const secret of [
      process.env.AI_WORKER_SECRET,
      process.env.AI_GATEWAY_API_KEY,
    ])
      if (secret && secret.length >= 20)
        assert.ok(
          !result.body.includes(secret),
          "Server credentials must never appear in delivered HTML.",
        );
    return result.body;
  }
  async function settings() {
    const result = await admin.db
      .from("platform_ai_settings")
      .select("*")
      .single();
    assert.ok(!result.error && result.data);
    return result.data;
  }
  async function summary() {
    const result = await admin.db.rpc("admin_ai_summary");
    assert.ok(!result.error && result.data);
    return result.data;
  }
  async function job(id: string) {
    assert.ok(cleanup.jobs.includes(id));
    const result = await admin.db
      .from("platform_ai_jobs")
      .select("*")
      .eq("id", id)
      .single();
    assert.ok(!result.error && result.data);
    assert.equal(result.data.source_id, cleanup.leads[0]);
    assert.equal(result.data.source_type, "lead");
    return result.data;
  }
  async function businessSnapshot() {
    const [companies, plans] = await Promise.all([
      admin.db
        .from("companies")
        .select("id,status,plan_id,trial_ends_at")
        .order("id"),
      admin.db.from("plans").select("id,price_cents,staff_limit").order("id"),
    ]);
    assert.equal(companies.error, null);
    assert.equal(plans.error, null);
    return createHash("sha256")
      .update(JSON.stringify({ companies: companies.data, plans: plans.data }))
      .digest("hex");
  }
  async function pendingJobs() {
    const result = await admin.db
      .from("platform_ai_jobs")
      .select("id")
      .in("status", ["queued", "processing", "draft"]);
    assert.equal(result.error, null);
    return result.data || [];
  }
  let originalSettings: Record<string, any> | null = null;
  let settingsTouched = false;
  try {
    phase = "authentication and private page";
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
    assert.equal((await owner.db.rpc("is_super_admin")).data, false);
    await page();
    assert.ok(denied(await request(owner)));
    assert.ok(denied(await request(anonymous)));
    const beforeBusiness = await businessSnapshot();
    originalSettings = await settings();
    assert.ok(originalSettings);
    const beforeSummary = await summary();
    assert.equal(
      (await pendingJobs()).length,
      0,
      "Do not process queued jobs or invalidate existing drafts through configuration changes.",
    );
    assert.ok(
      beforeSummary.quota.daily_remaining > 0 &&
        beforeSummary.quota.monthly_remaining > 0,
      "QA never raises configured spending limits.",
    );
    pass(
      "only SUPER_ADMIN can open the AI workspace; no pre-existing jobs will be processed",
    );

    phase = "anonymous and owner database isolation";
    for (const client of [anon, owner.db]) {
      assert.ok((await client.rpc("admin_ai_summary")).error);
      assert.ok(
        (
          await client.rpc("admin_ai_settings_save", {
            p_enabled: originalSettings.enabled,
            p_auto_enqueue: originalSettings.auto_enqueue,
            p_daily_limit: originalSettings.daily_limit,
            p_monthly_limit: originalSettings.monthly_limit,
            p_expected_updated_at: originalSettings.updated_at,
          })
        ).error,
      );
      for (const table of [
        "platform_ai_settings",
        "platform_ai_jobs",
        "platform_ai_runs",
      ]) {
        const selected = await client.from(table).select("*").limit(1);
        assert.ok(selected.error || selected.data?.length === 0);
      }
    }
    assert.deepEqual(await settings(), originalSettings);
    pass(
      "anonymous and tenant sessions cannot read internal AI records or save settings",
    );

    phase = "synthetic source lead";
    const offer = await admin.db
      .from("sales_offers")
      .select("id")
      .eq("slug", "web-fidelize")
      .single();
    assert.ok(!offer.error && offer.data);
    const created = await admin.db.rpc("admin_save_sales_lead", {
      p_id: null,
      p_expected_version: null,
      p_input: {
        offer_id: offer.data.id,
        contact_name: cleanup.marker,
        company_name: cleanup.marker,
        email: cleanup.marker.toLowerCase() + "@example.invalid",
        phone: "5511999999999",
        niche: "",
        team_size: "solo",
        budget_range: "other",
        timeline: "research",
        decision_role: "owner",
        challenge:
          "Exemplo sintético para validar a Central IA. Nenhum contato, mensagem ou pagamento deve ser realizado.",
        source: "manual",
        consent: false,
      },
    });
    assert.ok(!created.error && typeof created.data === "string");
    const leadId = created.data;
    cleanup.leads.push(leadId);
    const leadBefore = await admin.db
      .from("sales_leads")
      .select("*")
      .eq("id", leadId)
      .single();
    assert.ok(!leadBefore.error && leadBefore.data);
    assert.equal(leadBefore.data.contact_name, cleanup.marker);
    const activitiesBefore = await admin.db
      .from("sales_activities")
      .select("id")
      .eq("lead_id", leadId)
      .order("id");
    assert.equal(activitiesBefore.error, null);

    phase = "configuration form and optimistic locking";
    const configForm = actionForm(await page(), (source) =>
      hasName(source, "daily_limit"),
    );
    configForm.set("enabled", "true");
    // The test only processes its own explicit request; never enqueue real sources.
    configForm.set("auto_enqueue", "false");
    configForm.set("daily_limit", String(originalSettings.daily_limit));
    configForm.set("monthly_limit", String(originalSettings.monthly_limit));
    configForm.set("updated_at", originalSettings.updated_at);
    assert.ok(denied(await request(owner, "", configForm)));
    assert.ok(denied(await request(anonymous, "", configForm)));
    assert.deepEqual(await settings(), originalSettings);
    assert.equal((await pendingJobs()).length, 0);
    settingsTouched = true;
    cleanup.settings_restored = false;
    const configured = await request(admin, "", configForm);
    assert.ok([200, 303].includes(configured.status));
    const activeSettings = await settings();
    assert.equal(activeSettings.enabled, true);
    assert.equal(activeSettings.auto_enqueue, false);
    assert.equal(activeSettings.daily_limit, originalSettings.daily_limit);
    assert.equal(activeSettings.monthly_limit, originalSettings.monthly_limit);
    assert.notEqual(activeSettings.updated_at, originalSettings.updated_at);
    const stale = await request(admin, "", configForm);
    assert.match(stale.body, /registro mudou/i);
    assert.deepEqual(await settings(), activeSettings);
    pass(
      "the real settings form preserves quotas, disables automatic source collection and rejects stale or unauthorized writes",
    );

    phase = "request authorization and idempotent queue form";
    for (const client of [anon, owner.db])
      assert.ok(
        (
          await client.rpc("admin_ai_request", {
            p_source_type: "lead",
            p_source_id: leadId,
          })
        ).error,
      );
    const requestForm = actionForm(
      await page(),
      (source) =>
        hasName(source, "source_type") && hasName(source, "source_id"),
    );
    requestForm.set("source_type", "lead");
    requestForm.set("source_id", leadId);
    assert.ok(denied(await request(owner, "", requestForm)));
    assert.ok(denied(await request(anonymous, "", requestForm)));
    const queued = await request(admin, "", requestForm);
    assert.ok([200, 303].includes(queued.status));
    const generated = await admin.db
      .from("platform_ai_jobs")
      .select("id")
      .eq("source_type", "lead")
      .eq("source_id", leadId);
    assert.ok(!generated.error && generated.data);
    cleanup.jobs.push(...generated.data.map((row) => row.id));
    assert.equal(cleanup.jobs.length, 1);
    const jobId = cleanup.jobs[0];
    assert.equal((await job(jobId)).status, "queued");
    await request(admin, "", requestForm);
    assert.equal(
      (
        await admin.db.rpc("admin_ai_request", {
          p_source_type: "lead",
          p_source_id: leadId,
        })
      ).data,
      jobId,
    );
    const queuedAgain = await admin.db
      .from("platform_ai_jobs")
      .select("id")
      .eq("source_type", "lead")
      .eq("source_id", leadId);
    assert.equal(queuedAgain.data?.length, 1);
    pass(
      "the real request form queues one QA analysis and repeated requests preserve the same job",
    );

    phase = "real blocked provider through the process form";
    assert.ok((await pendingJobs()).every((item) => item.id === jobId));
    const processForm = actionForm(await page(), (source) =>
      source.includes('data-ai-form="process"'),
    );
    const runIdsBefore = await admin.db
      .from("platform_ai_runs")
      .select("id")
      .eq("trigger", "manual");
    assert.equal(runIdsBefore.error, null);
    const knownRuns = new Set((runIdsBefore.data || []).map((run) => run.id));
    assert.ok(denied(await request(owner, "", processForm)));
    assert.ok(denied(await request(anonymous, "", processForm)));
    const processed = await request(admin, "", processForm);
    assert.ok([200, 303].includes(processed.status));
    const failed = await job(jobId);
    assert.equal(failed.status, "failed");
    assert.equal(failed.error_code, "verification_required");
    assert.equal(failed.output, null);
    assert.ok(failed.consumed_at);
    assert.equal(failed.usage_input_tokens, null);
    assert.equal(failed.usage_output_tokens, null);
    assert.equal(failed.reviewed_body, "");
    const paused = await settings();
    assert.equal(paused.enabled, false);
    const afterSummary = await summary();
    assert.equal(afterSummary.last_error_code, "verification_required");
    const runRows = await admin.db
      .from("platform_ai_runs")
      .select("id,processed,failed,error_code")
      .eq("trigger", "manual")
      .order("created_at", { ascending: false })
      .limit(50);
    assert.equal(runRows.error, null);
    assert.ok(
      runRows.data?.some(
        (run) =>
          !knownRuns.has(run.id) &&
          run.processed === 0 &&
          run.failed === 1 &&
          run.error_code === "verification_required",
      ),
    );
    // A reserved provider attempt consumes quota even when the provider rejects
    // it. No generated token usage or successful content is invented.
    assert.equal(
      afterSummary.quota.daily_used,
      beforeSummary.quota.daily_used + 1,
    );
    assert.equal(
      afterSummary.quota.monthly_used,
      beforeSummary.quota.monthly_used + 1,
    );
    const failedPage = await page("?id=" + jobId);
    assert.match(failedPage, /verificar a conta|verificação|nenhuma resposta/i);
    pass(
      "the real provider rejection persists a failed job, pauses generation and records one attempt without invented token usage",
    );

    phase = "failed job review guards and no automatic retry";
    for (const client of [anon, owner.db])
      for (const action of ["save", "approve", "discard"])
        assert.ok(
          (
            await client.rpc("admin_ai_review", {
              p_job: jobId,
              p_action: action,
              p_body: "Tentativa sintética de alteração proibida.",
              p_expected_updated_at: failed.updated_at,
            })
          ).error,
        );
    for (const action of ["save", "approve"])
      assert.ok(
        (
          await admin.db.rpc("admin_ai_review", {
            p_job: jobId,
            p_action: action,
            p_body:
              "Texto sintético que não pode substituir uma geração que falhou.",
            p_expected_updated_at: failed.updated_at,
          })
        ).error,
      );
    assert.deepEqual(await job(jobId), failed);
    const repeated = await request(admin, "", requestForm);
    assert.ok([200, 303].includes(repeated.status));
    const afterRepeat = await admin.db
      .from("platform_ai_jobs")
      .select("id")
      .eq("source_type", "lead")
      .eq("source_id", leadId);
    assert.equal(afterRepeat.data?.length, 1);
    assert.deepEqual(await job(jobId), failed);
    assert.equal((await settings()).enabled, false);
    assert.equal(
      (await summary()).quota.daily_used,
      afterSummary.quota.daily_used,
    );
    const leadAfter = await admin.db
      .from("sales_leads")
      .select("*")
      .eq("id", leadId)
      .single();
    assert.equal(leadAfter.error, null);
    assert.deepEqual(leadAfter.data, leadBefore.data);
    const activitiesAfter = await admin.db
      .from("sales_activities")
      .select("id")
      .eq("lead_id", leadId)
      .order("id");
    assert.equal(activitiesAfter.error, null);
    assert.deepEqual(activitiesAfter.data, activitiesBefore.data);
    assert.equal(await businessSnapshot(), beforeBusiness);
    pass(
      "failed output cannot be forged or approved; duplicate requests never retry, and leads, companies and plans remain unchanged",
    );
    console.log("PASS admin AI live: " + checks + " groups");
  } finally {
    if (settingsTouched && originalSettings) {
      // Restoring initially-unauthorized enabled=true would accidentally grant
      // authority. Such baselines intentionally remain safely paused instead.
      const restoreEnabled = originalSettings.authorized_by
        ? originalSettings.enabled
        : false;
      const restoreAuto = originalSettings.authorized_by
        ? originalSettings.auto_enqueue
        : false;
      try {
        const latest = await settings();
        const alreadyRestored =
          latest.enabled === restoreEnabled &&
          latest.auto_enqueue === restoreAuto &&
          latest.daily_limit === originalSettings.daily_limit &&
          latest.monthly_limit === originalSettings.monthly_limit;
        // A provider failure has already paused a previously unauthorized
        // baseline. Preserve its diagnostic instead of clearing it on a no-op.
        const restored = alreadyRestored
          ? { error: null }
          : await admin.db.rpc("admin_ai_settings_save", {
              p_enabled: restoreEnabled,
              p_auto_enqueue: restoreAuto,
              p_daily_limit: originalSettings.daily_limit,
              p_monthly_limit: originalSettings.monthly_limit,
              p_expected_updated_at: latest.updated_at,
            });
        if (!restored.error) {
          const actual = await settings();
          cleanup.settings_restored =
            actual.enabled === restoreEnabled &&
            actual.auto_enqueue === restoreAuto &&
            actual.daily_limit === originalSettings.daily_limit &&
            actual.monthly_limit === originalSettings.monthly_limit;
        }
      } catch {
        cleanup.settings_restored = false;
      }
      if (!cleanup.settings_restored) {
        console.error(
          "FAIL admin AI live: settings restoration requires attention; no secret details printed.",
        );
        process.exitCode = 1;
      }
    }
    for (const leadId of cleanup.leads) {
      const rows = await admin.db
        .from("platform_ai_jobs")
        .select("id")
        .eq("source_type", "lead")
        .eq("source_id", leadId);
      for (const row of rows.data || [])
        if (!cleanup.jobs.includes(row.id)) cleanup.jobs.push(row.id);
    }
    await Promise.allSettled([
      admin.db.auth.signOut({ scope: "local" }),
      owner.db.auth.signOut({ scope: "local" }),
    ]);
    console.log("ADMIN_AI_TEST_CLEANUP " + JSON.stringify(cleanup));
  }
}
main().catch(() => {
  console.error(
    "FAIL admin AI live at " +
      phase +
      "; credentials, response bodies, contact data and provider details omitted.",
  );
  process.exitCode = 1;
});
