// Only loaded explicitly by the isolated HTTP test's Node process. Never imported
// by the application. Both providers are fixtures; every external fetch is denied.
const nativeFetch = globalThis.fetch;
const backend = new URL(process.env.TEST_BILLING_BACKEND_URL ?? "");
if (backend.protocol !== "http:" || backend.hostname !== "127.0.0.1") {
  throw new Error("Billing fixtures must be on loopback");
}
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  let target;
  if (
    url.hostname.endsWith(".supabase.co") ||
    url.hostname === "fake.supabase.test"
  ) {
    target = new URL(url.pathname + url.search, backend);
  } else if (url.origin === "https://api.mercadopago.com") {
    target = new URL("/__mercadopago" + url.pathname + url.search, backend);
  } else if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("External network disabled in isolated billing test");
  }
  if (!target) return nativeFetch(input, init);
  if (input instanceof Request)
    return nativeFetch(new Request(target, input), init);
  return nativeFetch(target, init);
};
