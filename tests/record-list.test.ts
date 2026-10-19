import test from "node:test";
import assert from "node:assert/strict";
import {
  recordFilters,
  recordNamePattern,
  recordPagination,
} from "../src/lib/record-list";

test("record search trims and bounds untrusted input without truncating Unicode code points", () => {
  assert.equal(
    recordFilters({ q: "  Cliente de teste  " }).search,
    "Cliente de teste",
  );
  assert.equal(
    Array.from(recordFilters({ q: "😀".repeat(81) }).search).length,
    80,
  );
  assert.ok(recordFilters({ q: "A".repeat(81) }).warning);
  assert.equal(recordFilters({ q: ["outro cliente"] }).search, "");
  assert.ok(recordFilters({ q: ["outro cliente"] }).warning);
});

test("record search treats wildcard characters as literal names", () => {
  assert.equal(recordNamePattern("50%_\\"), "%50\\%\\_\\\\%");
  assert.equal(recordNamePattern("O'Connor"), "%O'Connor%");
  assert.equal(recordNamePattern("Ana"), "%Ana%");
});

test("record pagination bounds hostile values and clamps beyond the final page", () => {
  for (const pagina of [
    undefined,
    "-1",
    "0",
    "1.2",
    "1e3",
    "Infinity",
    "999999999999",
    ["2"],
  ])
    assert.equal(recordFilters({ pagina }).page, 1);
  assert.equal(recordFilters({ pagina: "999999" }).page, 10_000);
  assert.equal(recordFilters({ pagina: "2" }).page, 2);
  assert.deepEqual(recordPagination(2, 51), {
    page: 2,
    pages: 3,
    from: 25,
    to: 49,
  });
  assert.deepEqual(recordPagination(900, 51), {
    page: 3,
    pages: 3,
    from: 50,
    to: 74,
  });
  assert.deepEqual(recordPagination(3, 0), {
    page: 1,
    pages: 1,
    from: 0,
    to: 24,
  });
});
