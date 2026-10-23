import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { addDays, saoPauloDay } from "@/lib/scheduling";
import { CalendarImportForm } from "@/components/calendar-import/form";
import { importCalendar } from "./actions";
import "@/components/calendar-import/import.css";

export default async function ImportCalendarPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const { db } = await requireCompany(companyId, true, true);
  const [professionals, customers, services] = await Promise.all([
    db
      .from("professionals")
      .select("id,name")
      .eq("company_id", companyId)
      .is("archived_at", null)
      .order("name"),
    db
      .from("customers")
      .select("id,name")
      .eq("company_id", companyId)
      .is("archived_at", null)
      .order("name")
      .limit(1000),
    db
      .from("services")
      .select("id,name,duration_minutes")
      .eq("company_id", companyId)
      .is("archived_at", null)
      .order("name")
      .limit(1000),
  ]);
  const failed = professionals.error || customers.error || services.error;
  const today = saoPauloDay();
  return (
    <section className="calendar-import-page">
      <Link
        href={`/painel/${companyId}/agenda`}
        className="calendar-import-back"
      >
        ← Voltar à agenda
      </Link>
      <header>
        <span className="tag">SUA AGENDA VEM COM VOCÊ</span>
        <h1>Importar compromissos</h1>
        <p>
          Traga os horários que já estão no Google Agenda ou em outro sistema,
          sem recadastrar cada compromisso.
        </p>
      </header>
      <div className="calendar-import-intro">
        <div>
          <strong>1. Exporte a agenda</strong>
          <p>
            No Google Agenda pelo computador: Configurações → Importar e
            exportar → Exportar. Extraia o arquivo ICS do ZIP. Outros sistemas
            podem fornecer ICS ou CSV.
          </p>
          <a
            href="https://support.google.com/calendar/answer/37111?hl=pt-BR"
            target="_blank"
            rel="noopener noreferrer"
          >
            Orientação oficial do Google ↗
          </a>
        </div>
        <div>
          <strong>2. Confira antes de salvar</strong>
          <p>
            Escolha o profissional e veja duplicidades e conflitos. Horários
            ocupados preservam a agenda sem inventar clientes ou serviços.
          </p>
        </div>
        <div>
          <strong>3. Comece com a agenda organizada</strong>
          <p>
            A importação é pontual. A agenda de origem não é alterada e mudanças
            futuras não são sincronizadas automaticamente.
          </p>
        </div>
      </div>
      {failed ? (
        <p role="alert" className="notice error">
          Não foi possível carregar seus cadastros. Atualize a página para
          tentar novamente.
        </p>
      ) : !professionals.data?.length ? (
        <div className="card">
          <h2>Cadastre seu primeiro profissional</h2>
          <p>
            Os horários importados precisam ficar vinculados a um profissional
            da empresa.
          </p>
          <Link className="button" href={`/painel/${companyId}/professionals`}>
            Cadastrar profissional
          </Link>
        </div>
      ) : (
        <CalendarImportForm
          action={importCalendar.bind(null, companyId)}
          companyId={companyId}
          today={today}
          until={addDays(today, 29)}
          professionals={professionals.data}
          customers={customers.data || []}
          services={services.data || []}
        />
      )}
    </section>
  );
}
