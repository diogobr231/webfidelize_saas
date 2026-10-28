"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import type {
  CalendarImportState,
  ImportMapping,
} from "@/app/painel/[companyId]/agenda/importar/actions";
import type { CsvColumns } from "@/lib/calendar-import";

type Choice = { id: string; name: string };
const columnLabels: Record<keyof CsvColumns, string> = {
  title: "Título / assunto",
  start: "Data ou início completo",
  end: "Data ou término completo",
  startTime: "Hora de início (separada)",
  endTime: "Hora de término (separada)",
  id: "Identificador único do evento",
  allDay: "Indicador de dia inteiro",
};
const statusLabels: Record<string, string> = {
  pending: "A conferir",
  ready: "Pronto para importar",
  imported: "Importado",
  duplicate: "Importado anteriormente",
  conflict: "Conflito de horário",
  invalid: "Revisar",
  unselected: "Não selecionado",
};
const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const date = (iso: string) => dateFormatter.format(new Date(iso));

export function CalendarImportForm({
  action,
  companyId,
  today,
  until,
  professionals,
  customers,
  services,
}: {
  action: (
    previous: CalendarImportState,
    form: FormData,
  ) => Promise<CalendarImportState>;
  companyId: string;
  today: string;
  until: string;
  professionals: Choice[];
  customers: Choice[];
  services: (Choice & { duration_minutes: number })[];
}) {
  const [file, setFile] = useState<File | null>(null);
  const [from, setFrom] = useState(today),
    [to, setTo] = useState(until);
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [dateOrder, setDateOrder] = useState("br");
  const [professional, setProfessional] = useState(professionals[0]?.id || "");
  const [columns, setColumns] = useState<CsvColumns | undefined>();
  const [mappings, setMappings] = useState<Record<string, ImportMapping>>({});
  const [dirty, setDirty] = useState(true),
    [newFile, setNewFile] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const feedback = useRef<HTMLDivElement>(null);
  const [state, submit, pending] = useActionState(action, {});
  useEffect(() => {
    if (!state.feedbackKey) return;
    if (state.columns) setColumns(state.columns);
    if (state.rows) {
      setMappings(
        Object.fromEntries(
          state.rows.map((row) => [row.source_key, row.mapping]),
        ),
      );
      setNewFile(false);
    }
    setDirty(false);
    setConfirmed(false);
    feedback.current?.focus();
  }, [state.feedbackKey, state.columns, state.rows]);
  const change = () => {
    setDirty(true);
    setConfirmed(false);
  };
  const update = (key: string, patch: Partial<ImportMapping>) => {
    setMappings((old) => ({ ...old, [key]: { ...old[key], ...patch } }));
    change();
  };
  const selected = Object.values(mappings).filter((m) => m.selected).length;
  const ready = state.rows?.filter((r) => r.status === "ready").length || 0;
  const canImport = !dirty && !state.error && ready > 0 && confirmed;
  return (
    <form
      action={submit}
      className="calendar-import-form"
      aria-busy={pending}
      data-calendar-import-form="true"
      onReset={(event) => event.preventDefault()}
    >
      <input type="hidden" name="mappings" value={JSON.stringify(mappings)} />
      <input
        type="hidden"
        name="columns"
        value={columns ? JSON.stringify(columns) : ""}
      />
      <input
        type="hidden"
        name="selection_initialized"
        value={state.rows && !newFile ? "yes" : "no"}
      />
      <fieldset disabled={pending} className="calendar-import-upload">
        <legend>Escolha o arquivo e o período</legend>
        <label>
          Arquivo da agenda
          <input
            type="file"
            name="file"
            required
            accept=".ics,.csv,text/calendar,text/csv"
            onChange={(event) => {
              setFile(event.target.files?.[0] || null);
              setMappings({});
              setColumns(undefined);
              setNewFile(true);
              change();
            }}
            aria-describedby="import-file-hint"
          />
        </label>
        <p id="import-file-hint">
          {file ? `${file.name} · ${Math.ceil(file.size / 1024)} KB. ` : ""}ICS
          ou CSV em UTF-8, até 1 MB. Até 200 ocorrências por lote e 90 dias por
          período.
        </p>
        <div className="calendar-import-grid">
          <label>
            Importar a partir de
            <input
              name="from"
              type="date"
              required
              min={today}
              max="2099-12-31"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                change();
              }}
            />
          </label>
          <label>
            Até
            <input
              name="to"
              type="date"
              required
              min={from}
              max="2099-12-31"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                change();
              }}
            />
          </label>
          <label>
            Profissional de destino
            <select
              name="professional_id"
              value={professional}
              onChange={(e) => {
                setProfessional(e.target.value);
                setMappings((old) =>
                  Object.fromEntries(
                    Object.entries(old).map(([key, m]) => [
                      key,
                      { ...m, professional_id: e.target.value },
                    ]),
                  ),
                );
                change();
              }}
              required
            >
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fuso dos horários sem indicação
            <input
              name="timezone"
              value={timezone}
              maxLength={80}
              onChange={(e) => {
                setTimezone(e.target.value);
                change();
              }}
              list="calendar-timezones"
              required
            />
            <datalist id="calendar-timezones">
              <option value="America/Sao_Paulo" />
              <option value="America/Manaus" />
              <option value="America/Cuiaba" />
              <option value="America/Rio_Branco" />
              <option value="America/Fortaleza" />
              <option value="UTC" />
            </datalist>
          </label>
        </div>
        <p className="calendar-import-note">
          A prévia sempre mostra horários de São Paulo. Eventos ICS com fuso
          próprio preservam esse fuso. Recorrências diárias e semanais são
          expandidas apenas para o período escolhido; dias inteiros e formatos
          não suportados serão listados para revisão.
        </p>
        {file?.name.toLowerCase().endsWith(".csv") && (
          <label>
            Formato das datas no CSV
            <select
              name="date_order"
              value={dateOrder}
              onChange={(e) => {
                setDateOrder(e.target.value);
                change();
              }}
            >
              <option value="br">Brasileiro: DD/MM/AAAA</option>
              <option value="us">Americano: MM/DD/AAAA</option>
              <option value="iso">ISO: AAAA-MM-DD</option>
            </select>
          </label>
        )}
        {!!state.headers?.length && (
          <details
            className="calendar-import-columns"
            open={!!state.error && !state.rows}
          >
            <summary>Conferir as colunas do CSV</summary>
            <p>
              Escolha data e hora em colunas separadas ou um campo completo de
              início e término. Se o término usa a mesma data, escolha apenas a
              coluna de hora de término.
            </p>
            <div className="calendar-import-grid">
              {(Object.keys(columnLabels) as (keyof CsvColumns)[]).map(
                (key) => (
                  <label key={key}>
                    {columnLabels[key]}
                    <select
                      value={columns?.[key] ?? -1}
                      onChange={(e) => {
                        setColumns((old) => ({
                          ...old!,
                          [key]: Number(e.target.value),
                        }));
                        change();
                      }}
                    >
                      <option value={-1}>Não há / não utilizar</option>
                      {state.headers!.map((header, index) => (
                        <option key={index} value={index}>
                          {index + 1}. {header || "Sem nome"}
                        </option>
                      ))}
                    </select>
                  </label>
                ),
              )}
            </div>
          </details>
        )}
      </fieldset>
      <div className="calendar-import-feedback" ref={feedback} tabIndex={-1}>
        {state.error && (
          <p className="notice error" role="alert">
            {state.error}
          </p>
        )}
        {state.message && (
          <p className="notice" role="status">
            {state.message}
          </p>
        )}
        {dirty && state.rows && (
          <p className="notice">
            A seleção foi alterada. Confira a prévia novamente antes de
            importar.
          </p>
        )}
      </div>
      <button
        name="intent"
        value="preview"
        disabled={pending}
        className="secondary"
      >
        {pending ? (
          <>
            <span className="ui-spinner" aria-hidden="true" /> Conferindo…
          </>
        ) : state.rows ? (
          "Conferir seleção novamente"
        ) : (
          "Gerar prévia dos horários"
        )}
      </button>
      {state.rows && (
        <section
          className="calendar-import-preview"
          aria-label="Prévia da importação"
        >
          <header>
            <div>
              <h2>Confira seus compromissos</h2>
              <p>
                {selected} selecionado(s) · {state.duplicates || 0} já
                importado(s) · {state.conflicts || 0} conflito(s). Nada é
                sobrescrito.
              </p>
            </div>
            <button
              type="button"
              className="secondary"
              disabled={pending}
              onClick={() => {
                setMappings((old) =>
                  Object.fromEntries(
                    Object.entries(old).map(([key, m]) => [
                      key,
                      { ...m, selected: false },
                    ]),
                  ),
                );
                change();
              }}
            >
              Desmarcar todos
            </button>
          </header>
          <p className="calendar-import-note">
            O padrão é <strong>horário ocupado</strong>, sem cliente ou receita
            fictícia. Para um atendimento completo, escolha um cliente e serviço
            já cadastrados; a duração deve corresponder ao serviço.
          </p>
          <div className="calendar-import-rows">
            {state.rows.map((row, index) => {
              const m = mappings[row.source_key] || row.mapping;
              return (
                <article
                  className={`calendar-import-row ${m.selected ? "is-selected" : ""}`}
                  key={`${row.source_key}:${index}`}
                >
                  <label className="calendar-import-select">
                    <input
                      type="checkbox"
                      checked={m.selected}
                      disabled={pending}
                      onChange={(e) =>
                        update(row.source_key, { selected: e.target.checked })
                      }
                    />
                    <span>
                      <strong>{row.title}</strong>
                      <small>
                        {date(row.starts_at)} → {date(row.ends_at)}
                      </small>
                    </span>
                  </label>
                  <span
                    className={`calendar-import-status status-${row.status}`}
                  >
                    {statusLabels[row.status] || "Revisar"}
                  </span>
                  {row.reason && (
                    <p className="calendar-import-reason">{row.reason}</p>
                  )}
                  <details
                    onToggle={(e) => {
                      const open = e.currentTarget.open;
                      setExpanded((old) => ({
                        ...old,
                        [row.source_key]: open,
                      }));
                    }}
                  >
                    <summary>Destino e tipo de compromisso</summary>
                    {expanded[row.source_key] && (
                      <div className="calendar-import-grid">
                        <label>
                          Profissional
                          <select
                            value={m.professional_id}
                            disabled={pending}
                            onChange={(e) =>
                              update(row.source_key, {
                                professional_id: e.target.value,
                              })
                            }
                          >
                            {professionals.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Importar como
                          <select
                            value={m.kind}
                            disabled={pending}
                            onChange={(e) =>
                              update(row.source_key, {
                                kind: e.target.value as ImportMapping["kind"],
                              })
                            }
                          >
                            <option value="block">
                              Horário ocupado (recomendado)
                            </option>
                            <option value="appointment">
                              Atendimento com cliente e serviço
                            </option>
                          </select>
                        </label>
                        {m.kind === "appointment" && (
                          <>
                            <label>
                              Cliente
                              <select
                                value={m.customer_id}
                                disabled={pending}
                                onChange={(e) =>
                                  update(row.source_key, {
                                    customer_id: e.target.value,
                                  })
                                }
                              >
                                <option value="">Selecione o cliente</option>
                                {customers.map((c) => (
                                  <option value={c.id} key={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Serviço
                              <select
                                value={m.service_id}
                                disabled={pending}
                                onChange={(e) =>
                                  update(row.source_key, {
                                    service_id: e.target.value,
                                  })
                                }
                              >
                                <option value="">Selecione o serviço</option>
                                {services.map((s) => (
                                  <option value={s.id} key={s.id}>
                                    {s.name} · {s.duration_minutes} min
                                  </option>
                                ))}
                              </select>
                            </label>
                          </>
                        )}
                      </div>
                    )}
                  </details>
                </article>
              );
            })}
          </div>
          <div className="calendar-import-confirm">
            <label>
              <input
                type="checkbox"
                name="confirm_import"
                value="yes"
                checked={confirmed}
                disabled={pending || dirty || !!state.error || !ready}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>
                Conferi os horários e os profissionais. Quero salvar somente os
                eventos selecionados nesta empresa.
              </span>
            </label>
            <button
              name="intent"
              value="import"
              disabled={pending || !canImport}
            >
              {pending
                ? "Validando e salvando…"
                : `Importar ${ready} horário(s)`}
            </button>
            <p>
              Os conflitos são conferidos novamente ao salvar. Se surgir
              qualquer conflito, nenhum novo item do lote será criado.
            </p>
            {!!state.imported && (
              <Link
                className="button secondary"
                href={`/painel/${companyId}/agenda?day=${from}`}
              >
                Ver minha agenda
              </Link>
            )}
          </div>
        </section>
      )}
      {(!!state.issueCount || !!state.outsideWindow) && (
        <aside className="calendar-import-exclusions">
          <h2>Itens não incluídos</h2>
          <p>
            {state.issueCount || 0} evento(s) precisam de ajuste na origem.{" "}
            {state.outsideWindow || 0} ocorrência(s) fora do período
            selecionado.
          </p>
          {!!state.issues?.length && (
            <details open>
              <summary>Ver motivos</summary>
              <ul>
                {state.issues.map((item, index) => (
                  <li key={index}>
                    <strong>{item.title}</strong>
                    <span>{item.reason}</span>
                  </li>
                ))}
              </ul>
              {(state.issueCount || 0) > state.issues.length && (
                <p>
                  Mostrando os primeiros 200 motivos. Use um período menor para
                  revisar os demais.
                </p>
              )}
            </details>
          )}
        </aside>
      )}
      <p className="calendar-import-note">
        O arquivo não é salvo no Storage. Títulos externos aparecem apenas nesta
        prévia; os bloqueios ficam com o texto “Compromisso importado”. Não
        informe dados clínicos ou documentos sensíveis.
      </p>
    </form>
  );
}
