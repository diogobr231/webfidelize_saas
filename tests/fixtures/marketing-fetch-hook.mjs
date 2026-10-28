// Explicit preload for the isolated marketing HTTP suite only. No remote call
// may leave this Next process, including AI providers and original Supabase.
const nativeFetch = globalThis.fetch;
const backend = new URL(process.env.TEST_MARKETING_BACKEND_URL ?? "");
if (backend.protocol !== "http:" || backend.hostname !== "127.0.0.1")
  throw new Error("Marketing fixtures must use loopback");

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (
    url.hostname.endsWith(".supabase.co") ||
    url.hostname === "fake.supabase.test"
  ) {
    const target = new URL(url.pathname + url.search, backend);
    return input instanceof Request
      ? nativeFetch(new Request(target, input), init)
      : nativeFetch(target, init);
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw new Error("External network disabled in isolated marketing test");
  return nativeFetch(input, init);
};
