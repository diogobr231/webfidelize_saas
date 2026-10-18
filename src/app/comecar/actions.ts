"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompany, requireUser } from "@/lib/auth";
import { niches } from "@/lib/catalog";
import {
  setupDestination,
  setupServiceSchema,
  setupProfessionalSchema,
  type SetupActionState,
  type SetupStep,
} from "@/lib/onboarding";

function failure(error: string, form: FormData): SetupActionState {
  const values: Record<string, string> = {};
  for (const [key, limit] of [
    ["name", 120],
    ["niche", 64],
    ["duration", 10],
    ["price", 32],
  ] as const) {
    const value = form.get(key);
    if (typeof value === "string") values[key] = value.slice(0, limit);
  }
  return { error, values };
}

function validationError(error: z.ZodError, form: FormData): SetupActionState {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0]);
    if (!fields[key]) fields[key] = issue.message;
  }
  return {
    ...failure(
      "Confira os campos indicados. Seus dados ainda não foram salvos.",
      form,
    ),
    fields,
  };
}

function finish(companyId: string, step: SetupStep, form: FormData): never {
  revalidatePath(`/painel/${companyId}`, "layout");
  redirect(setupDestination(companyId, step, form.get("intent") === "pause"));
}

export async function startCompany(
  _previous: SetupActionState,
  form: FormData,
): Promise<SetupActionState> {
  const { db, user } = await requireUser();
  const [admin, ownership] = await Promise.all([
    db.rpc("is_super_admin"),
    db
      .from("memberships")
      .select("company_id")
      .eq("user_id", user.id)
      .eq("role", "OWNER")
      .maybeSingle(),
  ]);
  if (admin.error || ownership.error)
    return failure(
      "Não foi possível consultar sua conta. Tente novamente.",
      form,
    );
  if (admin.data) redirect("/admin");
  if (ownership.data)
    redirect(`/painel/${ownership.data.company_id}/configuracao`);
  const parsed = z
    .object({
      name: z
        .string("Informe o nome da empresa.")
        .trim()
        .min(2, "Informe pelo menos 2 caracteres.")
        .max(100, "Use até 100 caracteres."),
      niche: z
        .string()
        .refine(
          (value) => niches.some((niche) => niche.slug === value),
          "Escolha o segmento do seu negócio.",
        ),
    })
    .safeParse({ name: form.get("name"), niche: form.get("niche") ?? "" });
  if (!parsed.success) return validationError(parsed.error, form);
  const { data, error } = await db.rpc("create_company", {
    company_name: parsed.data.name,
    company_niche: parsed.data.niche,
  });
  if (error) {
    // A retried request must resume the company committed by the original
    // transaction, never create another tenant or restart its trial.
    const current = await db
      .from("memberships")
      .select("company_id")
      .eq("user_id", user.id)
      .eq("role", "OWNER")
      .maybeSingle();
    if (!current.error && current.data)
      finish(current.data.company_id, "servicos", form);
    return failure(
      "Não foi possível criar a empresa. Confirme seu e-mail e tente novamente. Os campos continuam preenchidos.",
      form,
    );
  }
  revalidatePath("/painel");
  finish(data, "servicos", form);
}

async function saveSetupRecord(
  db: Awaited<ReturnType<typeof requireCompany>>["db"],
  companyId: string,
  table: "services" | "professionals",
  record: {
    id: string;
    name: string;
    duration_minutes?: number;
    price_cents?: number;
  },
  next: SetupStep,
  form: FormData,
): Promise<SetupActionState> {
  const columns =
    table === "services" ? "id,name,duration_minutes,price_cents" : "id,name";
  const read = () =>
    db
      .from(table)
      .select(columns)
      .eq("company_id", companyId)
      .eq("id", record.id)
      .maybeSingle();
  const matches = (value: unknown) => {
    if (!value || typeof value !== "object") return false;
    const saved = value as Record<string, unknown>;
    return Object.entries(record).every(([key, entry]) => saved[key] === entry);
  };
  const existing = await read();
  if (existing.error)
    return failure(
      "Não foi possível verificar este cadastro. Tente novamente.",
      form,
    );
  if (existing.data) {
    if (matches(existing.data)) finish(companyId, next, form);
    return failure(
      "Este envio já foi utilizado. Atualize a página antes de iniciar outro cadastro.",
      form,
    );
  }
  const inserted = await db
    .from(table)
    .insert({ ...record, company_id: companyId });
  if (inserted.error) {
    const committed = await read();
    if (!committed.error && matches(committed.data))
      finish(companyId, next, form);
    return failure(
      table === "professionals"
        ? "Não foi possível cadastrar. Confira o limite de profissionais do plano e tente novamente."
        : "Não foi possível salvar o serviço. Tente novamente; os campos continuam preenchidos.",
      form,
    );
  }
  finish(companyId, next, form);
}

export async function addSetupService(
  companyId: string,
  _previous: SetupActionState,
  form: FormData,
): Promise<SetupActionState> {
  if (!z.uuid().safeParse(companyId).success) redirect("/painel");
  const { db } = await requireCompany(companyId, true, true);
  const parsed = setupServiceSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return validationError(parsed.error, form);
  const { record_id, name, duration, price } = parsed.data;
  return saveSetupRecord(
    db,
    companyId,
    "services",
    { id: record_id, name, duration_minutes: duration, price_cents: price },
    "equipe",
    form,
  );
}

export async function addSetupProfessional(
  companyId: string,
  _previous: SetupActionState,
  form: FormData,
): Promise<SetupActionState> {
  if (!z.uuid().safeParse(companyId).success) redirect("/painel");
  const { db } = await requireCompany(companyId, true, true);
  const parsed = setupProfessionalSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return validationError(parsed.error, form);
  return saveSetupRecord(
    db,
    companyId,
    "professionals",
    { id: parsed.data.record_id, name: parsed.data.name },
    "resumo",
    form,
  );
}
