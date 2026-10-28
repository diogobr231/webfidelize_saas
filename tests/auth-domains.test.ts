import test from "node:test";
import assert from "node:assert/strict";
import {
  authDomainPolicy,
  authEntryRedirect,
  trustedAuthOrigin,
} from "../src/lib/auth-domains";
import {
  authCallbackUrl,
  authDestinationFromEmailRedirect,
} from "../src/lib/auth-flow";
import { authorizedDeploymentOrigin } from "../scripts/deployment-origin";

const canonical = "https://webfidelize.com";
const legacy = "https://webfidelize-saas.vercel.app";
const invitation = `/convite/${"ab".repeat(32)}`;

test("domain migration is opt-in and accepts only exact configured origins", () => {
  const unchanged = authDomainPolicy(legacy, undefined, true);
  assert.equal(unchanged.migrating, false);
  assert.equal(
    authEntryRedirect(
      "other.test",
      "/cadastro",
      new URLSearchParams(),
      unchanged,
    ),
    null,
  );
  const policy = authDomainPolicy(canonical, legacy, true);
  assert.equal(policy.migrating, true);
  assert.equal(
    trustedAuthOrigin("webfidelize-saas.vercel.app", policy),
    legacy,
  );
  assert.equal(trustedAuthOrigin("webfidelize.com", policy), canonical);
  for (const host of [
    null,
    "evil.test",
    "webfidelize.com.evil.test",
    "user@webfidelize.com",
    "webfidelize.com:443",
    "webfidelize.com,evil.test",
    "webfidelize.com ",
  ])
    assert.equal(trustedAuthOrigin(host, policy), null);
});

test("malformed migration configuration fails closed, without wildcards or HTTP production", () => {
  for (const value of [
    "https://*.vercel.app",
    `${legacy}/`,
    `${legacy}/path`,
    `${legacy}?a=b`,
    `${legacy}#x`,
    "https://u:p@webfidelize.com",
    "http://localhost:3000",
    `${legacy},`,
    "//webfidelize.com",
    "https://webfidelize.com\\@evil.test",
    Array(6).fill(legacy).join(","),
  ])
    assert.throws(() => authDomainPolicy(canonical, value, true));
  assert.throws(() =>
    authDomainPolicy("http://localhost:3000", "https://localhost:3000"),
  );
});

test("only auth entry routes move to canonical; callbacks, receipts and webhooks stay local", () => {
  const policy = authDomainPolicy(canonical, legacy, true);
  const params = new URLSearchParams({
    next: invitation,
    aviso: "confirme-email",
    token_hash: "private-token",
  });
  for (const path of ["/cadastro", "/entrar", "/entrar/salao", "/recuperar"]) {
    const target = new URL(
      authEntryRedirect("webfidelize-saas.vercel.app", path, params, policy)!,
    );
    assert.equal(target.origin, canonical);
    assert.equal(target.pathname, path);
    assert.equal(
      target.searchParams.get("next"),
      path === "/recuperar" ? null : invitation,
    );
    assert.equal(target.searchParams.has("token_hash"), false);
    assert.equal(
      authEntryRedirect("webfidelize.com", path, params, policy),
      null,
    );
  }
  for (const path of [
    "/auth/callback",
    "/auth/confirm",
    "/nova-senha",
    invitation,
    "/agendar/demo-salao",
    "/api/webhooks/mercadopago",
    "/painel",
    "/",
  ])
    assert.equal(
      authEntryRedirect("webfidelize-saas.vercel.app", path, params, policy),
      null,
    );
  assert.equal(
    new URL(
      authEntryRedirect(
        "evil.test",
        "/cadastro",
        new URLSearchParams({ next: "//evil.test" }),
        policy,
      )!,
    ).href,
    `${canonical}/cadastro`,
  );
});

test("legacy email callback data preserves only an invitation path and never navigates to that origin", () => {
  const policy = authDomainPolicy(canonical, legacy, true);
  assert.equal(
    authDestinationFromEmailRedirect(
      authCallbackUrl(legacy, invitation),
      canonical,
      policy.origins,
    ),
    invitation,
  );
  assert.equal(
    authDestinationFromEmailRedirect(
      authCallbackUrl(legacy, invitation),
      canonical,
    ),
    "/painel",
  );
  for (const value of [
    authCallbackUrl("https://evil.test", invitation),
    `${legacy}/other?next=${invitation}`,
    `${legacy}/auth/callback?next=//evil.test`,
    `${legacy}/auth/callback?next=${invitation}#x`,
  ])
    assert.equal(
      authDestinationFromEmailRedirect(value, canonical, policy.origins),
      "/painel",
    );
});

test("deployment smoke requires an explicit approved origin", () => {
  for (const origin of [canonical, legacy])
    assert.equal(authorizedDeploymentOrigin(origin), origin);
  for (const origin of [
    undefined,
    "",
    `${canonical}/`,
    `${canonical}.evil.test`,
    "https://www.webfidelize.com",
    "http://webfidelize.com",
  ])
    assert.throws(() => authorizedDeploymentOrigin(origin));
});
