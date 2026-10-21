import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { setupProgress } from "../src/lib/onboarding";

// Explicit opt-in. The password must come from the invoking process, not a file.
const password = process.env.SEED_PASSWORD;
const optedIn = process.env.TEST_ONBOARDING_LIVE === "1";
let environmentLoadFailed = false;
try {
  process.loadEnvFile(".env.local");
} catch (error) {
  environmentLoadFailed = (error as NodeJS.ErrnoException).code !== "ENOENT";
}

let phase = "configuration";
let groups = 0;
class TestFailure extends Error {}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TestFailure(message);
}
function pass(message: string) {
  groups += 1;
  console.log(`PASS ${message}`);
}
function decodeHtml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
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
function actionForm(html: string, kind: "service" | "professional") {
  const source = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map((match) => match[0])
    .find((form) => {
      const names = new Set(inputs(form).map((input) => input.name));
      return (
        names.has("record_id") &&
        names.has("name") &&
        (kind === "service"
          ? names.has("price") && names.has("duration")
          : !names.has("price"))
      );
    });
  check(source, "Expected guided form was not rendered.");
  const data = new FormData();
  for (const input of inputs(source)) {
    if (input.type === "hidden" && input.name)
      data.append(input.name, input.value || "");
  }
  // useActionState and bound arguments use $ACTION_REF_ plus serialized hidden
  // fields. Preserve every hidden field; do not reconstruct or forge bindings.
  check(
    [...data.keys()].some(
      (key) => key.startsWith("$ACTION_REF_") || key.startsWith("$ACTION_ID_"),
    ),
    "Expected Next Server Action fields were absent.",
  );
  check(
    typeof data.get("record_id") === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        String(data.get("record_id")),
      ),
    "The server must provide a record identity for safe retries.",
  );
  return data;
}
function cloneForm(source: FormData) {
  const copy = new FormData();
  for (const [key, value] of source) copy.append(key, value);
  return copy;
}
function fieldValue(html: string, name: string, value: string) {
  return inputs(html).some(
    (input) => input.name === name && input.value === value,
  );
}
function checkProgress(html: string, services: number, professionals: number) {
  const expected = setupProgress(true, services, professionals);
  const progress = [...html.matchAll(/<progress\b[^>]*>/g)].map((match) =>
    attributes(match[0]),
  );
  const accessibleProgress = [
    ...html.matchAll(/<[^>]+\brole="progressbar"[^>]*>/g),
  ].map((match) => attributes(match[0]));
  const matches =
    progress.some(
      (item) =>
        Number(item.value) / Number(item.max || 1) ===
        expected.done / expected.total,
    ) ||
    accessibleProgress.some(
      (item) =>
        Number(item["aria-valuenow"]) === expected.percent &&
        Number(item["aria-valuemax"] || 100) === 100,
    );
  check(
    matches,
    "Progress did not reflect saved company, services and professionals.",
  );
}

async function main() {
  check(
    optedIn,
    "Set TEST_ONBOARDING_LIVE=1 to allow explicitly fictitious records in an existing demo tenant.",
  );
  check(
    !environmentLoadFailed,
    "Could not load local application configuration.",
  );
  const base = new URL(process.env.TEST_BASE_URL || "http://localhost:3000");
  const email = process.env.DEMO_EMAIL || "pet-shop@example.invalid";
  const foreignEmail =
    process.env.FOREIGN_DEMO_EMAIL ||
    (email === "clinica@example.invalid"
      ? "pet-shop@example.invalid"
      : "clinica@example.invalid");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const mode = process.env.TEST_ONBOARDING_MODE || "full";
  check(
    mode === "full" || mode === "validation",
    "TEST_ONBOARDING_MODE must be full or validation.",
  );
  check(
    ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) &&
      ["http:", "https:"].includes(base.protocol) &&
      !base.username &&
      !base.password,
    "Live onboarding validation requires a local server without URL credentials.",
  );
  check(
    email.endsWith("@example.invalid") &&
      foreignEmail.endsWith("@example.invalid") &&
      email !== foreignEmail,
    "Use two distinct existing synthetic demo accounts.",
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
  let companyId = "";
  let setupRoute = "";
  async function request(
    path: string,
    init: RequestInit = {},
    authenticated = true,
  ) {
    const target = new URL(path, base);
    check(
      target.origin === base.origin,
      "Refusing to send a demo session to another origin.",
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
    if (authenticated) {
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
    }
    return response;
  }
  async function html(path: string) {
    const response = await request(path);
    check(
      response.status === 200,
      "Expected guided page did not load successfully.",
    );
    return response.text();
  }
  async function destination(response: Response) {
    let value: string | null = null;
    if ([303, 307, 308].includes(response.status))
      value = response.headers.get("location");
    else if (response.status === 200) {
      const source = await response.text();
      const metadata = [...source.matchAll(/<meta\b[^>]*>/g)]
        .map((match) => attributes(match[0]))
        .find(
          (tag) =>
            tag.id === "__next-page-redirect" &&
            tag["http-equiv"]?.toLowerCase() === "refresh",
        );
      value =
        metadata?.content?.match(/^\s*[01]\s*;\s*url=(.+)\s*$/i)?.[1] || null;
    }
    check(value, "Expected an HTTP or explicit Next streaming redirect.");
    const target = new URL(value, base);
    check(
      target.origin === base.origin,
      "Guided flow redirected outside the application.",
    );
    return target;
  }
  async function post(path: string, body: FormData, authenticated = true) {
    check(
      new URL(path, base).pathname === setupRoute && companyId,
      "Only the verified demo tenant's setup form may be submitted.",
    );
    return request(
      path,
      {
        method: "POST",
        body,
        headers: {
          Origin: base.origin,
          Referer: new URL(path, base).toString(),
        },
      },
      authenticated,
    );
  }
  async function count(table: "services" | "professionals") {
    const result = await db
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .is("archived_at", null);
    check(
      !result.error && result.count !== null,
      "Could not verify demo record counts.",
    );
    return result.count;
  }
  async function record(table: "services" | "professionals", id: string) {
    const result = await db
      .from(table)
      .select("*")
      .eq("company_id", companyId)
      .eq("id", id)
      .maybeSingle();
    check(!result.error, "Could not verify the guided record in its company.");
    return result.data;
  }
  function serviceForm(source: FormData, name: string, intent = "next") {
    const data = cloneForm(source);
    data.set("name", name);
    data.set("duration", "30");
    data.set("price", "69,90");
    data.set("intent", intent);
    return data;
  }
  async function verifyValidation(
    source: string,
    route: string,
    expectedServices: number,
    marker: string,
  ) {
    phase = "invalid service and field preservation";
    const invalid = serviceForm(
      actionForm(source, "service"),
      `${marker} inválido`,
    );
    const invalidId = String(invalid.get("record_id"));
    check(
      !(await record("services", invalidId)),
      "Invalid-input test requires an unused server-provided record identity.",
    );
    invalid.set("price", "12,345");
    const invalidResponse = await post(route, invalid);
    check(
      invalidResponse.status === 200 &&
        !invalidResponse.headers.get("location") &&
        invalidResponse.headers.get("content-type")?.includes("text/html"),
      "Validation errors must render form state instead of redirecting away.",
    );
    // Reading the complete response shares request()'s timeout. A partial
    // Suspense shell must never count as a successful validation response.
    const invalidHtml = await invalidResponse.text();
    check(
      invalidHtml.includes("</html>") && /\brole="alert"/.test(invalidHtml),
      "Invalid price must produce an accessible validation error.",
    );
    check(
      fieldValue(invalidHtml, "name", `${marker} inválido`) &&
        fieldValue(invalidHtml, "price", "12,345") &&
        fieldValue(invalidHtml, "duration", "30"),
      "Validation failure must preserve the submitted fields.",
    );
    if (expectedServices > 0) {
      const panels = [
        ...invalidHtml.matchAll(/<details\b([^>]*)>([\s\S]*?)<\/details>/g),
      ].map((match) => {
        const summary = match[2].match(
          /<summary\b[^>]*>([\s\S]*?)<\/summary>/,
        )?.[1];
        return {
          open: /(?:^|\s)open(?:\s|=|$)/.test(match[1]),
          serviceSummary:
            summary !== undefined &&
            decodeHtml(summary.replace(/<[^>]+>/g, "")).trim() ===
              "Adicionar outro serviço",
        };
      });
      // React may stream the nested form in a later segment. The visible
      // summary identifies its disclosure independently of segment placement.
      const servicePanels = panels.filter((panel) => panel.serviceSummary);
      const expanded = servicePanels.length === 1 && servicePanels[0].open;
      check(
        expanded,
        "The service form must remain expanded so validation errors are visible.",
      );
    }
    check(
      !(await record("services", invalidId)) &&
        (await count("services")) === expectedServices,
      "Invalid input must not add a service.",
    );
    pass(
      "invalid service retains fields and displays its error without inserting data",
    );
  }
  try {
    phase = "isolated demo authentication";
    const login = await db.auth.signInWithPassword({ email, password });
    check(
      !login.error && login.data.user && cookies.size,
      "Could not establish an isolated demo session.",
    );
    const companies = await db
      .from("companies")
      .select(
        "id,is_demo,plan_id,status,trial_ends_at,booking_enabled,booking_slug",
      );
    check(
      !companies.error &&
        companies.data?.length === 1 &&
        companies.data[0].is_demo === true,
      "Test account must see exactly one explicitly marked demo company.",
    );
    const company = companies.data[0];
    companyId = company.id;
    setupRoute = `/painel/${companyId}/configuracao`;
    check(
      company.status === "active" ||
        (company.status === "trialing" &&
          Date.parse(company.trial_ends_at) > Date.now()),
      "The demo must already allow writes; this test never resets trials or subscriptions.",
    );
    const membership = await db
      .from("memberships")
      .select("role")
      .eq("company_id", companyId)
      .eq("user_id", login.data.user.id)
      .single();
    check(
      !membership.error && membership.data?.role === "OWNER",
      "The guided test requires an existing demo OWNER.",
    );
    const plan = await db
      .from("plans")
      .select("staff_limit")
      .eq("id", company.plan_id)
      .single();
    check(
      !plan.error && Number.isInteger(plan.data?.staff_limit),
      "Could not verify the demo's real professional capacity.",
    );
    const initialServices = await count("services");
    const initialProfessionals = await count("professionals");
    const marker = `Teste guiado fictício ${randomUUID().slice(0, 8)}`;
    pass(
      "isolated session, existing synthetic OWNER and current plan verified",
    );

    const serviceRoute = `${setupRoute}?etapa=servicos`;
    const professionalRoute = `${setupRoute}?etapa=equipe`;
    if (mode === "validation") {
      phase = "validation: loading existing guided form";
      const source = await html(serviceRoute);
      await verifyValidation(source, serviceRoute, initialServices, marker);
      check(
        (await count("professionals")) === initialProfessionals,
        "Validation-only mode must preserve professional records.",
      );
      console.log(
        `${groups} validation-only groups passed. No successful record creation requested; existing demo counts preserved.`,
      );
      return;
    }

    phase = "resume entry and saved progress";
    const started = await destination(await request("/comecar"));
    check(
      started.pathname === setupRoute,
      "An existing owner must resume the guide for the same company.",
    );
    const initialHtml = await html(serviceRoute);
    checkProgress(initialHtml, initialServices, initialProfessionals);
    const originalServiceForm = actionForm(initialHtml, "service");
    const serviceId = String(originalServiceForm.get("record_id"));
    check(
      !(await record("services", serviceId)),
      "A newly rendered form must not reuse an existing service identity.",
    );
    checkProgress(
      await html(`${setupRoute}?etapa=resumo`),
      initialServices,
      initialProfessionals,
    );
    pass(
      "existing-owner entry and progress reflect persisted records without resetting them",
    );

    phase = "anonymous and foreign-company navigation";
    const anonymous = await destination(await request(setupRoute, {}, false));
    check(
      anonymous.pathname === "/entrar",
      "Anonymous setup access must require login.",
    );
    const foreignLogin = await foreignDb.auth.signInWithPassword({
      email: foreignEmail,
      password,
    });
    check(
      !foreignLogin.error && foreignLogin.data.user,
      "Could not verify the second synthetic tenant.",
    );
    const foreignCompanies = await foreignDb
      .from("companies")
      .select("id,is_demo");
    check(
      !foreignCompanies.error &&
        foreignCompanies.data?.length === 1 &&
        foreignCompanies.data[0].is_demo === true &&
        foreignCompanies.data[0].id !== companyId,
      "A distinct demo tenant is required for the isolation check.",
    );
    const foreignCompanyId = foreignCompanies.data[0].id;
    const denied = await destination(
      await request(`/painel/${foreignCompanyId}/configuracao?etapa=servicos`),
    );
    check(
      denied.pathname === "/painel" &&
        denied.searchParams.get("erro") === "acesso",
      "A known foreign company's setup must remain inaccessible.",
    );
    const invisible = await db
      .from("services")
      .select("id")
      .eq("company_id", foreignCompanyId);
    check(
      !invisible.error && invisible.data?.length === 0,
      "The session must not read foreign-company services.",
    );
    pass("anonymous access and known foreign-company setup are denied");

    phase = "guided service save and idempotent retry";
    const saved = await destination(
      await post(serviceRoute, serviceForm(originalServiceForm, marker)),
    );
    check(
      saved.pathname === setupRoute &&
        saved.searchParams.get("etapa") === "equipe",
      "Saving a service must advance to the team step.",
    );
    const savedService = await record("services", serviceId);
    check(
      savedService?.company_id === companyId &&
        savedService.name === marker &&
        savedService.duration_minutes === 30 &&
        savedService.price_cents === 6990,
      "The service must persist exact submitted values in the verified company.",
    );
    check(
      (await count("services")) === initialServices + 1,
      "Saving one service must add exactly one record.",
    );
    const replayed = await destination(
      await post(serviceRoute, serviceForm(originalServiceForm, marker)),
    );
    check(
      replayed.pathname === setupRoute &&
        replayed.searchParams.get("etapa") === "equipe",
      "A retry must continue successfully without requiring another record.",
    );
    check(
      (await count("services")) === initialServices + 1,
      "Replaying the same bound form duplicated the service.",
    );
    pass(
      "Next Server Action saves exact service values and replay creates only one record",
    );

    phase = "pause and reload";
    const paused = await destination(
      await post(
        serviceRoute,
        serviceForm(originalServiceForm, marker, "pause"),
      ),
    );
    check(
      paused.pathname === `/painel/${companyId}` &&
        paused.searchParams.get("configuracao") === "pausada",
      "Continue later must return to the same company's dashboard.",
    );
    const dashboard = await request(`${paused.pathname}${paused.search}`);
    check(
      dashboard.status === 200,
      "Continue later must not loop back into the guide.",
    );
    const resumed = await html(serviceRoute);
    check(
      (await record("services", serviceId))?.name === marker,
      "The saved service must remain persisted after resuming.",
    );
    checkProgress(resumed, initialServices + 1, initialProfessionals);
    check(
      (await count("services")) === initialServices + 1,
      "Pausing must not reinsert an already saved service.",
    );
    pass(
      "continue later reaches dashboard and reload preserves saved service and progress",
    );

    await verifyValidation(resumed, serviceRoute, initialServices + 1, marker);

    phase = "professional capacity or guided save";
    const professionalHtml = await html(professionalRoute);
    let finalProfessionals = initialProfessionals;
    if (initialProfessionals < plan.data!.staff_limit) {
      const professionalForm = actionForm(professionalHtml, "professional");
      const professionalId = String(professionalForm.get("record_id"));
      check(
        !(await record("professionals", professionalId)),
        "A new professional form must have an unused record identity.",
      );
      professionalForm.set("name", `${marker} profissional`);
      professionalForm.set("intent", "next");
      const created = await destination(
        await post(professionalRoute, cloneForm(professionalForm)),
      );
      check(
        created.pathname === setupRoute &&
          created.searchParams.get("etapa") === "resumo",
        "Saving a professional must advance to the summary.",
      );
      const savedProfessional = await record("professionals", professionalId);
      check(
        savedProfessional?.company_id === companyId &&
          savedProfessional.name === `${marker} profissional`,
        "The new fictitious professional must belong to the verified company.",
      );
      const retried = await destination(
        await post(professionalRoute, cloneForm(professionalForm)),
      );
      check(
        retried.pathname === setupRoute &&
          retried.searchParams.get("etapa") === "resumo",
        "Professional retry must remain successful.",
      );
      finalProfessionals += 1;
      check(
        (await count("professionals")) === finalProfessionals,
        "Professional retry must not consume another plan slot.",
      );
      pass(
        "available plan capacity permits one fictitious professional and replay is idempotent",
      );
    } else {
      check(
        professionalHtml.includes("Você já utilizou as vagas do seu plano") &&
          !inputs(professionalHtml).some((input) => input.name === "record_id"),
        "A full plan must explain the capacity limit and omit the add-professional form.",
      );
      // There is deliberately no HTTP form when capacity is exhausted. Verify
      // the independent database guard without inventing a bound action token.
      const professionalId = randomUUID();
      const blocked = await db.from("professionals").insert({
        id: professionalId,
        company_id: companyId,
        name: `${marker} profissional limite`,
      });
      check(
        blocked.error?.message.includes("professional limit reached"),
        "The database must independently reject a professional beyond the current plan limit.",
      );
      check(
        !(await record("professionals", professionalId)) &&
          (await count("professionals")) === initialProfessionals,
        "A full plan must not gain an extra professional.",
      );
      pass(
        "current plan is full: UI and database enforce capacity without an extra professional",
      );
    }

    phase = "summary and unchanged account settings";
    const summary = await html(`${setupRoute}?etapa=resumo`);
    checkProgress(summary, initialServices + 1, finalProfessionals);
    const persistedCompany = await db
      .from("companies")
      .select("plan_id,status,trial_ends_at,booking_enabled,booking_slug")
      .eq("id", companyId)
      .single();
    check(
      !persistedCompany.error && persistedCompany.data,
      "Could not confirm the company's preserved settings.",
    );
    for (const key of [
      "plan_id",
      "status",
      "trial_ends_at",
      "booking_enabled",
      "booking_slug",
    ] as const)
      check(
        persistedCompany.data[key] === company[key],
        "Onboarding must not reset the trial, subscription or publication settings.",
      );
    check(
      (await count("services")) === initialServices + 1 &&
        (await count("professionals")) === finalProfessionals,
      "Final record counts differ from the explicitly created test records.",
    );
    pass(
      "summary reload keeps real progress and preserves trial, plan and publication settings",
    );
    console.log(
      `${groups} live onboarding groups passed. Explicitly fictitious records retained; no users, trials or appointments created. Email delivery and new-account signup were not tested.`,
    );
  } finally {
    // Only invalidate sessions created by this script, never the user's browser.
    await Promise.allSettled([
      db.auth.signOut({ scope: "local" }),
      foreignDb.auth.signOut({ scope: "local" }),
    ]);
    cookies.clear();
  }
}

main().catch((error: unknown) => {
  // Never print response bodies, private URLs, IDs, credentials or SDK errors.
  console.error(`FAIL live onboarding validation during: ${phase}.`);
  if (error instanceof TestFailure) console.error(error.message);
  else {
    const name =
      error instanceof Error &&
      ["TimeoutError", "TypeError", "AbortError"].includes(error.name)
        ? error.name
        : "OtherError";
    console.error(`Native failure category: ${name}.`);
  }
  process.exitCode = 1;
});
