"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompany } from "@/lib/auth";
import { ticketSchema, type HelpFormState } from "@/lib/help";

export async function openTicket(
  companyId: string,
  _previous: HelpFormState,
  form: FormData,
): Promise<HelpFormState> {
  if (!z.uuid().safeParse(companyId).success) redirect("/painel");
  // Support remains available to authorized members after their trial expires.
  const { db } = await requireCompany(companyId);
  const values = Object.fromEntries(
    ["request_key", "module", "subject", "message"].map((key) => [
      key,
      String(form.get(key) ?? ""),
    ]),
  );
  const input = ticketSchema.safeParse(values);
  if (!input.success)
    return {
      error: "Confira os campos indicados antes de enviar.",
      fields: Object.fromEntries(
        input.error.issues.map((issue) => [
          String(issue.path[0]),
          issue.message,
        ]),
      ),
      values,
    };
  const { data, error } = await db.rpc("open_support_ticket", {
    p_company: companyId,
    p_key: input.data.request_key,
    p_module: input.data.module,
    p_subject: input.data.subject,
    p_message: input.data.message,
  });
  if (error || !data)
    return {
      error: error?.message.includes("support rate limit")
        ? "Você já enviou 5 solicitações na última hora. Aguarde para enviar outra ou fale pelo WhatsApp."
        : error?.message.includes("request key conflict")
          ? "Esta solicitação já foi enviada. Atualize a página para abrir outra."
          : "Não conseguimos registrar sua solicitação. Seus campos foram mantidos; tente novamente ou fale pelo WhatsApp.",
      values,
    };
  revalidatePath(`/painel/${companyId}/ajuda`);
  revalidatePath("/admin/ajuda");
  redirect(`/painel/${companyId}/ajuda?aviso=enviada#solicitacoes`);
}
