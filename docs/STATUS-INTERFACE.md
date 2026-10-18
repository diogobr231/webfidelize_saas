# Modernização da interface — 18/10/2026

## Entrega

Padrão visual aplicado à landing comercial, autenticação e acessos por segmento, seleção de empresa, painel, cadastros, agenda, disponibilidade, equipe, configuração guiada, página pública de reserva e administração. A direção combina navegação grafite, área operacional clara e destaques verde-azulados, com referência à hierarquia e simplicidade de Stripe, Linear e Vercel.

- Fonte Geist variável hospedada no projeto, com licença SIL OFL preservada; nenhuma dependência de fonte externa em runtime.
- Componentes compartilhados `Brand`, `Icon`, `PageHeader` e `EmptyState`; ícones SVG decorativos, campos e botões consistentes.
- Menu móvel expansível, indicação da página atual, Escape com retorno de foco e alternativa com links visíveis sem JavaScript.
- Tabelas e calendário com rolagem interna quando necessário, formulários empilhados no celular e tipografia fluida.
- Estados de envio, erro, vazio e carregamento; transições discretas respeitam `prefers-reduced-motion`.
- FAQ comercial com `details` nativo. Conteúdo, preços, CTAs, avisos de demonstração e limitações da cobrança preservados.
- Reserva pública corrige o salto para `#horarios` quando o conteúdo chega após o carregamento inicial. O ajuste não muda o foco, não anima e é cancelado se o visitante já interagiu ou rolou a página.

Tokens, componentes, manutenção e origem da fonte: [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md).

## Arquivos principais

| Área                     | Arquivos                                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Base visual              | `src/app/globals.css`, `layout.tsx`, `fonts/*`, `src/components/ui/*`, `pending-button.tsx`                                  |
| Comercial e acesso       | `src/app/page.tsx`, `landing.css`, páginas de autenticação, `src/components/auth-shell.tsx`, `auth.css`                      |
| Operação e administração | `src/app/painel/**`, `src/app/admin/*`, `workspace-nav.tsx`, `agenda-experience.tsx`, `setup-guide.tsx`, `share-booking.tsx` |
| Primeiro acesso          | `src/app/comecar/*`, `src/components/onboarding/*`                                                                           |
| Reserva pública          | `src/app/agendar/[slug]/page.tsx`, `booking.css`, `src/components/booking/*`                                                 |

Não houve nova migração, mudança de RLS, alteração de Server Actions de negócio ou inclusão de biblioteca de UI.

## Validação executada

| Verificação                                   | Resultado                                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm build`                                  | Aprovado, incluindo TypeScript e geração das rotas                                       |
| `pnpm test`                                   | 22 testes unitários aprovados                                                            |
| `pnpm test:db`                                | 56 testes PostgreSQL/PGlite aprovados, incluindo isolamento e permissões                 |
| `TEST_DEMOS=1 pnpm exec tsx scripts/smoke.ts` | 28 verificações HTTP aprovadas                                                           |
| `pnpm test:landing`                           | 8 grupos aprovados: conteúdo, CTAs e SEO                                                 |
| `TEST_ONBOARDING_LIVE=1 pnpm test:onboarding` | 8 grupos aprovados: salvamento, repetição idempotente, retomada, erros e autorização     |
| `pnpm test:experience`                        | 10 grupos aprovados: reserva pública, comprovante, calendário, remarcação e cancelamento |
| Prettier e `git diff --check`                 | Aprovados nos arquivos trabalhados                                                       |

Os testes live usaram sessões próprias e empresa DEMO identificada no banco. O teste de primeiro acesso adicionou serviço e profissional explicitamente fictícios. O teste de reserva criou um atendimento fictício, remarcou e cancelou; os registros de teste permanecem identificados. Nenhuma empresa de cliente foi redefinida ou teve seus dados operacionais alterados nesta etapa.

Revisão no navegador incluiu painel, agenda e modal de atendimento, serviços, disponibilidade, configuração inicial, página pública, landing, login e consulta administrativa. Foram usadas larguras de 1280px, 390px e 320px em telas representativas; as páginas verificadas não apresentaram rolagem horizontal do documento. Calendário e tabela administrativa preservam a rolagem interna. Menu móvel, Escape, seleção de serviço, consulta de horários e FAQ foram exercitados.

Capturas locais da revisão ficam na pasta ignorada `test-results/ui-premium/`. Elas mostram dados fictícios, quando há cadastros de demonstração, e não são conteúdo comercial do produto.

## Limites e próximo passo

Esta entrega moderniza os fluxos existentes. A revisão visual foi feita no navegador Chromium do ambiente; não substitui homologação em aparelhos físicos, Safari, leitores de tela ou auditoria completa WCAG. Não houve teste de entrega de e-mail ou cadastro real de uma conta nova nesta etapa.

Continuam pendentes as integrações e funcionalidades já registradas no README, especialmente Mercado Pago, SMTP de produção e a homologação de cadastro, confirmação, recuperação e convites. Não foi criada cobrança nem realizada publicação na Vercel nesta etapa. O próximo passo comercial é configurar a aplicação Mercado Pago e homologar pagamentos em sandbox.
