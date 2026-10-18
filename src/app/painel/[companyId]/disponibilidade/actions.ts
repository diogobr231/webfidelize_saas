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
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) redirect("/painel");
  const { db } = await requireCompany(input.data.company_id, true, true);
  const minutes = (s: string) =>
    Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const { error } = await db
    .from("availability")
    .insert({
      company_id: input.data.company_id,
      professional_id: input.data.professional_id,
      weekday: input.data.weekday,
      start_minute: minutes(input.data.start),
      end_minute: minutes(input.data.end),
    });
  if (error)
    redirect(`/painel/${input.data.company_id}/disponibilidade?erro=turno`);
  revalidatePath(`/painel/${input.data.company_id}/disponibilidade`);
  redirect(`/painel/${input.data.company_id}/disponibilidade`);
}
export async function removeShift(form: FormData) {
  const c = z.uuid().parse(form.get("company_id"));
  const id = z.uuid().parse(form.get("id"));
  const { db } = await requireCompany(c, true, true);
  const { error } = await db
    .from("availability")
    .delete()
    .eq("company_id", c)
    .eq("id", id);
  redirect(`/painel/${c}/disponibilidade${error ? "?erro=remover" : ""}`);
}
export async function configure(form: FormData) {
  const c = z.uuid().parse(form.get("company_id"));
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
  redirect(`/painel/${c}/disponibilidade${error ? "?erro=pagina" : ""}`);
}
