type SalesTestOriginOptions = {
  remoteEnabled?: boolean;
  allowedOrigin?: string;
};

function parseOrigin(value: string): URL {
  const url = new URL(value);
  if (
    value !== value.trim() ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw new Error("Provide an origin without credentials, path, query or hash.");
  return url;
}

/** A remote test can carry an admin session: hostname suffixes are not consent. */
export function resolveSalesTestOrigin(
  value = "http://localhost:3000",
  options: SalesTestOriginOptions = {},
): URL {
  const target = parseOrigin(value);
  if (["localhost", "127.0.0.1"].includes(target.hostname)) return target;
  if (!options.remoteEnabled || !options.allowedOrigin)
    throw new Error("Remote sales tests require separate opt-in and exact origin.");
  const allowed = parseOrigin(options.allowedOrigin);
  if (
    target.protocol !== "https:" ||
    allowed.protocol !== "https:" ||
    target.origin !== allowed.origin
  )
    throw new Error("Remote sales test origin is not authorized.");
  return target;
}
