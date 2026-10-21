import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  createRecoveryProof,
  validRecoverySecret,
  verifyRecoveryProof,
} from "../src/lib/auth-recovery-proof";

const secret = "local-test-only-not-a-production-secret";
const identity = {
  userId: "c40e7fd9-9671-44ca-b4aa-3b4f30316017",
  sessionId: "db8ec45b-1abf-46f7-b6dd-58dbf8409123",
};
const now = Date.UTC(2026, 9, 20, 12);

test("recovery proofs are valid only for the verified user and session", () => {
  const proof = createRecoveryProof(identity, secret, now);
  assert.equal(verifyRecoveryProof(proof, identity, secret, now), true);
  assert.equal(
    verifyRecoveryProof(
      proof,
      { ...identity, userId: "other-user" },
      secret,
      now,
    ),
    false,
  );
  assert.equal(
    verifyRecoveryProof(
      proof,
      { ...identity, sessionId: "another-session" },
      secret,
      now,
    ),
    false,
  );
});

test("recovery proofs reject tampering, foreign signatures and malformed data", () => {
  const proof = createRecoveryProof(identity, secret, now);
  const [payload, signature] = proof.split(".");
  const modified = Buffer.from(
    JSON.stringify({
      ...JSON.parse(Buffer.from(payload, "base64url").toString()),
      sub: "another-user",
    }),
  ).toString("base64url");
  assert.equal(
    verifyRecoveryProof(`${modified}.${signature}`, identity, secret, now),
    false,
  );
  assert.equal(
    verifyRecoveryProof(
      proof,
      identity,
      "another-long-secret-not-for-production",
      now,
    ),
    false,
  );
  for (const value of [
    undefined,
    "",
    "x",
    `${payload}.00`,
    `${payload}.${"z".repeat(64)}`,
    `${proof}.extra`,
    "x".repeat(1025),
  ])
    assert.equal(verifyRecoveryProof(value, identity, secret, now), false);
  const otherPurpose = createHmac("sha256", secret)
    .update(`other-purpose:${payload}`)
    .digest("hex");
  assert.equal(
    verifyRecoveryProof(`${payload}.${otherPurpose}`, identity, secret, now),
    false,
  );
});

test("recovery proofs expire after fifteen minutes and reject future timestamps", () => {
  const proof = createRecoveryProof(identity, secret, now);
  assert.equal(
    verifyRecoveryProof(proof, identity, secret, now + 899_000),
    true,
  );
  assert.equal(
    verifyRecoveryProof(proof, identity, secret, now + 900_000),
    false,
  );
  assert.equal(
    verifyRecoveryProof(proof, identity, secret, now - 61_000),
    false,
  );
});

test("recovery fails closed without a dedicated secret", () => {
  const proof = createRecoveryProof(identity, secret, now);
  for (const value of [undefined, "", "too-short"]) {
    assert.equal(validRecoverySecret(value), false);
    assert.equal(verifyRecoveryProof(proof, identity, value, now), false);
  }
  assert.throws(() => createRecoveryProof(identity, "", now), /not configured/);
});
