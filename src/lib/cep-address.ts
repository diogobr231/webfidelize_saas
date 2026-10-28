export type CepLookupResult = {
  logradouro?: unknown;
  bairro?: unknown;
  localidade?: unknown;
  uf?: unknown;
};

export function normalizeCep(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  return digits.length === 8 ? digits : null;
}

function cleanAddressPart(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .trim()
        .slice(0, maxLength)
    : "";
}

export function formatCepAddress(
  result: CepLookupResult,
  cep: string,
): string | null {
  const validCep = normalizeCep(cep);
  const city = cleanAddressPart(result.localidade, 80);
  const state = cleanAddressPart(result.uf, 2).toUpperCase();
  if (!validCep || !city || !/^[A-Z]{2}$/.test(state)) return null;

  const street = cleanAddressPart(result.logradouro, 100);
  const neighborhood = cleanAddressPart(result.bairro, 80);
  const streetLine = [street, neighborhood].filter(Boolean).join(", ");
  const locality = `${city} - ${state}`;
  return [
    streetLine,
    locality,
    `CEP ${validCep.slice(0, 5)}-${validCep.slice(5)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}
