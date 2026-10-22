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

function links(html: string): Array<Record<string, string>> {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((match) => ({
    ...attributes(match[1]),
    text: readableText(match[2]),
  }));
}

function assertPng(png: Buffer, width: number, height: number) {
  assert(png.length >= 33, "A imagem deve conter um cabeçalho PNG completo.");
  assert.deepEqual(
    png.subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  assert.equal(png.readUInt32BE(8), 13, "Chunk IHDR deve ter tamanho válido.");
  assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
  assert.equal(png.readUInt32BE(16), width, "Largura da imagem entregue.");
  assert.equal(png.readUInt32BE(20), height, "Altura da imagem entregue.");
}

function localAssetPath(href: string) {
  const asset = new URL(href, base);
  assert(
    [base.origin, expectedSite.url.origin].includes(asset.origin),
    "Imagens da marca devem pertencer ao aplicativo.",
  );
  assert(!asset.username && !asset.password);
  // The metadata may name a production origin; the test still requests only localhost.
  return `${asset.pathname}${asset.search}`;
}

async function get(path: string, expectedStatus = 200) {
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
  assert.equal(
    response.status,
    expectedStatus,
    `GET ${url.pathname} deve responder ${expectedStatus}.`,
  );
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
  get("/planos"),
  get("/__qa_page_not_found__", 404),
  get("/cadastro"),
  get(`/cadastro?next=${encodeURIComponent(`/convite/${"a".repeat(64)}`)}`),
]);
assert.match(responses[0].headers.get("content-type") || "", /^text\/html\b/i);
const [home, robots, sitemap, login, plans, missing, signup, invitationSignup] =
  await Promise.all(responses.map((response) => response.text()));

const headings = [...home.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
assert.equal(headings.length, 1, "A landing deve ter um único H1.");
assert.equal(
  readableText(headings[0][1]),
  "Sua agenda organizada. Seu cliente mais perto.",
  "O H1 deve comunicar a proposta principal da página.",
);
const anchors = links(home);
const trialLinks = anchors.filter(
  (anchor) => anchor.text === "Experimentar demonstração",
);
assert(
  trialLinks.length >= 2,
  "O CTA de demonstração deve estar disponível ao longo da página.",
);
for (const anchor of trialLinks) {
  const url = new URL(anchor.href, base);
  assert.equal(
    url.origin,
    base.origin,
    "CTA de demonstração deve continuar no aplicativo.",
  );
  assert.equal(
    url.pathname,
    "/demonstracao",
    "CTA de demonstração deve abrir a demonstração.",
  );
  assert.equal(
    url.search,
    "",
    "CTA de demonstração deve apontar diretamente para a demonstração.",
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
pass("H1 único, CTA de demonstração sem login e contato comercial correto");

// Streamed loading fallbacks can also contain a Brand. Check the actual
// landing landmarks rather than counting every brand in the transport HTML.
const brandLandmarks = [
  ...resolvedHtmlFragments(home).matchAll(
    /<(header|footer)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
  ),
];
const brandImagePaths = new Set<string>();
for (const landmarkName of ["header", "footer"]) {
  const landmarks = brandLandmarks.filter(
    (match) =>
      match[1] === landmarkName &&
      attributes(match[2]).class?.split(/\s+/).includes(`wf-${landmarkName}`),
  );
  assert.equal(
    landmarks.length,
    1,
    `A landing deve entregar um ${landmarkName} identificável.`,
  );
  const brandedLinks = [
    ...landmarks[0][3].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi),
  ].filter(
    (match) => attributes(match[1])["aria-label"] === "Web Fidelize — início",
  );
  assert.equal(
    brandedLinks.length,
    1,
    `O ${landmarkName} deve oferecer a marca com nome acessível.`,
  );
  const link = brandedLinks[0];
  const images = [...link[2].matchAll(/<img\b[^>]*>/gi)].map(([tag]) =>
    attributes(tag),
  );
  assert.equal(images.length, 1, "Cada marca deve entregar uma imagem.");
  assert.equal(
    images[0].alt,
    "",
    "O nome da marca já pertence ao link, sem anúncio duplicado da imagem.",
  );
  assert(images[0].src, "A imagem da marca precisa de uma origem.");
  brandImagePaths.add(localAssetPath(images[0].src));
}
assert.deepEqual(
  [...brandImagePaths],
  ["/webfidelize-logo.png"],
  "Cabeçalho e rodapé devem usar a logo oficial hospedada no aplicativo.",
);
const brandResponse = await get([...brandImagePaths][0]);
assert.match(brandResponse.headers.get("content-type") || "", /^image\/png\b/i);
assertPng(Buffer.from(await brandResponse.arrayBuffer()), 1600, 533);
pass(
  "Logo oficial entregue no cabeçalho e rodapé, com PNG local de 1600 × 533",
);

const homeText = readableText(home);
assert.match(homeText, /demonstração sem login e sem cartão/i);
assert.match(homeText, /7 dias grátis no Essencial/i);
assert.match(
  homeText,
  /teste começa somente após a confirmação do cartão no Mercado Pago/i,
);
assert.match(homeText, /primeira mensalidade somente após os 7 dias/i);
assert.match(homeText, /renovação mensal/i);
assert.match(
  homeText,
  /cancelar antes do fim do teste evita a primeira cobrança/i,
);
assert.match(homeText, /ativação do teste ainda estão em preparação/i);
assert.doesNotMatch(
  homeText,
  /nenhum cartão é solicitado para ativar|começam na criação da empresa/i,
);
assert.match(
  readableText(signup),
  /exige cartão cadastrado e autorizado no Mercado Pago/i,
);
assert.match(readableText(signup), /7 dias grátis no Essencial/i);
assert.match(
  readableText(signup),
  /período começa somente após a confirmação do cartão pelo provedor/i,
);
assert.match(
  readableText(signup),
  /cancelar antes do fim do teste evita a primeira cobrança/i,
);
assert.match(readableText(signup), /ativação está em preparação/i);
assert.match(
  readableText(signup),
  /criar sua conta agora não inicia o período/i,
);
assert.doesNotMatch(
  signup,
  /autocomplete="cc-|name="(?:card|card_number|cvv|cvc)"/i,
);
assert.match(
  readableText(invitationSignup),
  /usando o e-mail que recebeu o convite/i,
);
assert.doesNotMatch(
  readableText(invitationSignup),
  /cartão|mensalidade|ativação do teste/i,
);
pass(
  "Oferta exige cartão antes do teste sem coletar dados de pagamento ou impor cobrança ao colaborador convidado",
);

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

const tour = [...home.matchAll(/<figure\b([^>]*)>([\s\S]*?)<\/figure>/gi)].find(
  (match) => /<input\b[^>]*type="radio"/i.test(match[2]),
);
assert(
  tour,
  "A demonstração deve oferecer escolha entre as visões do produto.",
);
// React may stream a figure's panels/caption after the initial shell and insert
// them through its placeholders. Follow their semantic IDs in the full response.
const captionId = attributes(tour[1])["aria-labelledby"];
assert(captionId, "A demonstração precisa identificar sua legenda.");
const caption = [
  ...home.matchAll(/<figcaption\b([^>]*)>([\s\S]*?)<\/figcaption>/gi),
].find((match) => attributes(match[1]).id === captionId);
assert(
  caption,
  "Legenda deve ser entregue no HTML, inclusive quando streamed.",
);
const captionText = readableText(caption[2]);
assert.match(captionText, /demonstração ilustrativa/i);
assert.match(captionText, /dados fictícios/i);
assert.match(captionText, /nenhuma reserva é criada aqui/i);
assert.match(
  tour[2],
  /<fieldset\b/i,
  "Opções do tour devem formar um grupo nativo.",
);
assert.match(
  tour[2],
  /<legend\b[^>]*>[^<]+<\/legend>/i,
  "O grupo precisa de nome acessível.",
);
const tourInputs = [...tour[2].matchAll(/<input\b[^>]*>/gi)].map(([tag]) =>
  attributes(tag),
);
assert.equal(
  tourInputs.length,
  3,
  "Tour deve oferecer agenda, clientes e página pública.",
);
assert(tourInputs.every((input) => input.type === "radio"));
assert.equal(new Set(tourInputs.map((input) => input.name)).size, 1);
assert(tourInputs[0].name, "As opções precisam pertencer ao mesmo grupo.");
assert.equal(new Set(tourInputs.map((input) => input.id)).size, 3);
assert.equal(
  tourInputs.filter((input) => Object.hasOwn(input, "checked")).length,
  1,
  "Uma visão deve estar selecionada no HTML inicial.",
);
const tourLabels: Array<Record<string, string>> = [
  ...tour[2].matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi),
].map((match) => ({
  ...attributes(match[1]),
  text: readableText(match[2]),
}));
assert.deepEqual(
  tourLabels.map((label) => label.text).sort(),
  ["Agenda", "Clientes", "Seu link"].sort(),
);
const sections = [...home.matchAll(/<section\b([^>]*)>/gi)];
const panelContents: string[] = [];
for (const input of tourInputs) {
  assert.equal(
    tourLabels.filter((label) => label.for === input.id).length,
    1,
    "Cada opção deve ter um rótulo associado.",
  );
  assert(input["aria-controls"], "A opção deve identificar seu painel.");
  const panel = sections.find(
    (match) => attributes(match[1]).id === input["aria-controls"],
  );
  assert(panel, "Toda opção precisa apontar para conteúdo entregue no HTML.");
  assert(
    attributes(panel[1])["aria-label"],
    "Cada painel deve ter um nome acessível.",
  );
  const start = panel.index + panel[0].length;
  const end = home.indexOf("</section>", start);
  assert(end > start, "Painel deve ter conteúdo entregue no HTML.");
  const content = home.slice(start, end);
  assert(
    readableText(content).length > 80,
    "O painel deve explicar o recurso.",
  );
  panelContents.push(content);
}
assert.doesNotMatch(
  [tour[2], ...panelContents].join(""),
  /<(form|button)\b/i,
  "A ilustração não pode simular um formulário de envio ou confirmação de reserva.",
);
assert.equal(
  links([tour[2], ...panelContents].join("")).length,
  0,
  "O tour não deve iniciar uma reserva real.",
);
pass(
  "Tour tem três opções nativas identificadas, painéis e dados fictícios explícitos, sem envio de reserva",
);

const mobileMenu = [
  ...home.matchAll(/<details\b[^>]*>([\s\S]*?)<\/details>/gi),
].find((match) =>
  /<summary\b[^>]*aria-label="Menu de navegação"/i.test(match[1]),
);
assert(mobileMenu, "Menu móvel precisa de controle nativo com nome acessível.");
const mobileLinks = links(mobileMenu[1]);
for (const section of [
  "recursos",
  "demonstracao",
  "como-funciona",
  "planos",
  "duvidas",
]) {
  const link = mobileLinks.find(
    (candidate) => candidate.href === `#${section}`,
  );
  assert(
    link?.text,
    "Menu móvel deve oferecer os principais destinos com texto.",
  );
  assert(ids.has(section), "Destino do menu deve existir na página.");
}
pass(
  "Menu móvel oferece navegação nativa com nome acessível e destinos existentes",
);

assert.match(responses[4].headers.get("content-type") || "", /^text\/html\b/i);
assert.equal([...plans.matchAll(/<h1\b[^>]*>/gi)].length, 1);
assert.match(plans, /<section\b[^>]*aria-label="Comparação de planos"/i);
const plansText = readableText(plans);
for (const condition of [
  /7 dias grátis no Essencial/i,
  /1 profissional/i,
  /exigem cartão cadastrado e autorizado/i,
  /primeira mensalidade será cobrada apenas depois dos 7 dias/i,
  /período começa somente após a confirmação do cartão pelo provedor/i,
  /criar a empresa agora não inicia o teste/i,
  /renovação mensal/i,
  /cancelar antes do fim do teste evita a primeira cobrança/i,
  /ativação ainda está em preparação/i,
  /proprietário também conta quando atende/i,
  /convite para acessar o painel é diferente/i,
  /cobrança online ainda não está disponível/i,
  /não ativa uma assinatura nem altera o plano/i,
])
  assert.match(plansText, condition);
assert.doesNotMatch(
  plansText,
  /sem cobrança automática|começa quando você cria a empresa/i,
  "O teste exige cartão e não pode começar apenas com o cadastro da empresa.",
);
const planLinks = links(plans);
for (const publicLinks of [anchors, planLinks]) {
  const preparationLinks = publicLinks.filter(
    (link) => link.text === "Preparar meu cadastro",
  );
  assert.equal(preparationLinks.length, 1);
  assert.equal(
    new URL(preparationLinks[0].href, base).pathname,
    "/cadastro",
    "O preparo do teste deve abrir o cadastro, sem simular autorização do cartão.",
  );
}
const planTrials = planLinks.filter((link) =>
  /Experimentar demonstração/.test(link.text),
);
assert(
  planTrials.length > 0,
  "Página de planos deve oferecer teste mesmo quando os preços estiverem indisponíveis.",
);
for (const link of planTrials) {
  const url = new URL(link.href, base);
  assert.equal(url.origin, base.origin);
  assert.equal(url.pathname, "/demonstracao");
  assert.equal(
    url.search,
    "",
    "Teste não deve fingir selecionar ou contratar um plano pago.",
  );
}
const planContact = planLinks.filter(
  (link) => new URL(link.href, base).hostname === "wa.me",
);
assert(
  planContact.length > 0,
  "Contato precisa continuar disponível na comparação.",
);
for (const link of planContact) {
  const url = new URL(link.href);
  assert.equal(url.protocol, "https:");
  assert.equal(url.pathname, "/5518997695445");
}
assert.doesNotMatch(
  plans,
  /<(form|button)\b/i,
  "Planos públicos não devem simular checkout ou ativação.",
);
for (const link of planLinks) {
  const url = new URL(link.href, base);
  assert(
    [base.origin, "https://wa.me"].includes(url.origin),
    "Nenhum checkout externo deve ser anunciado enquanto indisponível.",
  );
  assert.doesNotMatch(
    url.pathname,
    /checkout|\/api\/|assinatura/i,
    "A comparação deve encaminhar ao cadastro ou contato, sem ativação simulada.",
  );
}
// React streams some price-card children into hidden fragments after the shell.
// Reconstruct only the literal template/fragment moves announced by React's
// transport; do not execute any scripts or treat its serialized RSC as DOM text.
function resolvedHtmlFragments(html: string) {
  const moves = new Map<string, string>();
  for (const match of html.matchAll(/\$R([SC])\("([^"]+)","([^"]+)"\)/g)) {
    moves.set(
      match[1] === "S" ? match[3] : match[2],
      match[1] === "S" ? match[2] : match[3],
    );
  }
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const sources = new Map<string, string>();
  const ranges: { start: number; end: number }[] = [];
  for (const opening of markup.matchAll(
    /<([a-z][\w:-]*)\b[^>]*\bid="S:[^"]+"[^>]*>/g,
  )) {
    const id = attributes(opening[0]).id;
    const start = opening.index;
    const contentStart = start + opening[0].length;
    const tags = new RegExp(`<\\/?${opening[1]}\\b[^>]*>`, "g");
    tags.lastIndex = contentStart;
    let depth = 1;
    let close: RegExpExecArray | null;
    while ((close = tags.exec(markup))) {
      depth += close[0].startsWith("</") ? -1 : 1;
      if (depth === 0) {
        sources.set(id, markup.slice(contentStart, close.index));
        ranges.push({ start, end: tags.lastIndex });
        break;
      }
    }
    assert.equal(
      depth,
      0,
      "Fragmento HTML deve possuir um fechamento completo.",
    );
  }
  let shell = markup;
  const outerRanges = ranges.filter(
    (range) =>
      !ranges.some(
        (parent) =>
          parent !== range &&
          parent.start < range.start &&
          parent.end >= range.end,
      ),
  );
  for (const range of outerRanges.sort((a, b) => b.start - a.start))
    shell = shell.slice(0, range.start) + shell.slice(range.end);
  const expand = (value: string, seen = new Set<string>()): string =>
    value.replace(/<template\b[^>]*><\/template>/g, (template) => {
      const sourceId = moves.get(attributes(template).id);
      if (!sourceId) return template;
      assert.ok(!seen.has(sourceId), "Fragmentos não podem formar ciclos.");
      const source = sources.get(sourceId);
      assert.notEqual(
        source,
        undefined,
        "Todo fragmento referenciado precisa ser entregue.",
      );
      return expand(source!, new Set([...seen, sourceId]));
    });
  return expand(shell);
}

function displayedPlans(html: string) {
  return [
    ...resolvedHtmlFragments(html).matchAll(
      /<article\b[^>]*>([\s\S]*?)<\/article>/gi,
    ),
  ]
    .flatMap((match) => {
      const text = readableText(match[1]);
      const price = text.match(/R\$\s*[\d.]+,\d{2}/)?.[0];
      if (!price) return [];
      const name = match[1].match(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i);
      const limit = text.match(/Até (\d+) profissiona(?:l|is) na agenda/i);
      assert(
        name && limit,
        "Cada preço deve identificar plano e limite de profissionais.",
      );
      assert.match(text, /\/mês/, "A periodicidade precisa estar clara.");
      return [{ name: readableText(name[1]), price, limit: Number(limit[1]) }];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
const publicPlans = displayedPlans(plans);
const homePlans = displayedPlans(home);
assert(
  planTrials.length >= publicPlans.length + 1,
  "A comparação deve entregar um CTA de demonstração por plano, além do convite inicial, inclusive em fragmentos streamed.",
);
if (publicPlans.length && homePlans.length) {
  assert.deepEqual(
    publicPlans,
    homePlans,
    "Landing e comparação devem publicar os mesmos preços e limites.",
  );
} else {
  if (!publicPlans.length)
    assert.match(
      plansText,
      /não foi possível consultar os planos/i,
      "Falha de consulta precisa ser explícita, sem preços fictícios.",
    );
  if (!homePlans.length)
    assert.match(readableText(home), /preços estão indisponíveis/i);
}
pass(
  "Planos explicam trial, capacidade e contratação real, sem checkout; valores publicados são consistentes",
);

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
assertPng(png, 1200, 630);
pass("Imagem OG e Twitter responde PNG real de 1200 × 630");

const headLinks = [...home.matchAll(/<link\b[^>]*>/gi)].map(([tag]) =>
  attributes(tag),
);
const svgIcon = headLinks.find(
  (link) => link.rel === "icon" && link.type === "image/svg+xml",
);
const appleIcon = headLinks.find((link) => link.rel === "apple-touch-icon");
assert(svgIcon?.href, "Metadata deve anunciar o ícone SVG da marca.");
assert(appleIcon?.href, "Metadata deve anunciar o ícone para tela inicial.");
assert.equal(appleIcon.sizes, "180x180");
assert.equal(appleIcon.type, "image/png");
const [svgResponse, appleResponse] = await Promise.all([
  get(localAssetPath(svgIcon.href)),
  get(localAssetPath(appleIcon.href)),
]);
assert.match(
  svgResponse.headers.get("content-type") || "",
  /^image\/svg\+xml\b/i,
);
const svg = await svgResponse.text();
assert.match(svg, /<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/i);
assert.match(
  svg,
  /viewBox="[\d.\s]+"/i,
  "SVG precisa de área de desenho válida.",
);
assert.match(appleResponse.headers.get("content-type") || "", /^image\/png\b/i);
assertPng(Buffer.from(await appleResponse.arrayBuffer()), 180, 180);
pass("Ícones anunciados respondem SVG e PNG real de 180 × 180");

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
    [
      "/",
      "/planos",
      "/diagnostico",
      "/segmentos/salao",
      "/segmentos/pet-shop",
      "/segmentos/clinica",
      "/segmentos/escritorio",
      "/segmentos/restaurante",
      "/segmentos/fornecedores",
      "/segmentos/logistica",
      "/segmentos/academia",
    ].includes(url.pathname),
    true,
    "Sitemap deve conter apenas páginas comerciais públicas.",
  );
}
assert.equal(locations.length, expectedSite.indexable ? 11 : 0);
pass(
  expectedSite.indexable
    ? "Sitemap contém páginas comerciais e segmentos disponíveis"
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

assert.match(responses[5].headers.get("content-type") || "", /^text\/html\b/i);
assert.match(readableText(missing), /Página não encontrada/i);
const missingLinks = links(missing);
assert(
  missingLinks.some((link) => link["aria-label"] === "Web Fidelize — início"),
  "A página 404 deve manter a identidade da plataforma.",
);
for (const path of ["/", "/entrar"]) {
  assert(
    missingLinks.some((link) => new URL(link.href, base).pathname === path),
    "A página 404 deve oferecer saída para início e acesso à conta.",
  );
}
assert(
  [...missing.matchAll(/<meta\b[^>]*>/gi)].some(([tag]) => {
    const meta = attributes(tag);
    return (
      meta.name === "robots" &&
      meta.content?.split(/\s*,\s*/).includes("noindex")
    );
  }),
  "A resposta 404 não deve ser indexável.",
);
pass("URL inexistente responde 404 com marca, noindex e caminhos de retorno");

for (const slug of [
  "salao",
  "pet-shop",
  "clinica",
  "escritorio",
  "restaurante",
  "fornecedores",
  "logistica",
  "academia",
]) {
  const segment = await (await get("/segmentos/" + slug)).text();
  assert(links(home).some((a) => a.href === "/segmentos/" + slug));
  assert(links(segment).some((a) => a.href === "/demonstracao/" + slug));
  assert(
    links(segment).some((a) => a.href === "/entrar/" + slug),
    "Existing customer login remains available",
  );
  const demo = await (await get("/demonstracao/" + slug)).text();
  assert.match(metadata(demo, "robots"), /noindex/);
  assert.match(readableText(demo), /não criam reservas, contas ou cobranças/);
  assert.match(readableText(demo), /Criar agendamento de exemplo/);
  assert.doesNotMatch(demo, /name="(?:password|email|phone)"/);
}
await get("/segmentos/nao-existe", 404);
await get("/demonstracao/nao-existe", 404);
const discovery = await (await get("/demonstracao")).text();
assert.match(metadata(discovery, "robots"), /noindex/);
for (const publicHtml of [home, plans, signup]) {
  const publicText = readableText(publicHtml);
  assert.match(publicText, /7 dias grátis/);
  assert.match(
    publicText,
    /ativação (?:do teste ainda estão|de novos testes ainda estão|ainda está|está) em preparação/i,
  );
  assert.match(
    publicText,
    /cancelar antes do fim do teste evita a primeira cobrança/i,
  );
  assert.doesNotMatch(
    publicText,
    /teste grátis sem cartão|7 dias grátis sem cartão|teste já está ativo/i,
    "A oferta de teste deve preservar a autorização do cartão e nunca simular ativação.",
  );
}
const inquiry = await (await get("/diagnostico")).text();
assert.match(readableText(inquiry), /Descreva o que você busca/);
const budget = inquiry.match(
  /<select[^>]*name="budget_range"[^>]*>([\s\S]*?)<\/select>/,
)?.[1];
assert.ok(budget);
assert.match(budget, /value="other"/);
assert.doesNotMatch(budget, /under-1000|1000-3000|3000-10000|over-10000/);
pass(
  "Segmentos levam a benefícios e demonstração sem login; formulário preserva planos + Outros",
);
console.log(
  `${passed} grupos HTTP da landing aprovados; apenas leituras locais, sem cadastros ou mensagens.`,
);
