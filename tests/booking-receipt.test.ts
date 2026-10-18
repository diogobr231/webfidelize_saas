import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  bookingCalendar,
  bookingReceiptSchema,
  readDetailedReceipt,
  signDetailedReceipt,
  signReceipt,
  validReceipt,
  type BookingReceipt,
} from "../src/lib/booking-receipt";
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
  assert.equal(
    validReceipt("demo-salao", id, [proof] as unknown as string, "test-secret"),
    false,
  );
});

const receipt: BookingReceipt = {
  id: "00000000-0000-4000-8000-000000000001",
  service_name: "Corte e finalização",
  professional_name: "Profissional demonstração",
  starts_at: "2026-10-20T13:00:00+00:00",
  ends_at: "2026-10-20T13:30:00+00:00",
  status: "scheduled",
};
const requestId = "00000000-0000-4000-8000-000000000002";
const secret = "only-a-unit-test-secret";

test("detailed receipt preserves authoritative booking fields and binds the company and request", () => {
  const token = signDetailedReceipt("demo-salao", requestId, receipt, secret);
  const claims = readDetailedReceipt(token, "demo-salao", secret);
  assert.deepEqual(claims?.receipt, receipt);
  assert.equal(claims?.request_id, requestId);
  assert.equal(readDetailedReceipt(token, "another-company", secret), null);
  assert.equal(readDetailedReceipt(token, "demo-salao", "wrong-key"), null);
});

test("detailed receipt rejects modified payloads, signatures, excessive length and malformed JSON", () => {
  const token = signDetailedReceipt("demo-salao", requestId, receipt, secret);
  const [encoded, proof] = token.split(".");
  const changed = JSON.parse(Buffer.from(encoded, "base64url").toString());
  changed.receipt.starts_at = "2026-10-21T13:00:00+00:00";
  const altered = Buffer.from(JSON.stringify(changed)).toString("base64url");
  assert.equal(
    readDetailedReceipt(`${altered}.${proof}`, "demo-salao", secret),
    null,
  );
  assert.equal(
    readDetailedReceipt(`${encoded}.${"0".repeat(64)}`, "demo-salao", secret),
    null,
  );
  assert.equal(
    readDetailedReceipt("x".repeat(4097), "demo-salao", secret),
    null,
  );
  assert.equal(readDetailedReceipt("invalid.nope", "demo-salao", secret), null);
  const malformed = Buffer.from("not json").toString("base64url");
  const malformedProof = createHmac("sha256", secret)
    .update(`booking-details:${malformed}`)
    .digest("hex");
  assert.equal(
    readDetailedReceipt(`${malformed}.${malformedProof}`, "demo-salao", secret),
    null,
  );
});

test("receipt schema rejects personal fields, unknown statuses and invalid time ranges", () => {
  assert.equal(
    bookingReceiptSchema.safeParse({
      ...receipt,
      customer_name: "must not be exposed",
    }).success,
    false,
  );
  assert.equal(
    bookingReceiptSchema.safeParse({ ...receipt, status: "paid" }).success,
    false,
  );
  assert.equal(
    bookingReceiptSchema.safeParse({ ...receipt, ends_at: receipt.starts_at })
      .success,
    false,
  );
  assert.equal(
    bookingReceiptSchema.safeParse({
      ...receipt,
      starts_at: "2026-99-99T00:00:00Z",
    }).success,
    false,
  );
  assert.throws(() =>
    signDetailedReceipt(
      "demo-salao",
      requestId,
      { ...receipt, phone: "11999999999" } as BookingReceipt,
      secret,
    ),
  );
});

test("calendar uses UTC interval and stable reservation ID without customer details", () => {
  const ics = bookingCalendar(receipt, new Date("2026-10-18T12:00:00Z"));
  assert.ok(ics.includes("DTSTART:20261020T130000Z\r\nDTEND:20261020T133000Z"));
  assert.ok(ics.includes(`UID:${receipt.id}@webfidelize`));
  assert.ok(ics.includes("STATUS:CONFIRMED"));
  assert.ok(!ics.includes("ATTENDEE:"));
  assert.ok(!ics.includes("ORGANIZER:"));
  assert.ok(
    bookingCalendar({ ...receipt, status: "canceled" }).includes(
      "STATUS:CANCELLED",
    ),
  );
});

test("calendar escapes text injection and folds long UTF-8 lines without losing accents", () => {
  const maliciousName =
    "Serviço, especial;\\teste\r\nEND:VEVENT\r\nBEGIN:VEVENT";
  const longName = "Profissional de demonstração ".repeat(4);
  const ics = bookingCalendar({
    ...receipt,
    service_name: maliciousName,
    professional_name: longName,
  });
  const unfolded = ics.replace(/\r\n /g, "");
  assert.ok(
    unfolded.includes(
      "SUMMARY:Serviço\\, especial\\;\\\\teste\\nEND:VEVENT\\nBEGIN:VEVENT",
    ),
  );
  assert.equal(ics.split("\r\nBEGIN:VEVENT\r\n").length - 1, 1);
  assert.equal(ics.split("\r\nEND:VEVENT\r\n").length - 1, 1);
  assert.ok(unfolded.includes(longName));
  for (const line of ics.split("\r\n"))
    assert.ok(Buffer.byteLength(line, "utf8") <= 75);
});
