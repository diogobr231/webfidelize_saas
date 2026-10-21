import { createServerClient } from "@supabase/ssr";
import { niches } from "../src/lib/catalog";

// Read-only business validation. Login creates only isolated Auth sessions.
const enabled = process.env.TEST_NICHES_LIVE === "1";
const password = process.env.SEED_PASSWORD;
process.loadEnvFile(".env.local");
let phase = "configuration";
class TestFailure extends Error {}
function check(value: unknown, message: string): asserts value {
  if (!value) throw new TestFailure(message);
}
function decode(value: string) {
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
      decode(match[2]),
    ]),
  );
}
function visible(source: string) {
  return decode(
    source
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
      .replace(/<[^>]*>/g, " "),
  ).replace(/\s+/g, " ");
}
async function main() {
  const base = new URL(process.env.TEST_BASE_URL || "http://localhost:3000");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  check(
    enabled && password && url && key,
    "Enable TEST_NICHES_LIVE and provide the DEMO password only through the process.",
  );
  check(
    ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) &&
      ["http:", "https:"].includes(base.protocol) &&
      !base.username &&
      !base.password,
    "Only a local application server is allowed.",
  );
  let previousCompany = "",
    pages = 0,
    crossTenant = 0;
  for (const niche of niches) {
    phase = `${niche.slug}: login and tenant verification`;
    const email = `${niche.slug}@example.invalid`;
    const cookies = new Map<string, string>();
    const db = createServerClient(url, key, {
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
    async function request(path: string, body?: FormData) {
      const target = new URL(path, base);
      check(
        target.origin === base.origin,
        "Refusing cross-origin session transfer.",
      );
      check(
        !body || target.pathname === `/entrar/${niche.slug}`,
        "This suite may submit only the synthetic account's login form.",
      );
      const response = await fetch(target, {
        method: body ? "POST" : "GET",
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(45000),
        headers: {
          Accept: "text/html",
          Cookie: [...cookies]
            .map(([name, value]) => `${name}=${value}`)
            .join("; "),
          ...(body ? { Origin: base.origin, Referer: target.toString() } : {}),
        },
      });
      for (const header of response.headers.getSetCookie()) {
        const pair = header.split(";", 1)[0],
          at = pair.indexOf("=");
        if (at > 0) {
          const name = pair.slice(0, at),
            value = pair.slice(at + 1);
          value && !/max-age=0(?:;|$)/i.test(header)
            ? cookies.set(name, value)
            : cookies.delete(name);
        }
      }
      return response;
    }
    async function destination(response: Response) {
      let location = response.headers.get("location");
      if (response.status === 200) {
        const html = await response.text();
        const meta = [...html.matchAll(/<meta\b[^>]*>/g)]
          .map((match) => attributes(match[0]))
          .find(
            (item) =>
              item.id === "__next-page-redirect" &&
              item["http-equiv"]?.toLowerCase() === "refresh",
          );
        location =
          meta?.content?.match(/^\s*[01]\s*;\s*url=(.+)\s*$/i)?.[1] || null;
      }
      check(location, "Expected an explicit authenticated redirect.");
      const target = new URL(location, base);
      check(
        target.origin === base.origin,
        "Redirect origin is not the local app.",
      );
      return target;
    }
    try {
      const entry = await request(`/entrar/${niche.slug}`);
      check(entry.status === 200, "The segment entry page did not load.");
      const html = await entry.text();
      check(
        visible(html).includes(niche.name) &&
          visible(html).includes(
            "O acesso depende do seu vínculo com a empresa",
          ),
        "The niche entry must identify its segment and explain membership-based access.",
      );
      const source = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
        .map((match) => match[0])
        .find((form) => /name="password"/.test(form));
      check(source, "The niche login form is absent.");
      const login = new FormData();
      for (const match of source.matchAll(/<input\b[^>]*>/g)) {
        const input = attributes(match[0]);
        if (input.type === "hidden" && input.name)
          login.append(input.name, input.value || "");
      }
      check(
        [...login.keys()].some(
          (name) =>
            name.startsWith("$ACTION_ID_") || name.startsWith("$ACTION_REF_"),
        ),
        "The login Server Action binding is absent.",
      );
      login.set("email", email);
      login.set("password", password);
      login.set("next", "/painel");
      const signed = await destination(
        await request(`/entrar/${niche.slug}`, login),
      );
      check(
        signed.pathname === "/painel" && !signed.searchParams.has("erro"),
        "Synthetic niche login was not accepted.",
      );
      const identity = await db.auth.getUser();
      check(
        !identity.error && identity.data.user?.email === email,
        "The authenticated DEMO identity does not match the submitted login.",
      );
      const companies = await db
        .from("companies")
        .select("id,name,niche,is_demo,plan_id,status,trial_ends_at");
      check(
        !companies.error &&
          companies.data?.length === 1 &&
          companies.data[0].is_demo === true &&
          companies.data[0].niche === niche.slug,
        "Refusing to inspect an unexpected or non-DEMO company.",
      );
      const company = companies.data[0];
      const membership = await db
        .from("memberships")
        .select("role")
        .eq("company_id", company.id)
        .eq("user_id", identity.data.user.id)
        .single();
      check(
        !membership.error && membership.data?.role === "OWNER",
        "Expected the original DEMO OWNER membership.",
      );
      check(
        (await destination(await request("/painel"))).pathname ===
          `/painel/${company.id}`,
        "Login must open the actual member company.",
      );
      for (const path of [
        "",
        "/agenda?view=day",
        "/agenda?view=week",
        "/customers",
        "/services",
        "/professionals",
        "/configuracao",
        "/ajuda",
      ]) {
        phase = `${niche.slug}: ${path || "dashboard"}`;
        const response = await request(`/painel/${company.id}${path}`);
        check(
          response.status === 200,
          "A shared operational page did not load.",
        );
        const source = await response.text(),
          text = visible(source);
        check(
          !source.includes('id="__next-page-redirect"') &&
            text.includes(company.name) &&
            text.includes("Ambiente de demonstração."),
          "The page must show the authorized DEMO company without redirecting.",
        );
        check(
          !text.includes("Não foi possível carregar") &&
            !text.includes("Algo deu errado"),
          "An operational page returned a visible loading error.",
        );
        pages++;
      }
      if (previousCompany) {
        phase = `${niche.slug}: isolation`;
        const foreign = await db
          .from("companies")
          .select("id")
          .eq("id", previousCompany);
        check(
          !foreign.error && foreign.data?.length === 0,
          "A niche account can read the previous DEMO company.",
        );
        const denied = await destination(
          await request(`/painel/${previousCompany}/agenda`),
        );
        check(
          denied.pathname === "/painel" &&
            denied.searchParams.get("erro") === "acesso",
          "A known foreign agenda was not denied.",
        );
        crossTenant++;
      }
      const after = await db
        .from("companies")
        .select("id,name,niche,is_demo,plan_id,status,trial_ends_at")
        .eq("id", company.id)
        .single();
      check(
        !after.error && JSON.stringify(after.data) === JSON.stringify(company),
        "The read-only niche test changed company or commercial state.",
      );
      previousCompany = company.id;
      console.log(
        `PASS niche ${niche.slug}: actual login Server Action, OWNER tenant, 8 shared pages and unchanged company`,
      );
    } finally {
      await db.auth.signOut({ scope: "local" });
      cookies.clear();
    }
  }
  console.log(
    `${niches.length} niche login groups, ${pages} authenticated page checks and ${crossTenant} foreign-company denials passed. No business records or subscriptions were mutated. This verifies shared capabilities, not specialized niche modules.`,
  );
}
main().catch((error) => {
  console.error(
    `FAIL niche verification during ${phase}: ${error instanceof TestFailure ? error.message : "Unexpected test failure; details withheld to protect credentials."}`,
  );
  process.exitCode = 1;
});
