import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { z } from "zod";
import { publicDatabase } from "@/lib/supabase/public";
import { signedPublicLogo } from "@/lib/company-logo";
import { signedPublicCover } from "@/lib/company-cover";
import { BookingCover } from "@/components/booking/booking-cover";
import { StoredReceipt } from "@/components/booking/stored-receipt";
import { Icon } from "@/components/ui/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { money } from "@/lib/catalog";
import {
  addDays,
  appointmentTime,
  saoPauloDay,
  validDay,
} from "@/lib/scheduling";
import {
  classReceiptSchema,
  classSlugSchema,
  publicClassSchema,
  type ClassReceipt,
} from "@/lib/classes";
import { readClassReceipt } from "@/lib/class-receipt";
import { PublicClassReservationForm } from "@/components/classes/public-reservation-form";
import { reserveClass } from "./actions";
import "../booking.css";
import "@/components/classes/classes.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Inscrições em turmas | Web Fidelize",
  robots: { index: false, follow: false },
};
const catalogSchema = z.object({
  name: z.string(),
  slug: z.string(),
  is_demo: z.boolean(),
  description: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  theme: z.string().optional(),
  logo_path: z.string().nullable().optional(),
  cover_path: z.string().nullable().optional(),
});

export default async function PublicClassesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ day?: string; turma?: string; recibo?: string }>;
}) {
  const { slug } = await params;
  if (!classSlugSchema.safeParse(slug).success) notFound();
  const query = await searchParams;
  const db = publicDatabase();
  const result = await db.rpc("public_catalog", { slug });
  if (result.error)
    throw new Error("Página de turmas temporariamente indisponível");
  if (!result.data) {
    const secret = process.env.BOOKING_GATEWAY_SECRET;
    const requestId = secret
      ? readClassReceipt(query.recibo, slug, secret)
      : null;
    if (!requestId || !secret) notFound();
    const response = await db.rpc("public_class_booking_receipt", {
      p_slug: slug,
      p_request_id: requestId,
      p_gateway_secret: secret,
    });
    if (response.error)
      throw new Error("Comprovante temporariamente indisponível");
    const stored = classReceiptSchema.safeParse(response.data);
    if (!stored.success) notFound();
    return <StoredReceipt receipt={stored.data} />;
  }
  const parsedCatalog = catalogSchema.safeParse(result.data);
  if (!parsedCatalog.success)
    throw new Error("Apresentação temporariamente indisponível");
  const catalog = parsedCatalog.data;
  const today = saoPauloDay();
  const maxDay = addDays(today, 60);
  const day =
    validDay(query.day) && query.day >= today && query.day <= maxDay
      ? query.day
      : today;
  const [logo, cover, classes] = await Promise.all([
    signedPublicLogo(db, catalog.logo_path),
    signedPublicCover(db, catalog.cover_path),
    db.rpc("public_classes", { p_slug: slug, p_day: day }),
  ]);
  const parsedClasses = z.array(publicClassSchema).safeParse(classes.data);
  const failed = Boolean(classes.error) || !parsedClasses.success;
  const sessions = parsedClasses.success ? parsedClasses.data : [];
  const selected = sessions.find((session) => session.id === query.turma);
  const secret = process.env.BOOKING_GATEWAY_SECRET;
  const requestId = secret
    ? readClassReceipt(query.recibo, slug, secret)
    : null;
  let receipt: ClassReceipt | null = null;
  if (requestId && secret) {
    const response = await db.rpc("public_class_booking_receipt", {
      p_slug: slug,
      p_request_id: requestId,
      p_gateway_secret: secret,
    });
    const parsed = classReceiptSchema.safeParse(response.data);
    if (!response.error && parsed.success) receipt = parsed.data;
  }
  const canceled =
    receipt?.status === "canceled" || receipt?.class_status === "canceled";
  const phone = (catalog.phone || "").replace(/\D/g, "");
  const internationalPhone = /^\d{10,11}$/.test(phone)
    ? `55${phone}`
    : /^55\d{10,11}$/.test(phone)
      ? phone
      : "";
  const contact = internationalPhone
    ? `https://wa.me/${internationalPhone}`
    : null;
  const theme = ["teal", "blue", "violet", "rose"].includes(catalog.theme || "")
    ? catalog.theme
    : "teal";
  const route = `/agendar/${slug}/turmas`;
  return (
    <main className="booking-page public-classes" data-theme={theme}>
      <div className="booking-topbar">
        <div className="booking-shell booking-topbar-inner">
          <Link className="booking-business" href={`/agendar/${slug}`}>
            <span className="booking-avatar" aria-hidden="true">
              {logo ? (
                <img
                  src={logo}
                  alt=""
                  width={40}
                  height={40}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                  }}
                />
              ) : (
                <Icon name="users" size={22} />
              )}
            </span>
            <span>{catalog.name}</span>
          </Link>
          <Link className="class-header-link" href={`/agendar/${slug}`}>
            Atendimento individual
          </Link>
        </div>
      </div>
      <div className="booking-shell">
        <header className="booking-hero">
          <div className="booking-hero-copy">
            <span className="booking-eyebrow">EXPERIÊNCIAS EM GRUPO</span>
            <h1>
              Escolha sua atividade.
              <br />
              Reserve sua vaga.
            </h1>
            <p>
              {catalog.description ||
                `Conheça as turmas de ${catalog.name}, escolha um horário e inscreva-se sem instalar um aplicativo.`}
            </p>
            <div className="booking-details">
              {catalog.address && (
                <span>
                  <Icon name="building" size={15} />
                  {catalog.address}
                </span>
              )}
              {contact && (
                <a href={contact} target="_blank" rel="noopener noreferrer">
                  <Icon name="phone" size={15} />
                  Fale com a empresa
                </a>
              )}
            </div>
          </div>
          <BookingCover src={cover} companyName={catalog.name}>
            <div className="class-public-art" aria-hidden="true">
              <span className="class-art-orbit">
                <Icon name="users" size={64} />
              </span>
              <strong>Juntos no próximo encontro.</strong>
              <span>Seu lugar começa aqui.</span>
            </div>
          </BookingCover>
        </header>
        {catalog.is_demo && (
          <div className="booking-notice booking-demo">
            <strong>DEMONSTRAÇÃO</strong>
            <span>
              Empresa e atividades fictícias para testes. Nenhum atendimento
              real será realizado.
            </span>
          </div>
        )}
        {receipt ? (
          <section
            className="booking-card class-receipt"
            aria-labelledby="receipt-heading"
          >
            <Icon name={canceled ? "calendar" : "check"} size={32} />
            <h2 id="receipt-heading">
              {canceled
                ? "Inscrição cancelada"
                : receipt.status === "attended"
                  ? "Presença registrada"
                  : receipt.class_status === "completed"
                    ? "Atividade concluída"
                    : "Sua vaga está confirmada"}
            </h2>
            <p>{receipt.company_name}</p>
            <h3>{receipt.title}</h3>
            <p>
              {receipt.service_name} · {receipt.professional_name}
            </p>
            <p>
              {new Date(receipt.starts_at).toLocaleDateString("pt-BR", {
                timeZone: "America/Sao_Paulo",
                weekday: "long",
                day: "2-digit",
                month: "long",
              })}{" "}
              · {appointmentTime(receipt.starts_at)} às{" "}
              {appointmentTime(receipt.ends_at)}
            </p>
            <p className="class-help">
              Horários de São Paulo. Esta página consulta a situação atual da
              inscrição. Para dúvidas, alterações ou cancelamento, fale com a
              empresa.
            </p>
            <div className="class-receipt-actions">
              {contact && (
                <a
                  className="button"
                  href={contact}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Falar com a empresa
                </a>
              )}
              <Link className="button secondary" href={route}>
                Ver outras turmas
              </Link>
            </div>
          </section>
        ) : (
          <>
            {query.recibo && (
              <p className="notice error" role="alert">
                Não foi possível confirmar a situação desta inscrição. Atualize
                a página ou fale com a empresa antes de fazer outra reserva.
              </p>
            )}
            <section className="booking-card">
              <div className="booking-section-heading">
                <span className="booking-step-number">1</span>
                <div>
                  <h2>Escolha o dia e a atividade</h2>
                  <p>
                    As vagas são atualizadas a cada consulta. Horários de São
                    Paulo.
                  </p>
                </div>
              </div>
              <form method="get" className="class-filter">
                <label htmlFor="public-classes-day">
                  Dia da atividade
                  <input
                    id="public-classes-day"
                    name="day"
                    type="date"
                    defaultValue={day}
                    min={today}
                    max={maxDay}
                    required
                  />
                </label>
                <button>Consultar turmas</button>
              </form>
              {failed ? (
                <p role="alert" className="notice error">
                  Não foi possível consultar as vagas. Atualize a página em
                  instantes.
                </p>
              ) : sessions.length ? (
                <div className="public-class-grid">
                  {sessions.map((session) => (
                    <article
                      key={session.id}
                      className={`public-class-card ${session.id === selected?.id ? "selected" : ""}`}
                    >
                      <div className="class-badges">
                        <span className="class-badge">
                          <Icon name="clock" size={14} />
                          {appointmentTime(session.starts_at)}–
                          {appointmentTime(session.ends_at)}
                        </span>
                        <span
                          className={`class-badge ${session.remaining === 0 ? "canceled" : "reserved"}`}
                        >
                          {session.remaining === 0
                            ? "Lotada"
                            : `${session.remaining} vaga(s)`}
                        </span>
                      </div>
                      <h3>{session.title}</h3>
                      <p>
                        {session.service.name}
                        <br />
                        com {session.professional.name}
                      </p>
                      <strong>
                        {money(session.service.price_cents)}
                        <small> por participante</small>
                      </strong>
                      {session.remaining > 0 ? (
                        <Link
                          className={`button ${session.id === selected?.id ? "secondary" : ""}`}
                          href={`${route}?${new URLSearchParams({ day, turma: session.id })}#inscricao`}
                        >
                          {session.id === selected?.id
                            ? "Continuar inscrição"
                            : "Escolher esta turma"}
                          <Icon name="arrow-right" size={16} />
                        </Link>
                      ) : (
                        <p className="class-help">
                          Consulte outra atividade ou data.
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon="calendar"
                  title="Nenhuma turma aberta neste dia"
                  description="Escolha outra data ou entre em contato com a empresa para conhecer as próximas atividades."
                />
              )}
            </section>
            {selected && selected.remaining > 0 && !failed && (
              <section
                className="booking-card class-public-form-panel"
                id="inscricao"
              >
                <div className="booking-section-heading">
                  <span className="booking-step-number">2</span>
                  <div>
                    <h2>Vamos reservar seu lugar?</h2>
                    <p>Preencha os dados de quem vai participar.</p>
                  </div>
                </div>
                <PublicClassReservationForm
                  key={`${selected.id}-${day}`}
                  session={selected}
                  action={reserveClass.bind(null, slug)}
                  requestId={randomUUID()}
                />
              </section>
            )}
          </>
        )}
        <footer className="class-public-footer">
          <Link href="/">Agendamento por Web Fidelize</Link>
          <span>
            Dados visíveis somente à empresa e ao profissional autorizado.
          </span>
        </footer>
      </div>
    </main>
  );
}
