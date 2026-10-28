import test from "node:test";
import assert from "node:assert/strict";
import { salesOriginHash } from "../src/lib/sales-origin";

const secret = "isolated-test-secret-for-sales-origin-hmac";
const origin = (ip: string, extra = {}) =>
  salesOriginHash(
    new Headers({ "x-vercel-forwarded-for": ip, ...extra }),
    secret,
    true,
  );

test("source quotas use only Vercel's authoritative IP header", () => {
  const hash = origin("203.0.113.20");
  assert.match(hash!, /^[a-f0-9]{64}$/);
  assert.equal(hash!.includes("203.0.113.20"), false);
  assert.equal(
    origin("203.0.113.20", {
      "x-forwarded-for": "1.1.1.1",
      "x-real-ip": "8.8.8.8",
    }),
    hash,
  );
  assert.notEqual(origin("203.0.113.21"), hash);
  assert.notEqual(
    salesOriginHash(
      new Headers({ "x-vercel-forwarded-for": "203.0.113.20" }),
      secret + "other",
      true,
    ),
    hash,
  );
});

test("missing, malformed and multiple proxy addresses fail closed in Vercel", () => {
  for (const ip of [
    "",
    "unknown",
    "203.0.113.20, 1.1.1.1",
    "203.0.113.20:1234",
    "fe80::1%eth0",
    "[2001:db8::1]",
    "x".repeat(100),
  ])
    assert.equal(origin(ip), null);
  assert.equal(
    salesOriginHash(
      new Headers({ "x-forwarded-for": "203.0.113.20" }),
      secret,
      true,
    ),
    null,
  );
});

test("non-Vercel environments never trust spoofable proxy headers", () => {
  assert.equal(
    salesOriginHash(new Headers(), secret, false),
    salesOriginHash(
      new Headers({
        "x-vercel-forwarded-for": "1.1.1.1",
        "x-forwarded-for": "8.8.8.8",
      }),
      secret,
      false,
    ),
  );
});

test("IPv6 privacy addresses and equivalent spellings share a /64 source bucket", () => {
  assert.equal(
    origin("2001:db8:1234:5678::1"),
    origin("2001:0db8:1234:5678:0000:0000:0000:0001"),
  );
  assert.equal(
    origin("2001:db8:1234:5678::1"),
    origin("2001:DB8:1234:5678:ffff:abcd:2345:6789"),
  );
  assert.notEqual(
    origin("2001:db8:1234:5678::1"),
    origin("2001:db8:1234:5679::1"),
  );
  assert.equal(origin("::ffff:203.0.113.20"), origin("203.0.113.20"));
  assert.equal(origin("::ffff:cb00:7114"), origin("203.0.113.20"));
});

test("a valid private HMAC key is required", () => {
  for (const key of ["", "short", "x".repeat(1025)])
    assert.equal(salesOriginHash(new Headers(), key, false), null);
});
