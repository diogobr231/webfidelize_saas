import { notFound } from "next/navigation";
import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { canManage } from "@/lib/permissions";
import { money } from "@/lib/catalog";
import { saveRecord, createAppointment } from "../../actions";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { PendingButton } from "@/components/pending-button";
import "../../operations.css";
const labels = {
  customers: "Clientes",
  services: "Serviços",
  professionals: "Profissionais",
  agenda: "Agenda",
};
const presentation = {
  customers: {
    icon: "users",
    description:
      "Uma base organizada para conhecer seus clientes e cuidar de cada atendimento.",
    singular: "cliente",
    empty: "Seus clientes começam aqui",
    hint: "Cadastre as informações de contato para encontrar cada cliente ao agendar.",
  },
  services: {
    icon: "briefcase",
    description:
      "Organize o que sua empresa oferece, com duração e preço sempre à mão.",
    singular: "serviço",
    empty: "Prepare seu catálogo de serviços",
    hint: "Defina a duração e o valor de cada atendimento. A agenda utiliza essas informações.",
  },
  professionals: {
    icon: "user",
    description:
      "Organize quem atende e prepare a disponibilidade da sua equipe.",
    singular: "profissional",
    empty: "Quem faz o seu negócio acontecer?",
    hint: "Cadastre os profissionais que realizam atendimentos. O acesso ao sistema é gerenciado separadamente.",
  },
  agenda: {
    icon: "calendar",
    description: "Acompanhe os horários e organize os próximos atendimentos.",
    singular: "agendamento",
    empty: "Sua agenda está pronta para começar",
    hint: "Escolha o cliente, o serviço e o profissional para reservar um horário.",
  },
} as const;
export default async function Records({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string; section: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const { companyId, section } = await params;
  if (!(section in labels)) notFound();
  const { db, role } = await requireCompany(companyId);
  const p = await searchParams;
  const table = section === "agenda" ? "appointments" : section;
  const { data: rows, error } = await db
    .from(table)
    .select("*")
    .eq("company_id", companyId)
    .order(section === "agenda" ? "starts_at" : "name")
    .limit(100);
  const managed = canManage(role);
  const display = presentation[section as keyof typeof presentation];
  const [customers, services, professionals] =
    section === "agenda" && managed
      ? await Promise.all(
          ["customers", "services", "professionals"].map((t) =>
            db.from(t).select("id,name").eq("company_id", companyId),
          ),
        )
      : [];
  return (
    <>
      <PageHeader
        eyebrow="Organização do negócio"
        title={labels[section as keyof typeof labels]}
        description={display.description}
        action={
          managed ? (
            <a className="button" href="#novo-registro">
              <Icon name="plus" size={16} /> Novo {display.singular}
            </a>
          ) : undefined
        }
      />
      {(p.erro || error) && (
        <div role="alert" className="notice error">
          {p.erro === "horario"
            ? "Horário indisponível, fora do expediente ou dados inválidos. Escolha outro horário."
            : "Não foi possível concluir. Confira os campos, seu plano e suas permissões."}
        </div>
      )}
      <div className={`records-layout${managed ? " has-editor" : ""}`}>
        <section className="panel records-list">
          <div className="records-list-heading">
            <div>
              <span className="operations-icon">
                <Icon name={display.icon} size={18} />
              </span>
              <h2>
                {section === "agenda"
                  ? "Atendimentos"
                  : labels[section as keyof typeof labels]}{" "}
                cadastrados
              </h2>
            </div>
            <span className="operations-count">
              {rows?.length ?? 0} exibidos
            </span>
          </div>
          {!rows?.length ? (
            <EmptyState
              icon={display.icon}
              title={error ? "Dados indisponíveis" : display.empty}
              description={
                error
                  ? "Atualize a página para tentar carregar os dados novamente."
                  : managed
                    ? display.hint
                    : "Os registros disponíveis para seu perfil aparecerão aqui."
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="records-table">
                <caption className="sr-only">
                  Registros de{" "}
                  {labels[section as keyof typeof labels].toLocaleLowerCase(
                    "pt-BR",
                  )}{" "}
                  da empresa
                </caption>
                <thead>
                  <tr>
                    <th scope="col">
                      {section === "agenda" ? "Início" : "Nome"}
                    </th>
                    <th scope="col">
                      {section === "customers" ? "Telefone" : "Detalhes"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="record-name">
                        {section === "agenda"
                          ? new Date(row.starts_at).toLocaleString("pt-BR", {
                              timeZone: "America/Sao_Paulo",
                            })
                          : row.name}
                      </td>
                      <td>
                        {section === "services" ? (
                          `${row.duration_minutes} min · ${money(row.price_cents)}`
                        ) : section === "customers" ? (
                          row.phone || "Não informado"
                        ) : section === "agenda" ? (
                          `${row.status} · até ${new Date(row.ends_at).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}`
                        ) : (
                          <Link
                            className="record-link"
                            href={`/painel/${companyId}/disponibilidade#turnos`}
                          >
                            Ver horários{" "}
                            <Icon name="arrow-up-right" size={14} />
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        {managed && (
          <section className="panel record-editor" id="novo-registro">
            <span className="operations-icon">
              <Icon name="plus" size={18} />
            </span>
            <h2>Novo {display.singular}</h2>
            <p>{display.hint}</p>
            <form
              className="operations-form"
              action={section === "agenda" ? createAppointment : saveRecord}
            >
              <input type="hidden" name="company_id" value={companyId} />
              <input type="hidden" name="kind" value={section} />
              {section === "agenda" ? (
                <>
                  <div className="form-grid">
                    {[
                      ["customer_id", "Cliente", customers],
                      ["service_id", "Serviço", services],
                      ["professional_id", "Profissional", professionals],
                    ].map(([key, label, result]) => (
                      <div key={String(key)}>
                        <label htmlFor={String(key)}>{String(label)}</label>
                        <select id={String(key)} name={String(key)} required>
                          <option value="">Selecione</option>
                          {typeof result === "object" &&
                            result?.data?.map(
                              (item: { id: string; name: string }) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ),
                            )}
                        </select>
                      </div>
                    ))}
                  </div>
                  <label htmlFor="starts_at">
                    Data e hora com fuso (ex.: 2026-10-20T10:00:00-03:00)
                  </label>
                  <input
                    id="starts_at"
                    name="starts_at"
                    type="text"
                    placeholder="2026-10-20T10:00:00-03:00"
                    required
                  />
                  <p>
                    Horários exibidos no fuso de São Paulo. O banco confirma a
                    disponibilidade.
                  </p>
                </>
              ) : (
                <>
                  <label htmlFor="name">Nome</label>
                  <input
                    id="name"
                    name="name"
                    required
                    minLength={2}
                    maxLength={120}
                    placeholder={
                      section === "customers"
                        ? "Nome completo do cliente"
                        : section === "services"
                          ? "Nome do atendimento"
                          : "Nome de quem atende"
                    }
                  />
                  {section === "customers" && (
                    <>
                      <label htmlFor="phone">Telefone</label>
                      <input
                        id="phone"
                        name="phone"
                        type="tel"
                        maxLength={30}
                        placeholder="DDD e número"
                        autoComplete="tel"
                      />
                    </>
                  )}
                  {section === "services" && (
                    <div className="form-grid">
                      <div>
                        <label htmlFor="duration">Duração em minutos</label>
                        <input
                          id="duration"
                          name="duration"
                          type="number"
                          min={5}
                          max={480}
                          required
                        />
                      </div>
                      <div>
                        <label htmlFor="price">Preço em reais</label>
                        <input
                          id="price"
                          name="price"
                          type="number"
                          min={0}
                          max={100000}
                          step="0.01"
                          required
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
              <PendingButton>
                Salvar {display.singular} <Icon name="check" size={16} />
              </PendingButton>
            </form>
          </section>
        )}
      </div>
    </>
  );
}
