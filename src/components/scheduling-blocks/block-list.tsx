import Link from "next/link";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { EmptyState } from "@/components/ui/empty-state";
import { APPOINTMENT_ZONE } from "@/lib/scheduling";
import { BLOCKS_PAGE_SIZE, type ScheduleBlock } from "@/lib/schedule-blocks";
import "./blocks.css";

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: APPOINTMENT_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));

export function ScheduleBlockList({
  blocks,
  professionals,
  page,
  total,
  pageHref,
  removeAction,
  windowDay,
}: {
  blocks: ScheduleBlock[];
  professionals: { id: string; name: string }[];
  page: number;
  total: number;
  pageHref: (page: number) => string;
  removeAction?: (form: FormData) => Promise<void>;
  windowDay?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / BLOCKS_PAGE_SIZE));
  return (
    <div className="schedule-block-results">
      {!blocks.length ? (
        <EmptyState
          icon="calendar"
          title={
            page > pages
              ? "Página sem bloqueios"
              : "Nenhum bloqueio neste período"
          }
          description={
            page > pages
              ? "Volte à primeira página para consultar os bloqueios disponíveis."
              : "Os turnos regulares continuam definindo os horários disponíveis. Bloqueios de outros períodos aparecem ao mudar as datas."
          }
        />
      ) : (
        <ul className="schedule-block-list">
          {blocks.map((block) => {
            const who = block.professional_id
              ? (professionals.find(
                  (professional) => professional.id === block.professional_id,
                )?.name ?? "Profissional indisponível")
              : "Toda a empresa";
            return (
              <li key={block.id}>
                <div>
                  <strong>{who}</strong>
                  <p className="schedule-block-interval">
                    <time dateTime={block.starts_at}>
                      {dateTime(block.starts_at)}
                    </time>
                    <span aria-hidden="true"> → </span>
                    <span className="sr-only">até </span>
                    <time dateTime={block.ends_at}>
                      {dateTime(block.ends_at)}
                    </time>
                  </p>
                  {block.reason && (
                    <p className="schedule-block-reason">{block.reason}</p>
                  )}
                </div>
                {removeAction && (
                  <form action={removeAction}>
                    <input type="hidden" name="block_id" value={block.id} />
                    {windowDay && (
                      <input
                        type="hidden"
                        name="window_day"
                        value={windowDay}
                      />
                    )}
                    <ConfirmSubmit
                      label="Remover bloqueio"
                      description={`Liberar o período de ${dateTime(block.starts_at)} até ${dateTime(block.ends_at)} para ${who}? Os turnos regulares voltarão a valer. Agendamentos existentes serão preservados.`}
                    />
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <nav
        className="schedule-block-pagination"
        aria-label="Páginas de bloqueios"
      >
        <span>
          {total} {total === 1 ? "bloqueio" : "bloqueios"} no período · Página{" "}
          {page} de {pages}
        </span>
        {page > 1 && (
          <Link className="button secondary" href={pageHref(1)}>
            Primeira
          </Link>
        )}
        {page > 1 && page <= pages && (
          <Link className="button secondary" href={pageHref(page - 1)}>
            Anterior
          </Link>
        )}
        {page < pages && (
          <Link className="button secondary" href={pageHref(page + 1)}>
            Próxima
          </Link>
        )}
      </nav>
    </div>
  );
}
