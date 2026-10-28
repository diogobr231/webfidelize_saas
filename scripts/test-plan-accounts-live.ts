import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { addDays, saoPauloDay, validDay } from "../src/lib/scheduling";
import { hasAccess } from "../src/lib/permissions";
import { teamInsightsSchema } from "../src/lib/team-insights";

// Explicitly provisioned DEMO accounts only. Six isolated Auth sessions exercise
// localhost UI and real Supabase RLS/RPCs. The sole business mutation is completing
// an explicitly identified, ended QA appointment; its history is never reverted.
// Secrets are supplied through the process or an ignored manifest, never logged.
const enabled = process.env.TEST_PLAN_ACCOUNTS_LIVE === "1";
const manifestPath = process.env.TEST_PLAN_ACCOUNTS_FILE;
const processPassword = process.env.SEED_PASSWORD;
let phase = "configuration",
  checks = 0;
class TestFailure extends Error {}
function check(value: unknown, message: string): asserts value {
  if (!value) throw new TestFailure(message);
}
const pass = (message: string) => {
  checks++;
  console.log(`PASS live plans: ${message}`);
};
const accountSchema = z.object({
  plan: z.enum(["essencial", "profissional", "empresarial"]),
  companyId: z.uuid(),
  ownerEmail: z.email(),
  employeeEmail: z.email(),
  professionalId: z.uuid(),
  appointmentId: z.uuid(),
  appointmentDay: z.string().refine(validDay),
  appointmentMarker: z.string().min(8).max(120),
  password: z.string().min(8).optional(),
});
const manifestSchema = z.object({
  accounts: z.array(accountSchema).length(3),
  password: z.string().min(8).optional(),
});
type Account = z.infer<typeof accountSchema>;
type Session = { db: SupabaseClient; cookies: Map<string, string> };
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
function actionForm(html: string, matches: (source: string) => boolean) {
  const source = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map((match) => match[0])
    .find(matches);
  check(source, "The expected verified Server Action form was not rendered.");
  const body = new FormData();
  for (const input of source.matchAll(/<input\b[^>]*>/g)) {
    const field = attributes(input[0]);
    if (field.type === "hidden" && field.name)
      body.append(field.name, field.value || "");
  }
  check(
    [...body.keys()].some(
      (name) =>
        name.startsWith("$ACTION_ID_") || name.startsWith("$ACTION_REF_"),
    ),
    "Server Action binding is absent.",
  );
  return body;
}
const relationName = (relation: unknown) => {
  const item = Array.isArray(relation) ? relation[0] : relation;
  return item && typeof item === "object" && "name" in item
    ? String(item.name)
    : "";
};

async function main() {
  check(
    enabled && manifestPath,
    "Set TEST_PLAN_ACCOUNTS_LIVE=1 and TEST_PLAN_ACCOUNTS_FILE for the explicit DEMO test.",
  );
  const absoluteManifest = resolve(manifestPath);
  const manifestRelative = relative(resolve("test-results"), absoluteManifest);
  check(
    manifestRelative &&
      !manifestRelative.startsWith("..") &&
      !isAbsolute(manifestRelative) &&
      absoluteManifest.endsWith(".json"),
    "The account manifest must be a JSON file inside ignored test-results.",
  );
  const parsed = manifestSchema.safeParse(
    JSON.parse(await readFile(absoluteManifest, "utf8")),
  );
  check(
    parsed.success,
    "Invalid DEMO account manifest; details withheld to protect credentials.",
  );
  const manifest = parsed.data;
  check(
    new Set(manifest.accounts.map((account) => account.plan)).size === 3 &&
      new Set(manifest.accounts.map((account) => account.companyId)).size === 3,
    "Each plan must map to a distinct explicitly provisioned DEMO company.",
  );
  check(
    new Set(
      manifest.accounts.flatMap((account) => [
        account.ownerEmail,
        account.employeeEmail,
      ]),
    ).size === 6,
    "Six distinct synthetic identities are required.",
  );
  check(
    manifest.accounts.every((account) =>
      [account.ownerEmail, account.employeeEmail].every((email) =>
        email.endsWith("@example.invalid"),
      ),
    ),
    "This suite accepts only reserved example.invalid DEMO identities.",
  );
  try {
    process.loadEnvFile(".env.local");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const base = new URL(process.env.TEST_BASE_URL || "http://localhost:3000");
  check(
    base.origin === "http://localhost:3000" &&
      base.pathname === "/" &&
      !base.search &&
      !base.hash &&
      !base.username &&
      !base.password,
    "Only the explicitly authorized localhost:3000 application is allowed.",
  );
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  check(
    supabaseUrl && publishableKey,
    "Public Supabase configuration is missing.",
  );
  check(
    new URL(supabaseUrl).hostname === "devmjeiblhrgjyaiaukm.supabase.co",
    "Refusing a Supabase project other than Web Fidelize.",
  );
  const commonPassword =
    processPassword ||
    manifest.password ||
    process.env.TEST_PLAN_ACCOUNTS_PASSWORD;

  function session(): Session {
    const cookies = new Map<string, string>();
    const db = createServerClient(supabaseUrl!, publishableKey!, {
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
  async function request(
    client: Session,
    path: string,
    body?: FormData,
    verified?: Account,
  ) {
    const target = new URL(path, base);
    check(
      target.origin === base.origin,
      "Refusing cross-origin session transfer.",
    );
    if (body)
      check(
        target.pathname === "/entrar" ||
          (verified &&
            target.pathname === `/painel/${verified.companyId}/meu-dia` &&
            body.get("appointment_id") === verified.appointmentId),
        "Only login and the verified QA appointment completion may receive a form.",
      );
    const response = await fetch(target, {
      method: body ? "POST" : "GET",
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(45_000),
      headers: {
        Accept: "text/html",
        Cookie: [...client.cookies]
          .map(([name, value]) => `${name}=${value}`)
          .join("; "),
        ...(body ? { Origin: base.origin, Referer: target.toString() } : {}),
      },
    });
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";", 1)[0],
        separator = pair.indexOf("=");
      if (separator < 1) continue;
      const name = pair.slice(0, separator),
        value = pair.slice(separator + 1);
      if (!value || /max-age=0(?:;|$)/i.test(header))
        client.cookies.delete(name);
      else client.cookies.set(name, value);
    }
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
    check(target, "Expected an explicit authenticated redirect.");
    const result = new URL(target, base);
    check(result.origin === base.origin, "Unexpected redirect origin.");
    return result;
  }
  async function html(client: Session, path: string) {
    const response = await request(client, path);
    check(response.status === 200, "Expected an authorized page to load.");
    const source = await response.text();
    check(
      !source.includes('id="__next-page-redirect"') &&
        !source.includes('data-dgst="NEXT_HTTP_ERROR_FALLBACK;404"') &&
        !visible(source).includes("Algo deu errado"),
      "An authorized page redirected or failed.",
    );
    return source;
  }
  async function login(client: Session, email: string, password: string) {
    const source = await html(client, "/entrar");
    const body = actionForm(source, (form) => form.includes('name="password"'));
    body.set("email", email);
    body.set("password", password);
    body.set("next", "/painel");
    const target = await destination(await request(client, "/entrar", body));
    check(
      target.pathname === "/painel" && !target.searchParams.has("erro"),
      "The real login Server Action rejected the synthetic identity.",
    );
    const current = await client.db.auth.getUser();
    check(
      !current.error && current.data.user?.email === email,
      "Session identity does not match the submitted DEMO login.",
    );
    return current.data.user.id;
  }
  async function appointments(client: Session, company: string) {
    const result = await client.db
      .from("appointments")
      .select("*", { count: "exact" })
      .eq("company_id", company)
      .order("id")
      .limit(1000);
    check(
      !result.error &&
        result.data &&
        result.count !== null &&
        result.count <= 1000,
      "Cannot safely inspect the entire bounded DEMO appointment set.",
    );
    return result.data as Record<string, unknown>[];
  }
  for (let index = 0; index < manifest.accounts.length; index++) {
    const account = manifest.accounts[index];
    const foreign = manifest.accounts[(index + 1) % manifest.accounts.length];
    const password = account.password || commonPassword;
    check(password, "DEMO password was not supplied securely.");
    const owner = session(),
      employee = session();
    const prefix = `/painel/${account.companyId}`;
    const personal = `${prefix}/meu-dia?day=${account.appointmentDay}`;
    const reportRoute = `${prefix}/equipe/indicadores`;
    const reportArgs = {
      p_company: account.companyId,
      p_from: account.appointmentDay,
      p_to: account.appointmentDay,
    };
    try {
      phase = `${account.plan}: real login and fixture authorization`;
      const ownerId = await login(owner, account.ownerEmail, password);
      const employeeId = await login(employee, account.employeeEmail, password);
      const beforeCompany = await owner.db
        .from("companies")
        .select(
          "id,name,is_demo,plan_id,status,trial_ends_at,trial_card_required",
        )
        .eq("id", account.companyId)
        .single();
      check(
        !beforeCompany.error &&
          beforeCompany.data?.is_demo === true &&
          beforeCompany.data.name.startsWith("DEMO") &&
          beforeCompany.data.plan_id === account.plan &&
          hasAccess(
            beforeCompany.data.status,
            beforeCompany.data.trial_ends_at,
          ),
        "Refusing a non-DEMO, wrong-plan or inactive company.",
      );
      for (const [client, userId, role] of [
        [owner, ownerId, "OWNER"],
        [employee, employeeId, "EMPLOYEE"],
      ] as const) {
        const membership = await client.db
          .from("memberships")
          .select("role")
          .eq("company_id", account.companyId)
          .eq("user_id", userId)
          .single();
        check(
          !membership.error && membership.data?.role === role,
          "The provisioned DEMO membership does not match its expected role.",
        );
        const target = await destination(await request(client, "/painel"));
        check(
          target.pathname === (role === "OWNER" ? prefix : `${prefix}/meu-dia`),
          "Panel entry did not select the correct role-specific route.",
        );
      }
      const professional = await employee.db
        .from("professionals")
        .select("id,company_id,user_id,archived_at");
      check(
        !professional.error &&
          professional.data?.length === 1 &&
          professional.data[0].id === account.professionalId &&
          professional.data[0].company_id === account.companyId &&
          professional.data[0].user_id === employeeId &&
          professional.data[0].archived_at === null,
        "Employee is not restricted to its single linked active DEMO professional.",
      );
      pass(
        `${account.plan}: OWNER and EMPLOYEE login, correct landing and professional isolation`,
      );

      phase = `${account.plan}: appointment and tenant isolation`;
      const before = await appointments(owner, account.companyId);
      const scoped = await appointments(employee, account.companyId);
      check(
        scoped.every(
          (item) => item.professional_id === account.professionalId,
        ) && scoped.some((item) => item.id === account.appointmentId),
        "Employee appointments escaped its assigned professional.",
      );
      const qa = await employee.db
        .from("appointments")
        .select(
          "id,company_id,professional_id,starts_at,ends_at,status,customers(name),services(name)",
        )
        .eq("id", account.appointmentId)
        .single();
      check(
        !qa.error &&
          qa.data &&
          qa.data.company_id === account.companyId &&
          qa.data.professional_id === account.professionalId &&
          saoPauloDay(new Date(qa.data.starts_at)) === account.appointmentDay &&
          Date.parse(qa.data.ends_at) <= Date.now() &&
          ["scheduled", "completed"].includes(qa.data.status),
        "Refusing a missing, foreign, future or non-completable QA appointment.",
      );
      check(
        [relationName(qa.data.customers), relationName(qa.data.services)].some(
          (name) => name.startsWith(account.appointmentMarker),
        ),
        "The appointment does not carry the explicitly supplied QA marker.",
      );
      for (const client of [owner, employee]) {
        const rows = await client.db
          .from("companies")
          .select("id")
          .eq("id", foreign.companyId);
        check(
          !rows.error && rows.data?.length === 0,
          "A DEMO identity read a foreign company through RLS.",
        );
        const target = await destination(
          await request(client, `/painel/${foreign.companyId}/meu-dia`),
        );
        check(
          target.pathname === "/painel" &&
            target.searchParams.get("erro") === "acesso",
          "The server accepted a foreign tenant URL.",
        );
      }
      pass(
        `${account.plan}: both roles reject other companies; employee sees only assigned appointments`,
      );

      phase = `${account.plan}: reports, limits and CSV`;
      const ownerPage = await html(
        owner,
        `${reportRoute}?from=${account.appointmentDay}&to=${account.appointmentDay}`,
      );
      const menu = ownerPage.match(
        /<nav\b[^>]*aria-label="Menu da empresa"[^>]*>([\s\S]*?)<\/nav>/,
      )?.[1];
      check(menu, "The company navigation was not delivered in the page.");
      const currentLinks = [
        ...menu.matchAll(/<a\b[^>]*aria-current="(?:page|location)"[^>]*>/g),
      ];
      check(
        currentLinks.length === 1 &&
          currentLinks[0][0].includes(`href="${reportRoute}"`),
        "The report must highlight only its own navigation item, not its parent.",
      );
      const employeeDenied = await destination(
        await request(employee, reportRoute),
      );
      check(
        employeeDenied.pathname === prefix &&
          employeeDenied.searchParams.get("erro") === "permissao",
        "Employee reached the management report.",
      );
      const employeeReport = await employee.db.rpc(
        "company_team_insights",
        reportArgs,
      );
      check(
        employeeReport.error?.message.includes("not authorized"),
        "Employee bypassed report authorization through RPC.",
      );
      const ownerReport = await owner.db.rpc(
        "company_team_insights",
        reportArgs,
      );
      const exportRoute = `${reportRoute}/exportar?from=${account.appointmentDay}&to=${account.appointmentDay}`;
      const employeeCsv = await request(employee, exportRoute);
      check(employeeCsv.status === 403, "Employee exported team data.");
      const ownerCsv = await request(owner, exportRoute);
      if (account.plan === "essencial") {
        check(
          ownerReport.error?.message.includes("plan feature unavailable") &&
            visible(ownerPage).includes("A partir do Profissional"),
          "Essential did not show its explicit, non-destructive upgrade path.",
        );
        check(
          ownerCsv.status === 403,
          "Essential bypassed enterprise export restriction.",
        );
      } else {
        const report = teamInsightsSchema.safeParse(ownerReport.data);
        check(
          !ownerReport.error &&
            report.success &&
            report.data.max_days ===
              (account.plan === "profissional" ? 31 : 90),
          "The real report does not match the plan's backend capability.",
        );
        check(
          !visible(ownerPage).includes("Não foi possível"),
          "The management report rendered an error.",
        );
        const maximum = account.plan === "profissional" ? 31 : 90;
        const end = saoPauloDay();
        const allowed = await owner.db.rpc("company_team_insights", {
          ...reportArgs,
          p_from: addDays(end, 1 - maximum),
          p_to: end,
        });
        const excessive = await owner.db.rpc("company_team_insights", {
          ...reportArgs,
          p_from: addDays(end, -maximum),
          p_to: end,
        });
        check(
          !allowed.error &&
            excessive.error?.message.includes("team report period limit"),
          "The inclusive 31/90-day report limit is not enforced by the database.",
        );
        if (account.plan === "profissional")
          check(
            ownerCsv.status === 403,
            "Professional bypassed enterprise CSV restriction.",
          );
        else {
          check(
            ownerCsv.status === 200 &&
              ownerCsv.headers.get("content-type")?.includes("text/csv") &&
              ownerCsv.headers.get("cache-control")?.includes("no-store"),
            "Enterprise CSV was not delivered as private data.",
          );
          const csv = await ownerCsv.text();
          check(
            csv.includes("Profissional") &&
              csv.includes("Concluídos") &&
              !csv.includes("Faturamento"),
            "Export is missing operational indicators or inventing revenue.",
          );
        }
      }
      pass(
        `${account.plan}: real plan gating, period limit, management scope and CSV privacy`,
      );

      phase = `${account.plan}: employee completion`;
      const myDay = await html(employee, personal);
      check(
        visible(myDay).includes("Meu dia") &&
          visible(myDay).includes("Ambiente de demonstração."),
        "Employee page does not identify its authorized demonstration context.",
      );
      if (qa.data.status === "scheduled") {
        const complete = actionForm(myDay, (form) =>
          form.includes(account.appointmentId),
        );
        complete.set("appointment_id", account.appointmentId);
        complete.set("day", account.appointmentDay);
        complete.set("confirm_action", "yes");
        const target = await destination(
          await request(employee, personal, complete, account),
        );
        check(
          target.pathname === `${prefix}/meu-dia` &&
            target.searchParams.get("salvo") === "concluido",
          "The guarded employee completion Server Action failed.",
        );
      }
      const repeated = await employee.db.rpc("complete_my_appointment", {
        p_company: account.companyId,
        p_appointment: account.appointmentId,
      });
      check(
        !repeated.error && repeated.data === account.appointmentId,
        "Completed QA appointment is not idempotent.",
      );
      const after = await appointments(owner, account.companyId);
      check(
        before.length === after.length,
        "The completion created or removed an appointment.",
      );
      for (let position = 0; position < before.length; position++) {
        const expected =
          before[position].id === account.appointmentId
            ? { ...before[position], status: "completed" }
            : before[position];
        check(
          JSON.stringify(after[position]) === JSON.stringify(expected),
          "Completion changed unrelated appointment data or failed to persist.",
        );
      }
      const finalDay = await html(employee, personal);
      const ownForm = [
        ...finalDay.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g),
      ].some((form) => form[0].includes(account.appointmentId));
      check(
        visible(finalDay).includes("Concluído") && !ownForm,
        "Completed visit was not reflected in the employee's real UI.",
      );
      if (account.plan !== "essencial") {
        const afterReport = await owner.db.rpc(
          "company_team_insights",
          reportArgs,
        );
        const report = teamInsightsSchema.safeParse(afterReport.data);
        check(
          !afterReport.error &&
            report.success &&
            report.data.professionals.some(
              (item) =>
                item.professional_id === account.professionalId &&
                item.completed >= 1,
            ),
          "Employee completion did not reach actual manager indicators.",
        );
      }
      const afterCompany = await owner.db
        .from("companies")
        .select(
          "id,name,is_demo,plan_id,status,trial_ends_at,trial_card_required",
        )
        .eq("id", account.companyId)
        .single();
      check(
        !afterCompany.error &&
          JSON.stringify(afterCompany.data) ===
            JSON.stringify(beforeCompany.data),
        "Plan, access or trial changed during the test.",
      );
      pass(
        `${account.plan}: explicit QA visit completed, persisted and idempotent; other records and commercial state preserved`,
      );
    } finally {
      for (const client of [owner, employee]) {
        await client.db.auth.signOut({ scope: "local" });
        client.cookies.clear();
      }
    }
  }
  console.log(
    `${checks} live plan account groups passed across six synthetic logins. Only the three authorized QA completions were written; no card, payment, email or message was sent.`,
  );
}
main().catch((error: unknown) => {
  console.error(
    `FAIL live plan verification (${phase}): ${error instanceof TestFailure ? error.message : "Unexpected failure; details withheld to protect credentials."}`,
  );
  process.exitCode = 1;
});
