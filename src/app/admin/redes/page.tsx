import Link from "next/link";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireOperationsAdmin } from "@/lib/admin-operations";
import { AdminNavigation } from "@/components/admin/navigation";
import { Icon } from "@/components/ui/icon";
import { SocialPhoto } from "@/components/social/photo";
import {
  SocialAction,
  SocialSubmit,
  PostEditor,
} from "@/components/social/forms";
import {
  accountFields,
  postFields,
  socialAccountSchema,
  socialPostSchema,
  postStatusLabels,
  adPlanSchema,
} from "@/lib/social/core";
import { socialConfiguration } from "@/lib/social/server";
import { money } from "@/lib/catalog";
import {
  connectSocialAccount,
  generateSocialCaption,
  revokeSocialAccount,
  saveAdPlan,
  transitionSocialPost,
} from "./actions";
import "../admin.css";
import "./social.css";
export const dynamic = "force-dynamic";
export const metadata = { title: "Serviços dos clientes | Web Fidelize" };
const notices: Record<string, string> = {
  salvo: "Rascunho salvo. Confira a foto e a legenda antes de programar.",
  ia: "Legenda e hashtags geradas e salvas. Revise antes de publicar.",
  conectado: "Conta conectada à empresa selecionada.",
  "conexao-falhou":
    "Conexão não confirmada. Confira permissões, ID da página e a conta profissional vinculada.",
};

export default async function SocialPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { db } = await requireOperationsAdmin(),
    params = await searchParams;
  const companyId = z.uuid().safeParse(params.empresa),
    postId = z.uuid().safeParse(params.post);
  const tab = z
    .enum(["conteudo", "trafego", "contas"])
    .catch("conteudo")
    .parse(params.guia);
  const page = /^\d{1,4}$/.test(params.pagina ?? "")
    ? Math.max(1, Number(params.pagina))
    : 1;
  const search = (params.busca ?? "").trim().slice(0, 100);
  const config = socialConfiguration();
  const href = (extra: Record<string, string>) =>
    `/admin/redes?${new URLSearchParams({ ...(companyId.success ? { empresa: companyId.data } : {}), guia: tab, ...extra })}`;
  if (!companyId.success) {
    let query = db
      .from("companies")
      .select("id,name", { count: "exact" })
      .order("name")
      .order("id")
      .range((page - 1) * 25, page * 25 - 1);
    if (search)
      query = query.ilike("name", `%${search.replace(/[\\%_]/g, "\\$&")}%`);
    const list = await query;
    return (
      <main className="admin-shell social-page">
        <AdminNavigation current="social" />
        <div className="admin-content">
          <header className="social-heading">
            <span className="tag">OPERAÇÃO POR EMPRESA</span>
            <h1>Serviços dos clientes</h1>
            <p>
              Agenda, conteúdo, tráfego e fotografia. Comece pela empresa que
              vai atender.
            </p>
          </header>
          <form className="social-search" method="get">
            <label htmlFor="social-search">Buscar empresa</label>
            <div className="social-actions">
              <input
                id="social-search"
                name="busca"
                defaultValue={search}
                placeholder="Nome do espaço"
              />
              <button type="submit">
                <Icon name="search" size={17} />
                Buscar
              </button>
            </div>
          </form>
          {list.error ? (
            <p role="alert" className="social-error">
              Não foi possível consultar as empresas. Tente novamente.
            </p>
          ) : (
            <>
              <p>{list.count ?? 0} empresas encontradas</p>
              <div className="social-company-grid">
                {list.data?.map((company) => (
                  <Link
                    key={company.id}
                    href={`/admin/redes?empresa=${company.id}`}
                    className="social-company"
                  >
                    <Icon name="building" />
                    <strong>{company.name}</strong>
                    <Icon name="arrow-right" size={17} />
                  </Link>
                ))}
              </div>
              {!list.data?.length && (
                <p>Nenhuma empresa corresponde à busca.</p>
              )}
              <nav className="social-actions" aria-label="Páginas de empresas">
                {page > 1 && (
                  <Link
                    href={href({ busca: search, pagina: String(page - 1) })}
                  >
                    Anterior
                  </Link>
                )}
                {page * 25 < (list.count ?? 0) && (
                  <Link
                    href={href({ busca: search, pagina: String(page + 1) })}
                  >
                    Próximas empresas
                  </Link>
                )}
              </nav>
            </>
          )}
        </div>
      </main>
    );
  }
  const company = await db
    .from("companies")
    .select("id,name,booking_slug")
    .eq("id", companyId.data)
    .maybeSingle();
  if (company.error || !company.data)
    return (
      <main className="admin-shell social-page">
        <AdminNavigation current="social" />
        <div className="admin-content">
          <p role="alert">Empresa indisponível.</p>
          <Link href="/admin/redes">Escolher outra empresa</Link>
        </div>
      </main>
    );
  const [accountsResult, postsResult, selectedResult, adsResult] =
    await Promise.all([
      db
        .from("platform_social_accounts")
        .select(accountFields)
        .eq("company_id", companyId.data)
        .order("label"),
      tab === "conteudo"
        ? db
            .from("platform_social_posts")
            .select(postFields, { count: "exact" })
            .eq("company_id", companyId.data)
            .order("created_at", { ascending: false })
            .order("id")
            .range((page - 1) * 20, page * 20 - 1)
        : Promise.resolve({ data: [], error: null, count: 0 }),
      tab === "conteudo" && postId.success
        ? db
            .from("platform_social_posts")
            .select(postFields)
            .eq("id", postId.data)
            .eq("company_id", companyId.data)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      tab === "trafego"
        ? db
            .from("platform_ad_plans")
            .select("*")
            .eq("company_id", companyId.data)
            .order("created_at", { ascending: false })
            .range((page - 1) * 20, page * 20 - 1)
        : Promise.resolve({ data: [], error: null }),
    ]);
  const accounts = z
      .array(socialAccountSchema)
      .safeParse(accountsResult.data ?? []),
    posts = z.array(socialPostSchema).safeParse(postsResult.data ?? []);
  const selected = socialPostSchema.safeParse(selectedResult.data),
    post = selected.success ? selected.data : undefined;
  const missing =
    accountsResult.error ||
    postsResult.error ||
    selectedResult.error ||
    adsResult.error ||
    !accounts.success ||
    !posts.success;
  const locked =
    post &&
    ["scheduled", "publishing", "published", "unknown"].includes(post.status);
  return (
    <main className="admin-shell social-page">
      <a className="workspace-skip-link" href="#social-content">
        Ir para o conteúdo
      </a>
      <AdminNavigation current="social" />
      <div id="social-content" className="admin-content">
        <header className="social-heading">
          <Link href="/admin/redes" className="social-back">
            ← Trocar empresa
          </Link>
          <span className="tag">SERVIÇOS DOS CLIENTES</span>
          <h1>{company.data.name}</h1>
          <p>Você está operando os serviços desta empresa.</p>
        </header>
        <div className="social-module-strip">
          <span>
            <Icon name="calendar" />
            Agenda integrada
          </span>
          <span>
            <Icon name="sparkles" />
            Conteúdo
          </span>
          <span>
            <Icon name="briefcase" />
            Tráfego pago
          </span>
          <span>
            <Icon name="camera" />
            Fotografia mensal
          </span>
        </div>
        <nav className="social-tabs" aria-label="Etapas dos serviços">
          {[
            {
              id: "conteudo",
              label: "Posts e calendário",
              icon: "calendar" as const,
            },
            {
              id: "trafego",
              label: "Tráfego pago",
              icon: "briefcase" as const,
            },
            { id: "contas", label: "Contas e conexões", icon: "link" as const },
          ].map((item) => (
            <Link
              key={item.id}
              href={href({ guia: item.id })}
              aria-current={tab === item.id ? "page" : undefined}
            >
              <Icon name={item.icon} size={18} />
              {item.label}
            </Link>
          ))}
        </nav>
        {params.aviso && notices[params.aviso] && (
          <p role="status" className="social-success">
            {notices[params.aviso]}
          </p>
        )}
        {missing ? (
          <div className="social-error" role="alert">
            <h2>Operação indisponível</h2>
            <p>
              Não foi possível carregar os registros. Confira a implantação e a
              migração do módulo antes de tentar novamente.
            </p>
          </div>
        ) : (
          <>
            {tab === "conteudo" && (
              <>
                <section className="social-panel" id="editor">
                  <div className="social-section-heading">
                    <div>
                      <span className="social-eyebrow">
                        1 · FOTO E CONTEÚDO
                      </span>
                      <h2>{post ? post.title : "Prepare um novo post"}</h2>
                    </div>
                    {post && (
                      <Link className="button secondary" href={href({})}>
                        <Icon name="plus" size={17} />
                        Novo post
                      </Link>
                    )}
                  </div>
                  {postId.success && !post && (
                    <p role="alert" className="social-error">
                      Post não encontrado nesta empresa.
                    </p>
                  )}
                  {locked ? (
                    <div className="social-locked">
                      <strong>{postStatusLabels[post.status]}</strong>
                      <p>
                        O conteúdo está protegido contra alterações durante ou
                        após o envio. Para editar um agendado, cancele sua
                        autorização primeiro.
                      </p>
                    </div>
                  ) : (
                    <PostEditor
                      key={`${post?.id ?? "new"}:${post?.version ?? 0}`}
                      companyId={companyId.data}
                      postId={post?.id ?? randomUUID()}
                      post={post}
                      accounts={accounts.success ? accounts.data : []}
                    />
                  )}
                </section>
                {post && (
                  <div className="social-two social-step-panels">
                    <section className="social-panel">
                      <span className="social-eyebrow">2 · LEGENDA COM IA</span>
                      <h2>Uma base para você revisar</h2>
                      <SocialAction action={generateSocialCaption}>
                        <input type="hidden" name="id" value={post.id} />
                        <input
                          type="hidden"
                          name="version"
                          value={post.version}
                        />
                        <label>
                          O que precisa aparecer na legenda?
                          <textarea
                            name="brief"
                            minLength={10}
                            maxLength={1200}
                            rows={3}
                            required
                            placeholder="Descreva a oferta e o tom, sem dados sensíveis."
                          />
                        </label>
                        <label className="social-check">
                          <input
                            type="checkbox"
                            name="confirm_ai"
                            value="yes"
                            required
                          />
                          Autorizo enviar foto e briefing à IA e consumir
                          créditos do provedor.
                        </label>
                        <SocialSubmit
                          disabled={!config.ai || Boolean(locked)}
                          pendingLabel="Gerando legenda…"
                        >
                          Gerar legenda e #
                        </SocialSubmit>
                      </SocialAction>
                      <p className="social-note">
                        Até 5 hashtags. Limite global de 20 tentativas/dia e
                        300/mês. Arte genérica e edição generativa ainda não
                        estão disponíveis; claridade e recorte são ajustes
                        locais.
                      </p>
                    </section>
                    <section className="social-panel">
                      <span className="social-eyebrow">
                        3 · REVISÃO E AGENDAMENTO
                      </span>
                      <h2>{postStatusLabels[post.status]}</h2>
                      <p>
                        {post.scheduled_at
                          ? `${new Date(post.scheduled_at).toLocaleString("pt-BR", { timeZone: post.time_zone })} · ${post.time_zone}`
                          : "Salve um dia e horário no editor."}
                      </p>
                      <SocialAction action={transitionSocialPost}>
                        <input type="hidden" name="id" value={post.id} />
                        <input
                          type="hidden"
                          name="version"
                          value={post.version}
                        />
                        {post.status === "scheduled" ? (
                          <>
                            <input
                              type="hidden"
                              name="status"
                              value="cancelled"
                            />
                            <SocialSubmit>Cancelar autorização</SocialSubmit>
                          </>
                        ) : (
                          <>
                            <label>
                              Ação
                              <select name="status" defaultValue="planned">
                                <option value="planned">
                                  Planejar horário · não envia
                                </option>
                                <option
                                  value="scheduled"
                                  disabled={
                                    !config.publishing || !config.worker
                                  }
                                >
                                  Autorizar publicação automática
                                </option>
                                <option value="cancelled">
                                  Cancelar planejamento
                                </option>
                                <option value="draft">
                                  Voltar ao rascunho
                                </option>
                              </select>
                            </label>
                            <label className="social-check">
                              <input
                                type="checkbox"
                                name="confirm_publish"
                                value="yes"
                              />
                              Revisei foto, legenda, empresa e conta. Autorizo
                              publicar no horário salvo.
                            </label>
                            <SocialSubmit
                              disabled={[
                                "publishing",
                                "published",
                                "unknown",
                              ].includes(post.status)}
                            >
                              Aplicar ação
                            </SocialSubmit>
                          </>
                        )}
                      </SocialAction>
                      {(!config.publishing || !config.worker) && (
                        <p className="social-note">
                          Envio automático desativado. Configure e homologue a
                          conexão e o agendador em Contas e conexões.
                          Planejamentos continuam disponíveis.
                        </p>
                      )}
                      {post.provider_id && (
                        <p>
                          ID confirmado pela rede:{" "}
                          <code>{post.provider_id}</code>
                        </p>
                      )}
                    </section>
                  </div>
                )}
                <section className="social-panel">
                  <div className="social-section-heading">
                    <h2>Calendário editorial</h2>
                    <span>{postsResult.count ?? 0} posts · 20 por página</span>
                  </div>
                  <div className="social-post-list">
                    {posts.success &&
                      posts.data.map((row) => (
                        <Link
                          className="social-post-row"
                          key={row.id}
                          href={href({ post: row.id })}
                        >
                          {row.asset_path && (
                            <SocialPhoto
                              src={`/admin/redes/${row.id}/foto`}
                              alt=""
                              thumbnail
                            />
                          )}
                          <div>
                            <strong>{row.title}</strong>
                            <span>
                              {row.scheduled_at
                                ? `${new Date(row.scheduled_at).toLocaleString("pt-BR", { timeZone: row.time_zone })} · ${row.time_zone}`
                                : "Sem horário"}
                            </span>
                            <small>{postStatusLabels[row.status]}</small>
                          </div>
                          <Icon name="chevron-right" size={18} />
                        </Link>
                      ))}
                  </div>
                  {posts.success && !posts.data.length && (
                    <p>
                      Ainda não há posts. Anexe a primeira foto para começar.
                    </p>
                  )}
                  <nav className="social-actions" aria-label="Páginas de posts">
                    {page > 1 && (
                      <Link href={href({ pagina: String(page - 1) })}>
                        Anterior
                      </Link>
                    )}
                    {page * 20 < (postsResult.count ?? 0) && (
                      <Link href={href({ pagina: String(page + 1) })}>
                        Próximos posts
                      </Link>
                    )}
                  </nav>
                </section>
              </>
            )}
            {tab === "trafego" && (
              <>
                <section className="social-panel">
                  <span className="social-eyebrow">
                    TRÁFEGO PAGO · PLANEJAMENTO
                  </span>
                  <h2>Defina quanto vai para os anúncios</h2>
                  <p>
                    Mensalidade de gestão e verba de mídia são valores
                    separados. Este formulário salva o planejamento; ativação,
                    pausa e pagamento são feitos no Gerenciador de Anúncios.
                  </p>
                  <SocialAction action={saveAdPlan}>
                    <input type="hidden" name="id" value={randomUUID()} />
                    <input
                      type="hidden"
                      name="company_id"
                      value={companyId.data}
                    />
                    <input type="hidden" name="version" value="" />
                    <div className="social-two">
                      <label>
                        Nome da campanha
                        <input
                          name="name"
                          minLength={3}
                          maxLength={100}
                          required
                        />
                      </label>
                      <label>
                        Objetivo
                        <select name="objective">
                          <option value="traffic">
                            Visitas ao site/agenda
                          </option>
                          <option value="leads">Contatos</option>
                          <option value="awareness">Reconhecimento</option>
                        </select>
                      </label>
                      <label>
                        ID da conta de anúncios
                        <input
                          name="ad_account_id"
                          pattern="[0-9]{5,30}"
                          inputMode="numeric"
                          required
                        />
                      </label>
                      <label>
                        Verba de mídia do período (R$)
                        <input
                          name="media_budget"
                          inputMode="decimal"
                          placeholder="600,00"
                          required
                        />
                      </label>
                      <label>
                        Mensalidade de gestão (R$)
                        <input
                          name="management_fee"
                          inputMode="decimal"
                          placeholder="697,00"
                          required
                        />
                      </label>
                      <label>
                        Início
                        <input type="date" name="start_date" required />
                      </label>
                      <label>
                        Fim
                        <input type="date" name="end_date" required />
                      </label>
                    </div>
                    <label>
                      Público, destino e observações
                      <textarea name="notes" maxLength={1500} rows={3} />
                    </label>
                    <SocialSubmit>Salvar planejamento</SocialSubmit>
                  </SocialAction>
                </section>
                <section className="social-panel">
                  <h2>Planejamentos desta empresa</h2>
                  {adsResult.data?.map((row) => {
                    const plan = adPlanSchema.safeParse(row);
                    return plan.success ? (
                      <article className="social-ad" key={row.id}>
                        <h3>{plan.data.name}</h3>
                        <p>
                          Mídia:{" "}
                          <strong>{money(plan.data.media_budget_cents)}</strong>{" "}
                          · Gestão: {money(plan.data.management_fee_cents)}
                        </p>
                        <p>
                          {plan.data.start_date} a {plan.data.end_date} ·
                          Rascunho local
                        </p>
                        <div className="social-actions">
                          <a
                            className="button secondary"
                            target="_blank"
                            rel="noopener noreferrer"
                            href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${plan.data.ad_account_id}`}
                          >
                            Abrir campanhas na Meta{" "}
                            <Icon name="arrow-up-right" size={16} />
                          </a>
                          <a
                            className="button secondary"
                            target="_blank"
                            rel="noopener noreferrer"
                            href={`https://business.facebook.com/billing_hub/payment_settings?asset_id=${plan.data.ad_account_id}`}
                          >
                            Pagamento da mídia na Meta{" "}
                            <Icon name="arrow-up-right" size={16} />
                          </a>
                        </div>
                      </article>
                    ) : (
                      <p role="alert" key={row.id}>
                        Registro inválido; confira a implantação.
                      </p>
                    );
                  })}
                  {!adsResult.data?.length && <p>Nenhum planejamento salvo.</p>}
                  <p className="social-note">
                    Criação e ativação de anúncios pela API ainda não estão
                    habilitadas. Os botões acima abrem a ferramenta oficial, sem
                    iniciar cobrança.
                  </p>
                  <nav
                    className="social-actions"
                    aria-label="Páginas de planejamentos"
                  >
                    {page > 1 && (
                      <Link href={href({ pagina: String(page - 1) })}>
                        Anterior
                      </Link>
                    )}
                    {adsResult.data?.length === 20 && (
                      <Link href={href({ pagina: String(page + 1) })}>
                        Próximos
                      </Link>
                    )}
                  </nav>
                </section>
              </>
            )}
            {tab === "contas" && (
              <>
                <section className="social-panel">
                  <h2>Conectar a conta certa</h2>
                  <p>
                    Instagram profissional vinculado a uma página do Facebook ou
                    a própria página. Use o acesso oficial da Meta, com
                    autorização do responsável pela empresa.
                  </p>
                  <SocialAction action={connectSocialAccount}>
                    <input
                      type="hidden"
                      name="company_id"
                      value={companyId.data}
                    />
                    <div className="social-two">
                      <label>
                        Rede
                        <select name="network">
                          <option value="instagram">
                            Instagram profissional
                          </option>
                          <option value="facebook">Página do Facebook</option>
                        </select>
                      </label>
                      <label>
                        ID da página do Facebook
                        <input
                          name="page_id"
                          pattern="[0-9]{5,30}"
                          inputMode="numeric"
                          required
                        />
                      </label>
                    </div>
                    <label className="social-check">
                      <input
                        type="checkbox"
                        name="confirm_account"
                        value="yes"
                        required
                      />
                      A página pertence a {company.data.name}, e tenho
                      autorização do responsável para conectar.
                    </label>
                    <SocialSubmit
                      disabled={!config.oauth}
                      pendingLabel="Abrindo a Meta…"
                    >
                      Conectar pela Meta
                    </SocialSubmit>
                  </SocialAction>
                  {!config.oauth && (
                    <p className="social-note">
                      Conexão indisponível até configurar aplicativo, versão
                      Graph, retorno OAuth e criptografia. Nenhuma conta é
                      conectada apenas por informar o ID.
                    </p>
                  )}
                </section>
                <section className="social-panel">
                  <h2>Contas desta empresa</h2>
                  {accounts.success &&
                    accounts.data.map((account) => (
                      <article className="social-account" key={account.id}>
                        <h3>
                          {account.network} · {account.label}
                        </h3>
                        <p>
                          {account.active
                            ? "Conectada · permissões podem ser revogadas na Meta"
                            : "Desconectada"}{" "}
                          · ID {account.external_id}
                        </p>
                        {account.active && (
                          <SocialAction action={revokeSocialAccount}>
                            <input
                              type="hidden"
                              name="account_id"
                              value={account.id}
                            />
                            <label className="social-check">
                              <input
                                type="checkbox"
                                name="confirm_revoke"
                                value="yes"
                                required
                              />
                              Desconectar e retirar autorização dos posts
                              agendados
                            </label>
                            <SocialSubmit>Desconectar</SocialSubmit>
                          </SocialAction>
                        )}
                      </article>
                    ))}
                  {accounts.success && !accounts.data.length && (
                    <p>Nenhuma conta conectada.</p>
                  )}
                </section>
                <section className="social-panel">
                  <h2>Ativação e custos</h2>
                  <ul className="social-checklist">
                    <li>
                      <Icon name={config.oauth ? "check" : "clock"} />
                      Aplicativo/OAuth:{" "}
                      {config.oauth
                        ? "configuração presente; homologação ainda necessária"
                        : "configuração pendente"}
                    </li>
                    <li>
                      <Icon name={config.ai ? "check" : "clock"} />
                      IA:{" "}
                      {config.ai
                        ? "credencial disponível; uso depende de créditos/conta liberada"
                        : "configuração pendente"}
                    </li>
                    <li>
                      <Icon name={config.publishing ? "check" : "clock"} />
                      Envio automático:{" "}
                      {config.publishing
                        ? "habilitado no ambiente"
                        : "desativado"}
                    </li>
                    <li>
                      <Icon name={config.worker ? "check" : "clock"} />
                      Agendador:{" "}
                      {config.worker
                        ? "credenciais presentes; frequência e hash no banco devem ser verificados"
                        : "credenciais pendentes"}
                    </li>
                  </ul>
                  <div className="social-actions">
                    <a
                      className="button secondary"
                      href="https://developers.facebook.com/apps/"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Configurar aplicativo Meta{" "}
                      <Icon name="arrow-up-right" size={16} />
                    </a>
                    <a
                      className="button secondary"
                      href="https://vercel.com/ai-gateway"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Créditos de IA <Icon name="arrow-up-right" size={16} />
                    </a>
                    <Link
                      href="/admin/integracoes"
                      className="button secondary"
                    >
                      Todas as integrações
                    </Link>
                  </div>
                  <p className="social-note">
                    Conectar um plugin nesta conversa não conecta
                    automaticamente o backend do SaaS. A habilitação precisa de
                    teste com conta autorizada antes de atender clientes.
                  </p>
                </section>
              </>
            )}
          </>
        )}
        <aside className="social-panel social-service-note">
          <div>
            <Icon name="camera" />
            <h2>Fotografia mensal</h2>
          </div>
          <p>
            Parceiro contratado pela Web Fidelize após confirmar cidade,
            disponibilidade e orçamento. Combine a visita no comercial; nenhuma
            pessoa ou estúdio foi contratado automaticamente.
          </p>
          <div className="social-actions">
            <Link href="/admin/comercial" className="button secondary">
              Abrir comercial
            </Link>
            {company.data.booking_slug && (
              <Link
                href={`/agendar/${company.data.booking_slug}`}
                className="button secondary"
              >
                Ver agenda pública da empresa
              </Link>
            )}
            <Link href="/servicos" className="button secondary">
              Ver oferta de serviços
            </Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
