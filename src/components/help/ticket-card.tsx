import {
  helpDate,
  helpModuleName,
  ticketStatuses,
  type SupportTicket,
} from "@/lib/help";

export function TicketCard({
  ticket,
  children,
}: {
  ticket: SupportTicket;
  children?: React.ReactNode;
}) {
  return (
    <article className="help-ticket" id={`ticket-${ticket.id}`}>
      <div className="help-ticket-meta">
        <span>
          {helpModuleName(ticket.module)} · #
          {ticket.id.slice(0, 8).toUpperCase()}
        </span>
        <span className={`help-status help-status-${ticket.status}`}>
          {ticketStatuses[ticket.status]}
        </span>
      </div>
      <h3>{ticket.subject}</h3>
      <p className="help-prose">{ticket.message}</p>
      <p className="help-hint">
        Enviada em{" "}
        <time dateTime={ticket.created_at}>{helpDate(ticket.created_at)}</time>
      </p>
      {ticket.response && (
        <div className="help-reply">
          <strong>Resposta da Web Fidelize</strong>
          <p className="help-prose">{ticket.response}</p>
          <small>
            Atualizada em{" "}
            <time dateTime={ticket.updated_at}>
              {helpDate(ticket.updated_at)}
            </time>
          </small>
        </div>
      )}
      {children}
    </article>
  );
}
