import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  COVER_BUCKET,
  coverPathBelongsToCompany,
} from "../src/lib/company-personalization";

// Explicit opt-in, existing DEMO tenants only. Uses the official platform logo as
// an identifiable temporary fixture, never a fictional photo presented as real.
// Normal Server Actions + caller JWT/RLS; no service role or browser automation.
const optedIn = process.env.TEST_COVER_LIVE === "1";
const productionOptedIn = process.env.TEST_COVER_PRODUCTION === "1";
const origin = process.env.TEST_BASE_URL || "http://localhost:3000";
const companyId = "3f259c2b-27aa-4e64-9c81-443deb1d66b2";
const foreignCompanyId = "16415956-54ea-4973-97d9-5ff5ae3d3842";
type Session = { db: SupabaseClient; cookies: Map<string, string> };
class Failure extends Error {}
let phase = "configuration",
  groups = 0;
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Failure(message);
}
function pass(message: string) {
  groups++;
  console.log(`PASS live cover: ${message}`);
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
    [...tag.matchAll(/([\w$:-]+)\s*=\s*"([^"]*)"/g)].map((m) => [
      m[1],
      decode(m[2]),
    ]),
  );
function coverForm(html: string) {
  const source = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map((m) => m[0])
    .find((form) => form.includes('name="cover"'));
  check(source, "Owner cover form not rendered.");
  const body = new FormData();
  for (const match of source.matchAll(/<input\b[^>]*>/g)) {
    const field = attributes(match[0]);
    if (field.type === "hidden" && field.name)
      body.append(field.name, field.value || "");
  }
  check(
    [...body.keys()].some(
      (key) => key.startsWith("$ACTION_REF_") || key.startsWith("$ACTION_ID_"),
    ),
    "Real Server Action binding missing.",
  );
  return body;
}
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

async function main() {
  check(
    optedIn,
    "Set TEST_COVER_LIVE=1 to test only the authorized DEMO cover.",
  );
  const base = new URL(origin);
  const local =
    ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) &&
    base.protocol === "http:";
  check(
    !base.username &&
      !base.password &&
      base.pathname === "/" &&
      !base.search &&
      !base.hash &&
      (local ||
        (base.origin === "https://webfidelize-saas.vercel.app" &&
          productionOptedIn)),
    "Use localhost or explicitly opt in to the exact production origin with TEST_COVER_PRODUCTION=1.",
  );
  process.loadEnvFile(".env.local");
  const password = process.env.TEST_PLAN_ACCOUNTS_PASSWORD;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const gateway = process.env.BOOKING_GATEWAY_SECRET;
  check(
    password && supabaseUrl && key && gateway,
    "Secure local test configuration is incomplete.",
  );
  check(
    new URL(supabaseUrl).origin === "https://devmjeiblhrgjyaiaukm.supabase.co",
    "Refusing another Supabase project.",
  );
  function session(): Session {
    const cookies = new Map<string, string>();
    const db = createServerClient(supabaseUrl!, key!, {
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
  const owner = session(),
    foreign = session(),
    employee = session();
  const anonymous = createClient(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const route = `/painel/${companyId}/personalizacao`;
  let createdPath: string | null = null;
  let original: {
    cover_path: string | null;
    cover_published: boolean;
    booking_slug: string;
  } | null = null;
  async function request(
    client: Session | null,
    path: string,
    body?: FormData,
  ) {
    const url = new URL(path, base);
    check(
      url.origin === base.origin,
      "Refusing cross-origin session transfer.",
    );
    check(
      !body || url.pathname === route,
      "Only this DEMO personalization form may receive a POST.",
    );
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(45_000),
      headers: {
        Accept: "text/html",
        ...(client
          ? {
              Cookie: [...client.cookies]
                .map(([name, value]) => `${name}=${value}`)
                .join("; "),
            }
          : {}),
        ...(body ? { Origin: base.origin, Referer: url.toString() } : {}),
      },
    });
    if (client)
      for (const header of response.headers.getSetCookie()) {
        const pair = header.split(";", 1)[0],
          split = pair.indexOf("=");
        if (split > 0) {
          const name = pair.slice(0, split),
            value = pair.slice(split + 1);
          if (!value || /max-age=0(?:;|$)/i.test(header))
            client.cookies.delete(name);
          else client.cookies.set(name, value);
        }
      }
    const html = await response.text();
    check(
      !html.includes(gateway!),
      "Server capability leaked in rendered HTML.",
    );
    return { response, html };
  }
  async function render(body?: FormData) {
    const result = await request(owner, route, body);
    check(
      result.response.status === 200,
      "Owner personalization request did not render successfully.",
    );
    return result.html;
  }
  async function company() {
    const result = await owner.db
      .from("companies")
      .select(
        "id,is_demo,cover_path,cover_published,booking_slug,booking_enabled",
      )
      .eq("id", companyId)
      .single();
    check(
      !result.error && result.data?.is_demo,
      "Authorized DEMO company could not be confirmed.",
    );
    return result.data;
  }
  async function unchanged(path: string | null, published: boolean) {
    const current = await company();
    check(
      current.cover_path === path && current.cover_published === published,
      "Unexpected cover mutation.",
    );
  }
  async function denied(client: Session, body: FormData, expected: string) {
    const result = await request(client, route, body);
    const location = result.response.headers.get("location") || "";
    check(
      (result.response.status >= 300 &&
        result.response.status < 400 &&
        location.includes(expected)) ||
        (result.response.status === 200 &&
          result.html.includes("NEXT_REDIRECT") &&
          result.html.includes(expected)),
      "Unauthorized Server Action did not enforce membership and OWNER permissions.",
    );
  }
  try {
    phase = "authorized demo authentication";
    for (const [client, email, expectedCompany, role] of [
      [owner, "salao@example.invalid", companyId, "OWNER"],
      [foreign, "escritorio@example.invalid", foreignCompanyId, "OWNER"],
      [
        employee,
        "empresarial.colaborador@example.invalid",
        companyId,
        "EMPLOYEE",
      ],
    ] as const) {
      const login = await client.db.auth.signInWithPassword({
        email,
        password,
      });
      check(
        !login.error && login.data.user,
        "Existing authorized DEMO account could not sign in.",
      );
      const membership = await client.db
        .from("memberships")
        .select("role")
        .eq("company_id", expectedCompany)
        .eq("user_id", login.data.user.id)
        .single();
      const demo = await client.db
        .from("companies")
        .select("is_demo")
        .eq("id", expectedCompany)
        .single();
      check(
        membership.data?.role === role && demo.data?.is_demo,
        "DEMO account role or tenant guard failed.",
      );
    }
    const before = await company();
    check(
      !before.cover_path && !before.cover_published,
      "Refusing to replace an existing cover; no mutation performed.",
    );
    check(
      before.booking_enabled && before.booking_slug,
      "Use the existing active DEMO booking page.",
    );
    original = {
      cover_path: before.cover_path,
      cover_published: before.cover_published,
      booking_slug: before.booking_slug,
    };
    const fixture = await readFile("public/webfidelize-logo.png");
    let html = await render();
    check(
      html.includes("Foto do espaço"),
      "New cover interface was not rendered.",
    );
    pass("owner settings render and DEMO guards verified");

    phase = "unauthorized server actions";
    for (const [client, expected] of [
      [employee, "erro=permissao"],
      [foreign, "erro=acesso"],
    ] as const) {
      const unauthorized = coverForm(html);
      unauthorized.set(
        "cover",
        new File([fixture], "qa-temporary-webfidelize-brand.png", {
          type: "image/png",
        }),
      );
      unauthorized.set("cover_published", "on");
      await denied(client, unauthorized, expected);
      await unchanged(null, false);
    }
    pass("employee and foreign tenant cannot submit the owner's upload action");

    phase = "invalid file validation";
    const invalid = coverForm(html);
    invalid.set(
      "cover",
      new File(
        ['<svg xmlns="http://www.w3.org/2000/svg"/>'],
        "qa-invalid.png",
        { type: "image/png" },
      ),
    );
    const invalidHtml = await render(invalid);
    check(
      invalidHtml.includes("SVG e outros formatos não são aceitos"),
      "Server did not reject MIME-spoofed SVG.",
    );
    await unchanged(null, false);
    pass("invalid raster is rejected server-side without persisting");

    phase = "private real upload";
    const upload = coverForm(await render());
    upload.set(
      "cover",
      new File([fixture], "qa-temporary-webfidelize-brand.png", {
        type: "image/png",
      }),
    );
    html = await render(upload);
    const uploaded = await company();
    check(
      html.includes("Foto de capa salva") &&
        typeof uploaded.cover_path === "string" &&
        !uploaded.cover_published,
      "Private cover upload did not persist.",
    );
    createdPath = uploaded.cover_path;
    check(
      createdPath && coverPathBelongsToCompany(createdPath, companyId),
      "Unexpected uploaded object path.",
    );
    for (const client of [anonymous, foreign.db]) {
      check(
        (
          await client.storage
            .from(COVER_BUCKET)
            .createSignedUrl(createdPath, 60)
        ).error,
        "Another tenant or anonymous user signed an unpublished cover.",
      );
      check(
        !(await client.storage.from(COVER_BUCKET).list(companyId)).data?.length,
        "Private cover files were listed outside their tenant.",
      );
    }
    const privateCatalog = await anonymous.rpc("public_catalog", {
      slug: original.booking_slug,
    });
    check(
      !privateCatalog.error && privateCatalog.data?.cover_path === null,
      "Draft cover leaked into public catalog.",
    );
    const privateBooking = await request(
      null,
      `/agendar/${original.booking_slug}`,
    );
    check(
      privateBooking.response.status === 200 &&
        !privateBooking.html.includes(
          "/storage/v1/object/sign/company-covers/",
        ),
      "Draft cover was shown publicly.",
    );
    pass("actual upload stays private and tenant isolated");

    phase = "explicit publication and real asset";
    const publish = coverForm(await render());
    publish.set("cover_published", "on");
    html = await render(publish);
    check(
      html.includes("Foto de capa salva"),
      "Publication action did not confirm saving.",
    );
    await unchanged(createdPath, true);
    const catalog = await anonymous.rpc("public_catalog", {
      slug: original.booking_slug,
    });
    check(
      !catalog.error && catalog.data?.cover_path === createdPath,
      "Published exact cover missing from catalog.",
    );
    check(
      !(await anonymous.storage.from(COVER_BUCKET).list(companyId)).data
        ?.length,
      "Anonymous listing became available after publication.",
    );
    const signed = await anonymous.storage
      .from(COVER_BUCKET)
      .createSignedUrl(createdPath, 60);
    check(
      !signed.error && signed.data?.signedUrl,
      "Published cover could not be signed.",
    );
    const imageUrl = new URL(signed.data.signedUrl);
    check(
      imageUrl.origin === new URL(supabaseUrl).origin,
      "Unexpected signed asset origin.",
    );
    const image = await fetch(imageUrl, {
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
    check(
      image.ok && image.headers.get("content-type")?.includes("image/png"),
      "Storage did not serve a PNG.",
    );
    check(
      hash(new Uint8Array(await image.arrayBuffer())) === hash(fixture),
      "Downloaded cover does not match the exact temporary fixture bytes.",
    );
    const booking = await request(null, `/agendar/${original.booking_slug}`);
    check(
      booking.response.status === 200 &&
        booking.html.includes('class="booking-cover"') &&
        booking.html.includes("/storage/v1/object/sign/company-covers/") &&
        booking.html.includes("DEMONSTRAÇÃO"),
      "Public booking did not render the signed cover and DEMO notice.",
    );
    pass("publication renders a real signed cover with exact verified bytes");

    phase = "unpublish and restore";
    await render(coverForm(await render()));
    await unchanged(createdPath, false);
    check(
      (
        await anonymous.storage
          .from(COVER_BUCKET)
          .createSignedUrl(createdPath, 60)
      ).error,
      "Unpublished cover still accepts a new anonymous signature.",
    );
    const hiddenBooking = await request(
      null,
      `/agendar/${original.booking_slug}`,
    );
    check(
      hiddenBooking.response.status === 200 &&
        !hiddenBooking.html.includes("/storage/v1/object/sign/company-covers/"),
      "Unpublished cover remains on the page.",
    );
    pass("unpublishing revokes new signatures and removes the public cover");
    const remove = coverForm(await render());
    remove.set("remove_cover", "on");
    html = await render(remove);
    check(
      html.includes("Foto de capa removida"),
      "Removal action did not confirm completion.",
    );
    await unchanged(original.cover_path, original.cover_published);
    const remaining = await owner.db.storage.from(COVER_BUCKET).list(companyId);
    check(
      !remaining.error &&
        !remaining.data?.some(
          (file) => `${companyId}/${file.name}` === createdPath,
        ),
      "Temporary object remained after removal.",
    );
    createdPath = null;
    pass("normal removal restores original DEMO state and cleans the fixture");
  } finally {
    try {
      if (createdPath && original) {
        const current = await company();
        if (current.cover_path === createdPath) {
          const restore = await owner.db.rpc("configure_company_cover", {
            c: companyId,
            path: original.cover_path,
            published: original.cover_published,
            gateway_secret: gateway,
            expected_path: createdPath,
          });
          check(
            !restore.error,
            "Could not restore the DEMO cover; manual cleanup of this test fixture is needed.",
          );
        }
        // Never delete a concurrent owner's replacement or a preexisting object.
        check(
          coverPathBelongsToCompany(createdPath, companyId),
          "Cleanup path does not belong to this DEMO tenant.",
        );
        const cleanup = await owner.db.storage
          .from(COVER_BUCKET)
          .remove([createdPath]);
        check(!cleanup.error, "Could not remove this run's fixture object.");
      }
    } finally {
      await Promise.allSettled([
        owner.db.auth.signOut({ scope: "local" }),
        foreign.db.auth.signOut({ scope: "local" }),
        employee.db.auth.signOut({ scope: "local" }),
      ]);
    }
  }
  console.log(`${groups} real cover HTTP / Storage groups passed`);
}
main().catch((error) => {
  console.error(
    `FAIL ${phase}: ${error instanceof Failure ? error.message : "Unexpected integration failure (details withheld to avoid credential logging)."}`,
  );
  process.exitCode = 1;
});
