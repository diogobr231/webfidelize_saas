import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requireCompany } from "@/lib/auth";
import { hasAccess } from "@/lib/permissions";
import { niches, money } from "@/lib/catalog";
import { setupProgress, setupStep, setupDestination } from "@/lib/onboarding";
import { OnboardingFrame } from "@/components/onboarding/frame";
import { addSetupService, addSetupProfessional } from "@/app/comecar/actions";
import {
  ServiceSetupForm,
  ProfessionalSetupForm,
} from "@/components/onboarding/forms";

export default async function Setup({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ etapa?: string }>;
}) {
  const { companyId } = await params;
  const { db, company, role } = await requireCompany(companyId, false, true);
  const [query, services, professionals, plan, shifts] = await Promise.all([
    searchParams,
    db
      .from("services")
      .select("id,name,duration_minutes,price_cents", { count: "exact" })
      .eq("company_id", companyId)
      .is("archived_at", null)
      .order("name")
      .limit(5),
    db
      .from("professionals")
      .select("id,name", { count: "exact" })
      .eq("company_id", companyId)
      .is("archived_at", null)
      .order("name")
      .limit(10),
    db
      .from("plans")
      .select("name,staff_limit")
      .eq("id", company.plan_id)
      .single(),
    db
      .from("availability")
      .select("id,professionals!inner(archived_at)", {
        count: "exact",
        head: true,
      })
      .eq("company_id", companyId)
      .is("professionals.archived_at", null),
  ]);
  const base = `/painel/${companyId}`;
  // Bind on the server so useActionState receives a stable serialized action
  // when React retries rendering an HTML POST response after validation.
  const saveService = addSetupService.bind(null, companyId);
  const saveProfessional = addSetupProfessional.bind(null, companyId);
  if (services.error || professionals.error || plan.error || shifts.error)
    return (
      <section className="panel">
        <h1>Seu progresso está salvo.</h1>
        <p role="alert">
          Não foi possível carregar a configuração agora. Atualize a página para
          tentar novamente.
        </p>
        <div className="actions">
          <Link className="button" href={`${base}/configuracao`}>
            Tentar novamente
          </Link>
          <Link href={base}>Ir para meu dia</Link>
        </div>
      </section>
    );
  const serviceCount = services.count ?? 0;
  const professionalCount = professionals.count ?? 0;
  const progress = setupProgress(true, serviceCount, professionalCount);
  const current = setupStep(query.etapa, progress.next);
  const writable = hasAccess(company.status, company.trial_ends_at);
  const room = professionalCount < plan.data.staff_limit;
  const canSchedule =
    serviceCount > 0 && professionalCount > 0 && (shifts.count ?? 0) > 0;
  const companyName =
    niches.find((item) => item.slug === company.niche)?.name || company.niche;
  return (
    <OnboardingFrame
      current={current}
      company={{ id: companyId, name: company.name, niche: company.niche }}
      services={serviceCount}
      professionals={professionalCount}
    >
      {!writable && (
        <p role="alert" className="notice error">
          Sua configuração está salva. Regularize a assinatura para adicionar ou
          alterar cadastros.{" "}
          <a
            href="https://wa.me/5518997695445"
            target="_blank"
            rel="noreferrer"
          >
            Falar com o suporte ↗
          </a>
        </p>
      )}
      {current === "empresa" && (
        <section className="onb-card">
          <h2>Seu negócio já está cadastrado.</h2>
          <dl className="onb-summary">
            <div>
              <dt>Empresa</dt>
              <dd>{company.name}</dd>
            </div>
            <div>
              <dt>Segmento</dt>
              <dd>{companyName}</dd>
            </div>
            <div>
              <dt>Plano atual</dt>
              <dd>{plan.data.name}</dd>
            </div>
          </dl>
          <p className="onb-tip">
            Estas informações foram salvas ao criar sua empresa. Retomar a
            configuração mantém o prazo original do seu teste.
          </p>
          <div className="onb-actions">
            <Link
              className="button"
              href={setupDestination(companyId, "servicos")}
            >
              Continuar para serviços →
            </Link>
          </div>
        </section>
      )}
      {current === "servicos" && (
        <>
          {serviceCount > 0 && (
            <section className="onb-card">
              <h2>
                {serviceCount === 1
                  ? "Seu primeiro serviço está salvo."
                  : `${serviceCount} serviços já cadastrados.`}
              </h2>
              <ul className="onb-list">
                {services.data?.map((service) => (
                  <li key={service.id}>
                    <strong>{service.name}</strong>
                    <span>
                      {service.duration_minutes} min ·{" "}
                      {money(service.price_cents)}
                    </span>
                  </li>
                ))}
              </ul>
              {serviceCount > 5 && (
                <Link href={`${base}/services`}>Ver todos os serviços →</Link>
              )}
              <div className="onb-actions">
                <Link
                  className="button"
                  href={setupDestination(companyId, "equipe")}
                >
                  Continuar para equipe →
                </Link>
              </div>
            </section>
          )}
          {writable && (
            <ServiceSetupForm
              saveAction={saveService}
              companyId={companyId}
              niche={company.niche}
              recordId={randomUUID()}
              additional={serviceCount > 0}
            />
          )}
          {!serviceCount && (
            <Link href={setupDestination(companyId, "equipe")}>
              Pular serviços por enquanto →
            </Link>
          )}
        </>
      )}
      {current === "equipe" && (
        <>
          <p className="onb-tip">
            {professionalCount} de {plan.data.staff_limit}{" "}
            {plan.data.staff_limit === 1 ? "vaga ocupada" : "vagas ocupadas"} no
            plano {plan.data.name}. Se você atende clientes, cadastre seu
            próprio nome: ele também ocupa uma vaga.
          </p>
          {professionalCount > 0 && (
            <section className="onb-card">
              <h2>Quem já faz parte da agenda</h2>
              <ul className="onb-list">
                {professionals.data?.map((professional) => (
                  <li key={professional.id}>
                    <strong>{professional.name}</strong>
                    <span>Profissional cadastrado</span>
                  </li>
                ))}
              </ul>
              <div className="onb-actions">
                <Link
                  className="button"
                  href={setupDestination(companyId, "resumo")}
                >
                  Conferir próximos passos →
                </Link>
              </div>
            </section>
          )}
          {writable && room && (
            <ProfessionalSetupForm
              saveAction={saveProfessional}
              companyId={companyId}
              recordId={randomUUID()}
              additional={professionalCount > 0}
            />
          )}
          {!room && (
            <p className="onb-tip">
              Você já utilizou as vagas do seu plano. Pode continuar com os
              profissionais cadastrados.
            </p>
          )}
          <section className="onb-card">
            <h2>Acesso ao sistema é um passo separado.</h2>
            <p>
              Cadastrar um profissional não cria uma conta. O convite permite
              entrar no sistema; a agenda de um colaborador depende também de
              vincular seu usuário ao profissional.
            </p>
            {role === "OWNER" ? (
              <Link href={`${base}/equipe`}>
                Gerenciar convites e permissões →
              </Link>
            ) : (
              <p>O proprietário pode convidar colaboradores.</p>
            )}
            <p className="onb-tip">
              Você pode deixar os convites para depois. Se trabalha sozinho, use
              sua conta de proprietário.
            </p>
          </section>
          {!professionalCount && (
            <Link href={setupDestination(companyId, "resumo")}>
              Pular equipe por enquanto →
            </Link>
          )}
        </>
      )}
      {current === "resumo" && (
        <>
          <section className="onb-card">
            <h2>
              {progress.done === 3
                ? "Seu espaço está preparado."
                : "Comece no seu ritmo."}
            </h2>
            <p>
              {progress.done === 3
                ? "Seus serviços e profissionais já estão no sistema. Confira os horários antes de marcar seu primeiro atendimento."
                : "Você já pode explorar o painel. Complete os itens abaixo quando quiser começar a agendar."}
            </p>
            <ul className="onb-list">
              <li>
                <strong>Empresa e segmento</strong>
                <span>
                  {company.name} · {companyName}
                </span>
              </li>
              <li>
                <strong>Serviços</strong>
                <span>{serviceCount} cadastrado(s)</span>
                {!serviceCount && (
                  <Link href={setupDestination(companyId, "servicos")}>
                    Adicionar serviço →
                  </Link>
                )}
              </li>
              <li>
                <strong>Profissionais</strong>
                <span>{professionalCount} cadastrado(s)</span>
                {!professionalCount && (
                  <Link href={setupDestination(companyId, "equipe")}>
                    Cadastrar profissional →
                  </Link>
                )}
              </li>
            </ul>
            <div className="onb-actions">
              <Link className="button" href={base}>
                Começar a usar o sistema →
              </Link>
              {canSchedule && writable && (
                <Link className="button secondary" href={`${base}/agenda`}>
                  Abrir agenda
                </Link>
              )}
            </div>
          </section>
          <section className="onb-card">
            <h2>Antes de receber agendamentos</h2>
            <p>
              Profissionais novos recebem turnos de segunda a sexta, das 8h às
              18h, no fuso de São Paulo. Revise seus dias, intervalos e horários
              reais.
            </p>
            <div className="onb-actions">
              <Link
                className="button secondary"
                href={`${base}/disponibilidade#turnos`}
              >
                Conferir horários
              </Link>
            </div>
          </section>
          <section className="onb-card">
            <h2>Sua página de reservas</h2>
            <p>
              {company.booking_enabled
                ? "Sua página está publicada. Confira a disponibilidade e a situação da assinatura antes de compartilhar."
                : "A página pública não é ativada automaticamente. Você pode personalizar e publicar seu link depois de configurar a agenda."}
            </p>
            {role === "OWNER" ? (
              <Link href={`${base}/disponibilidade#pagina-publica`}>
                Personalizar página de agendamento →
              </Link>
            ) : (
              <p>O proprietário publica a página da empresa.</p>
            )}
          </section>
        </>
      )}
    </OnboardingFrame>
  );
}
