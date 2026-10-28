import { authDestination, resolveAuthOrigin } from "./auth-flow";

export type AuthDomainPolicy = {
  canonical: string;
  origins: readonly string[];
  migrating: boolean;
};

/** Explicit server configuration only. Never infer trust from a request header. */
export function authDomainPolicy(
  appUrl: unknown,
  legacyOrigins?: string,
  production = false,
): AuthDomainPolicy {
  const canonical = resolveAuthOrigin(appUrl, production);
  const legacy = legacyOrigins?.trim() ? legacyOrigins.split(",") : [];
  if (legacy.length > 5 || (legacyOrigins?.length ?? 0) > 2048)
    throw new Error("Invalid AUTH_LEGACY_ORIGINS");
  const origins = new Set([canonical]);
  for (const value of legacy) {
    const entry = value.trim();
    const origin = resolveAuthOrigin(entry, production);
    if (entry !== origin || /[*\\\s]/.test(entry))
      throw new Error("Invalid AUTH_LEGACY_ORIGINS");
    origins.add(origin);
  }
  // The same hostname/port with two protocols cannot be distinguished by Host.
  if (
    new Set([...origins].map((value) => new URL(value).host)).size !==
    origins.size
  )
    throw new Error("Ambiguous AUTH_LEGACY_ORIGINS");
  return { canonical, origins: [...origins], migrating: origins.size > 1 };
}

/** Selects only a preconfigured origin, never concatenates Host into a URL. */
export function trustedAuthOrigin(
  host: string | null,
  policy: AuthDomainPolicy,
) {
  if (!host || host !== host.trim() || /[\\\s,@/#?]/.test(host)) return null;
  return policy.origins.find((origin) => new URL(origin).host === host) ?? null;
}

export function authEntryRedirect(
  host: string | null,
  pathname: string,
  params: URLSearchParams,
  policy: AuthDomainPolicy,
): string | null {
  if (
    !policy.migrating ||
    !/^(?:\/cadastro|\/recuperar|\/entrar(?:\/[a-z0-9-]+)?)$/.test(pathname) ||
    trustedAuthOrigin(host, policy) === policy.canonical
  )
    return null;
  const target = new URL(pathname, policy.canonical);
  const next = authDestination(params.get("next"));
  if (pathname !== "/recuperar" && next !== "/painel")
    target.searchParams.set("next", next);
  for (const key of ["erro", "aviso"])
    if (/^[a-z-]{1,40}$/.test(params.get(key) ?? ""))
      target.searchParams.set(key, params.get(key)!);
  return target.href;
}
