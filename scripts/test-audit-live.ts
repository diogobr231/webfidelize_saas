import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { addDays, saoPauloDay } from "../src/lib/scheduling";
import { dashboardGrowth, type DashboardData } from "../src/lib/dashboard";
import { money } from "../src/lib/catalog";
import { hasAccess } from "../src/lib/permissions";

// Explicitly opt-in. Credentials must be supplied by the invoking process.
// This test uses its own sessions and never touches browser cookies. Its only
// permitted business-data write is one clearly labeled DEMO support request.
const optedIn = process.env.TEST_AUDIT_LIVE === "1";
const password = process.env.SEED_PASSWORD;
const mode = process.env.TEST_AUDIT_MODE || "full";
let environmentLoadFailed = false;
try {
  process.loadEnvFile(".env.local");
} catch (error) {
  environmentLoadFailed = (error as NodeJS.ErrnoException).code !== "ENOENT";
}
let phase = "configuration";
let checks = 0;
class TestFailure extends Error {}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TestFailure(message);
}
function pass(message: string) {
  checks++;
  console.log(`PASS audit: ${message}`);
}
function decodeHtml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}
function visibleText(source: string) {
  return decodeHtml(
    source.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
}
function attributes(tag: string) {
  return Object.fromEntries(
    [...tag.matchAll(/([\w$:-]+)\s*=\s*"([^"]*)"/g)].map((match) => [
      match[1],
      decodeHtml(match[2]),
    ]),
  );
}
function inputs(source: string) {
  return [...source.matchAll(/<input\b[^>]*>/g)].map((match) =>
    attributes(match[0]),
  );
}
function actionForm(html: string, matches: (source: string) => boolean) {
  const source = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map((match) => match[0])
    .find(matches);
  check(source, "Expected Server Action form was not rendered.");
  const form = new FormData();
  for (const field of inputs(source))
    if (field.type === "hidden" && field.name)
      form.append(field.name, field.value ?? "");
  check(
    [...form.keys()].some(
      (key) => key.startsWith("$ACTION_ID_") || key.startsWith("$ACTION_REF_"),
    ),
    "Next Server Action identity/binding was absent.",
  );
  return form;
}
function cloneForm(source: FormData) {
  const result = new FormData();
  for (const [key, value] of source) result.append(key, value);
  return result;
}
function streamedNotFound(source: string) {
  // A loading boundary can commit HTTP 200 before Next emits notFound().
  // Recognize only its explicit template/Flight error protocol, not arbitrary
  // text mentioning a 404 or the expected localized heading.
  if (
    [...source.matchAll(/<template\b[^>]*>/g)].some(
      (tag) =>
        attributes(tag[0])["data-dgst"] === "NEXT_HTTP_ERROR_FALLBACK;404",
    )
  )
    return true;
  return [
    ...source.matchAll(/self\.__next_f\.push\(([^<]*?)\)<\/script>/g),
  ].some((match) => {
    try {
      const payload: unknown = JSON.parse(match[1]);
      if (!Array.isArray(payload) || typeof payload[1] !== "string")
        return false;
      return /(?:^|\n)[\da-f]+:E\{"digest":"NEXT_HTTP_ERROR_FALLBACK;404"(?:,|\})/.test(
        payload[1],
      );
    } catch {
      return false;
    }
  });
}
function metricValue(html: string, label: string) {
  const card = [...html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g)]
    .map((match) => match[0])
    .find((source) => {
      const tag = source.match(/^<article\b[^>]*>/)?.[0];
      return (
        tag &&
        attributes(tag).class?.split(/\s+/).includes("executive-metric") &&
        visibleText(source.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? "") ===
          label
      );
    });
  check(card, "Expected executive metric card was absent.");
  const value = card.match(
    /<strong\b[^>]*class="executive-value"[^>]*>([\s\S]*?)<\/strong>/,
  )?.[1];
  check(value !== undefined, "Executive metric value was absent.");
  return visibleText(value);
}
function noPrivateSecrets(html: string) {
  for (const name of [
    "BOOKING_GATEWAY_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
    "MERCADO_PAGO_ACCESS_TOKEN",
    "MERCADO_PAGO_WEBHOOK_SECRET",
  ]) {
    const value = process.env[name];
    if (value && value.length >= 10)
      check(
        !decodeHtml(html).includes(value),
        "A private server secret appeared in rendered HTML.",
      );
  }
}

async function main() {
  check(
    optedIn,
    "Set TEST_AUDIT_LIVE=1 to allow one labeled support request in an existing DEMO company.",
  );
  check(
    !environmentLoadFailed,
    "Could not load local application configuration.",
  );
  check(
    mode === "full" || mode === "validation",
    "TEST_AUDIT_MODE must be full or validation.",
  );
  const base = new URL(process.env.TEST_BASE_URL || "http://localhost:3000");
  const email = process.env.DEMO_EMAIL || "pet-shop@example.invalid";
  const foreignEmail =
    process.env.FOREIGN_DEMO_EMAIL ||
    (email === "clinica@example.invalid"
      ? "salao@example.invalid"
      : "clinica@example.invalid");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  check(
    ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) &&
      ["http:", "https:"].includes(base.protocol) &&
      !base.username &&
      !base.password,
    "Live audit requires a local test server without URL credentials.",
  );
  check(
    email.endsWith("@example.invalid") &&
      foreignEmail.endsWith("@example.invalid") &&
      email !== foreignEmail,
    "Two distinct synthetic demonstration accounts are required.",
  );
  check(
    password && supabaseUrl && publishableKey,
    "Provide SEED_PASSWORD through the process and configure the public Supabase client.",
  );
  const cookies = new Map<string, string>();
  const db = createServerClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false },
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: (items) => {
        for (const item of items) {
          if (item.options.maxAge === 0 || !item.value)
            cookies.delete(item.name);
          else cookies.set(item.name, item.value);
        }
      },
    },
  });
  const foreignDb = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const publicDb = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  async function request(
    path: string,
    init: RequestInit = {},
    authenticated = true,
  ) {
    const target = new URL(path, base);
    check(
      target.origin === base.origin,
      "Refusing to send demo cookies to another origin.",
    );
    const headers = new Headers(init.headers);
    headers.set("Accept", "text/html");
    if (authenticated && cookies.size)
      headers.set(
        "Cookie",
        [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      );
    const response = await fetch(target, {
      ...init,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    if (authenticated)
      for (const header of response.headers.getSetCookie()) {
        const pair = header.split(";", 1)[0];
        const separator = pair.indexOf("=");
        if (separator > 0) {
          const name = pair.slice(0, separator),
            value = pair.slice(separator + 1);
          if (!value || /max-age=0(?:;|$)/i.test(header)) cookies.delete(name);
          else cookies.set(name, value);
        }
      }
    return response;
  }
  async function html(path: string, authenticated = true) {
    const response = await request(path, {}, authenticated);
    check(
      response.status === 200,
      "Expected page did not return successful HTML.",
    );
    const result = await response.text();
    noPrivateSecrets(result);
    return result;
  }
  const post = (path: string, body: FormData) =>
    request(path, {
      method: "POST",
      body,
      headers: { Origin: base.origin, Referer: new URL(path, base).toString() },
    });
  async function destination(response: Response) {
    let value = [303, 307, 308].includes(response.status)
      ? response.headers.get("location")
      : null;
    if (response.status === 200) {
      const source = await response.text();
      const metadata = [...source.matchAll(/<meta\b[^>]*>/g)]
        .map((match) => attributes(match[0]))
        .find(
          (tag) =>
            tag.id === "__next-page-redirect" &&
            tag["http-equiv"]?.toLowerCase() === "refresh",
        );
      value =
        metadata?.content?.match(/^\s*[01]\s*;\s*url=(.+)\s*$/i)?.[1] ?? null;
    }
    check(value, "Expected explicit HTTP/Next streaming redirect was absent.");
    const target = new URL(value, base);
    check(target.origin === base.origin, "Unexpected redirect origin.");
    return target;
  }
  let ticketCreated = false;
  let completed = false;
  try {
    phase = "DEMO authentication and authorization";
    const login = await db.auth.signInWithPassword({ email, password });
    check(
      !login.error && login.data.user && cookies.size,
      "Synthetic OWNER authentication failed.",
    );
    const companies = await db
      .from("companies")
      .select(
        "id,name,is_demo,plan_id,status,trial_ends_at,booking_slug,booking_enabled,display_density,agenda_view",
      );
    check(
      !companies.error &&
        companies.data?.length === 1 &&
        companies.data[0].is_demo === true,
      "Account must have exactly one explicitly marked DEMO company.",
    );
    const company = companies.data[0];
    const companyId = company.id;
    const tenant = `/painel/${companyId}`;
    const membership = await db
      .from("memberships")
      .select("role")
      .eq("company_id", companyId)
      .eq("user_id", login.data.user.id)
      .single();
    check(
      !membership.error && membership.data?.role === "OWNER",
      "Only the verified DEMO OWNER may run this audit.",
    );
    check(
      hasAccess(company.status, company.trial_ends_at),
      "DEMO must already have valid access for invalid-form and confirmation checks; this test never changes subscription state.",
    );
    const admin = await db.rpc("is_super_admin");
    check(
      !admin.error && admin.data === false,
      "The synthetic audit account must not be a SUPER_ADMIN.",
    );
    const foreignLogin = await foreignDb.auth.signInWithPassword({
      email: foreignEmail,
      password,
    });
    check(
      !foreignLogin.error,
      "Could not authenticate the separate synthetic tenant.",
    );
    const foreignCompanies = await foreignDb
      .from("companies")
      .select("id,is_demo");
    check(
      !foreignCompanies.error &&
        foreignCompanies.data?.length === 1 &&
        foreignCompanies.data[0].is_demo === true &&
        foreignCompanies.data[0].id !== companyId,
      "Cross-company check requires a distinct verified DEMO company.",
    );
    const foreignId = foreignCompanies.data[0].id;
    pass("isolated sessions and two verified demonstration tenants");

    phase = "dashboard metrics versus authorized data";
    const end = addDays(saoPauloDay(), -1),
      start = addDays(end, -6);
    const [metricResult, customerCount] = await Promise.all([
      db.rpc("executive_dashboard", {
        p_company: companyId,
        p_start: start,
        p_end: end,
      }),
      db
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId),
    ]);
    check(
      !metricResult.error && metricResult.data && !customerCount.error,
      "Authorized dashboard data failed to load.",
    );
    const metrics = metricResult.data as DashboardData;
    check(
      metrics.scope === "company" &&
        metrics.customers?.total === customerCount.count &&
        metrics.financial_available === false,
      "Dashboard scope/customer total or financial availability differed from persisted data.",
    );
    const dashboard = await html(
      `${tenant}?${new URLSearchParams({ periodo: "personalizado", inicio: start, fim: end })}`,
    );
    check(
      dashboard.includes("Seu negócio, em perspectiva."),
      "Executive dashboard did not render.",
    );
    for (const [label, value] of [
      ["Agendamentos", metrics.current.appointments],
      ["Atendimentos concluídos", metrics.current.completed],
      ["Clientes cadastrados", metrics.customers.total],
    ] as const)
      check(
        metricValue(dashboard, label) === value.toLocaleString("pt-BR"),
        "Rendered executive metric did not match the authorized RPC.",
      );
    const growth = dashboardGrowth(
      metrics.current.appointments,
      metrics.previous.appointments,
    );
    check(
      metricValue(dashboard, "Crescimento da agenda") ===
        (growth === null
          ? "—"
          : `${growth > 0 ? "+" : ""}${growth.toLocaleString("pt-BR")}%`),
      "Growth metric did not match the verified period comparison.",
    );
    check(
      metricValue(dashboard, "Faturamento") === "—" &&
        metricValue(dashboard, "Vendas") === "—" &&
        dashboard.includes("Atendimentos não comprovam pagamentos."),
      "Unavailable financial metrics were presented as actual revenue or sales.",
    );
    check(
      metrics.daily.length === 7 &&
        metrics.daily.reduce((sum, day) => sum + day.appointments, 0) ===
          metrics.current.appointments,
      "Dashboard time-series total did not match the period total.",
    );
    if (!metrics.current.appointments)
      check(
        dashboard.includes("Seu próximo resultado começa com um atendimento"),
        "Empty chart did not explain the absence of data.",
      );
    pass(
      "period-filtered executive cards reflect authorized RPC and retain truthful financial empty states",
    );
    const invalidPeriod = await html(
      `${tenant}?periodo=personalizado&inicio=2099-01-01&fim=2099-01-02`,
    );
    check(
      invalidPeriod.includes("Informe datas válidas, em ordem e até hoje."),
      "Invalid dashboard period lacked validation feedback.",
    );
    pass("invalid period receives a clear fallback message");

    phase = "subscription and real commercial catalogue";
    const catalogue = await publicDb
      .from("plans")
      .select("id,name,price_cents,staff_limit")
      .order("price_cents");
    check(
      !catalogue.error && catalogue.data?.length,
      "Public commercial catalogue was unavailable.",
    );
    const subscription = await html(`${tenant}/assinatura`);
    const planCards = [
      ...subscription.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g),
    ].map((match) => match[0]);
    for (const plan of catalogue.data) {
      const card = planCards.find(
        (source) =>
          visibleText(
            source.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? "",
          ) === plan.name,
      );
      check(card, "Configured plan was absent from the comparison.");
      const text = visibleText(card);
      check(
        text.includes(visibleText(money(plan.price_cents))) &&
          text.includes(
            `Até ${plan.staff_limit} ${plan.staff_limit === 1 ? "profissional" : "profissionais"}`,
          ),
        "Plan price or limit differed from backend catalogue.",
      );
    }
    const currentSection = subscription.match(
      /<section\b[^>]*class="panel billing-current"[^>]*>[\s\S]*?<\/section>/,
    )?.[0];
    check(currentSection, "Persisted subscription status was absent.");
    const labels: Record<string, string> = {
      active: "Ativa",
      trialing: hasAccess(company.status, company.trial_ends_at)
        ? "Teste gratuito"
        : "Teste encerrado",
      past_due: "Pagamento pendente",
      suspended: "Suspensa",
      canceled: "Cancelada",
    };
    check(
      visibleText(currentSection).includes(labels[company.status]) &&
        visibleText(currentSection).includes(
          new Date(company.trial_ends_at).toLocaleDateString("pt-BR", {
            timeZone: "America/Sao_Paulo",
          }),
        ),
      "Rendered subscription/trial did not match backend state.",
    );
    check(
      subscription.includes(
        "cobrança online pelo Mercado Pago ainda não está disponível",
      ) &&
        subscription.includes(
          "O contato não altera seu plano nem ativa cobrança.",
        ),
      "Unconfigured checkout was not clearly disclosed.",
    );
    pass(
      "plan comparison uses public backend prices/limits and never simulates payment activation",
    );

    phase = "published help content and personalization";
    const articles = await db
      .from("help_articles")
      .select("id,title,module,published,sort_order")
      .eq("published", true)
      .order("sort_order")
      .order("title")
      .limit(200);
    check(
      !articles.error && articles.data?.length,
      "Published help articles were unavailable.",
    );
    const drafts = await db
      .from("help_articles")
      .select("id")
      .eq("published", false);
    check(
      !drafts.error && drafts.data?.length === 0,
      "Regular company account could read unpublished help drafts.",
    );
    const helpRoute = `${tenant}/ajuda`,
      help = await html(helpRoute);
    for (const article of articles.data)
      check(
        visibleText(help).includes(article.title),
        "Published help article was absent from authenticated help page.",
      );
    check(
      help.includes("ticket-subject") && help.includes("wa.me/5518997695445"),
      "Help request or WhatsApp entry point was absent.",
    );
    const firstModule = articles.data[0].module;
    const filteredHelp = await html(
      `${helpRoute}?modulo=${encodeURIComponent(firstModule)}`,
    );
    for (const article of articles.data.filter(
      (row) => row.module === firstModule,
    ))
      check(
        visibleText(filteredHelp).includes(article.title),
        "Help module filtering hid a published article from the selected module.",
      );
    pass(
      "published help library and module filtering render real editorial content",
    );
    const personalization = await html(`${tenant}/personalizacao`);
    check(
      personalization.includes("Personalize seu espaço.") &&
        personalization.includes('name="density"') &&
        personalization.includes('name="agenda_view"') &&
        personalization.includes('name="logo"'),
      "Personalization controls were incomplete.",
    );
    check(
      inputs(personalization).some(
        (field) => field.name === "name" && field.value === company.name,
      ),
      "Personalization did not show the current company name.",
    );
    check(
      personalization.includes('class="brand') &&
        personalization.includes("Web"),
      "Platform brand was absent from personalization.",
    );
    pass(
      "authorized personalization renders existing company data without private server keys",
    );

    phase = "cross-company and admin access controls";
    for (const path of ["", "/ajuda", "/assinatura", "/personalizacao"]) {
      const denied = await destination(
        await request(`/painel/${foreignId}${path}`),
      );
      check(
        denied.pathname === "/painel" &&
          denied.searchParams.get("erro") === "acesso",
        "Foreign-company page failed to reject the authenticated DEMO account.",
      );
    }
    const anonymous = await destination(await request(helpRoute, {}, false));
    check(
      anonymous.pathname === "/entrar",
      "Help page allowed an unauthenticated visitor.",
    );
    for (const path of ["/admin", "/admin/ajuda"]) {
      const response = await request(path);
      const body = await response.text();
      if (process.env.TEST_AUDIT_DIAGNOSTICS === "1") {
        const headings = [...body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map(
          (entry) => visibleText(entry[1]),
        );
        console.log(
          JSON.stringify({
            page: path,
            status: response.status,
            headings: headings.length,
            localizedNotFound: headings.includes("Página não encontrada"),
            defaultNotFound: headings.includes("404"),
            streamedNotFound: body.includes("NEXT_HTTP_ERROR_FALLBACK;404"),
            adminContent:
              body.includes("Biblioteca de orientações") ||
              body.includes("Empresas da plataforma"),
          }),
        );
      }
      check(
        (response.status === 404 ||
          (response.status === 200 && streamedNotFound(body))) &&
          !body.includes("Biblioteca de orientações") &&
          !body.includes("Empresas da plataforma"),
        "Expected an explicit administrative access-denied boundary without administrative content.",
      );
    }
    pass(
      "foreign tenants, anonymous help requests and non-admin administrative access denied",
    );

    phase = "Brazilian price validation without creating a service";
    const setupRoute = `${tenant}/configuracao?etapa=servicos`;
    const setup = await html(setupRoute);
    const serviceForm = actionForm(
      setup,
      (form) =>
        inputs(form).some((field) => field.name === "record_id") &&
        inputs(form).some((field) => field.name === "price"),
    );
    const serviceId = serviceForm.get("record_id");
    check(
      typeof serviceId === "string",
      "Service test form lacked an idempotent record identity.",
    );
    const serviceBefore = await db
      .from("services")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", serviceId);
    check(
      !serviceBefore.error && serviceBefore.data?.length === 0,
      "Service test identity must be unused.",
    );
    serviceForm.set("name", "TESTE de validação — não cadastrar");
    serviceForm.set("duration", "2");
    serviceForm.set("price", "69,90");
    serviceForm.set("intent", "next");
    const serviceResponse = await post(setupRoute, serviceForm);
    check(
      serviceResponse.status === 200,
      "Invalid service should return inline validation HTML.",
    );
    const validation = await serviceResponse.text();
    noPrivateSecrets(validation);
    const validationInputs = inputs(validation);
    check(
      validationInputs.some(
        (field) =>
          field.id === "setup-service-duration" &&
          field["aria-invalid"] === "true",
      ),
      "Invalid duration was not marked by server validation.",
    );
    check(
      validationInputs.some(
        (field) =>
          field.id === "setup-service-price" &&
          field.value === "69,90" &&
          field["aria-invalid"] === "false",
      ),
      "Brazilian decimal price was not accepted and preserved while another field was invalid.",
    );
    const serviceAfter = await db
      .from("services")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", serviceId);
    check(
      !serviceAfter.error && serviceAfter.data?.length === 0,
      "Invalid validation test unexpectedly created a service.",
    );
    pass(
      "comma-decimal price survives server validation with an invalid duration and no service creation",
    );

    phase = "destructive-action confirmation guard";
    const shifts = await db
      .from("availability")
      .select("id,company_id,professional_id,weekday,start_minute,end_minute")
      .eq("company_id", companyId)
      .order("id")
      .limit(1);
    check(
      !shifts.error && shifts.data?.length === 1,
      "An existing demonstration availability shift is required.",
    );
    const shift = shifts.data[0],
      availabilityRoute = `${tenant}/disponibilidade`;
    const availability = await html(availabilityRoute);
    const removeForm = actionForm(
      availability,
      (source) =>
        source.includes("Remover turno") &&
        inputs(source).some(
          (field) => field.name === "id" && field.value === shift.id,
        ),
    );
    removeForm.delete("confirm_action");
    const removalDenied = await destination(
      await post(availabilityRoute, removeForm),
    );
    check(
      removalDenied.pathname === availabilityRoute &&
        removalDenied.searchParams.get("erro") === "confirmacao",
      "Removing a shift without explicit confirmation was not rejected.",
    );
    const preserved = await db
      .from("availability")
      .select("id,company_id,professional_id,weekday,start_minute,end_minute")
      .eq("company_id", companyId)
      .eq("id", shift.id)
      .single();
    check(
      !preserved.error &&
        JSON.stringify(preserved.data) === JSON.stringify(shift),
      "Confirmation rejection did not preserve the existing availability shift.",
    );
    pass(
      "unconfirmed destructive Server Action rejected and existing shift preserved",
    );

    if (mode === "validation") {
      completed = true;
      console.log(
        `${checks} live audit validation groups passed without creating a support request.`,
      );
      return;
    }

    phase = "single DEMO support request and idempotent HTTP retry";
    // Reverify the tenant immediately before the one permitted business write.
    const guard = await db
      .from("companies")
      .select("id,is_demo")
      .eq("id", companyId)
      .single();
    check(
      !guard.error && guard.data?.is_demo === true,
      "Support write requires a freshly verified DEMO company.",
    );
    const ticketForm = actionForm(help, (source) =>
      inputs(source).some((field) => field.name === "request_key"),
    );
    const requestKey = ticketForm.get("request_key");
    check(
      typeof requestKey === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          requestKey,
        ),
      "Support form lacked a request identity.",
    );
    const subject = `Solicitação de TESTE automatizado — ${randomUUID().slice(0, 8)}`;
    ticketForm.set("module", "primeiros-passos");
    ticketForm.set("subject", subject);
    ticketForm.set(
      "message",
      "Solicitação fictícia criada pelo teste automatizado de auditoria da Web Fidelize em empresa DEMO. Não representa uma dúvida de cliente real e não exige contato externo.",
    );
    const before = await db
      .from("support_tickets")
      .select("id")
      .eq("company_id", companyId)
      .eq("requester_id", login.data.user.id)
      .eq("request_key", requestKey);
    check(
      !before.error && before.data?.length === 0,
      "Test ticket request identity must be unused.",
    );
    const submitted = await destination(
      await post(helpRoute, cloneForm(ticketForm)),
    );
    check(
      submitted.pathname === helpRoute &&
        submitted.searchParams.get("aviso") === "enviada",
      "Support form did not confirm persisted creation.",
    );
    ticketCreated = true;
    const retry = await destination(
      await post(helpRoute, cloneForm(ticketForm)),
    );
    check(
      retry.pathname === helpRoute &&
        retry.searchParams.get("aviso") === "enviada",
      "Idempotent support retry failed.",
    );
    const stored = await db
      .from("support_tickets")
      .select("id,company_id,requester_id,subject,status,response")
      .eq("company_id", companyId)
      .eq("requester_id", login.data.user.id)
      .eq("request_key", requestKey);
    check(
      !stored.error &&
        stored.data?.length === 1 &&
        stored.data[0].subject === subject &&
        stored.data[0].status === "open" &&
        stored.data[0].response === "",
      "Support retry duplicated or changed the persisted ticket.",
    );
    const confirmedHelp = await html(submitted.pathname + submitted.search);
    check(
      visibleText(confirmedHelp).includes(subject) &&
        confirmedHelp.includes(`id="ticket-${stored.data[0].id}"`) &&
        confirmedHelp.includes("Solicitação registrada."),
      "Saved ticket or success feedback was absent from the help page.",
    );
    const invisible = await foreignDb
      .from("support_tickets")
      .select("id")
      .eq("id", stored.data[0].id);
    check(
      !invisible.error && invisible.data?.length === 0,
      "Created ticket was visible to the other demonstration tenant.",
    );
    pass(
      "one clearly labeled DEMO ticket saved through SSR form; retry stays idempotent and other tenant cannot read it",
    );
    completed = true;
    console.log(
      `${checks} live audit groups passed. One labeled synthetic support request retained; no services, availability, company settings or subscription statuses changed.`,
    );
  } finally {
    // Local scope revokes only sessions established by this test, never users' other sessions.
    await Promise.allSettled([
      db.auth.signOut({ scope: "local" }),
      foreignDb.auth.signOut({ scope: "local" }),
    ]);
    cookies.clear();
    if (ticketCreated && !completed)
      console.log(
        "A labeled synthetic support request was retained in the DEMO company for audit visibility.",
      );
  }
}
main().catch((error: unknown) => {
  // Never dump response bodies, Supabase errors, tokens, cookies or environment values.
  console.error(`FAIL live audit validation during: ${phase}.`);
  if (error instanceof TestFailure) console.error(error.message);
  process.exitCode = 1;
});
