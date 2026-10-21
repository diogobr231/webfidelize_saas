import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import {
  addDays,
  localAppointmentInstant,
  saoPauloDay,
} from "../src/lib/scheduling";

// Explicitly opted-in synthetic fixtures only. Never read browser sessions.
const optedIn = process.env.TEST_OPERATIONS_LIVE === "1";
const password = process.env.SEED_PASSWORD;
process.loadEnvFile(".env.local");
let phase = "configuration",
  passed = 0;
class TestFailure extends Error {}
function check(value: unknown, message: string): asserts value {
  if (!value) throw new TestFailure(message);
}
function pass(message: string) {
  passed++;
  console.log(`PASS operations: ${message}`);
}
const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
function attrs(tag: string) {
  return Object.fromEntries(
    [...tag.matchAll(/([\w$:-]+)\s*=\s*"([^"]*)"/g)].map((m) => [
      m[1],
      decode(m[2]),
    ]),
  );
}
function formFrom(html: string, marker: string) {
  const source = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map((m) => m[0])
    .find((s) => s.includes(marker));
  check(source, `Expected form missing: ${marker}`);
  const data = new FormData();
  for (const match of source.matchAll(/<input\b[^>]*>/g)) {
    const input = attrs(match[0]);
    if (input.type === "hidden" && input.name)
      data.append(input.name, input.value || "");
  }
  check(
    [...data.keys()].some(
      (k) => k.startsWith("$ACTION_ID_") || k.startsWith("$ACTION_REF_"),
    ),
    "Missing server action binding.",
  );
  return data;
}
function duplicate(form: FormData) {
  const result = new FormData();
  for (const [k, v] of form) result.append(k, v);
  return result;
}

async function main() {
  check(
    optedIn,
    "Set TEST_OPERATIONS_LIVE=1 for the synthetic operations test.",
  );
  const base = new URL(process.env.TEST_BASE_URL || "http://localhost:3000");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  check(
    ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) &&
      !base.username &&
      !base.password,
    "Only a local application may receive test sessions.",
  );
  check(
    password && url && key,
    "Provide public Supabase configuration and SEED_PASSWORD through the process.",
  );
  const cookies = new Map<string, string>();
  const db = createServerClient(url, key, {
    auth: { autoRefreshToken: false },
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: (items) => {
        for (const i of items)
          i.value && i.options.maxAge !== 0
            ? cookies.set(i.name, i.value)
            : cookies.delete(i.name);
      },
    },
  });
  const outsider = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const publicDb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let companyId = "",
    slug = "",
    appointmentId = "",
    safeTenant = false;
  const fixtureId = randomUUID(),
    title = `TESTE operação fictício ${fixtureId.slice(0, 8)}`;
  const ids = {
    customers: randomUUID(),
    services: randomUUID(),
    professionals: randomUUID(),
  };
  const created: (keyof typeof ids)[] = [];
  const blockIds = new Set<string>();
  const racedAppointments = new Set<string>();
  const route = (section: string) => `/painel/${companyId}/${section}`;
  const detail = (section: keyof typeof ids) =>
    route(`${section}/${ids[section]}`);
  async function request(path: string, form?: FormData) {
    const target = new URL(path, base);
    check(
      target.origin === base.origin,
      "Refusing cross-origin session transfer.",
    );
    if (form)
      check(
        safeTenant && target.pathname.startsWith(`/painel/${companyId}/`),
        "Only the verified DEMO company may receive writes.",
      );
    const result = await fetch(target, {
      method: form ? "POST" : "GET",
      body: form,
      redirect: "manual",
      signal: AbortSignal.timeout(45000),
      headers: {
        Accept: "text/html",
        Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        ...(form ? { Origin: base.origin, Referer: target.toString() } : {}),
      },
    });
    for (const header of result.headers.getSetCookie()) {
      const pair = header.split(";", 1)[0],
        n = pair.indexOf("=");
      if (n > 0) {
        const k = pair.slice(0, n),
          v = pair.slice(n + 1);
        v && !/max-age=0(?:;|$)/i.test(header)
          ? cookies.set(k, v)
          : cookies.delete(k);
      }
    }
    return result;
  }
  async function html(path: string) {
    const r = await request(path);
    check(r.status === 200, "Expected authenticated page.");
    return r.text();
  }
  async function post(path: string, form: FormData) {
    const r = await request(path, form);
    check(r.status < 500, "Server action failed with a server error.");
    await r.text();
  }
  async function record(section: keyof typeof ids) {
    const r = await db
      .from(section)
      .select("*")
      .eq("company_id", companyId)
      .eq("id", ids[section])
      .single();
    check(!r.error && r.data, "Fixture unavailable.");
    return r.data;
  }
  async function archive(
    section: keyof typeof ids,
    archived: boolean,
    confirm = true,
  ) {
    const f = formFrom(await html(detail(section)), 'name="archived"');
    f.set("archived", String(archived));
    if (confirm) f.set("confirm_action", "yes");
    await post(detail(section), f);
  }
  async function appointment() {
    const r = await db
      .from("appointments")
      .select(
        "id,company_id,customer_id,service_id,professional_id,starts_at,ends_at,status",
      )
      .eq("company_id", companyId)
      .eq("id", appointmentId)
      .single();
    check(!r.error && r.data, "Appointment unavailable.");
    return r.data;
  }
  try {
    phase = "authentication and fixture guards";
    const signIn = await db.auth.signInWithPassword({
      email: "clinica@example.invalid",
      password,
    });
    check(!signIn.error && signIn.data.user, "DEMO login failed.");
    const companies = await db
      .from("memberships")
      .select("company_id,role")
      .eq("user_id", signIn.data.user.id)
      .eq("role", "OWNER");
    check(
      !companies.error && companies.data?.length === 1,
      "Expected one DEMO owner company.",
    );
    companyId = companies.data[0].company_id;
    const company = await db
      .from("companies")
      .select(
        "id,is_demo,booking_enabled,booking_slug,plan_id,status,trial_ends_at",
      )
      .eq("id", companyId)
      .single();
    check(
      !company.error &&
        company.data?.is_demo === true &&
        company.data.booking_enabled,
      "A published DEMO company is required.",
    );
    const originalCompany = company.data;
    slug = originalCompany.booking_slug;
    check(
      originalCompany.status === "active" ||
        (originalCompany.status === "trialing" &&
          Date.parse(originalCompany.trial_ends_at) > Date.now()),
      "DEMO must already allow writes; this test never extends trial.",
    );
    safeTenant = true;
    const login2 = await outsider.auth.signInWithPassword({
      email: "salao@example.invalid",
      password,
    });
    check(!login2.error, "Second synthetic account failed authentication.");
    for (const section of ["customers", "services", "professionals"] as const) {
      const extra =
        section === "customers"
          ? { phone: "" }
          : section === "services"
            ? { duration_minutes: 30, price_cents: 3500 }
            : {};
      const inserted = await db.from(section).insert({
        id: ids[section],
        company_id: companyId,
        name: `${title} ${section}`,
        ...extra,
      });
      // Register before asserting so cleanup checks our random id after uncertain responses.
      created.push(section);
      check(
        !inserted.error,
        "Could not create synthetic record; check active professional capacity.",
      );
    }
    pass(
      "isolated DEMO fixtures created with normal authenticated permissions",
    );

    phase = "edit, field validation and stale version";
    const edit = formFrom(await html(detail("customers")), 'name="name"');
    edit.set("name", `${title} atualizado`);
    edit.set("phone", "18900000000");
    const stale = duplicate(edit);
    await post(detail("customers"), edit);
    const customer = await record("customers");
    check(
      customer.name === `${title} atualizado` &&
        customer.phone === "18900000000" &&
        customer.record_version === 2,
      "Edit did not persist correctly.",
    );
    stale.set("name", `${title} stale overwrite`);
    await post(detail("customers"), stale);
    check(
      (await record("customers")).name === customer.name,
      "Stale form overwrote the newer record.",
    );
    const invalid = formFrom(await html(detail("services")), 'name="name"');
    invalid.set("name", `${title} invalid price`);
    invalid.set("duration", "30");
    invalid.set("price", "");
    const invalidResponse = await request(detail("services"), invalid),
      invalidHtml = await invalidResponse.text();
    check(
      invalidResponse.status === 200 &&
        decode(invalidHtml).includes(`${title} invalid price`),
      "Validation did not preserve draft fields.",
    );
    check(
      (await record("services")).price_cents === 3500,
      "Invalid price changed the service.",
    );
    pass(
      "edits persist; stale versions and invalid prices cannot overwrite data",
    );

    phase = "tenant authorization";
    const forged = await outsider.rpc("update_business_record", {
      p_company: companyId,
      p_section: "customers",
      p_record: ids.customers,
      p_version: customer.record_version,
      p_name: "Unauthorized test",
      p_phone: "",
    });
    check(forged.error, "Another company edited the synthetic customer.");
    const foreignRows = await outsider
      .from("customers")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", ids.customers);
    check(
      !foreignRows.error && foreignRows.data?.length === 0,
      "Another company read the customer.",
    );
    const foreignBlock = await outsider.rpc("create_schedule_block", {
      p_company: companyId,
      p_id: randomUUID(),
      p_professional: null,
      p_start: new Date(Date.now() + 86400000).toISOString(),
      p_end: new Date(Date.now() + 90000000).toISOString(),
      p_reason: "TESTE acesso negado",
    });
    check(foreignBlock.error, "Another company created a schedule block.");
    pass("cross-company reads and mutations rejected");

    phase = "existing appointments and customer history";
    let day = addDays(saoPauloDay(), 2);
    while ([0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay()))
      day = addDays(day, 1);
    const start = localAppointmentInstant(day, "09:00")!;
    const booked = await db.rpc("book_appointment", {
      p_company: companyId,
      p_customer: ids.customers,
      p_service: ids.services,
      p_professional: ids.professionals,
      p_start: start,
    });
    check(
      !booked.error && typeof booked.data === "string",
      "Could not create synthetic appointment.",
    );
    appointmentId = booked.data;
    const before = await appointment();
    const editService = formFrom(await html(detail("services")), 'name="name"');
    editService.set("name", `${title} serviço atualizado`);
    editService.set("duration", "45");
    editService.set("price", "42,50");
    await post(detail("services"), editService);
    const changedService = await record("services");
    check(
      changedService.duration_minutes === 45 &&
        changedService.price_cents === 4250,
      "Service edit failed.",
    );
    assert.deepEqual(
      await appointment(),
      before,
      "Service edit changed an existing appointment.",
    );
    for (const section of ["customers", "services", "professionals"] as const) {
      await archive(section, true);
      check(
        (await record(section)).archived_at === null,
        "Archived a record with a future scheduled appointment.",
      );
    }
    const history = await html(detail("customers"));
    check(
      history.includes(`${title} serviço atualizado`) &&
        history.includes(`${title} professionals`) &&
        history.includes("30") &&
        history.includes(`day=${day}`),
      "Customer history omitted the actual appointment.",
    );
    pass(
      "customer history renders; edits preserve booked duration; future appointments prevent archival",
    );

    phase = "block conflict against existing appointment";
    const conflicting = await db.rpc("create_schedule_block", {
      p_company: companyId,
      p_id: randomUUID(),
      p_professional: ids.professionals,
      p_start: start,
      p_end: before.ends_at,
      p_reason: "TESTE conflito",
    });
    check(conflicting.error, "A block overlapped the existing appointment.");
    assert.deepEqual(
      await appointment(),
      before,
      "Block creation altered an existing appointment.",
    );
    // Cancellation uses the existing operational function; the new flows use their HTML forms.
    check(
      !(
        await db.rpc("manage_appointment", {
          p_company: companyId,
          p_appointment: appointmentId,
          p_action: "cancel",
        })
      ).error,
      "Could not cancel own synthetic appointment.",
    );
    pass(
      "block cannot displace a reservation; existing cancellation still works",
    );

    phase = "archive and restoration";
    await archive("customers", true, false);
    check(
      (await record("customers")).archived_at === null,
      "Archival did not require confirmation.",
    );
    for (const section of ["customers", "services", "professionals"] as const) {
      await archive(section, true);
      check(
        (await record(section)).archived_at,
        "Confirmed archive did not persist.",
      );
    }
    const catalog = await publicDb.rpc("public_catalog", { slug });
    check(
      !catalog.error &&
        !JSON.stringify(catalog.data).includes(ids.services) &&
        !JSON.stringify(catalog.data).includes(ids.professionals),
      "Archived catalogue items remained public.",
    );
    const deniedBook = await db.rpc("book_appointment", {
      p_company: companyId,
      p_customer: ids.customers,
      p_service: ids.services,
      p_professional: ids.professionals,
      p_start: start,
    });
    check(
      deniedBook.error,
      "Archived records were used for a new appointment.",
    );
    const activeList = await html(
      `${route("customers")}?q=${encodeURIComponent(title)}`,
    );
    const archivedList = await html(
      `${route("customers")}?estado=arquivados&q=${encodeURIComponent(title)}`,
    );
    check(
      !activeList.includes(`/customers/${ids.customers}`) &&
        archivedList.includes(`/customers/${ids.customers}`),
      "Archive list filter did not match saved state.",
    );
    const archivedHistory = await html(detail("customers"));
    check(
      archivedHistory.includes(`${title} serviço atualizado`) &&
        archivedHistory.includes("Cancelado"),
      "Archival lost the customer's canceled history.",
    );
    for (const section of ["customers", "services", "professionals"] as const) {
      await archive(section, false);
      check(
        (await record(section)).archived_at === null,
        "Restoration failed.",
      );
    }
    pass(
      "confirmation, archive filters, public catalogue, historical access and restoration verified",
    );

    phase = "schedule-block HTML, idempotency, public slots and removal";
    const availabilityRoute = route("disponibilidade");
    const ownBlock = randomUUID(),
      privateReason = `TESTE bloqueio privado ${fixtureId}`;
    blockIds.add(ownBlock);
    const blockForm = formFrom(
      await html(availabilityRoute),
      'name="request_id"',
    );
    for (const [k, v] of Object.entries({
      request_id: ownBlock,
      professional_id: ids.professionals,
      start_day: day,
      start_time: "11:00",
      end_day: day,
      end_time: "12:00",
      reason: privateReason,
    }))
      blockForm.set(k, v);
    const repeat = duplicate(blockForm);
    await post(availabilityRoute, blockForm);
    await post(availabilityRoute, repeat);
    const blocks = await db
      .from("schedule_blocks")
      .select("id,reason")
      .eq("company_id", companyId)
      .eq("id", ownBlock);
    check(
      !blocks.error &&
        blocks.data?.length === 1 &&
        blocks.data[0].reason === privateReason,
      "Block form did not save one idempotent block.",
    );
    const slots = await publicDb.rpc("public_slots", {
      slug,
      service: ids.services,
      professional: ids.professionals,
      day,
    });
    check(
      !slots.error && Array.isArray(slots.data),
      "Public slots query failed.",
    );
    const blockStart = Date.parse(localAppointmentInstant(day, "11:00")!),
      blockEnd = Date.parse(localAppointmentInstant(day, "12:00")!);
    check(
      slots.data.every(
        (s: { starts_at: string }) =>
          Date.parse(s.starts_at) >= blockEnd ||
          Date.parse(s.starts_at) + 45 * 60000 <= blockStart,
      ),
      "Public slot overlapped a saved block.",
    );
    check(
      slots.data.some(
        (s: { starts_at: string }) => Date.parse(s.starts_at) === blockEnd,
      ),
      "A boundary-adjacent slot was incorrectly blocked.",
    );
    const blockedBooking = await db.rpc("book_appointment", {
      p_company: companyId,
      p_customer: ids.customers,
      p_service: ids.services,
      p_professional: ids.professionals,
      p_start: localAppointmentInstant(day, "11:00"),
    });
    check(blockedBooking.error, "Internal booking bypassed the block.");
    const agenda = await html(`${route("agenda")}?day=${day}`);
    check(
      agenda.includes(privateReason),
      "Agenda did not show the saved block.",
    );
    const publicPage = await fetch(
      new URL(
        `/agendar/${slug}?service=${ids.services}&professional=${ids.professionals}&day=${day}`,
        base,
      ),
    );
    check(
      !(await publicPage.text()).includes(privateReason),
      "Public page leaked the private block reason.",
    );
    pass(
      "block form is idempotent, agenda shows it, public/internal scheduling respects its interval",
    );
    const blockList = await html(`${availabilityRoute}?bloqueios_de=${day}`);
    const remove = formFrom(blockList, `value="${ownBlock}"`);
    await post(availabilityRoute, duplicate(remove));
    check(
      (
        await db
          .from("schedule_blocks")
          .select("id")
          .eq("company_id", companyId)
          .eq("id", ownBlock)
      ).data?.length === 1,
      "Block removal did not require confirmation.",
    );
    remove.set("confirm_action", "yes");
    await post(availabilityRoute, remove);
    const removed = await db
      .from("schedule_blocks")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", ownBlock);
    check(
      !removed.error && removed.data?.length === 0,
      "Confirmed block removal failed.",
    );
    blockIds.delete(ownBlock);
    const freeSlots = await publicDb.rpc("public_slots", {
      slug,
      service: ids.services,
      professional: ids.professionals,
      day,
    });
    check(
      !freeSlots.error &&
        freeSlots.data?.some(
          (s: { starts_at: string }) => Date.parse(s.starts_at) === blockStart,
        ),
      "Removing block did not release the public slot.",
    );
    pass("block removal requires confirmation and restores bookable slots");

    // Use a free company-wide interval, never displace an existing demo reservation.
    phase = "company-wide block";
    let globalDay = day;
    for (let attempt = 0; attempt < 14; attempt++) {
      const occupied = await db
        .from("appointments")
        .select("id")
        .eq("company_id", companyId)
        .eq("status", "scheduled")
        .lt("starts_at", localAppointmentInstant(globalDay, "12:00")!)
        .gt("ends_at", localAppointmentInstant(globalDay, "11:00")!);
      check(!occupied.error, "Could not verify the global block interval.");
      if (!occupied.data?.length) break;
      globalDay = addDays(globalDay, 1);
      check(attempt < 13, "No safe company-wide fixture interval found.");
    }
    const globalId = randomUUID();
    blockIds.add(globalId);
    const globalForm = formFrom(
      await html(availabilityRoute),
      'name="request_id"',
    );
    for (const [k, v] of Object.entries({
      request_id: globalId,
      professional_id: "",
      start_day: globalDay,
      start_time: "11:00",
      end_day: globalDay,
      end_time: "12:00",
      reason: `${privateReason} empresa`,
    }))
      globalForm.set(k, v);
    await post(availabilityRoute, globalForm);
    const globalSaved = await db
      .from("schedule_blocks")
      .select("id,professional_id")
      .eq("company_id", companyId)
      .eq("id", globalId)
      .single();
    check(
      !globalSaved.error && globalSaved.data?.professional_id === null,
      "Company-wide block was not persisted.",
    );
    const outsidersBlocks = await outsider
      .from("schedule_blocks")
      .select("id")
      .eq("company_id", companyId);
    check(
      !outsidersBlocks.error && outsidersBlocks.data?.length === 0,
      "Another company saw private blocks.",
    );
    const globalRemove = formFrom(
      await html(`${availabilityRoute}?bloqueios_de=${globalDay}`),
      `value="${globalId}"`,
    );
    globalRemove.set("confirm_action", "yes");
    await post(availabilityRoute, globalRemove);
    check(
      (
        await db
          .from("schedule_blocks")
          .select("id")
          .eq("company_id", companyId)
          .eq("id", globalId)
      ).data?.length === 0,
      "Company block removal failed.",
    );
    blockIds.delete(globalId);
    pass(
      "company-wide block persists with tenant isolation and can be removed safely",
    );

    phase = "concurrent reservation and block";
    const raceId = randomUUID();
    blockIds.add(raceId);
    const raceStart = localAppointmentInstant(day, "14:00")!;
    const raceEnd = localAppointmentInstant(day, "15:00")!;
    const [raceBooking, raceBlock] = await Promise.all([
      db.rpc("book_appointment", {
        p_company: companyId,
        p_customer: ids.customers,
        p_service: ids.services,
        p_professional: ids.professionals,
        p_start: raceStart,
      }),
      db.rpc("create_schedule_block", {
        p_company: companyId,
        p_id: raceId,
        p_professional: ids.professionals,
        p_start: raceStart,
        p_end: raceEnd,
        p_reason: `${privateReason} concorrência`,
      }),
    ]);
    if (!raceBooking.error && typeof raceBooking.data === "string")
      racedAppointments.add(raceBooking.data);
    check(
      Number(!raceBooking.error) + Number(!raceBlock.error) === 1,
      "Concurrent block and booking did not produce exactly one winner.",
    );
    if (raceBlock.error) blockIds.delete(raceId);
    pass("concurrent booking and block serialize without overlapping writes");
    phase = "company commercial preservation";
    const finalCompany = await db
      .from("companies")
      .select(
        "id,is_demo,booking_enabled,booking_slug,plan_id,status,trial_ends_at",
      )
      .eq("id", companyId)
      .single();
    assert.deepEqual(
      finalCompany.data,
      originalCompany,
      "Test changed company commercial settings.",
    );
    pass("trial, plan and public-booking settings preserved");
  } finally {
    if (safeTenant) {
      if (appointmentId) {
        const a = await appointment();
        if (a.status === "scheduled")
          check(
            !(
              await db.rpc("manage_appointment", {
                p_company: companyId,
                p_appointment: appointmentId,
                p_action: "cancel",
              })
            ).error,
            "Cleanup could not cancel own appointment.",
          );
      }
      for (const id of racedAppointments)
        check(
          !(
            await db.rpc("manage_appointment", {
              p_company: companyId,
              p_appointment: id,
              p_action: "cancel",
            })
          ).error,
          "Cleanup could not cancel its concurrent fixture.",
        );
      for (const id of blockIds) {
        const ownBlock = await db
          .from("schedule_blocks")
          .select("id")
          .eq("company_id", companyId)
          .eq("id", id)
          .maybeSingle();
        check(!ownBlock.error, "Cleanup could not inspect its own block.");
        if (ownBlock.data)
          check(
            !(
              await db.rpc("remove_schedule_block", {
                p_company: companyId,
                p_block: id,
              })
            ).error,
            "Cleanup could not remove its own block.",
          );
      }
      for (const section of created) {
        const existing = await db
          .from(section)
          .select("name,record_version,archived_at")
          .eq("company_id", companyId)
          .eq("id", ids[section])
          .maybeSingle();
        check(!existing.error, "Cleanup could not verify its record.");
        if (existing.data && !existing.data.archived_at) {
          check(
            existing.data.name.startsWith(title),
            "Refusing to modify an unrelated record during cleanup.",
          );
          check(
            !(
              await db.rpc("archive_business_record", {
                p_company: companyId,
                p_section: section,
                p_record: ids[section],
                p_version: existing.data.record_version,
                p_archived: true,
              })
            ).error,
            "Cleanup could not archive its own synthetic record.",
          );
        }
      }
    }
    await db.auth.signOut({ scope: "local" });
    await outsider.auth.signOut({ scope: "local" });
  }
  console.log(
    `Completed ${passed} operations groups. Synthetic records retained archived; appointment canceled; temporary blocks removed.`,
  );
}
main().catch((error) => {
  console.error(
    `FAIL operations during ${phase}: ${error instanceof TestFailure ? error.message : "Unexpected test failure (details suppressed to protect credentials)."}`,
  );
  process.exitCode = 1;
});
