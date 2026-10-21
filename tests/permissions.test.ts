import { test } from "node:test";
import assert from "node:assert/strict";
import { canManage, hasAccess } from "../src/lib/permissions";
test("employees cannot manage operational records", () => {
  assert.equal(canManage("EMPLOYEE"), false);
  assert.equal(canManage("MANAGER"), true);
  assert.equal(canManage("OWNER"), true);
});
test("trial expires at exact backend timestamp", () => {
  const expiration = "2026-10-18T12:00:00Z";
  assert.equal(hasAccess("trialing", expiration, new Date(expiration)), false);
  assert.equal(
    hasAccess("trialing", expiration, new Date("2026-10-18T11:59:59Z")),
    true,
  );
});
test("delinquent, canceled and suspended subscriptions cannot write", () => {
  for (const status of ["past_due", "canceled", "suspended", "pending_card"])
    assert.equal(hasAccess(status, "2099-01-01T00:00:00Z"), false);
  assert.equal(hasAccess("active", "2020-01-01T00:00:00Z"), true);
});

test("a missing, invalid or unconfirmed trial never grants access", () => {
  assert.equal(hasAccess("trialing", null), false);
  assert.equal(hasAccess("trialing", "invalid"), false);
  assert.equal(hasAccess("pending_card", null), false);
  assert.equal(hasAccess("active", null), true);
});
