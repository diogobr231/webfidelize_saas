"use server";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { publicDatabase } from "@/lib/supabase/public";
import {
  bookingReceiptSchema,
  signDetailedReceipt,
  signReceipt,
} from "@/lib/booking-receipt";
export async function reserve(form: FormData) {
  const slug = z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{2,59}$/)
    .safeParse(form.get("slug"));
  if (!slug.success) redirect("/");
  const input = z
    .object({
      service: z.uuid(),
      professional: z.uuid(),
      start_time: z.iso.datetime({ offset: true }),
      customer_name: z.string().trim().min(2).max(120),
      phone: z
        .string()
        .min(10)
        .max(30)
        .transform((v) => v.replace(/\D/g, ""))
        .pipe(z.string().regex(/^\d{10,13}$/)),
      request_id: z.uuid(),
      consent: z.literal("on"),
      website: z.literal(""),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) redirect(`/agendar/${slug.data}?erro=campos`);
  const secret = process.env.BOOKING_GATEWAY_SECRET;
  if (!secret) redirect(`/agendar/${slug.data}?erro=configuracao`);
  const h = await headers();
  const ip =
    process.env.VERCEL === "1"
      ? h.get("x-vercel-forwarded-for") || "unknown"
      : "local";
  const { consent, website, ...values } = input.data;
  void consent;
  void website;
  const db = publicDatabase();
  const { data, error } = await db.rpc("submit_public_booking", {
    slug: slug.data,
    ...values,
    gateway_secret: secret,
    ip_hash: createHmac("sha256", secret).update(ip).digest("hex"),
  });
  if (error) redirect(`/agendar/${slug.data}?erro=horario`);
  // Read the stored reservation for this idempotency key: a retried request
  // may carry changed form fields but must still describe the original booking.
  const result = await db.rpc("public_booking_receipt", {
    slug: slug.data,
    request_id: values.request_id,
    gateway_secret: secret,
  });
  const receipt = bookingReceiptSchema.safeParse(result.data);
  if (!result.error && receipt.success && receipt.data.id === data) {
    const token = signDetailedReceipt(
      slug.data,
      values.request_id,
      receipt.data,
      secret,
    );
    redirect(`/agendar/${slug.data}?recibo=${token}`);
  }
  redirect(
    `/agendar/${slug.data}?confirmado=${data}&proof=${signReceipt(slug.data, data, secret)}`,
  );
}
