import { test } from "node:test";
import assert from "node:assert/strict";
import { signReceipt, validReceipt } from "../src/lib/booking-receipt";
test("booking confirmation requires a genuine server-signed receipt", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const proof = signReceipt("demo-salao", id, "test-secret");
  assert.equal(validReceipt("demo-salao", id, proof, "test-secret"), true);
  assert.equal(
    validReceipt("another-company", id, proof, "test-secret"),
    false,
  );
  assert.equal(validReceipt("demo-salao", id, proof, "wrong-key"), false);
  assert.equal(validReceipt("demo-salao", id, "forged", "test-secret"), false);
});
