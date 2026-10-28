"use server";

import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { publicDatabase } from "@/lib/supabase/public";
import {
  classError,
  classSlugSchema,
  publicClassReservationSchema,
  type ClassFormState,
} from "@/lib/classes";
import { signClassReceipt } from "@/lib/class-receipt";

export async function reserveClass(
  slug: string,
  _previous: ClassFormState,
  form: FormData,
): Promise<ClassFormState> {
  if (!classSlugSchema.safeParse(slug).success)
    return { error: "Página de inscrição inválida." };
  const input = publicClassReservationSchema.safeParse(
    Object.fromEntries(form),
  );
  if (!input.success)
    return {
      error:
        "Confira seu nome, telefone com DDD e autorização de uso dos dados.",
    };
  const secret = process.env.BOOKING_GATEWAY_SECRET;
  if (!secret)
    return {
      error:
        "As inscrições estão temporariamente indisponíveis. Fale com a empresa.",
    };
  const requestHeaders = await headers();
  const ip =
    process.env.VERCEL === "1"
      ? requestHeaders.get("x-vercel-forwarded-for") || "unknown"
      : "local";
  try {
    const { data, error } = await publicDatabase().rpc(
      "submit_public_class_booking",
      {
        p_slug: slug,
        p_session: input.data.session,
        p_customer_name: input.data.customer_name,
        p_phone: input.data.phone,
        p_request_id: input.data.request_id,
        p_gateway_secret: secret,
        p_ip_hash: createHmac("sha256", secret).update(ip).digest("hex"),
      },
    );
    if (error) return { error: classError(error.message) };
    if (!z.uuid().safeParse(data).success)
      return {
        error:
          "Não recebemos a confirmação. Tente novamente; a mesma solicitação não reserva duas vagas.",
      };
  } catch {
    return {
      error:
        "Não conseguimos consultar a confirmação. Tente novamente em instantes; a mesma solicitação não reserva duas vagas.",
    };
  }
  // The signed link only permits a stored receipt lookup. The page below must
  // re-read the database before displaying either confirmation or current status.
  const token = signClassReceipt(slug, input.data.request_id, secret);
  redirect(`/agendar/${slug}/turmas?recibo=${token}`);
}
