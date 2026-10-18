import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { canManage } from "@/lib/permissions";
import { addShift, removeShift, configure } from "./actions";
const days = [
  "",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
  "Domingo",
];
const time = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export default async function Availability({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const { companyId } = await params;
  const { db, role, company } = await requireCompany(companyId);
  const q = await searchParams;
  const [shifts, professionals] = await Promise.all([
    db
      .from("availability")
      .select("*")
      .eq("company_id", companyId)
      .order("weekday")
      .order("start_minute"),
    db.from("professionals").select("id,name").eq("company_id", companyId),
  ]);
  return (
    <>
      <h2>Disponibilidade e reservas</h2>
      <p>
        Fuso: São Paulo. Cadastre turnos separados para intervalos de almoço.
        Remova o turno anterior antes de substituir um horário.
      </p>
      {company.is_demo && (
        <p className="notice">Empresa de demonstração — dados fictícios.</p>
      )}
      {q.erro && (
        <p role="alert" className="notice error">
          Não foi possível salvar. Verifique turnos sobrepostos, assinatura e se
          o endereço público está disponível.
        </p>
      )}
      {(shifts.error || professionals.error) && (
        <p className="notice error">Erro ao carregar a disponibilidade.</p>
      )}
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Profissional</th>
              <th>Dia</th>
              <th>Turno</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            {shifts.data?.map((s) => (
              <tr key={s.id}>
                <td>
                  {
                    professionals.data?.find((p) => p.id === s.professional_id)
                      ?.name
                  }
                </td>
                <td>{days[s.weekday]}</td>
                <td>
                  {time(s.start_minute)}–{time(s.end_minute)}
                </td>
                <td>
                  {canManage(role) && (
                    <form action={removeShift}>
                      <input
                        type="hidden"
                        name="company_id"
                        value={companyId}
                      />
                      <input type="hidden" name="id" value={s.id} />
                      <button className="secondary">Remover</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shifts.data?.length && (
          <p className="empty">Sem turnos cadastrados.</p>
        )}
      </div>
      {canManage(role) && (
        <form action={addShift} className="panel" style={{ marginTop: 24 }}>
          <h3>Adicionar turno</h3>
          <input type="hidden" name="company_id" value={companyId} />
          <label htmlFor="professional_id">Profissional</label>
          <select id="professional_id" name="professional_id" required>
            {professionals.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="form-grid">
            <div>
              <label htmlFor="weekday">Dia</label>
              <select id="weekday" name="weekday">
                {days.slice(1).map((d, i) => (
                  <option key={d} value={i + 1}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="start">Início</label>
              <input id="start" name="start" type="time" required />
            </div>
            <div>
              <label htmlFor="end">Fim</label>
              <input id="end" name="end" type="time" required />
            </div>
          </div>
          <button>Adicionar turno</button>
        </form>
      )}
      {role === "OWNER" && (
        <form action={configure} className="panel" style={{ marginTop: 24 }}>
          <h3>Página pública</h3>
          <input type="hidden" name="company_id" value={companyId} />
          <label htmlFor="slug">
            Endereço (letras minúsculas, números e hífen)
          </label>
          <input
            id="slug"
            name="slug"
            minLength={3}
            maxLength={60}
            pattern="[a-z0-9][a-z0-9-]{2,59}"
            defaultValue={company.booking_slug || ""}
            required
          />
          <label className="slot">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={company.booking_enabled}
            />
            Ativar reservas públicas
          </label>
          <button>Salvar página</button>
          {company.booking_slug && (
            <p>
              <Link href={`/agendar/${company.booking_slug}`} target="_blank">
                Abrir página de agendamento ↗
              </Link>
            </p>
          )}
        </form>
      )}
    </>
  );
}
