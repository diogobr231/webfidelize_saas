import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { publicDatabase } from "@/lib/supabase/public";
import { signedPublicLogo } from "@/lib/company-logo";
import { money } from "@/lib/catalog";
import {
  bookingReceiptSchema,
  readDetailedReceipt,
  validReceipt,
  type BookingReceipt,
} from "@/lib/booking-receipt";
import { ReserveForm } from "@/components/booking/reserve-form";
import { BookingAnchor } from "@/components/booking/booking-anchor";
import { Icon } from "@/components/ui/icon";
import "./booking.css";

export const dynamic = "force-dynamic";

type Catalog = {
  name: string;
  slug: string;
  is_demo: boolean;
  description?: string;
  address?: string;
  phone?: string;
  theme?: string;
  logo_path?: string | null;
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
    recibo?: string;
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
  const logo = await signedPublicLogo(db, catalog.logo_path);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const lastDay = new Date(`${today}T12:00:00Z`);
  lastDay.setUTCDate(lastDay.getUTCDate() + 60);
  const maxDay = lastDay.toISOString().slice(0, 10);
  const validDay =
    q.day &&
    /^\d{4}-\d{2}-\d{2}$/.test(q.day) &&
    q.day >= today &&
    q.day <= maxDay
      ? q.day
      : today;
  const selected = catalog.services.find((s) => s.id === q.service);
  const professional = catalog.professionals.find(
    (p) => p.id === q.professional,
  );
  const theme = ["teal", "blue", "violet", "rose"].includes(catalog.theme || "")
    ? catalog.theme
    : "teal";
  const initials = catalog.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  const phone = (catalog.phone || "").replace(/\D/g, "");
  const contactPhone = /^\d{10,11}$/.test(phone)
    ? `55${phone}`
    : /^55\d{10,11}$/.test(phone)
      ? phone
      : "";
  const contact = contactPhone ? `https://wa.me/${contactPhone}` : null;
  const secret = process.env.BOOKING_GATEWAY_SECRET;
  const claims =
    q.recibo && secret ? readDetailedReceipt(q.recibo, slug, secret) : null;
  let receipt: BookingReceipt | null = null;
  let receiptUnavailable = false;
  if (claims && secret) {
    const result = await db.rpc("public_booking_receipt", {
      slug,
      request_id: claims.request_id,
      gateway_secret: secret,
    });
    const parsed = bookingReceiptSchema.safeParse(result.data);
    if (!result.error && parsed.success && parsed.data.id === claims.receipt.id)
      receipt = parsed.data;
    else receiptUnavailable = true;
  }
  const legacyReceipt =
    q.confirmado &&
    q.proof &&
    secret &&
    validReceipt(slug, q.confirmado, q.proof, secret)
      ? q.confirmado
      : null;
  const confirmed = Boolean(receipt || legacyReceipt);
  let slots: { starts_at: string }[] = [];
  let failed = false;
  if (selected && professional && !confirmed) {
    const result = await db.rpc("public_slots", {
      slug,
      service: selected.id,
      professional: professional.id,
      day: validDay,
    });
    slots = result.data || [];
    failed = Boolean(result.error);
  }
  const currentStep = confirmed ? 3 : selected && professional ? 2 : 1;
  return (
    <main className="booking-page" data-theme={theme}>
      <div className="booking-topbar">
        <div className="booking-shell booking-topbar-inner">
          <Link href={`/agendar/${slug}`} className="booking-business">
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
                    borderRadius: "inherit",
                  }}
                />
              ) : (
                initials
              )}
            </span>
            <span>{catalog.name}</span>
          </Link>
          <span className="booking-online">
            <span aria-hidden="true" />
            Agendamento online
          </span>
        </div>
      </div>
      <div className="booking-shell">
        <header className="booking-hero">
          <div className="booking-hero-copy">
            <span className="booking-eyebrow">
              SEU PRÓXIMO HORÁRIO, SEM COMPLICAÇÃO
            </span>
            <h1>
              Reserve um tempo
              <br />
              para você.
            </h1>
            <p>
              {catalog.description ||
                `Escolha seu serviço e encontre o melhor horário com ${catalog.name}. É simples, rápido e sem precisar instalar um aplicativo.`}
            </p>
            <div className="booking-details">
              {catalog.address ? (
                <span>
                  <Icon name="building" size={15} />
                  {catalog.address}
                </span>
              ) : null}
              {contact ? (
                <a href={contact} target="_blank" rel="noopener noreferrer">
                  <Icon name="phone" size={15} />
                  Fale com a empresa <Icon name="arrow-up-right" size={14} />
                </a>
              ) : null}
            </div>
          </div>
          <div className="booking-hero-art" aria-hidden="true">
            <div className="booking-art-orbit" />
            <div className="booking-art-card">
              <Icon name="calendar" size={30} />
              <span>
                Mais facilidade
                <br />
                <strong>para o seu dia.</strong>
              </span>
              <div className="booking-art-lines">
                <i />
                <i />
                <i />
              </div>
            </div>
            <span className="booking-art-badge">
              <Icon name="clock" size={14} />
              No seu tempo.
            </span>
          </div>
        </header>
        {catalog.is_demo ? (
          <div className="booking-notice booking-demo">
            <strong>DEMONSTRAÇÃO</strong>
            <span>
              Empresa e serviços fictícios para testes. Nenhum atendimento real
              será realizado.
            </span>
          </div>
        ) : null}
        <ol className="booking-progress" aria-label="Etapas do agendamento">
          {["Serviço e profissional", "Dia e horário", "Confirmação"].map(
            (label, i) => (
              <li
                key={label}
                data-current={currentStep === i + 1}
                data-complete={currentStep > i + 1}
                aria-current={currentStep === i + 1 ? "step" : undefined}
              >
                <span>
                  {currentStep > i + 1 ? (
                    <Icon name="check" size={14} />
                  ) : (
                    i + 1
                  )}
                </span>
                <span>{label}</span>
              </li>
            ),
          )}
        </ol>
        {q.erro ? (
          <div className="booking-notice booking-error" role="alert">
            <strong>
              {q.erro === "configuracao"
                ? "Reservas temporariamente indisponíveis."
                : "Não conseguimos concluir sua reserva."}
            </strong>
            <span>
              {q.erro === "configuracao"
                ? "Tente novamente mais tarde ou fale com a empresa."
                : "Confira seus dados e consulte os horários novamente. O horário pode ter sido ocupado ou o limite de tentativas pode ter sido atingido."}
            </span>
          </div>
        ) : null}
        {receiptUnavailable ? (
          <div className="booking-notice" role="alert">
            <strong>Não conseguimos consultar os detalhes agora.</strong>
            <span>
              Sua solicitação já foi registrada. Atualize esta página para
              consultar o estado atual ou fale com a empresa.
            </span>
          </div>
        ) : null}
        {(q.recibo && !claims) || (q.confirmado && !legacyReceipt) ? (
          <div className="booking-notice booking-error" role="alert">
            Este link de confirmação é inválido. Confira o endereço completo
            recebido após reservar.
          </div>
        ) : null}
        {confirmed ? (
          <section
            className="booking-confirmation booking-card"
            aria-labelledby="booking-confirmation-title"
          >
            <span className="booking-confirmation-icon">
              <Icon name="calendar" size={28} />
            </span>
            <span className="booking-eyebrow">
              {receipt?.status === "canceled"
                ? "RESERVA CANCELADA"
                : receipt?.status === "completed"
                  ? "ATENDIMENTO CONCLUÍDO"
                  : receipt
                    ? "TUDO CERTO"
                    : "COMPROVANTE DE RESERVA"}
            </span>
            <h2 id="booking-confirmation-title">
              {receipt?.status === "canceled"
                ? "Este agendamento foi cancelado."
                : receipt?.status === "completed"
                  ? "Seu atendimento foi concluído."
                  : receipt
                    ? "Seu agendamento está confirmado."
                    : "Reserva registrada."}
            </h2>
            <p>
              {receipt ? (
                <>
                  {catalog.name}{" "}
                  {receipt.status === "canceled"
                    ? "atualizou sua reserva. Você pode escolher um novo horário abaixo."
                    : "registrou sua reserva. Guarde este link para consultar os detalhes."}
                </>
              ) : (
                "Este comprovante antigo não informa alterações posteriores. Confirme a situação com a empresa."
              )}
            </p>
            {receipt ? (
              <dl className="booking-confirmation-details">
                <div>
                  <dt>Serviço</dt>
                  <dd>{receipt.service_name}</dd>
                </div>
                <div>
                  <dt>Profissional</dt>
                  <dd>{receipt.professional_name}</dd>
                </div>
                <div>
                  <dt>Quando</dt>
                  <dd>
                    {new Date(receipt.starts_at).toLocaleDateString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </dd>
                </div>
                <div>
                  <dt>Horário de São Paulo</dt>
                  <dd>
                    {new Date(receipt.starts_at).toLocaleTimeString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    às{" "}
                    {new Date(receipt.ends_at).toLocaleTimeString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="booking-reference">Referência: {legacyReceipt}</p>
            )}
            <div className="booking-confirmation-actions">
              {receipt && q.recibo && receipt.status !== "canceled" ? (
                <a
                  className="booking-button"
                  href={`/agendar/${slug}/calendario?recibo=${encodeURIComponent(q.recibo)}`}
                >
                  <Icon name="calendar" size={17} />
                  Adicionar ao calendário{" "}
                  <Icon name="arrow-up-right" size={15} />
                </a>
              ) : null}
              {contact ? (
                <a
                  className="booking-button booking-button-secondary"
                  href={contact}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon name="phone" size={16} />
                  Falar com a empresa
                </a>
              ) : null}
            </div>
            <p className="booking-small">
              Para alterar ou cancelar, entre em contato diretamente com a
              empresa.
            </p>
            <Link className="booking-text-link" href={`/agendar/${slug}`}>
              Fazer outro agendamento <Icon name="arrow-right" size={16} />
            </Link>
          </section>
        ) : !catalog.services.length || !catalog.professionals.length ? (
          <section className="booking-card booking-empty">
            <Icon name="calendar" size={30} />
            <h2>A agenda está sendo preparada.</h2>
            <p>Volte em breve para encontrar seu próximo horário.</p>
            {contact ? (
              <a className="booking-text-link" href={contact}>
                Fale com a empresa <Icon name="arrow-right" size={16} />
              </a>
            ) : null}
          </section>
        ) : (
          <div className="booking-content">
            <div className="booking-main-column">
              <section className="booking-card" id="escolher">
                <div className="booking-section-heading">
                  <span className="booking-step-number">1</span>
                  <div>
                    <h2>Como podemos cuidar do seu dia?</h2>
                    <p>Escolha o serviço, o profissional e a data desejada.</p>
                  </div>
                </div>
                <form
                  action={`/agendar/${slug}#horarios`}
                  method="get"
                  className="booking-selection"
                >
                  <fieldset className="booking-fieldset">
                    <legend>Escolha seu serviço</legend>
                    <div className="booking-services">
                      {catalog.services.map((service) => (
                        <label className="booking-service" key={service.id}>
                          <input
                            type="radio"
                            name="service"
                            value={service.id}
                            required
                            defaultChecked={selected?.id === service.id}
                          />
                          <span className="booking-service-body">
                            <strong>{service.name}</strong>
                            <span>
                              <Icon name="clock" size={13} />
                              {service.duration} minutos
                            </span>
                          </span>
                          <span className="booking-service-price">
                            {money(service.price_cents)}
                          </span>
                          <span
                            className="booking-radio-mark"
                            aria-hidden="true"
                          />
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div className="booking-fields">
                    <div>
                      <label htmlFor="professional">Com quem?</label>
                      <select
                        id="professional"
                        name="professional"
                        required
                        defaultValue={
                          professional?.id ||
                          (catalog.professionals.length === 1
                            ? catalog.professionals[0].id
                            : "")
                        }
                      >
                        <option value="">Selecione um profissional</option>
                        {catalog.professionals.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="day">Qual dia?</label>
                      <input
                        type="date"
                        id="day"
                        name="day"
                        required
                        min={today}
                        max={maxDay}
                        defaultValue={validDay}
                      />
                    </div>
                  </div>
                  <button className="booking-button">
                    Ver horários disponíveis{" "}
                    <Icon name="arrow-right" size={17} />
                  </button>
                </form>
              </section>
              {selected && professional ? (
                failed ? (
                  <section
                    className="booking-card booking-empty"
                    role="alert"
                    id="horarios"
                  >
                    <h2>Não foi possível carregar os horários.</h2>
                    <p>Tente consultar novamente em alguns instantes.</p>
                  </section>
                ) : !slots.length ? (
                  <section className="booking-card booking-empty" id="horarios">
                    <Icon name="calendar" size={30} />
                    <h2>Vamos tentar outro dia?</h2>
                    <p>
                      Não há horários disponíveis para esta combinação.
                      Selecione outra data ou profissional acima.
                    </p>
                    <a className="booking-text-link" href="#day">
                      Escolher outra data ↑
                    </a>
                  </section>
                ) : (
                  <ReserveForm
                    key={`${selected.id}:${professional.id}:${validDay}`}
                    slug={slug}
                    service={selected}
                    professional={professional}
                    day={validDay}
                    slots={slots}
                    requestId={randomUUID()}
                  />
                )
              ) : null}
            </div>
            <aside className="booking-aside">
              <div className="booking-aside-icon">
                <Icon name="calendar" size={22} />
              </div>
              <h2>Seu próximo horário começa aqui.</h2>
              <p>Você escolhe. A empresa recebe sua reserva na agenda.</p>
              <ul>
                <li>
                  <Icon name="check" size={16} />
                  Horários disponíveis em tempo real
                </li>
                <li>
                  <Icon name="check" size={16} />
                  Sem criar conta ou instalar aplicativo
                </li>
                <li>
                  <Icon name="check" size={16} />
                  Sem pagamento nesta reserva
                </li>
              </ul>
              <div className="booking-aside-divider" />
              <span className="booking-small">
                Todos os horários seguem o fuso de São Paulo. Para dúvidas sobre
                o atendimento, fale com a empresa.
              </span>
              {contact ? (
                <a
                  className="booking-text-link"
                  href={contact}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Tirar uma dúvida <Icon name="arrow-up-right" size={16} />
                </a>
              ) : null}
            </aside>
          </div>
        )}
        <footer className="booking-footer">
          <span>Agendamento de {catalog.name}</span>
          <Link href="/" aria-label="Conheça a plataforma Web Fidelize">
            Feito com{" "}
            <strong>
              web<span>fidelize</span>
            </strong>
          </Link>
        </footer>
      </div>
      <BookingAnchor key={`${selected?.id}:${professional?.id}:${validDay}`} />
    </main>
  );
}
