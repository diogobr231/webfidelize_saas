import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

// Only explicit process values authorize credentials and remote HTTP requests.
// This test creates one marked commercial fixture, changes only its own task,
// and re-saves a rule with its existing values. No messages or payments are sent.
const enabled = process.env.TEST_ADMIN_OPERATIONS_LIVE === "1";
const remoteEnabled = process.env.TEST_ADMIN_OPERATIONS_REMOTE === "1";
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
  marker: "QA-OPS-" + randomUUID(),
  leads: [] as string[],
  tasks: [] as string[],
};
function pass(message: string) {
  checks++;
  console.log("PASS admin operations live: " + message);
}
function baseOrigin() {
  const url = new URL(requestedBase);
  assert.equal(requestedBase, requestedBase.trim());
  assert.ok(!url.username && !url.password && !url.search && !url.hash);
  assert.equal(url.pathname, "/");
  assert.ok(["http:", "https:"].includes(url.protocol));
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  assert.ok(
    local ||
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
function actionForm(
  html: string,
  matches: (source: string, fields: Record<string, string>[]) => boolean,
) {
  const candidates = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map(([source]) => ({
      source,
      inputs: [...source.matchAll(/<input\b[^>]*>/g)].map(([tag]) =>
        attributes(tag),
      ),
    }))
    .filter(({ source, inputs }) => matches(source, inputs));
  assert.equal(candidates.length, 1, "Expected exactly one real action form.");
  const form = new FormData();
  for (const input of candidates[0].inputs)
    if (input.type === "hidden" && input.name)
      form.append(input.name, input.value || "");
  assert.ok([...form.keys()].some((key) => key.startsWith("$ACTION_")));
  return form;
}
const hasField = (
  fields: Record<string, string>[],
  name: string,
  value: string,
) => fields.some((field) => field.name === name && field.value === value);
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
    enabled && password && adminEmail,
    "Explicit opt-in and existing credentials required.",
  );
  const base = baseOrigin();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  assert.ok(url && key);
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
  const anon = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const operationsPath = "/admin/automacoes";
  async function request(
    client: ReturnType<typeof session>,
    path: string,
    form?: FormData,
  ) {
    const target = new URL(path, base);
    assert.equal(target.origin, base.origin);
    assert.ok(["/admin", operationsPath].includes(target.pathname));
    if (form) assert.equal(target.pathname, operationsPath);
    const response = await fetch(target, {
      method: form ? "POST" : "GET",
      body: form,
      redirect: "manual",
      signal: AbortSignal.timeout(45_000),
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
        const name = pair.slice(0, index);
        const value = pair.slice(index + 1);
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
    const response = await request(admin, operationsPath + query);
    assert.equal(response.status, 200);
    return response.body;
  }
  async function taskForm(id: string) {
    assert.ok(cleanup.tasks.includes(id));
    // Done and snoozed tasks are excluded from the default filter. Follow the
    // real paginated view so new tasks from the same execution cannot hide QA.
    for (let number = 1; number <= 50; number++) {
      const html = await page(
        "?status=all&regra=lead_followup&pagina=" + number,
      );
      const fields = [...html.matchAll(/<input\b[^>]*>/g)].map(([tag]) =>
        attributes(tag),
      );
      if (hasField(fields, "id", id))
        return actionForm(html, (_source, inputs) =>
          hasField(inputs, "id", id),
        );
      const hasNext = [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].some(
        ([anchor]) => /Próxima/.test(anchor),
      );
      if (!hasNext) break;
    }
    throw new Error("The QA task must be reachable through the paginated UI.");
  }
  async function rule() {
    const result = await admin.db
      .from("platform_automation_rules")
      .select("*")
      .eq("id", "lead_followup")
      .single();
    assert.ok(!result.error && result.data);
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
  async function task(id: string) {
    assert.ok(cleanup.tasks.includes(id));
    const result = await admin.db
      .from("platform_tasks")
      .select("*")
      .eq("id", id)
      .single();
    assert.ok(!result.error && result.data);
    assert.equal(result.data.entity_id, cleanup.leads[0]);
    return result.data;
  }
  try {
    phase = "authentication and privileged pages";
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
    const beforeBusiness = await businessSnapshot();
    const originalRule = await rule();
    assert.equal(
      originalRule.enabled,
      true,
      "QA requires an already-enabled follow-up rule; it never enables rules.",
    );
    assert.ok(
      originalRule.threshold_hours >= 1 && originalRule.threshold_hours <= 720,
    );
    for (const path of ["/admin", operationsPath]) {
      assert.equal((await request(admin, path)).status, 200);
      assert.ok(denied(await request(owner, path)));
    }
    pass("admin pages load and the tenant owner cannot access them");

    phase = "anonymous and owner database isolation";
    for (const client of [anon, owner.db]) {
      for (const rpc of ["admin_operations_summary", "admin_run_operations"])
        assert.ok((await client.rpc(rpc)).error);
      assert.ok(
        (
          await client.rpc("admin_save_automation", {
            p_rule: originalRule.id,
            p_enabled: originalRule.enabled,
            p_threshold_hours: originalRule.threshold_hours,
            p_expected_updated_at: originalRule.updated_at,
          })
        ).error,
      );
      for (const table of [
        "platform_automation_rules",
        "platform_tasks",
        "platform_automation_runs",
      ]) {
        const selected = await client.from(table).select("id").limit(1);
        assert.ok(selected.error || selected.data?.length === 0);
      }
    }
    assert.deepEqual(await rule(), originalRule);
    assert.equal((await admin.db.rpc("admin_operations_summary")).error, null);
    pass(
      "anonymous and tenant sessions cannot read internal records or execute privileged RPCs",
    );

    phase = "rule form, stale version and action authorization";
    const configForm = actionForm(await page(), (_source, fields) =>
      hasField(fields, "rule", originalRule.id),
    );
    configForm.set("rule", originalRule.id);
    configForm.set("updated_at", originalRule.updated_at);
    configForm.set("enabled", String(originalRule.enabled));
    configForm.set("threshold", String(originalRule.threshold_hours));
    assert.ok(denied(await request(owner, operationsPath, configForm)));
    assert.deepEqual(await rule(), originalRule);
    const saved = await request(admin, operationsPath, configForm);
    assert.ok([200, 303].includes(saved.status));
    const updatedRule = await rule();
    assert.equal(updatedRule.enabled, originalRule.enabled);
    assert.equal(updatedRule.threshold_hours, originalRule.threshold_hours);
    assert.notEqual(updatedRule.updated_at, originalRule.updated_at);
    const stale = await request(admin, operationsPath, configForm);
    assert.match(stale.body, /registro mudou em outra aba ou execução/);
    assert.deepEqual(await rule(), updatedRule);
    pass(
      "the real configuration form preserves settings, rejects stale saves and checks owner authorization",
    );

    phase = "synthetic overdue opportunity";
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
          "Registro sintético exclusivo da validação de automações. Não entrar em contato.",
        source: "manual",
        consent: false,
      },
    });
    assert.ok(!created.error && typeof created.data === "string");
    const leadId = created.data;
    cleanup.leads.push(leadId);
    const lead = await admin.db
      .from("sales_leads")
      .select("id,version,contact_name")
      .eq("id", leadId)
      .single();
    assert.ok(!lead.error && lead.data);
    assert.equal(lead.data.contact_name, cleanup.marker);
    // 31 days exceeds the maximum configurable 720 hours without modifying the rule.
    assert.equal(
      (
        await admin.db.rpc("admin_save_sales_lead", {
          p_id: leadId,
          p_expected_version: lead.data.version,
          p_input: {
            next_contact_at: new Date(
              Date.now() - 31 * 24 * 60 * 60 * 1000,
            ).toISOString(),
            next_action:
              "QA: verificar somente a tarefa interna, sem mensagens.",
          },
        })
      ).error,
      null,
    );

    phase = "manual execution form and persisted run";
    const beforeRuns = await admin.db
      .from("platform_automation_runs")
      .select("id")
      .eq("trigger", "manual");
    assert.equal(beforeRuns.error, null);
    const previousRunIds = new Set(
      (beforeRuns.data || []).map((run) => run.id),
    );
    const runForm = actionForm(await page(), (source) =>
      /Verificar agora/.test(source),
    );
    assert.ok(denied(await request(owner, operationsPath, runForm)));
    const ran = await request(admin, operationsPath, runForm);
    assert.ok([200, 303].includes(ran.status));
    const afterRuns = await admin.db
      .from("platform_automation_runs")
      .select("id,status,finished_at")
      .eq("trigger", "manual")
      .order("started_at", { ascending: false })
      .limit(50);
    assert.equal(afterRuns.error, null);
    assert.ok(
      afterRuns.data?.some(
        (run) =>
          !previousRunIds.has(run.id) &&
          run.status === "succeeded" &&
          run.finished_at,
      ),
    );
    const generated = await admin.db
      .from("platform_tasks")
      .select("id,rule_id")
      .eq("entity_id", leadId);
    assert.ok(!generated.error && generated.data);
    cleanup.tasks.push(...generated.data.map((row) => row.id));
    const followup = generated.data.filter(
      (row) => row.rule_id === "lead_followup",
    );
    assert.equal(followup.length, 1);
    const taskId = followup[0].id;
    const opened = await task(taskId);
    assert.equal(opened.status, "open");
    pass(
      "manual execution persists a completed run and creates exactly one follow-up task for the QA lead",
    );

    phase = "task mutation guards";
    for (const client of [anon, owner.db]) {
      assert.ok(
        (
          await client.rpc("admin_manage_task", {
            p_id: taskId,
            p_action: "done",
            p_expected_updated_at: opened.updated_at,
          })
        ).error,
      );
    }
    assert.deepEqual(await task(taskId), opened);
    const forbiddenTask = await taskForm(taskId);
    forbiddenTask.set("action", "done");
    assert.ok(denied(await request(owner, operationsPath, forbiddenTask)));
    assert.deepEqual(await task(taskId), opened);
    pass(
      "tenant and anonymous users cannot mutate even a known internal task ID",
    );

    phase = "task done, reopen and snooze forms";
    for (const action of ["done", "reopen", "snooze24h"] as const) {
      const beforeTask = await task(taskId);
      const form = await taskForm(taskId);
      form.set("action", action);
      const response = await request(admin, operationsPath, form);
      assert.ok([200, 303].includes(response.status));
      const changed = await task(taskId);
      assert.notEqual(changed.updated_at, beforeTask.updated_at);
      assert.equal(changed.status, action === "done" ? "done" : "open");
      if (action === "done") assert.ok(changed.completed_at);
      else assert.equal(changed.completed_at, null);
      if (action === "snooze24h") {
        assert.ok(changed.snoozed_until);
        const hours =
          (Date.parse(changed.snoozed_until) - Date.now()) / 3_600_000;
        assert.ok(hours > 23 && hours <= 25);
      } else assert.equal(changed.snoozed_until, null);
    }
    assert.equal(await businessSnapshot(), beforeBusiness);
    const finalRule = await rule();
    assert.equal(finalRule.enabled, originalRule.enabled);
    assert.equal(finalRule.threshold_hours, originalRule.threshold_hours);
    pass(
      "the QA task is completed, reopened and snoozed through real forms; company, plan and rule settings remain unchanged",
    );
    console.log("PASS admin operations live: " + checks + " groups");
  } finally {
    // Recover task IDs even if the response check failed after the run committed.
    for (const leadId of cleanup.leads) {
      const rows = await admin.db
        .from("platform_tasks")
        .select("id")
        .eq("entity_id", leadId);
      for (const row of rows.data || [])
        if (!cleanup.tasks.includes(row.id)) cleanup.tasks.push(row.id);
    }
    await Promise.allSettled([
      admin.db.auth.signOut({ scope: "local" }),
      owner.db.auth.signOut({ scope: "local" }),
    ]);
    console.log("ADMIN_OPERATIONS_TEST_CLEANUP " + JSON.stringify(cleanup));
  }
}

main().catch(() => {
  console.error(
    "FAIL admin operations live at " +
      phase +
      "; credentials, response bodies and provider details omitted.",
  );
  process.exitCode = 1;
});
