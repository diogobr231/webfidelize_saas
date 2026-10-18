import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/ui/brand";
import { Icon } from "@/components/ui/icon";
import "./auth.css";

export function AuthShell({
  title,
  eyebrow = "SEU ESPAÇO DE TRABALHO",
  description,
  children,
  footer,
}: {
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="auth-shell">
      <aside className="auth-brand-panel" aria-label="Web Fidelize">
        <Brand href="/" className="auth-brand" />
        <div className="auth-brand-content">
          <span className="auth-brand-kicker">
            MENOS IMPROVISO. MAIS CLAREZA.
          </span>
          <h2>
            Seu negócio.
            <br />
            Sua rotina.
            <br />
            <span>Tudo conectado.</span>
          </h2>
          <p>
            Um lugar para organizar seus atendimentos e estar mais perto de quem
            escolhe você.
          </p>
          <div className="auth-product-map" aria-label="Recursos da plataforma">
            <div className="auth-product-map-top">
              <span className="auth-product-symbol">
                <Icon name="calendar" />
              </span>
              <div>
                <strong>Uma rotina bem organizada</strong>
                <span>Do agendamento ao atendimento</span>
              </div>
            </div>
            <div className="auth-product-items">
              <span>
                <Icon name="calendar" size={17} /> Sua agenda
              </span>
              <span>
                <Icon name="users" size={17} /> Seus clientes
              </span>
              <span>
                <Icon name="link" size={17} /> Seu link
              </span>
            </div>
          </div>
        </div>
        <div className="auth-brand-footer">
          <span className="auth-brand-dot" /> Feito para pequenos negócios.
        </div>
      </aside>
      <section className="auth-content-panel" aria-labelledby="auth-title">
        <Link className="auth-back" href="/">
          Voltar ao site <Icon name="arrow-up-right" size={15} />
        </Link>
        <div className="auth-content">
          <header className="auth-heading">
            <span className="auth-eyebrow">{eyebrow}</span>
            <h1 id="auth-title">{title}</h1>
            {description ? (
              <div className="auth-description">{description}</div>
            ) : null}
          </header>
          {children}
          {footer ? <div className="auth-footer">{footer}</div> : null}
        </div>
        <div className="auth-panel-footer">
          <Icon name="shield" size={14} /> Seu acesso acompanha as permissões da
          sua empresa.
        </div>
      </section>
    </main>
  );
}
