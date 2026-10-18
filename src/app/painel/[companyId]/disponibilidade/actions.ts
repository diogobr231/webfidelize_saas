"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompany } from "@/lib/auth";
export async function addShift(form: FormData) {
  const input = z
    .object({
      company_id: z.uuid(),
      professional_id: z.uuid(),
      weekday: z.coerce.number().int().min(1).max(7),
      start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
      end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) redirect("/painel");
  const { db } = await requireCompany(input.data.company_id, true, true);
  const minutes = (s: string) =>
    Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  if (minutes(input.data.end) <= minutes(input.data.start))
    redirect(`/painel/${input.data.company_id}/disponibilidade?erro=turno`);
  const { error } = await db.from("availability").insert({
    company_id: input.data.company_id,
    professional_id: input.data.professional_id,
    weekday: input.data.weekday,
    start_minute: minutes(input.data.start),
    end_minute: minutes(input.data.end),
  });
  if (error)
    redirect(`/painel/${input.data.company_id}/disponibilidade?erro=turno`);
  revalidatePath(`/painel/${input.data.company_id}`, "layout");
  redirect(
    `/painel/${input.data.company_id}/disponibilidade?salvo=turno#turnos`,
  );
}
export async function removeShift(form: FormData) {
  const input = z
    .object({ company_id: z.uuid(), id: z.uuid() })
    .safeParse(Object.fromEntries(form));
  if (!input.success) redirect("/painel?erro=validacao");
  const { company_id: c, id } = input.data;
  const { db } = await requireCompany(c, true, true);
  const { error } = await db
    .from("availability")
    .delete()
    .eq("company_id", c)
    .eq("id", id);
  revalidatePath(`/painel/${c}`, "layout");
  redirect(
    `/painel/${c}/disponibilidade${error ? "?erro=remover" : "?salvo=remover#turnos"}`,
  );
}
export async function configure(form: FormData) {
  const company = z.uuid().safeParse(form.get("company_id"));
  if (!company.success) redirect("/painel?erro=validacao");
  const c = company.data;
  const slug = z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{2,59}$/)
    .safeParse(form.get("slug"));
  if (!slug.success) redirect(`/painel/${c}/disponibilidade?erro=slug`);
  const { db, role } = await requireCompany(c, true);
  if (role !== "OWNER") redirect("/painel");
  const { error } = await db.rpc("configure_booking", {
    c,
    slug: slug.data,
    enabled: form.get("enabled") === "on",
  });
  revalidatePath(`/painel/${c}`, "layout");
  redirect(
    `/painel/${c}/disponibilidade${error ? "?erro=pagina" : "?salvo=pagina#pagina-publica"}`,
  );
}

export async function configureProfile(form: FormData) {
  const company = z.uuid().safeParse(form.get("company_id"));
  if (!company.success) redirect("/painel?erro=validacao");
  const c = company.data;
  const { db, role } = await requireCompany(c, true);
  if (role !== "OWNER") redirect(`/painel/${c}?erro=permissao`);
  const input = z
    .object({
      description: z.string().trim().max(240),
      address: z.string().trim().max(200),
      phone: z
        .string()
        .max(24)
        .transform((value) => value.replace(/[\s()+.-]/g, ""))
        .refine((value) => value === "" || /^\d{10,13}$/.test(value)),
      theme: z.enum(["teal", "blue", "violet", "rose"]),
    })
    .safeParse({
      description: form.get("description") ?? "",
      address: form.get("address") ?? "",
      phone: form.get("phone") ?? "",
      theme: form.get("theme"),
    });
  if (!input.success)
    redirect(`/painel/${c}/disponibilidade?erro=perfil#pagina-publica`);
  const { error } = await db.rpc("configure_booking_profile", {
    c,
    ...input.data,
  });
  if (error)
    redirect(`/painel/${c}/disponibilidade?erro=perfil#pagina-publica`);
  revalidatePath(`/painel/${c}`, "layout");
  redirect(`/painel/${c}/disponibilidade?salvo=perfil#pagina-publica`);
}
