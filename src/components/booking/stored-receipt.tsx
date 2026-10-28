import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import type { BookingReceipt } from "@/lib/booking-receipt";
import type { ClassReceipt } from "@/lib/classes";

/** Receipts remain readable without exposing a closed company's catalog. */
export function StoredReceipt({
  receipt,
  calendarUrl,
}: {
  receipt: BookingReceipt | ClassReceipt;
  calendarUrl?: string;
}) {
  const group = "class_status" in receipt;
  const canceled =
    receipt.status === "canceled" ||
    (group && receipt.class_status === "canceled");
  const finished =
    receipt.status === "completed" ||
    (group && receipt.class_status === "completed");
  const title = canceled
    ? group
      ? "Inscrição cancelada"
      : "Agendamento cancelado"
    : group && receipt.status === "attended"
      ? "Presença registrada"
      : finished
        ? group
          ? "Atividade concluída"
          : "Atendimento concluído"
        : group
          ? "Sua vaga está confirmada"
          : "Seu agendamento está confirmado";
  const date = new Date(receipt.starts_at).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const time = (value: string) =>
    new Date(value).toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <main className="booking-page" data-theme="blue">
      <div className="booking-topbar">
        <div className="booking-shell booking-topbar-inner">
          <Link href="/" className="booking-business">
            <Icon name="calendar" size={24} /> Web Fidelize
          </Link>
          <span>Seu comprovante</span>
        </div>
      </div>
      <div
        className="booking-shell"
        style={{ maxWidth: 760, paddingBlock: 32, overflowWrap: "anywhere" }}
      >
        <section
          className="booking-card booking-confirmation"
          aria-labelledby="stored-receipt-title"
        >
          <span className="booking-confirmation-icon" aria-hidden="true">
            <Icon name={canceled ? "calendar" : "check"} size={28} />
          </span>
          <p className="booking-eyebrow">COMPROVANTE DE RESERVA</p>
          <h1 id="stored-receipt-title">{title}</h1>
          {group && (
            <p>
              {receipt.company_name} · {receipt.title}
            </p>
          )}
          <dl className="booking-confirmation-details">
            <div>
              <dt>Serviço</dt>
              <dd>{receipt.service_name}</dd>
            </div>
            <div>
              <dt>Profissional</dt>
              <dd>{receipt.professional_name}</dd>
            </div>
            <div>
              <dt>Quando</dt>
              <dd>{date}</dd>
            </div>
            <div>
              <dt>Horário de São Paulo</dt>
              <dd>
                {time(receipt.starts_at)} às {time(receipt.ends_at)}
              </dd>
            </div>
          </dl>
          <p>
            Estas informações foram consultadas agora no registro da empresa.
            Para alterar ou cancelar, fale com a empresa pelo contato que você
            já utiliza.
          </p>
          {calendarUrl && !canceled && (
            <div className="booking-confirmation-actions">
              <a className="button" href={calendarUrl}>
                <Icon name="calendar" size={18} /> Salvar no calendário
              </a>
            </div>
          )}
        </section>
        <div className="booking-notice" role="status">
          Novas reservas online estão indisponíveis no momento. Seu comprovante
          continua disponível para consulta.
        </div>
      </div>
    </main>
  );
}
