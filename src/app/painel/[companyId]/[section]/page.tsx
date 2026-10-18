import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { canManage } from "@/lib/permissions";
import { money } from "@/lib/catalog";
import { saveRecord, createAppointment } from "../../actions";
const labels = {
  customers: "Clientes",
  services: "Serviços",
  professionals: "Profissionais",
  agenda: "Agenda",
};
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
      <h2>{labels[section as keyof typeof labels]}</h2>
      {(p.erro || error) && (
        <div role="alert" className="notice error">
          {p.erro === "horario"
            ? "Horário indisponível, fora do expediente ou dados inválidos. Escolha outro horário."
            : "Não foi possível concluir. Confira os campos, seu plano e suas permissões."}
        </div>
      )}
      <div className="panel table-wrap">
        {!rows?.length ? (
          <p className="empty">
            {error
              ? "Dados indisponíveis. Tente novamente."
              : "Nenhum registro ainda."}
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{section === "agenda" ? "Início" : "Nome"}</th>
                <th>Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {section === "agenda"
                      ? new Date(row.starts_at).toLocaleString("pt-BR", {
                          timeZone: "America/Sao_Paulo",
                        })
                      : row.name}
                  </td>
                  <td>
                    {section === "services"
                      ? `${row.duration_minutes} min · ${money(row.price_cents)}`
                      : section === "customers"
                        ? row.phone
                        : section === "agenda"
                          ? `${row.status} · até ${new Date(row.ends_at).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}`
                          : "Horários configuráveis na seção Disponibilidade (São Paulo)"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {managed && (
        <section className="panel" style={{ marginTop: 24 }}>
          <h3>{section === "agenda" ? "Novo agendamento" : "Novo registro"}</h3>
          <form action={section === "agenda" ? createAppointment : saveRecord}>
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
                />
                {section === "customers" && (
                  <>
                    <label htmlFor="phone">Telefone</label>
                    <input id="phone" name="phone" type="tel" maxLength={30} />
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
            <button>Salvar →</button>
          </form>
        </section>
      )}
    </>
  );
}
