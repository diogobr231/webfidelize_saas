import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { AI_MODEL, aiOutputSchema } from "../src/lib/admin-ai/core";
import { aiSettingsSchema, type AiSettings } from "../src/lib/admin-ai/types";

// Opt-ins and credentials must come from the invoking process, not .env.local.
// Run only after the account/provider is verified and while no other admin is
// processing or adding AI jobs. One real generation may incur provider usage.
// The script never inserts a simulated result, publishes content, sends a
// message, changes a subscription, or processes pre-existing active jobs.
// It does not enable automatic source collection: global candidates cannot be
// safely restricted to QA without changing production behavior.
// Preparing this script does not verify the provider; execution is explicit.
const enabled = process.env.TEST_ADMIN_AI_SUCCESS_LIVE === "1";
const remoteEnabled = process.env.TEST_ADMIN_AI_SUCCESS_REMOTE === "1";

const requestedBase = process.env.TEST_BASE_URL || "http://localhost:3000";
const password = process.env.SEED_PASSWORD;
const adminEmail = process.env.SALES_ADMIN_EMAIL;
let envLoadFailed = false;
try {
  process.loadEnvFile(".env.local");
} catch (error) {
  envLoadFailed = (error as NodeJS.ErrnoException).code !== "ENOENT";
}

let phase = "configuration";
let checks = 0;
const cleanup = {
  marker: "QA-AI-SUCCESS-" + randomUUID(),
  leads: [] as string[],
  jobs: [] as string[],
  notes: [] as string[],
  ids_recovered: true,
  settings_restored: true,
  provider_pause_preserved: false,
  automatic_sources_tested: false,
};
function pass(message: string) {
  checks++;
  console.log("PASS admin AI success live: " + message);
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
    enabled && password && adminEmail && !envLoadFailed,
    "Explicit opt-ins and existing credentials required.",
  );
  const base = baseOrigin();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  assert.ok(url && key);
  const supabaseOrigin = "https://devmjeiblhrgjyaiaukm.supabase.co";
  assert.ok([supabaseOrigin, supabaseOrigin + "/"].includes(url));
  // SDK requests carry sessions too: pin their destination and never follow a
  // redirect, even if a configured endpoint or upstream response is unexpected.
  const supabaseFetch: typeof fetch = async (input, init) => {
    try {
      const target = new URL(input instanceof Request ? input.url : input);
      assert.equal(target.origin, supabaseOrigin);
      assert.ok(!target.username && !target.password && !target.hash);
      const response = await fetch(input, {
        ...init,
        redirect: "manual",
        signal: init?.signal || AbortSignal.timeout(30_000),
      });
      assert.ok(response.status < 300 || response.status >= 400);
      return response;
    } catch {
      // Auth SDKs may retain a fetch error message. Do not pass URLs, headers,
      // response bodies or low-level causes into their error objects.
      throw new Error("The authorized database request could not complete.");
    }
  };
  const path = "/admin/ia";
  function session() {
    const jar = new Map<string, string>();
    const db = createServerClient(url!, key!, {
      global: { fetch: supabaseFetch },
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
    global: { fetch: supabaseFetch },
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
  async function successfulPost(form: FormData, query = "") {
    const response = await request(admin, query, form);
    assert.equal(
      response.status,
      303,
      "Successful server actions must redirect to the real result.",
    );
    const target = new URL(response.location, base);
    assert.equal(target.origin, base.origin);
    assert.equal(target.pathname, path);
    const resultPage = await page(target.search);
    assert.match(resultPage, /role="status"/);
    return resultPage;
  }
  async function activities(leadId: string) {
    assert.ok(cleanup.leads.includes(leadId));
    const result = await admin.db
      .from("sales_activities")
      .select("id,lead_id,actor_id,kind,body")
      .eq("lead_id", leadId)
      .order("id");
    assert.equal(result.error, null);
    return result.data || [];
  }
  const formFor = (
    html: string,
    kind: "request" | "settings" | "process" | "review",
  ) => actionForm(html, (source) => source.includes(`data-ai-form="${kind}"`));
  let originalSettings: AiSettings | null = null;
  let settingsTouched = false;
  let generationInvoked = false;
  let ownSettingsVersion: string | null = null;
  let success = false;
  try {
    phase = "authentication and baseline safety";
    const signedIn = await admin.db.auth.signInWithPassword({
      email: adminEmail,
      password,
    });
    assert.equal(signedIn.error, null);
    assert.ok(signedIn.data.user);
    const adminId = signedIn.data.user.id;
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
    originalSettings = aiSettingsSchema.parse(await settings());
    assert.equal(
      originalSettings.authorized_by,
      adminId,
      "An existing authorization by this admin is required; the test never creates initial production authorization.",
    );
    assert.equal(
      (await pendingJobs()).length,
      0,
      "Existing queued, processing or draft jobs must not be processed or invalidated by QA.",
    );
    const beforeBusiness = await businessSnapshot();
    const beforeSummary = await summary();
    assert.ok(
      beforeSummary.quota.daily_remaining >= 1 &&
        beforeSummary.quota.monthly_remaining >= 1,
    );
    pass(
      "existing admin authorization, empty active queue and available quota verified; tenant and anonymous access denied",
    );

    phase = "one synthetic commercial source";
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
        niche: "salao",
        team_size: "solo",
        budget_range: "plan-essencial",
        timeline: "research",
        decision_role: "owner",
        challenge:
          "Cenário inteiramente sintético de QA: um profissional quer organizar serviços e horários de atendimento. Solicitar apenas análise e rascunho para revisão interna. Nenhum contato externo deve ser realizado.",
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
    const activitiesBefore = await activities(leadId);

    phase = "temporary manual-only processing configuration";
    const latestBefore = aiSettingsSchema.parse(await settings());
    assert.equal(
      latestBefore.updated_at,
      originalSettings.updated_at,
      "Configuration changed concurrently; stop instead of overwriting another admin.",
    );
    assert.equal((await pendingJobs()).length, 0);
    if (!originalSettings.enabled || originalSettings.auto_enqueue) {
      const configuration = formFor(await page(), "settings");
      configuration.set("enabled", "true");
      configuration.set("auto_enqueue", "false");
      configuration.set("daily_limit", String(originalSettings.daily_limit));
      configuration.set(
        "monthly_limit",
        String(originalSettings.monthly_limit),
      );
      configuration.set("updated_at", originalSettings.updated_at);
      settingsTouched = true;
      cleanup.settings_restored = false;
      await successfulPost(configuration);
    }
    const activeSettings = aiSettingsSchema.parse(await settings());
    assert.equal(activeSettings.enabled, true);
    assert.equal(activeSettings.auto_enqueue, false);
    assert.equal(activeSettings.daily_limit, originalSettings.daily_limit);
    assert.equal(activeSettings.monthly_limit, originalSettings.monthly_limit);
    assert.equal(activeSettings.authorized_by, adminId);
    ownSettingsVersion = activeSettings.updated_at;
    pass(
      "manual processing is enabled with original limits and automatic collection disabled",
    );

    phase = "real request form and deduplication";
    const sourceQuery = "?source_type=lead&source_id=" + leadId;
    const sourcePage = await page(sourceQuery);
    assert.ok(sourcePage.includes(cleanup.marker));
    const queuedForm = formFor(sourcePage, "request");
    queuedForm.set("source_type", "lead");
    queuedForm.set("source_id", leadId);
    assert.ok(denied(await request(owner, sourceQuery, queuedForm)));
    assert.ok(denied(await request(anonymous, sourceQuery, queuedForm)));
    await successfulPost(queuedForm, sourceQuery);
    const rows = await admin.db
      .from("platform_ai_jobs")
      .select("id")
      .eq("source_type", "lead")
      .eq("source_id", leadId);
    assert.ok(!rows.error && rows.data);
    cleanup.jobs.push(...rows.data.map((row) => row.id));
    assert.equal(cleanup.jobs.length, 1);
    const jobId = cleanup.jobs[0];
    assert.equal((await job(jobId)).status, "queued");
    await successfulPost(queuedForm, sourceQuery);
    const repeatedQueue = await admin.db
      .from("platform_ai_jobs")
      .select("id")
      .eq("source_type", "lead")
      .eq("source_id", leadId);
    assert.equal(repeatedQueue.data?.length, 1);
    assert.ok((await pendingJobs()).every((item) => item.id === jobId));
    pass(
      "the admin request form queues exactly one synthetic analysis and duplicate submissions do not create another job",
    );

    phase = "exactly one real generation through the process form";
    assert.equal(
      (await job(jobId)).status,
      "queued",
      "Another worker already claimed the QA job; do not trigger an additional generation.",
    );
    const beforeProcessing = aiSettingsSchema.parse(await settings());
    assert.equal(beforeProcessing.updated_at, ownSettingsVersion);
    assert.equal(beforeProcessing.auto_enqueue, false);
    assert.ok((await pendingJobs()).every((item) => item.id === jobId));
    const previousRuns = await admin.db
      .from("platform_ai_runs")
      .select("id")
      .eq("trigger", "manual");
    assert.equal(previousRuns.error, null);
    const knownRuns = new Set((previousRuns.data || []).map((run) => run.id));
    const processForm = formFor(await page("?id=" + jobId), "process");
    assert.ok(denied(await request(owner, "", processForm)));
    assert.ok(denied(await request(anonymous, "", processForm)));
    // Exactly one invocation; failure is never retried by this script.
    generationInvoked = true;
    await successfulPost(processForm);
    const generated = await job(jobId);
    assert.equal(generated.status, "draft");
    assert.equal(generated.error_code, null);
    const output = aiOutputSchema.parse(generated.output);
    assert.equal(generated.model, AI_MODEL);
    assert.equal(generated.automatic, false);
    assert.ok(generated.consumed_at);
    assert.ok(
      Number.isSafeInteger(generated.usage_input_tokens) &&
        generated.usage_input_tokens > 0,
    );
    assert.ok(
      Number.isSafeInteger(generated.usage_output_tokens) &&
        generated.usage_output_tokens > 0,
    );
    assert.equal(generated.applied_note_id, null);
    assert.deepEqual(await activities(leadId), activitiesBefore);
    const afterGeneration = await summary();
    assert.equal(
      afterGeneration.quota.day,
      beforeSummary.quota.day,
      "The run crossed the daily quota boundary; results need a separate review.",
    );
    assert.equal(afterGeneration.quota.month, beforeSummary.quota.month);
    assert.equal(
      afterGeneration.quota.daily_used,
      beforeSummary.quota.daily_used + 1,
    );
    assert.equal(
      afterGeneration.quota.monthly_used,
      beforeSummary.quota.monthly_used + 1,
    );
    const recordedRuns = await admin.db
      .from("platform_ai_runs")
      .select("id,processed,failed,error_code")
      .eq("trigger", "manual")
      .order("created_at", { ascending: false })
      .limit(50);
    assert.equal(recordedRuns.error, null);
    assert.ok(
      recordedRuns.data?.some(
        (run) =>
          !knownRuns.has(run.id) &&
          run.processed === 1 &&
          run.failed === 0 &&
          run.error_code === null,
      ),
    );
    pass(
      "one real provider response becomes a valid draft with reported usage, one reserved attempt and a successful manual execution",
    );

    phase = "edit a real generated draft through the review form";
    const editPage = await page("?id=" + jobId);
    const editing = formFor(editPage, "review");
    assert.equal(editing.get("id"), jobId);
    const editedBody =
      (output.suggested_reply || output.next_action).slice(0, 1800) +
      "\n\nRevisão interna de QA: confirmar a necessidade antes de qualquer contato. Registro sintético; não enviar ao cliente.";
    editing.set("body", editedBody);
    editing.set("action", "save");
    assert.ok(denied(await request(owner, "?id=" + jobId, editing)));
    assert.ok(denied(await request(anonymous, "?id=" + jobId, editing)));
    for (const client of [anon, owner.db]) {
      assert.ok(
        (
          await client.rpc("admin_ai_review", {
            p_job: jobId,
            p_action: "approve",
            p_body: editedBody,
            p_expected_updated_at: generated.updated_at,
          })
        ).error,
      );
    }
    assert.equal((await job(jobId)).updated_at, generated.updated_at);
    await successfulPost(editing, "?id=" + jobId);
    const saved = await job(jobId);
    assert.equal(saved.status, "draft");
    assert.equal(saved.reviewed_body, editedBody);
    assert.deepEqual(saved.output, generated.output);
    assert.equal(saved.applied_note_id, null);
    assert.deepEqual(await activities(leadId), activitiesBefore);
    // The pre-edit version must not be able to approve an unseen newer draft.
    editing.set("action", "approve");
    const stale = await request(admin, "?id=" + jobId, editing);
    assert.match(stale.body, /registro mudou/i);
    assert.deepEqual(await job(jobId), saved);
    pass(
      "real draft editing persists without publishing; tenant/anonymous writes and stale approval are rejected",
    );

    phase = "internal approval and idempotent repeat";
    const approveForm = formFor(await page("?id=" + jobId), "review");
    approveForm.set("body", editedBody);
    approveForm.set("action", "approve");
    await successfulPost(approveForm, "?id=" + jobId);
    const approved = await job(jobId);
    assert.equal(approved.status, "approved");
    assert.equal(approved.reviewed_body, editedBody);
    assert.ok(approved.applied_note_id);
    cleanup.notes.push(approved.applied_note_id);
    const afterApproval = await activities(leadId);
    const newNotes = afterApproval.filter(
      (item) => !activitiesBefore.some((before) => before.id === item.id),
    );
    assert.equal(newNotes.length, 1);
    assert.equal(newNotes[0].id, approved.applied_note_id);
    assert.equal(newNotes[0].kind, "note");
    assert.equal(newNotes[0].body, editedBody);
    assert.equal(newNotes[0].actor_id, adminId);
    await successfulPost(approveForm, "?id=" + jobId);
    assert.deepEqual(await job(jobId), approved);
    assert.deepEqual(await activities(leadId), afterApproval);
    const approvedPage = await page("?id=" + jobId);
    assert.match(approvedPage, /Texto aprovado internamente/);
    assert.match(approvedPage, /nota interna no histórico comercial/);
    const afterLead = await admin.db
      .from("sales_leads")
      .select("*")
      .eq("id", leadId)
      .single();
    assert.equal(afterLead.error, null);
    assert.deepEqual(afterLead.data, leadBefore.data);
    assert.equal(await businessSnapshot(), beforeBusiness);
    const finalSummary = await summary();
    assert.equal(
      finalSummary.quota.daily_used,
      afterGeneration.quota.daily_used,
    );
    assert.equal(
      finalSummary.quota.monthly_used,
      afterGeneration.quota.monthly_used,
    );
    pass(
      "approval creates exactly one internal note, repeats safely, and preserves the source, company access, plan prices and provider usage",
    );
    console.log(
      "SKIP admin AI success live: automatic source collection is global and was not enabled or tested against real records.",
    );
    success = true;
  } finally {
    // Recover exact owned IDs even if a response failed after its transaction committed.
    for (const leadId of cleanup.leads) {
      try {
        const rows = await admin.db
          .from("platform_ai_jobs")
          .select("id,applied_note_id")
          .eq("source_type", "lead")
          .eq("source_id", leadId);
        assert.equal(rows.error, null);
        for (const row of rows.data || []) {
          if (!cleanup.jobs.includes(row.id)) cleanup.jobs.push(row.id);
          if (
            row.applied_note_id &&
            !cleanup.notes.includes(row.applied_note_id)
          )
            cleanup.notes.push(row.applied_note_id);
        }
      } catch {
        // An unavailable cleanup read must not skip config restoration/sign-out.
        cleanup.ids_recovered = false;
      }
    }
    if ((settingsTouched || generationInvoked) && originalSettings) {
      try {
        const latest = aiSettingsSchema.parse(await settings());
        const blockingFailure =
          !latest.enabled &&
          [
            "provider_unavailable",
            "verification_required",
            "quota_exceeded",
          ].includes(latest.last_error_code || "");
        // Never undo a provider or concurrent administrator pause in cleanup.
        const restoreEnabled = originalSettings.enabled && latest.enabled;
        cleanup.provider_pause_preserved = blockingFailure;
        const alreadyRestored =
          latest.enabled === restoreEnabled &&
          latest.auto_enqueue === originalSettings.auto_enqueue &&
          latest.daily_limit === originalSettings.daily_limit &&
          latest.monthly_limit === originalSettings.monthly_limit;
        if (!alreadyRestored) {
          assert.ok(
            (await pendingJobs()).every((item) =>
              cleanup.jobs.includes(item.id),
            ),
            "Restoration must not invalidate a concurrently created real draft.",
          );
          assert.equal(latest.authorized_by, originalSettings.authorized_by);
          assert.equal(latest.daily_limit, originalSettings.daily_limit);
          assert.equal(latest.monthly_limit, originalSettings.monthly_limit);
          assert.equal(
            latest.auto_enqueue,
            false,
            "A concurrent config change must not be overwritten.",
          );
          const restored = await admin.db.rpc("admin_ai_settings_save", {
            p_enabled: restoreEnabled,
            p_auto_enqueue: originalSettings.auto_enqueue,
            p_daily_limit: originalSettings.daily_limit,
            p_monthly_limit: originalSettings.monthly_limit,
            p_expected_updated_at: latest.updated_at,
          });
          assert.equal(restored.error, null);
        }
        const actual = aiSettingsSchema.parse(await settings());
        cleanup.settings_restored =
          actual.enabled === restoreEnabled &&
          actual.auto_enqueue === originalSettings.auto_enqueue &&
          actual.daily_limit === originalSettings.daily_limit &&
          actual.monthly_limit === originalSettings.monthly_limit;
      } catch {
        cleanup.settings_restored = false;
      }
    }
    if (!cleanup.settings_restored) {
      console.error(
        "FAIL admin AI success live: configuration restoration requires attention; no sensitive details printed.",
      );
      process.exitCode = 1;
    }
    if (!cleanup.ids_recovered) {
      console.error(
        "FAIL admin AI success live: fixture cleanup IDs need review; configuration restoration was still attempted.",
      );
      process.exitCode = 1;
    }
    await Promise.allSettled([
      admin.db.auth.signOut({ scope: "local" }),
      owner.db.auth.signOut({ scope: "local" }),
    ]);
    console.log("ADMIN_AI_SUCCESS_TEST_CLEANUP " + JSON.stringify(cleanup));
    if (success && cleanup.settings_restored && cleanup.ids_recovered)
      console.log(
        "PASS admin AI success live: " +
          checks +
          " groups; manual generation and review only.",
      );
  }
}

main().catch(() => {
  console.error(
    "FAIL admin AI success live at " +
      phase +
      "; credentials, generated text, contact data and provider details omitted.",
  );
  process.exitCode = 1;
});
