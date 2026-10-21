import type { Metadata } from "next";
import { z } from "zod";
import { Brand } from "@/components/ui/brand";
import { PendingButton } from "@/components/pending-button";
import { tokenHash } from "@/lib/whatsapp/core";
import { whatsappGatewaySecret, whatsappRpc } from "@/lib/whatsapp/server";
import { respondToReminder } from "./actions";
import "./confirmation.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Seu agendamento | Web Fidelize",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
const summarySchema = z.object({
  company_name: z.string(),
  starts_at: z.string(),
  confirmed: z.boolean(),
  opted_out: z.boolean(),
});

export default async function ConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const { token } = await params;
  const q = await searchParams;
  let summary: z.infer<typeof summarySchema> | null = null;
  let unavailable = false;
  if (/^[a-f0-9]{64}$/.test(token)) {
    try {
      const result = await whatsappRpc()("whatsapp_confirmation", {
        p_secret: whatsappGatewaySecret(),
        p_token_hash: tokenHash(token),
        p_action: "view",
      });
      unavailable = !!result.error;
      const parsed = summarySchema.safeParse(result.data);
      if (parsed.success) summary = parsed.data;
    } catch {
      unavailable = true;
    }
  }
  const date = summary
    ? new Date(summary.starts_at).toLocaleDateString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : "";
  const hour = summary
    ? new Date(summary.starts_at).toLocaleTimeString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
    : "";
  return (
    <main className="confirmation-page">
      <Brand />
      <section className="confirmation-card">
        <span className="tag">SEU AGENDAMENTO</span>
        {!summary ? (
          <>
            <h1>
              {unavailable
                ? "Não conseguimos consultar agora"
                : "Este link não está mais disponível"}
            </h1>
            <p>
              {unavailable
                ? "Tente novamente em alguns instantes ou fale com a empresa."
                : "O agendamento pode ter sido alterado, cancelado ou o link expirou. Fale com a empresa para verificar seu horário."}
            </p>
          </>
        ) : (
          <>
            <h1>
              {summary.confirmed
                ? "Presença confirmada"
                : "Podemos contar com você?"}
            </h1>
            <p className="confirmation-company">{summary.company_name}</p>
            <div className="confirmation-appointment">
              <strong>{date}</strong>
              <span>às {hour}</span>
              <small>Horário de São Paulo</small>
            </div>
            {q.erro && (
              <p className="notice error" role="alert">
                Não foi possível salvar. Tente novamente ou fale com a empresa.
              </p>
            )}
            {summary.confirmed ? (
              <p className="notice success" role="status">
                A empresa já pode ver sua confirmação na agenda.
              </p>
            ) : (
              <form action={respondToReminder}>
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="response" value="confirm" />
                <PendingButton pendingLabel="Confirmando…">
                  Confirmar minha presença
                </PendingButton>
              </form>
            )}
            <p>Precisa alterar o horário? Fale diretamente com a empresa.</p>
            <div className="confirmation-optout">
              {summary.opted_out ? (
                <p role="status">
                  Você não receberá novos lembretes desta empresa neste número.
                </p>
              ) : (
                <>
                  <p>Prefere não receber lembretes pelo WhatsApp?</p>
                  <form action={respondToReminder}>
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="response" value="optout" />
                    <PendingButton
                      className="button secondary"
                      pendingLabel="Salvando…"
                    >
                      Parar lembretes
                    </PendingButton>
                  </form>
                </>
              )}
            </div>
          </>
        )}
      </section>
      <p className="confirmation-footer">Organizado com Web Fidelize</p>
    </main>
  );
}
