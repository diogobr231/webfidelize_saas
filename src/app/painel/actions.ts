"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser, requireCompany } from "@/lib/auth";
import { niches } from "@/lib/catalog";
import { setupServiceSchema } from "@/lib/onboarding";
import {
  localAppointmentInstant,
  saoPauloDay,
  validDay,
} from "@/lib/scheduling";
export async function createCompany(form: FormData) {
  const { db } = await requireUser();
  const name = z.string().trim().min(2).max(100).safeParse(form.get("name"));
  const niche = niches.find((n) => n.slug === form.get("niche"));
  if (!name.success || !niche) redirect("/painel?erro=validacao");
  const { data, error } = await db.rpc("create_company", {
    company_name: name.data,
    company_niche: niche.slug,
  });
  if (error) redirect("/painel?erro=criacao");
  redirect(`/painel/${data}/configuracao?etapa=servicos`);
}
const id = z.uuid();
export async function saveRecord(form: FormData) {
  const company = id.safeParse(form.get("company_id"));
  if (!company.success) redirect("/painel");
  const kind = z
    .enum(["customers", "services", "professionals"])
    .safeParse(form.get("kind"));
  if (!kind.success) redirect("/painel");
  const { db } = await requireCompany(company.data, true, true);
  const name = z.string().trim().min(2).max(120).safeParse(form.get("name"));
  if (!name.success)
    redirect(`/painel/${company.data}/${kind.data}?erro=validacao`);
  let record: Record<string, unknown> = {
    company_id: company.data,
    name: name.data,
  };
  if (kind.data === "customers") {
    const phone = z
      .string()
      .max(30)
      .safeParse(form.get("phone") || "");
    if (!phone.success)
      redirect(`/painel/${company.data}/customers?erro=validacao`);
    record = { ...record, phone: phone.data };
  }
  if (kind.data === "services") {
    const duration = z.coerce
      .number()
      .int()
      .min(5)
      .max(480)
      .safeParse(form.get("duration"));
    const price = setupServiceSchema.shape.price.safeParse(form.get("price"));
    if (!duration.success || !price.success)
      redirect(`/painel/${company.data}/services?erro=validacao`);
    record = {
      ...record,
      duration_minutes: duration.data,
      price_cents: price.data,
    };
  }
  const { error } = await db.from(kind.data).insert(record);
  if (error) redirect(`/painel/${company.data}/${kind.data}?erro=salvar`);
  revalidatePath(`/painel/${company.data}`, "layout");
  redirect(`/painel/${company.data}/${kind.data}?salvo=1`);
}
export async function createAppointment(form: FormData) {
  const company = id.safeParse(form.get("company_id"));
  if (!company.success) redirect("/painel");
  const { db } = await requireCompany(company.data, true, true);
  const data = z
    .object({
      customer_id: id,
      service_id: id,
      professional_id: id,
      starts_at: z.iso.datetime({ offset: true }),
    })
    .safeParse({
      customer_id: form.get("customer_id"),
      service_id: form.get("service_id"),
      professional_id: form.get("professional_id"),
      starts_at: form.has("day")
        ? localAppointmentInstant(
            String(form.get("day")),
            String(form.get("time")),
          )
        : form.get("starts_at"),
    });
  if (!data.success) redirect(`/painel/${company.data}/agenda?erro=validacao`);
  if (!validDay(saoPauloDay(new Date(data.data.starts_at))))
    redirect(`/painel/${company.data}/agenda?erro=validacao`);
  const { error } = await db.rpc("book_appointment", {
    p_company: company.data,
    p_customer: data.data.customer_id,
    p_service: data.data.service_id,
    p_professional: data.data.professional_id,
    p_start: data.data.starts_at,
  });
  if (error) redirect(`/painel/${company.data}/agenda?erro=horario`);
  revalidatePath(`/painel/${company.data}`, "layout");
  redirect(
    `/painel/${company.data}/agenda?day=${saoPauloDay(new Date(data.data.starts_at))}&notice=criado`,
  );
}
