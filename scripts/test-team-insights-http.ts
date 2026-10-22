import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServerClient } from "@supabase/ssr";
import { startFakeAuth } from "../tests/fixtures/auth-server";
import { saoPauloDay } from "../src/lib/scheduling";

// Real Next routes and server actions, synthetic local Auth/REST only. The preload
// rewrites Supabase requests to loopback and rejects every external fetch.
// Database permissions and real aggregates are covered by test-team-insights-db.
const companyId = "11111111-1111-4111-8111-111111111111";
const otherCompany = "22222222-2222-4222-8222-222222222222";
const professionalId = "33333333-3333-4333-8333-333333333333";
const appointmentId = "44444444-4444-4444-8444-444444444444";
const today = saoPauloDay();
const prefix = `/painel/${companyId}`;
const reporting = `${prefix}/equipe/indicadores`;
const exporting = `${reporting}/exportar?from=${today}&to=${today}`;
const personal = `${prefix}/meu-dia?day=${today}`;
let phase = "setup",
  checks = 0;
const pass = (name: string) => {
  checks++;
  console.log(`PASS isolated team: ${name}`);
};
const decode = (value: string) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
const attributes = (tag: string) =>
  Object.fromEntries(
    [...tag.matchAll(/([\w$:-]+)\s*=\s*"([^"]*)"/g)].map((match) => [
      match[1],
      decode(match[2]),
    ]),
  );
function completionForm(html: string) {
  const source = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map((match) => match[0])
    .find((form) => form.includes(appointmentId));
  assert.ok(
    source,
    "Employee appointment must render a real bound server action",
  );
  const body = new FormData();
  for (const match of source.matchAll(/<input\b[^>]*>/g)) {
    const input = attributes(match[0]);
    if (input.type === "hidden" && input.name)
      body.append(input.name, input.value || "");
  }
  assert.ok([...body.keys()].some((name) => name.startsWith("$ACTION_")));
  body.set("appointment_id", appointmentId);
  body.set("day", today);
  body.set("confirm_action", "yes");
  return body;
}
async function freePort() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

async function main() {
  assert.ok(
    existsSync(".next/BUILD_ID"),
    "Build the app before running isolated team HTTP checks",
  );
  // This is a public origin used only to reproduce the build's cookie namespace.
  // No other local environment values are loaded or printed.
  const publicOrigin =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    (existsSync(".env.local")
      ? readFileSync(".env.local", "utf8").match(
          /^NEXT_PUBLIC_SUPABASE_URL\s*=\s*["']?([^\s"']+)/m,
        )?.[1]
      : undefined) ||
    "https://fake.supabase.test";
  const fakeAuth = await startFakeAuth(new URL(publicOrigin).origin);
  const state = {
    role: "OWNER",
    plan: "profissional",
    companyStatus: "active",
    linked: true,
    appointmentStatus: "scheduled",
    futureAppointment: false,
    hasAppointments: true,
    mismatchedReportPeriod: false,
    failed: false,
    preferenceFailed: false,
    deniedAppointment: false,
  };
  const calls: { name: string; body: Record<string, unknown> }[] = [];
  const unexpected: string[] = [];
  const staffName = "+Profissional QA";
  const backend = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    const send = (code: number, data: unknown, count?: number) => {
      response.writeHead(code, {
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
            Authorization: request.headers.authorization || "",
          },
          ...(bytes.length ? { body: bytes.toString() } : {}),
          redirect: "manual",
        },
      );
      response.writeHead(forwarded.status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(await forwarded.text());
      return;
    }
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const name = url.pathname.slice("/rest/v1/rpc/".length);
      const body = JSON.parse(bytes.toString() || "{}") as Record<
        string,
        unknown
      >;
      calls.push({ name, body });
      if (name === "is_super_admin") return send(200, false);
      if (state.failed)
        return send(400, {
          code: "P0001",
          message: "Controlled fixture failure",
        });
      if (name === "get_my_whatsapp_staff_preferences") {
        if (body.p_company !== companyId || state.preferenceFailed)
          return send(400, {
            code: "P0001",
            message: "Controlled preference read denial",
          });
        return send(200, {
          phone: null,
          enabled: false,
          professional_id: state.linked ? professionalId : null,
          professional_name: state.linked ? staffName : null,
        });
      }
      if (name === "complete_my_appointment") {
        if (
          state.role !== "EMPLOYEE" ||
          body.p_company !== companyId ||
          body.p_appointment !== appointmentId ||
          state.deniedAppointment
        )
          return send(400, { code: "P0001", message: "appointment not found" });
        state.appointmentStatus = "completed";
        return send(200, appointmentId);
      }
      if (name === "company_team_insights" || name === "company_team_export") {
        if (
          !["OWNER", "MANAGER"].includes(state.role) ||
          body.p_company !== companyId
        )
          return send(400, { code: "P0001", message: "not authorized" });
        if (
          state.plan === "essencial" ||
          (name.endsWith("export") && state.plan !== "empresarial")
        )
          return send(400, {
            code: "P0001",
            message: "plan feature unavailable",
          });
        const totals = {
          total: 1,
          scheduled: state.appointmentStatus === "scheduled" ? 1 : 0,
          completed: state.appointmentStatus === "completed" ? 1 : 0,
          canceled: 0,
          confirmed: 1,
          booked_minutes: 30,
        };
        return send(200, {
          period: {
            from: state.mismatchedReportPeriod ? "2000-01-01" : body.p_from,
            to: body.p_to,
          },
          timezone: "America/Sao_Paulo",
          max_days: state.plan === "empresarial" ? 90 : 31,
          professionals: [
            {
              professional_id: professionalId,
              name: staffName,
              archived: false,
              ...totals,
            },
          ],
          totals,
        });
      }
      unexpected.push(name);
      return send(400, { message: "Unknown isolated RPC" });
    }
    if (url.pathname === "/rest/v1/memberships") {
      if (url.searchParams.get("company_id") !== `eq.${companyId}`)
        return send(406, {
          code: "PGRST116",
          message: "No isolated membership",
        });
      return send(200, {
        company_id: companyId,
        user_id: fakeAuth.user.id,
        role: state.role,
      });
    }
    if (url.pathname === "/rest/v1/companies")
      return send(200, {
        id: companyId,
        name: "Empresa sintética HTTP",
        niche: "salao",
        plan_id: state.plan,
        status: state.companyStatus,
        trial_ends_at: null,
        trial_card_required: true,
        is_demo: true,
        logo_path: null,
        display_density: "comfortable",
        agenda_view: "day",
      });
    if (url.pathname === "/rest/v1/sales_offers" && request.method === "GET") {
      if (
        url.searchParams.get("active") !== "eq.true" ||
        url.searchParams.get("published") !== "eq.true"
      ) {
        unexpected.push("Unscoped public offer read");
        return send(400, { message: "Only published active fixture offers" });
      }
      return send(200, [
        {
          id: "55555555-5555-4555-8555-555555555555",
          slug: "implantacao-qa-isolada",
          title: "Implantação sintética HTTP",
          summary: "Oferta fictícia exclusiva do teste HTTP isolado.",
          niche: null,
          active: true,
          published: true,
          setup_price_cents: null,
          monthly_price_cents: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ]);
    }
    if (url.pathname === "/rest/v1/plans") {
      const plans = [
        {
          id: "essencial",
          name: "Essencial",
          price_cents: 6990,
          staff_limit: 1,
          team_insights: false,
          team_export: false,
        },
        {
          id: "profissional",
          name: "Profissional",
          price_cents: 11990,
          staff_limit: 3,
          team_insights: true,
          team_export: false,
        },
        {
          id: "empresarial",
          name: "Empresarial",
          price_cents: 19990,
          staff_limit: 10,
          team_insights: true,
          team_export: true,
        },
      ];
      return send(
        200,
        url.searchParams.has("id")
          ? plans.find((plan) => plan.id === state.plan)
          : plans,
      );
    }
    if (url.pathname === "/rest/v1/professionals")
      return send(
        200,
        state.linked ? { id: professionalId, name: staffName } : null,
      );
    if (url.pathname === "/rest/v1/appointments")
      return send(
        200,
        state.hasAppointments
          ? [
              {
                id: appointmentId,
                starts_at: new Date(
                  Date.now() + (state.futureAppointment ? 60 : -90) * 60_000,
                ).toISOString(),
                ends_at: new Date(
                  Date.now() + (state.futureAppointment ? 90 : -60) * 60_000,
                ).toISOString(),
                status: state.appointmentStatus,
                attendance_confirmed_at: new Date(
                  Date.now() - 120 * 60_000,
                ).toISOString(),
                customers: { name: "Cliente QA sintético" },
                services: { name: "Serviço QA sintético" },
              },
            ]
          : [],
        state.hasAppointments ? 1 : 0,
      );
    unexpected.push(url.pathname);
    send(404, { message: "Unknown isolated request" });
  });
  await new Promise<void>((done) => backend.listen(0, "127.0.0.1", done));
  const backendOrigin = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(resolve("tests/fixtures/auth-fetch-hook.mjs")).href,
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
        APP_URL: base,
        AUTH_FLOW_SECRET: "isolated-team-http-auth-secret-not-production",
        TEST_AUTH_BACKEND_URL: backendOrigin,
        NEXT_PUBLIC_SUPABASE_URL: publicOrigin,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "isolated-publishable-key",
        VERCEL_ENV: "preview",
      },
    },
  );
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  const browser = new Map<string, string>();
  const localAuth = createServerClient(
    publicOrigin,
    "isolated-publishable-key",
    {
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
      auth: { autoRefreshToken: false },
      cookies: {
        getAll: () => [...browser].map(([name, value]) => ({ name, value })),
        setAll: (items) =>
          items.forEach(({ name, value }) => browser.set(name, value)),
      },
    },
  );
  assert.equal(
    (await localAuth.auth.setSession(fakeAuth.session("password"))).error,
    null,
  );
  async function request(
    path: string,
    body?: FormData,
    authenticated = true,
    origin = base,
  ) {
    const target = new URL(path, base);
    assert.equal(
      target.origin,
      base,
      "Cookies must stay on this isolated origin",
    );
    return fetch(target, {
      method: body ? "POST" : "GET",
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: "text/html",
        ...(authenticated
          ? {
              Cookie: [...browser]
                .map(([name, value]) => `${name}=${value}`)
                .join("; "),
            }
          : {}),
        ...(body ? { Origin: origin, Referer: target.toString() } : {}),
      },
    });
  }
  async function location(response: Response) {
    let target = response.headers.get("location");
    if (!target && response.status === 200) {
      const html = await response.text();
      const meta = [...html.matchAll(/<meta\b[^>]*>/g)]
        .map((match) => attributes(match[0]))
        .find((tag) => tag.id === "__next-page-redirect");
      target = meta?.content?.match(/^[01];url=(.*)$/)?.[1] || null;
    }
    assert.ok(target, `Expected redirect, HTTP ${response.status}`);
    const result = new URL(target, base);
    assert.equal(result.origin, base);
    return result;
  }
  const callCount = (name: string) =>
    calls.filter((call) => call.name === name).length;
  try {
    phase = "start isolated Next";
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      assert.equal(child.exitCode, null, "Isolated Next exited before startup");
      try {
        if (
          (await fetch(`${base}/entrar`, { signal: AbortSignal.timeout(1000) }))
            .status === 200
        ) {
          ready = true;
          break;
        }
      } catch {
        /* bounded local readiness */
      }
      await new Promise((done) => setTimeout(done, 200));
    }
    assert.ok(ready, "Isolated Next did not become ready");

    phase = "authentication and tenant routes";
    assert.equal(
      (await location(await request(reporting, undefined, false))).pathname,
      "/entrar",
    );
    assert.equal(
      (
        await location(
          await request(`/painel/${otherCompany}/equipe/indicadores`),
        )
      ).pathname,
      "/painel",
    );
    assert.equal(
      (await location(await request(personal, undefined, false))).pathname,
      "/entrar",
    );
    assert.equal(
      (await location(await request(`/painel/${otherCompany}/meu-dia`)))
        .pathname,
      "/painel",
    );
    assert.equal(callCount("get_my_whatsapp_staff_preferences"), 0);
    pass("anonymous and unrelated-company routes redirect before reporting");

    phase = "owner report";
    const ownerResponse = await request(
      `${reporting}?from=${today}&to=${today}`,
    );
    assert.equal(ownerResponse.status, 200);
    const ownerHtml = await ownerResponse.text();
    assert.ok(ownerHtml.includes(staffName));
    assert.equal(callCount("company_team_insights"), 1);
    assert.deepEqual(
      calls.find((call) => call.name === "company_team_insights")?.body,
      { p_company: companyId, p_from: today, p_to: today },
    );
    pass(
      "owner report sends authorized tenant and inclusive dates to the real RPC interface",
    );

    phase = "plan export gates";
    const exportCalls = callCount("company_team_export");
    assert.equal((await request(exporting)).status, 403);
    assert.equal(callCount("company_team_export"), exportCalls);
    state.plan = "essencial";
    const beforeEssential = callCount("company_team_insights");
    const essential = await (await request(reporting)).text();
    assert.ok(/Profissional|profissional/.test(essential));
    assert.equal(callCount("company_team_insights"), beforeEssential);
    state.plan = "empresarial";
    const exported = await request(exporting);
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get("content-type") || "", /text\/csv/);
    assert.match(exported.headers.get("cache-control") || "", /no-store/);
    const csv = await exported.text();
    assert.ok(csv.includes(staffName));
    assert.ok(
      csv.includes("'+Profissional QA"),
      "CSV must neutralize spreadsheet formula prefixes",
    );
    assert.equal(callCount("company_team_export"), exportCalls + 1);
    pass(
      "new plan benefits are gated on the server; enterprise CSV is private and formula-safe",
    );

    phase = "employee report gate";
    state.role = "EMPLOYEE";
    const reportCalls = callCount("company_team_insights");
    const deniedReport = await location(await request(reporting));
    assert.equal(deniedReport.pathname, prefix);
    assert.equal(callCount("company_team_insights"), reportCalls);
    assert.equal((await request(exporting)).status, 403);
    pass(
      "employee cannot access team reporting or its CSV even on the enterprise plan",
    );

    phase = "employee completion";
    const personalResponse = await request(personal);
    assert.equal(personalResponse.status, 200);
    const html = await personalResponse.text();
    assert.ok(html.includes("Cliente QA sintético"));
    assert.ok(html.includes("Minha agenda no WhatsApp"));
    assert.ok(html.includes("Salvar minha preferência"));
    assert.ok(!html.includes("Não foi possível carregar sua preferência"));
    assert.deepEqual(
      calls.find((call) => call.name === "get_my_whatsapp_staff_preferences")
        ?.body,
      { p_company: companyId },
    );
    const complete = completionForm(html);
    const completion = await location(await request(personal, complete));
    assert.equal(completion.searchParams.get("salvo"), "concluido");
    assert.equal(state.appointmentStatus, "completed");
    assert.deepEqual(
      calls.find((call) => call.name === "complete_my_appointment")?.body,
      { p_company: companyId, p_appointment: appointmentId },
    );
    pass(
      "employee bound server action completes only the tenant and appointment sent to the guarded RPC",
    );

    phase = "independent staff preference failure";
    state.preferenceFailed = true;
    const preferenceFailure = await (await request(personal)).text();
    assert.ok(
      preferenceFailure.includes(
        "Não foi possível carregar sua preferência de WhatsApp",
      ),
    );
    assert.ok(preferenceFailure.includes("Cliente QA sintético"));
    assert.ok(preferenceFailure.includes("Concluído"));
    assert.ok(!preferenceFailure.includes("Salvar minha preferência"));
    state.preferenceFailed = false;
    pass(
      "staff preference reads stay tenant-scoped and an independent failure preserves appointment history",
    );

    phase = "role and access changes after rendering";
    const completedCalls = callCount("complete_my_appointment");
    state.role = "OWNER";
    assert.equal(
      (await location(await request(personal, complete))).searchParams.get(
        "erro",
      ),
      "permissao",
    );
    state.role = "EMPLOYEE";
    state.companyStatus = "pending_card";
    assert.equal(
      (await location(await request(personal, complete))).searchParams.get(
        "erro",
      ),
      "assinatura",
    );
    state.companyStatus = "active";
    complete.delete("confirm_action");
    assert.equal(
      (await location(await request(personal, complete))).searchParams.get(
        "erro",
      ),
      "permissao",
    );
    complete.set("confirm_action", "yes");
    assert.equal(callCount("complete_my_appointment"), completedCalls);
    pass(
      "server action rechecks role, company activation and explicit completion confirmation",
    );

    phase = "backend denials and unlinked staff";
    state.appointmentStatus = "scheduled";
    state.deniedAppointment = true;
    assert.equal(
      (await location(await request(personal, complete))).searchParams.get(
        "erro",
      ),
      "conclusao",
    );
    assert.equal(state.appointmentStatus, "scheduled");
    state.deniedAppointment = false;
    state.linked = false;
    const unlinked = await (await request(personal)).text();
    assert.ok(unlinked.includes("Seu perfil ainda precisa de um vínculo"));
    assert.ok(!unlinked.includes('name="appointment_id"'));
    pass(
      "backend denial preserves the appointment and unlinked employee gets an actionable empty state",
    );

    phase = "error state";
    state.role = "MANAGER";
    state.failed = true;
    const errorPage = await (await request(reporting)).text();
    assert.match(errorPage, /role="alert"/);
    assert.ok(!errorPage.includes(staffName));
    assert.deepEqual(unexpected, []);
    pass(
      "report errors render accessible feedback without stale or fabricated staff metrics",
    );

    phase = "three-plan owner manager employee matrix";
    state.failed = false;
    state.linked = true;
    for (const plan of ["essencial", "profissional", "empresarial"]) {
      state.plan = plan;
      for (const role of ["OWNER", "MANAGER"]) {
        state.role = role;
        const beforeReport = callCount("company_team_insights");
        const view = await request(`${reporting}?from=${today}&to=${today}`);
        assert.equal(view.status, 200);
        assert.match(view.headers.get("cache-control") || "", /no-store/);
        const content = await view.text();
        assert.equal(
          callCount("company_team_insights"),
          beforeReport + (plan === "essencial" ? 0 : 1),
        );
        assert.equal(content.includes(staffName), plan !== "essencial");
        const downloaded = await request(exporting);
        assert.equal(downloaded.status, plan === "empresarial" ? 200 : 403);
        assert.match(downloaded.headers.get("cache-control") || "", /no-store/);
        if (plan === "empresarial")
          assert.match(await downloaded.text(), /'\+Profissional QA/);
        else assert.doesNotMatch(await downloaded.text(), /\+Profissional QA/);
      }
      state.role = "EMPLOYEE";
      state.appointmentStatus = "scheduled";
      const beforeReport = callCount("company_team_insights");
      assert.equal((await location(await request(reporting))).pathname, prefix);
      assert.equal((await request(exporting)).status, 403);
      assert.equal(callCount("company_team_insights"), beforeReport);
      const myDay = await request(personal);
      assert.equal(myDay.status, 200);
      assert.match(myDay.headers.get("cache-control") || "", /no-store/);
      const form = completionForm(await myDay.text());
      const beforeComplete = callCount("complete_my_appointment");
      assert.equal(
        (await location(await request(personal, form))).searchParams.get(
          "salvo",
        ),
        "concluido",
      );
      assert.equal(callCount("complete_my_appointment"), beforeComplete + 1);
      const updated = await (await request(personal)).text();
      assert.ok(updated.includes("Concluído"));
      assert.ok(!updated.includes('name="appointment_id"'));
      pass(
        `${plan}: owner/manager report and export gates; employee private day and persisted completion`,
      );
    }

    phase = "cross-origin completion attempt";
    state.role = "EMPLOYEE";
    state.appointmentStatus = "scheduled";
    const protectedForm = completionForm(
      await (await request(personal)).text(),
    );
    const beforeCsrf = callCount("complete_my_appointment");
    const crossOrigin = await request(
      personal,
      protectedForm,
      true,
      "https://attacker.example.invalid",
    );
    assert.ok([400, 403, 500].includes(crossOrigin.status));
    assert.equal(callCount("complete_my_appointment"), beforeCsrf);
    assert.equal(state.appointmentStatus, "scheduled");
    pass(
      "cross-origin server action is rejected before any completion request",
    );

    phase = "empty and non-actionable appointments";
    state.futureAppointment = true;
    const futureHtml = await (await request(personal)).text();
    assert.ok(futureHtml.includes("Cliente QA sintético"));
    assert.ok(!futureHtml.includes('name="appointment_id"'));
    state.futureAppointment = false;
    state.appointmentStatus = "canceled";
    const canceledHtml = await (await request(personal)).text();
    assert.ok(canceledHtml.includes("Cancelado"));
    assert.ok(!canceledHtml.includes('name="appointment_id"'));
    state.hasAppointments = false;
    const emptyHtml = await (await request(personal)).text();
    assert.ok(emptyHtml.includes("Um dia sem atendimentos cadastrados"));
    assert.ok(!emptyHtml.includes("Cliente QA sintético"));
    state.hasAppointments = true;
    pass(
      "future and canceled appointments have no completion action; an empty day has clear feedback",
    );

    phase = "CSV date validation and backend response validation";
    state.role = "MANAGER";
    state.plan = "empresarial";
    const beforeInvalid = callCount("company_team_export");
    for (const suffix of [
      "",
      `?from=${today}`,
      `?from=${today}&from=${today}&to=${today}`,
      "?from=2026-02-30&to=2026-03-01",
      "?from=2026-01-11&to=2026-01-10",
      "?from=2026-01-01&to=2026-04-01",
    ]) {
      const invalid = await request(`${reporting}/exportar${suffix}`);
      assert.equal(invalid.status, 400);
      assert.match(invalid.headers.get("cache-control") || "", /no-store/);
    }
    assert.equal(callCount("company_team_export"), beforeInvalid);
    state.mismatchedReportPeriod = true;
    const mismatch = await request(exporting);
    assert.equal(mismatch.status, 502);
    assert.doesNotMatch(await mismatch.text(), /\+Profissional QA/);
    state.mismatchedReportPeriod = false;
    state.plan = "profissional";
    const beforeOverlong = callCount("company_team_insights");
    const overlong = await (
      await request(`${reporting}?from=2026-01-01&to=2026-02-01`)
    ).text();
    assert.match(overlong, /role="alert"/);
    assert.equal(callCount("company_team_insights"), beforeOverlong);
    pass(
      "CSV rejects invalid or duplicated dates and mismatched backend periods; Pro rejects overlong reports",
    );

    phase = "public landing and plans regression";
    state.failed = false;
    const landing = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/test-landing.ts"],
      {
        cwd: process.cwd(),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          APP_URL: base,
          TEST_BASE_URL: base,
          VERCEL_ENV: "preview",
        },
      },
    );
    let landingOutput = "";
    landing.stdout.on("data", (chunk: Buffer) => {
      landingOutput += chunk.toString();
    });
    landing.stderr.on("data", (chunk: Buffer) => {
      landingOutput += chunk.toString();
    });
    const landingCode = await new Promise<number | null>((done) =>
      landing.once("close", done),
    );
    if (landingCode !== 0) {
      process.stderr.write(landingOutput);
      await mkdir("test-results", { recursive: true });
      await writeFile(
        "test-results/team-insights-public-home.html",
        await (await request("/", undefined, false)).text(),
      );
      await writeFile(
        "test-results/team-insights-public-plans.html",
        await (await request("/planos", undefined, false)).text(),
      );
    }
    assert.equal(
      landingCode,
      0,
      "Public landing regression must pass against the isolated backend",
    );
    process.stdout.write(landingOutput);
    for (const call of calls.filter(
      (item) => item.name === "get_my_whatsapp_staff_preferences",
    ))
      assert.deepEqual(call.body, { p_company: companyId });
    assert.deepEqual(unexpected, []);
    console.log(
      `${checks} isolated team HTTP groups passed; no real account, provider request or database write.`,
    );
  } finally {
    child.kill();
    await new Promise<void>((done) => {
      if (child.exitCode !== null) done();
      else child.once("close", () => done());
    });
    backend.closeAllConnections();
    await new Promise<void>((done) => backend.close(() => done()));
    await fakeAuth.close();
  }
}
main().catch((error: unknown) => {
  console.error(
    `FAIL isolated team (${phase}): ${error instanceof Error ? error.message : "unexpected failure"}`,
  );
  process.exitCode = 1;
});
