# Web Fidelize

SaaS B2B multiempresa em reconstrução. Next.js App Router, TypeScript, Tailwind e Supabase. **Ainda não liberado para clientes pagantes.**

Auditoria atual, correções, evidências de testes e prioridades para o lançamento: [auditoria para a primeira venda](docs/AUDITORIA-PRIMEIRA-VENDA.md), de 19/10/2026.

O [sistema visual](docs/DESIGN-SYSTEM.md) documenta a identidade grafite e menta, a área de trabalho clara, os tokens, os componentes reutilizáveis e as regras de responsividade e acessibilidade. A fonte Geist é servida localmente, com origem e licença SIL OFL registradas no mesmo documento.

## Executar

Requisitos: Node.js 24 e pnpm 11.25.0 (instalação oficial do pnpm ou Corepack).

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env.local
# Preencha URL e chave PUBLICÁVEL do Supabase e APP_URL.
pnpm dev
```

Abra http://localhost:3000. Nunca coloque chaves secretas em NEXT*PUBLIC* ou no Git. `.env.local` está ignorado. Sem configuração, o site abre e o login informa a pendência, sem simular autenticação.

## Validação

```powershell
pnpm typecheck
pnpm test
pnpm test:db
pnpm test:dashboard:db
pnpm test:help:db
pnpm test:team:db
pnpm test:personalization:db
pnpm build
```

As suítes `*:db` usam PostgreSQL descartável via PGlite e não alteram empresas reais. `test:db` verifica as migrações e o isolamento com os papéis authenticated/anon; as suítes específicas cobrem agregações do dashboard, ajuda e chamados, vínculos/revogação de acessos e personalização. As fixtures locais do Storage verificam políticas SQL, mas não substituem o serviço HTTP real. `scripts/remote-isolation.sql` verifica parte das garantias no Supabase real, dentro de transação com ROLLBACK. Auth, SMTP, Storage e pagamentos exigem também homologação própria.

Os testes HTTP abaixo requerem um build local atualizado em execução. A senha deve ser fornecida apenas ao processo por entrada segura; não a inclua no código ou em arquivos:

| Comando                     | Opt-in e comportamento                                                                                                                                                                                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:landing`         | Consulta páginas públicas, CTAs e metadados; não cria contas.                                                                                                                                                                                                                                |
| `pnpm test:records`         | `TEST_RECORDS_LIVE=1` e `SEED_PASSWORD`; consulta clientes, serviços e profissionais de uma empresa DEMO, verifica busca, contagens, paginação e semântica mobile. Não grava dados comerciais.                                                                                               |
| `pnpm test:team`            | `TEST_TEAM_LIVE=1` e `SEED_PASSWORD`; convite, aceite, vínculo e revogação entre duas contas DEMO. Remove sua participação temporária e mantém a auditoria do convite fictício aceito; não envia e-mails. |
| `pnpm test:audit`           | `TEST_AUDIT_LIVE=1` e `SEED_PASSWORD`; compara dashboard e planos com dados autorizados, verifica acessos e suporte. O modo padrão pode abrir uma solicitação identificada como fictícia em empresa DEMO; `TEST_AUDIT_MODE=validation` executa o subconjunto de validação sem essa abertura. |
| `pnpm test:personalization` | `TEST_PERSONALIZATION_LIVE=1` e `SEED_PASSWORD`; valida upload, isolamento, publicação e despublicação em empresa DEMO. Recusa substituir um logotipo preexistente e remove somente o arquivo fictício criado pelo teste.                                                                    |
| `pnpm test:experience`      | Usa conta DEMO e cria uma reserva fictícia, mantida cancelada ao terminar; veja o roteiro abaixo.                                                                                                                                                                                            |
| `pnpm test:onboarding`      | `TEST_ONBOARDING_LIVE=1` e `SEED_PASSWORD`; cadastra serviços/profissionais fictícios em empresa DEMO, com pausa, retomada e reenvio.                                                                                                                                                        |

As suítes autenticadas usam sessões isoladas em memória, sem ler cookies do navegador. `TEST_BASE_URL` deve apontar para a aplicação local; `DEMO_EMAIL` seleciona uma conta sintética `@example.invalid`. Consulte as validações de cada script antes de executá-lo: autenticação, trial, banco e segredos necessários devem estar configurados. Não use empresas reais como fixtures.

Para validar a experiência com o Supabase de homologação e a aplicação local em execução:

```powershell
# Em um terminal: pnpm build e depois pnpm start.
# No terminal de teste, configure SEED_PASSWORD como variável temporária do processo.
# Não grave a senha em arquivos, histórico de comandos ou no repositório.
$env:DEMO_EMAIL = 'pet-shop@example.invalid'
$env:TEST_BASE_URL = 'http://localhost:3000'
pnpm test:experience
Remove-Item Env:SEED_PASSWORD -ErrorAction SilentlyContinue
```

`test:experience` lê a configuração do `.env.local` e aceita somente servidor local, conta `@example.invalid` e uma empresa marcada `is_demo=true`. Usa cookies SSR em memória, sem acessar os cookies do navegador. Verifica o painel, agenda diária/semanal, autorização no servidor, salvamento do perfil com os valores atuais, catálogo público, reserva via formulário, idempotência, comprovante, calendário, remarcação e cancelamento. Cria um cadastro identificado como **TESTE UX fictício** e mantém seu agendamento cancelado ao terminar, inclusive quando precisa limpar uma execução interrompida. Não apaga os dados de teste nem altera empresas reais. Requer a conta de demonstração ativa e `BOOKING_GATEWAY_SECRET` corretamente configurado; não substitui a revisão visual no navegador.

O roteiro do primeiro acesso exige consentimento explícito para criar cadastros fictícios em uma empresa de demonstração existente:

```powershell
# Mantenha a aplicação local em execução com pnpm build e pnpm start.
# Configure SEED_PASSWORD somente no processo, por uma entrada segura.
# Não coloque seu valor em .env.local, arquivos, histórico ou Git.
$env:TEST_ONBOARDING_LIVE = '1'
$env:DEMO_EMAIL = 'pet-shop@example.invalid'
$env:TEST_BASE_URL = 'http://localhost:3000'
pnpm test:onboarding
Remove-Item Env:SEED_PASSWORD, Env:TEST_ONBOARDING_LIVE -ErrorAction SilentlyContinue
```

`test:onboarding` usa duas contas sintéticas existentes, sessões isoladas em memória e somente servidor local. A empresa precisa estar marcada `is_demo=true` e já permitir gravações. A suíte cobre autorização, progresso persistido, cadastro de serviço e profissional, reenvio sem duplicação, pausa e retomada, além de erro de validação com resposta HTML completa, campos preservados e formulário aberto sem JavaScript. O roteiro também confirma que trial, plano e publicação permanecem inalterados. Cadastros criados ficam identificados como **Teste guiado fictício** e são mantidos para inspeção; o script não cria usuários, não reinicia trials e não altera assinaturas. A senha vem exclusivamente do processo que o inicia. A cobertura e os resultados do incremento original estão no [relatório do primeiro acesso](docs/STATUS-PRIMEIRO-ACESSO.md).

## Já implementado

- Site responsivo, página `/planos`, comparação de recursos e limites, plano recomendado e WhatsApp comercial. Landing e páginas de planos consultam o mesmo catálogo do banco; não há preços alternativos fixados na interface.
- Entradas por oito nichos, com autenticação compartilhada e autorização por vínculo.
- Cadastro, login, confirmação, recuperação e troca de senha com Supabase SSR.
- Criação transacional de empresa e OWNER, trial de sete dias calculado no banco.
- Clientes, serviços, profissionais e criação de agendamentos; duração vem do serviço. As listas possuem busca por nome, paginação de 25 registros, total exato autorizado e ordenação estável, sem o corte anterior de 100 cadastros.
- Agenda visual diária e semanal, filtros por profissional, horários clicáveis e detalhes com nomes de cliente, serviço e profissional. OWNER e MANAGER podem remarcar, cancelar e concluir atendimentos conforme as permissões e o estado da assinatura.
- Entrada direta no painel para quem possui uma empresa, mantendo o seletor em `/painel?empresas=1`. Dashboard executivo com indicadores reais de agendamentos, conclusões, clientes cadastrados e crescimento da agenda, filtros hoje/7/30/90 dias ou intervalo de até 90 dias, comparação com período equivalente, gráfico interativo acessível, próximos atendimentos e atalhos.
- Agregações do dashboard executadas no banco com RLS, sem truncamento pelo limite de linhas da API. OWNER/MANAGER recebem a visão da empresa; EMPLOYEE recebe apenas seus atendimentos atribuídos. Datas antigas de criação de clientes permanecem desconhecidas, sem backfill fictício. Faturamento e vendas ficam indisponíveis enquanto não houver registros financeiros próprios; preços de serviços não são somados como receita.
- Primeiro acesso em `/comecar` e configuração por empresa, serviços, profissional e resumo. Retomada pelo menu **Primeiros passos**, erros por campo e opção de salvar a etapa antes de continuar depois. O progresso considera cadastros persistidos; não ativa a página pública automaticamente.
- Restrição transacional de horários sobrepostos; disponibilidade semanal configurável por profissional, no fuso de São Paulo.
- RLS, autorização no servidor, chaves estrangeiras compostas, limite de profissionais.
- Página pública `/agendar/[slug]`, ativada pelo OWNER: cartões de serviços, seleção de profissional e horário, resumo antes da reserva, confirmação assinada, idempotência e limites por IP/telefone/empresa.
- Personalização pelo OWNER: nome comercial, descrição, endereço, WhatsApp, quatro paletas, logotipo, densidade de exibição e visualização inicial da agenda. Horários usam a disponibilidade existente. A identidade Web Fidelize é preservada e cada empresa mantém suas preferências isoladas.
- Logotipos PNG/JPEG/WebP de até 750 KB no bucket privado `company-logos`, caminhos por `company_id`, validação no servidor, RLS e URLs assinadas curtas. Publicação na página de agendamento exige opção explícita; outros arquivos privados não se tornam públicos. Compartilhamento da página por cópia de link ou abertura do WhatsApp, sem envio automático.
- Comprovante público sem nome ou telefone do cliente, com estado atual consultado no banco. O mesmo link acompanha remarcação/cancelamento; download de calendário `.ics` com assinatura verificada.
- EMPLOYEE acessa apenas agenda atribuída e clientes relacionados; MANAGER gerencia o operacional; OWNER emite convites.
- Convites por link: hash SHA-256 no banco, validade 48h, uso único e e-mail confirmado obrigatório.
- Gestão de vínculos entre contas e profissionais, identificação da equipe por e-mail para o OWNER, desvinculação e revogação de acesso com confirmação, preservando os cadastros e a agenda. Migração aplicada e fluxo validado com contas DEMO no Supabase real; veja [equipe e acessos](docs/EQUIPE-ACESSOS.md).
- Central de ajuda por assunto/módulo, busca, FAQs, tutoriais, orientações de primeiro acesso, solicitações e WhatsApp. Chamados são isolados por empresa; colaboradores consultam seus próprios pedidos. SUPER_ADMIN edita/publica conteúdos e responde às solicitações. Suporte permanece acessível após o fim do trial.
- Página de assinatura por empresa com plano, utilização, prazo e estado consultados no backend. O contato comercial não altera o plano nem concede acesso pago. Checkout e webhook do Mercado Pago ainda não estão implementados.
- Navegação adaptada para celular, tablet e computador, atalhos móveis, tabelas com apresentação por registro, formulários responsivos, skeletons, feedback de sucesso/erro, botões com estado pendente e confirmações nas ações que retiram dados ou acesso. As transições respeitam a preferência de movimento reduzido.
- SUPER_ADMIN: consulta empresas, ajusta plano, suspende/cancela e estende trial até 30 dias. Ativação paga não está disponível manualmente.

## Ainda pendente antes da primeira venda

- Mercado Pago: implementar checkout de assinatura, webhook validado, idempotência persistida, conciliação e tratamento de inadimplência; depois homologar em sandbox. Também faltam aplicação/credenciais do provedor e endpoint HTTPS de homologação. **A pendência inclui desenvolvimento, não apenas configuração. Nenhuma cobrança foi habilitada.**
- Exceções por data para feriados e bloqueios pontuais, turnos que atravessam a meia-noite e proteção adicional anti-bot conforme volume. Cancelamento e remarcação pelo próprio cliente ainda dependem de contato com a empresa; os responsáveis já podem fazê-los no painel.
- Edição/arquivamento dos cadastros operacionais e seleção pesquisável de clientes/serviços na criação de agendamentos para bases maiores. A listagem já possui busca e paginação; o formulário da agenda ainda carrega até 1.000 clientes e serviços.
- SUPER_ADMIN: editor de preços/limites do catálogo, gerenciamento de módulos, métricas financeiras e trilha de auditoria administrativa. Conteúdo de ajuda e chamados já possuem gerenciamento.
- Homologação completa de confirmação de e-mail, recuperação, login, convite e criação da primeira empresa.
- SMTP de produção, termos e privacidade, rotina de backup e teste de restauração.

Restaurante/comandas, pets/tutores, tarefas, rotas, chatbot, site adicional, IA e créditos são expansão futura. As entradas por nicho não significam que seus módulos específicos já existem.

## Banco e migrações

Arquivos SQL em `supabase/migrations`, em ordem. O projeto desta aplicação é o separado `devmjeiblhrgjyaiaukm`, na região São Paulo; não executar contra o outro projeto do proprietário. A instalação inicial utilizou o conector Supabase e preservou as versões retornadas. O CLI oficial está disponível e as migrações recentes foram geradas com ele. Antes de aplicar novas versões, compare o histórico local com o do projeto correto.

Todas as migrações deste incremento estão aplicadas, incluindo `20261019125532_professional_membership.sql`. O histórico local espelha as versões retornadas pelo projeto remoto. A revogação de acessos permanece disponível ao OWNER mesmo após o bloqueio comercial; novos convites e vínculos continuam sujeitos ao estado da assinatura.

Em um novo ambiente, use o Supabase CLI oficial: consulte `supabase --help`, inicialize/vincule ao projeto correto e aplique as migrações. Antes de uma mudança, gere arquivo com `supabase migration new nome`, revise, execute testes e verifique advisors. Não edite migrações já aplicadas: crie nova migração.

O primeiro SUPER_ADMIN usa um bootstrap de instalação de uso único: o e-mail escolhido pelo proprietário foi reservado em tabela privada (não versionado no Git). Somente após o Auth confirmar esse e-mail o UUID recebe o papel; a reserva é consumida. E-mail sem confirmação, domínio ou user_metadata não concedem privilégios. Administradores adicionais exigem operação administrativa por UUID em `private.platform_admins`. O painel não usa service_role. Não publique UUIDs de teste como contas de negócio.

## Vercel / implantação

1. Importe `diogobr231/webfidelize_saas` no projeto Vercel correto, framework Next.js, Node.js 24, diretório raiz.
2. Instale com `pnpm install --frozen-lockfile`; build `pnpm build`.
3. Configure NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY e APP_URL com a URL definitiva HTTPS. Nunca envie a chave secret/service_role ao navegador.
4. No Supabase Auth, defina Site URL e Redirect URLs exatas: `https://SEU-DOMINIO/auth/callback` e `https://SEU-DOMINIO/auth/callback?next=/nova-senha`. Para desenvolvimento, inclua os equivalentes localhost. Evite curingas em produção.
5. Mantenha confirmação de e-mail; configure SMTP, política de senha e proteção contra abuso no Auth antes de abrir ao público.
6. Teste cadastro, confirmação, login, recuperação e convites em homologação, com dois tenants. Teste também tentativa de acessar `/admin` como cliente.
7. Só publicar comercialmente após homologar pagamentos, reserva pública e a lista de pendências acima.

O Storage já possui o bucket privado `company-logos`, criado pela migração de personalização. Em outro ambiente, aplique essa migração antes de liberar uploads e confirme a disponibilidade de `storage.allow_only_operation(text)`. Valide upload autenticado, isolamento entre empresas e publicação somente do logotipo escolhido. Não torne o bucket público. Detalhes de tipos, tamanho, expiração, concorrência e limpeza estão em [docs/PERSONALIZACAO.md](docs/PERSONALIZACAO.md).

## Landing comercial e SEO

A página inicial apresenta agenda, clientes, profissionais e reservas públicas. As ilustrações do sistema usam dados identificados como fictícios. Landing, `/planos` e assinatura consultam os preços e limites do catálogo do banco e mostram erro quando a consulta falha. Novos testes começam no Essencial; a cobrança online pelo Mercado Pago ainda não foi implementada. Não há retorno de checkout capaz de simular uma assinatura ativa.

Título, descrição, canonical, Open Graph, imagem de compartilhamento e dados estruturados de WebSite/Organization ficam em `src/lib/seo.ts` e nas convenções de metadados do App Router. Não há avaliações, depoimentos ou números de clientes inventados. O sitemap inclui apenas a página comercial. Rotas de conta, painel e demonstração permanecem fora da indexação.

Defina `APP_URL` com a origem HTTPS definitiva antes do build de produção. Localhost, URL ausente/inválida e ambientes Vercel Preview/Development ficam com `noindex` e robots bloqueando indexação. Não é preciso inventar um domínio para rodar localmente. Alterar a origem exige novo build. Robots não substitui autenticação e RLS.

Com o servidor local iniciado, execute `pnpm test:landing` para validar conteúdo, destinos dos CTAs e metadados. O teste não envia mensagens nem cria contas.

Entrega e testes desta etapa: [docs/STATUS-LANDING.md](docs/STATUS-LANDING.md).

Implementação conforme as convenções oficiais de [metadados e imagens sociais do Next.js](https://nextjs.org/docs/app/getting-started/metadata-and-og-images), [robots](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots) e [sitemap](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap). O nome do site usa dados estruturados [WebSite conforme o Google Search Central](https://developers.google.com/search/docs/appearance/site-names); isso não garante posicionamento nem resultados enriquecidos.

## Primeiro acesso e retomada

Quem entra sem empresa é encaminhado a `/comecar`, onde informa nome e segmento, sem nicho pré-selecionado. Criar a empresa inicia o trial já definido no banco. A configuração continua em `/painel/[companyId]/configuracao`, com as etapas `empresa`, `servicos`, `equipe` e `resumo`. Proprietários com empresa existente retomam o cadastro atual; não recebem outro trial ao reabrir o fluxo.

**Salvar e continuar depois** valida e persiste a etapa antes de voltar ao painel. O link **Continuar depois** apenas sai da tela: mantém o que já foi salvo, mas não guarda os campos ainda não enviados. Erros de validação preservam o preenchimento no formulário; o roteiro live verifica também a resposta HTML completa de erro sem JavaScript, com os campos preservados e o formulário aberto. Não há rascunho em localStorage. O menu **Primeiros passos** permite retomar e revisar os cadastros. O resumo distingue os três cadastros iniciais da configuração de horários e da publicação da página.

Um profissional é quem aparece na agenda; cadastrá-lo não cria usuário nem envia convite. O proprietário que atende também ocupa uma vaga de profissional. Em **Equipe e acessos**, o OWNER pode vincular uma conta já pertencente à empresa a um profissional existente, desvinculá-la ou revogar o acesso de gerentes/colaboradores, preservando os atendimentos. OWNER e MANAGER podem usar a configuração inicial conforme suas permissões; as ações continuam sujeitas à assinatura, autorização no servidor e RLS. A revogação de acessos permanece disponível mesmo após bloqueio comercial.

O fluxo inicial reutiliza as tabelas e regras existentes. Serviços e profissionais recebem um UUID de registro por formulário: repetir o mesmo envio com o mesmo conteúdo retoma o cadastro salvo, sem inserir outro. O UUID não substitui a autorização por empresa.

Entrega, testes e limitações: [docs/STATUS-PRIMEIRO-ACESSO.md](docs/STATUS-PRIMEIRO-ACESSO.md). A criação da primeira empresa com conta recém-cadastrada e a entrega/confirmação de um novo e-mail ainda precisam de homologação ponta a ponta neste fluxo.

## Custos e operação

Um deploy e um banco para todas as empresas, com company_id e RLS. Sem serviços de IA, filas ou automações pagas no primeiro incremento. O plano de infraestrutura deve permitir uso comercial e ter orçamento definido antes do lançamento. Receita de assinatura só será reconhecida após conciliação do provedor. O trial não depende de cron: cada escrita valida o prazo no banco.

Arquitetura e árvore: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Relatório inicial: [docs/STATUS.md](docs/STATUS.md). Primeira etapa de reservas públicas: [docs/STATUS-AGENDAMENTO.md](docs/STATUS-AGENDAMENTO.md). Melhorias de agenda e experiência: [docs/STATUS-EXPERIENCIA.md](docs/STATUS-EXPERIENCIA.md). Modernização da interface: [docs/STATUS-INTERFACE.md](docs/STATUS-INTERFACE.md). Os relatórios registram a validação do respectivo incremento; execute os comandos acima para conferir a versão atual.

Orientações de recuperação local: [docs/RECUPERACAO-LEGADO.md](docs/RECUPERACAO-LEGADO.md). Backups e relatórios privados ficam fora do versionamento público, na pasta ignorada `.recovery/`.

## Demonstração e próxima integração

Contas e roteiro: [docs/DEMONSTRACAO.md](docs/DEMONSTRACAO.md). Mercado Pago: [docs/MERCADO_PAGO.md](docs/MERCADO_PAGO.md).

Reserva pública exige BOOKING_GATEWAY_SECRET privado no servidor e seu hash em private.booking_gateway. O segredo não vai ao navegador. Para deploy, copie a variável privada do ambiente local para o ambiente servidor da Vercel com cuidado; não gere um segredo diferente sem atualizar o hash no banco. Localmente, as reservas compartilham o limite de IP; na Vercel é usado o header de IP definido pela plataforma. Somente o provedor pode preencher esse header em produção.
