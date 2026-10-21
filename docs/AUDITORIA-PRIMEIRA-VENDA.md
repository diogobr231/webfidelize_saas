# Auditoria para a primeira venda — Web Fidelize

> Registro histórico de 19/10/2026. A situação mais recente está em [STATUS-PILOTO](STATUS-PILOTO.md), com os incrementos posteriores de operações, e-mails e apresentação. Os resultados visuais abaixo correspondem à versão daquela data.

Concluída em **19/10/2026**. Escopo: código atual, build de produção executado localmente, banco Supabase do projeto Web Fidelize, fluxos com contas DEMO e revisão visual no navegador. Os relatórios `STATUS-*` documentam etapas anteriores; este relatório consolida a situação atual.

## Parecer

O núcleo de **agenda, clientes, serviços, profissionais e reservas públicas está funcional e foi validado**, incluindo isolamento entre empresas e uso em telas pequenas. Há material suficiente para apresentar o produto e conduzir um piloto acompanhado de um negócio de serviços.

**A contratação paga por autosserviço ainda não está pronta.** Mercado Pago exige desenvolvimento do checkout, webhook e conciliação, além da criação da aplicação do provedor e da homologação. Confirmação de cadastro e recuperação de senha com e-mail real também precisam ser homologadas no ambiente de produção. A página de planos não simula cobrança nem ativa uma assinatura.

Não foram removidos recursos existentes, reiniciados trials ou alteradas empresas reais para produzir as evidências. Os testes de escrita usaram empresas identificadas como DEMO. As entradas por nicho compartilham o núcleo atual; não representam módulos especializados já entregues.

## Problemas por impacto nas vendas e correções

| Prioridade | Problema e impacto | Correção ou situação atual |
| --- | --- | --- |
| P0 — bloqueia contratação online | Sem fluxo completo de pagamento, não é possível vender e liberar acesso pago automaticamente com segurança. | **Pendente:** implementação e homologação Mercado Pago. Retorno de checkout, contato por WhatsApp ou mudança visual não concedem assinatura ativa. |
| P1 — acesso e confiança | Convite e profissional eram conceitos separados sem gestão completa do vínculo; faltava revogação segura e havia possibilidade de atribuir `user_id` pelo INSERT direto. | **Corrigido:** OWNER vincula contas existentes, desvincula e revoga com confirmação; RPC valida empresa/papel e concorrência. INSERT direto perdeu acesso à coluna. Revogação funciona mesmo após bloqueio comercial e preserva agenda/cadastros. |
| P1 — clareza comercial | Preços e limites poderiam divergir entre site e assinatura. | **Corrigido:** landing, `/planos` e assinatura usam o catálogo autorizado do banco. Falha de consulta não inventa preços. Trial, utilização e estado vêm do backend. |
| P1 — confiança nos indicadores | Contagens limitadas pela API e receita inferida de atendimentos comprometeriam decisões. | **Corrigido:** agregação no PostgreSQL com RLS e filtros de período. Faturamento e vendas aparecem indisponíveis porque não existe registro financeiro integrado. Datas históricas desconhecidas não foram inventadas. |
| P1 — uso diário e celular | Listas limitadas aos primeiros 100 registros, atalhos incorretos e risco de ações destrutivas sem confirmação. | **Corrigido:** busca e paginação por 25 registros com total autorizado, atalhos reparados, confirmação também no servidor, retorno de foco e bloqueio durante envio. Preço vazio/inválido deixou de virar zero. |
| P1 — percepção de produto | Navegação, formulários e feedback pouco adaptados ao celular. | **Melhorado e verificado:** atalhos inferiores, menu responsivo, tabelas em cartões, alvos de toque, skeletons e mensagens de sucesso/erro. Transições respeitam movimento reduzido. |
| P1 — implantação | Novo usuário pode não receber ou concluir os e-mails de acesso no ambiente definitivo. | **Pendente:** SMTP de produção, URLs exatas de retorno e teste completo com caixa de e-mail real, inclusive primeira empresa e recuperação de senha. |
| P2 — identidade e retenção | Falta de identidade da empresa e orientação dentro do produto. | **Implementado:** personalização restrita ao OWNER, logotipo privado com publicação explícita, ajuda por assunto, tutoriais e solicitações gerenciadas pelo SUPER_ADMIN. |
| P2 — operação | Edição/arquivamento de cadastros, feriados e bloqueios pontuais ainda incompletos. | **Pendente:** priorizar conforme o piloto. A seleção de clientes/serviços no formulário da agenda ainda carrega até 1.000 registros; as listas principais já são paginadas. |

## O que foi validado

- Login de contas existentes, proteção de rotas, autorização no servidor e RLS; OWNER, MANAGER e EMPLOYEE mantêm escopos diferentes. Cliente não acessa SUPER_ADMIN.
- Configuração guiada: salvar, continuar depois, retomar, erros por campo e reenvio sem duplicação, preservando trial/plano/publicação.
- Clientes, serviços e profissionais: criação autorizada, validação, busca, paginação e estados vazios.
- Agenda diária/semanal, disponibilidade semanal, prevenção de conflitos e limites do plano; reserva pública persistida, reenvio idempotente, comprovante assinado, calendário, remarcação e cancelamento pelo responsável.
- Equipe: convite por link, aceite por conta confirmada, vínculo e revogação. A mesma identidade autenticada perdeu acesso à empresa após a revogação e manteve acesso à própria empresa.
- Dashboard: métricas correspondentes aos registros autorizados, períodos válidos, gráfico com seleção por teclado e alternativa em tabela. Agregações testadas com mais de 1.500 registros.
- Personalização: upload real no Storage, rejeição de tipo inválido, isolamento, publicação/despublicação e limpeza do arquivo criado pelo teste. O bucket permanece privado.
- Ajuda: conteúdos publicados, filtros, abertura de solicitação sem duplicação, visibilidade por papel/empresa e gerenciamento administrativo testado nas políticas e funções SQL. Não há disparo automático de mensagens.
- Planos e assinatura: catálogo real, limite de profissionais e situação comercial do banco, sem ativação paga simulada.

## Testes executados e resultados

Todos os grupos abaixo terminaram aprovados nesta rodada. O build passou após as alterações de aplicação. Os últimos ajustes posteriores foram em scripts, documentação e nomes de migração sincronizados com o histórico remoto.

| Verificação | Resultado | Ambiente e limite da evidência |
| --- | --- | --- |
| TypeScript e build | Aprovados | `pnpm typecheck` e `pnpm build`; aplicação de produção local. |
| Testes unitários | **40 aprovados** | `pnpm test`. |
| Fundação e isolamento SQL | **56 verificações aprovadas** | `pnpm test:db`, PostgreSQL descartável PGlite. |
| Dashboard SQL | **10 verificações aprovadas** | `pnpm test:dashboard:db`. |
| Personalização SQL | **11 verificações aprovadas** | `pnpm test:personalization:db`. |
| Ajuda SQL | **21 verificações aprovadas** | `pnpm test:help:db`. |
| Equipe SQL | **18 verificações aprovadas** | `pnpm test:team:db`; inclui revogação após trial vencido, inadimplência e suspensão. |
| Landing/SEO | **8 grupos aprovados** | `pnpm test:landing`; conteúdo, CTAs e metadados HTTP. |
| Smoke HTTP | **28 verificações aprovadas** | Páginas públicas, oito demonstrações e bloqueios de acesso. |
| Reserva e agenda | **10 grupos aprovados** | `pnpm test:experience`; HTTP local → Supabase real → resposta persistida. |
| Configuração guiada | **8 grupos aprovados** | `pnpm test:onboarding`; contas e dados DEMO. |
| Listas operacionais | **7 grupos aprovados** | `pnpm test:records`; leitura, busca, totais e paginação. |
| Logotipos | **7 grupos aprovados** | `pnpm test:personalization`; Storage HTTP real, arquivo de teste removido. |
| Auditoria de fluxos | **10 grupos aprovados** | `pnpm test:audit`; dashboard, planos, permissões, validação e suporte. |
| Equipe ponta a ponta | **9 grupos aprovados** | `pnpm test:team`; Auth real, Server Actions, RPC e RLS. |
| Dependências de produção | **0 vulnerabilidades conhecidas reportadas** | `pnpm audit --prod --json`; retrato da execução, não garantia de ausência de vulnerabilidades. |

Total das suítes SQL: **116 verificações**. Fixtures locais de Storage não substituem o serviço real; por isso também foi executada a suíte HTTP de personalização. Os testes remotos não usam a chave `service_role` para simular autorização de um cliente.

Foram corrigidas também expectativas antigas dos testes que não correspondiam à interface atual. O teste de acesso administrativo verifica ausência de conteúdo privilegiado e o marcador de bloqueio do Next.js, inclusive quando o shell de uma resposta em streaming retorna HTTP 200. A comparação de dashboard foi repetida sem gravações concorrentes de outros testes, para comparar o mesmo conjunto de dados.

## Revisão mobile, acessibilidade e velocidade

| Largura | Telas e interações verificadas |
| --- | --- |
| **320 px** | Dashboard, agenda, primeiros passos, personalização, assinatura, ajuda, equipe, landing, planos, cadastro e reserva pública. Sem rolagem horizontal indevida nas telas verificadas. |
| **390 px** | Dashboard, navegação inferior, busca de clientes, menu, disponibilidade e modal de confirmação. Reserva pública com serviço/profissional/data e seleção do horário atualizando o resumo. |
| **768 px** | Dashboard, agenda, personalização, assinatura e ajuda. |
| **1280 px** | Dashboard e navegação lateral; gráfico com seleção pela seta do teclado e atualização do valor apresentado. |

O modal abre com foco em **Voltar**, fecha com **Escape** e devolve o foco ao botão de origem. Confirmadores fechados ficam desabilitados para não executar uma ação por Enter acidental. Os horários inspecionados da reserva têm alvo de toque de **44 px**. Nenhum turno foi removido no teste visual.

Evidências locais em `test-results/audit/`: `dashboard-390.png`, `dashboard-1280.png`, `confirmacao-mobile.png`, `equipe-320.png`, `ajuda-768.png` e `agendamento-320.png`. Essa pasta é ignorada pelo Git para não versionar artefatos de execução.

Medição HTTP local, três amostras por rota: medianas de **108 ms** na landing, **83 ms** em planos e **87 ms** na reserva pública. São tempos do ambiente local; não são Core Web Vitals, teste de carga, resultado em 4G ou garantia do deploy. Não foram testados aparelhos físicos, Safari/iOS, leitor de tela completo ou uma auditoria WCAG integral. Essas verificações continuam recomendadas antes de expandir a base.

## Banco, segurança e preservação

As cinco migrações deste incremento foram aplicadas no projeto separado da Web Fidelize e seus nomes locais refletem o histórico remoto:

- `20261019022826_commercial_catalog.sql`
- `20261019022834_executive_dashboard.sql`
- `20261019022843_company_personalization.sql`
- `20261019022850_help_center.sql`
- `20261019125532_professional_membership.sql`

A reconexão do Supabase resolveu a sessão expirada que impedia a última aplicação. **Não há migração deste incremento aguardando aplicação.**

A consulta final aos security advisors apontou o aviso de **proteção contra senhas vazadas desabilitada**. Avaliar a disponibilidade e habilitar no projeto antes da abertura pública; a referência é a [documentação de segurança de senhas do Supabase](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Não foi alterado o plano de infraestrutura para isso. A ausência de outros avisos nessa consulta não substitui os testes nem uma revisão independente de segurança.

Antes de produção, trocar as credenciais provisórias de administrador e impedir o uso comercial das contas DEMO. As senhas não estão no repositório nem neste relatório. Segredos de reserva continuam exclusivos do servidor; o painel não utiliza `service_role`. Logotipos são privados e somente o arquivo escolhido pode ser publicado explicitamente pela empresa.

Os testes mantiveram somente registros fictícios identificados: reserva cancelada, cadastros do fluxo guiado, solicitação de suporte e auditoria de convite aceito. O vínculo temporário da equipe foi removido; o teste comparou profissionais, disponibilidade, clientes, agenda e situação comercial antes/depois. O upload de teste foi removido e as preferências originais foram restauradas. Nenhum e-mail ou WhatsApp foi enviado.

## O que falta para o primeiro cliente pagante

1. **Concluir cobrança de ponta a ponta.** Criar a aplicação Mercado Pago; configurar credenciais apenas no servidor; implementar tentativa persistida, checkout, notificação verificada, deduplicação, consulta autoritativa, conciliação e estados de inadimplência. Homologar eventos inválidos, duplicados, fora de ordem, renovação, cancelamento e regularização antes de cobrar. Roteiro em [MERCADO_PAGO.md](MERCADO_PAGO.md).
2. **Homologar entrada com e-mail real.** Configurar SMTP e testar cadastro, confirmação, primeira empresa, recuperação e convite no domínio definitivo. Contas DEMO previamente confirmadas não comprovam entrega de e-mail.
3. **Publicar e validar o ambiente definitivo.** Vercel com HTTPS, `APP_URL` correto, variáveis privadas, redirects exatos do Supabase e segredo de reserva correspondente ao hash no banco. Repetir reserva pública e isolamento em homologação publicada. Esta rodada não realizou deploy de produção.
4. **Preparar operação mínima.** Informações comerciais reais, termos/privacidade revisados para o negócio, suporte, backup e restauração testada, credenciais próprias e remoção da dependência de contas de teste.
5. **Conduzir um piloto em um segmento atendido pelo núcleo atual.** Configurar serviços, profissionais e horários reais com o empreendedor; acompanhar uma reserva no celular, sua operação diária e a contratação validada. Registrar as dificuldades antes de expandir módulos.

Recomendação comercial baseada no escopo auditado: começar por um negócio de serviços que compra agenda e organização de clientes, como um salão. Manter os preços configurados durante o piloto até observar objeções e disposição real de pagamento. Não prometer comandas, caixa, rotas, prontuário, chatbot, publicação em redes sociais ou IA: esses módulos ainda são futuros. Edição de cadastros e bloqueios por data devem ser priorizados se forem indispensáveis para a rotina do primeiro piloto.

## Arquivos e reprodução

- Interface e fluxos: `src/app/painel`, `src/app/admin/ajuda`, `src/app/planos`, `src/app/agendar`, `src/components/dashboard`, `src/components/help`, `src/components/confirm-submit.tsx`, `src/components/workspace-nav.tsx` e estilos associados.
- Regras e validação: `src/lib/auth.ts`, `commercial.ts`, `dashboard.ts`, `team.ts`, `help.ts`, `company-personalization.ts`, `company-logo.ts` e `record-list.ts`.
- Persistência: cinco migrações SQL acima; autorização também no servidor.
- Verificação: `tests/`, scripts `test-*-db.ts` e `test-*-live.ts`, comandos no `package.json` e CI em `.github/workflows/ci.yml`.
- Detalhes: [README](../README.md), [personalização](PERSONALIZACAO.md) e [equipe e acessos](EQUIPE-ACESSOS.md).

As instruções de execução e os efeitos dos testes DEMO estão no README. Não execute scripts de escrita contra empresas de clientes. Não use este relatório para afirmar que pagamentos, SMTP, infraestrutura de produção ou módulos futuros já foram homologados.
