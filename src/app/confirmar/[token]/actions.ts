"use server";
import { redirect } from "next/navigation";
import { tokenHash } from "@/lib/whatsapp/core";
import { whatsappGatewaySecret, whatsappRpc } from "@/lib/whatsapp/server";

export async function respondToReminder(form: FormData) {
  const token = form.get("token");
  const action = form.get("response");
  if (
    typeof token !== "string" ||
    !/^[a-f0-9]{64}$/.test(token) ||
    (action !== "confirm" && action !== "optout")
  )
    redirect("/confirmar/invalido");
  let success = false;
  try {
    const result = await whatsappRpc()("whatsapp_confirmation", {
      p_secret: whatsappGatewaySecret(),
      p_token_hash: tokenHash(token),
      p_action: action,
    });
    success = !result.error && !!result.data;
  } catch {
    /* Unconfigured integration must not show successful confirmation. */
  }
  redirect(
    `/confirmar/${token}?${success ? `feito=${action}` : "erro=indisponivel"}`,
  );
}
