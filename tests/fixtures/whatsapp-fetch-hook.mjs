// Loaded only by test-whatsapp-http. This process cannot contact Meta or a real
// database: provider HTTP calls are redirected to the loopback fixture, and all
// other external fetches fail closed. No live credentials are needed.
const nativeFetch = globalThis.fetch;
const backend = new URL(process.env.TEST_WHATSAPP_BACKEND_URL ?? "");
if (backend.protocol !== "http:" || backend.hostname !== "127.0.0.1") {
  throw new Error("The WhatsApp fixture must use loopback");
}

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (
    url.hostname.endsWith(".supabase.co") ||
    url.hostname === "fake.supabase.test" ||
    url.hostname === "graph.facebook.com"
  ) {
    const prefix = url.hostname === "graph.facebook.com" ? "/meta" : "";
    const target = new URL(prefix + url.pathname + url.search, backend);
    if (input instanceof Request)
      return nativeFetch(new Request(target, input), init);
    return nativeFetch(target, init);
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("External fetch blocked by the isolated WhatsApp test");
  }
  return nativeFetch(input, init);
};
