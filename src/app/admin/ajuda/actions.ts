"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { articleSchema, responseSchema, type HelpFormState } from "@/lib/help";

async function adminClient() {
  const { db } = await requireUser();
  const { data: admin, error } = await db.rpc("is_super_admin");
  if (error || !admin) notFound();
  return db;
}
export async function saveArticle(
  articleId: string | null,
  _previous: HelpFormState,
  form: FormData,
): Promise<HelpFormState> {
  const db = await adminClient();
  if (articleId && !z.uuid().safeParse(articleId).success) notFound();
  const values = Object.fromEntries(
    ["title", "module", "kind", "body", "sort_order"].map((key) => [
      key,
      String(form.get(key) ?? ""),
    ]),
  );
  const published = form.get("published") === "on";
  const input = articleSchema.safeParse({ ...values, published });
  if (!input.success)
    return {
      error:
        "Confira título, assunto e conteúdo. O texto precisa de 20 a 12.000 caracteres.",
      fields: Object.fromEntries(
        input.error.issues.map((issue) => [
          String(issue.path[0]),
          issue.message,
        ]),
      ),
      values: { ...values, published: String(published) },
    };
  const record = { ...input.data, updated_at: new Date().toISOString() };
  const result = articleId
    ? await db
        .from("help_articles")
        .update(record)
        .eq("id", articleId)
        .select("id")
        .single()
    : await db.from("help_articles").insert(record).select("id").single();
  if (result.error || !result.data)
    return {
      error:
        "Não foi possível salvar o conteúdo. Seu texto foi mantido; tente novamente.",
      values: { ...values, published: String(published) },
    };
  revalidatePath("/admin/ajuda");
  revalidatePath("/painel/[companyId]/ajuda", "page");
  redirect(`/admin/ajuda?aviso=artigo&editar=${result.data.id}#editor`);
}
export async function respondTicket(
  ticketId: string,
  _previous: HelpFormState,
  form: FormData,
): Promise<HelpFormState> {
  const db = await adminClient();
  if (!z.uuid().safeParse(ticketId).success) notFound();
  const values = {
    status: String(form.get("status") ?? ""),
    response: String(form.get("response") ?? ""),
  };
  const input = responseSchema.safeParse(values);
  if (!input.success)
    return {
      error:
        "Escolha um status válido e inclua uma resposta antes de resolver a solicitação (até 4.000 caracteres).",
      values,
    };
  const { error } = await db.rpc("respond_support_ticket", {
    p_ticket: ticketId,
    p_status: input.data.status,
    p_response: input.data.response,
  });
  if (error)
    return {
      error:
        "Não conseguimos salvar a resposta. Seu texto foi mantido; tente novamente.",
      values,
    };
  revalidatePath("/admin/ajuda");
  revalidatePath("/painel/[companyId]/ajuda", "page");
  redirect(`/admin/ajuda?aviso=resposta&solicitacao=${ticketId}#atendimento`);
}
