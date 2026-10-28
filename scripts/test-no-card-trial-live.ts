import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServerClient } from "@supabase/ssr";

// Explicit QA only: an existing synthetic EMPLOYEE temporarily creates one
// clearly marked tenant. No Auth identities, email or payments are created.
// The exact-row manifest supports privileged cleanup outside this script.
const enabled = process.env.TEST_NO_CARD_TRIAL_LIVE === "1";
const production = process.env.TEST_NO_CARD_TRIAL_PRODUCTION === "1";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const originalCompanyId = "5ed3e808-3608-4c85-905f-75b1ecd32ec2";
const email = "essencial.colaborador@example.invalid";
const marker = `QA-TRIAL-${randomUUID()}`;
const manifestPath = `test-results/no-card-trial-live-${marker.slice(9)}.json`;
let phase = "configuration",
  checks = 0;
const pass = (message: string) => {
  checks++;
  console.log(`PASS no-card live: ${message}`);
};
const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
const attrs = (s: string) =>
  Object.fromEntries(
    [...s.matchAll(/([\w$:-]+)\s*=\s*"([^"]*)"/g)].map((m) => [
      m[1],
      decode(m[2]),
    ]),
  );
const visible = (s: string) =>
  decode(
    s
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/<!--[\s\S]*?-->/g, ""),
  ).replace(/\s+/g, " ");
function form(html: string, identifier: string) {
  const source = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map((m) => m[0])
    .find((s) => s.includes(identifier));
  assert.ok(source, "Expected real Server Action form");
  const data = new FormData();
  for (const match of source.matchAll(/<input\b[^>]*>/g)) {
    const input = attrs(match[0]);
    if (input.type === "hidden" && input.name)
      data.append(input.name, input.value || "");
  }
  assert.ok(
    [...data.keys()].some(
      (k) => k.startsWith("$ACTION_ID_") || k.startsWith("$ACTION_REF_"),
    ),
  );
  return data;
}

async function main() {
  assert.ok(enabled, "Explicit TEST_NO_CARD_TRIAL_LIVE=1 required");
  const base = new URL(process.env.TEST_BASE_URL || "http://127.0.0.1:3000");
  assert.ok(
    !base.username &&
      !base.password &&
      ["http:", "https:"].includes(base.protocol),
  );
  assert.ok(
    ["localhost", "127.0.0.1"].includes(base.hostname) ||
      (production && base.origin === "https://webfidelize-saas.vercel.app"),
    "Only local or explicitly opted-in known production origin is allowed",
  );
  const password =
    process.env.TEST_PLAN_ACCOUNTS_PASSWORD || process.env.SEED_PASSWORD;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  assert.ok(
    password && url && key,
    "Configured public client and existing DEMO password required",
  );
  const cookies = new Map<string, string>();
  const db = createServerClient(url, key, {
    auth: { autoRefreshToken: false },
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: (items) =>
        items.forEach(({ name, value }) =>
          value ? cookies.set(name, value) : cookies.delete(name),
        ),
    },
  });
  const manifest: Record<string, unknown> = {
    marker,
    base: base.origin,
    originalCompanyId,
    createdCompanyId: null,
    serviceId: null,
    professionalId: null,
    checks: 0,
    passed: false,
  };
  async function saveManifest() {
    await mkdir("test-results", { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, checks }, null, 2),
    );
  }
  async function request(path: string, body?: FormData) {
    const target = new URL(path, base);
    assert.equal(
      target.origin,
      base.origin,
      "Never transfer auth cookies off-origin",
    );
    if (body)
      assert.ok(
        target.pathname === "/comecar" ||
          (manifest.createdCompanyId &&
            target.pathname ===
              `/painel/${manifest.createdCompanyId}/configuracao`),
        "Only verified QA creation/setup forms may mutate",
      );
    const response = await fetch(target, {
      method: body ? "POST" : "GET",
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(40000),
      headers: {
        Accept: "text/html",
        Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        ...(body ? { Origin: base.origin, Referer: target.toString() } : {}),
      },
    });
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";", 1)[0],
        i = pair.indexOf("=");
      if (i > 0) {
        const name = pair.slice(0, i),
          value = pair.slice(i + 1);
        if (!value || /max-age=0(?:;|$)/i.test(header)) cookies.delete(name);
        else cookies.set(name, value);
      }
    }
    return response;
  }
  async function destination(response: Response) {
    let target = response.headers.get("location");
    if (!target && response.status === 200) {
      const html = await response.text();
      const meta = [...html.matchAll(/<meta\b[^>]*>/g)]
        .map((m) => attrs(m[0]))
        .find((m) => m.id === "__next-page-redirect");
      target = meta?.content?.match(/^[01];url=(.*)$/)?.[1] || null;
    }
    assert.ok(target, "Expected application redirect");
    const result = new URL(target, base);
    assert.equal(result.origin, base.origin);
    return result;
  }
  async function company(id: string) {
    const result = await db
      .from("companies")
      .select(
        "id,name,niche,plan_id,status,trial_ends_at,trial_card_required,is_demo,booking_enabled,booking_slug",
      )
      .eq("id", id)
      .single();
    assert.equal(result.error, null, "Company read should succeed");
    return result.data;
  }
  try {
    phase = "verify existing synthetic employee";
    const login = await db.auth.signInWithPassword({ email, password });
    assert.ok(
      !login.error && login.data.user && cookies.size,
      "DEMO login required",
    );
    const userId = login.data.user.id;
    const memberships = await db
      .from("memberships")
      .select("company_id,user_id,role")
      .eq("user_id", userId);
    assert.equal(memberships.error, null);
    assert.deepEqual(
      memberships.data,
      [{ company_id: originalCompanyId, user_id: userId, role: "EMPLOYEE" }],
      "Only this existing single-membership DEMO employee may run this test",
    );
    const baseline = await company(originalCompanyId);
    assert.equal(baseline.is_demo, true);
    manifest.userId = userId;
    manifest.baselineMemberships = memberships.data;
    manifest.baselineCompany = baseline;
    await saveManifest();
    pass(
      "existing DEMO employee verified; original tenant recorded for preservation",
    );

    phase = "create company through actual form";
    const initialResponse = await request("/comecar");
    assert.equal(initialResponse.status, 200);
    const startHtml = await initialResponse.text();
    assert.match(visible(startHtml), /sem cartão|[Nn]ão precisa de cartão/i);
    const create = form(startHtml, 'name="niche"');
    create.set("name", marker);
    create.set("niche", "salao");
    create.set("intent", "next");
    const before = Date.now();
    const creationResponse = await request("/comecar", create);
    // Persist cleanup identity even if rendering/redirect assertions fail after commit.
    const newOwnership = await db
      .from("memberships")
      .select("company_id")
      .eq("user_id", userId)
      .eq("role", "OWNER")
      .maybeSingle();
    if (newOwnership.data?.company_id) {
      manifest.createdCompanyId = newOwnership.data.company_id;
      await saveManifest();
    }
    const createdDestination = await destination(creationResponse);
    assert.equal(newOwnership.error, null);
    assert.ok(newOwnership.data);
    const companyId = newOwnership.data.company_id;
    assert.notEqual(companyId, originalCompanyId);
    const created = await company(companyId);
    assert.equal(created.name, marker);
    assert.equal(created.niche, "salao");
    assert.equal(created.status, "trialing");
    assert.equal(created.trial_card_required, false);
    assert.equal(created.plan_id, "essencial");
    const expiry = Date.parse(created.trial_ends_at);
    assert.ok(
      expiry >= before + 7 * 86400000 - 5000 &&
        expiry <= Date.now() + 7 * 86400000 + 5000,
      "Expiry must be seven days from server creation, allowing small clock drift",
    );
    const setup = `/painel/${companyId}/configuracao`,
      panel = `/painel/${companyId}`;
    assert.equal(createdDestination.pathname, setup);
    assert.equal(createdDestination.searchParams.get("etapa"), "servicos");
    manifest.createdCompany = created;
    await saveManifest();
    pass(
      "real form creates Essencial salon trial and opens setup without card; backend expiry is seven days",
    );

    phase = "onboarding records and dashboard";
    const servicePath = `${setup}?etapa=servicos`;
    const service = form(
      await (await request(servicePath)).text(),
      'name="price"',
    );
    manifest.serviceId = service.get("record_id");
    await saveManifest();
    service.set("name", `${marker} serviço`);
    service.set("duration", "30");
    service.set("price", "49,90");
    service.set("intent", "next");
    assert.equal(
      (await destination(await request(servicePath, service))).searchParams.get(
        "etapa",
      ),
      "equipe",
    );
    const savedService = await db
      .from("services")
      .select("id,name,duration_minutes,price_cents")
      .eq("company_id", companyId)
      .eq("id", manifest.serviceId)
      .single();
    assert.equal(savedService.error, null);
    assert.equal(savedService.data?.price_cents, 4990);
    assert.equal(savedService.data?.duration_minutes, 30);
    const staffPath = `${setup}?etapa=equipe`;
    const staff = form(
      await (await request(staffPath)).text(),
      'name="record_id"',
    );
    manifest.professionalId = staff.get("record_id");
    await saveManifest();
    staff.set("name", `${marker} profissional`);
    staff.set("intent", "next");
    assert.equal(
      (await destination(await request(staffPath, staff))).searchParams.get(
        "etapa",
      ),
      "resumo",
    );
    const savedStaff = await db
      .from("professionals")
      .select("id,name")
      .eq("company_id", companyId)
      .eq("id", manifest.professionalId)
      .single();
    assert.equal(savedStaff.error, null);
    assert.equal(savedStaff.data?.name, `${marker} profissional`);
    const response = await request(panel);
    assert.equal(response.status, 200);
    const panelText = visible(await response.text());
    assert.match(panelText, /Seu negócio, em perspectiva/);
    assert.match(panelText, /Teste gratuito até/);
    assert.doesNotMatch(
      panelText,
      /Seu teste ainda não começou|Alterações bloqueadas|Não foi possível carregar os indicadores/,
    );
    pass(
      "real setup saves service and professional; authenticated dashboard renders active trial and metrics",
    );

    phase = "retry and unauthorized expiry changes";
    assert.equal(
      (await destination(await request("/comecar", create))).pathname,
      setup,
    );
    assert.equal(
      (await company(companyId)).trial_ends_at,
      created.trial_ends_at,
    );
    const reset = await db.rpc("create_company", {
      company_name: `${marker} retry`,
      company_niche: "salao",
    });
    assert.ok(reset.error, "Repeated direct RPC must not grant another trial");
    const tamper = await db
      .from("companies")
      .update({
        status: "active",
        trial_ends_at: new Date(Date.now() + 30 * 86400000).toISOString(),
        trial_card_required: false,
      })
      .eq("id", companyId);
    assert.ok(tamper.error, "Tenant must not update privileged access columns");
    const unchanged = await company(companyId);
    assert.equal(unchanged.status, "trialing");
    assert.equal(unchanged.trial_ends_at, created.trial_ends_at);
    pass(
      "repeat form and direct RPC cannot restart the trial; owner cannot self-activate or change expiry",
    );

    phase = "preserve original tenant and cleanup manifest";
    assert.deepEqual(await company(originalCompanyId), baseline);
    const originalMembership = await db
      .from("memberships")
      .select("company_id,user_id,role")
      .eq("company_id", originalCompanyId)
      .eq("user_id", userId)
      .single();
    assert.equal(originalMembership.error, null);
    assert.deepEqual(originalMembership.data, memberships.data![0]);
    const allMemberships = await db
      .from("memberships")
      .select("company_id,role")
      .eq("user_id", userId);
    assert.equal(allMemberships.data?.length, 2);
    manifest.passed = true;
    await saveManifest();
    pass(
      "original DEMO company and employee membership preserved; exact QA IDs recorded for cleanup",
    );
    console.log(
      `PASS no-card live: ${checks} groups. No email, new Auth user, payment, or existing trial changed. Cleanup manifest saved under test-results.`,
    );
  } finally {
    await saveManifest();
    await db.auth.signOut({ scope: "local" });
    cookies.clear();
  }
}
main().catch((error: unknown) => {
  console.error(
    `FAIL no-card live during ${phase}; credentials, response bodies and provider details omitted.`,
  );
  const line =
    error instanceof Error
      ? error.stack
          ?.split("\n")
          .find((s) => /test-no-card-trial-live\.(?:ts|js):\d+/.test(s))
      : undefined;
  if (line) console.error(line.trim());
  process.exitCode = 1;
});
