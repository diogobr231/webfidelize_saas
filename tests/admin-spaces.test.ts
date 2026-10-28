import assert from "node:assert/strict";
import test from "node:test";
import {
  adminSpaceNamePattern,
  adminSpacesFilters,
  adminSpacesHref,
  adminSpacesPagination,
} from "@/lib/admin-spaces";

test("company name search treats LIKE wildcards and backslash as literal text", () => {
  assert.equal(adminSpaceNamePattern("50%_\\Loja"), "%50\\%\\_\\\\Loja%");
  assert.equal(adminSpaceNamePattern("Loja, filial (A)"), "%Loja, filial (A)%");
  assert.equal(adminSpaceNamePattern("%"), "%\\%%");
});

test("space filters whitelist known options and reject duplicate or injected filters", () => {
  const valid = adminSpacesFilters({
    q: "  Empresa QA  ",
    plano: "profissional",
    situacao: "trial_expired",
    segmento: "salao",
    pagina: "8",
  });
  assert.equal(valid.search, "Empresa QA");
  assert.equal(valid.plan, "profissional");
  assert.equal(valid.status, "trial_expired");
  assert.equal(valid.niche, "salao");
  assert.equal(valid.page, 8);
  const invalid = adminSpacesFilters({
    q: ["uma", "outra"],
    plano: "eq.admin",
    situacao: ["active", "suspended"],
    segmento: "salao,or(name.eq.teste)",
    pagina: "9007199254740992",
  });
  assert.equal(invalid.search, "");
  assert.equal(invalid.plan, "all");
  assert.equal(invalid.status, "all");
  assert.equal(invalid.niche, "all");
  assert.equal(invalid.page, 1);
  assert(invalid.warning);
  const long = adminSpacesFilters({ q: "😀".repeat(81) });
  assert.equal(Array.from(long.search).length, 80);
  assert(long.warning);
});

test("all spaces remain reachable beyond 100 records and out-of-range pages clamp to the real last page", () => {
  assert.deepEqual(adminSpacesPagination(5, 126), {
    page: 5,
    pages: 6,
    from: 100,
    to: 124,
  });
  assert.deepEqual(adminSpacesPagination(6, 126), {
    page: 6,
    pages: 6,
    from: 125,
    to: 149,
  });
  assert.deepEqual(adminSpacesPagination(9999, 126), {
    page: 6,
    pages: 6,
    from: 125,
    to: 149,
  });
  assert.deepEqual(adminSpacesPagination(100_001, 2_500_001), {
    page: 100_001,
    pages: 100_001,
    from: 2_500_000,
    to: 2_500_024,
  });
  assert.deepEqual(adminSpacesPagination(0, 0), {
    page: 1,
    pages: 1,
    from: 0,
    to: 24,
  });
  assert.equal(adminSpacesPagination(Number.NaN, 26).page, 1);
});

test("pagination links preserve sanitized filters and cannot introduce an external destination", () => {
  const filters = adminSpacesFilters({
    q: "Loja &next=https://evil.invalid/#x",
    plano: "empresarial",
    segmento: "pet-shop",
    situacao: "active",
  });
  const url = new URL(
    adminSpacesHref(filters, 2),
    "https://webfidelize-saas.vercel.app",
  );
  assert.equal(url.origin, "https://webfidelize-saas.vercel.app");
  assert.equal(url.pathname, "/admin/espacos");
  assert.equal(url.searchParams.get("q"), filters.search);
  assert.equal(url.searchParams.get("plano"), "empresarial");
  assert.equal(url.searchParams.get("segmento"), "pet-shop");
  assert.equal(url.searchParams.get("situacao"), "active");
  assert.equal(url.searchParams.get("pagina"), "2");
  assert.equal(url.searchParams.has("next"), false);
  assert.equal(url.hash, "#lista-empresas");
});
