import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHmac, randomInt, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { addDays, appointmentTime, saoPauloDay } from "../src/lib/scheduling";
import { hasAccess } from "../src/lib/permissions";
import { readClassReceipt } from "../src/lib/class-receipt";

// Explicit DEMO-only live acceptance. This script creates a marked class and
// synthetic registrations, then cancels its own class. It never changes plans,
// availability, existing appointments, other classes, permissions or users.
// The final ignored manifest lists exact QA rows for administrative cleanup.
// No email, WhatsApp, external calendar, AI or payment request is made.
const enabled = process.env.TEST_CLASSES_LIVE === "1";
const remoteEnabled = process.env.TEST_CLASSES_PRODUCTION === "1";
const requestedOrigin = process.env.TEST_BASE_URL || "http://localhost:3000";
const companyId = "3f259c2b-27aa-4e64-9c81-443deb1d66b2";
const foreignCompanyId = "5ed3e808-3608-4c85-905f-75b1ecd32ec2";
const slug = "demo-salao";
const marker = `QA-TURMAS-${randomUUID()}`;
const manifestPath = `test-results/classes-live-${randomUUID()}.json`;
let phase = "configuration",
  groups = 0;
class Failure extends Error {}
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Failure(message);
}
const pass = (message: string) => {
  groups++;
  console.log(`PASS classes live: ${message}`);
};
type Session = { db: SupabaseClient; cookies: Map<string, string> };
const manifest = {
  marker,
  companyId,
  slug,
  origin: requestedOrigin,
  started_at: new Date().toISOString(),
  class_ids: [] as string[],
  registration_ids: [] as string[],
  customer_ids: [] as string[],
  public_request_ids: [] as string[],
  internal_request_ids: [] as string[],
  synthetic_names: [] as string[],
  synthetic_phones: [] as string[],
  groups: 0,
  status: "preparing",
  class_canceled: false,
  unchanged_existing_data: false,
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
    [...tag.matchAll(/([\w$:-]+)\s*=\s*"([^"]*)"/g)].map((item) => [
      item[1],
      decode(item[2]),
    ]),
  );
function actionForm(html: string, matches: (source: string) => boolean) {
  const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map(([form]) => form)
    .filter(matches);
  check(forms.length === 1, "Expected one real class Server Action form.");
  const body = new FormData();
  for (const [tag] of forms[0].matchAll(/<input\b[^>]*>/g)) {
    const input = attributes(tag);
    if (input.type === "hidden" && input.name)
      body.append(input.name, input.value || "");
  }
  check(
    [...body.keys()].some((key) => key.startsWith("$ACTION_")),
    "Server Action binding is missing.",
  );
  return body;
}
function cloneForm(source: FormData) {
  const target = new FormData();
  for (const [key, value] of source) target.append(key, value);
  return target;
}
function syntheticContact(index: number) {
  const name = `${marker} participante ${index}`;
  // Invalid DDD 00 cannot address a real WhatsApp recipient; no consent is issued.
  const phone = `000${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
  manifest.synthetic_names.push(name);
  manifest.synthetic_phones.push(phone);
  return { name, phone };
}

async function main() {
  check(enabled, "Set TEST_CLASSES_LIVE=1 for explicit DEMO class testing.");
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
    "Production requires TEST_CLASSES_PRODUCTION=1 and the exact stable Web Fidelize origin.",
  );
  process.loadEnvFile(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const password = process.env.TEST_PLAN_ACCOUNTS_PASSWORD;
  const secret = process.env.BOOKING_GATEWAY_SECRET;
  check(
    url && key && password && secret,
    "Secure test settings are incomplete.",
  );
  const supabaseOrigin = "https://devmjeiblhrgjyaiaukm.supabase.co";
  check(
    new URL(url).origin === supabaseOrigin,
    "Refusing an unrelated Supabase project.",
  );
  const guardedFetch: typeof fetch = async (input, init) => {
    const target = new URL(
      input instanceof Request ? input.url : String(input),
    );
    check(
      target.origin === supabaseOrigin && !target.username && !target.password,
      "Refusing credential transfer to an unrelated origin.",
    );
    try {
      return await fetch(input, {
        ...init,
        redirect: "manual",
        signal: init?.signal || AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Failure("The authorized database request could not complete.");
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
    employee = session(),
    outsider = session();
  const publicDb = createClient(url, key, {
    global: { fetch: guardedFetch },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const route = `/painel/${companyId}/turmas`;
  const publicRoute = `/agendar/${slug}/turmas`;
  async function request(
    path: string,
    actor?: Session,
    body?: FormData,
    origin = base.origin,
  ) {
    const target = new URL(path, base);
    check(
      target.origin === base.origin && !target.username && !target.password,
      "Application session must remain on the configured origin.",
    );
    return fetch(target, {
      method: body ? "POST" : "GET",
      body,
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
        ...(body ? { Origin: origin, Referer: target.toString() } : {}),
      },
    });
  }
  async function redirectLocation(response: Response) {
    let location = response.headers.get("location");
    if (!location && response.status === 200) {
      const html = await response.text();
      location =
        [...html.matchAll(/<meta\b[^>]*>/g)]
          .map(([tag]) => attributes(tag))
          .find((meta) => meta.id === "__next-page-redirect")
          ?.content?.match(/^[01];url=(.*)$/)?.[1] || null;
    }
    check(location, "Expected a confirmed action redirect.");
    const target = new URL(location, base);
    check(
      target.origin === base.origin,
      "Action redirected outside the authorized origin.",
    );
    await response.body?.cancel().catch(() => undefined);
    return target;
  }
  async function page(path: string, actor?: Session) {
    const response = await request(path, actor);
    check(response.status === 200, "Expected class page did not load.");
    return response.text();
  }
  async function existingSnapshot() {
    const [classes, appointments] = await Promise.all([
      owner.db
        .from("class_sessions")
        .select("id,version,status,starts_at,ends_at,capacity,is_public")
        .eq("company_id", companyId)
        .neq("title", marker)
        .order("id")
        .limit(1001),
      owner.db
        .from("appointments")
        .select(
          "id,status,starts_at,ends_at,customer_id,service_id,professional_id",
        )
        .eq("company_id", companyId)
        .order("id")
        .limit(1001),
    ]);
    check(
      !classes.error &&
        !appointments.error &&
        classes.data &&
        appointments.data &&
        classes.data.length < 1001 &&
        appointments.data.length < 1001,
      "Cannot safely snapshot existing DEMO records.",
    );
    return JSON.stringify({
      classes: classes.data,
      appointments: appointments.data,
    });
  }
  let classId = "",
    previousSnapshot = "",
    loggedIn = false;
  try {
    phase = "verify existing DEMO accounts";
    const accounts = [
      [owner, "salao@example.invalid", companyId, "OWNER"],
      [
        employee,
        "empresarial.colaborador@example.invalid",
        companyId,
        "EMPLOYEE",
      ],
      [outsider, "academia@example.invalid", foreignCompanyId, "OWNER"],
    ] as const;
    for (const [actor, email, tenant, role] of accounts) {
      const login = await actor.db.auth.signInWithPassword({ email, password });
      check(
        !login.error && login.data.user?.email === email,
        "Expected synthetic account login failed.",
      );
      const member = await actor.db
        .from("memberships")
        .select("role")
        .eq("company_id", tenant)
        .eq("user_id", login.data.user.id)
        .single();
      check(
        !member.error && member.data?.role === role,
        "Synthetic role differs from the expected fixture.",
      );
    }
    loggedIn = true;
    const company = await owner.db
      .from("companies")
      .select("id,is_demo,booking_slug,booking_enabled,status,trial_ends_at")
      .eq("id", companyId)
      .single();
    const foreignCompany = await outsider.db
      .from("companies")
      .select("is_demo,booking_slug")
      .eq("id", foreignCompanyId)
      .single();
    check(
      !company.error &&
        company.data?.is_demo &&
        company.data.booking_slug === slug &&
        company.data.booking_enabled &&
        hasAccess(company.data.status, company.data.trial_ends_at),
      "The target must be an existing enabled DEMO company with access.",
    );
    check(
      !foreignCompany.error &&
        foreignCompany.data?.is_demo &&
        foreignCompany.data.booking_slug === "demo-academia",
      "Isolation account must belong to the existing academy DEMO.",
    );
    const employeeUser = await employee.db.auth.getUser();
    check(employeeUser.data.user, "Employee identity not verified.");
    const professional = await owner.db
      .from("professionals")
      .select("id,name")
      .eq("company_id", companyId)
      .eq("user_id", employeeUser.data.user.id)
      .is("archived_at", null)
      .single();
    const serviceResult = await owner.db
      .from("services")
      .select("id,name,duration_minutes")
      .eq("company_id", companyId)
      .is("archived_at", null)
      .order("duration_minutes")
      .limit(1)
      .single();
    check(
      !professional.error &&
        professional.data &&
        !serviceResult.error &&
        serviceResult.data,
      "The existing DEMO professional and service are required.",
    );
    const service = serviceResult.data;
    previousSnapshot = await existingSnapshot();
    await persist();
    pass(
      "existing salon owner/employee and academy outsider verified without changing access",
    );

    phase = "find an existing free professional slot";
    let selected: { day: string; start: string } | null = null;
    const accessUntil =
      company.data.status === "active"
        ? Infinity
        : Date.parse(company.data.trial_ends_at);
    for (let offset = 1; offset <= 7 && !selected; offset++) {
      const day = addDays(saoPauloDay(), offset);
      const slots = await publicDb.rpc("public_slots", {
        slug,
        service: service.id,
        professional: professional.data.id,
        day,
      });
      check(!slots.error, "Existing public availability could not be read.");
      const slot = (slots.data as { starts_at: string }[] | null)?.find(
        (item) =>
          Date.parse(item.starts_at) > Date.now() + 3_600_000 &&
          Date.parse(item.starts_at) + service.duration_minutes * 60_000 <
            accessUntil,
      );
      if (slot) selected = { day, start: slot.starts_at };
    }
    check(
      selected,
      "No existing free DEMO slot within its valid access; nothing was changed.",
    );
    const listing = await page(`${route}?day=${selected.day}`, owner);
    const create = actionForm(
      listing,
      (source) =>
        source.includes('name="title"') && source.includes('name="capacity"'),
    );
    for (const [name, value] of Object.entries({
      service: service.id,
      professional: professional.data.id,
      title: marker,
      day: selected.day,
      time: appointmentTime(selected.start),
      capacity: "3",
      is_public: "on",
    }))
      create.set(name, value);
    phase = "create class through owner form";
    const created = await redirectLocation(
      await request(`${route}?day=${selected.day}`, owner, create),
    );
    check(
      created.pathname.startsWith(`${route}/`) &&
        created.searchParams.get("salvo") === "turma",
      "Class creation was not confirmed.",
    );
    classId = created.pathname.split("/").at(-1)!;
    manifest.class_ids.push(classId);
    await persist();
    const detail = `${route}/${classId}`;
    let current = await owner.db
      .from("class_sessions")
      .select("id,title,capacity,version,professional_id,status")
      .eq("company_id", companyId)
      .eq("id", classId)
      .single();
    check(
      !current.error &&
        current.data?.title === marker &&
        current.data.capacity === 3 &&
        current.data.professional_id === professional.data.id,
      "Created class does not match its authorized fields.",
    );
    const edit = actionForm(
      await page(detail, owner),
      (source) =>
        source.includes('name="title"') && source.includes('name="capacity"'),
    );
    for (const [name, value] of Object.entries({
      service: service.id,
      professional: professional.data.id,
      title: marker,
      day: selected.day,
      time: appointmentTime(selected.start),
      capacity: "2",
      is_public: "on",
    }))
      edit.set(name, value);
    await redirectLocation(await request(detail, owner, edit));
    current = await owner.db
      .from("class_sessions")
      .select("id,title,capacity,version,professional_id,status")
      .eq("company_id", companyId)
      .eq("id", classId)
      .single();
    check(
      current.data?.capacity === 2 && current.data.version === 2,
      "Owner edit did not persist capacity/version.",
    );
    const occupiedSlot = await publicDb.rpc("public_slots", {
      slug,
      service: service.id,
      professional: professional.data.id,
      day: selected.day,
    });
    check(
      !occupiedSlot.error &&
        !(occupiedSlot.data as { starts_at: string }[]).some(
          (item) => Date.parse(item.starts_at) === Date.parse(selected.start),
        ),
      "Class did not remove its interval from individual availability.",
    );
    pass(
      "owner forms create/edit capacity and individual availability excludes the class interval",
    );

    phase = "employee and outsider route authorization";
    const employeeHtml = await page(detail, employee);
    check(
      employeeHtml.includes(marker) &&
        !employeeHtml.includes('name="capacity"') &&
        !employeeHtml.includes('name="customer"'),
      "Employee sees unexpected management forms.",
    );
    const deniedEdit = await redirectLocation(
      await request(detail, employee, edit),
    );
    check(
      deniedEdit.searchParams.get("erro") === "permissao",
      "Employee owner-form replay must be rejected before writes.",
    );
    const outsiderClasses = await outsider.db
      .from("class_sessions")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", classId);
    check(
      !outsiderClasses.error && outsiderClasses.data?.length === 0,
      "Foreign tenant can see the class.",
    );
    const outsiderPage = await redirectLocation(
      await request(detail, outsider),
    );
    check(
      outsiderPage.pathname === "/painel",
      "Foreign route must return to its authorized panel.",
    );
    const anonPage = await redirectLocation(await request(detail));
    check(
      anonPage.pathname === "/entrar",
      "Anonymous class management must require login.",
    );
    pass(
      "employee and outsider cannot replay management forms or read another company",
    );

    phase = "public booking and stored receipt";
    const publicPath = `${publicRoute}?${new URLSearchParams({ day: selected.day, turma: classId })}`;
    const publicHtml = await page(publicPath);
    check(
      publicHtml.includes(marker) &&
        !publicHtml.includes("empresarial.colaborador@example.invalid"),
      "Public catalog leaks an account identity or omits the class.",
    );
    const reserve = actionForm(
      publicHtml,
      (source) =>
        source.includes('name="customer_name"') &&
        source.includes('name="session"'),
    );
    const first = syntheticContact(0);
    const requestId = String(reserve.get("request_id"));
    manifest.public_request_ids.push(requestId);
    await persist();
    reserve.set("customer_name", first.name);
    reserve.set("phone", first.phone);
    reserve.set("website", "");
    const deniedConsent = await request(
      publicPath,
      undefined,
      cloneForm(reserve),
    );
    check(
      deniedConsent.status === 200 &&
        (await deniedConsent.text()).includes("autorização de uso dos dados"),
      "Missing public consent must reject the request.",
    );
    const none = await owner.db
      .from("class_registrations")
      .select("id", { head: true, count: "exact" })
      .eq("company_id", companyId)
      .eq("class_session_id", classId);
    check(
      !none.error && none.count === 0,
      "Missing consent created a registration.",
    );
    reserve.set("consent", "on");
    const receiptUrl = await redirectLocation(
      await request(publicPath, undefined, cloneForm(reserve)),
    );
    const token = receiptUrl.searchParams.get("recibo");
    check(
      token && readClassReceipt(token, slug, secret) === requestId,
      "Signed receipt capability does not match its request.",
    );
    check(
      (await page(receiptUrl.pathname + receiptUrl.search)).includes(
        "Sua vaga está confirmada",
      ),
      "Stored reservation confirmation not rendered.",
    );
    const repeated = await redirectLocation(
      await request(publicPath, undefined, cloneForm(reserve)),
    );
    check(
      repeated.searchParams.get("recibo") === token,
      "Repeated identical form did not return the same receipt.",
    );
    const registrations = await owner.db
      .from("class_registrations")
      .select("id,customer_id,status")
      .eq("company_id", companyId)
      .eq("class_session_id", classId);
    check(
      !registrations.error &&
        registrations.data?.length === 1 &&
        registrations.data[0].status === "reserved",
      "Form retry duplicated a seat.",
    );
    manifest.registration_ids.push(registrations.data[0].id);
    manifest.customer_ids.push(registrations.data[0].customer_id);
    await persist();
    const invalid = await page(
      `${publicRoute}?recibo=${requestId}.${"0".repeat(64)}`,
    );
    check(
      !invalid.includes("Sua vaga está confirmada") &&
        invalid.includes("Não foi possível confirmar"),
      "Forged receipt was shown as confirmed.",
    );
    const prematureAttendance = await employee.db.rpc(
      "manage_class_registration",
      {
        p_company: companyId,
        p_registration: registrations.data[0].id,
        p_version: 1,
        p_action: "attend",
      },
    );
    check(
      prematureAttendance.error?.message.includes("class has not started"),
      "Future attendance must be rejected by the database.",
    );
    pass(
      "public consent, real form, signed stored receipt, duplicate retry and future attendance guards",
    );

    phase = "cancel one enrollment through owner form";
    const cancelFirst = actionForm(await page(detail, owner), (source) =>
      source.includes("Cancelar inscrição"),
    );
    cancelFirst.set("confirm_action", "yes");
    await redirectLocation(await request(detail, owner, cancelFirst));
    check(
      (await page(receiptUrl.pathname + receiptUrl.search)).includes(
        "Inscrição cancelada",
      ),
      "Receipt did not follow authoritative cancellation.",
    );
    pass("owner cancellation releases a seat and updates the existing receipt");

    phase = "real concurrent capacity reservation";
    const contenders = [1, 2, 3].map((index) => ({
      ...syntheticContact(index),
      request: randomUUID(),
    }));
    manifest.public_request_ids.push(...contenders.map((item) => item.request));
    await persist();
    const ipHash = createHmac("sha256", secret)
      .update(`class-qa:${marker}`)
      .digest("hex");
    const race = await Promise.all(
      contenders.map((item) =>
        publicDb.rpc("submit_public_class_booking", {
          p_slug: slug,
          p_session: classId,
          p_customer_name: item.name,
          p_phone: item.phone,
          p_request_id: item.request,
          p_gateway_secret: secret,
          p_ip_hash: ipHash,
        }),
      ),
    );
    check(
      race.filter((item) => !item.error).length === 2 &&
        race.filter((item) => item.error?.message.includes("class full"))
          .length === 1,
      "Capacity-two class did not admit exactly two of three simultaneous reservations.",
    );
    const full = await owner.db
      .from("class_registrations")
      .select("id,customer_id,status")
      .eq("company_id", companyId)
      .eq("class_session_id", classId)
      .neq("status", "canceled");
    check(
      !full.error && full.data?.length === 2,
      "Concurrent reservation oversold or lost an accepted seat.",
    );
    const winner = contenders[race.findIndex((item) => !item.error)];
    const replay = await publicDb.rpc("submit_public_class_booking", {
      p_slug: slug,
      p_session: classId,
      p_customer_name: winner.name,
      p_phone: winner.phone,
      p_request_id: winner.request,
      p_gateway_secret: secret,
      p_ip_hash: ipHash,
    });
    check(
      !replay.error &&
        replay.data === race[race.findIndex((item) => !item.error)].data,
      "Concurrent winner retry did not preserve its original enrollment.",
    );
    const publicList = await publicDb.rpc("public_classes", {
      p_slug: slug,
      p_day: selected.day,
    });
    check(
      !publicList.error &&
        (publicList.data as { id: string; remaining: number }[]).find(
          (item) => item.id === classId,
        )?.remaining === 0,
      "Public capacity did not reflect the two accepted seats.",
    );
    const publicFull = await page(publicPath);
    check(
      publicFull.includes("Lotada") &&
        !publicFull.includes('name="customer_name"'),
      "Full class must not render an available reservation form.",
    );
    pass(
      "three simultaneous real database requests yield exactly two seats; retry and public capacity stay consistent",
    );

    phase = "employee roster and adding an existing customer";
    const employeeRoster = await employee.db
      .from("class_registrations")
      .select("id,customers(name)")
      .eq("company_id", companyId)
      .eq("class_session_id", classId)
      .neq("status", "canceled");
    check(
      !employeeRoster.error &&
        employeeRoster.data?.length === 2 &&
        employeeRoster.data.every((item) => Boolean(item.customers)),
      "Assigned employee roster or customer-name RLS is broken.",
    );
    const foreignRoster = await outsider.db
      .from("class_registrations")
      .select("id")
      .eq("company_id", companyId)
      .eq("class_session_id", classId);
    check(
      !foreignRoster.error && foreignRoster.data?.length === 0,
      "Foreign tenant can read the roster.",
    );
    const ownerHtml = await page(detail, owner);
    const cancelCandidates = [
      ...ownerHtml.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g),
    ]
      .map(([source]) => source)
      .filter((source) => source.includes("Cancelar inscrição"));
    check(
      cancelCandidates.length === 2,
      "Expected two cancellable reserved QA participants.",
    );
    const cancelWinner = actionForm(cancelCandidates[0], () => true);
    cancelWinner.set("confirm_action", "yes");
    await redirectLocation(await request(detail, owner, cancelWinner));
    const addExisting = actionForm(
      await page(`${detail}?cliente=${encodeURIComponent(first.name)}`, owner),
      (source) =>
        source.includes('name="customer"') &&
        source.includes('name="request_id"'),
    );
    manifest.internal_request_ids.push(String(addExisting.get("request_id")));
    await persist();
    addExisting.set("customer", registrations.data[0].customer_id);
    await redirectLocation(await request(detail, owner, addExisting));
    const rejoined = await owner.db
      .from("class_registrations")
      .select("id,status")
      .eq("company_id", companyId)
      .eq("class_session_id", classId)
      .eq("customer_id", registrations.data[0].customer_id)
      .eq("status", "reserved");
    check(
      !rejoined.error && rejoined.data?.length === 1,
      "Existing client was not added through the actual roster form.",
    );
    pass(
      "assigned employee sees authorized roster; outsider sees none; owner adds an existing client through the form",
    );

    phase = "cancel QA class and preserve individual scheduling";
    const classCancel = actionForm(await page(detail, owner), (source) =>
      source.includes("Cancelar turma"),
    );
    classCancel.set("confirm_action", "yes");
    await redirectLocation(await request(detail, owner, classCancel));
    const finalClass = await owner.db
      .from("class_sessions")
      .select("status")
      .eq("company_id", companyId)
      .eq("id", classId)
      .single();
    const activeRegistrations = await owner.db
      .from("class_registrations")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("class_session_id", classId)
      .neq("status", "canceled");
    check(
      !finalClass.error &&
        finalClass.data?.status === "canceled" &&
        !activeRegistrations.error &&
        activeRegistrations.count === 0,
      "Class cancellation did not close all its reserved seats.",
    );
    manifest.class_canceled = true;
    const restored = await publicDb.rpc("public_slots", {
      slug,
      service: service.id,
      professional: professional.data.id,
      day: selected.day,
    });
    check(
      !restored.error &&
        (restored.data as { starts_at: string }[]).some(
          (item) => Date.parse(item.starts_at) === Date.parse(selected.start),
        ),
      "Canceled class did not reopen individual availability.",
    );
    check(
      (await existingSnapshot()) === previousSnapshot,
      "A pre-existing class or individual appointment changed during this test.",
    );
    manifest.unchanged_existing_data = true;
    pass(
      "canceling only the QA class frees its interval and preserves every pre-existing class/appointment snapshot",
    );
    manifest.status = "passed";
  } finally {
    if (loggedIn) {
      const recovered = await owner.db
        .from("class_sessions")
        .select("id,status")
        .eq("company_id", companyId)
        .eq("title", marker);
      if (!recovered.error && recovered.data) {
        manifest.class_ids = [
          ...new Set([
            ...manifest.class_ids,
            ...recovered.data.map((item) => item.id),
          ]),
        ];
        manifest.class_canceled =
          recovered.data.length > 0 &&
          recovered.data.every((item) => item.status === "canceled");
        if (manifest.class_ids.length) {
          const roster = await owner.db
            .from("class_registrations")
            .select("id,customer_id")
            .eq("company_id", companyId)
            .in("class_session_id", manifest.class_ids);
          if (!roster.error && roster.data) {
            manifest.registration_ids = [
              ...new Set([
                ...manifest.registration_ids,
                ...roster.data.map((item) => item.id),
              ]),
            ];
            manifest.customer_ids = [
              ...new Set([
                ...manifest.customer_ids,
                ...roster.data.map((item) => item.customer_id),
              ]),
            ];
          }
        }
      }
      if (manifest.status !== "passed")
        manifest.status = "incomplete-needs-exact-qa-cleanup";
      if (previousSnapshot) {
        try {
          manifest.unchanged_existing_data =
            (await existingSnapshot()) === previousSnapshot;
        } catch {
          manifest.unchanged_existing_data = false;
        }
      }
      manifest.groups = groups;
      await persist();
      console.log(
        `QA manifest: ${manifestPath}; exact classes=${manifest.class_ids.length}, registrations=${manifest.registration_ids.length}, customers=${manifest.customer_ids.length}.`,
      );
    }
    await Promise.allSettled(
      [owner, employee, outsider].map((actor) =>
        actor.db.auth.signOut({ scope: "local" }),
      ),
    );
  }
  console.log(
    `${groups} live class groups passed; only marked DEMO rows created. Administrative cleanup uses the exact ignored manifest.`,
  );
}
main().catch((error: unknown) => {
  console.error(
    `FAIL classes live (${phase}): ${error instanceof Failure ? error.message : "Unexpected failure; details withheld to protect sessions and secrets."}`,
  );
  process.exitCode = 1;
});
