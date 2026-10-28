import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import {
  startFakeAuth,
  fakeEmail,
  fakePassword,
} from "../tests/fixtures/auth-server";
import { socialPostSchema, type SocialPost } from "../src/lib/social/core";

// Loopback-only fixtures. Never read .env, use production cookies, or contact providers.
const origin = "https://fake.supabase.test",
  company = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const companies = [
  {
    id: company,
    name: "TESTE Aurora · Escritório fictício",
    booking_slug: "teste-aurora",
  },
  { id: other, name: "TESTE Empresa B", booking_slug: null },
];
const offers = [
  { slug: "conteudo-gerenciado", price: 99700 },
  { slug: "trafego-gerenciado", price: 69700 },
  { slug: "gestao-digital-combo", price: 169000 },
  { slug: "fotografia-mensal", price: 79000 },
].map((v) => ({
  id: randomUUID(),
  slug: v.slug,
  title: `TESTE ${v.slug}`,
  summary: "Oferta fictícia para teste isolado",
  active: true,
  published: true,
  niche: null,
  setup_price_cents: null,
  monthly_price_cents: v.price,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}));
const state = { admin: true, fail: false },
  posts = new Map<string, SocialPost>(),
  ads: Record<string, unknown>[] = [],
  files = new Map<string, Buffer>(),
  tokens = new Set<string>(),
  unexpected: string[] = [];
const auth = await startFakeAuth(origin);
const backend = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const buffers: Buffer[] = [];
    for await (const b of request) buffers.push(Buffer.from(b));
    const bytes = Buffer.concat(buffers);
    const send = (status: number, data: unknown, total?: number) => {
      response.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...(total === undefined
          ? {}
          : { "Content-Range": `0-${Math.max(0, total - 1)}/${total}` }),
      });
      response.end(JSON.stringify(data));
    };
    if (url.pathname.startsWith("/auth/")) {
      const result = await fetch(
        new URL(url.pathname + url.search, auth.origin),
        {
          method: request.method,
          headers: {
            "Content-Type": "application/json",
            Authorization: request.headers.authorization ?? "",
          },
          ...(bytes.length ? { body: bytes.toString() } : {}),
        },
      );
      const text = await result.text();
      if (result.ok && url.pathname === "/auth/v1/token") {
        const parsed = JSON.parse(text);
        if (parsed.access_token) tokens.add(parsed.access_token);
      }
      response.writeHead(result.status, { "Content-Type": "application/json" });
      response.end(text);
      return;
    }
    if (url.pathname === "/__test/admin" && request.method === "POST") {
      state.admin = JSON.parse(bytes.toString()).admin;
      return send(200, true);
    }
    if (url.pathname === "/rest/v1/sales_offers") return send(200, offers);
    if (
      url.pathname === "/__test/session" &&
      process.env.TEST_SOCIAL_BROWSER === "1"
    )
      return send(200, jar);
    if (url.pathname === "/rest/v1/plans") return send(200, []);
    const authenticated = tokens.has(
      request.headers.authorization?.replace(/^Bearer /, "") ?? "",
    );
    if (url.pathname === "/rest/v1/rpc/is_super_admin")
      return send(200, authenticated && state.admin);
    if (!authenticated || !state.admin)
      return send(403, { message: "TESTE denied" });
    if (state.fail) return send(503, { message: "TESTE unavailable" });
    const single = request.headers.accept?.includes("object+json");
    const rows = (data: Record<string, unknown>[]) => {
      const matches = data.filter((row) =>
        [...url.searchParams].every(
          ([key, value]) =>
            !value.startsWith("eq.") || String(row[key]) === value.slice(3),
        ),
      );
      const start = Number(url.searchParams.get("offset") ?? 0),
        limit = Number(url.searchParams.get("limit") ?? 1000);
      return send(
        200,
        single ? (matches[0] ?? null) : matches.slice(start, start + limit),
        matches.length,
      );
    };
    if (url.pathname === "/rest/v1/companies") return rows(companies);
    if (url.pathname === "/rest/v1/platform_social_accounts")
      return send(200, []);
    if (url.pathname === "/rest/v1/platform_social_posts")
      return rows([...posts.values()]);
    if (url.pathname === "/rest/v1/platform_ad_plans") return rows(ads);
    if (url.pathname.startsWith("/storage/v1/object/")) {
      const path = decodeURIComponent(
        url.pathname.replace(
          /^\/storage\/v1\/object\/(?:authenticated\/)?social-assets\//,
          "",
        ),
      );
      if (request.method === "POST") {
        if (files.has(path)) return send(409, { message: "TESTE duplicate" });
        let imageBytes = bytes;
        const contentType = request.headers["content-type"] ?? "";
        if (contentType.startsWith("multipart/form-data")) {
          const upload = await new Request("http://127.0.0.1/upload", {
            method: "POST",
            headers: { "Content-Type": contentType },
            body: bytes,
          }).formData();
          const image = [...upload.values()].find(
            (value) => value instanceof File,
          );
          if (!(image instanceof File))
            return send(400, { message: "TESTE missing image" });
          imageBytes = Buffer.from(await image.arrayBuffer());
        }
        files.set(path, imageBytes);
        return send(200, { Key: `social-assets/${path}`, Id: randomUUID() });
      }
      const image = files.get(path);
      if (!image) return send(404, { message: "TESTE missing" });
      response.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
      });
      response.end(image);
      return;
    }
    const body = bytes.length ? JSON.parse(bytes.toString()) : {};
    if (url.pathname === "/rest/v1/rpc/social_save_post") {
      const existing = posts.get(body.p_id);
      if (existing && existing.version !== body.p_version)
        return send(409, { message: "version conflict" });
      const post = socialPostSchema.parse({
        id: body.p_id,
        company_id: body.p_company,
        ...body.p_payload,
        asset_path: existing?.asset_path ?? body.p_payload.asset_path,
        status: "draft",
        version: (existing?.version ?? 0) + 1,
        provider_id: null,
        error_code: null,
      });
      posts.set(post.id, post);
      return send(200, post);
    }
    if (url.pathname === "/rest/v1/rpc/social_transition") {
      const post = posts.get(body.p_id);
      if (!post || post.version !== body.p_version)
        return send(409, { message: "version conflict" });
      post.status = body.p_status;
      post.version++;
      return send(200, null);
    }
    if (url.pathname === "/rest/v1/rpc/social_save_ad") {
      ads.push({
        id: body.p_id,
        company_id: body.p_company,
        ...body.p_payload,
        version: 1,
        status: "draft",
      });
      return send(200, null);
    }
    unexpected.push(`${request.method} ${url.pathname}`);
    return send(500, { message: "TESTE unsupported request" });
  } catch {
    response.writeHead(500);
    response.end("TESTE fixture failure");
  }
});
await new Promise<void>((done) => backend.listen(0, "127.0.0.1", done));
const backendUrl = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
const appPort = process.env.TEST_SOCIAL_BROWSER === "1" ? 3200 : 3201;
const base = `http://127.0.0.1:${appPort}`;
const child = spawn(
  process.execPath,
  [
    "--import",
    pathToFileURL(resolve("tests/fixtures/marketing-fetch-hook.mjs")).href,
    resolve("node_modules/next/dist/bin/next"),
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(appPort),
  ],
  {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: origin,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key",
      APP_URL: base,
      TEST_MARKETING_BACKEND_URL: backendUrl,
      NEXT_TELEMETRY_DISABLED: "1",
      AI_GATEWAY_API_KEY: "",
      VERCEL_OIDC_TOKEN: "",
      VERCEL: "",
      BILLING_MODE: "disabled",
      META_APP_ID: "",
      META_APP_SECRET: "",
      META_GRAPH_VERSION: "",
      SOCIAL_PUBLISHING_ENABLED: "false",
      SOCIAL_TOKEN_ENCRYPTION_KEY: "",
      SOCIAL_WORKER_SECRET: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      CRON_SECRET: "",
      TEAM_SMTP_HOST: "",
      WHATSAPP_SEND_ENABLED: "false",
      OTEL_SDK_DISABLED: "true",
      SENTRY_DSN: "",
      NEXT_PUBLIC_SENTRY_DSN: "",
    },
  },
);
let errors = "";
child.stderr.on("data", (b) => {
  errors = (errors + String(b)).slice(-2000);
});
child.stdout.on("data", () => {});
const jar: { name: string; value: string }[] = [];
const client = createServerClient(origin, "fixture-public-key", {
  global: {
    fetch: (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== origin)
        throw new Error("Only fixture auth is allowed");
      return fetch(new URL(url.pathname + url.search, backendUrl), init);
    },
  },
  cookies: {
    getAll: () => jar,
    setAll: (items) => {
      for (const item of items) {
        const old = jar.find((v) => v.name === item.name);
        if (old) old.value = item.value;
        else jar.push({ name: item.name, value: item.value });
      }
    },
  },
});
async function request(path: string, body?: FormData, authorized = true) {
  return fetch(new URL(path, base), {
    method: body ? "POST" : "GET",
    headers: {
      ...(authorized
        ? { Cookie: jar.map((v) => `${v.name}=${v.value}`).join("; ") }
        : {}),
      ...(body ? { Origin: base } : {}),
    },
    body,
    redirect: "manual",
  });
}
const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&");
function form(html: string, field: string) {
  const source = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map((v) => v[0])
    .find((v) => v.includes(`name="${field}"`));
  assert.ok(source, `Missing form ${field}`);
  const result = new FormData();
  for (const m of source.matchAll(/<input\b[^>]*>/g)) {
    const attrs = Object.fromEntries(
      [...m[0].matchAll(/([\w$:-]+)="([^"]*)"/g)].map((x) => [
        x[1],
        decode(x[2]),
      ]),
    );
    if (attrs.type === "hidden" && attrs.name)
      result.set(attrs.name, attrs.value ?? "");
  }
  assert.ok([...result.keys()].some((k) => k.startsWith("$ACTION_")));
  return result;
}
let checks = 0;
function pass(message: string) {
  checks++;
  console.log(`PASS isolated social: ${message}`);
}
try {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const r = await request("/entrar", undefined, false);
      await r.body?.cancel();
      if (r.status === 200) break;
    } catch {}
    await new Promise((done) => setTimeout(done, 250));
  }
  const login = await client.auth.signInWithPassword({
    email: fakeEmail,
    password: fakePassword,
  });
  assert.equal(login.error, null);
  let response = await request("/admin/redes", undefined, false);
  assert.ok([303, 307].includes(response.status));
  await response.body?.cancel();
  pass("anonymous access redirects to login");
  let html = await (await request("/")).text();
  assert.match(html, /A missão da Web Fidelize é digitalizar negócios/);
  assert.match(html, /office-interior.webp/);
  assert.match(html, /Seu espaço de trabalho/);
  html = await (await request("/servicos")).text();
  for (const text of [
    "Agenda personalizada",
    "Conteúdo para redes sociais",
    "Gestão de tráfego pago",
    "Fotografia no seu negócio",
    "1.690",
    "790",
  ]) {
    assert.ok(html.includes(text), text);
  }
  pass(
    "mission, humanized demo and four service modules render with fixture catalog prices",
  );
  html = await (await request("/admin/redes")).text();
  assert.match(html, /TESTE Aurora/);
  assert.match(html, /TESTE Empresa B/);
  pass("admin chooses company from real rendered list");
  const path = `/admin/redes?empresa=${company}`;
  html = await (await request(path)).text();
  const save = form(html, "title");
  const jpeg = new Uint8Array(16);
  jpeg.set([255, 216, 255]);
  jpeg.set([255, 217], 14);
  for (const [k, v] of Object.entries({
    title: "TESTE post persistente",
    caption: "Legenda de teste fictício e revisável. #Teste",
    alt_text: "Imagem fictícia",
    account_id: "",
    time_zone: "America/Sao_Paulo",
    scheduled_local: "2027-01-10T09:30",
    image_rights: "yes",
  }))
    save.set(k, v);
  save.set("photo", new File([jpeg], "teste.jpg", { type: "image/jpeg" }));
  response = await request(path, save);
  assert.equal(response.status, 303);
  await response.body?.cancel();
  const id = String(save.get("id"));
  assert.ok(posts.has(id));
  html = await (await request(`${path}&post=${id}`)).text();
  assert.match(html, /TESTE post persistente/);
  assert.match(html, /Legenda de teste fictício/);
  pass(
    "real Next Server Action uploads private bytes, saves draft and survives reload",
  );
  const planning = form(html, "confirm_publish");
  planning.set("status", "planned");
  response = await request(`${path}&post=${id}`, planning);
  assert.equal(response.status, 200);
  await response.body?.cancel();
  assert.equal(posts.get(id)?.status, "planned");
  pass("planning action persists a planned state without provider call");
  html = await (
    await request(`/admin/redes?empresa=${other}&post=${id}`)
  ).text();
  assert.match(html, /Post não encontrado nesta empresa/);
  pass("cross-company URL cannot select the other company's post");
  response = await request(`/admin/redes/${id}/foto`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  await response.body?.cancel();
  pass("photo delivery requires admin and is private/no-store");
  html = await (await request(`${path}&guia=trafego`)).text();
  const ad = form(html, "media_budget");
  for (const [k, v] of Object.entries({
    name: "TESTE campanha",
    objective: "traffic",
    ad_account_id: "12345678",
    media_budget: "600,00",
    management_fee: "697,00",
    start_date: "2027-01-01",
    end_date: "2027-01-31",
    notes: "TESTE fictício",
  }))
    ad.set(k, v);
  response = await request(`${path}&guia=trafego`, ad);
  assert.equal(response.status, 200);
  await response.body?.cancel();
  assert.equal(ads[0].media_budget_cents, 60000);
  assert.equal(ads[0].management_fee_cents, 69700);
  pass(
    "ad planning keeps media and management amounts separate, with no external activation",
  );
  state.admin = false;
  response = await request(path);
  // Next can stream a not-found boundary after the initial 200 loading shell.
  assert.ok([200, 404].includes(response.status));
  const denied = await response.text();
  assert.match(denied, /Página não encontrada/);
  assert.ok(!denied.includes(companies[0].name));
  response = await request(`/admin/redes/${id}/foto`);
  assert.equal(response.status, 404);
  await response.body?.cancel();
  state.admin = true;
  pass("revoked admin is denied on page and photo route");
  response = await request("/api/social/process", undefined, false);
  assert.equal(response.status, 401);
  await response.body?.cancel();
  assert.equal(unexpected.length, 0, unexpected.join(","));
  pass("cron rejects unauthorized execution and external calls remain blocked");
  console.log(
    `${checks} isolated social HTTP groups passed; no production writes, AI calls or social publication.`,
  );
  if (process.env.TEST_SOCIAL_BROWSER === "1") {
    posts.clear();
    files.clear();
    ads.splice(0);
    console.log(`SOCIAL_BROWSER_READY ${base} FIXTURE ${backendUrl}`);
    await new Promise<void>((done) => {
      process.once("SIGINT", done);
      process.once("SIGTERM", done);
    });
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Social HTTP suite failed",
  );
  if (checks === 0) console.error(errors);
  process.exitCode = 1;
} finally {
  child.kill();
  await new Promise<void>((done) => backend.close(() => done()));
  await auth.close();
}
