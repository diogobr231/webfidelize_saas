import Link from "next/link";
import { money, niches, plans } from "@/lib/catalog";
const whatsapp =
  "https://wa.me/5518997695445?text=Ol%C3%A1!%20Quero%20conhecer%20a%20Web%20Fidelize.";
export default function Home() {
  return (
    <main>
      <nav>
        <Link href="/" className="brand">
          web<span>fidelize</span>
          <span> •</span>
        </Link>
        <div className="links">
          <a className="optional" href="#segmentos">
            Segmentos
          </a>
          <a className="optional" href="#planos">
            Planos
          </a>
          <Link href="/entrar">Entrar →</Link>
        </div>
      </nav>
      <section className="hero">
        <div>
          <span className="tag">GESTÃO SIMPLES. RELAÇÕES DURADOURAS.</span>
          <h1>
            Seu negócio
            <br />
            organizado.
            <br />
            <em>Seu cliente por perto.</em>
          </h1>
          <p>
            Reúna agenda, clientes e equipe em um só lugar. Menos tempo com
            tarefas, mais espaço para o seu negócio crescer.
          </p>
          <div className="actions">
            <Link className="button" href="/cadastro">
              Começar 7 dias grátis ↗
            </Link>
            <a
              className="button secondary"
              href={whatsapp}
              target="_blank"
              rel="noreferrer"
            >
              Falar com a gente
            </a>
          </div>
          <small className="muted">
            Sem cartão para testar · Feito para pequenos negócios
          </small>
        </div>
        <div className="panel preview" id="demonstracao">
          <header>
            <strong>Uma rotina mais leve</strong>
            <span className="badge">Demonstração visual</span>
          </header>
          <div className="row">
            <div>
              01 · Conheça seu cliente
              <small>Histórico e contato em um lugar</small>
            </div>
            <span>↗</span>
          </div>
          <div className="row">
            <div>
              02 · Organize os horários
              <small>Agenda compartilhada com sua equipe</small>
            </div>
            <span>◷</span>
          </div>
          <div className="row">
            <div>
              03 · Acompanhe o negócio
              <small>Indicadores para decidir com clareza</small>
            </div>
            <span>▥</span>
          </div>
          <p style={{ fontSize: 12 }}>
            Visão ilustrativa do produto. Sem dados de empresas reais.
          </p>
        </div>
      </section>
      <section className="section" id="segmentos">
        <span className="tag">UM NEGÓCIO ÚNICO. UMA EXPERIÊNCIA SUA.</span>
        <h2>Qual é o seu segmento?</h2>
        <p>Escolha sua entrada. A mesma plataforma, adaptada à sua rotina.</p>
        <div className="grid niches">
          {niches.map((n, i) => (
            <Link className="card" href={`/entrar/${n.slug}`} key={n.slug}>
              <span className="icon" style={{ color: n.color }}>
                {n.icon}
              </span>
              <h3>{n.name}</h3>
              <p>{n.description}</p>
              <span className="badge">
                {i < 4 ? "Acessar →" : "Conhecer o segmento →"}
              </span>
            </Link>
          ))}
        </div>
      </section>
      <section className="section" id="planos">
        <span className="tag">CRESÇA NO SEU RITMO</span>
        <h2>O próximo capítulo começa aqui.</h2>
        <p>Teste por 7 dias. Escolha o plano que acompanha sua equipe.</p>
        <div className="grid">
          {plans.map((p, i) => (
            <article className={`card ${i === 1 ? "featured" : ""}`} key={p.id}>
              <span className="tag">
                {i === 1 ? "MAIS ESCOLHIDO" : "SEU PRÓXIMO PASSO"}
              </span>
              <h3>{p.name}</h3>
              <div className="price">
                {money(p.cents)}
                <small>/mês</small>
              </div>
              <ul className="list">
                <li>
                  Até {p.staff}{" "}
                  {p.staff === 1 ? "profissional" : "profissionais"}
                </li>
                <li>Cadastro de clientes e serviços</li>
                <li>Agenda da equipe</li>
                <li>Página de agendamento prevista no MVP</li>
                <li>Trial de 7 dias</li>
              </ul>
              <Link
                className={`button ${i !== 1 ? "secondary" : ""}`}
                href="/cadastro"
              >
                Experimentar grátis →
              </Link>
            </article>
          ))}
        </div>
        <p style={{ fontSize: 13 }}>
          MVP em implantação. Cobrança e agendamento público ainda em validação.
          Módulos por nicho e IA serão disponibilizados em etapas.
        </p>
      </section>
      <section className="panel section">
        <span className="tag">GENTE DE VERDADE, DO OUTRO LADO</span>
        <h2>Vamos organizar o seu negócio?</h2>
        <p>
          Converse com a Web Fidelize e conheça a proposta para sua empresa.
        </p>
        <a className="button" href={whatsapp} target="_blank" rel="noreferrer">
          Conversar pelo WhatsApp ↗
        </a>
      </section>
      <footer>
        <span>© {new Date().getFullYear()} Web Fidelize</span>
        <span>Agenda · Clientes · Equipe · Conexões</span>
        <Link href="/entrar">Acessar minha conta →</Link>
      </footer>
    </main>
  );
}
