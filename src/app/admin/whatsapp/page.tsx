import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { Brand } from "@/components/ui/brand";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { CompanyLimitForm } from "./form";
import { setCompanyWhatsAppLimit } from "./actions";
import "../admin.css";
import "../../painel/[companyId]/lembretes/reminders.css";

export const dynamic = "force-dynamic";
export default async function WhatsAppAdmin() {
  const { db } = await requireUser();
  const admin = await db.rpc("is_super_admin");
  if (admin.error || !admin.data) notFound();
  const companies = await db
    .from("companies")
    .select("id,name")
    .order("created_at", { ascending: false })
    .limit(100);
  const settings = companies.data?.length
    ? await db
        .from("whatsapp_settings")
        .select("company_id,enabled,monthly_limit,platform_limit")
        .in(
          "company_id",
          companies.data.map((company) => company.id),
        )
    : { data: [], error: null };
  const byCompany = new Map(
    (settings.data ?? []).map((item) => [item.company_id, item]),
  );
  return (
    <main className="admin-shell reminder-page">
      <nav className="admin-topbar" aria-label="Administração">
        <Brand href="/admin" />
        <Link href="/admin" className="button secondary">
          Voltar à administração
        </Link>
      </nav>
      <div className="admin-content">
        <PageHeader
          eyebrow="Controle da plataforma"
          title="WhatsApp por empresa"
          description="Defina um teto mensal de consumo para cada empresa. Somente o SUPER_ADMIN pode liberar ou ampliar esta cota."
        />
        <p className="notice">
          A cota começa em zero. Liberar mensagens não ativa pagamentos nem
          confirma a configuração da Meta. O limite efetivo é o menor entre a
          cota abaixo e o limite escolhido pela empresa.
        </p>
        <section className="panel">
          <h2>Cotas mensais</h2>
          <p className="reminder-help">
            Até 100 empresas mais recentes. O mês segue o fuso de São Paulo.
            Tentativas reservadas para envio, inclusive resultados incertos e
            falhas, consomem a cota. Reduzir o limite não apaga o consumo
            existente.
          </p>
          {companies.error || settings.error ? (
            <p className="notice error" role="alert">
              Não foi possível carregar empresas e cotas. Atualize a página
              antes de editar.
            </p>
          ) : companies.data?.length ? (
            <div className="reminder-admin-list">
              {companies.data.map((company) => {
                const item = byCompany.get(company.id);
                return (
                  <article key={company.id} className="reminder-admin-item">
                    <div>
                      <strong>{company.name}</strong>
                      <p>
                        {item?.enabled
                          ? "Lembretes habilitados pela empresa"
                          : "Lembretes desabilitados pela empresa"}
                      </p>
                      <p>
                        Limite escolhido pela empresa:{" "}
                        {Number(item?.monthly_limit ?? 100).toLocaleString(
                          "pt-BR",
                        )}
                        . Efetivo:{" "}
                        {Math.min(
                          item?.monthly_limit ?? 100,
                          item?.platform_limit ?? 0,
                        ).toLocaleString("pt-BR")}
                        .
                      </p>
                    </div>
                    <CompanyLimitForm
                      limit={item?.platform_limit ?? 0}
                      action={setCompanyWhatsAppLimit.bind(null, company.id)}
                    />
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon="building"
              title="Nenhuma empresa cadastrada"
              description="As cotas dos novos espaços aparecerão aqui após o cadastro."
            />
          )}
        </section>
      </div>
    </main>
  );
}
