import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeSalesPhone,
  salesMoneyToCents,
  salesDateToIso,
  salesInquirySchema,
  salesOfferSchema,
  salesLeadUpdateSchema,
  salesLeadCreateSchema,
} from "../src/lib/sales";

const inquiry = {
  offer_id: "11111111-1111-4111-8111-111111111111",
  contact_name: "Pessoa QA",
  company_name: "Empresa de teste",
  email: "QA@EXAMPLE.INVALID",
  phone: "(18) 99769-5445",
  niche: "salao",
  team_size: "2-5",
  budget_range: "1000-3000",
  timeline: "30-days",
  decision_role: "owner",
  challenge: "Organizar o atendimento e os agendamentos.",
  consent: "yes",
  website: "",
  request_id: "22222222-2222-4222-8222-222222222222",
};
test("new plan interests and historical investment bands remain distinct", () => {
  for (const budget_range of [
    "plan-essencial",
    "plan-profissional",
    "plan-empresarial",
    "other",
    "under-1000",
    "1000-3000",
  ]) {
    assert.equal(
      salesInquirySchema.parse({ ...inquiry, budget_range }).budget_range,
      budget_range,
    );
    assert.equal(
      salesLeadUpdateSchema.parse({ budget_range }).budget_range,
      budget_range,
    );
  }
  assert.equal(
    salesInquirySchema.safeParse({ ...inquiry, budget_range: "plan-admin" })
      .success,
    false,
  );
});
test("sales capture validates consent, contact, qualifying enums and request identity", () => {
  const valid = salesInquirySchema.parse(inquiry);
  assert.equal(valid.email, "qa@example.invalid");
  assert.equal(valid.phone, "5518997695445");
  assert.equal(valid.utm_source, "");
  for (const patch of [
    { consent: "" },
    { website: "bot" },
    { request_id: "anything" },
    { offer_id: "anything" },
    { phone: "123" },
    { challenge: "abc" },
    { team_size: "unknown" },
    { budget_range: "rich" },
    { niche: "unknown" },
    { utm_source: "x".repeat(121) },
  ])
    assert.equal(
      salesInquirySchema.safeParse({ ...inquiry, ...patch }).success,
      false,
    );
});
test("sales public input never passes stage, billing or admin fields through", () => {
  const input = salesInquirySchema.parse({
    ...inquiry,
    stage: "won",
    consent_at: "2020-01-01",
    source: "manual",
    setup_value_cents: 9999,
    company_id: "other",
  });
  for (const key of [
    "stage",
    "consent_at",
    "source",
    "setup_value_cents",
    "company_id",
  ])
    assert.equal(Object.hasOwn(input, key), false);
});
test("sales phone normalization only yields Brazilian numeric contact links", () => {
  assert.equal(normalizeSalesPhone("+55 (11) 99876-5432"), "5511998765432");
  assert.equal(normalizeSalesPhone("1134567890"), "551134567890");
  for (const invalid of [
    "javascript:alert(1)",
    "0012345678",
    "1555555555555",
    "abc11998765432",
    "5511998765432123",
  ])
    assert.equal(normalizeSalesPhone(invalid), null);
});
test("sales amounts preserve cents, optional quotes and reject ambiguous or unsafe numbers", () => {
  assert.equal(salesMoneyToCents(""), null);
  assert.equal(salesMoneyToCents("0"), 0);
  assert.equal(salesMoneyToCents("1990,90"), 199090);
  assert.equal(salesMoneyToCents("1990.9"), 199090);
  for (const invalid of [
    "1.990,90",
    "1,990.90",
    "-1",
    "Infinity",
    "1e4",
    "99999999",
    "1.001",
  ])
    assert.ok(Number.isNaN(salesMoneyToCents(invalid)));
});
test("sales follow-up timestamps are explicitly Brasília and reject nonexistent dates", () => {
  assert.equal(salesDateToIso("2026-10-21T10:30"), "2026-10-21T13:30:00.000Z");
  assert.equal(salesDateToIso(""), null);
  for (const invalid of [
    "2026-02-30T10:30",
    "2026-10-21T25:30",
    "2026-10-21",
    "2026-10-21T10:30Z",
  ])
    assert.equal(salesDateToIso(invalid), "invalid");
});
test("sales offers preserve private drafts and reject publishing archived offers", () => {
  const offer = {
    slug: "web-fidelize",
    title: "Web Fidelize",
    summary: "Implantação do núcleo de agenda e clientes.",
    niche: null,
    active: true,
    published: false,
    setup_price_cents: null,
    monthly_price_cents: null,
  };
  assert.equal(salesOfferSchema.safeParse(offer).success, true);
  assert.equal(
    salesOfferSchema.safeParse({ ...offer, active: false, published: true })
      .success,
    false,
  );
  assert.equal(
    salesOfferSchema.safeParse({ ...offer, setup_price_cents: -1 }).success,
    false,
  );
  assert.equal(
    salesLeadUpdateSchema.safeParse({ stage: "active" }).success,
    false,
  );
  assert.equal(salesLeadUpdateSchema.safeParse({}).success, false);
  assert.deepEqual(salesLeadUpdateSchema.parse({ stage: "qualified" }), {
    stage: "qualified",
  });
});
test("manual sales intake permits unknown qualification without inventing consent or answers", () => {
  const lead = salesLeadCreateSchema.parse({
    offer_id: inquiry.offer_id,
    contact_name: inquiry.contact_name,
    company_name: inquiry.company_name,
    phone: inquiry.phone,
    source: "manual",
    consent: false,
  });
  assert.equal(lead.email, "");
  assert.equal(lead.team_size, "");
  assert.equal(lead.consent, false);
});
