import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSalesTestOrigin } from "../scripts/sales-test-origin";

const production = "https://web-fidelize.example.com";
const authorized = { remoteEnabled: true, allowedOrigin: production };

test("sales live tests retain their local default without remote opt-in", () => {
  assert.equal(resolveSalesTestOrigin().origin, "http://localhost:3000");
  assert.equal(
    resolveSalesTestOrigin("http://127.0.0.1:3001/").origin,
    "http://127.0.0.1:3001",
  );
});

test("sales live tests require both remote opt-in and an exact allowed origin", () => {
  assert.throws(() => resolveSalesTestOrigin(production));
  assert.throws(() =>
    resolveSalesTestOrigin(production, { remoteEnabled: true }),
  );
  assert.throws(() =>
    resolveSalesTestOrigin(production, { allowedOrigin: production }),
  );
  assert.equal(resolveSalesTestOrigin(production, authorized).origin, production);
  assert.equal(
    resolveSalesTestOrigin(production + "/", authorized).origin,
    production,
  );
});

test("sales live tests reject different hosts, subdomains, ports and insecure remote URLs", () => {
  for (const target of [
    "https://other.example.com",
    "https://web-fidelize.example.com.attacker.example",
    "https://preview.web-fidelize.example.com",
    production + ":8443",
    "http://web-fidelize.example.com",
    "https://localhost.attacker.example",
  ])
    assert.throws(() => resolveSalesTestOrigin(target, authorized));
  assert.throws(() =>
    resolveSalesTestOrigin("http://web-fidelize.example.com", {
      remoteEnabled: true,
      allowedOrigin: "http://web-fidelize.example.com",
    }),
  );
});

test("sales live tests reject credentials and non-origin components on local or remote targets", () => {
  for (const target of [
    "https://user:password@web-fidelize.example.com",
    production + "/admin",
    production + "/%2f",
    production + "?next=other",
    production + "#fragment",
    " " + production,
    production + "\n",
    "http://user@localhost:3000",
    "http://localhost:3000/admin",
    "file:///tmp/test",
    "not-a-url",
  ])
    assert.throws(() => resolveSalesTestOrigin(target, authorized));
});

test("sales live tests validate the allowlist itself without hostname wildcards", () => {
  for (const allowedOrigin of [
    "https://*.example.com",
    production + "/admin",
    production + "?anything=1",
    "https://user@web-fidelize.example.com",
    production + "#fragment",
    "not-a-url",
  ])
    assert.throws(() =>
      resolveSalesTestOrigin(production, {
        remoteEnabled: true,
        allowedOrigin,
      }),
    );
});
