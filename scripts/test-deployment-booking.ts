import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { randomInt, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { addDays, saoPauloDay } from "../src/lib/scheduling";
import { readDetailedReceipt } from "../src/lib/booking-receipt";

const origin = "https://webfidelize-saas.vercel.app";
const companyId = "3f259c2b-27aa-4e64-9c81-443deb1d66b2";
const slug = "demo-salao";
const path = `/agendar/${slug}`;
const ownerEmail = "salao@example.invalid";
let phase = "configuration";
let passed = 0;
const pass = (label: string) => console.log(`PASS ${++passed}: ${label}`);

function decode(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
function attributes(tag: string): Record<string, string> {
  return Object.fromEntries(
    [...tag.matchAll(/([\w$:-]+)\s*=\s*"([^"]*)"/g)].map((match) => [
      match[1],
      decode(match[2]),
    ]),
  );
}
async function main() {
  assert.equal(
    process.env.TEST_DEPLOYMENT_BOOKING_LIVE,
    "1",
    "Explicit opt-in required.",
  );
  assert.equal(
    process.env.TEST_DEPLOYMENT_URL,
    origin,
    "Only the authorized production origin is allowed.",
  );
  process.loadEnvFile(".env.local");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const password =
    process.env.TEST_PLAN_ACCOUNTS_PASSWORD || process.env.SEED_PASSWORD;
  const gatewaySecret = process.env.BOOKING_GATEWAY_SECRET;
  assert(
    supabaseUrl && key && password && gatewaySecret,
    "Private test configuration missing.",
  );
  assert.equal(
    new URL(supabaseUrl).origin,
    "https://devmjeiblhrgjyaiaukm.supabase.co",
  );
  const db = createClient(supabaseUrl, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const publicDb = createClient(supabaseUrl, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const manifest: Record<string, unknown> = {
    origin,
    companyId,
    slug,
    marker: `QA publicação fictício — ${randomUUID().slice(0, 8)}`,
    // DDD 00 is intentionally invalid; this fixture cannot be a real recipient.
    phone: `000${String(randomInt(0, 100_000_000)).padStart(8, "0")}`,
    createdAt: new Date().toISOString(),
    whatsappConsent: false,
    appointmentId: null,
    customerId: null,
    status: "preparing",
  };
  const manifestFile = `test-results/deployment-booking-${randomUUID()}.json`;
  async function persist() {
    await mkdir("test-results", { recursive: true });
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }
  async function request(url: URL, body?: FormData) {
    assert.equal(url.origin, origin);
    assert.equal(url.pathname, path);
    assert(!url.username && !url.password && !url.hash);
    for (const name of url.searchParams.keys()) {
      assert(
        ["service", "professional", "day", "recibo"].includes(name),
        "Unexpected query parameter.",
      );
    }
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      body,
      redirect: "manual",
      credentials: "omit",
      headers: body ? { Origin: origin, Referer: url.toString() } : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    assert(
      ![401, 403].includes(response.status),
      "Public access denied; do not bypass protection.",
    );
    return response;
  }
  async function postReceipt(url: URL, body: FormData) {
    const response = await request(url, body);
    assert.equal(
      response.status,
      303,
      "Booking action did not return a redirect.",
    );
    const location = response.headers.get("location");
    assert(location, "Booking redirect missing.");
    const destination = new URL(location, origin);
    assert.equal(destination.origin, origin);
    assert.equal(destination.pathname, path);
    assert(
      !destination.searchParams.has("erro"),
      "Booking action rejected the reservation.",
    );
    const token = destination.searchParams.get("recibo");
    assert(token, "Signed booking receipt missing.");
    const claims = readDetailedReceipt(token, slug, gatewaySecret!);
    assert(claims, "Booking receipt signature failed.");
    await response.body?.cancel();
    return { destination, claims };
  }
  try {
    phase = "verify synthetic owner and tenant";
    const login = await db.auth.signInWithPassword({
      email: ownerEmail,
      password,
    });
    assert(!login.error && login.data.user, "DEMO owner login failed.");
    const result = await db
      .from("companies")
      .select("id,is_demo,booking_slug,booking_enabled,status,trial_ends_at");
    assert(
      !result.error && result.data?.length === 1,
      "Owner tenant verification failed.",
    );
    const company = result.data[0];
    assert.equal(company.id, companyId);
    assert.equal(company.is_demo, true);
    assert.equal(company.booking_slug, slug);
    assert.equal(company.booking_enabled, true);
    assert.equal(company.status, "trialing");
    assert(
      company.trial_ends_at && Date.parse(company.trial_ends_at) > Date.now(),
    );
    const membership = await db
      .from("memberships")
      .select("role")
      .eq("company_id", companyId)
      .eq("user_id", login.data.user.id)
      .single();
    assert(
      !membership.error && membership.data?.role === "OWNER",
      "Owner role verification failed.",
    );
    const previous = await db
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("phone", manifest.phone);
    assert(
      !previous.error && previous.count === 0,
      "Synthetic phone must not match any existing customer.",
    );
    pass("real DEMO owner, correct tenant and unused fictitious customer");

    phase = "find a free slot within the existing trial";
    const catalogResult = await publicDb.rpc("public_catalog", { slug });
    assert(
      !catalogResult.error &&
        catalogResult.data?.is_demo === true &&
        catalogResult.data.slug === slug,
    );
    const catalog = catalogResult.data as {
      services: { id: string; name: string; duration: number }[];
      professionals: { id: string; name: string }[];
    };
    assert(catalog.services.length && catalog.professionals.length);
    const service = catalog.services[0];
    let selected:
      | { day: string; startsAt: string; professional: string }
      | undefined;
    for (let offset = 1; offset <= 3 && !selected; offset++) {
      const day = addDays(saoPauloDay(), offset);
      if (day >= "2026-10-25") break;
      for (const professional of catalog.professionals) {
        const slots = await publicDb.rpc("public_slots", {
          slug,
          service: service.id,
          professional: professional.id,
          day,
        });
        assert(!slots.error, "Public availability could not be read.");
        const slot = (slots.data as { starts_at: string }[] | null)?.find(
          (item) =>
            Date.parse(item.starts_at) > Date.now() &&
            Date.parse(item.starts_at) + service.duration * 60_000 <
              Date.parse(company.trial_ends_at),
        );
        if (slot) {
          selected = {
            day,
            startsAt: slot.starts_at,
            professional: professional.id,
          };
          break;
        }
      }
    }
    assert(
      selected,
      "No free DEMO slot before 25 October inside the existing trial.",
    );
    const bookingUrl = new URL(path, origin);
    for (const [name, value] of Object.entries({
      service: service.id,
      professional: selected.professional,
      day: selected.day,
    }))
      bookingUrl.searchParams.set(name, value);
    const page = await request(bookingUrl);
    assert.equal(page.status, 200);
    const html = await page.text();
    const source = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
      .map((match) => match[0])
      .find((form) => form.includes('name="request_id"'));
    assert(source, "Public reservation Server Action form absent.");
    const form = new FormData();
    const renderedSlots: string[] = [];
    for (const match of source.matchAll(/<input\b[^>]*>/g)) {
      const field = attributes(match[0]);
      if (field.type === "hidden" && field.name)
        form.append(field.name, field.value || "");
      if (field.name === "start_time") renderedSlots.push(field.value);
    }
    assert(
      [...form.keys()].some((key) => key.startsWith("$ACTION_ID_")),
      "Actual Next Server Action binding absent.",
    );
    assert(
      renderedSlots.some(
        (value) => Date.parse(value) === Date.parse(selected!.startsAt),
      ),
      "Selected free slot was not rendered by the public application.",
    );
    assert.equal(form.get("slug"), slug);
    assert.equal(form.get("service"), service.id);
    assert.equal(form.get("professional"), selected.professional);
    const requestId = form.get("request_id");
    assert(typeof requestId === "string" && /^[\da-f-]{36}$/.test(requestId));
    form.set("start_time", selected.startsAt);
    form.set("customer_name", String(manifest.marker));
    form.set("phone", String(manifest.phone));
    form.set("consent", "on");
    form.set("website", "");
    form.delete("whatsapp_consent");
    Object.assign(manifest, {
      requestId,
      startsAt: selected.startsAt,
      day: selected.day,
      serviceId: service.id,
      professionalId: selected.professional,
      status: "ready-to-submit",
    });
    await persist();
    pass("available slot rendered by Vercel inside the existing trial");

    phase = "submit one fictitious public reservation";
    const receipt = await postReceipt(bookingUrl, form);
    assert.equal(receipt.claims.request_id, requestId);
    assert.equal(
      Date.parse(receipt.claims.receipt.starts_at),
      Date.parse(selected.startsAt),
    );
    Object.assign(manifest, {
      appointmentId: receipt.claims.receipt.id,
      status: "created",
    });
    await persist();
    const stored = await db
      .from("appointments")
      .select(
        "id,company_id,customer_id,professional_id,service_id,status,starts_at",
      )
      .eq("company_id", companyId)
      .eq("id", receipt.claims.receipt.id)
      .single();
    assert(
      !stored.error && stored.data,
      "Created appointment was not visible to its authorized owner.",
    );
    assert.equal(stored.data.status, "scheduled");
    assert.equal(stored.data.professional_id, selected.professional);
    assert.equal(stored.data.service_id, service.id);
    const customer = await db
      .from("customers")
      .select("id,name,phone")
      .eq("company_id", companyId)
      .eq("id", stored.data.customer_id)
      .single();
    assert(
      !customer.error &&
        customer.data?.name === manifest.marker &&
        customer.data.phone === manifest.phone,
      "Stored customer differs from the explicit fictitious fixture.",
    );
    Object.assign(manifest, {
      customerId: stored.data.customer_id,
      status: "verified",
    });
    await persist();
    pass(
      "production Server Action persisted one appointment and fictitious customer in Supabase",
    );

    phase = "verify idempotency and public receipt";
    const replay = await postReceipt(bookingUrl, form);
    assert.equal(replay.claims.receipt.id, stored.data.id);
    const appointments = await db
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("customer_id", stored.data.customer_id);
    assert(
      !appointments.error && appointments.count === 1,
      "Replay created a duplicate appointment.",
    );
    const customers = await db
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("name", manifest.marker);
    assert(
      !customers.error && customers.count === 1,
      "Replay created a duplicate customer.",
    );
    const confirmation = await request(receipt.destination);
    assert.equal(confirmation.status, 200);
    const confirmationHtml = await confirmation.text();
    assert(
      confirmationHtml.includes("Adicionar ao calendário"),
      "Production confirmation did not render the signed receipt.",
    );
    pass("retry is idempotent and production renders the confirmed receipt");

    phase = "verify slot exclusion and unchanged trial";
    const slotsAfter = await publicDb.rpc("public_slots", {
      slug,
      service: service.id,
      professional: selected.professional,
      day: selected.day,
    });
    assert(!slotsAfter.error);
    assert(
      !(slotsAfter.data as { starts_at: string }[]).some(
        (item) => Date.parse(item.starts_at) === Date.parse(selected.startsAt),
      ),
      "Reserved slot is still offered.",
    );
    const after = await db
      .from("companies")
      .select("status,trial_ends_at")
      .eq("id", companyId)
      .single();
    assert(
      !after.error &&
        after.data?.status === company.status &&
        after.data.trial_ends_at === company.trial_ends_at,
      "Trial or commercial status changed unexpectedly.",
    );
    Object.assign(manifest, { status: "passed", checks: passed + 1 });
    await persist();
    pass(
      "reserved slot removed from availability; commercial status and trial preserved",
    );
    console.log(`Fixture manifest: ${manifestFile}`);
    console.log(
      `Appointment: ${stored.data.id}; customer: ${stored.data.customer_id}`,
    );
    console.log(
      "No WhatsApp consent, messages, email or payments. Only the fixture above was created; cleanup is explicit.",
    );
  } finally {
    await db.auth.signOut({ scope: "local" });
    console.log(
      `Verification stage: ${phase}; fixture manifest: ${manifestFile}`,
    );
  }
}

main().catch(() => {
  console.error(
    `FAIL deployment booking at stage: ${phase}. Sensitive details withheld; inspect only the explicit fixture manifest.`,
  );
  process.exitCode = 1;
});
