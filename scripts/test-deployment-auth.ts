import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, saoPauloDay } from "../src/lib/scheduling";
import { teamInsightsSchema } from "../src/lib/team-insights";

// Explicit production smoke: only these existing DEMO accounts and the authorized
// platform owner. No business writes, reset emails, invites, payments or messages.
// Cookies and password remain in memory; only local test sessions are signed out.
const origin = "https://webfidelize-saas.vercel.app";
// Optional process-only override: rotating the platform owner's password must
// not require changing any of the six existing DEMO account passwords.
const requestedAdminPassword = process.env.TEST_ADMIN_PASSWORD;
const accounts = [
  {
    plan: "essencial",
    company: "5ed3e808-3608-4c85-905f-75b1ecd32ec2",
    professional: "452fbfce-75cd-4b57-bb3c-f59f93eef9d3",
    owner: "academia@example.invalid",
    employee: "essencial.colaborador@example.invalid",
  },
  {
    plan: "profissional",
    company: "16415956-54ea-4973-97d9-5ff5ae3d3842",
    professional: "82188962-563c-49f3-bfbd-a05812e348e8",
    owner: "escritorio@example.invalid",
    employee: "profissional.colaborador@example.invalid",
  },
  {
    plan: "empresarial",
    company: "3f259c2b-27aa-4e64-9c81-443deb1d66b2",
    professional: "181db2dd-ca8e-4332-b1e9-0e77308d71f6",
    owner: "salao@example.invalid",
    employee: "empresarial.colaborador@example.invalid",
  },
] as const;
type Session = { db: SupabaseClient; cookies: Map<string, string> };
class Failure extends Error {}
let phase = "configuration";
let checks = 0;
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Failure(message);
}
function pass(message: string) {
  checks++;
  console.log(`PASS deployment auth: ${message}`);
}
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
const visible = (html: string) =>
  decode(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, "")
      .replace(/<[^>]*>/g, " "),
  ).replace(/\s+/g, " ");

async function main() {
  check(
    process.env.TEST_DEPLOYMENT_AUTH === "1",
    "Set TEST_DEPLOYMENT_AUTH=1 for the explicitly authorized production smoke.",
  );
  process.loadEnvFile(".env.local");
  const password = process.env.TEST_PLAN_ACCOUNTS_PASSWORD;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  check(
    password && publicKey && supabaseUrl,
    "Secure local configuration is incomplete.",
  );
  check(
    new URL(supabaseUrl).origin === "https://devmjeiblhrgjyaiaukm.supabase.co",
    "Refusing a Supabase project other than Web Fidelize.",
  );
  function session(): Session {
    const cookies = new Map<string, string>();
    const db = createServerClient(supabaseUrl!, publicKey!, {
      auth: { autoRefreshToken: false },
      cookies: {
        getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
        setAll: (items) => {
          for (const item of items)
            item.value && item.options.maxAge !== 0
              ? cookies.set(item.name, item.value)
              : cookies.delete(item.name);
        },
      },
    });
    return { db, cookies };
  }
  async function request(client: Session, path: string, body?: FormData) {
    const target = new URL(path, origin);
    check(target.origin === origin, "Refusing cross-origin session transfer.");
    check(
      !body || target.pathname === "/entrar",
      "Only login may receive a POST.",
    );
    const response = await fetch(target, {
      method: body ? "POST" : "GET",
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(45_000),
      headers: {
        Accept: "text/html",
        Cookie: [...client.cookies]
          .map(([key, value]) => `${key}=${value}`)
          .join("; "),
        ...(body ? { Origin: origin, Referer: target.toString() } : {}),
      },
    });
    check(
      response.headers.get("cache-control")?.includes("no-store"),
      "Authentication or tenant response is missing Cache-Control no-store.",
    );
    let insecureCookie = false;
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";", 1)[0];
      const divider = pair.indexOf("=");
      if (divider < 1) continue;
      const name = pair.slice(0, divider);
      const value = pair.slice(divider + 1);
      if (!value || /max-age=0(?:;|$)/i.test(header))
        client.cookies.delete(name);
      else {
        client.cookies.set(name, value);
        if (
          name.startsWith("sb-") &&
          (!/;\s*secure(?:;|$)/i.test(header) ||
            !/;\s*samesite=lax(?:;|$)/i.test(header))
        )
          insecureCookie = true;
      }
    }
    check(
      !insecureCookie,
      "A live HTTPS Supabase session cookie lacks Secure or SameSite=Lax.",
    );
    return response;
  }
  async function destination(response: Response) {
    let target = response.headers.get("location");
    if (!target && response.status === 200) {
      const source = await response.text();
      const meta = [...source.matchAll(/<meta\b[^>]*>/g)]
        .map((match) => attributes(match[0]))
        .find((tag) => tag.id === "__next-page-redirect");
      target =
        meta?.content?.match(/^\s*[01]\s*;\s*url=(.+)\s*$/i)?.[1] || null;
    }
    check(target, "Expected an explicit role-specific redirect.");
    const result = new URL(target, origin);
    check(result.origin === origin, "Unexpected redirect origin.");
    return result;
  }
  async function html(client: Session, path: string) {
    const response = await request(client, path);
    check(response.status === 200, "Authorized page did not return HTTP 200.");
    const source = await response.text();
    check(
      !source.includes('id="__next-page-redirect"') &&
        !source.includes("NEXT_HTTP_ERROR_FALLBACK;404") &&
        !visible(source).includes("Algo deu errado"),
      "Authorized page redirected or rendered an error.",
    );
    return source;
  }
  async function login(
    client: Session,
    email: string,
    accountPassword: string = password!,
  ) {
    const source = await html(client, "/entrar");
    const form = [...source.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
      .map((match) => match[0])
      .find((item) => item.includes('name="password"'));
    check(form, "The actual login form is missing.");
    const body = new FormData();
    for (const input of form.matchAll(/<input\b[^>]*>/g)) {
      const field = attributes(input[0]);
      if (field.type === "hidden" && field.name)
        body.append(field.name, field.value || "");
    }
    check(
      [...body.keys()].some(
        (name) =>
          name.startsWith("$ACTION_ID_") || name.startsWith("$ACTION_REF_"),
      ),
      "The real Server Action binding is missing.",
    );
    body.set("email", email);
    body.set("password", accountPassword);
    body.set("next", "/painel");
    const result = await destination(await request(client, "/entrar", body));
    check(
      result.pathname ===
        (email === "diogohf231@gmail.com" ? "/admin" : "/painel") &&
        !result.searchParams.has("erro"),
      "Real login was rejected.",
    );
    const current = await client.db.auth.getUser();
    check(
      !current.error && current.data.user?.email === email,
      "Login identity mismatch.",
    );
    return current.data.user.id;
  }
  async function deniedAdmin(client: Session) {
    const response = await request(client, "/admin");
    const source = await response.text();
    check(
      response.status === 404 ||
        source.includes("NEXT_HTTP_ERROR_FALLBACK;404"),
      `Non-admin admin denial was not recognized (HTTP ${response.status}; not-found marker ${source.includes("404")}; private heading ${visible(source).includes("Empresas da plataforma")}).`,
    );
    check(
      !visible(source).includes("Empresas da plataforma"),
      "Admin content leaked to non-admin.",
    );
  }
  for (let index = 0; index < accounts.length; index++) {
    const account = accounts[index];
    const foreign = accounts[(index + 1) % accounts.length];
    const owner = session();
    const employee = session();
    const prefix = `/painel/${account.company}`;
    const reportRoute = `${prefix}/equipe/indicadores`;
    const day = saoPauloDay();
    const args = { p_company: account.company, p_from: day, p_to: day };
    try {
      phase = `${account.plan}: login and scope`;
      for (const [client, email, role] of [
        [owner, account.owner, "OWNER"],
        [employee, account.employee, "EMPLOYEE"],
      ] as const) {
        const id = await login(client, email);
        const member = await client.db
          .from("memberships")
          .select("role")
          .eq("company_id", account.company)
          .eq("user_id", id)
          .single();
        check(
          !member.error && member.data?.role === role,
          "DEMO membership mismatch.",
        );
        const entry = await destination(await request(client, "/painel"));
        check(
          entry.pathname === (role === "OWNER" ? prefix : `${prefix}/meu-dia`),
          "Wrong role entry point.",
        );
        const company = await client.db
          .from("companies")
          .select("is_demo,plan_id")
          .eq("id", account.company)
          .single();
        check(
          !company.error &&
            company.data?.is_demo &&
            company.data.plan_id === account.plan,
          "Wrong DEMO company/plan.",
        );
        await deniedAdmin(client);
        const cross = await client.db
          .from("companies")
          .select("id")
          .eq("id", foreign.company);
        check(
          !cross.error && cross.data?.length === 0,
          "Cross-company RLS violation.",
        );
        const crossPage = await destination(
          await request(client, `/painel/${foreign.company}/meu-dia`),
        );
        check(
          crossPage.pathname === "/painel" &&
            crossPage.searchParams.get("erro") === "acesso",
          "Foreign company URL was accepted.",
        );
      }
      pass(
        `${account.plan}: real owner/employee login, HTTPS session, tenant isolation and admin denial`,
      );
      phase = `${account.plan}: own workday and plan capabilities`;
      const myDay = visible(await html(employee, `${prefix}/meu-dia`));
      check(
        myDay.includes("Meu dia") &&
          myDay.includes("Ambiente de demonstração."),
        "Employee workday is unavailable or not marked as DEMO.",
      );
      const professional = await employee.db
        .from("professionals")
        .select("id,company_id");
      check(
        !professional.error &&
          professional.data?.length === 1 &&
          professional.data[0].id === account.professional &&
          professional.data[0].company_id === account.company,
        "Employee professional scope escaped its assignment.",
      );
      const visits = await employee.db
        .from("appointments")
        .select("professional_id,company_id")
        .limit(100);
      check(
        !visits.error &&
          visits.data?.every(
            (visit) =>
              visit.professional_id === account.professional &&
              visit.company_id === account.company,
          ),
        "Employee appointment scope escaped its assignment.",
      );
      const employeeReport = await destination(
        await request(employee, reportRoute),
      );
      check(
        employeeReport.pathname === prefix &&
          employeeReport.searchParams.get("erro") === "permissao",
        "Employee reached team management.",
      );
      const employeeRpc = await employee.db.rpc("company_team_insights", args);
      check(
        employeeRpc.error?.message.includes("not authorized"),
        "Employee bypassed team RPC permissions.",
      );
      const page = visible(await html(owner, reportRoute));
      const report = await owner.db.rpc("company_team_insights", args);
      const csvPath = `${reportRoute}/exportar?from=${day}&to=${day}`;
      check(
        (await request(employee, csvPath)).status === 403,
        "Employee exported management data.",
      );
      const ownerCsv = await request(owner, csvPath);
      if (account.plan === "essencial") {
        check(
          report.error?.message.includes("plan feature unavailable") &&
            page.includes("A partir do Profissional"),
          "Essential upgrade gating failed.",
        );
        check(ownerCsv.status === 403, "Essential exported enterprise CSV.");
      } else {
        const parsed = teamInsightsSchema.safeParse(report.data);
        const max = account.plan === "profissional" ? 31 : 90;
        check(
          !report.error &&
            parsed.success &&
            parsed.data.max_days === max &&
            !page.includes("Não foi possível"),
          "Authorized team indicators failed.",
        );
        const period = await owner.db.rpc("company_team_insights", {
          ...args,
          p_from: addDays(day, 1 - max),
        });
        const excessive = await owner.db.rpc("company_team_insights", {
          ...args,
          p_from: addDays(day, -max),
        });
        check(
          !period.error &&
            excessive.error?.message.includes("team report period limit"),
          "Plan period restriction failed.",
        );
        if (account.plan === "profissional")
          check(
            ownerCsv.status === 403,
            "Professional exported enterprise CSV.",
          );
        else {
          check(
            ownerCsv.status === 200 &&
              ownerCsv.headers.get("content-type")?.includes("text/csv"),
            "Enterprise export did not return a CSV.",
          );
          const csv = await ownerCsv.text();
          check(
            csv.includes("Profissional") && csv.includes("Concluídos"),
            "Enterprise CSV is missing actual operational columns.",
          );
        }
      }
      pass(
        `${account.plan}: employee workday, owner reports, period limits and private CSV`,
      );
    } finally {
      for (const client of [owner, employee]) {
        await client.db.auth.signOut({ scope: "local" });
        client.cookies.clear();
      }
    }
  }
  phase = "SUPER_ADMIN";
  const admin = session();
  try {
    await login(
      admin,
      "diogohf231@gmail.com",
      requestedAdminPassword || password!,
    );
    const role = await admin.db.rpc("is_super_admin");
    check(
      !role.error && role.data === true,
      "Platform owner is not authorized as SUPER_ADMIN.",
    );
    const adminHtml = await html(admin, "/admin");
    const page = visible(adminHtml);
    check(
      /<section\b[^>]*\bid="empresas"/.test(adminHtml) &&
        /<table\b[^>]*class="[^"]*admin-companies-table/.test(adminHtml) &&
        page.includes(
          "Empresas cadastradas, situação de acesso e data final do teste",
        ) &&
        page.includes("SUPER_ADMIN") &&
        !page.includes("Não foi possível carregar"),
      "Authorized admin dashboard failed.",
    );
    const commercial = visible(await html(admin, "/admin/comercial"));
    check(
      !commercial.includes("Não foi possível") &&
        commercial.includes("comercial"),
      "Authorized commercial admin failed.",
    );
    pass("SUPER_ADMIN login, administrative dashboard and commercial funnel");
  } finally {
    await admin.db.auth.signOut({ scope: "local" });
    admin.cookies.clear();
  }
  console.log(
    `${checks} production authentication groups passed. No business data, payments, emails or messages were written.`,
  );
}
main().catch((error: unknown) => {
  console.error(
    `FAIL deployment auth (${phase}): ${error instanceof Failure ? error.message : "Unexpected failure; details withheld to protect credentials."}`,
  );
  process.exitCode = 1;
});
