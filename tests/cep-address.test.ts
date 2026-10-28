import assert from "node:assert/strict";
import test from "node:test";
import { formatCepAddress, normalizeCep } from "../src/lib/cep-address";

test("CEP formatting accepts exactly eight digits and ignores common punctuation", () => {
  assert.equal(normalizeCep("01310-100"), "01310100");
  assert.equal(normalizeCep(" 01310.100 "), "01310100");
  assert.equal(normalizeCep("01310-10"), null);
  assert.equal(normalizeCep("01310-1009"), null);
});

test("lookup suggestion includes street, neighborhood, city, state and CEP", () => {
  assert.equal(
    formatCepAddress(
      {
        logradouro: "Avenida Paulista",
        bairro: "Bela Vista",
        localidade: "São Paulo",
        uf: "sp",
      },
      "01310100",
    ),
    "Avenida Paulista, Bela Vista · São Paulo - SP · CEP 01310-100",
  );
});

test("lookup rejects incomplete or invalid location data and strips control bytes", () => {
  assert.equal(
    formatCepAddress({ localidade: "São Paulo", uf: "SP" }, "01310100"),
    "São Paulo - SP · CEP 01310-100",
  );
  assert.equal(
    formatCepAddress({ localidade: "São Paulo", uf: "S1" }, "01310100"),
    null,
  );
  assert.equal(
    formatCepAddress({ localidade: "São\nPaulo", uf: "SP" }, "01310100"),
    "São Paulo - SP · CEP 01310-100",
  );
});
