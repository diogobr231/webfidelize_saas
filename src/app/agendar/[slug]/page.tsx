import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { publicDatabase } from "@/lib/supabase/public";
import { money } from "@/lib/catalog";
import { reserve } from "./actions";
import { validReceipt } from "@/lib/booking-receipt";
export const dynamic = "force-dynamic";
type Catalog = {
  name: string;
  slug: string;
  is_demo: boolean;
  services: {
    id: string;
    name: string;
    duration: number;
    price_cents: number;
  }[];
  professionals: { id: string; name: string }[];
};
export default async function Booking({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    service?: string;
    professional?: string;
    day?: string;
    erro?: string;
    confirmado?: string;
    proof?: string;
  }>;
}) {
  const { slug } = await params;
  if (!/^[a-z0-9][a-z0-9-]{2,59}$/.test(slug)) notFound();
  const q = await searchParams;
  const db = publicDatabase();
  const { data, error } = await db.rpc("public_catalog", { slug });
  if (error) throw new Error("Catálogo temporariamente indisponível");
  if (!data) notFound();
  const catalog = data as Catalog;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const selected = catalog.services.find((s) => s.id === q.service);
  const professional = catalog.professionals.find(
    (p) => p.id === q.professional,
  );
  let slots: { starts_at: string }[] = [];
  let failed = false;
  if (selected && professional && q.day && /^\d{4}-\d{2}-\d{2}$/.test(q.day)) {
    const result = await db.rpc("public_slots", {
      slug,
      service: selected.id,
      professional: professional.id,
      day: q.day,
    });
    slots = result.data || [];
    failed = Boolean(result.error);
  }
  return (
    <main>
      <nav>
        <Link className="brand" href="/">
          web<span>fidelize</span>
        </Link>
        <span className="badge">Agendamento online</span>
      </nav>
      <section style={{ maxWidth: 720, margin: "24px auto" }}>
        <span className="tag">SEU PRÓXIMO HORÁRIO</span>
        <h1 style={{ fontSize: 40 }}>{catalog.name}</h1>
        {catalog.is_demo && (
          <div className="notice">
            DEMONSTRAÇÃO — empresa e serviços fictícios para testes. Nenhum
            atendimento real será realizado.
          </div>
        )}
        <p>
          Escolha seu serviço e profissional. Horários no fuso de São Paulo.
          Nenhum pagamento é solicitado nesta reserva.
        </p>
        {q.erro && (
          <p className="notice error" role="alert">
            {q.erro === "configuracao"
              ? "Reservas temporariamente indisponíveis."
              : "Não foi possível reservar. Confira seus dados ou escolha um novo horário. O limite de tentativas também pode ter sido atingido."}
          </p>
        )}
        {q.confirmado &&
          q.proof &&
          process.env.BOOKING_GATEWAY_SECRET &&
          validReceipt(
            slug,
            q.confirmado,
            q.proof,
            process.env.BOOKING_GATEWAY_SECRET,
          ) && (
            <div className="notice" role="status">
              <strong>Agendamento confirmado.</strong>
              <p>Guarde a referência: {q.confirmado}.</p>
              <p>Para alterar ou cancelar, fale diretamente com a empresa.</p>
            </div>
          )}
        {!catalog.services.length || !catalog.professionals.length ? (
          <p className="empty">A empresa ainda está preparando sua agenda.</p>
        ) : (
          <>
            <form className="panel">
              <div className="form-grid">
                <div>
                  <label htmlFor="service">Serviço</label>
                  <select
                    id="service"
                    name="service"
                    defaultValue={selected?.id || ""}
                    required
                  >
                    <option value="">Selecione</option>
                    {catalog.services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {s.duration} min · {money(s.price_cents)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="professional">Profissional</label>
                  <select
                    id="professional"
                    name="professional"
                    defaultValue={professional?.id || ""}
                    required
                  >
                    <option value="">Selecione</option>
                    {catalog.professionals.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="day">Data</label>
                  <input
                    type="date"
                    id="day"
                    name="day"
                    min={today}
                    defaultValue={q.day || today}
                    required
                  />
                </div>
              </div>
              <button>Ver horários disponíveis →</button>
            </form>
            {selected && professional && (
              <section className="panel" style={{ marginTop: 24 }}>
                <h2>Escolha seu horário</h2>
                {failed ? (
                  <p className="notice error">
                    Não foi possível carregar os horários.
                  </p>
                ) : !slots.length ? (
                  <p className="empty">
                    Nenhum horário disponível nesta data. Experimente outro dia.
                  </p>
                ) : (
                  <form action={reserve}>
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="service" value={selected.id} />
                    <input
                      type="hidden"
                      name="professional"
                      value={professional.id}
                    />
                    <input
                      type="hidden"
                      name="request_id"
                      value={randomUUID()}
                    />
                    <div className="actions">
                      {slots.map((s) => (
                        <label key={s.starts_at} className="slot">
                          <input
                            type="radio"
                            name="start_time"
                            value={s.starts_at}
                            required
                          />
                          {new Date(s.starts_at).toLocaleTimeString("pt-BR", {
                            timeZone: "America/Sao_Paulo",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </label>
                      ))}
                    </div>
                    <label htmlFor="customer_name">Seu nome</label>
                    <input
                      id="customer_name"
                      name="customer_name"
                      minLength={2}
                      maxLength={120}
                      autoComplete="name"
                      required
                    />
                    <label htmlFor="phone">WhatsApp com DDD</label>
                    <input
                      id="phone"
                      name="phone"
                      type="tel"
                      minLength={10}
                      maxLength={30}
                      autoComplete="tel"
                      required
                    />
                    <div
                      style={{ position: "absolute", left: -10000 }}
                      aria-hidden="true"
                    >
                      <label htmlFor="website">Deixe em branco</label>
                      <input
                        id="website"
                        name="website"
                        tabIndex={-1}
                        autoComplete="off"
                        defaultValue=""
                      />
                    </div>
                    <label className="slot">
                      <input name="consent" type="checkbox" required />
                      Autorizo o uso do meu nome e telefone pela empresa para
                      organizar este agendamento.
                    </label>
                    <p style={{ fontSize: 13 }}>
                      Seus dados ficam disponíveis somente à empresa responsável
                      pelo atendimento. Não inclua informações de saúde neste
                      formulário.
                    </p>
                    <button>Confirmar agendamento →</button>
                  </form>
                )}
              </section>
            )}
          </>
        )}
      </section>
    </main>
  );
}
