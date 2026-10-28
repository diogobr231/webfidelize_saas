"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requireCompany } from "@/lib/auth";
import {
  classError,
  classSessionFormSchema,
  classVersionSchema,
  type ClassFormState,
} from "@/lib/classes";
import { localAppointmentInstant } from "@/lib/scheduling";

async function authorized(companyId: string, management = true) {
  if (!z.uuid().safeParse(companyId).success) notFound();
  return requireCompany(companyId, true, management);
}
function refresh(companyId: string, slug: string | null) {
  revalidatePath(`/painel/${companyId}`, "layout");
  if (slug) revalidatePath(`/agendar/${slug}`, "page");
  if (slug) revalidatePath(`/agendar/${slug}/turmas`, "page");
}

export async function saveClass(
  companyId: string,
  sessionId: string | null,
  _previous: ClassFormState,
  form: FormData,
): Promise<ClassFormState> {
  const { db, company } = await authorized(companyId);
  if (sessionId !== null && !z.uuid().safeParse(sessionId).success) notFound();
  const input = classSessionFormSchema.safeParse({
    service: form.get("service"),
    professional: form.get("professional"),
    title: form.get("title"),
    day: form.get("day"),
    time: form.get("time"),
    capacity: form.get("capacity"),
    is_public: form.get("is_public") === "on",
  });
  const version =
    sessionId === null
      ? null
      : classVersionSchema.safeParse(form.get("version"));
  if (!input.success || (version !== null && !version.success))
    return {
      error:
        "Confira o serviço, profissional, data, horário e limite de 1 a 100 vagas.",
      fields: !input.success
        ? Object.fromEntries(
            input.error.issues.map((issue) => [
              String(issue.path[0]),
              issue.message,
            ]),
          )
        : undefined,
    };
  const { data, error } = await db.rpc("save_class_session", {
    p_company: companyId,
    p_session: sessionId,
    p_version: version?.success ? version.data : null,
    p_service: input.data.service,
    p_professional: input.data.professional,
    p_title: input.data.title,
    p_start: localAppointmentInstant(input.data.day, input.data.time),
    p_capacity: input.data.capacity,
    p_public: input.data.is_public,
  });
  if (error) return { error: classError(error.message) };
  if (!z.uuid().safeParse(data).success)
    return {
      error:
        "A confirmação não foi recebida. Atualize a lista antes de tentar novamente.",
    };
  refresh(companyId, company.booking_slug);
  redirect(`/painel/${companyId}/turmas/${data}?salvo=turma`);
}

export async function manageClass(
  companyId: string,
  sessionId: string,
  _previous: ClassFormState,
  form: FormData,
): Promise<ClassFormState> {
  const { db, company } = await authorized(companyId);
  const input = z
    .object({
      session: z.uuid(),
      version: classVersionSchema,
      action: z.enum(["cancel", "complete"]),
      confirmation: z.literal("yes"),
    })
    .safeParse({
      session: sessionId,
      version: form.get("version"),
      action: form.get("operation"),
      confirmation: form.get("confirm_action"),
    });
  if (!input.success)
    return {
      error:
        "Confirme a alteração e atualize a página se ela estiver desatualizada.",
    };
  const { error } = await db.rpc("manage_class_session", {
    p_company: companyId,
    p_session: input.data.session,
    p_version: input.data.version,
    p_action: input.data.action,
  });
  if (error) return { error: classError(error.message) };
  refresh(companyId, company.booking_slug);
  redirect(
    `/painel/${companyId}/turmas/${sessionId}?salvo=${input.data.action}`,
  );
}

export async function addClassParticipant(
  companyId: string,
  sessionId: string,
  _previous: ClassFormState,
  form: FormData,
): Promise<ClassFormState> {
  const { db, company } = await authorized(companyId);
  const input = z
    .object({ session: z.uuid(), customer: z.uuid(), request: z.uuid() })
    .safeParse({
      session: sessionId,
      customer: form.get("customer"),
      request: form.get("request_id"),
    });
  if (!input.success)
    return {
      error:
        "Selecione um cliente ativo. Atualize a página antes de tentar novamente.",
    };
  const { error } = await db.rpc("save_class_registration", {
    p_company: companyId,
    p_session: input.data.session,
    p_customer: input.data.customer,
    p_request: input.data.request,
  });
  if (error) return { error: classError(error.message) };
  refresh(companyId, company.booking_slug);
  redirect(`/painel/${companyId}/turmas/${sessionId}?salvo=inscrito`);
}

export async function manageClassParticipant(
  companyId: string,
  sessionId: string,
  registrationId: string,
  _previous: ClassFormState,
  form: FormData,
): Promise<ClassFormState> {
  const input = z
    .object({
      session: z.uuid(),
      registration: z.uuid(),
      version: classVersionSchema,
      action: z.enum(["cancel", "attend"]),
    })
    .safeParse({
      session: sessionId,
      registration: registrationId,
      version: form.get("version"),
      action: form.get("operation"),
    });
  if (!input.success)
    return { error: "Atualize a inscrição antes de tentar novamente." };
  const { db, company, role } = await authorized(
    companyId,
    input.data.action === "cancel",
  );
  if (!["OWNER", "MANAGER", "EMPLOYEE"].includes(role))
    return { error: "Você não tem permissão para esta alteração." };
  if (input.data.action === "cancel" && form.get("confirm_action") !== "yes")
    return { error: "Confirme o cancelamento da inscrição." };
  // The database checks both the membership and the professional linked now;
  // the route/hidden IDs cannot grant access to another company's enrollment.
  const { error } = await db.rpc("manage_class_registration", {
    p_company: companyId,
    p_registration: input.data.registration,
    p_version: input.data.version,
    p_action: input.data.action,
  });
  if (error) return { error: classError(error.message) };
  refresh(companyId, company.booking_slug);
  redirect(
    `/painel/${companyId}/turmas/${sessionId}?salvo=${input.data.action === "attend" ? "presenca" : "inscricao-cancelada"}`,
  );
}
