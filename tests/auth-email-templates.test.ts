import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  authCallbackUrl,
  authDestinationFromEmailRedirect,
  parseEmailConfirmation,
} from "../src/lib/auth-flow";

const origin = "https://webfidelize-saas.vercel.app";
const invitation = `/convite/${"cd".repeat(32)}`;
// Synthetic hashes are deliberately generated here, never copied from emails.
const tokenHash = `pkce_${"ab".repeat(28)}`;
const templates = {
  confirmation: readTemplate("confirmation"),
  recovery: readTemplate("recovery"),
  "password-changed": readTemplate("password-changed"),
};

function readTemplate(name: string) {
  return readFileSync(
    new URL(`../supabase/templates/${name}.html`, import.meta.url),
    "utf8",
  );
}

function expressions(html: string) {
  return [...html.matchAll(/{{\s*([\s\S]*?)\s*}}/g)].map((match) =>
    match[1].replace(/\s+/g, " ").trim(),
  );
}

// Structural URL-contract fixture only. It is not a Go-template interpreter
// and does not replace sending an actual template through Supabase Auth.
function resolveLink(templateLink: string, redirectTo: string) {
  return new URL(
    templateLink
      .replace(/{{\s*\.SiteURL\s*}}/g, origin)
      .replace(/{{\s*\.TokenHash\s*}}/g, tokenHash)
      .replace(
        /{{\s*\.RedirectTo\s*\|\s*urlquery\s*}}/g,
        encodeURIComponent(redirectTo).replace(
          /[!'()*]/g,
          (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
        ),
      )
      .replace(/&amp;/g, "&"),
  );
}

for (const [name, html] of Object.entries(templates)) {
  test(`${name}: readable Portuguese email uses the public logo and no tracking`, () => {
    assert.match(html, /<html lang="pt-BR">/);
    assert.match(html, /<meta charset="utf-8"/);
    assert.match(
      html,
      /name="viewport" content="width=device-width, initial-scale=1"/,
    );
    assert.match(html, /role="presentation"/);
    assert.match(html, /max-width: 600px/);
    assert.match(html, /overflow-wrap: anywhere/);
    assert.match(html, /src="{{ \.SiteURL }}\/webfidelize-logo\.png"/);
    assert.match(html, /alt="Web Fidelize"/);
    assert.match(
      html.replace(/\s+/g, " "),
      /nunca (?:solicita|informe) sua senha/,
    );
    assert.doesNotMatch(
      html,
      /<script|<iframe|<form|\son\w+=|javascript:|data:|https?:\/\//i,
    );
    assert.doesNotMatch(html, /\.ConfirmationURL|\.Token\s|\.Data|\.Email/);
    assert.equal([...html.matchAll(/<img\b/g)].length, 1);
    assert.ok(Buffer.byteLength(html, "utf8") < 20_000);
    const allowed = new Set([
      ".SiteURL",
      ".TokenHash",
      ".RedirectTo | urlquery",
    ]);
    assert.ok(expressions(html).every((expression) => allowed.has(expression)));
  });
}

for (const [name, type, cta] of [
  ["confirmation", "email", "Confirmar meu e-mail"],
  ["recovery", "recovery", "Continuar recuperação"],
] as const) {
  const html = templates[name];
  const links = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);

  test(`${name}: primary and fallback links preserve token and fixed application origin`, () => {
    assert.equal(links.length, 2);
    assert.equal(links[0], links[1]);
    assert.match(html, new RegExp(cta));
    assert.match(links[0], /{{ \.SiteURL }}\/auth\/confirm\?/);
    assert.ok(links[0].includes("{{ .RedirectTo | urlquery }}"));
    assert.doesNotMatch(links[0], /&(?!amp;)/);
    for (const redirectTo of [
      "",
      origin,
      authCallbackUrl(origin, invitation),
    ]) {
      const url = resolveLink(links[0], redirectTo);
      assert.equal(url.origin, origin);
      assert.equal(url.pathname, "/auth/confirm");
      assert.equal(url.searchParams.get("token_hash"), tokenHash);
      assert.equal(url.searchParams.get("type"), type);
      assert.equal(url.searchParams.get("redirect_to"), redirectTo);
      assert.equal([...url.searchParams].length, 3);
      const result = parseEmailConfirmation({
        token_hash: url.searchParams.get("token_hash"),
        type: url.searchParams.get("type"),
        next: authDestinationFromEmailRedirect(redirectTo, origin),
      });
      assert.equal(
        result?.next,
        type === "recovery"
          ? "/nova-senha"
          : redirectTo.includes("/auth/callback")
            ? invitation
            : "/painel",
      );
    }
  });

  test(`${name}: hostile redirect data cannot inject markup, change type or escape the site`, () => {
    for (const redirectTo of [
      'https://evil.example/"/><img src=x onerror=alert(1)>',
      `${authCallbackUrl(origin, invitation)}&type=recovery&token_hash=bad#fragment`,
      authCallbackUrl("https://evil.example", invitation),
      `${origin}/auth/callback?next=%2Fadmin`,
    ]) {
      const url = resolveLink(links[0], redirectTo);
      assert.equal(url.origin, origin);
      assert.equal(url.searchParams.get("type"), type);
      assert.equal(url.searchParams.get("token_hash"), tokenHash);
      assert.equal(url.searchParams.get("redirect_to"), redirectTo);
      assert.equal([...url.searchParams].length, 3);
      assert.equal(
        authDestinationFromEmailRedirect(redirectTo, origin),
        "/painel",
      );
      assert.doesNotMatch(url.href, /[<>"\s]/);
    }
  });
}

test("password-changed notification opens recovery without embedding any authentication token", () => {
  const html = templates["password-changed"];
  const links = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(links, [
    "{{ .SiteURL }}/recuperar",
    "{{ .SiteURL }}/recuperar",
  ]);
  assert.match(html, /Recuperar minha conta/);
  assert.match(html, /não altera sua senha\s+automaticamente/);
  assert.deepEqual([...new Set(expressions(html))], [".SiteURL"]);
});

test("email logo is a versioned PNG with the intended wide aspect ratio", () => {
  const logo = readFileSync(
    new URL("../public/webfidelize-logo.png", import.meta.url),
  );
  assert.equal(logo.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const width = logo.readUInt32BE(16);
  const height = logo.readUInt32BE(20);
  assert.ok(width >= 180 && height >= 60);
  assert.ok(Math.abs(width / height - 3) < 0.02);
});
