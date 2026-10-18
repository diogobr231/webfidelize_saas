import assert from "node:assert/strict";

try {
  process.loadEnvFile(".env.local");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

// SEO exports are evaluated eagerly; load deployment configuration first.
const { resolveSite, siteTitle, siteDescription } = await import(
  "../src/lib/seo"
);
const expectedSite = resolveSite(process.env.APP_URL, process.env.VERCEL_ENV);
const base = new URL(process.env.TEST_BASE_URL || "http://localhost:3000");
assert(
  ["http:", "https:"].includes(base.protocol) &&
    !base.username &&
    !base.password &&
    (base.hostname === "localhost" ||
      base.hostname.endsWith(".localhost") ||
      base.hostname === "[::1]" ||
      /^127\./.test(base.hostname)),
  "TEST_BASE_URL deve apontar para o servidor local de produção, sem credenciais.",
);

function decodeEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
  };
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,
    (entity, key: string) => {
      if (!key.startsWith("#")) return named[key.toLowerCase()] || entity;
      const code =
        key[1].toLowerCase() === "x"
          ? Number.parseInt(key.slice(2), 16)
          : Number.parseInt(key.slice(1), 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    },
  );
}

function attributes(tag: string) {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(
    /([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
  )) {
    result[match[1].toLowerCase()] = decodeEntities(
      match[2] ?? match[3] ?? match[4],
    );
  }
  return result;
}

function readableText(markup: string) {
  return decodeEntities(
    markup
      .replace(/<(script|style|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function metadata(html: string, name: string) {
  const matches = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map(([tag]) => attributes(tag))
    .filter((attrs) => attrs.name === name || attrs.property === name);
  assert.equal(matches.length, 1, `Metadado único esperado: ${name}.`);
  assert(matches[0].content, `Metadado vazio: ${name}.`);
  return matches[0].content;
}

async function get(path: string) {
  const url = new URL(path, base);
  assert.equal(
    url.origin,
    base.origin,
    "O teste só pode realizar GETs locais.",
  );
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(response.status, 200, `GET ${url.pathname} deve responder 200.`);
  return response;
}

let passed = 0;
function pass(description: string) {
  passed += 1;
  console.log(`PASS ${description}`);
}

const responses = await Promise.all([
  get("/"),
  get("/robots.txt"),
  get("/sitemap.xml"),
  get("/entrar"),
]);
assert.match(responses[0].headers.get("content-type") || "", /^text\/html\b/i);
const [home, robots, sitemap, login] = await Promise.all(
  responses.map((response) => response.text()),
);

const headings = [...home.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
assert.equal(headings.length, 1, "A landing deve ter um único H1.");
assert.equal(
  readableText(headings[0][1]),
  "Sua agenda organizada. Seu cliente mais perto.",
  "O H1 deve comunicar a proposta principal da página.",
);
const anchors: Array<Record<string, string>> = [
  ...home.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi),
].map((match) => ({ ...attributes(match[1]), text: readableText(match[2]) }));
const trialLinks = anchors.filter(
  (anchor) => anchor.text === "Testar grátis por 7 dias",
);
assert(
  trialLinks.length >= 2,
  "O CTA de teste deve estar disponível ao longo da página.",
);
for (const anchor of trialLinks) {
  const url = new URL(anchor.href, base);
  assert.equal(
    url.origin,
    base.origin,
    "CTA de cadastro deve continuar no aplicativo.",
  );
  assert.equal(
    url.pathname,
    "/cadastro",
    "CTA de teste deve abrir o cadastro.",
  );
  assert.equal(
    url.search,
    "",
    "CTA de teste deve apontar diretamente para o cadastro.",
  );
}
const whatsappLinks = anchors.filter((anchor) => {
  try {
    return new URL(anchor.href, base).hostname === "wa.me";
  } catch {
    return false;
  }
});
assert.equal(
  anchors.some((anchor) =>
    new URL(anchor.href, base).pathname.startsWith("/agendar/demo-"),
  ),
  false,
  "A landing não deve depender de empresas de demonstração com trial que expira.",
);
assert(
  whatsappLinks.length > 0,
  "O contato comercial por WhatsApp deve estar disponível.",
);
for (const anchor of whatsappLinks) {
  const url = new URL(anchor.href);
  assert.equal(url.protocol, "https:");
  assert.equal(
    url.pathname,
    "/5518997695445",
    "WhatsApp deve usar o número comercial autorizado.",
  );
}
pass("H1 único, CTA de 7 dias para cadastro e contato comercial correto");

const ids = new Set(
  [...home.matchAll(/<[^>]+\bid\s*=\s*["']([^"']+)["'][^>]*>/gi)].map((match) =>
    decodeEntities(match[1]),
  ),
);
const fragmentLinks = anchors.filter((anchor) => anchor.href?.startsWith("#"));
assert(
  fragmentLinks.length > 0,
  "A navegação deve oferecer atalhos para as seções.",
);
for (const anchor of fragmentLinks) {
  assert(
    ids.has(decodeURIComponent(anchor.href.slice(1))),
    "Todo fragmento de navegação deve existir na página.",
  );
}
for (const section of ["como-funciona", "recursos", "planos", "duvidas"]) {
  assert(
    fragmentLinks.some((anchor) => anchor.href === `#${section}`),
    `Navegação ausente: ${section}.`,
  );
}
pass("Navegação e atalhos apontam para seções existentes");

const title = [...home.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)];
assert.equal(title.length, 1, "A landing deve publicar um título único.");
assert.equal(readableText(title[0][1]), siteTitle);
assert.equal(metadata(home, "description"), siteDescription);
const canonical = [...home.matchAll(/<link\b[^>]*>/gi)]
  .map(([tag]) => attributes(tag))
  .filter((attrs) => attrs.rel === "canonical");
assert.equal(canonical.length, 1, "A landing deve ter uma URL canônica única.");
assert.equal(new URL(canonical[0].href).href, expectedSite.url.href);
assert.equal(metadata(home, "og:title"), siteTitle);
assert.equal(metadata(home, "og:description"), siteDescription);
assert.equal(new URL(metadata(home, "og:url")).href, expectedSite.url.href);
assert.equal(metadata(home, "og:type"), "website");
assert.equal(metadata(home, "og:site_name"), "Web Fidelize");
assert.equal(metadata(home, "og:locale"), "pt_BR");
assert.equal(metadata(home, "twitter:card"), "summary_large_image");
assert.equal(metadata(home, "twitter:title"), siteTitle);
assert.equal(metadata(home, "twitter:description"), siteDescription);
pass("Título, descrição, canônica, Open Graph e Twitter publicados no HTML");

const schemas = [...home.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter((match) => attributes(match[1]).type === "application/ld+json")
  .map((match) => JSON.parse(match[2]) as unknown);
assert(schemas.length > 0, "Dados estruturados devem estar presentes.");
const structuredNodes: Record<string, unknown>[] = [];
function inspectSchema(value: unknown) {
  if (Array.isArray(value)) {
    value.forEach(inspectSchema);
    return;
  }
  if (!value || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  structuredNodes.push(node);
  for (const [key, child] of Object.entries(node)) {
    assert(
      !/^(review|reviews|aggregateRating|offers)$/i.test(key),
      "Não publicar avaliações ou ofertas não comprovadas no schema.",
    );
    if (key === "@type") {
      const types = Array.isArray(child) ? child : [child];
      assert(
        !types.some(
          (type) =>
            typeof type === "string" &&
            /^(Review|AggregateRating|Offer|AggregateOffer)$/i.test(type),
        ),
        "O schema não deve inventar avaliações ou ofertas.",
      );
    }
    inspectSchema(child);
  }
}
schemas.forEach(inspectSchema);
for (const type of ["WebSite", "Organization"]) {
  const node = structuredNodes.find((candidate) => candidate["@type"] === type);
  assert(node, `Schema obrigatório ausente: ${type}.`);
  assert.equal(node.name, "Web Fidelize");
  assert.equal(node.url, expectedSite.url.href);
}
pass("Schema WebSite e Organization sem avaliações ou ofertas inventadas");

const ogImage = new URL(metadata(home, "og:image"), expectedSite.url);
assert.equal(
  ogImage.origin,
  expectedSite.url.origin,
  "Imagem OG deve pertencer ao site configurado.",
);
assert.equal(metadata(home, "og:image:type"), "image/png");
assert.equal(metadata(home, "og:image:width"), "1200");
assert.equal(metadata(home, "og:image:height"), "630");
assert.equal(
  new URL(metadata(home, "twitter:image"), expectedSite.url).href,
  ogImage.href,
);
// Keep the request local even when APP_URL names the production domain.
const imageResponse = await get(`${ogImage.pathname}${ogImage.search}`);
assert.match(imageResponse.headers.get("content-type") || "", /^image\/png\b/i);
const png = Buffer.from(await imageResponse.arrayBuffer());
assert(png.length >= 33, "Imagem OG deve conter um cabeçalho PNG completo.");
assert.deepEqual(
  png.subarray(0, 8),
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
);
assert.equal(
  png.readUInt32BE(8),
  13,
  "O primeiro chunk PNG deve conter IHDR válido.",
);
assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
assert.equal(
  png.readUInt32BE(16),
  1200,
  "A imagem OG entregue deve ter 1200px de largura.",
);
assert.equal(
  png.readUInt32BE(20),
  630,
  "A imagem OG entregue deve ter 630px de altura.",
);
pass("Imagem OG e Twitter responde PNG real de 1200 × 630");

const directives = robots
  .split(/\r?\n/)
  .map((line) => line.replace(/#.*/, "").trim().toLowerCase())
  .filter(Boolean);
assert(directives.includes("user-agent: *"));
if (!expectedSite.indexable) {
  assert(
    directives.includes("disallow: /"),
    "Ambiente local ou preview deve bloquear toda indexação.",
  );
  assert(
    !directives.includes("allow: /"),
    "Robots local não deve liberar a raiz.",
  );
  assert(
    !directives.some((line) => line.startsWith("sitemap:")),
    "Ambiente não indexável não deve anunciar sitemap.",
  );
  assert(
    metadata(home, "robots")
      .split(/\s*,\s*/)
      .includes("noindex"),
  );
} else {
  for (const path of ["/painel", "/admin", "/entrar", "/agendar/"]) {
    assert(
      directives.includes(`disallow: ${path}`),
      "Robots deve excluir páginas privadas e agendamentos da indexação.",
    );
  }
}
pass("Robots respeita a configuração de indexação do ambiente");

assert.match(sitemap, /<urlset\b/i, "Sitemap deve ser XML válido com urlset.");
const locations = [...sitemap.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)].map(
  (match) => new URL(decodeEntities(match[1].trim())),
);
for (const url of locations) {
  assert.equal(url.origin, expectedSite.url.origin);
  assert(
    !/^\/(painel|admin|entrar|cadastro|auth|agendar|demo)(\/|$)/i.test(
      url.pathname,
    ),
    "Sitemap não pode publicar painéis, contas ou demonstrações.",
  );
  assert.equal(
    url.pathname,
    "/",
    "Somente a landing comercial deve constar no sitemap atual.",
  );
}
assert.equal(locations.length, expectedSite.indexable ? 1 : 0);
pass(
  expectedSite.indexable
    ? "Sitemap contém somente a landing comercial"
    : "Sitemap local vazio e sem páginas privadas ou demonstrações",
);

assert.match(responses[3].headers.get("content-type") || "", /^text\/html\b/i);
assert(
  metadata(login, "robots")
    .split(/\s*,\s*/)
    .includes("noindex"),
  "Login deve continuar fora dos índices de busca.",
);
pass("Página de login responde com noindex");

console.log(
  `${passed} grupos HTTP da landing aprovados; apenas leituras locais, sem cadastros ou mensagens.`,
);
