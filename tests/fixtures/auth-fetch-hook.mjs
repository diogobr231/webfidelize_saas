// Preloaded only by test-auth-isolated. Every provider request stays on loopback.
const nativeFetch = globalThis.fetch;
const backend = new URL(process.env.TEST_AUTH_BACKEND_URL ?? "");
if (backend.protocol !== "http:" || backend.hostname !== "127.0.0.1") {
  throw new Error("The isolated Auth backend must use loopback");
}
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (
    url.hostname.endsWith(".supabase.co") ||
    url.hostname === "fake.supabase.test"
  ) {
    const target = new URL(url.pathname + url.search, backend);
    if (input instanceof Request)
      return nativeFetch(new Request(target, input), init);
    return nativeFetch(target, init);
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("External fetch blocked by the isolated Auth test");
  }
  return nativeFetch(input, init);
};
