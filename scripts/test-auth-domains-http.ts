import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  confirmationHash,
  fakeEmail,
  fakePassword,
  startFakeAuth,
} from "../tests/fixtures/auth-server";

// No email, external account, or real database is used. The preload refuses
// external fetch. Two logical HTTPS .test hosts share a loopback transport, while
// cookies stay in separate host-only jars, as they do across production domains.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://fake.supabase.test";
const invitation = `/convite/${"ef".repeat(32)}`;
type Browser = Map<string, Map<string, string>>;
let phase = "setup",
  checks = 0;
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
function form(html: string, marker: string) {
  const source = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map((match) => match[0])
    .find((value) => value.includes(marker));
  assert.ok(source, "Expected an actual rendered Server Action form");
  const data = new FormData();
  for (const tag of source.matchAll(/<input\b[^>]*>/g)) {
    const input = attributes(tag[0]);
    if (input.type === "hidden" && input.name)
      data.append(input.name, input.value || "");
  }
  assert.ok(
    [...data.keys()].some(
      (key) => key.startsWith("$ACTION_ID_") || key.startsWith("$ACTION_REF_"),
    ),
  );
  return data;
}
const pass = (label: string) => {
  checks++;
  console.log(`PASS auth domains: ${label}`);
};
async function freePort() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

async function main() {
  assert.ok(
    existsSync(".next/BUILD_ID"),
    "Build the current source before this suite",
  );
  const backend = await startFakeAuth(new URL(supabaseUrl).origin);
  const port = await freePort();
  const canonical = "https://new.webfidelize.test";
  const legacy = "https://old.webfidelize.test";
  const loopback = `http://127.0.0.1:${port}`;
  const origins = [canonical, legacy];
  let child: ChildProcess | undefined;
  function jar(browser: Browser, origin: string) {
    const host = new URL(origin).hostname;
    if (!browser.has(host)) browser.set(host, new Map());
    return browser.get(host)!;
  }
  async function request(
    browser: Browser,
    origin: string,
    path: string,
    body?: FormData,
    overrides: Record<string, string> = {},
  ) {
    assert.ok(
      origins.includes(origin),
      "Requests must remain on the two local origins",
    );
    const target = new URL(path, origin);
    assert.equal(
      target.origin,
      origin,
      "A redirect must be followed explicitly with its own host jar",
    );
    const cookies = jar(browser, origin);
    const transport = new URL(target.pathname + target.search, loopback);
    const prepared = new Request(target, {
      method: body ? "POST" : "GET",
      body,
      headers: {
        Accept: "text/html",
        Host: target.host,
        "X-Forwarded-Host": target.host,
        "X-Forwarded-Proto": "https",
        Cookie: [...cookies]
          .map(([name, value]) => `${name}=${value}`)
          .join("; "),
        ...(body ? { Origin: origin, Referer: target.href } : {}),
        ...overrides,
      },
    });
    const payload = body ? Buffer.from(await prepared.arrayBuffer()) : null;
    const wireHeaders = Object.fromEntries(prepared.headers);
    if (payload) wireHeaders["content-length"] = String(payload.length);
    // Node's fetch replaces custom Host with its connection hostname. The
    // HTTP transport preserves it, reproducing a reverse proxy without DNS/TLS
    // or external traffic. Request supplies the real multipart encoding.
    const response = await new Promise<Response>((done, reject) => {
      const outgoing = httpRequest(
        transport,
        {
          method: prepared.method,
          headers: wireHeaders,
          timeout: 30_000,
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
          incoming.on("error", reject);
          incoming.on("end", () => {
            const headers = new Headers();
            for (let index = 0; index < incoming.rawHeaders.length; index += 2)
              headers.append(
                incoming.rawHeaders[index],
                incoming.rawHeaders[index + 1],
              );
            done(
              new Response(Buffer.concat(chunks), {
                status: incoming.statusCode!,
                headers,
              }),
            );
          });
        },
      );
      outgoing.on("error", reject);
      outgoing.on("timeout", () =>
        outgoing.destroy(new Error("Local HTTP fixture timeout")),
      );
      outgoing.end(payload);
    });
    for (const header of response.headers.getSetCookie()) {
      assert.doesNotMatch(
        header,
        /;\s*domain=/i,
        "Auth cookies must remain host-only",
      );
      const pair = header.split(";", 1)[0],
        separator = pair.indexOf("=");
      if (separator < 1) continue;
      const name = pair.slice(0, separator),
        value = pair.slice(separator + 1);
      if (!value || /max-age=0(?:;|$)/i.test(header)) cookies.delete(name);
      else cookies.set(name, value);
    }
    return response;
  }
  async function destination(response: Response, origin: string) {
    let target = response.headers.get("location");
    if (!target && response.status === 200) {
      const html = await response.text();
      const meta = [...html.matchAll(/<meta\b[^>]*>/g)]
        .map((m) => attributes(m[0]))
        .find((tag) => tag.id === "__next-page-redirect");
      target = meta?.content?.match(/^[01];url=(.*)$/)?.[1] || null;
    }
    assert.ok(target, `Expected redirect, HTTP ${response.status}`);
    const url = new URL(target, origin);
    assert.ok(
      origins.includes(url.origin),
      "Redirect must never select an external host",
    );
    return url;
  }
  async function stopApp() {
    if (!child || child.exitCode !== null) return;
    const processToStop = child;
    const stopped = new Promise<void>((done) =>
      processToStop.once("exit", () => done()),
    );
    processToStop.kill();
    await stopped;
    child = undefined;
  }
  async function startApp(migrating: boolean) {
    child = spawn(
      process.execPath,
      [
        "--import",
        pathToFileURL(resolve("tests/fixtures/auth-fetch-hook.mjs")).href,
        "node_modules/next/dist/bin/next",
        "start",
        "-p",
        String(port),
        "-H",
        "127.0.0.1",
      ],
      {
        cwd: process.cwd(),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          APP_URL: migrating ? canonical : legacy,
          AUTH_LEGACY_ORIGINS: migrating ? legacy : "",
          VERCEL_ENV: "preview",
          AUTH_FLOW_SECRET: "domain-fixture-proof-secret-not-for-production",
          NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
            process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
            "isolated-publishable-key",
          TEST_AUTH_BACKEND_URL: backend.origin,
        },
      },
    );
    // Drain streams, never print token-bearing request URLs or child credentials.
    child.stdout?.on("data", () => {});
    let startupErrors = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      if (startupErrors.length < 4000) startupErrors += chunk.toString();
    });
    let lastStatus = 0;
    for (let attempt = 0; attempt < 100; attempt++) {
      assert.equal(child.exitCode, null, "Isolated Next unexpectedly exited");
      try {
        const response = await request(
          new Map(),
          migrating ? canonical : legacy,
          "/entrar",
        );
        lastStatus = response.status;
        if (response.status === 200) return;
      } catch {
        /* Bounded readiness retry. */
      }
      await new Promise((done) => setTimeout(done, 100));
    }
    console.error(
      "Isolated readiness diagnostics",
      JSON.stringify({
        lastStatus,
        invalidOrigin: /Invalid APP_URL|Invalid AUTH_LEGACY_ORIGINS/.test(
          startupErrors,
        ),
        originMismatch: /origin|host/i.test(startupErrors),
        inUse: /EADDRINUSE/.test(startupErrors),
      }),
    );
    throw new Error("Isolated Next readiness failed");
  }
  const counts = () => [
    backend.state.signupCalls,
    backend.state.recoveryCalls,
    backend.state.resendCalls,
  ];
  async function emailForm(
    browser: Browser,
    origin: string,
    path: string,
    signup = false,
  ) {
    const data = form(
      await (await request(browser, origin, path)).text(),
      signup ? 'name="password"' : 'name="email"',
    );
    data.set("email", fakeEmail);
    if (signup) data.set("password", fakePassword);
    return data;
  }
  const callback = (code: string, next: string) =>
    `/auth/callback?${new URLSearchParams({ code, next })}`;
  try {
    phase = "create pre-migration PKCE links";
    await startApp(false);
    const oldRecovery: Browser = new Map(),
      oldSignup: Browser = new Map();
    const recoveryForm = await emailForm(oldRecovery, legacy, "/recuperar");
    const oldRecoveryResponse = await request(
      oldRecovery,
      legacy,
      "/recuperar",
      recoveryForm,
    );
    assert.equal(oldRecoveryResponse.status, 303);
    const oldRecoveryCode = backend.issuePkceCode("recovery");
    const signupPath = `/cadastro?${new URLSearchParams({ next: invitation })}`;
    const oldSignupForm = await emailForm(oldSignup, legacy, signupPath, true);
    await request(oldSignup, legacy, signupPath, oldSignupForm);
    const oldSignupCode = backend.issuePkceCode("otp");
    assert.ok(jar(oldRecovery, legacy).size > 0);
    assert.equal(jar(oldRecovery, canonical).size, 0);
    assert.equal(
      new URL(backend.state.emailRequests.at(-1)!.redirectTo!).origin,
      legacy,
    );
    await stopApp();
    await startApp(true);
    pass("pre-migration PKCE links retain separate host-only verifier cookies");

    phase = "canonical entry routes and stale form POSTs";
    const beforeEntries = counts();
    const empty: Browser = new Map();
    for (const path of [
      "/cadastro",
      "/recuperar",
      "/entrar",
      "/entrar/salao",
    ]) {
      const response = await request(
        empty,
        legacy,
        `${path}?${new URLSearchParams({ next: invitation, token_hash: "do-not-forward" })}`,
      );
      assert.equal(response.status, 303);
      const target = await destination(response, legacy);
      assert.equal(target.origin, canonical);
      assert.equal(target.pathname, path);
      assert.equal(target.searchParams.has("token_hash"), false);
      assert.equal(
        target.searchParams.get("next"),
        path === "/recuperar" ? null : invitation,
      );
      assert.match(response.headers.get("cache-control") || "", /no-store/);
      assert.equal(response.headers.get("referrer-policy"), "no-referrer");
      assert.equal(response.headers.getSetCookie().length, 0);
    }
    const canonicalSignup = await emailForm(empty, canonical, signupPath, true);
    const canonicalRecovery = await emailForm(empty, canonical, "/recuperar");
    const loginPath = `/entrar?${new URLSearchParams({ next: invitation })}`;
    const resend = form(
      await (await request(empty, canonical, loginPath)).text(),
      'id="confirmation-email"',
    );
    resend.set("email", fakeEmail);
    for (const [path, data] of [
      [signupPath, canonicalSignup],
      ["/recuperar", canonicalRecovery],
      [loginPath, resend],
    ] as const) {
      const response = await request(empty, legacy, path, data);
      assert.equal(
        response.status,
        303,
        "A stale POST must not forward its body across hosts",
      );
      assert.equal((await destination(response, legacy)).origin, canonical);
      assert.equal(response.headers.getSetCookie().length, 0);
    }
    assert.deepEqual(
      counts(),
      beforeEntries,
      "Legacy entry GET/POST must not reach email APIs",
    );
    pass(
      "entry GETs and stale signup/recovery/resend POSTs move before any Auth call",
    );

    phase = "canonical signup PKCE and verifier isolation";
    const newSignup: Browser = new Map();
    const signedUp = await destination(
      await request(newSignup, canonical, signupPath, canonicalSignup),
      canonical,
    );
    assert.equal(signedUp.searchParams.get("next"), invitation);
    const signupRequest = backend.state.emailRequests.at(-1)!;
    assert.equal(signupRequest.path, "/auth/v1/signup");
    assert.equal(new URL(signupRequest.redirectTo!).origin, canonical);
    assert.equal(
      new URL(signupRequest.redirectTo!).searchParams.get("next"),
      invitation,
    );
    const newCode = backend.issuePkceCode("otp");
    assert.equal(jar(newSignup, legacy).size, 0);
    const successes = backend.state.pkceSuccesses;
    const wrongHost = await destination(
      await request(newSignup, legacy, callback(newCode, invitation)),
      legacy,
    );
    assert.equal(wrongHost.origin, legacy);
    assert.equal(wrongHost.searchParams.get("erro"), "link");
    assert.equal(backend.state.pkceSuccesses, successes);
    assert.equal(backend.state.pkceCodes.has(newCode), true);
    const confirmed = await destination(
      await request(newSignup, canonical, callback(newCode, invitation)),
      canonical,
    );
    assert.equal(confirmed.origin, canonical);
    assert.equal(confirmed.pathname, invitation);
    assert.equal(backend.state.pkceSuccesses, successes + 1);
    assert.equal(backend.state.pkceCodes.has(newCode), false);
    assert.match(
      await (await request(newSignup, canonical, invitation)).text(),
      /Conta atual:/,
    );
    assert.equal(
      backend.state.companyCreations,
      0,
      "An invitation must not create an owner's company",
    );
    const replay = await destination(
      await request(newSignup, canonical, callback(newCode, invitation)),
      canonical,
    );
    assert.equal(replay.searchParams.get("erro"), "link");
    assert.equal(backend.state.pkceSuccesses, successes + 1);
    pass(
      "new signup uses canonical redirect, exact PKCE, one-use code and invitation return",
    );

    phase = "legacy recovery with mismatched and correct verifiers";
    const otherBrowser: Browser = new Map();
    await request(otherBrowser, canonical, "/recuperar", canonicalRecovery);
    const recoverRequest = backend.state.emailRequests.at(-1)!;
    assert.equal(recoverRequest.path, "/auth/v1/recover");
    assert.equal(new URL(recoverRequest.redirectTo!).origin, canonical);
    assert.equal(
      new URL(recoverRequest.redirectTo!).searchParams.get("next"),
      "/nova-senha",
    );
    const beforeMismatch = backend.state.pkceSuccesses;
    const mismatch = await destination(
      await request(
        otherBrowser,
        canonical,
        callback(oldRecoveryCode, "/nova-senha"),
      ),
      canonical,
    );
    assert.equal(mismatch.searchParams.get("erro"), "link");
    assert.equal(backend.state.pkceSuccesses, beforeMismatch);
    assert.equal(backend.state.pkceCodes.has(oldRecoveryCode), true);
    const recovered = await destination(
      await request(oldRecovery, legacy, callback(oldRecoveryCode, "/painel")),
      legacy,
    );
    assert.equal(recovered.origin, legacy);
    assert.equal(recovered.pathname, "/nova-senha");
    assert.equal(backend.state.pkceSuccesses, beforeMismatch + 1);
    const resetPage = await request(oldRecovery, legacy, "/nova-senha");
    assert.equal(
      resetPage.status,
      200,
      "Recovery must finish on the host that owns the session",
    );
    const reset = form(await resetPage.text(), 'name="password_confirmation"');
    reset.set("password", "Changed-Domain-Fixture-Only!");
    reset.set("password_confirmation", "Changed-Domain-Fixture-Only!");
    const changed = await destination(
      await request(oldRecovery, legacy, "/nova-senha", reset),
      legacy,
    );
    assert.equal(changed.origin, legacy);
    assert.equal(changed.searchParams.get("aviso"), "senha-atualizada");
    assert.equal(backend.state.passwordChanges, 1);
    const enterCanonical = await destination(
      await request(oldRecovery, legacy, changed.pathname + changed.search),
      legacy,
    );
    assert.equal(enterCanonical.origin, canonical);
    assert.equal(enterCanonical.searchParams.get("aviso"), "senha-atualizada");
    assert.equal(
      jar(oldRecovery, canonical).size,
      0,
      "No cross-domain session copy",
    );
    assert.equal(
      (
        await destination(
          await request(oldRecovery, canonical, "/painel"),
          canonical,
        )
      ).pathname,
      "/entrar",
    );
    pass(
      "mismatched PKCE is rejected; old recovery completes on legacy before canonical login",
    );

    phase = "legacy signup callback and invite";
    const oldConfirmed = await destination(
      await request(oldSignup, legacy, callback(oldSignupCode, invitation)),
      legacy,
    );
    assert.equal(oldConfirmed.origin, legacy);
    assert.equal(oldConfirmed.pathname, invitation);
    assert.match(
      await (await request(oldSignup, legacy, invitation)).text(),
      /Conta atual:/,
    );
    assert.equal(jar(oldSignup, canonical).size, 0);
    assert.equal(backend.state.companyCreations, 0);
    pass(
      "old signup callback and authenticated invitation remain on their allowed legacy host",
    );

    phase = "token-hash invitation confirmation across allowed origins";
    const hashBrowser: Browser = new Map();
    const confirmPath = `/auth/confirm?${new URLSearchParams({ token_hash: confirmationHash, type: "email", redirect_to: `${legacy}${callback("unused", invitation)}` })}`;
    const verifyBefore = backend.state.verifyCalls;
    const confirmationPage = await request(hashBrowser, canonical, confirmPath);
    const confirmation = form(
      await confirmationPage.text(),
      'name="token_hash"',
    );
    assert.equal(confirmation.get("next"), invitation);
    const scanner = await request(
      hashBrowser,
      legacy,
      `/auth/callback?${new URLSearchParams({ token_hash: confirmationHash, type: "email", next: invitation })}`,
    );
    const scannerTarget = await destination(scanner, legacy);
    assert.equal(scannerTarget.origin, legacy);
    assert.equal(scannerTarget.pathname, "/auth/confirm");
    await (
      await request(
        hashBrowser,
        legacy,
        scannerTarget.pathname + scannerTarget.search,
      )
    ).text();
    assert.equal(backend.state.verifyCalls, verifyBefore);
    const otpConfirmed = await destination(
      await request(hashBrowser, canonical, confirmPath, confirmation),
      canonical,
    );
    assert.equal(otpConfirmed.origin, canonical);
    assert.equal(otpConfirmed.pathname, invitation);
    assert.equal(backend.state.verifyCalls, verifyBefore + 1);
    assert.equal(jar(hashBrowser, legacy).size, 0);
    assert.match(
      await (await request(hashBrowser, canonical, invitation)).text(),
      /Conta atual:/,
    );
    const reused = await destination(
      await request(new Map(), canonical, confirmPath, confirmation),
      canonical,
    );
    assert.equal(reused.searchParams.get("erro"), "link");
    pass(
      "old email metadata preserves only invite path; scanner GET is inert and OTP POST is single-use",
    );

    phase = "rejected hosts and redirect injection";
    const untrustedBrowser: Browser = new Map();
    const beforeRejected = [
      backend.state.pkceCalls,
      backend.state.verifyCalls,
      ...counts(),
    ];
    for (const host of ["evil.invalid", `127.0.0.1.evil.invalid:${port}`]) {
      const response = await request(
        untrustedBrowser,
        canonical,
        callback("must-not-consume", invitation),
        undefined,
        { Host: host, "X-Forwarded-Host": new URL(canonical).host },
      );
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("location"), null);
      assert.equal(response.headers.getSetCookie().length, 0);
      const confirmResponse = await request(
        untrustedBrowser,
        canonical,
        confirmPath,
        confirmation,
        { Host: host, Origin: `http://${host}`, "X-Forwarded-Host": host },
      );
      const denied = await destination(confirmResponse, canonical);
      assert.equal(denied.searchParams.get("erro"), "configuracao");
      assert.equal(confirmResponse.headers.getSetCookie().length, 0);
    }
    assert.deepEqual(
      [backend.state.pkceCalls, backend.state.verifyCalls, ...counts()],
      beforeRejected,
    );
    const safeHost = await request(
      new Map(),
      canonical,
      callback("invalid", "//evil.invalid"),
      undefined,
      { "X-Forwarded-Host": "evil.invalid", "X-Forwarded-Proto": "https" },
    );
    const safeTarget = await destination(safeHost, canonical);
    assert.equal(safeTarget.origin, canonical);
    assert.equal(safeTarget.searchParams.has("next"), false);
    const injected = `/auth/confirm?${new URLSearchParams({ token_hash: confirmationHash, type: "email", redirect_to: `https://evil.invalid/auth/callback?next=${invitation}` })}`;
    const sanitized = form(
      await (await request(new Map(), canonical, injected)).text(),
      'name="token_hash"',
    );
    assert.equal(sanitized.get("next"), "/painel");
    pass(
      "untrusted hosts cannot consume codes or OTP; forged forwarded hosts and external next cannot redirect",
    );

    phase = "canonical resend metadata";
    const resendResponse = await request(
      new Map(),
      canonical,
      loginPath,
      resend,
    );
    assert.equal(resendResponse.status, 200);
    assert.match(
      await resendResponse.text(),
      /cadastro aguardando confirmação/,
    );
    const resent = backend.state.emailRequests.at(-1)!;
    assert.equal(resent.path, "/auth/v1/resend");
    assert.equal(new URL(resent.redirectTo!).origin, canonical);
    assert.equal(
      new URL(resent.redirectTo!).searchParams.get("next"),
      invitation,
    );
    pass(
      "canonical resend keeps invitation destination and never sends to a legacy or external redirect",
    );
    console.log(
      `PASS auth domains: ${checks} groups; no email sent or real account changed.`,
    );
  } finally {
    await stopApp();
    await backend.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    `FAIL auth domains at ${phase}; request details and tokens omitted.`,
  );
  const location =
    error instanceof Error
      ? error.stack
          ?.split("\n")
          .find((line) => /test-auth-domains-http\.(?:ts|js):\d+/.test(line))
      : undefined;
  if (location) console.error(location.trim());
  process.exitCode = 1;
});
