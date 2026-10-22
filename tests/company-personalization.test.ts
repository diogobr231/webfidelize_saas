import assert from "node:assert/strict";
import test from "node:test";
import {
  LOGO_MAX_BYTES,
  logoPathBelongsToCompany,
  personalizationSchema,
  validateLogoBytes,
  COVER_MAX_BYTES,
  COVER_SOURCE_MAX_BYTES,
  coverPathBelongsToCompany,
  rasterDimensions,
  validateCoverBytes,
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

function coverPng(width: number, height: number, length = 32) {
  const bytes = new Uint8Array(length);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

test("cover validates signatures, stored size, pixel budget and dimensions", () => {
  assert.deepEqual(validateCoverBytes(coverPng(1600, 900), "image/png"), {
    mime: "image/png",
    extension: "png",
    width: 1600,
    height: 900,
  });
  for (const bytes of [
    coverPng(0, 1),
    coverPng(2561, 1),
    coverPng(900, 1600, COVER_MAX_BYTES + 1),
    new TextEncoder().encode("<svg></svg>"),
  ])
    assert.ok("error" in validateCoverBytes(bytes, "image/png"));
  assert.ok("error" in validateCoverBytes(coverPng(1600, 900), "image/jpeg"));
  assert.ok(
    "error" in
      validateCoverBytes(
        new Uint8Array(COVER_SOURCE_MAX_BYTES + 1),
        "image/png",
        true,
      ),
  );
  assert.ok(
    "error" in validateCoverBytes(coverPng(10000, 10000), "image/png", true),
  );
  assert.equal(
    "error" in validateCoverBytes(coverPng(6000, 4000), "image/png", true),
    false,
  );
});

test("cover reads JPEG and WebP dimensions and rejects truncated headers", () => {
  const jpeg = new Uint8Array([
    255, 216, 255, 192, 0, 17, 8, 3, 132, 6, 64, 3, 1, 0, 0, 2, 0, 0, 3, 0, 0,
    255, 217,
  ]);
  assert.deepEqual(rasterDimensions(jpeg, "image/jpeg"), {
    width: 1600,
    height: 900,
  });
  assert.equal("error" in validateCoverBytes(jpeg, "image/jpeg"), false);
  assert.equal(rasterDimensions(jpeg.slice(0, 9), "image/jpeg"), null);
  const webp = new Uint8Array(30);
  webp.set([82, 73, 70, 70]);
  webp.set([87, 69, 66, 80, 86, 80, 56, 88], 8);
  webp.set([63, 6, 0], 24);
  webp.set([131, 3, 0], 27);
  assert.deepEqual(rasterDimensions(webp, "image/webp"), {
    width: 1600,
    height: 900,
  });
  assert.equal("error" in validateCoverBytes(webp, "image/webp"), false);
});

test("cover cleanup refuses foreign folders, URLs and traversal", () => {
  const company = "00000000-0000-4000-8000-000000000001";
  const file = "00000000-0000-4000-8000-000000000002.jpg";
  assert.equal(coverPathBelongsToCompany(`${company}/${file}`, company), true);
  for (const name of [
    `https://external.test/${file}`,
    `${company}/../${file}`,
    `00000000-0000-4000-8000-000000000003/${file}`,
  ])
    assert.equal(coverPathBelongsToCompany(name, company), false);
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
