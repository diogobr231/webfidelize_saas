"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient, configured } from "@/lib/supabase/server";
import {
  authCallbackUrl,
  authCredentials,
  authDestination,
  authEmail,
  authErrorMessage,
  authFailureCode,
  authPageUrl,
  isNeutralEmailError,
  newPassword,
  parseEmailConfirmation,
} from "@/lib/auth-flow";
import {
  authCallbackOrigin,
  canonicalAuthAction,
  getAuthOrigin,
} from "@/lib/auth-origin";
import {
  clearRecoveryProof,
  isRecoverySession,
  issueRecoveryProof,
  recoveryProofConfigured,
  requireRecoverySession,
} from "@/lib/auth-recovery";

async function emailOrigin(page: "/cadastro" | "/recuperar", next: string) {
  if (!configured())
    redirect(authPageUrl(page, { next, erro: "configuracao" }));
  try {
    getAuthOrigin();
  } catch {
    redirect(authPageUrl(page, { next, erro: "configuracao" }));
  }
  return canonicalAuthAction(page, next);
}

export async function login(form: FormData) {
  const next = authDestination(form.get("next"));
  if (!configured())
    redirect(authPageUrl("/entrar", { next, erro: "configuracao" }));
  const input = authCredentials.safeParse(Object.fromEntries(form));
  if (!input.success)
    redirect(authPageUrl("/entrar", { next, erro: "credenciais" }));
  const db = await createClient();
  const { error } = await db.auth.signInWithPassword(input.data);
  if (error)
    redirect(
      authPageUrl("/entrar", { next, erro: authFailureCode(error, "login") }),
    );
  await clearRecoveryProof();
  if (next !== "/painel") redirect(next);
  const { data: admin } = await db.rpc("is_super_admin");
  if (admin) redirect("/admin");
  redirect("/painel");
}
export async function signup(form: FormData) {
  const next = authDestination(form.get("next"));
  const origin = await emailOrigin("/cadastro", next);
  const input = authCredentials.safeParse(Object.fromEntries(form));
  if (!input.success)
    redirect(authPageUrl("/cadastro", { next, erro: "validacao" }));
  const db = await createClient();
  const { data, error } = await db.auth.signUp({
    ...input.data,
    options: { emailRedirectTo: authCallbackUrl(origin, next) },
  });
  if (error && !isNeutralEmailError(error))
    redirect(
      authPageUrl("/cadastro", { next, erro: authFailureCode(error, "email") }),
    );
  if (!error && data.session) redirect(next);
  redirect(authPageUrl("/entrar", { next, aviso: "confirme-email" }));
}
export async function recover(form: FormData) {
  const origin = await emailOrigin("/recuperar", "/painel");
  if (!recoveryProofConfigured()) redirect("/recuperar?erro=configuracao");
  const email = authEmail.safeParse(form.get("email"));
  if (!email.success) redirect("/recuperar?erro=email");
  const db = await createClient();
  const { error } = await db.auth.resetPasswordForEmail(email.data, {
    redirectTo: authCallbackUrl(origin, "/painel", true),
  });
  if (error && !isNeutralEmailError(error))
    redirect(
      authPageUrl("/recuperar", { erro: authFailureCode(error, "email") }),
    );
  redirect("/recuperar?aviso=enviado");
}

export type ResendState = { error?: string; sentAt?: number };
export async function resendConfirmation(
  _previous: ResendState,
  form: FormData,
): Promise<ResendState> {
  const next = authDestination(form.get("next"));
  const email = authEmail.safeParse(form.get("email"));
  if (!email.success) return { error: authErrorMessage("email") };
  let origin: string;
  try {
    origin = getAuthOrigin();
  } catch {
    return { error: authErrorMessage("configuracao") };
  }
  if (!configured()) return { error: authErrorMessage("configuracao") };
  await canonicalAuthAction("/entrar", next);
  const db = await createClient();
  const { error } = await db.auth.resend({
    type: "signup",
    email: email.data,
    options: { emailRedirectTo: authCallbackUrl(origin, next) },
  });
  // The Auth service enforces the cooldown; client timers are only visual feedback.
  if (error && !isNeutralEmailError(error))
    return { error: authErrorMessage(authFailureCode(error, "email")) };
  return { sentAt: Date.now() };
}

export async function confirmEmail(form: FormData) {
  const confirmation = parseEmailConfirmation(Object.fromEntries(form));
  if (!confirmation) redirect("/entrar?erro=link");
  const { token_hash, type, next } = confirmation;
  if (!configured())
    redirect(
      authPageUrl(type === "recovery" ? "/recuperar" : "/entrar", {
        next,
        erro: "configuracao",
      }),
    );
  try {
    authCallbackOrigin(await headers());
  } catch {
    redirect("/entrar?erro=configuracao");
  }
  if (type === "recovery") {
    if (!recoveryProofConfigured()) redirect("/recuperar?erro=configuracao");
    // Recovery confirmations may legitimately arrive on an allowed legacy host.
    getAuthOrigin();
  }
  const db = await createClient();
  const { data, error } = await db.auth.verifyOtp({ token_hash, type });
  if (error || !data.session || !data.user)
    redirect(
      authPageUrl(type === "recovery" ? "/recuperar" : "/entrar", {
        next,
        erro: authFailureCode(error, "confirmation"),
      }),
    );
  if (type === "recovery") {
    if (!(await issueRecoveryProof(db)))
      redirect("/recuperar?erro=recuperacao");
    redirect("/nova-senha");
  }
  const recovery = await isRecoverySession(db);
  if (recovery) redirect("/nova-senha");
  redirect(next);
}

export async function updatePassword(form: FormData) {
  const { db } = await requireRecoverySession();
  const input = newPassword.safeParse(Object.fromEntries(form));
  if (!input.success) redirect("/nova-senha?erro=confirmacao-senha");
  const { error } = await db.auth.updateUser({ password: input.data.password });
  if (error)
    redirect(
      authPageUrl("/nova-senha", { erro: authFailureCode(error, "password") }),
    );
  await clearRecoveryProof();
  await db.auth.signOut({ scope: "local" });
  redirect("/entrar?aviso=senha-atualizada");
}
export async function logout() {
  await clearRecoveryProof();
  const db = await createClient();
  await db.auth.signOut();
  redirect("/entrar");
}
