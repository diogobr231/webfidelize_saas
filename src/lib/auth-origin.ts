import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authPageUrl } from "./auth-flow";
import { resolveAuthOrigin } from "./auth-flow";
import { authDomainPolicy, trustedAuthOrigin } from "./auth-domains";

export function getAuthOrigin(): string {
  return resolveAuthOrigin(
    process.env.APP_URL,
    process.env.VERCEL_ENV === "production",
  );
}

export function getAuthDomainPolicy() {
  return authDomainPolicy(
    process.env.APP_URL,
    process.env.AUTH_LEGACY_ORIGINS,
    process.env.VERCEL_ENV === "production",
  );
}

export function authCallbackOrigin(requestHeaders: Pick<Headers, "get">) {
  const policy = getAuthDomainPolicy();
  if (!policy.migrating) return policy.canonical;
  const origin = trustedAuthOrigin(requestHeaders.get("host"), policy);
  if (!origin) throw new Error("Untrusted authentication origin");
  return origin;
}

/** Also guards stale forms/actions invoked outside the entry-page proxy. */
export async function canonicalAuthAction(
  page: "/cadastro" | "/recuperar" | "/entrar",
  next: unknown,
) {
  const policy = getAuthDomainPolicy();
  if (
    policy.migrating &&
    trustedAuthOrigin((await headers()).get("host"), policy) !==
      policy.canonical
  )
    redirect(new URL(authPageUrl(page, { next }), policy.canonical).href);
  return policy.canonical;
}
