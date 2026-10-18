import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { addDays, saoPauloDay } from "../src/lib/scheduling";
import { readDetailedReceipt } from "../src/lib/booking-receipt";

// Opt-in live integration test. Only explicitly marked demonstration companies
// may be mutated. Browser cookies and the user's sessions are never accessed.
process.loadEnvFile(".env.local");

const base = new URL(process.env.TEST_BASE_URL || "http://localhost:3000");
const email = process.env.DEMO_EMAIL || "pet-shop@example.invalid";
const password = process.env.SEED_PASSWORD;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const gatewaySecret = process.env.BOOKING_GATEWAY_SECRET;
let phase = "configuration";
let checks = 0;
class TestFailure extends Error {}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TestFailure(message);
}
function pass(message: string) {
  checks++;
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
function actionForm(html: string, identifier: string) {
  const source = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map((match) => match[0])
    .find((form) => form.includes(identifier));
  check(source, "Expected server-action form was not rendered.");
  const data = new FormData();
  for (const match of source.matchAll(/<input\b[^>]*>/g)) {
    const input = attributes(match[0]);
    if (input.type === "hidden" && input.name)
      data.append(input.name, input.value || "");
  }
  check(
    [...data.keys()].some((key) => key.startsWith("$ACTION_ID_")),
    "Expected server action identifier was absent.",
  );
  return data;
}
async function destination(response: Response) {
  let value: string | null = null;
  if ([303, 307, 308].includes(response.status)) {
    value = response.headers.get("location");
  } else if (response.status === 200) {
    // With a loading boundary, Next can start the HTML response before the
    // server component redirects. Accept only Next's explicit redirect meta,
    // never an ordinary successful page or an arbitrary URL in its scripts.
    const source = await response.text();
    const metadata = [...source.matchAll(/<meta\b[^>]*>/g)]
      .map((match) => attributes(match[0]))
      .find(
        (tag) =>
          tag.id === "__next-page-redirect" &&
          tag["http-equiv"]?.toLowerCase() === "refresh",
      );
    const refresh = metadata?.content?.match(/^\s*[01]\s*;\s*url=(.+)\s*$/i);
    if (refresh) value = refresh[1];
  }
  check(
    value,
    "Expected an HTTP redirect or explicit Next streaming redirect.",
  );
  const target = new URL(value, base);
  check(target.origin === base.origin, "Unexpected redirect origin.");
  return target;
}
function statusSucceeded(response: { error: unknown }, message: string) {
  check(!response.error, message);
}
const isoEqual = (a: string, b: string) => Date.parse(a) === Date.parse(b);
const calendarStamp = (value: string) =>
  new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

async function main() {
  check(
    ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname),
    "Live HTTP integration test requires a local server.",
  );
  check(
    base.protocol === "http:" || base.protocol === "https:",
    "Unsupported test protocol.",
  );
  check(
    email.endsWith("@example.invalid"),
    "Use an explicitly synthetic demo account.",
  );
  check(
    password && supabaseUrl && publishableKey && gatewaySecret,
    "Missing private test configuration. Provide SEED_PASSWORD in the process environment.",
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
      "Refusing to send cookies to another origin.",
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
  async function html(path: string, authenticated = true) {
    const response = await request(path, {}, authenticated);
    check(
      response.status === 200,
      "Expected HTML page did not load successfully.",
    );
    return response.text();
  }
  async function post(path: string, body: FormData, authenticated = true) {
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
  let companyId = "";
  let appointmentId = "";
  let bookingRequestId = "";
  let bookingSlug = "";
  let canceled = false;
  try {
    phase = "demo authentication and tenant verification";
    const login = await db.auth.signInWithPassword({ email, password });
    statusSucceeded(login, "Demo authentication failed.");
    check(
      login.data.user && cookies.size,
      "SSR session cookies were not created.",
    );
    const companies = await db.from("companies").select("*");
    statusSucceeded(companies, "Could not verify the test tenant.");
    check(
      companies.data?.length === 1 && companies.data[0].is_demo === true,
      "Test account must have exactly one demonstration company.",
    );
    const company = companies.data[0];
    companyId = company.id;
    check(
      company.booking_enabled && company.booking_slug,
      "The demo public booking page must be enabled.",
    );
    const membership = await db
      .from("memberships")
      .select("role")
      .eq("company_id", companyId)
      .eq("user_id", login.data.user.id)
      .single();
    statusSucceeded(membership, "Could not verify test account permissions.");
    check(
      membership.data?.role === "OWNER",
      "The test requires a demonstration OWNER account.",
    );
    pass("isolated SSR login and synthetic OWNER tenant");

    phase = "dashboard and single-company navigation";
    const first = await destination(await request("/painel"));
    check(
      first.pathname === `/painel/${companyId}`,
      "Single-company login did not open its dashboard.",
    );
    const switcher = await html("/painel?empresas=1");
    check(
      switcher.includes("Suas empresas") && switcher.includes(company.name),
      "Company switcher did not remain available.",
    );
    const dashboard = await html(`/painel/${companyId}`);
    check(
      dashboard.includes("Seu dia, mais organizado.") &&
        dashboard.includes("Próximos atendimentos"),
      "Dashboard content was incomplete.",
    );
    check(
      dashboard.includes("Etapas da configuração concluídas") &&
        dashboard.includes("Copiar link"),
      "Persisted setup checklist or share controls were absent.",
    );
    pass(
      "single-company redirect, switcher, real dashboard and setup checklist",
    );

    phase = "agenda day and week views";
    const day = addDays(saoPauloDay(), 1);
    const dayPage = await html(
      `/painel/${companyId}/agenda?day=${day}&view=day`,
    );
    const weekPage = await html(
      `/painel/${companyId}/agenda?day=${day}&view=week`,
    );
    check(
      dayPage.includes("Data da agenda") &&
        dayPage.includes("novo-agendamento"),
      "Day agenda or booking form was absent.",
    );
    check(
      weekPage.includes('class="calendar"') && weekPage.includes("Semana"),
      "Week agenda was not rendered.",
    );
    check(
      !dayPage.includes("Não foi possível carregar a agenda") &&
        !weekPage.includes("Não foi possível carregar a agenda"),
      "Agenda data failed to load.",
    );
    pass("authenticated visual agenda in day and week modes");

    phase = "authentication and cross-company server authorization";
    const denied = await destination(
      await request(`/painel/${companyId}/agenda`, {}, false),
    );
    check(
      denied.pathname === "/entrar",
      "Unauthenticated agenda request was not rejected.",
    );
    const settingsRoute = `/painel/${companyId}/disponibilidade`;
    const settings = await html(settingsRoute);
    const forgedProfile = actionForm(settings, 'name="description"');
    forgedProfile.set("company_id", randomUUID());
    forgedProfile.set("description", company.booking_description || "");
    forgedProfile.set("address", company.booking_address || "");
    forgedProfile.set("phone", company.booking_phone || "");
    forgedProfile.set("theme", company.booking_theme || "teal");
    const forgedTarget = await destination(
      await post(settingsRoute, forgedProfile),
    );
    check(
      forgedTarget.pathname === "/painel" &&
        forgedTarget.searchParams.get("erro") === "acesso",
      "Server accepted an unauthorized company identifier.",
    );
    const invalidAppointment = actionForm(dayPage, 'name="customer_id"');
    invalidAppointment.set("company_id", companyId);
    invalidAppointment.set("customer_id", "invalid");
    invalidAppointment.set("service_id", "invalid");
    invalidAppointment.set("professional_id", "invalid");
    invalidAppointment.set("day", day);
    invalidAppointment.set("time", "10:00");
    const invalidTarget = await destination(
      await post(`/painel/${companyId}/agenda?day=${day}`, invalidAppointment),
    );
    check(
      invalidTarget.searchParams.get("erro") === "validacao",
      "Invalid appointment fields bypassed server validation.",
    );
    const validRecords = await Promise.all(
      ["customers", "services", "professionals"].map((table) =>
        db
          .from(table)
          .select("id")
          .eq("company_id", companyId)
          .limit(1)
          .single(),
      ),
    );
    check(
      validRecords.every((result) => !result.error && result.data?.id),
      "Demo records were unavailable for the date boundary check.",
    );
    const outOfRange = actionForm(dayPage, 'name="customer_id"');
    outOfRange.set("company_id", companyId);
    outOfRange.set("customer_id", validRecords[0].data!.id);
    outOfRange.set("service_id", validRecords[1].data!.id);
    outOfRange.set("professional_id", validRecords[2].data!.id);
    outOfRange.set("day", "2100-01-04");
    outOfRange.set("time", "10:00");
    const outOfRangeTarget = await destination(
      await post(`/painel/${companyId}/agenda?day=${day}`, outOfRange),
    );
    check(
      outOfRangeTarget.searchParams.get("erro") === "validacao",
      "An out-of-range date bypassed server validation with valid demo IDs.",
    );
    pass(
      "anonymous requests, forged tenant, invalid fields and out-of-range date rejected",
    );

    phase = "public profile server action";
    const profile = actionForm(settings, 'name="description"');
    for (const [name, value] of Object.entries({
      company_id: companyId,
      description: company.booking_description || "",
      address: company.booking_address || "",
      phone: company.booking_phone || "",
      theme: company.booking_theme || "teal",
    }))
      profile.set(name, value as string);
    const saved = await destination(await post(settingsRoute, profile));
    check(
      saved.searchParams.get("salvo") === "perfil",
      "Public profile server action did not save.",
    );
    const savedProfile = await db
      .from("companies")
      .select("booking_description,booking_address,booking_phone,booking_theme")
      .eq("id", companyId)
      .single();
    statusSucceeded(savedProfile, "Could not verify the saved profile.");
    for (const key of [
      "booking_description",
      "booking_address",
      "booking_phone",
      "booking_theme",
    ] as const)
      check(
        savedProfile.data?.[key] === company[key],
        "Saving the existing profile unexpectedly changed its values.",
      );
    pass(
      "profile form posts through Next Server Action and preserves current values",
    );

    phase = "public catalog privacy";
    const slug = company.booking_slug as string;
    bookingSlug = slug;
    const catalogResult = await publicDb.rpc("public_catalog", { slug });
    statusSucceeded(catalogResult, "Anonymous public catalog request failed.");
    const catalog = catalogResult.data;
    check(
      catalog?.is_demo === true && catalog.slug === slug,
      "Public catalog returned the wrong company.",
    );
    const allowed = new Set([
      "name",
      "slug",
      "is_demo",
      "description",
      "address",
      "phone",
      "theme",
      "services",
      "professionals",
    ]);
    check(
      Object.keys(catalog).every((key) => allowed.has(key)),
      "Public catalog exposed an unexpected field.",
    );
    check(
      catalog.description === company.booking_description &&
        catalog.address === company.booking_address &&
        catalog.phone === company.booking_phone &&
        catalog.theme === company.booking_theme,
      "Public profile did not match saved settings.",
    );
    check(
      !/"(?:customer_name|customer_id|customers|appointments|user_id|memberships|company_id)"\s*:/.test(
        JSON.stringify(catalog),
      ),
      "Public catalog exposed private tenant data.",
    );
    check(
      catalog.services.length && catalog.professionals.length,
      "Demo services and professionals are required.",
    );
    pass(
      "anonymous catalog exposes only published profile, services and professionals",
    );

    phase = "find two usable demonstration slots";
    const service = catalog.services[0] as {
      id: string;
      name: string;
      duration: number;
    };
    const professional = catalog.professionals[0] as {
      id: string;
      name: string;
    };
    let bookingDay = "";
    let firstStart = "";
    let nextStart = "";
    for (let offset = 1; offset <= 14 && !bookingDay; offset++) {
      const date = addDays(saoPauloDay(), offset);
      const slots = await publicDb.rpc("public_slots", {
        slug,
        service: service.id,
        professional: professional.id,
        day: date,
      });
      statusSucceeded(slots, "Could not load demonstration slots.");
      const values = (slots.data || []) as { starts_at: string }[];
      if (!values.length) continue;
      const first = values[0].starts_at;
      const next = values.find(
        (slot) =>
          Date.parse(slot.starts_at) >=
          Date.parse(first) + service.duration * 60_000,
      );
      if (next) {
        bookingDay = date;
        firstStart = first;
        nextStart = next.starts_at;
      }
    }
    check(
      bookingDay && firstStart && nextStart,
      "No two usable demo slots found inside the booking horizon.",
    );

    phase = "public booking HTTP server action";
    const bookingRoute = `/agendar/${slug}?${new URLSearchParams({ service: service.id, professional: professional.id, day: bookingDay })}`;
    const bookingPage = await html(bookingRoute, false);
    const reservation = actionForm(bookingPage, 'name="request_id"');
    const requestId = reservation.get("request_id");
    check(
      typeof requestId === "string" && requestId.length === 36,
      "Public form did not include its idempotency key.",
    );
    bookingRequestId = requestId;
    const marker = `TESTE UX fictício — ${randomUUID().slice(0, 8)}`;
    reservation.set("start_time", firstStart);
    reservation.set("customer_name", marker);
    reservation.set("phone", "11900000004");
    reservation.set("consent", "on");
    reservation.set("website", "");
    const receiptTarget = await destination(
      await post(bookingRoute, reservation, false),
    );
    const token = receiptTarget.searchParams.get("recibo");
    check(token, "Public booking did not return a signed detailed receipt.");
    const claims = readDetailedReceipt(token, slug, gatewaySecret);
    check(
      claims && claims.request_id === requestId,
      "Detailed receipt failed signature validation.",
    );
    appointmentId = claims.receipt.id;
    check(
      isoEqual(claims.receipt.starts_at, firstStart),
      "Receipt time differs from the submitted slot.",
    );
    const stored = await db
      .from("appointments")
      .select("id,status,starts_at,customers(name)")
      .eq("company_id", companyId)
      .eq("id", appointmentId)
      .single();
    statusSucceeded(
      stored,
      "Created demonstration booking was not visible to its OWNER.",
    );
    check(
      stored.data?.status === "scheduled",
      "Created booking has the wrong status.",
    );
    const storedCustomer = stored.data?.customers as unknown as {
      name: string;
    } | null;
    check(
      storedCustomer?.name === marker,
      "Synthetic customer marker was not preserved.",
    );

    const repeatTarget = await destination(
      await post(bookingRoute, reservation, false),
    );
    const repeatToken = repeatTarget.searchParams.get("recibo");
    check(
      repeatToken &&
        readDetailedReceipt(repeatToken, slug, gatewaySecret)?.receipt.id ===
          appointmentId,
      "Public reservation retry created a different booking.",
    );
    pass(
      "public form creates one explicitly synthetic booking and retries idempotently",
    );

    phase = "current receipt and calendar download";
    const receiptPath = receiptTarget.pathname + receiptTarget.search;
    const receiptHtml = await html(receiptPath, false);
    check(
      receiptHtml.includes("Seu agendamento está confirmado.") &&
        receiptHtml.includes(service.name),
      "Confirmation page did not show the booked service.",
    );
    check(
      !receiptHtml.includes(marker),
      "Public receipt unexpectedly exposed the customer name.",
    );
    const calendarPath = `/agendar/${slug}/calendario?recibo=${encodeURIComponent(token)}`;
    const calendarResponse = await request(calendarPath, {}, false);
    check(
      calendarResponse.status === 200 &&
        calendarResponse.headers
          .get("content-type")
          ?.startsWith("text/calendar"),
      "Calendar download failed.",
    );
    const calendar = await calendarResponse.text();
    check(
      calendar.includes(`DTSTART:${calendarStamp(firstStart)}`) &&
        calendar.includes("STATUS:CONFIRMED"),
      "Calendar did not reflect the saved booking.",
    );
    const tampered = await request(
      `/agendar/${slug}/calendario?recibo=${encodeURIComponent(token + "x")}`,
      {},
      false,
    );
    check(tampered.status === 404, "Forged calendar receipt was accepted.");
    pass("signed confirmation, private-free receipt and calendar download");

    phase = "reschedule and read current receipt";
    statusSucceeded(
      await db.rpc("manage_appointment", {
        p_company: companyId,
        p_appointment: appointmentId,
        p_action: "reschedule",
        p_start: nextStart,
      }),
      "Could not reschedule the synthetic booking.",
    );
    const movedCalendar = await (await request(calendarPath, {}, false)).text();
    check(
      movedCalendar.includes(`DTSTART:${calendarStamp(nextStart)}`),
      "Previously issued receipt retained an outdated time.",
    );
    const movedPage = await html(receiptPath, false);
    const timeLabel = new Date(nextStart).toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    });
    check(
      movedPage.includes(timeLabel),
      "Confirmation page did not show the new time.",
    );
    const freed = await publicDb.rpc("public_slots", {
      slug,
      service: service.id,
      professional: professional.id,
      day: bookingDay,
    });
    statusSucceeded(freed, "Could not verify the released original slot.");
    check(
      freed.data?.some((slot: { starts_at: string }) =>
        isoEqual(slot.starts_at, firstStart),
      ),
      "Rescheduling did not release the original slot.",
    );
    pass(
      "rescheduling updates old receipt links and releases the original slot",
    );

    phase = "cancel synthetic booking and verify released slot";
    statusSucceeded(
      await db.rpc("manage_appointment", {
        p_company: companyId,
        p_appointment: appointmentId,
        p_action: "cancel",
        p_start: null,
      }),
      "Could not cancel the synthetic booking.",
    );
    canceled = true;
    const canceledPage = await html(receiptPath, false);
    check(
      canceledPage.includes("Este agendamento foi cancelado."),
      "Existing receipt did not reflect cancellation.",
    );
    const canceledCalendar = await (
      await request(calendarPath, {}, false)
    ).text();
    check(
      canceledCalendar.includes("STATUS:CANCELLED"),
      "Calendar did not reflect cancellation.",
    );
    const reopened = await publicDb.rpc("public_slots", {
      slug,
      service: service.id,
      professional: professional.id,
      day: bookingDay,
    });
    statusSucceeded(reopened, "Could not verify canceled slot availability.");
    check(
      reopened.data?.some((slot: { starts_at: string }) =>
        isoEqual(slot.starts_at, nextStart),
      ),
      "Cancellation did not release the slot.",
    );
    check(
      !(await html(`/agendar/${slug}`, false)).includes(marker),
      "Public page leaked the synthetic customer.",
    );
    pass(
      "canceling keeps test data labeled, updates receipt and reopens availability",
    );
    console.log(
      `${checks} live experience groups passed. Synthetic appointment retained as canceled; existing business data preserved.`,
    );
  } finally {
    if (!appointmentId && bookingRequestId && bookingSlug) {
      const receipt = await publicDb.rpc("public_booking_receipt", {
        slug: bookingSlug,
        request_id: bookingRequestId,
        gateway_secret: gatewaySecret,
      });
      if (!receipt.error && typeof receipt.data?.id === "string") {
        const ownBooking = await db
          .from("appointments")
          .select("id,status")
          .eq("company_id", companyId)
          .eq("id", receipt.data.id)
          .maybeSingle();
        if (!ownBooking.error && ownBooking.data) {
          appointmentId = ownBooking.data.id;
          canceled = ownBooking.data.status === "canceled";
        }
      }
    }
    if (appointmentId && !canceled && companyId) {
      const cleanup = await db.rpc("manage_appointment", {
        p_company: companyId,
        p_appointment: appointmentId,
        p_action: "cancel",
        p_start: null,
      });
      if (cleanup.error) {
        console.error(
          "Cleanup needs attention: a TESTE UX synthetic appointment could not be canceled.",
        );
        process.exitCode = 1;
      }
    }
    await db.auth.signOut({ scope: "local" });
    cookies.clear();
  }
}

main().catch((error: unknown) => {
  // Never print Supabase errors, response bodies, cookies, passwords, signed
  // receipt URLs or request headers. The phase identifies the failing boundary.
  console.error(`FAIL live experience validation during: ${phase}.`);
  if (error instanceof TestFailure) console.error(error.message);
  process.exitCode = 1;
});
