import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { LOGO_BUCKET } from "../src/lib/company-personalization";

// Explicit opt-in. Uses a synthetic company and removes only this run's image.
const password = process.env.SEED_PASSWORD;
const optedIn = process.env.TEST_PERSONALIZATION_LIVE === "1";
process.loadEnvFile(".env.local");
let phase = "configuration",
  groups = 0;
class TestFailure extends Error {}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TestFailure(message);
}
function pass(message: string) {
  groups++;
  console.log(`PASS ${message}`);
}
const decode = (value: string) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
function attributes(tag: string) {
  return Object.fromEntries(
    [...tag.matchAll(/([\w$:-]+)\s*=\s*"([^"]*)"/g)].map((m) => [
      m[1],
      decode(m[2]),
    ]),
  );
}
function actionForm(html: string, field: string) {
  const source = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map((m) => m[0])
    .find((form) => form.includes(`name="${field}"`));
  check(source, "Expected personalization form was not rendered.");
  const result = new FormData();
  for (const match of source.matchAll(/<input\b[^>]*>/g)) {
    const input = attributes(match[0]);
    if (input.type === "hidden" && input.name)
      result.append(input.name, input.value || "");
  }
  check(
    [...result.keys()].some(
      (key) => key.startsWith("$ACTION_REF_") || key.startsWith("$ACTION_ID_"),
    ),
    "Server Action bindings missing.",
  );
  return result;
}

async function main() {
  check(
    optedIn,
    "Set TEST_PERSONALIZATION_LIVE=1 to run against a synthetic company.",
  );
  const base = new URL(process.env.TEST_BASE_URL || "http://localhost:3000");
  const email =
    process.env.PERSONALIZATION_DEMO_EMAIL || "escritorio@example.invalid";
  const foreignEmail = "clinica@example.invalid";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const gateway = process.env.BOOKING_GATEWAY_SECRET;
  check(
    ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) &&
      !base.username &&
      !base.password,
    "Use a local app server.",
  );
  check(
    email.endsWith("@example.invalid") && email !== foreignEmail,
    "Use a synthetic demo owner distinct from the foreign tenant.",
  );
  check(
    password && supabaseUrl && key && gateway,
    "Configure public Supabase settings and provide SEED_PASSWORD through the process.",
  );
  const cookies = new Map<string, string>();
  const db = createServerClient(supabaseUrl, key, {
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
  const anonymous = createClient(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const foreign = createClient(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let companyId = "",
    createdPath: string | null = null;
  async function request(path: string, form?: FormData) {
    const target = new URL(path, base);
    check(
      target.origin === base.origin,
      "Refusing cross-origin session transfer.",
    );
    const response = await fetch(target, {
      method: form ? "POST" : "GET",
      body: form,
      headers: {
        Accept: "text/html",
        Cookie: [...cookies]
          .map(([name, value]) => `${name}=${value}`)
          .join("; "),
        ...(form ? { Origin: base.origin } : {}),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(45000),
    });
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";", 1)[0],
        split = pair.indexOf("=");
      if (split > 0) cookies.set(pair.slice(0, split), pair.slice(split + 1));
    }
    check(
      response.status === 200,
      "Personalization request did not render successfully.",
    );
    return response.text();
  }
  async function company() {
    const result = await db
      .from("companies")
      .select(
        "id,is_demo,logo_path,logo_published,booking_slug,booking_enabled",
      )
      .eq("id", companyId)
      .single();
    check(
      !result.error && result.data?.is_demo,
      "Synthetic tenant could not be confirmed.",
    );
    return result.data;
  }
  try {
    phase = "demo authentication";
    check(
      !(await db.auth.signInWithPassword({ email, password })).error,
      "Demo sign-in failed.",
    );
    check(
      !(
        await foreign.auth.signInWithPassword({ email: foreignEmail, password })
      ).error,
      "Foreign demo sign-in failed.",
    );
    const {
      data: { user },
    } = await db.auth.getUser();
    check(user, "Demo owner not authenticated.");
    const memberships = await db
      .from("memberships")
      .select("company_id")
      .eq("user_id", user.id)
      .eq("role", "OWNER");
    check(
      !memberships.error && memberships.data?.length === 1,
      "Expected exactly one demo company.",
    );
    companyId = memberships.data[0].company_id;
    const original = await company();
    check(
      !original.logo_path && !original.logo_published,
      "Refusing to replace a preexisting demo logo.",
    );
    check(
      original.booking_enabled && original.booking_slug,
      "Use a demo company with public booking already enabled.",
    );
    const route = `/painel/${companyId}/personalizacao`;
    let html = await request(route);
    check(
      html.includes("Personalize seu espaço."),
      "Personalization page missing.",
    );
    pass("owner page loads with actual company settings");

    phase = "server form validation";
    const invalidSettings = actionForm(html, "name");
    for (const [field, value] of Object.entries({
      name: "Rascunho fictício não salvo",
      description: "",
      address: "",
      phone: "inválido",
      theme: "teal",
      density: "comfortable",
      agenda_view: "day",
    }))
      invalidSettings.set(field, value);
    const invalidSettingsHtml = await request(route, invalidSettings);
    check(
      invalidSettingsHtml.includes("Revise os campos indicados") &&
        invalidSettingsHtml.includes('value="Rascunho fictício não salvo"'),
      "Server validation did not preserve the submitted draft.",
    );
    pass("server validation retains the unsaved company form");

    phase = "server raster validation";
    const invalid = actionForm(html, "logo");
    invalid.set(
      "logo",
      new File(
        ['<svg xmlns="http://www.w3.org/2000/svg"/>'],
        "fictitious-invalid.png",
        { type: "image/png" },
      ),
    );
    html = await request(route, invalid);
    check(
      html.includes("SVG e outros formatos não são aceitos"),
      "Invalid raster was not rejected by the server.",
    );
    check(
      !(await company()).logo_path,
      "Invalid file changed the logo pointer.",
    );
    pass("SVG spoofed as PNG is rejected without saving");

    phase = "private logo upload";
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    );
    const upload = actionForm(await request(route), "logo");
    upload.set(
      "logo",
      new File([png], "fictitious-logo-test.png", { type: "image/png" }),
    );
    html = await request(route, upload);
    const privateCompany = await company();
    createdPath = privateCompany.logo_path;
    check(
      html.includes("Logotipo salvo") &&
        createdPath &&
        !privateCompany.logo_published,
      "Private logo upload did not persist.",
    );
    check(
      (
        await anonymous.storage
          .from(LOGO_BUCKET)
          .createSignedUrl(createdPath, 60)
      ).error,
      "Anonymous access to private logo was allowed.",
    );
    check(
      (await foreign.storage.from(LOGO_BUCKET).createSignedUrl(createdPath, 60))
        .error,
      "Foreign company accessed the private logo.",
    );
    const list = await foreign.storage.from(LOGO_BUCKET).list(companyId);
    check(!list.data?.length, "Foreign company listed another tenant's files.");
    pass("real Storage upload remains private and tenant isolated");

    phase = "explicit public logo publication";
    const publish = actionForm(await request(route), "logo");
    publish.set("logo_published", "on");
    html = await request(route, publish);
    check(
      html.includes("Logotipo salvo") && (await company()).logo_published,
      "Publication was not confirmed by backend.",
    );
    const catalog = await anonymous.rpc("public_catalog", {
      slug: original.booking_slug,
    });
    check(
      !catalog.error && catalog.data?.logo_path === createdPath,
      "Catalog did not expose the explicitly published logo.",
    );
    const publicList = await anonymous.storage
      .from(LOGO_BUCKET)
      .list(companyId);
    check(
      !publicList.data?.length,
      "Anonymous listing must remain denied after publication.",
    );
    const signed = await anonymous.storage
      .from(LOGO_BUCKET)
      .createSignedUrl(createdPath, 60);
    check(
      !signed.error && signed.data?.signedUrl,
      "Published exact logo could not be signed.",
    );
    const assetUrl = new URL(signed.data.signedUrl);
    check(
      assetUrl.origin === new URL(supabaseUrl).origin,
      "Unexpected signed asset origin.",
    );
    const image = await fetch(assetUrl, { signal: AbortSignal.timeout(20000) });
    check(
      image.ok && image.headers.get("content-type")?.includes("image/png"),
      "Signed logo image was not served as a raster.",
    );
    await image.arrayBuffer();
    const booking = await request(`/agendar/${original.booking_slug}`);
    check(
      booking.includes("/storage/v1/object/sign/company-logos/") &&
        !booking.includes(gateway),
      "Public page did not render the signed logo safely.",
    );
    pass(
      "explicit publication renders a real signed image without public listing",
    );

    phase = "unpublish logo";
    html = await request(route, actionForm(await request(route), "logo"));
    check(
      html.includes("Logotipo salvo") && !(await company()).logo_published,
      "Unpublishing was not persisted.",
    );
    check(
      (
        await anonymous.storage
          .from(LOGO_BUCKET)
          .createSignedUrl(createdPath, 60)
      ).error,
      "Unpublished logo could still receive a new public signature.",
    );
    pass("unpublishing denies new public signatures");

    phase = "remove own test logo";
    const remove = actionForm(await request(route), "logo");
    remove.set("remove_logo", "on");
    html = await request(route, remove);
    check(
      html.includes("Logotipo removido") && !(await company()).logo_path,
      "Removal was not confirmed by backend.",
    );
    const remaining = await db.storage.from(LOGO_BUCKET).list(companyId);
    check(
      !remaining.data?.some(
        (entry) => `${companyId}/${entry.name}` === createdPath,
      ),
      "Removed logo file remained in Storage.",
    );
    createdPath = null;
    pass("removal restores the original demo state and cleans Storage");
  } finally {
    if (createdPath && companyId) {
      const current = await company();
      if (current.logo_path === createdPath) {
        const result = await db.rpc("configure_company_logo", {
          c: companyId,
          path: null,
          published: false,
          gateway_secret: gateway,
          expected_path: createdPath,
        });
        check(!result.error, "Could not restore this run's demo logo pointer.");
      }
      const deleted = await db.storage.from(LOGO_BUCKET).remove([createdPath]);
      check(!deleted.error, "Could not clean this run's demo image.");
    }
    await Promise.allSettled([
      db.auth.signOut({ scope: "local" }),
      foreign.auth.signOut({ scope: "local" }),
    ]);
  }
  console.log(`${groups} live personalization groups passed`);
}
main().catch((error) => {
  console.error(
    `FAIL ${phase}: ${error instanceof TestFailure ? error.message : "Unexpected integration failure (details withheld to avoid credential logging)."}`,
  );
  process.exitCode = 1;
});
