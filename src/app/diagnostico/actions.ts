"use server";
import { salesInquirySchema, type SalesActionState } from "@/lib/sales";
import { publicDatabase } from "@/lib/supabase/public";

export async function submitSalesInquiry(
  _previous: SalesActionState,
  form: FormData,
): Promise<SalesActionState> {
  const input = salesInquirySchema.safeParse(Object.fromEntries(form));
  if (!input.success)
    return {
      error:
        "Confira os campos e autorize o contato para enviar sua solicitação.",
    };
  const secret = process.env.SALES_GATEWAY_SECRET;
  if (!secret || secret.length < 32)
    return {
      error:
        "O formulário está temporariamente indisponível. Você pode falar conosco pelo WhatsApp.",
    };
  const { request_id, website, consent, ...fields } = input.data;
  void website;
  void consent;
  try {
    const { data, error } = await publicDatabase().rpc("sales_capture", {
      p_gateway_secret: secret,
      p_request_id: request_id,
      p_input: { ...fields, consent: true },
    });
    if (error || data !== true)
      return {
        error:
          "Não foi possível registrar agora. Confira os dados e tente novamente mais tarde ou fale pelo WhatsApp.",
      };
    return {
      success:
        "Solicitação recebida. Vamos analisar seu cenário e combinar o próximo passo pelo contato informado.",
    };
  } catch {
    return {
      error:
        "Não foi possível confirmar o envio. Tente novamente; sua solicitação não será duplicada.",
    };
  }
}
