import test from "node:test";
import assert from "node:assert/strict";
import {
  classError,
  classPage,
  classReceiptSchema,
  classSessionFormSchema,
  publicClassReservationSchema,
  publicClassSchema,
} from "../src/lib/classes";
import { readClassReceipt, signClassReceipt } from "../src/lib/class-receipt";

const service = "11111111-1111-4111-8111-111111111111";
const professional = "22222222-2222-4222-8222-222222222222";
const request = "33333333-3333-4333-8333-333333333333";
const session = "44444444-4444-4444-8444-444444444444";
const form = {
  service,
  professional,
  title: " Oficina em grupo ",
  day: "2026-11-05",
  time: "09:00",
  capacity: "10",
  is_public: true,
};

test("class form validates capacity, identity, real date and local time", () => {
  const parsed = classSessionFormSchema.parse(form);
  assert.equal(parsed.title, "Oficina em grupo");
  assert.equal(parsed.capacity, 10);
  for (const patch of [
    { capacity: "0" },
    { capacity: "101" },
    { capacity: "1.5" },
    { capacity: "" },
    { day: "2026-02-30" },
    { day: "2100-01-01" },
    { time: "24:00" },
    { service: "foreign-text" },
    { professional: "" },
    { title: " " },
  ])
    assert.equal(
      classSessionFormSchema.safeParse({ ...form, ...patch }).success,
      false,
    );
});

test("public class reservation requires consent, valid contact and a clean honeypot", () => {
  const input = {
    session,
    request_id: request,
    customer_name: " Cliente QA ",
    phone: "(11) 98888-7777",
    consent: "on",
    website: "",
  };
  const parsed = publicClassReservationSchema.parse(input);
  assert.equal(parsed.customer_name, "Cliente QA");
  assert.equal(parsed.phone, "11988887777");
  for (const patch of [
    { consent: undefined },
    { website: "spam" },
    { request_id: "1" },
    { phone: "123" },
    { customer_name: "" },
  ])
    assert.equal(
      publicClassReservationSchema.safeParse({ ...input, ...patch }).success,
      false,
    );
});

test("public class contract rejects impossible occupancy and reversed intervals", () => {
  const input = {
    id: session,
    title: "Oficina",
    starts_at: "2026-11-05T12:00:00Z",
    ends_at: "2026-11-05T13:00:00Z",
    capacity: 10,
    remaining: 4,
    service: { id: service, name: "Oficina", duration: 60, price_cents: 5000 },
    professional: { id: professional, name: "Profissional QA" },
  };
  assert.equal(publicClassSchema.safeParse(input).success, true);
  for (const patch of [
    { remaining: 11 },
    { remaining: -1 },
    { remaining: 1.5 },
    { capacity: 101 },
    { ends_at: input.starts_at },
  ])
    assert.equal(
      publicClassSchema.safeParse({ ...input, ...patch }).success,
      false,
    );
});

test("class receipt capability is tenant-bound and rejects forgery and malformed input", () => {
  const token = signClassReceipt("empresa-qa", request, "isolated-test-secret");
  assert.equal(
    readClassReceipt(token, "empresa-qa", "isolated-test-secret"),
    request,
  );
  assert.equal(
    readClassReceipt(token, "outra-empresa", "isolated-test-secret"),
    null,
  );
  assert.equal(readClassReceipt(token, "empresa-qa", "different-secret"), null);
  for (const input of [
    null,
    "",
    "a".repeat(500),
    `${request}.abc`,
    `${request}.${"0".repeat(64)}`,
    token + ".extra",
  ])
    assert.equal(
      readClassReceipt(input, "empresa-qa", "isolated-test-secret"),
      null,
    );
  assert.throws(() =>
    signClassReceipt("../invalid", request, "isolated-test-secret"),
  );
});

test("authoritative class receipt accepts cancellation and excludes customer PII", () => {
  const receipt = {
    registration_id: request,
    class_id: session,
    title: "Oficina",
    starts_at: "2026-11-05T12:00:00Z",
    ends_at: "2026-11-05T13:00:00Z",
    status: "canceled",
    class_status: "canceled",
    service_name: "Serviço QA",
    professional_name: "Profissional QA",
    company_name: "Empresa QA",
  };
  assert.equal(classReceiptSchema.safeParse(receipt).success, true);
  assert.equal(
    classReceiptSchema.safeParse({ ...receipt, customer_phone: "11988887777" })
      .success,
    false,
  );
  assert.equal(
    classReceiptSchema.safeParse({ ...receipt, class_status: "fake_active" })
      .success,
    false,
  );
  assert.equal(
    classReceiptSchema.safeParse({ ...receipt, ends_at: receipt.starts_at })
      .success,
    false,
  );
});

test("class pagination is bounded and public messages never echo backend secrets", () => {
  assert.equal(classPage("2"), 2);
  for (const input of [undefined, "0", "-1", "1.5", "100000", ["1"]])
    assert.equal(classPage(input), 1);
  assert.match(classError("class full"), /lotada/);
  assert.match(classError("class has attendance"), /presenças/);
  assert.match(classError("registration version conflict"), /outra aba/);
  assert.doesNotMatch(
    classError("SENSITIVE_INTERNAL_SECRET"),
    /SENSITIVE_INTERNAL_SECRET/,
  );
});
