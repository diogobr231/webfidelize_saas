import { createServerClient } from "@supabase/ssr";
import { recordNamePattern, recordPagination } from "../src/lib/record-list";

// Read-only business-data checks against an explicitly selected local build.
// Creates an isolated synthetic-account auth session; never uses browser cookies.
const password = process.env.SEED_PASSWORD;
const enabled = process.env.TEST_RECORDS_LIVE === "1";
try {
  process.loadEnvFile(".env.local");
} catch {
  /* Validated below. */
}
const base = new URL(process.env.TEST_BASE_URL || "http://localhost:3000");
const email = process.env.DEMO_EMAIL || "salao@example.invalid";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
class TestFailure extends Error {}
function check(value: unknown, message: string): asserts value {
  if (!value) throw new TestFailure(message);
}
function decode(source: string) {
  return source
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'");
}
function visible(source: string) {
  return decode(
    source
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
      .replace(/<!--[^]*?-->/g, "")
      .replace(/<[^>]*>/g, " "),
  ).replace(/\s+/g, " ");
}

async function main() {
  check(
    enabled && password && url && key,
    "Enable TEST_RECORDS_LIVE=1 and supply the test password in the process environment.",
  );
  check(
    ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) &&
      ["http:", "https:"].includes(base.protocol) &&
      !base.username &&
      !base.password,
    "Only a local app server is allowed.",
  );
  check(
    email.endsWith("@example.invalid"),
    "Only a synthetic demo account is allowed.",
  );
  const cookies = new Map<string, string>();
  const db = createServerClient(url, key, {
    auth: { autoRefreshToken: false },
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: (items) => {
        for (const item of items) {
          if (!item.value || item.options.maxAge === 0)
            cookies.delete(item.name);
          else cookies.set(item.name, item.value);
        }
      },
    },
  });
  const signedIn = await db.auth.signInWithPassword({ email, password });
  check(
    !signedIn.error && signedIn.data.user,
    "The synthetic account could not sign in.",
  );
  let groups = 0;
  const pass = (message: string) => {
    groups++;
    console.log(`PASS ${message}`);
  };
  try {
    const membership = await db
      .from("memberships")
      .select("company_id")
      .eq("user_id", signedIn.data.user.id)
      .eq("role", "OWNER")
      .single();
    check(
      !membership.error && membership.data,
      "Expected a demo owner membership.",
    );
    const company = await db
      .from("companies")
      .select("id,is_demo")
      .eq("id", membership.data.company_id)
      .single();
    check(
      !company.error && company.data?.is_demo === true,
      "Expected an explicitly marked demo company.",
    );
    const companyId = company.data.id as string;
    async function page(path: string) {
      const target = new URL(path, base);
      check(
        target.origin === base.origin,
        "Refusing to send auth cookies to another origin.",
      );
      const response = await fetch(target, {
        redirect: "manual",
        headers: {
          Accept: "text/html",
          Cookie: [...cookies]
            .map(([name, value]) => `${name}=${value}`)
            .join("; "),
        },
        signal: AbortSignal.timeout(30_000),
      });
      check(response.status === 200, "Expected a successful records page.");
      const source = await response.text();
      check(
        !source.includes("__next-page-redirect"),
        "Records unexpectedly redirected.",
      );
      check(
        !visible(source).includes("Não foi possível concluir"),
        "Records query returned an error state.",
      );
      return source;
    }
    for (const section of ["customers", "services", "professionals"]) {
      const expected = await db
        .from(section)
        .select("id,name", { count: "exact" })
        .eq("company_id", companyId)
        .order("name")
        .order("id")
        .range(0, 24);
      check(
        !expected.error,
        "Failed to read expected authorized demo records.",
      );
      const path = `/painel/${companyId}/${section}`;
      const source = await page(path);
      const text = visible(source);
      check(
        source.includes('role="search"') && /maxlength="80"/i.test(source),
        "Expected a bounded accessible GET search.",
      );
      check(
        text.includes(
          `${(expected.count ?? 0).toLocaleString("pt-BR")} cadastrados`,
        ),
        "Count must match all authorized records, not only the current page.",
      );
      const table =
        source.match(
          /<table\b[^>]*class="records-table"[^>]*>[\s\S]*?<\/table>/,
        )?.[0] ?? "";
      const rows = [
        ...table.matchAll(
          /<td\b[^>]*class="record-name"[^>]*>([\s\S]*?)<\/td>/g,
        ),
      ].map((match) => visible(match[1]).trim());
      check(
        rows.length === expected.data?.length && rows.length <= 25,
        "Expected exactly one page of authorized records.",
      );
      check(
        expected.data?.every(
          (record, index) =>
            record.name.replace(/\s+/g, " ").trim() === rows[index],
        ),
        "Name/id ordering must match the database.",
      );
      check(
        !table ||
          (table.includes('role="table"') &&
            table.includes('data-label="Nome"')),
        "Mobile table semantics are missing.",
      );
      const last = recordPagination(10_000, expected.count ?? 0);
      const lastPage = visible(await page(`${path}?pagina=999999`));
      check(
        expected.count === 0 ||
          lastPage.includes(`Página ${last.page} de ${last.pages}`),
        "Out-of-range pages must clamp to an existing page.",
      );
      pass(
        `${section}: exact authorized totals, stable pagination and mobile semantics`,
      );
      const first = expected.data?.[0];
      if (first) {
        const search = first.name.slice(0, 80);
        const matching = await db
          .from(section)
          .select("id", { head: true, count: "exact" })
          .eq("company_id", companyId)
          .ilike("name", recordNamePattern(search));
        check(!matching.error, "Expected search query failed.");
        const result = await page(
          `${path}?${new URLSearchParams({ q: search, pagina: "999999" })}`,
        );
        check(
          visible(result).includes(
            `${(matching.count ?? 0).toLocaleString("pt-BR")} encontrados`,
          ),
          "Search must retain its own exact total when paginating.",
        );
        pass(`${section}: filtered search keeps authorized counts`);
      }
    }
    const empty = visible(
      await page(`/painel/${companyId}/customers?q=QA-NONE-${Date.now()}`),
    );
    check(
      empty.includes("Nenhum resultado para esta busca") &&
        empty.includes("0 encontrados"),
      "Expected a truthful empty search state.",
    );
    pass("empty search has a clear zero-result state");
    console.log(`Records: ${groups} read-only HTTP checks passed.`);
  } finally {
    await db.auth.signOut({ scope: "local" });
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof TestFailure
      ? error.message
      : "Read-only records verification failed; no business data was changed.",
  );
  process.exitCode = 1;
});
