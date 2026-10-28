import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import {
  addDays,
  localAppointmentInstant,
  saoPauloDay,
} from "../src/lib/scheduling";
import { hasAccess } from "../src/lib/permissions";
import { parseCalendarFile } from "../src/lib/calendar-import";

// Explicit DEMO-only import acceptance through real multipart Server Actions.
// Never connects to Google or sends messages. It imports two marked synthetic
// CSV entries as occupied time, without creating customers or appointments.
// Exact source keys and newly created block IDs go to an ignored manifest for
// administrative cleanup. Existing appointments, shifts and profiles stay intact.
const enabled = process.env.TEST_CALENDAR_IMPORT_LIVE === "1";
const remoteEnabled = process.env.TEST_CALENDAR_IMPORT_PRODUCTION === "1";
const requestedOrigin = process.env.TEST_BASE_URL || "http://localhost:3000";
const companyId = "5ed3e808-3608-4c85-905f-75b1ecd32ec2";
const marker = `QA-IMPORT-${randomUUID()}`;
const manifestPath = `test-results/calendar-import-live-${randomUUID()}.json`;
const fixturePath = `test-results/calendar-import-live-${marker}.csv`;
type Session = { db: SupabaseClient; cookies: Map<string, string> };
type Block = {
  id: string;
  professional_id: string | null;
  starts_at: string;
  ends_at: string;
};
let phase = "configuration",
  groups = 0;
class Failure extends Error {}
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Failure(message);
}
const pass = (message: string) => {
  groups++;
  console.log(`PASS calendar import live: ${message}`);
};
const manifest = {
  marker,
  company_id: companyId,
  origin: requestedOrigin,
  professional_id: "",
  day: "",
  fixture_path: fixturePath,
  source_keys: [] as string[],
  block_ids: [] as string[],
  intervals: [] as { starts_at: string; ends_at: string }[],
  started_at: new Date().toISOString(),
  preview_wrote_nothing: false,
  unchanged_existing_data: false,
  groups: 0,
  status: "preparing",
};
async function persist() {
  await mkdir("test-results", { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
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
function actionForm(html: string) {
  const source = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map(([value]) => value)
    .find(
      (value) =>
        value.includes('name="file"') &&
        value.includes('name="professional_id"'),
    );
  check(source, "Real calendar import form is missing.");
  const result = new FormData();
  for (const [tag] of source.matchAll(/<input\b[^>]*>/g)) {
    const input = attributes(tag);
    if (input.type === "hidden" && input.name)
      result.append(input.name, input.value || "");
  }
  check(
    [...result.keys()].some((key) => key.startsWith("$ACTION_")),
    "Import uses a client-only action binding; use the browser acceptance flow, never invent a Server Action ID.",
  );
  return result;
}
function cloneForm(source: FormData) {
  const target = new FormData();
  for (const [key, value] of source) target.append(key, value);
  return target;
}

async function main() {
  check(
    enabled,
    "Set TEST_CALENDAR_IMPORT_LIVE=1 for explicit DEMO import testing.",
  );
  const base = new URL(requestedOrigin);
  check(
    !base.username &&
      !base.password &&
      base.pathname === "/" &&
      !base.search &&
      !base.hash,
    "Use an exact application origin without credentials.",
  );
  check(
    (base.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) ||
      (remoteEnabled && base.origin === "https://webfidelize-saas.vercel.app"),
    "Production requires TEST_CALENDAR_IMPORT_PRODUCTION=1 and the exact Web Fidelize origin.",
  );
  process.loadEnvFile(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const password = process.env.TEST_PLAN_ACCOUNTS_PASSWORD;
  check(url && key && password, "Secure test settings are incomplete.");
  const supabaseOrigin = "https://devmjeiblhrgjyaiaukm.supabase.co";
  check(
    new URL(url).origin === supabaseOrigin,
    "Refusing another database project.",
  );
  const guardedFetch: typeof fetch = async (input, init) => {
    const target = new URL(
      input instanceof Request ? input.url : String(input),
    );
    check(
      target.origin === supabaseOrigin && !target.username && !target.password,
      "Refusing an unrelated database origin.",
    );
    try {
      return await fetch(input, {
        ...init,
        redirect: "manual",
        signal: init?.signal || AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Failure("Authorized database request failed.");
    }
  };
  function session(): Session {
    const cookies = new Map<string, string>();
    return {
      cookies,
      db: createServerClient(url!, key!, {
        global: { fetch: guardedFetch },
        auth: { autoRefreshToken: false },
        cookies: {
          getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
          setAll: (items) => {
            for (const { name, value, options } of items)
              value && options.maxAge !== 0
                ? cookies.set(name, value)
                : cookies.delete(name);
          },
        },
      }),
    };
  }
  const owner = session(),
    employee = session();
  const route = `/painel/${companyId}/agenda/importar`;
  async function request(
    actor: Session | undefined,
    form?: FormData,
    path = route,
  ) {
    const target = new URL(path, base);
    check(
      target.origin === base.origin,
      "Never transfer an application session across origins.",
    );
    return fetch(target, {
      method: form ? "POST" : "GET",
      body: form,
      redirect: "manual",
      signal: AbortSignal.timeout(45_000),
      headers: {
        Accept: "text/html",
        ...(actor
          ? {
              Cookie: [...actor.cookies]
                .map(([name, value]) => `${name}=${value}`)
                .join("; "),
            }
          : {}),
        ...(form ? { Origin: base.origin, Referer: target.toString() } : {}),
      },
    });
  }
  async function denied(response: Response) {
    let location = response.headers.get("location");
    if (!location && response.status === 200) {
      const html = await response.text();
      location =
        [...html.matchAll(/<meta\b[^>]*>/g)]
          .map(([tag]) => attributes(tag))
          .find((tag) => tag.id === "__next-page-redirect")
          ?.content?.match(/^[01];url=(.*)$/)?.[1] || null;
    }
    if (location) {
      const target = new URL(location, base);
      check(
        target.origin === base.origin &&
          ["/entrar", "/painel", `/painel/${companyId}`].includes(
            target.pathname,
          ),
        "Unexpected authorization redirect.",
      );
      await response.body?.cancel().catch(() => undefined);
      return true;
    }
    return [401, 403, 404].includes(response.status);
  }
  async function blocks() {
    const result = await owner.db
      .from("schedule_blocks")
      .select("id,professional_id,starts_at,ends_at")
      .eq("company_id", companyId)
      .order("id")
      .limit(1001);
    check(
      !result.error && result.data && result.data.length < 1001,
      "Could not take a complete DEMO block snapshot.",
    );
    return result.data as Block[];
  }
  async function businessSnapshot() {
    const [appointments, customers, availability] = await Promise.all([
      owner.db
        .from("appointments")
        .select(
          "id,status,starts_at,ends_at,customer_id,service_id,professional_id",
        )
        .eq("company_id", companyId)
        .order("id")
        .limit(1001),
      owner.db
        .from("customers")
        .select("id", { head: true, count: "exact" })
        .eq("company_id", companyId),
      owner.db
        .from("availability")
        .select("id,professional_id,weekday,start_minute,end_minute")
        .eq("company_id", companyId)
        .order("id")
        .limit(1001),
    ]);
    check(
      !appointments.error &&
        !customers.error &&
        !availability.error &&
        appointments.data &&
        availability.data &&
        appointments.data.length < 1001 &&
        availability.data.length < 1001,
      "Existing DEMO business snapshot failed.",
    );
    return JSON.stringify({
      appointments: appointments.data,
      customers: customers.count,
      availability: availability.data,
    });
  }
  let originalBlocks: Block[] = [],
    before = "",
    verified = false;
  try {
    phase = "verify academy DEMO owner and employee";
    for (const [actor, email, role] of [
      [owner, "academia@example.invalid", "OWNER"],
      [employee, "essencial.colaborador@example.invalid", "EMPLOYEE"],
    ] as const) {
      const login = await actor.db.auth.signInWithPassword({ email, password });
      check(
        !login.error && login.data.user?.email === email,
        "Expected synthetic account login failed.",
      );
      const member = await actor.db
        .from("memberships")
        .select("role")
        .eq("company_id", companyId)
        .eq("user_id", login.data.user.id)
        .single();
      check(
        !member.error && member.data?.role === role,
        "Expected synthetic membership role is absent.",
      );
    }
    const company = await owner.db
      .from("companies")
      .select("is_demo,booking_slug,status,trial_ends_at")
      .eq("id", companyId)
      .single();
    check(
      !company.error &&
        company.data?.is_demo &&
        company.data.booking_slug === "demo-academia" &&
        hasAccess(company.data.status, company.data.trial_ends_at),
      "Import target must remain an enabled existing academy DEMO.",
    );
    const employeeIdentity = await employee.db.auth.getUser();
    check(employeeIdentity.data.user, "Employee identity must be verified.");
    const professional = await owner.db
      .from("professionals")
      .select("id")
      .eq("company_id", companyId)
      .eq("user_id", employeeIdentity.data.user.id)
      .is("archived_at", null)
      .single();
    check(
      !professional.error && professional.data,
      "Active assigned DEMO professional is missing.",
    );
    manifest.professional_id = professional.data.id;
    originalBlocks = await blocks();
    before = await businessSnapshot();
    verified = true;
    const pageResponse = await request(owner);
    check(pageResponse.status === 200, "Owner import page did not load.");
    const boundForm = actionForm(await pageResponse.text());
    check(
      await denied(await request(employee)),
      "Employee must not access the import page.",
    );
    check(
      await denied(await request(undefined)),
      "Anonymous import must require login.",
    );
    pass(
      "existing DEMO owner/employee verified; owner form available and unauthorized routes blocked",
    );

    phase = "choose two unoccupied synthetic CSV intervals";
    let day = "";
    const accessUntil =
      company.data.status === "active"
        ? Infinity
        : Date.parse(company.data.trial_ends_at);
    for (let offset = 1; offset <= 7 && !day; offset++) {
      const candidate = addDays(saoPauloDay(), offset);
      const start = localAppointmentInstant(candidate, "19:00")!;
      const end = localAppointmentInstant(candidate, "20:00")!;
      if (Date.parse(end) >= accessUntil) continue;
      const [appointments, classes] = await Promise.all([
        owner.db
          .from("appointments")
          .select("id")
          .eq("company_id", companyId)
          .eq("professional_id", professional.data.id)
          .neq("status", "canceled")
          .lt("starts_at", end)
          .gt("ends_at", start),
        owner.db
          .from("class_sessions")
          .select("id")
          .eq("company_id", companyId)
          .eq("professional_id", professional.data.id)
          .neq("status", "canceled")
          .lt("starts_at", end)
          .gt("ends_at", start),
      ]);
      check(
        !appointments.error && !classes.error,
        "Existing intervals could not be inspected safely.",
      );
      if (
        !appointments.data?.length &&
        !classes.data?.length &&
        !originalBlocks.some(
          (item) =>
            (!item.professional_id ||
              item.professional_id === professional.data.id) &&
            Date.parse(item.starts_at) < Date.parse(end) &&
            Date.parse(item.ends_at) > Date.parse(start),
        )
      )
        day = candidate;
    }
    check(
      day,
      "No unoccupied evening interval exists inside DEMO access; nothing imported.",
    );
    manifest.day = day;
    const csv = `title,start,end,id\n${marker} A,${day}T19:00:00-03:00,${day}T19:30:00-03:00,${marker}-a\n${marker} B,${day}T19:30:00-03:00,${day}T20:00:00-03:00,${marker}-b\n`;
    const parsed = parseCalendarFile(csv, "csv", {
      from: day,
      to: day,
      timezone: "America/Sao_Paulo",
      dateOrder: "iso",
    });
    check(
      !parsed.error && parsed.entries.length === 2 && parsed.issueCount === 0,
      "Synthetic CSV must contain exactly two valid entries.",
    );
    manifest.source_keys = parsed.entries.map((item) => item.source_key);
    manifest.intervals = parsed.entries.map(({ starts_at, ends_at }) => ({
      starts_at,
      ends_at,
    }));
    await persist();
    await writeFile(fixturePath, csv, { encoding: "utf8", mode: 0o600 });
    function multipart(intent: "preview" | "import", confirmed = false) {
      const form = cloneForm(boundForm);
      form.set("file", new File([csv], `${marker}.csv`, { type: "text/csv" }));
      for (const [name, value] of Object.entries({
        from: day,
        to: day,
        timezone: "America/Sao_Paulo",
        date_order: "iso",
        professional_id: professional.data!.id,
        intent,
        columns: JSON.stringify(parsed.columns),
        mappings: "{}",
        selection_initialized: "no",
      }))
        form.set(name, value);
      if (confirmed) form.set("confirm_import", "yes");
      else form.delete("confirm_import");
      return form;
    }
    phase = "multipart preview must leave no database rows";
    const preview = await request(owner, multipart("preview"));
    check(
      preview.status === 200,
      "Import preview did not return its real form response.",
    );
    const previewHtml = await preview.text();
    check(
      previewHtml.includes("Prévia conferida. Nada foi salvo") &&
        previewHtml.includes(`${marker} A`) &&
        previewHtml.includes(`${marker} B`),
      "Expected two-event preview and safe message were not rendered.",
    );
    check(
      JSON.stringify(await blocks()) === JSON.stringify(originalBlocks) &&
        (await businessSnapshot()) === before,
      "Preview created or changed business data.",
    );
    manifest.preview_wrote_nothing = true;
    await persist();
    pass(
      "real multipart CSV preview renders both events and leaves blocks, appointments, customers and shifts unchanged",
    );

    phase = "confirmation and employee mutation guards";
    const withoutConfirmation = await request(owner, multipart("import"));
    check(
      withoutConfirmation.status === 200 &&
        (await withoutConfirmation.text()).includes(
          "Confirme a seleção antes de importar",
        ),
      "Import without confirmation was not rejected.",
    );
    check(
      await denied(await request(employee, multipart("import", true))),
      "Employee replay of owner import action was not rejected.",
    );
    const directEmployee = await employee.db.rpc("import_calendar_entries", {
      p_company: companyId,
      p_dry_run: false,
      p_items: parsed.entries.map((item) => ({
        source_key: item.source_key,
        professional_id: professional.data.id,
        starts_at: item.starts_at,
        ends_at: item.ends_at,
        kind: "block",
        customer_id: null,
        service_id: null,
      })),
    });
    check(
      Boolean(directEmployee.error),
      "Employee direct import RPC must be denied.",
    );
    check(
      JSON.stringify(await blocks()) === JSON.stringify(originalBlocks),
      "Rejected confirmation/employee requests changed blocks.",
    );
    pass(
      "explicit confirmation and owner permission enforced by server action and database",
    );

    phase = "confirmed batch imports exactly two blocks";
    const committed = await request(owner, multipart("import", true));
    check(
      committed.status === 200,
      "Import confirmation did not return the actual form state.",
    );
    const committedHtml = await committed.text();
    check(
      committedHtml.includes(
        "2 horário(s) importado(s). 0 já importado(s) anteriormente",
      ),
      "Expected two committed events were not confirmed.",
    );
    const originalIds = new Set(originalBlocks.map((item) => item.id));
    const after = await blocks();
    const created = after.filter((item) => !originalIds.has(item.id));
    check(
      created.length === 2 &&
        created.every(
          (item) =>
            item.professional_id === professional.data.id &&
            manifest.intervals.some(
              (interval) =>
                Date.parse(interval.starts_at) === Date.parse(item.starts_at) &&
                Date.parse(interval.ends_at) === Date.parse(item.ends_at),
            ),
        ),
      "New blocks do not exactly match the two selected intervals.",
    );
    manifest.block_ids = created.map((item) => item.id);
    await persist();
    const stored = await owner.db
      .from("schedule_blocks")
      .select("id,reason")
      .eq("company_id", companyId)
      .in("id", manifest.block_ids);
    check(
      !stored.error &&
        stored.data?.length === 2 &&
        stored.data.every((item) => item.reason === "Compromisso importado"),
      "External titles must not be stored in the shared agenda.",
    );
    check(
      (await businessSnapshot()) === before,
      "Import fabricated or changed customers, appointments or availability.",
    );
    pass(
      "confirmed upload creates exactly two occupied intervals with generic titles and no synthetic customer/revenue records",
    );

    phase = "retry is duplicate-safe";
    const repeated = await request(owner, multipart("import", true));
    check(
      repeated.status === 200 &&
        (await repeated.text()).includes(
          "0 horário(s) importado(s). 2 já importado(s) anteriormente",
        ),
      "Repeated import must report its two existing sources without creating new blocks.",
    );
    check(
      JSON.stringify(await blocks()) === JSON.stringify(after),
      "Repeated import duplicated or changed occupancy.",
    );
    const oldAfter = (await blocks()).filter((item) =>
      originalIds.has(item.id),
    );
    check(
      JSON.stringify(oldAfter) === JSON.stringify(originalBlocks) &&
        (await businessSnapshot()) === before,
      "Pre-existing business data changed during import test.",
    );
    manifest.unchanged_existing_data = true;
    const agenda = await request(
      owner,
      undefined,
      `/painel/${companyId}/agenda?day=${day}`,
    );
    check(
      agenda.status === 200 &&
        (await agenda.text()).includes("Compromisso importado"),
      "Imported occupancy did not appear in the real agenda.",
    );
    pass(
      "retry reports two duplicates, agenda displays occupied time, and every pre-existing record remains unchanged",
    );
    manifest.status = "passed";
  } finally {
    if (verified) {
      try {
        const originalIds = new Set(originalBlocks.map((item) => item.id));
        const recovered = (await blocks()).filter(
          (item) =>
            !originalIds.has(item.id) &&
            item.professional_id === manifest.professional_id &&
            manifest.intervals.some(
              (interval) =>
                Date.parse(interval.starts_at) === Date.parse(item.starts_at) &&
                Date.parse(interval.ends_at) === Date.parse(item.ends_at),
            ),
        );
        manifest.block_ids = [
          ...new Set([
            ...manifest.block_ids,
            ...recovered.map((item) => item.id),
          ]),
        ];
        manifest.unchanged_existing_data =
          (await businessSnapshot()) === before;
      } catch {
        manifest.unchanged_existing_data = false;
      }
      if (manifest.status !== "passed")
        manifest.status = "incomplete-needs-exact-qa-cleanup";
      manifest.groups = groups;
      await persist();
      console.log(
        `QA manifest: ${manifestPath}; exact blocks=${manifest.block_ids.length}, source keys=${manifest.source_keys.length}.`,
      );
    }
    await Promise.allSettled(
      [owner, employee].map((actor) =>
        actor.db.auth.signOut({ scope: "local" }),
      ),
    );
  }
  console.log(
    `${groups} calendar import live groups passed; exact QA cleanup manifest saved. No messages, payments or external calendar modifications.`,
  );
}
main().catch((error: unknown) => {
  console.error(
    `FAIL calendar import live (${phase}): ${error instanceof Failure ? error.message : "Unexpected failure; details withheld to protect credentials."}`,
  );
  process.exitCode = 1;
});
