import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { signedCompanyLogo } from "@/lib/company-logo";
import { PageHeader } from "@/components/ui/page-header";
import { Icon } from "@/components/ui/icon";
import { LogoForm, PersonalizationForm } from "./forms";
import { saveCompanyLogo, savePersonalization } from "./actions";
import "./personalizacao.css";

export default async function Personalization({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const { db, company, role } = await requireCompany(companyId);
  if (role !== "OWNER") redirect(`/painel/${companyId}?erro=permissao`);
  const logo = await signedCompanyLogo(db, companyId, company.logo_path);
  const base = `/painel/${companyId}`;
  const permalink = `${base}/personalizacao`;
  const initials = company.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word: string) => word[0])
    .join("")
    .toUpperCase();
  return (
    <>
      <PageHeader
        eyebrow="Sua empresa"
        title="Personalize seu espaço."
        description="Sua marca no agendamento e uma experiência consistente para quem trabalha com você."
        action={
          company.booking_enabled && company.booking_slug ? (
            <Link
              className="button secondary"
              href={`/agendar/${company.booking_slug}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Ver página pública <Icon name="arrow-up-right" size={16} />
            </Link>
          ) : undefined
        }
      />
      <div className="personalization-layout">
        <PersonalizationForm
          company={{
            name: company.name,
            booking_description: company.booking_description,
            booking_address: company.booking_address,
            booking_phone: company.booking_phone,
            booking_theme: company.booking_theme,
            display_density: company.display_density,
            agenda_view: company.agenda_view,
          }}
          saveAction={savePersonalization.bind(null, companyId)}
          permalink={permalink}
        />
        <aside className="personalization-sidebar">
          <section className="panel">
            <div className="personalization-section-heading">
              <h2>Logotipo</h2>
              <p>Seu logotipo fica associado apenas a esta empresa.</p>
            </div>
            <div className="personalization-logo-preview">
              {logo ? (
                <img
                  src={logo}
                  alt={`Logotipo de ${company.name}`}
                  width={96}
                  height={96}
                />
              ) : (
                <span aria-label="Sem logotipo">{initials}</span>
              )}
            </div>
            {company.logo_path && !logo ? (
              <p className="muted">
                Não foi possível carregar a imagem agora. O arquivo salvo foi
                preservado.
              </p>
            ) : null}
            <LogoForm
              saveAction={saveCompanyLogo.bind(null, companyId)}
              permalink={permalink}
              hasLogo={Boolean(company.logo_path)}
              published={Boolean(company.logo_published)}
              enabled={Boolean(company.booking_enabled)}
            />
          </section>
          <section className="panel personalization-related">
            <Icon name="clock" size={23} />
            <h2>Horários e disponibilidade</h2>
            <p>
              Defina os dias e turnos de cada profissional. Esses horários
              determinam as reservas disponíveis para seus clientes.
            </p>
            <Link
              className="button secondary"
              href={`${base}/disponibilidade#turnos`}
            >
              Configurar horários <Icon name="arrow-right" size={16} />
            </Link>
          </section>
          <section className="panel personalization-related">
            <Icon name="shield" size={23} />
            <h2>Sua marca, com segurança</h2>
            <p>
              Somente o proprietário altera estas opções. Publicar o logotipo é
              opcional; a identidade principal da Web Fidelize é preservada.
            </p>
            <Link href={`${base}/configuracao`}>Revisar primeiros passos</Link>
          </section>
        </aside>
      </div>
    </>
  );
}
