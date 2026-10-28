import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import {
  operationStatusLabels,
  operationTransitions,
  industryOperationPage,
  parseIndustryOperationCursor,
  type IndustryOperationKind,
  operationsForNiche,
} from "@/lib/industry-operations";
import { money } from "@/lib/catalog";
import { PageHeader } from "@/components/ui/page-header";
import { Icon } from "@/components/ui/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { PendingButton } from "@/components/pending-button";
import { PrintOrderButton } from "@/components/print-order-button";
import {
  createIndustryOperation,
  changeIndustryOperationStatus,
  adjustIndustryStock,
} from "./actions";
import "./operations.css";

type OperationRow = {
  id: string;
  company_id: string;
  kind: string;
  name: string;
  details: string;
  status: string;
  reference: string;
  related_operation_id: string | null;
  phone: string;
  quantity: number | null;
  unit: string;
  amount_cents: number | null;
  due_at: string | null;
  location_url: string;
  record_version: number;
  created_at: string;
};
type StockMovement = {
  id: string;
  operation_id: string;
  delta: number;
  reason: string;
  created_at: string;
};
type OperationSummary = {
  cash_in_cents: number;
  cash_out_cents: number;
  cash_net_cents: number;
  commission_pending_cents: number;
  commission_paid_cents: number;
};

const fieldSpecs: Record<
  string,
  { label: string; type?: string; placeholder?: string; note?: string }
> = {
  reference: { label: "Referência", placeholder: "Nome ou número relacionado" },
  related: { label: "Relacionar com" },
  details: {
    label: "Detalhes",
    type: "textarea",
    placeholder: "Anotações úteis para a operação",
  },
  phone: { label: "Telefone", type: "tel", placeholder: "DDD e número" },
  capacity: { label: "Lugares", type: "number", placeholder: "Ex.: 4" },
  quantity: {
    label: "Quantidade atual",
    type: "number",
    placeholder: "Ex.: 12",
  },
  unit: { label: "Unidade", placeholder: "un, kg, frasco..." },
  amount: { label: "Valor em reais", type: "text", placeholder: "0,00" },
  due: { label: "Data e horário", type: "datetime-local" },
  location: {
    label: "Link do Google Maps",
    type: "url",
    placeholder: "https://maps.app.goo.gl/...",
    note: "Aceita links oficiais do Google Maps.",
  },
};

const referenceLabels: Record<string, string> = {
  restaurant_cash: "Movimento",
  supplier_order: "Fornecedor",
  delivery: "Destinatário",
  logistics_driver: "Veículo ou identificação",
  logistics_delivery: "Destinatário",
  pet_profile: "Tutor",
  pet_stock: "Categoria",
  office_task: "Cliente ou responsável",
  office_document: "Cliente ou processo",
  office_process: "Cliente ou referência",
  salon_commission: "Profissional",
  salon_cash: "Movimento",
  salon_stock: "Categoria",
  academy_training: "Aluno",
  academy_attendance: "Aluno participante",
  academy_membership: "Aluno",
};
const detailsLabels: Record<string, string> = {
  restaurant_order: "Itens do pedido",
  restaurant_cash: "Observação",
  supplier_order: "Itens ou observações do pedido",
  delivery: "Instruções para a entrega",
  logistics_route: "Paradas e observações da rota",
  logistics_delivery: "Instruções para a entrega",
  pet_profile: "Espécie, raça, porte e observações não clínicas",
  pet_visit: "Serviço solicitado e observações de atendimento",
  office_document: "Tipo ou descrição do documento",
  office_task: "Próxima ação ou contexto da tarefa",
  office_process: "Etapa atual ou próxima ação",
  salon_commission: "Serviço relacionado à comissão",
  salon_cash: "Observação",
  academy_training: "Exercícios e orientações do plano",
};
const relationLabels: Record<string, string> = {
  restaurant_order: "Mesa",
  logistics_route: "Entregador responsável",
  logistics_delivery: "Rota (opcional)",
  pet_visit: "Pet cadastrado",
};

function fieldLabel(kind: string, field: string, fallback: string) {
  if (field === "reference") return referenceLabels[kind] ?? fallback;
  if (field === "related") return relationLabels[kind] ?? fallback;
  if (field === "details") return detailsLabels[kind] ?? fallback;
  if (field === "location" && kind === "office_document")
    return "Link do documento (HTTPS)";
  return fallback;
}

function elapsedMinutes(value: string) {
  const elapsed = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 60_000),
  );
  if (elapsed < 60) return `${elapsed} min`;
  const hours = Math.floor(elapsed / 60);
  const minutes = elapsed % 60;
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

function statusText(kind: string, status: string) {
  if (kind === "logistics_driver" && status === "available")
    return "Disponível";
  return operationStatusLabels[status] ?? status;
}

function referenceText(kind: string, reference: string) {
  if (kind === "restaurant_cash" || kind === "salon_cash") {
    return reference === "entrada"
      ? "Entrada"
      : reference === "saida"
        ? "Saída"
        : reference;
  }
  return reference;
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "";
}

function operationsPageHref(
  companyId: string,
  direction: "before" | "after",
  row: Pick<OperationRow, "created_at" | "id">,
) {
  const params = new URLSearchParams({
    cursor: row.created_at,
    cursor_id: row.id,
    direction,
  });
  return `/painel/${companyId}/operacoes?${params.toString()}#industry-ops-list-title`;
}

export default async function IndustryOperationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{
    erro?: string;
    salvo?: string;
    atualizado?: string;
    estoque?: string;
    cursor?: string;
    cursor_id?: string;
    direction?: string;
  }>;
}) {
  const { companyId } = await params;
  const { db, company } = await requireCompany(companyId, false, true);
  const definitions = operationsForNiche(company.niche);
  if (!definitions.length) notFound();
  const query = await searchParams;
  const cursor = parseIndustryOperationCursor(
    query.cursor,
    query.cursor_id,
    query.direction,
  );
  const direction = cursor?.direction ?? "after";
  const ascending = direction === "before";
  const kinds = definitions.map(({ kind }) => kind);
  const relationKinds =
    company.niche === "restaurante"
      ? ["restaurant_table"]
      : company.niche === "logistica"
        ? ["logistics_driver", "logistics_route"]
        : company.niche === "pet-shop"
          ? ["pet_profile"]
          : [];
  let operationRequest = db
    .from("industry_operations")
    .select(
      "id,company_id,kind,name,details,status,reference,related_operation_id,phone,quantity,unit,amount_cents,due_at,location_url,record_version,created_at",
    )
    .eq("company_id", companyId)
    .in("kind", kinds);
  if (cursor) {
    const comparison = direction === "before" ? "gt" : "lt";
    operationRequest = operationRequest.or(
      `created_at.${comparison}.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.${comparison}.${cursor.id})`,
    );
  }
  operationRequest = operationRequest
    .order("created_at", { ascending })
    .order("id", { ascending })
    .limit(101);
  const [
    { data, error },
    { data: relatedRows, error: relationError },
    { data: movementRows, error: movementError },
    { data: summaryData, error: summaryError },
  ] = await Promise.all([
    operationRequest,
    db
      .from("industry_operations")
      .select("id,kind,name,status,quantity")
      .eq("company_id", companyId)
      .in("kind", relationKinds.length ? relationKinds : [""])
      .order("name")
      .limit(500),
    db
      .from("industry_stock_movements")
      .select("id,operation_id,delta,reason,created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(100),
    ["restaurante", "salao"].includes(company.niche)
      ? db.rpc("industry_operations_summary", { p_company: companyId })
      : Promise.resolve({ data: null, error: null }),
  ]);
  const fetchedRows = (data ?? []) as OperationRow[];
  const { rows, hasPrevious, hasNext } = industryOperationPage(
    fetchedRows,
    direction,
    Boolean(cursor),
  );
  const relationRecords = (relatedRows ?? []) as Pick<
    OperationRow,
    "id" | "kind" | "name" | "status" | "quantity"
  >[];
  const stockMovements = (movementRows ?? []) as StockMovement[];
  const movementsByRecord = new Map<string, StockMovement[]>();
  const summary = summaryData as OperationSummary | null;
  for (const movement of stockMovements) {
    const previous = movementsByRecord.get(movement.operation_id) ?? [];
    previous.push(movement);
    movementsByRecord.set(movement.operation_id, previous);
  }
  const labelByKind = new Map(
    definitions.map((item) => [item.kind, item.label]),
  );

  return (
    <>
      <PageHeader
        eyebrow="Rotina do negócio"
        title="Operações"
        description={`Acompanhe tarefas e controles próprios de ${company.name}. Os registros ficam visíveis apenas para proprietários e gerentes autorizados.`}
      />
      {query.erro && (
        <p role="alert" className="notice error">
          {query.erro === "transicao"
            ? "Essa mudança de etapa não é válida para o fluxo atual."
            : query.erro === "campos"
              ? "Revise os campos obrigatórios e os formatos informados."
              : "Não foi possível salvar. Confira os campos e tente novamente."}
        </p>
      )}
      {query.salvo === "1" && (
        <p role="status" className="notice">
          Registro criado e salvo para esta empresa.
        </p>
      )}
      {query.atualizado === "1" && (
        <p role="status" className="notice">
          Etapa atualizada.
        </p>
      )}
      {query.estoque === "1" && (
        <p role="status" className="notice">
          Saldo e histórico do estoque atualizados.
        </p>
      )}
      {error && (
        <p role="alert" className="notice error">
          Não foi possível carregar as operações agora.
        </p>
      )}
      {relationError && (
        <p role="alert" className="notice error">
          Não foi possível carregar os registros para relacionar. Atualize a
          página e tente novamente.
        </p>
      )}
      {movementError && (
        <p role="alert" className="notice error">
          Não foi possível carregar o histórico de movimentações do estoque.
        </p>
      )}
      {summaryError && ["restaurante", "salao"].includes(company.niche) && (
        <p role="alert" className="notice error">
          O resumo financeiro está indisponível agora; os lançamentos continuam
          consultáveis.
        </p>
      )}
      {company.niche === "academia" && (
        <p className="industry-ops-note">
          Turmas e vagas continuam na agenda. O controle de planos nesta tela é
          administrativo: não cobra mensalidades nem integra catracas.
        </p>
      )}
      {company.niche === "pet-shop" && (
        <p className="industry-ops-note">
          As fichas registram identificação e serviços do pet, sem diagnóstico
          ou prontuário clínico.
        </p>
      )}
      {["restaurante", "salao"].includes(company.niche) &&
        !summaryError &&
        summary && (
          <section
            className="industry-ops-summary"
            aria-label="Resumo de caixa e comissões"
          >
            <article>
              <span>Entradas registradas</span>
              <strong>{money(summary.cash_in_cents)}</strong>
            </article>
            <article>
              <span>Saídas registradas</span>
              <strong>{money(summary.cash_out_cents)}</strong>
            </article>
            <article>
              <span>Saldo dos lançamentos</span>
              <strong>{money(summary.cash_net_cents)}</strong>
            </article>
            {company.niche === "salao" && (
              <>
                <article>
                  <span>Comissões pendentes</span>
                  <strong>{money(summary.commission_pending_cents)}</strong>
                </article>
                <article>
                  <span>Comissões pagas</span>
                  <strong>{money(summary.commission_paid_cents)}</strong>
                </article>
              </>
            )}
            <p>
              Valores somam apenas os lançamentos manuais registrados; não há
              conciliação bancária.
            </p>
          </section>
        )}

      <section
        className="industry-ops-list"
        aria-labelledby="industry-ops-list-title"
      >
        <div className="industry-ops-heading">
          <div>
            <span className="operations-icon">
              <Icon name="layout" size={18} />
            </span>
            <h2 id="industry-ops-list-title">Registros recentes</h2>
          </div>
          <span className="operations-count">
            {error
              ? "Indisponível"
              : `${rows.length} registro${rows.length === 1 ? "" : "s"} nesta página`}
          </span>
        </div>
        {!error && rows.length === 0 ? (
          <EmptyState
            icon="briefcase"
            title="Sua operação começa aqui"
            description="Crie o primeiro registro específico do seu negócio. Nenhum dado de demonstração será misturado aos seus cadastros."
          />
        ) : (
          !error && (
            <div className="industry-ops-cards">
              {rows.map((row) => {
                const next = operationTransitions(row.kind, row.status);
                return (
                  <article className="industry-op-card" key={row.id}>
                    <div className="industry-op-card-top">
                      <div>
                        <span className="industry-op-type">
                          {labelByKind.get(row.kind as IndustryOperationKind) ??
                            "Operação"}
                        </span>
                        <h3>{row.name}</h3>
                      </div>
                      <span
                        className={`industry-op-status status-${row.status}`}
                      >
                        {statusText(row.kind, row.status)}
                      </span>
                    </div>
                    <dl>
                      {row.reference && (
                        <div>
                          <dt>Referência</dt>
                          <dd>{referenceText(row.kind, row.reference)}</dd>
                        </div>
                      )}
                      {row.phone && (
                        <div>
                          <dt>Telefone</dt>
                          <dd>{row.phone}</dd>
                        </div>
                      )}
                      {row.quantity !== null && (
                        <div>
                          <dt>
                            {row.kind === "restaurant_table"
                              ? "Lugares"
                              : "Quantidade"}
                          </dt>
                          <dd>
                            {row.quantity}
                            {row.unit ? ` ${row.unit}` : ""}
                          </dd>
                        </div>
                      )}
                      {row.amount_cents !== null && (
                        <div>
                          <dt>Valor</dt>
                          <dd>{money(row.amount_cents)}</dd>
                        </div>
                      )}
                      {row.due_at && (
                        <div>
                          <dt>Data</dt>
                          <dd>{dateTime(row.due_at)}</dd>
                        </div>
                      )}
                      {row.kind === "restaurant_order" &&
                        !["paid", "cancelled"].includes(row.status) && (
                          <div>
                            <dt>Tempo desde a abertura</dt>
                            <dd>{elapsedMinutes(row.created_at)}</dd>
                          </div>
                        )}
                    </dl>
                    {row.details && (
                      <p className="industry-op-details">{row.details}</p>
                    )}
                    {row.kind === "restaurant_order" && (
                      <PrintOrderButton
                        companyName={company.name}
                        orderName={row.name}
                        tableName={referenceText(row.kind, row.reference)}
                        details={row.details}
                        status={statusText(row.kind, row.status)}
                        amountCents={row.amount_cents}
                        openedAt={row.created_at}
                      />
                    )}
                    {row.location_url && (
                      <a
                        className="industry-op-map"
                        href={row.location_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Icon name="map-pin" size={15} /> Abrir localização ou
                        documento <Icon name="arrow-up-right" size={14} />
                      </a>
                    )}
                    {["pet_stock", "salon_stock"].includes(row.kind) && (
                      <>
                        <form
                          action={adjustIndustryStock}
                          className="industry-op-stock-form"
                        >
                          <input
                            type="hidden"
                            name="company_id"
                            value={companyId}
                          />
                          <input type="hidden" name="id" value={row.id} />
                          <input
                            type="hidden"
                            name="version"
                            value={row.record_version}
                          />
                          <label htmlFor={`delta-${row.id}`}>
                            Entrada (+) ou baixa (−)
                          </label>
                          <div>
                            <input
                              id={`delta-${row.id}`}
                              name="delta"
                              type="number"
                              step="1"
                              min={-1000000}
                              max={1000000}
                              required
                              aria-label="Quantidade de entrada ou baixa"
                            />
                            <input
                              name="reason"
                              type="text"
                              minLength={2}
                              maxLength={160}
                              placeholder="Motivo do ajuste"
                              required
                              aria-label="Motivo do ajuste de estoque"
                            />
                          </div>
                          <small>
                            O saldo não pode ficar negativo. Alterações ficam no
                            histórico.
                          </small>
                          <PendingButton>
                            Atualizar estoque <Icon name="check" size={15} />
                          </PendingButton>
                        </form>
                        {(movementsByRecord.get(row.id) ?? []).slice(0, 3)
                          .length > 0 && (
                          <ul
                            className="industry-op-stock-history"
                            aria-label="Movimentações recentes do estoque"
                          >
                            {(movementsByRecord.get(row.id) ?? [])
                              .slice(0, 3)
                              .map((movement) => (
                                <li key={movement.id}>
                                  <strong>
                                    {movement.delta > 0 ? "+" : ""}
                                    {movement.delta} {row.unit}
                                  </strong>
                                  <span>{movement.reason}</span>
                                  <time dateTime={movement.created_at}>
                                    {dateTime(movement.created_at)}
                                  </time>
                                </li>
                              ))}
                          </ul>
                        )}
                      </>
                    )}
                    {next.length > 0 && (
                      <form
                        action={changeIndustryOperationStatus}
                        className="industry-op-status-form"
                      >
                        <input
                          type="hidden"
                          name="company_id"
                          value={companyId}
                        />
                        <input type="hidden" name="id" value={row.id} />
                        <input
                          type="hidden"
                          name="version"
                          value={row.record_version}
                        />
                        <label htmlFor={`next-${row.id}`}>Próxima etapa</label>
                        <select
                          id={`next-${row.id}`}
                          name="status"
                          defaultValue=""
                          required
                        >
                          <option value="" disabled>
                            Escolha uma etapa
                          </option>
                          {next.map((status) => (
                            <option key={status} value={status}>
                              {statusText(row.kind, status)}
                            </option>
                          ))}
                        </select>
                        <PendingButton>
                          Atualizar etapa <Icon name="arrow-right" size={15} />
                        </PendingButton>
                      </form>
                    )}
                  </article>
                );
              })}
            </div>
          )
        )}
        {!error && (hasPrevious || hasNext) && (
          <nav
            className="industry-ops-pagination"
            aria-label="Paginação dos registros"
          >
            {hasPrevious && rows[0] ? (
              <Link
                href={operationsPageHref(companyId, "before", rows[0])}
                rel="prev"
              >
                Mais recentes
              </Link>
            ) : (
              <span aria-disabled="true">Mais recentes</span>
            )}
            {hasNext && rows.at(-1) ? (
              <Link
                href={operationsPageHref(companyId, "after", rows.at(-1)!)}
                rel="next"
              >
                Mais antigos
              </Link>
            ) : (
              <span aria-disabled="true">Mais antigos</span>
            )}
          </nav>
        )}
      </section>

      <section
        className="industry-ops-create"
        aria-labelledby="industry-ops-create-title"
      >
        <div className="industry-ops-heading">
          <div>
            <span className="operations-icon">
              <Icon name="plus" size={18} />
            </span>
            <h2 id="industry-ops-create-title">Novo registro</h2>
          </div>
        </div>
        <p className="industry-ops-create-intro">
          Escolha o tipo de controle. O sistema aplica etapas e campos próprios
          para cada rotina.
        </p>
        <div className="industry-ops-forms">
          {definitions.map((definition) => (
            <details className="industry-op-form-card" key={definition.kind}>
              <summary>
                <span className="operations-icon">
                  <Icon name={definition.icon} size={17} />
                </span>
                <span>
                  <strong>{definition.label}</strong>
                  <small>
                    Adicionar {definition.label.toLocaleLowerCase("pt-BR")}
                  </small>
                </span>
                <Icon name="chevron-down" size={17} />
              </summary>
              <form
                action={createIndustryOperation}
                className="industry-op-form"
              >
                <input type="hidden" name="company_id" value={companyId} />
                <input type="hidden" name="kind" value={definition.kind} />
                <label htmlFor={`name-${definition.kind}`}>
                  {definition.nameLabel}
                </label>
                <input
                  id={`name-${definition.kind}`}
                  name="name"
                  required
                  minLength={2}
                  maxLength={120}
                />
                {definition.fields.map((field) => {
                  const spec = fieldSpecs[field];
                  const id = `${field}-${definition.kind}`;
                  const required = [
                    "reference",
                    "phone",
                    "capacity",
                    "quantity",
                    "unit",
                    "amount",
                    "due",
                  ].includes(field);
                  const relationRequired =
                    field === "related" &&
                    definition.kind !== "logistics_delivery";
                  const relatedKind =
                    definition.kind === "restaurant_order"
                      ? "restaurant_table"
                      : definition.kind === "logistics_route"
                        ? "logistics_driver"
                        : definition.kind === "logistics_delivery"
                          ? "logistics_route"
                          : definition.kind === "pet_visit"
                            ? "pet_profile"
                            : null;
                  const matchingRelatedRows = relatedKind
                    ? relationRecords.filter(
                        (row) =>
                          row.kind === relatedKind &&
                          (definition.kind === "restaurant_order"
                            ? ["available", "reserved"].includes(row.status)
                            : definition.kind === "logistics_route"
                              ? row.status === "available"
                              : definition.kind === "logistics_delivery"
                                ? ["planned", "in_progress"].includes(
                                    row.status,
                                  )
                                : row.status === "active"),
                      )
                    : [];
                  return (
                    <div className="industry-op-field" key={field}>
                      <label htmlFor={id}>
                        {fieldLabel(definition.kind, field, spec.label)}
                      </label>
                      {field === "related" ? (
                        <select
                          id={id}
                          name="related_operation_id"
                          required={relationRequired}
                          defaultValue=""
                        >
                          <option value="">
                            {relationRequired
                              ? "Selecione um registro"
                              : "Sem rota vinculada"}
                          </option>
                          {matchingRelatedRows.map((related) => (
                            <option key={related.id} value={related.id}>
                              {related.name}
                              {related.kind === "restaurant_table" &&
                              related.quantity !== null
                                ? ` · ${related.quantity} lugares`
                                : ""}
                            </option>
                          ))}
                        </select>
                      ) : field === "reference" &&
                        ["restaurant_cash", "salon_cash"].includes(
                          definition.kind,
                        ) ? (
                        <select id={id} name={field} required>
                          <option value="">Selecione</option>
                          <option value="entrada">Entrada</option>
                          <option value="saida">Saída</option>
                        </select>
                      ) : spec.type === "textarea" ? (
                        <textarea
                          id={id}
                          name={field}
                          maxLength={1200}
                          rows={3}
                          placeholder={spec.placeholder}
                          required={required}
                        />
                      ) : (
                        <input
                          id={id}
                          name={field}
                          type={spec.type ?? "text"}
                          inputMode={
                            field === "amount"
                              ? "decimal"
                              : field === "phone"
                                ? "tel"
                                : undefined
                          }
                          min={
                            field === "capacity"
                              ? 1
                              : field === "quantity"
                                ? 0
                                : undefined
                          }
                          max={
                            field === "capacity"
                              ? 50
                              : field === "quantity"
                                ? 1000000
                                : undefined
                          }
                          maxLength={
                            field === "phone"
                              ? 20
                              : field === "location"
                                ? 500
                                : undefined
                          }
                          placeholder={spec.placeholder}
                          required={required}
                        />
                      )}
                      {field === "location" &&
                        definition.kind !== "office_document" && (
                          <small>Aceita links oficiais do Google Maps.</small>
                        )}
                      {field === "location" &&
                        definition.kind === "office_document" && (
                          <small>
                            O arquivo fica no serviço de armazenamento da sua
                            escolha; aqui salvamos apenas o link HTTPS.
                          </small>
                        )}
                    </div>
                  );
                })}
                <PendingButton>
                  Salvar {definition.label.toLocaleLowerCase("pt-BR")}{" "}
                  <Icon name="check" size={15} />
                </PendingButton>
              </form>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
