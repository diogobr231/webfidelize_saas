"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, configured } from "@/lib/supabase/server";
const credentials = z.object({
  email: z.email().max(254),
  password: z.string().min(8).max(128),
});
export async function login(form: FormData) {
  if (!configured()) redirect("/entrar?erro=configuracao");
  const input = credentials.safeParse(Object.fromEntries(form));
  if (!input.success) redirect("/entrar?erro=credenciais");
  const db = await createClient();
  const { error } = await db.auth.signInWithPassword(input.data);
  if (error) redirect("/entrar?erro=credenciais");
  const { data: admin } = await db.rpc("is_super_admin");
  if (admin) redirect("/admin");
  redirect("/painel");
}
export async function signup(form: FormData) {
  if (!configured()) redirect("/cadastro?erro=configuracao");
  const input = credentials.safeParse(Object.fromEntries(form));
  if (!input.success) redirect("/cadastro?erro=validacao");
  const db = await createClient();
  const { error } = await db.auth.signUp({
    ...input.data,
    options: { emailRedirectTo: `${process.env.APP_URL}/auth/callback` },
  });
  if (error) redirect("/cadastro?erro=cadastro");
  redirect("/entrar?aviso=confirme-email");
}
export async function recover(form: FormData) {
  if (!configured()) redirect("/recuperar?erro=configuracao");
  const email = z.email().safeParse(form.get("email"));
  if (email.success) {
    const db = await createClient();
    await db.auth.resetPasswordForEmail(email.data, {
      redirectTo: `${process.env.APP_URL}/auth/callback?next=/nova-senha`,
    });
  }
  redirect("/recuperar?aviso=enviado");
}
export async function updatePassword(form: FormData) {
  const password = z.string().min(8).max(128).safeParse(form.get("password"));
  if (!password.success) redirect("/nova-senha?erro=validacao");
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/recuperar");
  const { error } = await db.auth.updateUser({ password: password.data });
  if (error) redirect("/nova-senha?erro=senha");
  redirect("/painel");
}
export async function logout() {
  const db = await createClient();
  await db.auth.signOut();
  redirect("/entrar");
}
