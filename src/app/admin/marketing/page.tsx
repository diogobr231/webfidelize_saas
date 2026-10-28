import Link from "next/link";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireOperationsAdmin } from "@/lib/admin-operations";
import { AdminNavigation } from "@/components/admin/navigation";
import { Icon } from "@/components/ui/icon";
import { EmptyState } from "@/components/ui/empty-state";
import {
  CampaignForm,
  CopyText,
  DownloadArt,
  MarketingActionForm,
  ReplyBuilder,
} from "@/components/marketing/forms";
import {
  buildMarketingLink,
  marketingCampaignRecordSchema,
  marketingChannelLabels,
  marketingGoalLabels,
  marketingStatusLabels,
  marketingStatuses,
} from "@/lib/marketing";
import { money } from "@/lib/catalog";
import {
  saveMarketingCampaign,
  changeMarketingStatus,
  generateMarketingText,
} from "./actions";
import "../admin.css";
import "./marketing.css";

export const dynamic = "force-dynamic";
const fields =
  "id,request_id,name,channel,goal,niche,audience,brief,budget_cents,headline,body,cta,status,version,created_at,updated_at";
const notices: Record<string, string> = {
  salvo: "Campanha salva. Alterar o conteúdo devolve a campanha ao rascunho.",
  status:
    "Revisão interna atualizada. Nenhum anúncio ou publicação foi ativado.",
  ia: "Novo texto de IA salvo como rascunho. Revise os fatos antes de aprovar.",
};
const generationLabels: Record<string, string> = {
  reserved: "Em andamento ou resultado ainda desconhecido",
  succeeded: "Texto salvo",
  failed: "Falhou",
  stale: "Campanha mudou; texto preservado",
};

export default async function Marketing({
  searchParams,
}: {
  searchParams: Promise<{
    id?: string;
    status?: string;
    pagina?: string;
    aviso?: string;
  }>;
}) {
  const { db } = await requireOperationsAdmin();
  const params = await searchParams;
  const selectedId = z.uuid().safeParse(params.id);
  const status = z.enum(marketingStatuses).safeParse(params.status);
  const page = /^\d{1,4}$/.test(params.pagina ?? "")
    ? Math.max(1, Number(params.pagina))
    : 1;
  let query = db
    .from("platform_marketing_campaigns")
    .select(fields, { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * 12, page * 12 - 1);
  if (status.success) query = query.eq("status", status.data);
  const [list, selectedResult, usage, history] = await Promise.all([
    query,
    selectedId.success
      ? db
          .from("platform_marketing_campaigns")
          .select(fields)
          .eq("id", selectedId.data)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db
      .from("platform_marketing_generations")
      .select("id,status,created_at,error_code")
      .order("created_at", { ascending: false })
      .limit(10),
    selectedId.success
      ? db
          .from("platform_marketing_events")
          .select("id,kind,created_at")
          .eq("campaign_id", selectedId.data)
          .order("created_at", { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const parsedList = z
    .array(marketingCampaignRecordSchema)
    .safeParse(list.data ?? []);
  const rows = parsedList.success ? parsedList.data : [];
  const parsed = marketingCampaignRecordSchema.safeParse(selectedResult.data);
  const campaign = parsed.success ? parsed.data : undefined;
  const unavailable = Boolean(
    list.error ||
      !parsedList.success ||
      selectedResult.error ||
      (selectedId.success && selectedResult.data && !parsed.success),
  );
  let origin: string | null = null;
  let link: string | null = null;
  try {
    const configured = process.env.APP_URL ?? "";
    buildMarketingLink(
      {
        id: randomUUID(),
        name: "Verificar origem",
        channel: "instagram",
        goal: "trial",
        niche: "all",
      },
      configured,
    );
    origin = configured;
    if (campaign) link = buildMarketingLink(campaign, configured);
  } catch {
    /* Fail closed rather than derive a destination from Host headers. */
  }
  const pageHref = (target: number) =>
    `/admin/marketing?${new URLSearchParams({ pagina: String(target), ...(status.success ? { status: status.data } : {}) })}#campanhas`;
  const transitions: Record<string, { value: string; label: string }[]> = {
    draft: [
      { value: "review", label: "Enviar para revisão" },
      { value: "archived", label: "Arquivar" },
    ],
    review: [
      { value: "approved", label: "Aprovar internamente" },
      { value: "draft", label: "Voltar ao rascunho" },
      { value: "archived", label: "Arquivar" },
    ],
    approved: [
      { value: "draft", label: "Reabrir rascunho" },
      { value: "archived", label: "Arquivar" },
    ],
    archived: [{ value: "draft", label: "Restaurar rascunho" }],
  };
  const eventLabels: Record<string, string> = {
    created: "Campanha criada",
    updated: "Conteúdo atualizado",
    status_changed: "Revisão alterada",
    ai_draft: "Rascunho de IA salvo",
  };
  return (
    <main className="admin-shell mk-page">
      <a className="workspace-skip-link" href="#marketing-content">
        Ir para o conteúdo
      </a>
      <AdminNavigation current="marketing" />
      <div id="marketing-content" className="admin-content">
        <header className="mk-hero">
          <div>
            <span className="tag">CRESCIMENTO DA WEB FIDELIZE</span>
            <h1>Uma boa campanha começa com clareza.</h1>
            <p>
              Prepare o conteúdo, escolha para onde levar as pessoas e revise
              cada campanha da própria Web Fidelize.
            </p>
          </div>
          <Link className="button" href="/admin/marketing#editor">
            <Icon name="plus" size={16} /> Nova campanha
          </Link>
        </header>
        <nav className="mk-actions" aria-label="Seções de marketing">
          <a href="#campanhas">
            <Icon name="layout" size={16} /> Campanhas
          </a>
          <a href="#editor">
            <Icon name="plus" size={16} /> Conteúdo e arte
          </a>
          <a href="#respostas">
            <Icon name="mail" size={16} /> Respostas
          </a>
          <a href="#integracoes">
            <Icon name="link" size={16} /> Canais
          </a>
        </nav>
        {params.aviso && notices[params.aviso] && (
          <p className="mk-feedback" role="status">
            {notices[params.aviso]}
          </p>
        )}
        {unavailable && (
          <p className="notice error" role="alert">
            Não foi possível carregar as campanhas. Atualize a página; não
            exibiremos dados de exemplo como resultados.
          </p>
        )}
        <p className="mk-notice">
          Este espaço organiza campanhas e orçamento planejado. Aprovação aqui é
          interna. Publicação, anúncios pagos e respostas automáticas ainda
          dependem da conexão com as plataformas.
        </p>
        <div className="mk-layout">
          <section
            className="mk-panel"
            id="campanhas"
            aria-labelledby="campaigns-title"
          >
            <span className="tag">DA IDEIA À REVISÃO</span>
            <h2 id="campaigns-title">Suas campanhas</h2>
            <form action="/admin/marketing" className="mk-form">
              <label htmlFor="marketing-filter">
                Situação
                <select
                  id="marketing-filter"
                  name="status"
                  defaultValue={status.success ? status.data : "all"}
                >
                  <option value="all">Todas</option>
                  {marketingStatuses.map((value) => (
                    <option key={value} value={value}>
                      {marketingStatusLabels[value]}
                    </option>
                  ))}
                </select>
              </label>
              <button className="button secondary" type="submit">
                Aplicar filtro
              </button>
            </form>
            {!unavailable && rows.length === 0 && (
              <EmptyState
                icon="sparkles"
                title="Sua próxima campanha começa aqui"
                description="Crie um rascunho com público, objetivo e orçamento planejado. Nenhum gasto será realizado."
              />
            )}
            <div className="mk-campaign-list">
              {rows.map((row) => (
                <article className="mk-card" key={row.id}>
                  <span className="mk-status">
                    {marketingStatusLabels[row.status]}
                  </span>
                  <h3>
                    <Link href={`/admin/marketing?id=${row.id}#editor`}>
                      {row.name}
                    </Link>
                  </h3>
                  <p>
                    {marketingChannelLabels[row.channel]} ·{" "}
                    {marketingGoalLabels[row.goal]}
                  </p>
                  <p>
                    Orçamento planejado:{" "}
                    <strong>{money(row.budget_cents)}</strong>
                  </p>
                  <Link href={`/admin/marketing?id=${row.id}#editor`}>
                    Abrir campanha →
                  </Link>
                </article>
              ))}
            </div>
            {!list.error && (
              <nav className="mk-actions" aria-label="Páginas das campanhas">
                {page > 1 && <Link href={pageHref(page - 1)}>Anterior</Link>}
                <span>
                  Página {page} · {list.count ?? 0} campanhas
                </span>
                {(list.count ?? 0) > page * 12 && (
                  <Link href={pageHref(page + 1)}>Próxima</Link>
                )}
              </nav>
            )}
          </section>
          <section
            className="mk-panel"
            id="editor"
            aria-labelledby="editor-title"
          >
            <span className="tag">CONTEÚDO COM A SUA IDENTIDADE</span>
            <h2 id="editor-title">
              {campaign ? campaign.name : "Preparar uma campanha"}
            </h2>
            {selectedId.success && !campaign && !selectedResult.error ? (
              <p role="alert">
                A campanha solicitada não foi encontrada.{" "}
                <Link href="/admin/marketing#editor">Criar campanha</Link>
              </p>
            ) : null}
            {campaign && (
              <p className="mk-status">
                {marketingStatusLabels[campaign.status]} · versão{" "}
                {campaign.version}
              </p>
            )}
            {!unavailable &&
              (!selectedId.success || campaign) &&
              campaign?.status !== "archived" && (
                <CampaignForm
                  key={campaign ? `${campaign.id}:${campaign.version}` : "new"}
                  campaign={campaign}
                  requestId={campaign?.request_id ?? randomUUID()}
                  action={saveMarketingCampaign}
                />
              )}
            {campaign && (
              <>
                <div className="mk-actions">
                  {transitions[campaign.status].map((item) => (
                    <MarketingActionForm
                      key={item.value}
                      action={changeMarketingStatus}
                      submitLabel={item.label}
                    >
                      <input name="id" type="hidden" value={campaign.id} />
                      <input
                        name="version"
                        type="hidden"
                        value={campaign.version}
                      />
                      <input name="status" type="hidden" value={item.value} />
                    </MarketingActionForm>
                  ))}
                </div>
                {link ? (
                  <div className="mk-note">
                    <h3>Link desta campanha</h3>
                    <p className="mk-url">{link}</p>
                    <CopyText text={link} label="Copiar link da campanha" />
                    <p className="mk-hint">
                      Os parâmetros identificam a origem no endereço. Esta
                      central ainda não mede cliques ou conversões.
                    </p>
                  </div>
                ) : (
                  <p role="alert">
                    Configure a origem pública da aplicação para gerar links.
                  </p>
                )}
                <div className="mk-preview">
                  <h3>Kit para publicar</h3>
                  <p>
                    Baixe o texto e uma arte de modelo gráfico. Confira a
                    legibilidade, os recursos e as condições antes de usar. A
                    arte não é uma imagem gerada por IA.
                  </p>
                  {campaign.headline && (
                    <img
                      src={`/admin/marketing/${campaign.id}/arte`}
                      alt={`Prévia da arte: ${campaign.headline}`}
                      width={1080}
                      height={1350}
                      style={{
                        width: "100%",
                        maxWidth: 360,
                        height: "auto",
                        borderRadius: 16,
                        display: "block",
                        margin: "18px 0",
                      }}
                    />
                  )}
                  <div className="mk-actions">
                    <Link
                      className="button secondary"
                      href={`/admin/marketing/${campaign.id}/exportar`}
                    >
                      Baixar texto e planejamento
                    </Link>
                    {campaign.headline && (
                      <>
                        <DownloadArt
                          url={`/admin/marketing/${campaign.id}/arte`}
                        />
                        <a
                          className="button secondary"
                          href={`/admin/marketing/${campaign.id}/arte`}
                          download
                        >
                          Baixar arte SVG
                        </a>
                      </>
                    )}
                  </div>
                  {(campaign.headline || campaign.body) && (
                    <CopyText
                      text={`${campaign.headline}\n\n${campaign.body}\n\n${campaign.cta}${link ? `\n${link}` : ""}`}
                      label="Copiar anúncio completo"
                    />
                  )}
                </div>
                {campaign.status !== "archived" && (
                  <details className="mk-note">
                    <summary>Gerar outro texto com IA</summary>
                    <p>
                      Usa o conteúdo salvo e o catálogo atual. O resultado
                      substitui o texto salvo e volta a rascunho. Pode consumir
                      créditos no AI Gateway. Limite compartilhado: 10
                      tentativas por dia e 100 por mês; falhas contam. Não gera
                      imagem nem envia conteúdo.
                    </p>
                    <MarketingActionForm
                      action={generateMarketingText}
                      submitLabel="Gerar rascunho com IA"
                      pendingLabel="Gerando e salvando…"
                    >
                      <input name="id" type="hidden" value={campaign.id} />
                      <input
                        name="version"
                        type="hidden"
                        value={campaign.version}
                      />
                      <label>
                        <input
                          type="checkbox"
                          name="confirm_generation"
                          value="yes"
                          required
                        />{" "}
                        Entendo o consumo de créditos e quero substituir o texto
                        salvo.
                      </label>
                    </MarketingActionForm>
                    <a
                      href="https://vercel.com/diogobr231/~/ai-gateway"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Abrir AI Gateway na Vercel ↗
                    </a>
                  </details>
                )}
                <details className="mk-note">
                  <summary>Histórico desta campanha</summary>
                  {history.error ? (
                    <p role="alert">Histórico indisponível.</p>
                  ) : (
                    <ul>
                      {history.data?.map((event) => (
                        <li key={event.id}>
                          {eventLabels[event.kind] ?? "Alteração interna"} ·{" "}
                          {new Date(event.created_at).toLocaleString("pt-BR", {
                            timeZone: "America/Sao_Paulo",
                          })}
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              </>
            )}
          </section>
        </div>
        <section id="respostas" aria-label="Respostas sugeridas">
          {origin ? (
            <ReplyBuilder origin={origin} />
          ) : (
            <p className="notice error">
              A origem pública precisa ser configurada para preparar respostas
              com links.
            </p>
          )}
        </section>
        <section
          className="mk-panel"
          id="integracoes"
          aria-labelledby="integrations-title"
        >
          <span className="tag">OS PRÓXIMOS PASSOS DA DIVULGAÇÃO</span>
          <h2 id="integrations-title">Canais, publicação e tráfego pago</h2>
          <div className="mk-grid">
            <article className="mk-card">
              <h3>Conteúdo nas redes</h3>
              <span className="mk-status">Integração no SaaS pendente</span>
              <p>
                Seu texto e sua arte estão disponíveis para download. Agendar e
                publicar pelo sistema exige conectar uma conta profissional e
                obter as permissões da plataforma.
              </p>
              <a
                className="button secondary"
                href="https://business.facebook.com/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Abrir Meta Business Suite ↗
              </a>
            </article>
            <article className="mk-card">
              <h3>Anúncios pagos</h3>
              <span className="mk-status">
                Nenhuma campanha paga ativada por esta central
              </span>
              <p>
                O orçamento salvo é um planejamento. Ativar anúncios, alterar
                gastos e medir resultados exige uma conta de anúncios conectada
                e limites de investimento aprovados.
              </p>
              <a
                className="button secondary"
                href="https://adsmanager.facebook.com/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Abrir Gerenciador de Anúncios ↗
              </a>
            </article>
            <article className="mk-card">
              <h3>Directs e comentários</h3>
              <span className="mk-status">Sem envio automático</span>
              <p>
                Use os modelos para revisar e copiar uma resposta. Automação de
                atendimento exige conexão, permissões de mensagens/comentários,
                regras de horário e encaminhamento para atendimento humano.
              </p>
              <a href="#respostas">Preparar resposta com link →</a>
            </article>
            <article className="mk-card">
              <h3>Integrações na conversa</h3>
              <p>
                Windsor.ai e Metricool podem ajudar com contas conectadas na
                conversa. A conexão desses plugins não cria uma integração
                permanente no backend da Web Fidelize.
              </p>
              <a
                href="https://windsor.ai/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Conhecer Windsor.ai ↗
              </a>
              <br />
              <a
                href="https://metricool.com/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Conhecer Metricool ↗
              </a>
            </article>
          </div>
        </section>
        <details className="mk-panel">
          <summary>Últimas tentativas de geração de texto</summary>
          {usage.error ? (
            <p role="alert">Não foi possível carregar as tentativas.</p>
          ) : !usage.data?.length ? (
            <p>Nenhuma tentativa registrada.</p>
          ) : (
            <ul>
              {usage.data.map((item) => (
                <li key={item.id}>
                  {new Date(item.created_at).toLocaleString("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                  })}{" "}
                  · {generationLabels[item.status] ?? "Consultar estado"}
                  {item.error_code
                    ? " · Consulte a configuração antes de repetir."
                    : ""}
                </li>
              ))}
            </ul>
          )}
        </details>
      </div>
    </main>
  );
}
