import { z } from "zod";

const invitationDestination = /^\/convite\/[a-f0-9]{64}$/;

/** Only destinations owned by this authentication flow may survive sign-in. */
export function authDestination(input: unknown): string {
  return typeof input === "string" &&
    (input === "/painel" || invitationDestination.test(input))
    ? input
    : "/painel";
}

export function authPageUrl(
  page: "/entrar" | "/cadastro" | "/recuperar" | "/nova-senha",
  options: { next?: unknown; erro?: string; aviso?: string } = {},
): string {
  const params = new URLSearchParams();
  const next = authDestination(options.next);
  if (next !== "/painel" && page !== "/nova-senha") params.set("next", next);
  if (options.erro) params.set("erro", options.erro);
  if (options.aviso) params.set("aviso", options.aviso);
  return `${page}${params.size ? `?${params}` : ""}`;
}

export const authEmail = z.email().max(254);
export const authCredentials = z.object({
  email: authEmail,
  password: z.string().min(8).max(128),
});
export const newPassword = z
  .object({
    password: z.string().min(8).max(128),
    password_confirmation: z.string(),
  })
  .refine((input) => input.password === input.password_confirmation, {
    path: ["password_confirmation"],
  });

export function parseEmailConfirmation(input: {
  token_hash?: unknown;
  type?: unknown;
  next?: unknown;
}) {
  if (
    typeof input.token_hash !== "string" ||
    !/^(?:pkce_)?(?:[a-f0-9]{56}|[a-f0-9]{64})$/.test(input.token_hash) ||
    (input.type !== "email" && input.type !== "recovery")
  )
    return null;
  return {
    token_hash: input.token_hash,
    type: input.type,
    next:
      input.type === "recovery" ? "/nova-senha" : authDestination(input.next),
  } as const;
}

/** Templates pass RedirectTo as data, never as the URL the browser follows. */
export function authDestinationFromEmailRedirect(
  value: unknown,
  origin: string,
): string {
  if (typeof value !== "string" || value.length > 2048) return "/painel";
  try {
    const url = new URL(value);
    if (
      url.origin !== origin ||
      url.pathname !== "/auth/callback" ||
      url.username ||
      url.password ||
      url.hash
    )
      return "/painel";
    return authDestination(url.searchParams.get("next"));
  } catch {
    return "/painel";
  }
}

/** APP_URL is deployment configuration, never inferred from Host headers. */
export function resolveAuthOrigin(value: unknown, production = false): string {
  if (typeof value !== "string" || !value) throw new Error("Invalid APP_URL");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid APP_URL");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (
    value !== value.trim() ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && local && !production)) ||
    (production && local)
  )
    throw new Error("Invalid APP_URL");
  return url.origin;
}

export function authCallbackUrl(
  origin: string,
  next: unknown,
  recovery = false,
) {
  const url = new URL("/auth/callback", origin);
  url.searchParams.set(
    "next",
    recovery ? "/nova-senha" : authDestination(next),
  );
  return url.toString();
}

export const RECOVERY_WINDOW_SECONDS = 15 * 60;

export function verifiedSessionIdentity(
  claims: unknown,
  userId: string,
  now = Date.now(),
) {
  if (!claims || typeof claims !== "object") return null;
  const value = claims as Record<string, unknown>;
  if (
    value.sub !== userId ||
    typeof value.session_id !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value.session_id,
    ) ||
    typeof value.exp !== "number" ||
    value.exp <= Math.floor(now / 1000)
  )
    return null;
  return { userId, sessionId: value.session_id };
}

/** Call only with claims verified by Auth; decoded cookies are not proof. */
export function hasRecentRecoveryClaims(
  claims: unknown,
  userId: string,
  now = Date.now(),
): boolean {
  if (!verifiedSessionIdentity(claims, userId, now)) return false;
  const value = claims as Record<string, unknown>;
  const seconds = Math.floor(now / 1000);
  return (
    Array.isArray(value.amr) &&
    value.amr.some((entry: unknown) => {
      if (!entry || typeof entry !== "object") return false;
      const method = entry as Record<string, unknown>;
      return (
        method.method === "recovery" &&
        typeof method.timestamp === "number" &&
        Number.isInteger(method.timestamp) &&
        method.timestamp <= seconds + 60 &&
        seconds - method.timestamp < RECOVERY_WINDOW_SECONDS
      );
    })
  );
}

type AuthFailure = { code?: string; status?: number } | null;
export function authFailureCode(
  error: AuthFailure,
  operation: "login" | "email" | "password" | "confirmation",
): string {
  if (
    error?.status === 429 ||
    ["over_email_send_rate_limit", "over_request_rate_limit"].includes(
      error?.code ?? "",
    )
  )
    return "limite";
  if (error?.code === "weak_password") return "senha-fraca";
  if (error?.code === "email_address_invalid") return "email";
  if (operation === "login") return "credenciais";
  if (operation === "confirmation") return "link";
  if (operation === "password")
    return error?.code === "same_password" ? "senha-igual" : "senha";
  return "envio";
}

// Auth intentionally hides whether an address exists. Keep those responses neutral.
export function isNeutralEmailError(error: AuthFailure): boolean {
  return ["user_already_exists", "email_exists", "user_not_found"].includes(
    error?.code ?? "",
  );
}

export function authErrorMessage(code: unknown): string {
  switch (code) {
    case "configuracao":
      return "O acesso por e-mail ainda precisa ser configurado. Tente novamente mais tarde.";
    case "validacao":
      return "Confira o e-mail e use uma senha de 8 a 128 caracteres.";
    case "email":
      return "Informe um endereço de e-mail válido.";
    case "credenciais":
      return "Não foi possível entrar. Confira seu e-mail e senha. Se ainda não confirmou o cadastro, solicite um novo link abaixo.";
    case "limite":
      return "Muitas tentativas em pouco tempo. Aguarde alguns minutos antes de tentar novamente.";
    case "envio":
      return "Não foi possível enviar o e-mail agora. Tente novamente mais tarde. Se persistir, fale com o suporte.";
    case "link":
      return "Este link é inválido, expirou ou já foi usado. Solicite outro link para continuar.";
    case "recuperacao":
      return "Abra o link de recuperação enviado ao seu e-mail para definir uma nova senha.";
    case "confirmacao-senha":
      return "Use uma senha de 8 a 128 caracteres e repita a mesma senha nos dois campos.";
    case "senha-igual":
      return "Escolha uma senha diferente da atual.";
    case "senha-fraca":
      return "Escolha uma senha mais forte, com letras, números e símbolos, que você não use em outros sites.";
    case "senha":
      return "Não foi possível salvar a senha. Confira os campos ou solicite um novo link de recuperação.";
    default:
      return "Não foi possível concluir. Confira os campos e tente novamente.";
  }
}
