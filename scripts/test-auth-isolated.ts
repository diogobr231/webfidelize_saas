import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServerClient } from "@supabase/ssr";
import { createRecoveryProof } from "../src/lib/auth-recovery-proof";
import {
  confirmationHash,
  onboardingConfirmationHash,
  fakeEmail,
  fakePassword,
  recoveryHash,
  startFakeAuth,
} from "../tests/fixtures/auth-server";

// This suite never sends email or changes a real account. A separate Next process
// uses an Auth HTTP fixture, fake JWT/JWKS and a preload blocking external fetch.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://fake.supabase.test";
const proofSecret = "isolated-test-recovery-secret-not-for-production";
const invitation = `/convite/${"ef".repeat(32)}`;
let phase = "setup",
  checks = 0;
type Browser = Map<string, string>;
const decode = (value: string) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
function attrs(tag: string) {
  return Object.fromEntries(
    [...tag.matchAll(/([\w$:-]+)\s*=\s*"([^"]*)"/g)].map((m) => [
      m[1],
      decode(m[2]),
    ]),
  );
}
function form(html: string, identifier: string) {
  const source = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map((m) => m[0])
    .find((value) => value.includes(identifier));
  assert.ok(source, `Expected ${identifier} form`);
  const data = new FormData();
  for (const input of [...source.matchAll(/<input\b[^>]*>/g)].map((m) =>
    attrs(m[0]),
  ))
    if (input.type === "hidden" && input.name)
      data.append(input.name, input.value || "");
  assert.ok(
    [...data.keys()].some(
      (key) => key.startsWith("$ACTION_ID_") || key.startsWith("$ACTION_REF_"),
    ),
    "Server action must be present",
  );
  return data;
}
const pass = (message: string) => {
  checks++;
  console.log(`PASS isolated auth: ${message}`);
};
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function main() {
  assert.ok(
    existsSync(".next/BUILD_ID"),
    "Build the app before the isolated HTTP suite",
  );
  const backend = await startFakeAuth(new URL(supabaseUrl).origin);
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(
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
        APP_URL: base,
        AUTH_FLOW_SECRET: proofSecret,
        TEST_AUTH_BACKEND_URL: backend.origin,
        NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
          process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
          "isolated-publishable-key",
        VERCEL_ENV: "preview",
      },
    },
  );
  // Drain child streams without printing requests, cookies or token-bearing URLs.
  let startupOutput = "";
  child.stdout.on("data", (chunk: Buffer) => {
    if (startupOutput.length < 1500) startupOutput += chunk.toString();
  });
  let startupErrors = "";
  child.stderr.on("data", (chunk: Buffer) => {
    if (startupErrors.length < 4000) startupErrors += chunk.toString();
  });
  async function request(browser: Browser, path: string, body?: FormData) {
    const target = new URL(path, base);
    assert.equal(
      target.origin,
      base,
      "Test browser cannot transfer cookies off-origin",
    );
    const response = await fetch(target, {
      method: body ? "POST" : "GET",
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(40_000),
      headers: {
        Accept: "text/html",
        Cookie: [...browser]
          .map(([key, value]) => `${key}=${value}`)
          .join("; "),
        ...(body ? { Origin: base, Referer: target.toString() } : {}),
      },
    });
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";", 1)[0],
        separator = pair.indexOf("=");
      if (separator < 1) continue;
      const name = pair.slice(0, separator),
        value = pair.slice(separator + 1);
      if (!value || /max-age=0(?:;|$)/i.test(header)) browser.delete(name);
      else browser.set(name, value);
    }
    return response;
  }
  async function destination(response: Response) {
    let target = response.headers.get("location");
    if (!target && response.status === 200) {
      const html = await response.text();
      const meta = [...html.matchAll(/<meta\b[^>]*>/g)]
        .map((m) => attrs(m[0]))
        .find((tag) => tag.id === "__next-page-redirect");
      target = meta?.content?.match(/^[01];url=(.*)$/)?.[1] || null;
    }
    assert.ok(target, `Expected redirect (${response.status})`);
    const url = new URL(target, base);
    assert.equal(url.origin, base);
    return url;
  }
  async function sessionBrowser(method: "password" | "otp" | "recovery") {
    const browser: Browser = new Map();
    const session = backend.session(method);
    const db = createServerClient(supabaseUrl, "isolated-publishable-key", {
      global: {
        fetch: (input, init) => {
          const url = new URL(
            input instanceof Request ? input.url : String(input),
          );
          return fetch(
            new URL(url.pathname + url.search, backend.origin),
            init,
          );
        },
      },
      auth: { autoRefreshToken: false },
      cookies: {
        getAll: () => [...browser].map(([name, value]) => ({ name, value })),
        setAll: (items) =>
          items.forEach(({ name, value }) => browser.set(name, value)),
      },
    });
    const { error } = await db.auth.setSession(session);
    assert.equal(error, null);
    return { browser, session };
  }
  try {
    phase = "wait for isolated Next";
    let ready = false;
    let lastStatus = 0;
    let readinessError = "";
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null)
        throw new Error("Isolated Next exited before startup");
      try {
        const response = await fetch(`${base}/entrar`, {
          signal: AbortSignal.timeout(1000),
        });
        lastStatus = response.status;
        if (response.status === 200) {
          ready = true;
          break;
        }
      } catch (error: unknown) {
        if (error instanceof Error)
          readinessError = `${error.name}: ${String((error.cause as { code?: string } | undefined)?.code || "timeout")}`;
        /* Bounded readiness retries. */
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!ready) {
      console.error(`Isolated Next readiness HTTP status: ${lastStatus}`);
      console.error(
        `Next child status: ${child.exitCode ?? "running"}; ${readinessError}; startup: ${startupOutput.replace(/https?:\/\/\S+/g, "[local URL]").slice(0, 400)}`,
      );
      const diagnostic = startupErrors
        .split("\n")
        .filter((line) => /Error:|TypeError:|Invalid|Missing|Cannot/.test(line))
        .slice(0, 2)
        .join(" ")
        .replace(/https?:\/\/\S+/g, "[URL]")
        .replace(/[A-Za-z0-9_\-.]{48,}/g, "[redacted]")
        .slice(0, 600);
      if (diagnostic) console.error(diagnostic);
    }
    assert.ok(ready, "Isolated Next did not start");
    const anonymous: Browser = new Map();

    phase = "registration and delivery errors";
    const signupPath = `/cadastro?${new URLSearchParams({ next: invitation })}`;
    const signupHtml = await (await request(anonymous, signupPath)).text();
    const signup = form(signupHtml, 'name="password"');
    signup.set("email", fakeEmail);
    signup.set("password", fakePassword);
    const registered = await destination(
      await request(anonymous, signupPath, signup),
    );
    assert.equal(registered.searchParams.get("next"), invitation);
    assert.equal(registered.searchParams.get("aviso"), "confirme-email");
    assert.equal(backend.state.signupCalls, 1);
    backend.state.fault = "smtp";
    assert.equal(
      (
        await destination(await request(anonymous, signupPath, signup))
      ).searchParams.get("erro"),
      "envio",
    );
    backend.state.fault = "limit";
    assert.equal(
      (
        await destination(await request(anonymous, signupPath, signup))
      ).searchParams.get("erro"),
      "limite",
    );
    backend.state.fault = "";
    pass("registration retains invitation and surfaces SMTP/rate errors");

    phase = "confirmation resend feedback";
    const resend = form(
      await (await request(new Map(), "/entrar")).text(),
      'id="confirmation-email"',
    );
    resend.set("email", fakeEmail);
    const resent = await request(new Map(), "/entrar", resend);
    assert.equal(resent.status, 200);
    assert.match(await resent.text(), /cadastro aguardando confirmação/);
    backend.state.fault = "limit";
    const resendLimited = await request(new Map(), "/entrar", resend);
    assert.match(
      await resendLimited.text(),
      /Muitas tentativas em pouco tempo/,
    );
    backend.state.fault = "";
    assert.equal(backend.state.resendCalls, 2);
    pass("confirmation resend uses neutral feedback and provider rate limits");

    phase = "confirmation safe GET then POST";
    const confirmPath = `/auth/confirm?${new URLSearchParams({ token_hash: confirmationHash, type: "email", redirect_to: `${base}/auth/callback?${new URLSearchParams({ next: invitation })}` })}`;
    const confirmHtml = await (await request(anonymous, confirmPath)).text();
    assert.equal(backend.state.verifyCalls, 0);
    assert.match(confirmHtml, /Confirmar e acessar/);
    const confirm = form(confirmHtml, 'name="token_hash"');
    assert.equal(confirm.get("next"), invitation);
    assert.equal(
      (await destination(await request(anonymous, confirmPath, confirm)))
        .pathname,
      invitation,
    );
    assert.equal(backend.state.verifyCalls, 1);
    assert.equal(
      (
        await destination(await request(new Map(), confirmPath, confirm))
      ).searchParams.get("erro"),
      "link",
    );
    pass(
      "GET leaves OTP untouched; explicit POST confirms once and returns to invitation",
    );

    phase = "new owner onboarding without a card";
    const newOwner: Browser = new Map();
    const regularSignup = form(
      await (await request(newOwner, "/cadastro")).text(),
      'name="password"',
    );
    regularSignup.set("email", fakeEmail);
    regularSignup.set("password", fakePassword);
    const regularSignupDestination = await destination(
      await request(newOwner, "/cadastro", regularSignup),
    );
    assert.equal(regularSignupDestination.pathname, "/entrar");
    assert.equal(
      regularSignupDestination.searchParams.get("aviso"),
      "confirme-email",
    );
    const normalConfirmationPath = `/auth/confirm?${new URLSearchParams({ token_hash: onboardingConfirmationHash, type: "email", next: "/painel" })}`;
    const normalConfirmationForm = form(
      await (await request(newOwner, normalConfirmationPath)).text(),
      'name="token_hash"',
    );
    assert.equal(
      (
        await destination(
          await request(
            newOwner,
            normalConfirmationPath,
            normalConfirmationForm,
          ),
        )
      ).pathname,
      "/painel",
    );
    assert.equal(
      (await destination(await request(newOwner, "/painel"))).pathname,
      "/comecar",
    );
    const startHtml = await (await request(newOwner, "/comecar")).text();
    assert.match(startHtml, /sem cartão|[Nn]ão precisa de cartão/i);
    const companyForm = form(startHtml, 'name="niche"');
    companyForm.set("name", "Salão de teste isolado");
    companyForm.set("niche", "salao");
    companyForm.set("intent", "next");
    const companyDestination = await destination(
      await request(newOwner, "/comecar", companyForm),
    );
    const company = backend.state.company;
    assert.ok(company);
    const panelPath = `/painel/${company.id}`;
    const setupPath = `${panelPath}/configuracao`;
    assert.equal(companyDestination.pathname, setupPath);
    assert.equal(companyDestination.searchParams.get("etapa"), "servicos");
    assert.equal(backend.state.companyCreations, 1);
    assert.equal(company.status, "trialing");
    assert.equal(company.trial_card_required, false);
    const originalExpiry = company.trial_ends_at;
    const servicePath = `${setupPath}?etapa=servicos`;
    const service = form(
      await (await request(newOwner, servicePath)).text(),
      'name="price"',
    );
    service.set("name", "Corte de teste isolado");
    service.set("duration", "30");
    service.set("price", "49,90");
    service.set("intent", "next");
    assert.equal(
      (
        await destination(await request(newOwner, servicePath, service))
      ).searchParams.get("etapa"),
      "equipe",
    );
    assert.equal(backend.state.services.length, 1);
    const staffPath = `${setupPath}?etapa=equipe`;
    const professional = form(
      await (await request(newOwner, staffPath)).text(),
      'name="record_id"',
    );
    professional.set("name", "Profissional de teste isolado");
    professional.set("intent", "next");
    assert.equal(
      (
        await destination(await request(newOwner, staffPath, professional))
      ).searchParams.get("etapa"),
      "resumo",
    );
    assert.equal(backend.state.professionals.length, 1);
    const panel = await request(newOwner, panelPath);
    assert.equal(panel.status, 200);
    const panelHtml = await panel.text();
    assert.match(panelHtml, /Seu negócio, em perspectiva/);
    assert.match(panelHtml, /Teste gratuito até/);
    assert.doesNotMatch(
      panelHtml,
      /Não foi possível carregar os indicadores|Seu teste ainda não começou/,
    );
    assert.equal(
      (await destination(await request(newOwner, "/painel"))).pathname,
      panelPath,
    );
    assert.equal(
      (await destination(await request(newOwner, "/comecar", companyForm)))
        .pathname,
      setupPath,
    );
    assert.equal(backend.state.companyCreations, 1);
    assert.equal(company.trial_ends_at, originalExpiry);
    pass(
      "confirmed signup reaches company setup, saves service and professional, enters dashboard without card, and retry preserves expiry (isolated provider)",
    );

    phase = "expired trial server action";
    company.trial_ends_at = new Date(Date.now() - 1000).toISOString();
    const expiredWrite = await destination(
      await request(newOwner, servicePath, service),
    );
    assert.equal(expiredWrite.pathname, panelPath);
    assert.equal(expiredWrite.searchParams.get("erro"), "assinatura");
    assert.equal(backend.state.services.length, 1);
    const expiredPanel = await (await request(newOwner, panelPath)).text();
    assert.match(expiredPanel, /Alterações bloqueadas/);
    company.trial_ends_at = originalExpiry;
    pass(
      "server rechecks trial expiry before writes while retaining read access",
    );

    phase = "login and destination allowlist";
    const loginPath = `/entrar?${new URLSearchParams({ next: invitation })}`;
    const loginHtml = await (await request(new Map(), loginPath)).text();
    const login = form(loginHtml, 'name="password"');
    assert.ok(
      [...loginHtml.matchAll(/<input\b[^>]*>/g)]
        .map((match) => attrs(match[0]))
        .some(
          (input) =>
            input.name === "password" &&
            input.type === "password" &&
            (input.autocomplete || input.autoComplete) === "current-password",
        ),
    );
    assert.ok(
      [...loginHtml.matchAll(/<button\b[^>]*>/g)]
        .map((match) => attrs(match[0]))
        .some(
          (button) =>
            button.type === "button" &&
            button["aria-label"] === "Mostrar senha" &&
            button["aria-pressed"] === "false" &&
            button["aria-controls"] === "password",
        ),
    );
    login.set("email", fakeEmail);
    login.set("password", fakePassword);
    const localLogin = await request(new Map(), loginPath, login);
    const sessionCookies = localLogin.headers
      .getSetCookie()
      .filter((header) => /^sb-[^=]+-auth-token(?:\.\d+)?=/.test(header));
    assert.ok(
      sessionCookies.length > 0,
      "Login must issue real SDK session cookies",
    );
    for (const cookie of sessionCookies) {
      assert.doesNotMatch(
        cookie,
        /;\s*Secure(?:;|$)/i,
        "Local next start over HTTP must retain its working session",
      );
      assert.match(cookie, /;\s*SameSite=Lax(?:;|$)/i);
      assert.match(cookie, /;\s*Path=\/(?:;|$)/i);
    }
    assert.equal((await destination(localLogin)).pathname, invitation);
    login.set("next", "https://external.invalid/");
    assert.equal(
      (await destination(await request(new Map(), "/entrar", login))).pathname,
      "/painel",
    );
    pass("login returns to the invitation and rejects external next");

    phase = "recovery delivery errors";
    const recover = form(
      await (await request(new Map(), "/recuperar")).text(),
      'name="email"',
    );
    recover.set("email", fakeEmail);
    backend.state.fault = "smtp";
    assert.equal(
      (
        await destination(await request(new Map(), "/recuperar", recover))
      ).searchParams.get("erro"),
      "envio",
    );
    backend.state.fault = "limit";
    assert.equal(
      (
        await destination(await request(new Map(), "/recuperar", recover))
      ).searchParams.get("erro"),
      "limite",
    );
    backend.state.fault = "";
    const recoveryBrowser: Browser = new Map();
    assert.equal(
      (
        await destination(await request(recoveryBrowser, "/recuperar", recover))
      ).searchParams.get("aviso"),
      "enviado",
    );
    pass(
      "password reset shows actual delivery failures without claiming delivery",
    );

    phase = "recovery proof and password update";
    const recoveryPath = `/auth/confirm?${new URLSearchParams({ token_hash: recoveryHash, type: "recovery", next: invitation })}`;
    const verificationCount = backend.state.verifyCalls;
    const recovery = form(
      await (await request(recoveryBrowser, recoveryPath)).text(),
      'name="token_hash"',
    );
    assert.equal(backend.state.verifyCalls, verificationCount);
    const verified = await request(recoveryBrowser, recoveryPath, recovery);
    assert.equal((await destination(verified)).pathname, "/nova-senha");
    assert.ok(
      verified.headers
        .getSetCookie()
        .some(
          (value) =>
            value.startsWith("wf-recovery-proof=") &&
            /HttpOnly/i.test(value) &&
            /SameSite=lax/i.test(value),
        ),
    );
    const passwordHtml = await (
      await request(recoveryBrowser, "/nova-senha")
    ).text();
    assert.match(passwordHtml, /Repita a nova senha/);
    const passwordForm = form(passwordHtml, 'name="password"');
    passwordForm.set("password", "New-Local-Test-Password!");
    passwordForm.set("password_confirmation", "New-Local-Test-Password!");
    passwordForm.set("password_confirmation", "Does-Not-Match!");
    assert.equal(
      (
        await destination(
          await request(recoveryBrowser, "/nova-senha", passwordForm),
        )
      ).searchParams.get("erro"),
      "confirmacao-senha",
    );
    assert.equal(backend.state.passwordChanges, 0);
    passwordForm.set("password_confirmation", "New-Local-Test-Password!");
    const missingProof = new Map(recoveryBrowser);
    missingProof.delete("wf-recovery-proof");
    assert.equal(
      (
        await destination(await request(missingProof, "/nova-senha"))
      ).searchParams.get("erro"),
      "recuperacao",
    );
    const tampered = new Map(recoveryBrowser);
    const original = tampered.get("wf-recovery-proof")!;
    tampered.set(
      "wf-recovery-proof",
      original.slice(0, -1) + (original.endsWith("0") ? "1" : "0"),
    );
    assert.equal(
      (
        await destination(await request(tampered, "/nova-senha", passwordForm))
      ).searchParams.get("erro"),
      "recuperacao",
    );
    assert.equal(backend.state.passwordChanges, 0);
    const changed = await destination(
      await request(recoveryBrowser, "/nova-senha", passwordForm),
    );
    assert.equal(changed.searchParams.get("aviso"), "senha-atualizada");
    assert.equal(backend.state.passwordChanges, 1);
    assert.equal(recoveryBrowser.has("wf-recovery-proof"), false);
    pass(
      "OTP recovery requires a valid proof; update clears proof and signs out",
    );

    phase = "expired and cross-session proof";
    const ordinary = await sessionBrowser("password");
    const identity = {
      userId: backend.user.id,
      sessionId: ordinary.session.sessionId,
    };
    assert.equal(
      (
        await destination(await request(ordinary.browser, "/nova-senha"))
      ).searchParams.get("erro"),
      "recuperacao",
    );
    ordinary.browser.set(
      "wf-recovery-proof",
      createRecoveryProof(identity, proofSecret, Date.now() - 901_000),
    );
    assert.equal(
      (
        await destination(await request(ordinary.browser, "/nova-senha"))
      ).searchParams.get("erro"),
      "recuperacao",
    );
    ordinary.browser.set(
      "wf-recovery-proof",
      createRecoveryProof(
        { ...identity, sessionId: "different-session" },
        proofSecret,
      ),
    );
    assert.equal(
      (
        await destination(await request(ordinary.browser, "/nova-senha"))
      ).searchParams.get("erro"),
      "recuperacao",
    );
    pass(
      "ordinary sessions, expired proofs and proofs from another session are rejected",
    );

    phase = "legacy PKCE recovery";
    const legacyBrowser: Browser = new Map();
    await request(legacyBrowser, "/recuperar", recover); // Stores the SDK's PKCE verifier in this test browser.
    assert.equal(
      (
        await destination(
          await request(
            legacyBrowser,
            "/auth/callback?code=legacy-recovery&next=/painel",
          ),
        )
      ).pathname,
      "/nova-senha",
    );
    const legacyHtml = await (
      await request(legacyBrowser, "/nova-senha")
    ).text();
    assert.match(legacyHtml, /Repita a nova senha/);
    assert.equal(legacyBrowser.has("wf-recovery-proof"), false);
    const ordinaryPkce: Browser = new Map();
    await request(ordinaryPkce, "/recuperar", recover);
    assert.equal(
      (
        await destination(
          await request(
            ordinaryPkce,
            "/auth/callback?code=legacy-signup&next=/nova-senha",
          ),
        )
      ).searchParams.get("erro"),
      "recuperacao",
    );
    assert.ok(
      backend.state.jwksCalls > 0,
      "JWT verification must request the fixture JWKS",
    );
    pass(
      "legacy PKCE recovery uses verified AMR, not next or an unsigned cookie",
    );
    console.log(
      `PASS isolated auth: ${checks} flow groups; no email sent and no real account changed.`,
    );
  } finally {
    child.kill();
    await backend.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    `FAIL isolated auth at ${phase}; provider details and tokens omitted.`,
  );
  const location =
    error instanceof Error
      ? error.stack
          ?.split("\n")
          .find((line) => /test-auth-isolated\.(?:ts|js):\d+/.test(line))
      : undefined;
  if (location) console.error(location.trim());
  process.exitCode = 1;
});
