import Link from "next/link";
import { AdminNavigation } from "@/components/admin/navigation";
import { Icon, type IconName } from "@/components/ui/icon";
import { requireOperationsAdmin } from "@/lib/admin-operations";
import { configured } from "@/lib/supabase/server";
import { billingReady } from "@/lib/billing/service";
import { aiServerConfiguration } from "@/lib/admin-ai/server";
import { invitationEmailEnabled } from "@/lib/team-mail";
import {
  whatsappConnections,
  getWhatsAppConnectionStatus,
} from "@/lib/whatsapp/server";
import "../admin.css";
import "./integracoes.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Integrações e custos | Web Fidelize" };

type Service = {
  id: string;
  name: string;
  icon: IconName;
  purpose: string;
  state: string;
  tone: "ready" | "pending" | "paused";
  cost: string;
  action: { href: string; label: string };
  manage?: { href: string; label: string };
  console: string;
  details: string[];
  source: { href: string; label: string };
};

function ServiceCard({ service }: { service: Service }) {
  return (
    <article className="integration-card" id={service.id}>
      <header>
        <span className="integration-icon">
          <Icon name={service.icon} size={22} />
        </span>
        <div>
          <h3>{service.name}</h3>
          <p>{service.purpose}</p>
        </div>
      </header>
      <span className={`integration-state is-${service.tone}`}>
        <Icon name={service.tone === "ready" ? "check" : "clock"} size={15} />
        {service.state}
      </span>
      <p className="integration-cost">
        <Icon name="briefcase" size={16} />
        {service.cost}
      </p>
      <div className="integration-actions">
        {service.manage && (
          <Link className="button secondary" href={service.manage.href}>
            {service.manage.label}
            <Icon name="arrow-right" size={15} />
          </Link>
        )}
        <a
          className="button secondary"
          href={service.action.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {service.action.label}
          <Icon name="arrow-up-right" size={15} />
        </a>
      </div>
      <details>
        <summary>
          <Icon name="settings" size={15} />O que falta e como configurar
        </summary>
        <ul>
          {service.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
        <div className="integration-references">
          <a href={service.console} target="_blank" rel="noopener noreferrer">
            Abrir painel do serviço ↗
          </a>
          <a
            href={service.source.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {service.source.label} ↗
          </a>
        </div>
      </details>
    </article>
  );
}

export default async function PlatformIntegrations() {
  await requireOperationsAdmin();
  const ai = aiServerConfiguration();
  const smtp = invitationEmailEnabled();
  const billing = billingReady();
  const billingPaused = process.env.BILLING_MODE === "disabled";
  const billingTest = process.env.BILLING_MODE === "test";
  // Only aggregate booleans/counts leave this server component. Connections contain tokens.
  let connections = 0;
  let readyConnections = 0;
  try {
    const entries = whatsappConnections();
    connections = entries.length;
    readyConnections = entries.filter(
      (entry) => getWhatsAppConnectionStatus(entry.companyId).configured,
    ).length;
  } catch {
    /* Invalid configuration is shown as pending, never as connected. */
  }
  const whatsappPaused = process.env.WHATSAPP_SEND_ENABLED !== "true";
  const foundations: Service[] = [
    {
      id: "hosting",
      name: "Vercel",
      icon: "layout",
      purpose: "Hospedagem e publicação do SaaS.",
      state:
        process.env.VERCEL === "1"
          ? "Aplicação na Vercel"
          : "Ambiente fora da Vercel",
      tone: "pending",
      cost: "Revisar o plano para uso comercial.",
      action: {
        href: "https://vercel.com/pricing",
        label: "Ver planos e contratar",
      },
      console: "https://vercel.com/dashboard",
      details: [
        "O plano contratado não é consultado por esta tela. Hobby é destinado a uso pessoal e não comercial; confira um plano adequado antes de vender.",
        "Gerencie domínio, variáveis privadas, consumo e limites no painel da Vercel. Contratar hospedagem não compra créditos de IA.",
      ],
      source: {
        href: "https://vercel.com/docs/plans/hobby",
        label: "Regras do plano Hobby",
      },
    },
    {
      id: "database",
      name: "Supabase",
      icon: "shield",
      purpose: "Banco, autenticação e arquivos das empresas.",
      state: configured() ? "Configuração presente" : "Configuração pendente",
      tone: configured() ? "ready" : "pending",
      cost: "Plano e capacidade conforme o uso.",
      action: {
        href: "https://supabase.com/pricing",
        label: "Ver planos e contratar",
      },
      console: "https://supabase.com/dashboard",
      details: [
        "Confira capacidade, backups e recuperação antes de ampliar as vendas. A presença da configuração não comprova restauração de backup nem plano contratado.",
        "Os e-mails de confirmação e recuperação usam a configuração SMTP do Supabase, separada dos convites de colaboradores.",
      ],
      source: {
        href: "https://supabase.com/docs/guides/auth/auth-smtp",
        label: "Configurar e-mails de acesso",
      },
    },
    {
      id: "payments",
      name: "Mercado Pago",
      icon: "briefcase",
      purpose: "Receber assinaturas por Pix e cartão.",
      state: billingPaused
        ? "Cobranças pausadas"
        : billing
          ? billingTest
            ? "Servidor em modo de teste"
            : "Servidor preparado; validar ativação"
          : "Configuração incompleta",
      tone: billingPaused ? "paused" : "pending",
      cost: "Taxas por operação; consulte sua conta.",
      action: {
        href: "https://www.mercadopago.com.br/ferramentas-para-vender/check-out",
        label: "Consultar taxas",
      },
      manage: { href: "/admin/espacos", label: "Ver assinaturas das empresas" },
      console: "https://www.mercadopago.com.br/developers/panel/app",
      details: [
        "Complete credenciais, assinatura do webhook e configuração privada do banco. A configuração de servidor não confirma homologação nem cobrança habilitada no banco.",
        "Homologue Pix, cartão, confirmação e cancelamento com contas autorizadas antes de liberar cobrança real. O admin consulta cada empresa; o proprietário contrata ou cancela a renovação.",
      ],
      source: {
        href: "https://www.mercadopago.com.br/developers/pt/docs/your-integrations/credentials",
        label: "Credenciais e ambientes",
      },
    },
    {
      id: "email",
      name: "E-mail / Brevo",
      icon: "mail",
      purpose: "Confirmação de acesso, recuperação e convites.",
      state: smtp
        ? "SMTP de convites configurado"
        : "SMTP de convites pendente",
      tone: smtp ? "ready" : "pending",
      cost: "Plano de e-mail conforme volume e recursos.",
      action: {
        href: "https://www.brevo.com/pricing/",
        label: "Ver planos e contratar",
      },
      console: "https://app.brevo.com/",
      details: [
        "Brevo foi escolhido na preparação do projeto; esta tela não confirma cadastro, remetente verificado nem entrega.",
        "Configure remetente e domínio no provedor, SMTP de acesso no Supabase e SMTP de convites na Vercel. Teste recebimento, spam e recuperação com destinatários autorizados.",
      ],
      source: {
        href: "https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans",
        label: "Limites dos planos",
      },
    },
  ];
  const automation: Service[] = [
    {
      id: "ai",
      name: "AI Gateway",
      icon: "sparkles",
      purpose: "Textos de campanhas e análises para revisão.",
      state: ai.providerConfigured
        ? "Configuração detectada; conferir créditos"
        : "Provedor pendente",
      tone: "pending",
      cost: "Créditos por uso, separados da hospedagem.",
      action: {
        href: "https://vercel.com/diogobr231/~/ai-gateway",
        label: "Gerenciar / comprar créditos",
      },
      manage: { href: "/admin/ia#configuracao", label: "Limites e histórico" },
      console: "https://vercel.com/dashboard",
      details: [
        ai.workerConfigured
          ? "O segredo do processador da Central IA está configurado. Confira no histórico se as execuções terminaram."
          : "O processador da Central IA ainda precisa ser configurado no servidor.",
        "Conta verificada, modelo liberado e créditos são verificações do provedor. Não há garantia de modelo gratuito. Limites de tentativas no SaaS não são um teto financeiro na Vercel.",
      ],
      source: {
        href: "https://vercel.com/docs/ai-gateway/pricing",
        label: "Preços e créditos de IA",
      },
    },
    {
      id: "whatsapp",
      name: "WhatsApp Cloud API",
      icon: "phone",
      purpose: "Lembretes e avisos autorizados por empresa.",
      state: whatsappPaused
        ? "Envios pausados"
        : readyConnections
          ? "Configuração disponível; validar entrega"
          : "Conexão pendente",
      tone: whatsappPaused ? "paused" : "pending",
      cost: "Cobrança da Meta conforme mercado e categoria.",
      action: {
        href: "https://whatsappbusiness.com/products/platform-pricing/",
        label: "Consultar cobrança da Meta",
      },
      manage: { href: "/admin/whatsapp", label: "Gerenciar cotas" },
      console: "https://business.facebook.com/",
      details: [
        `${connections} conexões cadastradas; ${readyConnections} com configuração de envio disponível. Isso não comprova entrega nem modelos aprovados.`,
        "Configure número oficial, modelos aprovados, webhook e rotina de processamento. O deploy atual não agenda o WhatsApp pelo cron da Vercel; confirme a rotina externa antes de liberar cotas.",
        "A configuração atual aceita até 100 conexões oficiais. Planeje essa capacidade antes de ultrapassá-la.",
      ],
      source: {
        href: "https://supabase.com/docs/guides/database/extensions/pg_net",
        label: "Rotina externa de servidor",
      },
    },
  ];
  const growth: Service[] = [
    {
      id: "social",
      name: "Instagram e Facebook",
      icon: "users",
      purpose: "Publicações, anúncios e atendimento nas redes.",
      state: "Automação ainda não integrada",
      tone: "pending",
      cost: "Investimento em anúncios definido por você.",
      action: {
        href: "https://adsmanager.facebook.com/",
        label: "Abrir anúncios e orçamento",
      },
      manage: { href: "/admin/marketing", label: "Preparar campanha" },
      console: "https://business.facebook.com/",
      details: [
        "Prepare textos e artes no Marketing. Publicação automática, compra de mídia, directs e comentários ainda precisam de integração própria com as contas e permissões da Meta.",
        "Abrir o gerenciador não ativa uma campanha. Você revisa público, duração e investimento na Meta antes de confirmar qualquer gasto.",
      ],
      source: {
        href: "https://www.postman.com/meta/facebook-marketing-api/overview",
        label: "API oficial de anúncios",
      },
    },
    {
      id: "metricool",
      name: "Metricool",
      icon: "calendar",
      purpose: "Opção externa para planejar e publicar conteúdo.",
      state: "Opcional; backend sem conexão",
      tone: "pending",
      cost: "Assinatura opcional; conferir acesso à API.",
      action: {
        href: "https://metricool.com/pricing/",
        label: "Ver planos e contratar",
      },
      console: "https://metricool.com/",
      details: [
        "A tabela atual do serviço indica API nos planos Advanced/Custom. Confira os recursos do plano antes de contratar.",
        "Um plugin conectado na conversa não instala uma integração permanente no Web Fidelize. Não é preciso assinar este serviço para usar o kit de marketing.",
      ],
      source: {
        href: "https://metricool.com/pricing/",
        label: "Recursos por plano",
      },
    },
    {
      id: "windsor",
      name: "Windsor.ai",
      icon: "layout",
      purpose: "Opção externa para consolidar métricas de marketing.",
      state: "Opcional; backend sem conexão",
      tone: "pending",
      cost: "Assinatura opcional conforme fontes e volume.",
      action: {
        href: "https://windsor.ai/pricing/",
        label: "Ver planos e contratar",
      },
      console: "https://windsor.ai/",
      details: [
        "Conecte apenas as contas que deseja analisar e confirme fontes, ações e limites do plano.",
        "Não há conexão permanente desse serviço no backend atual. Contratar métricas não libera publicação nem anúncios automaticamente.",
      ],
      source: {
        href: "https://windsor.ai/pricing/",
        label: "Planos e limites",
      },
    },
  ];
  return (
    <main className="admin-shell integrations-page">
      <AdminNavigation current="integrations" />
      <div className="admin-content">
        <header className="integrations-heading">
          <span className="tag">Configuração da plataforma</span>
          <h1>Integrações e custos</h1>
          <p>
            Veja o que está preparado, o que falta e onde contratar quando
            decidir.
          </p>
        </header>
        <nav className="integration-steps" aria-label="Etapas de preparação">
          <a href="#essenciais">
            <span>1</span>
            <Icon name="shield" size={18} />
            Preparar vendas
          </a>
          <a href="#automacao">
            <span>2</span>
            <Icon name="sparkles" size={18} />
            Ativar recursos
          </a>
          <a href="#divulgacao">
            <span>3</span>
            <Icon name="users" size={18} />
            Divulgar
          </a>
        </nav>
        <p className="integration-disclosure">
          <Icon name="link" size={18} />
          <span>
            Os botões externos abrem os serviços oficiais. Você escolhe o plano
            e confirma o pagamento lá. Esta página não assina, não recarrega
            créditos e não libera cobranças.
          </span>
        </p>
        {[
          {
            id: "essenciais",
            title: "Essenciais para vender",
            items: foundations,
          },
          {
            id: "automacao",
            title: "Mensagens e inteligência",
            items: automation,
          },
          {
            id: "divulgacao",
            title: "Divulgação e ferramentas opcionais",
            items: growth,
          },
        ].map((group) => (
          <section className="integration-section" id={group.id} key={group.id}>
            <h2>{group.title}</h2>
            <div className="integration-grid">
              {group.items.map((service) => (
                <ServiceCard key={service.id} service={service} />
              ))}
            </div>
          </section>
        ))}
        <details className="integration-footnote">
          <summary>
            <Icon name="map-pin" size={17} />
            CEP, mapas e rotinas
          </summary>
          <p>
            O preenchimento de CEP usa ViaCEP, com digitação manual como
            alternativa. Mapas são links: esta implementação não usa uma API
            paga do Google Maps.
          </p>
          <p>
            O deploy contém rotinas diárias para IA e reconciliação de
            pagamentos. Confira execução e erros nas centrais; configuração não
            comprova funcionamento recente.
          </p>
          <a
            href="https://viacep.com.br/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Consultar ViaCEP ↗
          </a>
          <p>
            Links e condições consultados em 25/10/2026. Valores,
            disponibilidade e recursos podem mudar; confirme na página do
            fornecedor.
          </p>
        </details>
      </div>
    </main>
  );
}
