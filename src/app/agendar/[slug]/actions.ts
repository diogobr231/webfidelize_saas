"use server";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { publicDatabase } from "@/lib/supabase/public";
import {
  bookingIntakeSchema,
  compactBookingDetails,
  safeDeliveryLocation,
} from "@/lib/booking-intake";
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
      whatsapp_consent: z.literal("on").optional(),
      website: z.literal(""),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) redirect(`/agendar/${slug.data}?erro=campos`);
  const intake = bookingIntakeSchema.safeParse({
    delivery_location: form.get("delivery_location") ?? "",
    pet_name: form.get("pet_name") ?? "",
    pet_species: form.get("pet_species") ?? "",
    pet_size: form.get("pet_size") ?? "",
    meeting_topic: form.get("meeting_topic") ?? "",
  });
  if (!intake.success || !safeDeliveryLocation(intake.data.delivery_location))
    redirect(`/agendar/${slug.data}?erro=campos`);
  const secret = process.env.BOOKING_GATEWAY_SECRET;
  if (!secret) redirect(`/agendar/${slug.data}?erro=configuracao`);
  const h = await headers();
  const ip =
    process.env.VERCEL === "1"
      ? h.get("x-vercel-forwarded-for") || "unknown"
      : "local";
  const { consent, website, whatsapp_consent, ...values } = input.data;
  void consent;
  void website;
  const bookingDetails = compactBookingDetails(intake.data);
  const db = publicDatabase();
  const { data, error } = await db.rpc("submit_public_booking_with_details", {
    p_slug: slug.data,
    p_service: values.service,
    p_professional: values.professional,
    p_start_time: values.start_time,
    p_customer_name: values.customer_name,
    p_phone: values.phone,
    p_request_id: values.request_id,
    p_gateway_secret: secret,
    p_ip_hash: createHmac("sha256", secret).update(ip).digest("hex"),
    p_booking_details: bookingDetails,
  });
  if (error)
    redirect(
      `/agendar/${slug.data}?erro=${error.message.includes("invalid booking details") ? "campos" : "horario"}`,
    );
  // Optional reminders must never undo a successful reservation. Permission
  // is resolved against the stored booking, not a client-provided customer ID.
  let reminderNotice = "";
  if (whatsapp_consent === "on") {
    try {
      const permission = await db.rpc("public_booking_whatsapp_consent", {
        p_slug: slug.data,
        p_request_id: values.request_id,
        p_gateway_secret: secret,
        p_allowed: true,
      });
      if (permission.error || permission.data !== true)
        reminderNotice = "&aviso=lembrete";
    } catch {
      reminderNotice = "&aviso=lembrete";
    }
  }
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
    redirect(`/agendar/${slug.data}?recibo=${token}${reminderNotice}`);
  }
  redirect(
    `/agendar/${slug.data}?confirmado=${data}&proof=${signReceipt(slug.data, data, secret)}${reminderNotice}`,
  );
}
