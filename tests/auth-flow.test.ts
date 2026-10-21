import test from "node:test";
import assert from "node:assert/strict";
import {
  authCallbackUrl,
  authCredentials,
  authDestination,
  authDestinationFromEmailRedirect,
  authEmail,
  authErrorMessage,
  authFailureCode,
  authPageUrl,
  hasRecentRecoveryClaims,
  isNeutralEmailError,
  newPassword,
  parseEmailConfirmation,
  resolveAuthOrigin,
} from "../src/lib/auth-flow";

const invitation = `/convite/${"a1".repeat(32)}`;
const tokenHash = "ab".repeat(28);

test("fixed-origin templates retain invitations only from the app callback", () => {
  const origin = "https://app.example";
  assert.equal(
    authDestinationFromEmailRedirect(
      authCallbackUrl(origin, invitation),
      origin,
    ),
    invitation,
  );
  for (const destination of [
    undefined,
    "",
    origin,
    `${origin}/`,
    `${origin}/auth/callback?next=/admin`,
    authCallbackUrl("https://evil.test", invitation),
    `https://user:password@app.example/auth/callback?next=${invitation}`,
    `${origin}/auth/callback?next=${invitation}#fragment`,
    `/auth/callback?next=${invitation}`,
    `${origin}/other?next=${invitation}`,
  ])
    assert.equal(
      authDestinationFromEmailRedirect(destination, origin),
      "/painel",
    );
});

test("auth preserves only the dashboard or an exact existing invitation token", () => {
  assert.equal(authDestination("/painel"), "/painel");
  assert.equal(authDestination(invitation), invitation);
  for (const value of [
    undefined,
    null,
    [invitation],
    "/admin",
    "/nova-senha",
    "//evil.test",
    "https://evil.test",
    "/\\evil.test",
    "/convite/123",
    `${invitation}?next=//evil.test`,
    `${invitation}#x`,
    `${invitation}/`,
    "/convite/" + "a".repeat(63),
    "/convite/%61" + "a".repeat(62),
  ]) {
    assert.equal(authDestination(value), "/painel", String(value));
  }
});

test("auth links retain the invitation across entry and registration without open redirects", () => {
  const url = new URL(
    authPageUrl("/cadastro", { next: invitation, erro: "validacao" }),
    "https://app.example",
  );
  assert.equal(url.pathname, "/cadastro");
  assert.equal(url.searchParams.get("next"), invitation);
  assert.equal(url.searchParams.get("erro"), "validacao");
  assert.equal(
    authPageUrl("/entrar", { next: "https://evil.test" }),
    "/entrar",
  );
  assert.equal(authPageUrl("/nova-senha", { next: invitation }), "/nova-senha");
});

test("email origins require explicit trustworthy configuration", () => {
  assert.equal(
    resolveAuthOrigin("https://app.example/", true),
    "https://app.example",
  );
  assert.equal(
    resolveAuthOrigin("http://localhost:3000"),
    "http://localhost:3000",
  );
  assert.equal(
    resolveAuthOrigin("http://127.0.0.1:3000/"),
    "http://127.0.0.1:3000",
  );
  for (const value of [
    undefined,
    "",
    "app.example",
    "//app.example",
    "javascript:alert(1)",
    "http://app.example",
    "https://user:password@app.example",
    "https://app.example/path",
    "https://app.example/?next=evil",
    "https://app.example/#fragment",
    " https://app.example ",
  ]) {
    assert.throws(() => resolveAuthOrigin(value), /Invalid APP_URL/);
  }
  assert.throws(() => resolveAuthOrigin("http://localhost:3000", true));
  assert.throws(() => resolveAuthOrigin("https://127.0.0.1", true));
});

test("callback URLs always include next for safe template interpolation and force password recovery", () => {
  assert.equal(
    new URL(
      authCallbackUrl("https://app.example", invitation),
    ).searchParams.get("next"),
    invitation,
  );
  assert.equal(
    new URL(
      authCallbackUrl("https://app.example", "https://evil.test"),
    ).searchParams.get("next"),
    "/painel",
  );
  assert.equal(
    new URL(
      authCallbackUrl("https://app.example", invitation, true),
    ).searchParams.get("next"),
    "/nova-senha",
  );
});

test("email confirmation accepts only token hashes and explicit supported verification types", () => {
  assert.equal(
    parseEmailConfirmation({ token_hash: `pkce_${tokenHash}`, type: "email" })
      ?.token_hash,
    `pkce_${tokenHash}`,
  );
  assert.deepEqual(
    parseEmailConfirmation({
      token_hash: tokenHash,
      type: "email",
      next: invitation,
    }),
    { token_hash: tokenHash, type: "email", next: invitation },
  );
  assert.equal(
    parseEmailConfirmation({
      token_hash: tokenHash,
      type: "recovery",
      next: invitation,
    })?.next,
    "/nova-senha",
  );
  assert.equal(
    parseEmailConfirmation({
      token_hash: tokenHash,
      type: "email",
      next: "//evil.test",
    })?.next,
    "/painel",
  );
  for (const input of [
    { token_hash: tokenHash, type: "invite" },
    { token_hash: tokenHash, type: "sms" },
    { token_hash: "123456", type: "recovery" },
    { token_hash: [tokenHash], type: "email" },
    { token_hash: tokenHash },
    {},
  ])
    assert.equal(parseEmailConfirmation(input), null);
});

test("password changes require a recent recovery method in verified claims for the same user", () => {
  const now = Date.UTC(2026, 9, 20, 12);
  const seconds = now / 1000;
  const userId = "8f0e52d8-59ac-40db-acda-b7ae930cc237";
  const claims = {
    sub: userId,
    session_id: "b46ca1d6-6fd1-436c-9f51-382a549576ab",
    exp: seconds + 3600,
    amr: [{ method: "recovery", timestamp: seconds - 20 }],
  };
  assert.equal(hasRecentRecoveryClaims(claims, userId, now), true);
  assert.equal(hasRecentRecoveryClaims(claims, "another-user", now), false);
  for (const patch of [
    { session_id: undefined },
    { exp: seconds },
    { amr: [{ method: "password", timestamp: seconds }] },
    { amr: [{ method: "otp", timestamp: seconds }] },
    { amr: ["recovery"] },
    { amr: [{ method: "recovery", timestamp: seconds - 900 }] },
    { amr: [{ method: "recovery", timestamp: seconds + 61 }] },
    { amr: [{ method: "recovery", timestamp: "recent" }] },
  ])
    assert.equal(
      hasRecentRecoveryClaims({ ...claims, ...patch }, userId, now),
      false,
    );
  assert.equal(hasRecentRecoveryClaims(null, userId, now), false);
});

test("Auth errors distinguish delivery and throttling without disclosing an account", () => {
  assert.equal(
    authFailureCode({ code: "over_email_send_rate_limit" }, "email"),
    "limite",
  );
  assert.equal(authFailureCode({ status: 429 }, "login"), "limite");
  assert.equal(
    authFailureCode({ code: "unexpected_failure", status: 500 }, "email"),
    "envio",
  );
  for (const code of [
    "invalid_credentials",
    "email_not_confirmed",
    "user_not_found",
  ])
    assert.equal(authFailureCode({ code }, "login"), "credenciais");
  for (const code of ["user_already_exists", "email_exists", "user_not_found"])
    assert.equal(isNeutralEmailError({ code }), true);
  assert.equal(isNeutralEmailError({ code: "unexpected_failure" }), false);
  assert.equal(
    authFailureCode({ code: "same_password" }, "password"),
    "senha-igual",
  );
  assert.equal(
    authFailureCode({ code: "weak_password" }, "email"),
    "senha-fraca",
  );
  assert.match(authErrorMessage("envio"), /Não foi possível enviar/);
  assert.match(authErrorMessage("link"), /expirou ou já foi usado/);
});

test("input validation bounds email and passwords and requires matching new passwords", () => {
  assert.equal(authEmail.safeParse("invalid").success, false);
  assert.equal(
    authCredentials.safeParse({
      email: "test@example.com",
      password: "1234567",
    }).success,
    false,
  );
  assert.equal(
    authCredentials.safeParse({
      email: "test@example.com",
      password: "StrongPassword123!",
    }).success,
    true,
  );
  assert.equal(
    newPassword.safeParse({
      password: "StrongPassword123!",
      password_confirmation: "other",
    }).success,
    false,
  );
  assert.equal(
    newPassword.safeParse({ password: "StrongPassword123!" }).success,
    false,
  );
  assert.equal(
    newPassword.safeParse({
      password: "x".repeat(129),
      password_confirmation: "x".repeat(129),
    }).success,
    false,
  );
  assert.equal(
    newPassword.safeParse({
      password: "StrongPassword123!",
      password_confirmation: "StrongPassword123!",
    }).success,
    true,
  );
});
