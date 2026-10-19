import assert from "node:assert/strict";
import test from "node:test";
import {
  LOGO_MAX_BYTES,
  logoPathBelongsToCompany,
  personalizationSchema,
  validateLogoBytes,
} from "../src/lib/company-personalization";

test("personalization validates presets and commercial details", () => {
  const valid = {
    name: "Empresa de teste",
    description: "Atendimento",
    address: "Rua de teste",
    phone: "(18) 99769-5445",
    theme: "teal",
    density: "comfortable",
    agenda_view: "week",
  };
  const parsed = personalizationSchema.parse(valid);
  assert.equal(parsed.phone, "18997695445");
  for (const change of [
    { theme: "url(javascript:alert(1))" },
    { density: "hidden" },
    { agenda_view: "month" },
    { phone: "texto" },
    { name: "x" },
    { description: "x".repeat(241) },
  ]) {
    assert.equal(
      personalizationSchema.safeParse({ ...valid, ...change }).success,
      false,
    );
  }
});

test("logo validation rejects SVG, MIME spoofing, empty and oversized input", () => {
  assert.ok(
    "error" in
      validateLogoBytes(
        new TextEncoder().encode('<svg onload="alert(1)"/>'),
        "image/png",
      ),
  );
  assert.ok("error" in validateLogoBytes(new Uint8Array(), "image/png"));
  assert.ok(
    "error" in
      validateLogoBytes(new Uint8Array(LOGO_MAX_BYTES + 1), "image/png"),
  );
  assert.ok(
    "error" in
      validateLogoBytes(new Uint8Array([255, 216, 255, 255, 217]), "image/png"),
  );
});

test("logo validation checks raster signatures rather than filename", () => {
  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  png.set([73, 72, 68, 82], 12);
  assert.deepEqual(validateLogoBytes(png, "image/png"), {
    mime: "image/png",
    extension: "png",
  });
  assert.deepEqual(
    validateLogoBytes(new Uint8Array([255, 216, 255, 255, 217]), "image/jpeg"),
    { mime: "image/jpeg", extension: "jpg" },
  );
  const webp = new Uint8Array(20);
  webp.set([82, 73, 70, 70]);
  webp.set([87, 69, 66, 80], 8);
  assert.deepEqual(validateLogoBytes(webp, "image/webp"), {
    mime: "image/webp",
    extension: "webp",
  });
});

test("logo names reject remote URLs, traversal and other companies", () => {
  const company = "00000000-0000-4000-8000-000000000001";
  const asset = "00000000-0000-4000-8000-000000000002.png";
  assert.equal(logoPathBelongsToCompany(`${company}/${asset}`, company), true);
  for (const path of [
    `${company}/../${asset}`,
    `https://example.test/${asset}`,
    `${company}/${asset}.svg`,
    `00000000-0000-4000-8000-000000000003/${asset}`,
  ]) {
    assert.equal(logoPathBelongsToCompany(path, company), false);
  }
});
