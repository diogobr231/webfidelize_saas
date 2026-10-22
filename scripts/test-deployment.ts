import assert from "node:assert/strict";

/** Read-only smoke test for the production origin explicitly authorized here. */
const authorizedOrigin = "https://webfidelize-saas.vercel.app";
assert.equal(
  process.env.TEST_DEPLOYMENT_LIVE,
  "1",
  "Defina TEST_DEPLOYMENT_LIVE=1 para autorizar os GETs de verificação.",
);
assert.equal(
  process.env.TEST_DEPLOYMENT_URL,
  authorizedOrigin,
  "TEST_DEPLOYMENT_URL deve ser exatamente a origem de produção autorizada.",
);

const demoSlugs = [
  "demo-salao",
  "demo-pet-shop",
  "demo-clinica",
  "demo-escritorio",
  "demo-restaurante",
  "demo-fornecedores",
  "demo-logistica",
  "demo-academia",
] as const;
const publicPaths = ["/", "/planos", "/entrar", "/diagnostico"] as const;
const segmentSlugs = demoSlugs.map((slug) => slug.slice(5));
const protectedPaths = [
  "/admin",
  "/admin/comercial",
  "/admin/automacoes",
  "/admin/ia",
  "/painel",
] as const;
const allowedPaths = new Set<string>([
  ...publicPaths,
  ...protectedPaths,
  ...demoSlugs.map((slug) => `/agendar/${slug}`),
  ...segmentSlugs.flatMap((slug) => [
    `/segmentos/${slug}`,
    `/demonstracao/${slug}`,
  ]),
  "/demonstracao",
  "/robots.txt",
  "/sitemap.xml",
]);

function readableText(html: string) {
  return html
    .replace(/<(script|style|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:nbsp|#160|#xA0);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function requireSecurityHeaders(response: Response, path: string) {
  assert.equal(
    response.headers.get("x-content-type-options"),
    "nosniff",
    `${path}: proteção de tipo de conteúdo ausente.`,
  );
  assert.equal(
    response.headers.get("x-frame-options"),
    "DENY",
    `${path}: proteção contra incorporação ausente.`,
  );
  assert.equal(
    response.headers.get("referrer-policy"),
    "strict-origin-when-cross-origin",
    `${path}: política de referência inesperada.`,
  );
  assert.match(
    response.headers.get("permissions-policy") || "",
    /camera=\(\), microphone=\(\), geolocation=\(\)/,
    `${path}: permissões do navegador não estão restritas.`,
  );
  assert.equal(
    response.headers.has("x-powered-by"),
    false,
    `${path}: não deve anunciar o framework.`,
  );
}

function requireNoStore(response: Response, path: string) {
  assert.match(
    response.headers.get("cache-control") || "",
    /(?:^|,)\s*no-store\b/,
    `${path}: resposta deve proibir armazenamento em cache.`,
  );
}

async function get(path: string) {
  assert(allowedPaths.has(path), "Rota fora da lista autorizada.");
  const url = new URL(path, authorizedOrigin);
  assert.equal(url.origin, authorizedOrigin);
  assert(!url.search && !url.hash && !url.username && !url.password);
  // No cookies, credentials, bypass tokens, redirects, forms or write methods.
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    credentials: "omit",
    headers: { "User-Agent": "WebFidelize-ReadOnly-Deployment-Smoke/1.0" },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `${path}: acesso recusado; nenhuma proteção será contornada.`,
    );
  }
  return response;
}

let passed = 0;
const failures: string[] = [];
async function verify(label: string, check: () => Promise<void>) {
  try {
    await check();
    passed += 1;
    console.log(`PASS ${label}`);
  } catch (error) {
    // Never print response bodies, cookies or credentials from the deployment.
    const message = error instanceof Error ? error.message : "Falha inesperada";
    failures.push(label);
    console.error(`FAIL ${label}: ${message}`);
  }
}

for (const path of publicPaths) {
  await verify(`página pública ${path}`, async () => {
    const response = await get(path);
    assert.equal(response.status, 200, `${path}: esperado HTTP 200.`);
    requireSecurityHeaders(response, path);
    assert.match(response.headers.get("content-type") || "", /^text\/html\b/i);
    if (path !== "/") requireNoStore(response, path);
    const html = await response.text();
    const text = readableText(html);
    assert.match(text, /Web Fidelize/i, `${path}: marca ausente.`);
    assert.equal(
      [...html.matchAll(/<h1\b/gi)].length,
      1,
      `${path}: deve haver um único título principal.`,
    );
    assert.doesNotMatch(
      text,
      /Application error:|Internal Server Error|Ambiente em implantação\. A conexão segura|Catálogo temporariamente indisponível/,
      `${path}: a página exibiu erro de aplicação ou configuração.`,
    );
    if (path === "/" || path === "/planos") {
      for (const plan of ["Essencial", "Profissional", "Empresarial"]) {
        assert(text.includes(plan), `${path}: plano ${plan} ausente.`);
      }
      for (const price of ["49,90", "89,90", "149,90"]) {
        assert(text.includes(price), `${path}: preço ${price} ausente.`);
      }
      assert.match(text, /Cartão obrigatório|exigem cartão cadastrado/i);
      assert.match(text, /ativação[\s\S]{0,100}em preparação/i);
      assert.match(html, /href="\/demonstracao"/);
      assert.match(html, /https:\/\/wa\.me\/5518997695445/);
    }
    if (path === "/entrar") {
      assert.match(html, /name="email"/);
      assert.match(html, /name="password"/);
      assert.match(html, /href="\/recuperar"/);
    }
    if (path === "/diagnostico") {
      assert.match(text, /implantação/i);
      assert.match(html, /<form\b/i);
      assert.match(html, /name="consent"/);
    }
    if (path !== "/entrar") {
      const canonical = html.match(/<link\b[^>]*rel="canonical"[^>]*>/i)?.[0];
      assert(canonical, `${path}: canonical ausente.`);
      const href = canonical.match(/href="([^"]+)"/)?.[1];
      assert(href && new URL(href).origin === authorizedOrigin);
      assert.equal(new URL(href).pathname, path);
    }
  });
}

for (const slug of segmentSlugs) {
  await verify(`benefícios e demonstração pública ${slug}`, async () => {
    for (const prefix of ["segmentos", "demonstracao"]) {
      const path = `/${prefix}/${slug}`;
      const response = await get(path);
      assert.equal(response.status, 200);
      requireSecurityHeaders(response, path);
      const html = await response.text();
      assert.equal([...html.matchAll(/<h1\b/gi)].length, 1);
      if (prefix === "segmentos") {
        assert(html.includes(`href="/demonstracao/${slug}"`));
        assert(html.includes(`href="/entrar/${slug}"`));
      } else {
        assert.match(html, /name="robots"[^>]*content="noindex/);
        assert.match(readableText(html), /Criar agendamento de exemplo/);
        assert.doesNotMatch(html, /name="(?:password|email|phone)"/);
      }
    }
  });
}

await verify("seletor oferece os oito segmentos igualmente", async () => {
  const response = await get("/demonstracao");
  assert.equal(response.status, 200);
  const html = await response.text();
  for (const slug of segmentSlugs) {
    assert(html.includes(`href="/demonstracao/${slug}"`));
  }
});

for (const path of protectedPaths) {
  await verify(`acesso anônimo protegido ${path}`, async () => {
    const response = await get(path);
    assert(
      [302, 303, 307, 308].includes(response.status),
      "Esperado redirecionamento.",
    );
    requireSecurityHeaders(response, path);
    requireNoStore(response, path);
    const location = response.headers.get("location");
    assert(location, "Destino de autenticação ausente.");
    const target = new URL(location, authorizedOrigin);
    assert.equal(target.origin, authorizedOrigin);
    assert.equal(target.pathname, "/entrar");
    await response.body?.cancel();
  });
}

for (const slug of demoSlugs) {
  const path = `/agendar/${slug}`;
  await verify(`agendamento ${slug}`, async () => {
    const response = await get(path);
    assert.equal(
      response.status,
      200,
      `${path}: esperado catálogo disponível.`,
    );
    requireSecurityHeaders(response, path);
    requireNoStore(response, path);
    const html = await response.text();
    const text = readableText(html);
    assert.match(
      text,
      /demonstração/i,
      "DEMO deve identificar os dados fictícios.",
    );
    assert.match(html, /<h1\b/i);
    assert.match(html, /name="service"/);
    assert.match(html, /name="professional"/);
    assert.match(html, /name="day"/);
    assert.doesNotMatch(
      text,
      /Catálogo temporariamente indisponível|Internal Server Error/,
    );
  });
}

await verify("SEO usa a origem de produção", async () => {
  const robots = await get("/robots.txt");
  assert.equal(robots.status, 200);
  const robotsText = await robots.text();
  assert(robotsText.includes(`Sitemap: ${authorizedOrigin}/sitemap.xml`));
  for (const path of ["/admin", "/painel", "/agendar/"]) {
    assert(robotsText.includes(`Disallow: ${path}`));
  }
  const sitemap = await get("/sitemap.xml");
  assert.equal(sitemap.status, 200);
  const sitemapText = await sitemap.text();
  assert(sitemapText.includes(`<loc>${authorizedOrigin}/</loc>`));
  assert.doesNotMatch(sitemapText, /localhost|127\.0\.0\.1/);
});

console.log(
  `\n${passed} grupos passaram; ${failures.length} falharam. Apenas GETs anônimos, sem envio de formulários.`,
);
if (failures.length) process.exitCode = 1;
