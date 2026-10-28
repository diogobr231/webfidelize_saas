import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServerClient } from "@supabase/ssr";
import {
  startFakeAuth,
  fakeEmail,
  fakePassword,
} from "../tests/fixtures/auth-server";
import {
  marketingCampaignSchema,
  type MarketingCampaign,
} from "../src/lib/marketing";
import { niches } from "../src/lib/catalog";

// Real Next HTML/Server Actions against disposable in-memory HTTP fixtures.
// This file never loads .env or calls real Supabase, AI, Meta or mail providers.
// SQL authorization/lifecycle is independently tested by test-marketing-db.ts.
const publicOrigin = "https://devmjeiblhrgjyaiaukm.supabase.co";
const appOrigin = "https://webfidelize-saas.vercel.app";
const campaignId = "55555555-5555-4555-8555-555555555555";
const basePath = "/admin/marketing";
let phase = "setup",
  checks = 0;
const pass = (message: string) => {
  checks++;
  console.log(`PASS isolated marketing: ${message}`);
};
const decode = (s: string) =>
  s
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
const visible = (html: string) =>
  decode(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, " ")
      .replace(/<[^>]*>/g, " "),
  ).replace(/\s+/g, " ");
function actionForm(html: string, identifier: string) {
  const source = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map((m) => m[0])
    .find((value) => value.includes(identifier));
  assert(source, `Missing real rendered form: ${identifier}`);
  const body = new FormData();
  for (const match of source.matchAll(/<input\b[^>]*>/g)) {
    const input = attrs(match[0]);
    if (input.type === "hidden" && input.name)
      body.append(input.name, input.value ?? "");
  }
  assert(
    [...body.keys()].some((key) => key.startsWith("$ACTION_")),
    "Real bound Server Action required",
  );
  return body;
}
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function main() {
  assert(
    existsSync(".next/BUILD_ID"),
    "Build the app before isolated marketing HTTP tests",
  );
  const fakeAuth = await startFakeAuth(publicOrigin);
  const allowedTokens = new Set<string>();
  // Test-side state only. No browser parameter/header can promote this flag.
  const state: {
    admin: boolean;
    failed: boolean;
    campaign: MarketingCampaign | null;
    events: { id: string; kind: string; created_at: string }[];
  } = { admin: true, failed: false, campaign: null, events: [] };
  const calls: { name: string; body: Record<string, unknown> }[] = [];
  const unexpected: string[] = [];
  const reads: { table: string; query: URLSearchParams; method?: string }[] =
    [];
  const fixtureSecrets = {
    worker: "fixture-private-worker-secret-never-render",
    smtp: "fixture-private-mail-password-never-render",
    whatsapp: "fixture-private-whatsapp-token-never-render",
    cron: "fixture-private-cron-secret-never-render",
  };
  const companies = Array.from({ length: 201 }, (_, index) => ({
    id: `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
    name:
      index === 0
        ? "Espaço HTTP 001 50%_\\Loja"
        : `Espaço HTTP ${String(index + 1).padStart(3, "0")}`,
    niche: niches[index % niches.length].slug,
    plan_id: ["essencial", "profissional", "empresarial"][index % 3],
    status:
      index % 4 === 0 ? "active" : index % 4 === 3 ? "suspended" : "trialing",
    trial_ends_at: new Date(
      Date.now() + (index % 4 === 2 ? -1 : 1) * 86400000,
    ).toISOString(),
    paid_until:
      index % 4 === 0 ? new Date(Date.now() + 86400000).toISOString() : null,
    is_demo: index % 5 === 0,
    created_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  }));
  function matchesLike(name: string, filter: string) {
    let expression = "";
    for (let i = 0; i < filter.length; i++) {
      let character = filter[i];
      if (character === "\\" && i + 1 < filter.length) character = filter[++i];
      else if (character === "%") {
        expression += ".*";
        continue;
      } else if (character === "_") {
        expression += ".";
        continue;
      }
      expression += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`^${expression}$`, "iu").test(name);
  }
  const backend = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    const send = (status: number, data: unknown, count?: number) => {
      response.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...(count === undefined
          ? {}
          : { "Content-Range": count ? `0-${count - 1}/${count}` : "*/0" }),
      });
      response.end(JSON.stringify(data));
    };
    if (url.pathname.startsWith("/auth/")) {
      const forwarded = await fetch(
        new URL(url.pathname + url.search, fakeAuth.origin),
        {
          method: request.method,
          headers: {
            "Content-Type": "application/json",
            Authorization: request.headers.authorization ?? "",
          },
          ...(bytes.length ? { body: bytes.toString() } : {}),
          redirect: "manual",
        },
      );
      const authBody = await forwarded.text();
      if (forwarded.ok && url.pathname === "/auth/v1/token") {
        const issued = JSON.parse(authBody) as { access_token?: string };
        if (issued.access_token) allowedTokens.add(issued.access_token);
      }
      response.writeHead(forwarded.status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(authBody);
      return;
    }
    const token = request.headers.authorization?.replace(/^Bearer /, "") ?? "";
    const authenticated = allowedTokens.has(token);
    if (url.pathname === "/rest/v1/rpc/is_super_admin")
      return send(200, authenticated && state.admin);
    if (url.pathname === "/rest/v1/plans")
      return send(200, [
        {
          id: "essencial",
          name: "Essencial",
          price_cents: 4990,
          staff_limit: 1,
          team_insights: false,
          team_export: false,
        },
      ]);
    if (!authenticated || !state.admin)
      return send(403, { code: "42501", message: "fixture admin required" });
    if (state.failed)
      return send(503, { code: "P0001", message: "fixture unavailable" });
    if (url.pathname === "/rest/v1/memberships") {
      reads.push({
        table: "memberships",
        query: url.searchParams,
        method: request.method,
      });
      return send(200, []);
    }
    if (url.pathname === "/rest/v1/companies") {
      reads.push({
        table: "companies",
        query: url.searchParams,
        method: request.method,
      });
      let rows = [...companies];
      const name = url.searchParams.get("name");
      if (name?.startsWith("ilike."))
        rows = rows.filter((row) => matchesLike(row.name, name.slice(6)));
      for (const key of ["id", "plan_id", "niche", "status"] as const) {
        const match = url.searchParams.get(key);
        if (match?.startsWith("eq."))
          rows = rows.filter((row) => row[key] === match.slice(3));
      }
      const trial = url.searchParams.get("trial_ends_at");
      if (trial?.startsWith("gt."))
        rows = rows.filter((row) => row.trial_ends_at > trial.slice(3));
      if (trial?.startsWith("lte."))
        rows = rows.filter((row) => row.trial_ends_at <= trial.slice(4));
      rows.sort(
        (a, b) =>
          b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
      );
      const total = rows.length;
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? rows.length);
      rows = rows.slice(offset, offset + limit);
      return send(200, rows, total);
    }
    if (url.pathname === "/rest/v1/whatsapp_settings") {
      reads.push({
        table: "whatsapp_settings",
        query: url.searchParams,
        method: request.method,
      });
      const ids = (url.searchParams.get("company_id") ?? "")
        .replace(/^in\(/, "")
        .replace(/\)$/, "")
        .split(",");
      return send(
        200,
        companies
          .filter((row) => ids.includes(row.id))
          .map((row) => ({
            company_id: row.id,
            enabled: false,
            monthly_limit: 100,
            platform_limit: 0,
          })),
      );
    }
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const name = url.pathname.slice("/rest/v1/rpc/".length);
      const body = JSON.parse(bytes.toString() || "{}") as Record<
        string,
        unknown
      >;
      calls.push({ name, body });
      if (name === "marketing_save_campaign") {
        const parsed = marketingCampaignSchema.safeParse(body.p_payload);
        if (!parsed.success)
          return send(400, {
            code: "P0001",
            message: "marketing invalid payload",
          });
        const existing = state.campaign;
        if (body.p_campaign) {
          if (
            !existing ||
            body.p_campaign !== existing.id ||
            body.p_version !== existing.version
          )
            return send(400, {
              code: "P0001",
              message: "marketing version conflict",
            });
          state.campaign = {
            ...existing,
            ...parsed.data,
            status: "draft",
            version: existing.version + 1,
            updated_at: new Date().toISOString(),
          };
          state.events.unshift({
            id: randomUUID(),
            kind: "updated",
            created_at: state.campaign.updated_at,
          });
        } else if (!existing) {
          const now = new Date().toISOString();
          state.campaign = {
            ...parsed.data,
            id: campaignId,
            request_id: String(body.p_request_id),
            version: 1,
            status: "draft",
            created_at: now,
            updated_at: now,
          };
          state.events.unshift({
            id: randomUUID(),
            kind: "created",
            created_at: now,
          });
        } else if (body.p_request_id !== existing.request_id)
          return send(400, {
            code: "P0001",
            message: "fixture supports one campaign",
          });
        return send(200, state.campaign);
      }
      if (name === "marketing_change_status") {
        if (
          !state.campaign ||
          body.p_campaign !== state.campaign.id ||
          body.p_version !== state.campaign.version
        )
          return send(400, {
            code: "P0001",
            message: "marketing version conflict",
          });
        const status = String(body.p_status) as MarketingCampaign["status"];
        const allowed: Record<string, string[]> = {
          draft: ["review", "archived"],
          review: ["approved", "draft", "archived"],
          approved: ["draft", "archived"],
          archived: ["draft"],
        };
        if (!allowed[state.campaign.status].includes(status))
          return send(400, {
            code: "P0001",
            message: "marketing invalid transition",
          });
        state.campaign = {
          ...state.campaign,
          status,
          version: state.campaign.version + 1,
          updated_at: new Date().toISOString(),
        };
        state.events.unshift({
          id: randomUUID(),
          kind: "status_changed",
          created_at: state.campaign.updated_at,
        });
        return send(200, state.campaign);
      }
      unexpected.push(name);
      return send(400, { code: "P0001", message: "unexpected fixture RPC" });
    }
    if (url.pathname === "/rest/v1/platform_marketing_campaigns") {
      const selected = url.searchParams.get("id")?.replace(/^eq\./, "");
      const requestedStatus = url.searchParams
        .get("status")
        ?.replace(/^eq\./, "");
      const rows =
        state.campaign &&
        (!selected || selected === state.campaign.id) &&
        (!requestedStatus || requestedStatus === state.campaign.status)
          ? [state.campaign]
          : [];
      if (request.headers.accept?.includes("vnd.pgrst.object+json"))
        return rows.length
          ? send(200, rows[0])
          : send(406, { code: "PGRST116", message: "No fixture row" });
      return send(200, rows, rows.length);
    }
    if (url.pathname === "/rest/v1/platform_marketing_events")
      return send(200, state.events);
    if (url.pathname === "/rest/v1/platform_marketing_generations")
      return send(200, []);
    unexpected.push(url.pathname);
    return send(404, { message: "Unknown fixture request" });
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const backendOrigin = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(resolve("tests/fixtures/marketing-fetch-hook.mjs")).href,
      "node_modules/next/dist/bin/next",
      "start",
      "-p",
      String(port),
      "-H",
      "127.0.0.1",
    ],
    {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        APP_URL: appOrigin,
        AUTH_LEGACY_ORIGINS: "",
        AUTH_FLOW_SECRET: "isolated-marketing-auth-secret-not-production",
        TEST_MARKETING_BACKEND_URL: backendOrigin,
        NEXT_PUBLIC_SUPABASE_URL: publicOrigin,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "isolated-publishable-key",
        AI_GATEWAY_API_KEY: "",
        VERCEL_OIDC_TOKEN: "",
        VERCEL_ENV: "preview",
        VERCEL: "0",
        BILLING_MODE: "disabled",
        BILLING_GATEWAY_SECRET: "",
        MERCADO_PAGO_ACCESS_TOKEN: "",
        MERCADO_PAGO_TEST_ACCESS_TOKEN: "",
        MERCADO_PAGO_COLLECTOR_ID: "",
        MERCADO_PAGO_WEBHOOK_SECRET: "",
        WHATSAPP_SEND_ENABLED: "false",
        WHATSAPP_CONNECTIONS_JSON: JSON.stringify([
          {
            companyId: companies[0].id,
            phoneNumberId: "123456789",
            accessToken: fixtureSecrets.whatsapp,
            templateName: "fixture_notice",
            languageCode: "pt_BR",
          },
        ]),
        WHATSAPP_APP_SECRET: "",
        WHATSAPP_GRAPH_VERSION: "",
        WHATSAPP_GATEWAY_SECRET: "",
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: "",
        TEAM_SMTP_HOST: "",
        TEAM_SMTP_PORT: "465",
        TEAM_SMTP_USER: "",
        TEAM_SMTP_PASSWORD: fixtureSecrets.smtp,
        TEAM_SMTP_FROM: "",
        AI_WORKER_SECRET: fixtureSecrets.worker,
        CRON_SECRET: fixtureSecrets.cron,
      },
    },
  );
  let childErrors = "";
  child.stdout.on("data", () => {});
  child.stderr.on("data", (chunk) => {
    childErrors = (childErrors + String(chunk)).slice(-3000);
  });
  const cookies = new Map<string, string>();
  const localAuth = createServerClient(
    publicOrigin,
    "isolated-publishable-key",
    {
      auth: { autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const url = new URL(
            input instanceof Request ? input.url : String(input),
          );
          return fetch(
            new URL(url.pathname + url.search, fakeAuth.origin),
            init,
          );
        },
      },
      cookies: {
        getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
        setAll: (items) =>
          items.forEach(({ name, value }) => cookies.set(name, value)),
      },
    },
  );
  const session = fakeAuth.session("password");
  allowedTokens.add(session.access_token);
  assert.equal((await localAuth.auth.setSession(session)).error, null);
  async function request(
    path: string,
    body?: FormData,
    authenticated = true,
    postOrigin = base,
  ) {
    const url = new URL(path, base);
    assert.equal(url.origin, base, "Fixture cookies cannot leave loopback");
    return fetch(url, {
      method: body ? "POST" : "GET",
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
      headers: {
        Accept: "text/html",
        ...(authenticated
          ? {
              Cookie: [...cookies]
                .map(([key, value]) => `${key}=${value}`)
                .join("; "),
            }
          : {}),
        ...(body ? { Origin: postOrigin, Referer: url.toString() } : {}),
      },
    });
  }
  async function html(path = basePath) {
    const result = await request(path);
    assert.equal(result.status, 200);
    return result.text();
  }
  async function destination(response: Response) {
    let location = response.headers.get("location");
    if (!location && response.status === 200) {
      const source = await response.text();
      const meta = [...source.matchAll(/<meta\b[^>]*>/g)]
        .map((m) => attrs(m[0]))
        .find((tag) => tag.id === "__next-page-redirect");
      location = meta?.content?.match(/^[01];url=(.*)$/)?.[1] ?? null;
    }
    assert(location, `Expected action redirect; status ${response.status}`);
    const target = new URL(location, base);
    assert.equal(target.origin, base);
    return target;
  }
  const formValues = {
    name: "Campanha fictícia HTTP",
    channel: "instagram",
    goal: "demo",
    niche: "salao",
    audience: "Público fictício de teste",
    brief: "Sem publicação externa",
    budget: "123,45",
    headline: "Organize os horários do salão",
    body: "Conheça a Web Fidelize e experimente a demonstração com dados fictícios.",
    cta: "Ver demonstração",
  };
  function complete(body: FormData) {
    for (const [name, value] of Object.entries(formValues))
      body.set(name, value);
    return body;
  }
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const ready = await request("/entrar", undefined, false);
        await ready.body?.cancel();
        if (ready.status === 200) break;
      } catch {
        /* startup */
      }
      if (attempt === 99) throw new Error("Isolated Next startup failed");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    phase = "anonymous protection";
    assert.equal(
      (await destination(await request(basePath, undefined, false))).pathname,
      "/entrar",
    );
    pass("anonymous marketing access requires the normal login flow");

    phase = "space and integrations access control";
    for (const path of [
      "/admin/espacos",
      "/admin/integracoes",
      "/admin/whatsapp",
    ]) {
      assert.equal(
        (await destination(await request(path, undefined, false))).pathname,
        "/entrar",
      );
      state.admin = false;
      const deniedPage = await request(path);
      const deniedSource = await deniedPage.text();
      assert(
        deniedPage.status === 404 ||
          deniedSource.includes("NEXT_HTTP_ERROR_FALLBACK;404"),
      );
      assert(!visible(deniedSource).includes("Espaço HTTP"));
      state.admin = true;
    }
    pass(
      "spaces, integrations and WhatsApp quotas require login and the server-verified administrator role",
    );

    phase = "all spaces and membership-free redirect";
    const companiesBeforeRedirect = reads.filter(
      (read) => read.table === "companies",
    ).length;
    assert.equal(
      (await destination(await request("/painel?empresas=1"))).pathname,
      "/admin/espacos",
    );
    assert.equal(
      reads.filter((read) => read.table === "companies").length,
      companiesBeforeRedirect,
    );
    const firstSpaces = await html("/admin/espacos");
    assert.match(visible(firstSpaces), /201 empresas encontradas/);
    assert.match(visible(firstSpaces), /Exibindo 1\s*–\s*25 de 201 empresas/);
    assert.match(visible(firstSpaces), /Espaço HTTP 201/);
    assert(!visible(firstSpaces).includes("Espaço HTTP 001"));
    const fifthSpaces = await html("/admin/espacos?pagina=5");
    assert.match(visible(fifthSpaces), /Exibindo 101\s*–\s*125 de 201 empresas/);
    assert.match(visible(fifthSpaces), /Espaço HTTP 101/);
    const finalSpaces = await html("/admin/espacos?pagina=9");
    assert.match(visible(finalSpaces), /Espaço HTTP 001/);
    assert.match(visible(finalSpaces), /Exibindo 201\s*–\s*201 de 201 empresas/);
    assert(finalSpaces.includes(`/admin/empresas/${companies[0].id}`));
    assert(
      finalSpaces.includes(
        `/admin?empresa=${companies[0].id}#empresa-${companies[0].id}`,
      ),
    );
    assert.equal(
      (
        await destination(await request("/admin/espacos?pagina=99"))
      ).searchParams.get("pagina"),
      "9",
    );
    pass(
      "Ver espaços redirects without memberships and every company remains reachable after the first 100, through the final page",
    );

    phase = "space filtering and literal search";
    const sample = companies[120];
    const search = new URLSearchParams({
      q: sample.name,
      plano: sample.plan_id,
      situacao: sample.status,
      segmento: sample.niche,
    });
    const filtered = visible(await html(`/admin/espacos?${search}`));
    assert.match(filtered, /1 empresa encontrada/);
    assert(filtered.includes(sample.name));
    const literal = visible(
      await html(`/admin/espacos?${new URLSearchParams({ q: "50%_\\Loja" })}`),
    );
    assert.match(literal, /1 empresa encontrada/);
    assert(literal.includes(companies[0].name));
    const emptySpaces = visible(
      await html("/admin/espacos?q=Empresa-que-nao-existe"),
    );
    assert.match(emptySpaces, /Nenhuma empresa encontrada/);
    const filteredRequest = reads.findLast(
      (read) =>
        read.table === "companies" && read.query.get("name")?.includes("50"),
    );
    assert.equal(
      filteredRequest?.query.get("name"),
      "ilike.%50\\%\\_\\\\Loja%",
    );
    pass(
      "name, plan, state and niche filters use real backend predicates; LIKE wildcards stay literal and an empty search is explicit",
    );

    phase = "all WhatsApp quotas";
    const quotaStart = reads.length;
    const quotas = visible(await html("/admin/whatsapp?pagina=9"));
    assert.match(quotas, /Espaço HTTP 001/);
    assert.match(quotas, /Exibindo 201\s*–\s*201 de 201 empresas/);
    const settingsReads = reads
      .slice(quotaStart)
      .filter((read) => read.table === "whatsapp_settings");
    assert.equal(settingsReads.length, 1);
    assert.equal(
      settingsReads[0].query.get("company_id"),
      `in.(${companies[0].id})`,
    );
    pass(
      "WhatsApp quota pages reach older companies and fetch settings only for the visible page",
    );

    phase = "honest integration links without credentials or mutations";
    const writesBefore = calls.length;
    const integrationHtml = await html("/admin/integracoes");
    const integrationText = visible(integrationHtml);
    assert.match(integrationText, /Integrações e custos/);
    assert.match(
      integrationText,
      /não assina, não recarrega créditos e não libera cobranças/,
    );
    assert.match(integrationText, /Automação ainda não integrada/);
    assert.match(integrationText, /Opcional; backend sem conexão/);
    for (const destination of [
      "https://vercel.com/pricing",
      "https://supabase.com/pricing",
      "https://www.brevo.com/pricing/",
      "https://vercel.com/diogobr231/~/ai-gateway",
      "https://adsmanager.facebook.com/",
    ]) {
      const link = [...integrationHtml.matchAll(/<a\b[^>]*>/g)]
        .map((match) => attrs(match[0]))
        .find((link) => link.href === destination);
      assert(link, `Missing official integration link ${destination}`);
      assert.equal(link.target, "_blank");
      assert(
        link.rel?.includes("noopener") && link.rel?.includes("noreferrer"),
      );
    }
    for (const secret of Object.values(fixtureSecrets))
      assert(
        !integrationHtml.includes(secret),
        "Private server configuration must never be rendered",
      );
    for (const form of integrationHtml.matchAll(
      /<form\b[^>]*>[\s\S]*?<\/form>/g,
    ))
      assert.match(visible(form[0]), /Sair/);
    assert.equal(calls.length, writesBefore);
    pass(
      "integration CTAs open official services, disclose pending automation and never expose fixture secrets or perform provider actions",
    );

    phase = "non-admin protection";
    state.admin = false;
    const denied = await request(basePath);
    const deniedHtml = await denied.text();
    assert(
      denied.status === 404 ||
        deniedHtml.includes("NEXT_HTTP_ERROR_FALLBACK;404"),
    );
    assert(!visible(deniedHtml).includes("Suas campanhas"));
    state.admin = true;
    pass(
      "a valid ordinary session cannot render the SUPER_ADMIN marketing page",
    );

    phase = "rendered create action";
    const initial = await html();
    assert.match(visible(initial), /Uma boa campanha começa com clareza/);
    assert.match(visible(initial), /Nenhum gasto será realizado/);
    assert.equal(state.campaign, null);
    const create = complete(actionForm(initial, 'aria-label="Criar campanha"'));
    const requestId = String(create.get("request_id"));
    const target = await destination(await request(basePath, create));
    assert.equal(target.searchParams.get("id"), campaignId);
    const saved = calls.find(
      (call) => call.name === "marketing_save_campaign",
    )!;
    assert(saved);
    assert.equal(
      (saved.body.p_payload as Record<string, unknown>).budget_cents,
      12345,
    );
    assert.equal(saved.body.p_request_id, requestId);
    assert.equal(state.campaign!.name, formValues.name);
    assert.equal(state.campaign!.status, "draft");
    const detailPath = `${basePath}?id=${campaignId}`;
    assert.match(await html(detailPath), /Campanha fictícia HTTP/);
    pass(
      "rendered campaign form invokes its bound Server Action, maps BRL cents and persists a fresh GET",
    );

    phase = "review/approval and edit reset";
    const detail = await html(detailPath);
    await destination(
      await request(detailPath, actionForm(detail, "Enviar para revisão")),
    );
    assert.equal(state.campaign!.status, "review");
    await destination(
      await request(
        detailPath,
        actionForm(await html(detailPath), "Aprovar internamente"),
      ),
    );
    assert.equal(state.campaign!.status, "approved");
    const edit = complete(
      actionForm(await html(detailPath), 'aria-label="Editar campanha"'),
    );
    edit.set("name", "Campanha fictícia HTTP editada");
    await destination(await request(detailPath, edit));
    assert.equal(state.campaign!.status, "draft");
    assert.equal(state.campaign!.name, "Campanha fictícia HTTP editada");
    assert.match(await html(detailPath), /Campanha fictícia HTTP editada/);
    pass(
      "review and approval are internal, and editing persists content while returning to draft",
    );

    phase = "malformed, stale and cross-origin actions";
    const before = JSON.stringify(state.campaign);
    const saveCount = calls.filter(
      (call) => call.name === "marketing_save_campaign",
    ).length;
    const malformed = complete(
      actionForm(await html(detailPath), 'aria-label="Editar campanha"'),
    );
    malformed.set("budget", "-999");
    const malformedResult = await request(detailPath, malformed);
    const malformedHtml = await malformedResult.text();
    assert.match(visible(malformedHtml), /Confira os campos/);
    assert.equal(
      calls.filter((call) => call.name === "marketing_save_campaign").length,
      saveCount,
    );
    const cross = complete(
      actionForm(await html(detailPath), 'aria-label="Editar campanha"'),
    );
    const crossed = await request(
      detailPath,
      cross,
      true,
      "https://untrusted.example.invalid",
    );
    await crossed.body?.cancel();
    assert(crossed.status >= 400);
    assert.equal(
      calls.filter((call) => call.name === "marketing_save_campaign").length,
      saveCount,
    );
    const stale = complete(
      actionForm(await html(detailPath), 'aria-label="Editar campanha"'),
    );
    stale.set("version", "1");
    assert.match(
      visible(await (await request(detailPath, stale)).text()),
      /mudou em outra aba/,
    );
    assert.equal(JSON.stringify(state.campaign), before);
    pass(
      "invalid budget and cross-origin POST reach no write RPC; stale version cannot overwrite content",
    );

    phase = "protected exports";
    for (const suffix of ["arte", "exportar"]) {
      const route = `${basePath}/${campaignId}/${suffix}`;
      assert.equal(
        (await destination(await request(route, undefined, false))).pathname,
        "/entrar",
      );
      state.admin = false;
      const deniedExport = await request(route);
      const deniedBody = await deniedExport.text();
      assert(
        deniedExport.status === 404 ||
          deniedBody.includes("NEXT_HTTP_ERROR_FALLBACK;404"),
      );
      state.admin = true;
      const exported = await request(route);
      assert.equal(exported.status, 200);
      assert.match(
        exported.headers.get("cache-control") ?? "",
        /private.*no-store/,
      );
      assert.equal(exported.headers.get("x-content-type-options"), "nosniff");
      if (suffix === "arte") {
        assert.match(
          exported.headers.get("content-type") ?? "",
          /^image\/svg\+xml/,
        );
        assert.match(
          exported.headers.get("content-security-policy") ?? "",
          /default-src 'none'/,
        );
        const svg = await exported.text();
        assert.match(svg, /width="1080" height="1350"/);
        assert.doesNotMatch(
          svg,
          /<script|<image|<foreignObject|(?:href|src)\s*=\s*["']https?:\/\//i,
        );
      } else {
        assert.match(
          exported.headers.get("content-type") ?? "",
          /^text\/plain/,
        );
        assert.match(
          exported.headers.get("content-disposition") ?? "",
          /attachment/,
        );
        const text = await exported.text();
        assert.match(text, /Orçamento PLANEJADO/);
        assert.match(text, /utm_source=instagram/);
      }
    }
    pass(
      "SVG and text downloads enforce login/admin, private no-store headers and truthful output types",
    );

    phase = "database failure feedback";
    state.failed = true;
    assert.match(
      visible(await html(detailPath)),
      /Não foi possível carregar as campanhas/,
    );
    state.failed = false;
    assert.equal(
      unexpected.length,
      0,
      "Only known fixture REST/RPCs may be requested",
    );
    assert.equal(
      fakeAuth.state.signupCalls +
        fakeAuth.state.recoveryCalls +
        fakeAuth.state.resendCalls,
      0,
    );
    pass(
      "backend outage has explicit feedback; no signup, recovery, email or unexpected external operation occurs",
    );

    console.log(
      `${checks} isolated marketing HTTP groups passed; no real account, database or provider contacted.`,
    );
    if (process.env.TEST_MARKETING_BROWSER === "1") {
      console.log(`FIXTURE_BROWSER_ORIGIN=${base}`);
      console.log(
        `FIXTURE_LOGIN=${fakeEmail} / ${fakePassword} (synthetic local fixture only)`,
      );
      console.log(
        `FIXTURE_PROCESS_PID=${process.pid}; stop this test process to close Next and fixtures.`,
      );
      await new Promise<void>((resolve) => {
        process.once("SIGINT", resolve);
        process.once("SIGTERM", resolve);
      });
    }
  } catch (error) {
    if (phase === "setup") console.error(childErrors.slice(-1200));
    throw error;
  } finally {
    child.kill();
    await new Promise<void>((resolve) => {
      backend.closeAllConnections();
      backend.close(() => resolve());
    });
    await fakeAuth.close();
  }
}

main().catch((error) => {
  console.error(
    `FAIL isolated marketing (${phase}): ${error instanceof Error ? error.message : "unexpected fixture failure"}`,
  );
  process.exitCode = 1;
});
