# Web Fidelize

SaaS B2B multiempresa em reconstrução. Next.js App Router, TypeScript, Tailwind e Supabase. **Ainda não liberado para clientes pagantes.**

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
pnpm build
```

`test:db` executa as migrações em PostgreSQL descartável via PGlite e testa RLS com os papéis authenticated/anon. Não usa dados reais. `scripts/remote-isolation.sql` verifica uma parte das garantias no Supabase real, dentro de transação com ROLLBACK. PGlite não substitui a homologação de Auth, SMTP, Storage e pagamentos.

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

## Já implementado

- Site responsivo, planos R$69,90 / R$119,90 / R$199,90 e WhatsApp comercial.
- Entradas por oito nichos, com autenticação compartilhada e autorização por vínculo.
- Cadastro, login, confirmação, recuperação e troca de senha com Supabase SSR.
- Criação transacional de empresa e OWNER, trial de sete dias calculado no banco.
- Clientes, serviços, profissionais e criação de agendamentos; duração vem do serviço.
- Agenda visual diária e semanal, filtros por profissional, horários clicáveis e detalhes com nomes de cliente, serviço e profissional. OWNER e MANAGER podem remarcar, cancelar e concluir atendimentos conforme as permissões e o estado da assinatura.
- Entrada direta no painel para quem possui uma empresa, mantendo o seletor em `/painel?empresas=1`. Painel com indicadores do dia, próximos atendimentos e configuração guiada a partir dos cadastros salvos.
- Restrição transacional de horários sobrepostos; disponibilidade semanal configurável por profissional, no fuso de São Paulo.
- RLS, autorização no servidor, chaves estrangeiras compostas, limite de profissionais.
- Página pública `/agendar/[slug]`, ativada pelo OWNER: cartões de serviços, seleção de profissional e horário, resumo antes da reserva, confirmação assinada, idempotência e limites por IP/telefone/empresa.
- Apresentação pública configurável pelo OWNER com descrição, endereço, WhatsApp e quatro opções de cor. Compartilhamento por cópia de link ou abertura do WhatsApp, sem envio automático.
- Comprovante público sem nome ou telefone do cliente, com estado atual consultado no banco. O mesmo link acompanha remarcação/cancelamento; download de calendário `.ics` com assinatura verificada.
- EMPLOYEE acessa apenas agenda atribuída e clientes relacionados; MANAGER gerencia o operacional; OWNER emite convites.
- Convites por link: hash SHA-256 no banco, validade 48h, uso único e e-mail confirmado obrigatório.
- SUPER_ADMIN: consulta empresas, ajusta plano, suspende/cancela e estende trial até 30 dias. Ativação paga não está disponível manualmente.

## Ainda pendente antes da primeira venda

- Mercado Pago: checkout de assinatura, HMAC do webhook, idempotência persistida, conciliação e testes sandbox. **Nenhuma cobrança foi habilitada.**
- Exceções por data para feriados e bloqueios pontuais, turnos que atravessam a meia-noite e proteção adicional anti-bot conforme volume. Cancelamento e remarcação pelo próprio cliente ainda dependem de contato com a empresa; os responsáveis já podem fazê-los no painel.
- Edição/exclusão dos cadastros, vinculação visual entre profissional e usuário, remoção de colaboradores e paginação (listas atuais: 100 registros).
- SUPER_ADMIN: preços configuráveis, módulos, métricas de receita, auditoria administrativa e chamados de suporte.
- Homologação completa de confirmação de e-mail, recuperação, login, convite e criação da primeira empresa.
- SMTP de produção, termos e privacidade, rotina de backup e teste de restauração.

Restaurante/comandas, pets/tutores, tarefas, rotas, chatbot, site adicional, IA e créditos são expansão futura. As entradas por nicho não significam que seus módulos específicos já existem.

## Banco e migrações

Arquivos SQL em `supabase/migrations`, em ordem. Foram aplicados ao projeto separado `devmjeiblhrgjyaiaukm` na região São Paulo. Não executar contra o outro projeto do proprietário. As versões dos arquivos espelham o histórico remoto. O CLI teve timeout no download; a aplicação inicial e geração das versões foram feitas pelo conector Supabase, e as versões retornadas foram preservadas localmente.

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

Para Storage: ainda não há bucket nem upload. Só habilitar com bucket privado, limites de tipo/tamanho e políticas por prefixo company_id. Não criar bucket público para dados de clientes.

## Custos e operação

Um deploy e um banco para todas as empresas, com company_id e RLS. Sem serviços de IA, filas ou automações pagas no primeiro incremento. O plano de infraestrutura deve permitir uso comercial e ter orçamento definido antes do lançamento. Receita de assinatura só será reconhecida após conciliação do provedor. O trial não depende de cron: cada escrita valida o prazo no banco.

Arquitetura e árvore: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Relatório inicial: [docs/STATUS.md](docs/STATUS.md). Primeira etapa de reservas públicas: [docs/STATUS-AGENDAMENTO.md](docs/STATUS-AGENDAMENTO.md). Melhorias de agenda e experiência: [docs/STATUS-EXPERIENCIA.md](docs/STATUS-EXPERIENCIA.md). Os relatórios registram a validação do respectivo incremento; execute os comandos acima para conferir a versão atual.

Orientações de recuperação local: [docs/RECUPERACAO-LEGADO.md](docs/RECUPERACAO-LEGADO.md). Backups e relatórios privados ficam fora do versionamento público, na pasta ignorada `.recovery/`.

## Demonstração e próxima integração

Contas e roteiro: [docs/DEMONSTRACAO.md](docs/DEMONSTRACAO.md). Mercado Pago: [docs/MERCADO_PAGO.md](docs/MERCADO_PAGO.md).

Reserva pública exige BOOKING_GATEWAY_SECRET privado no servidor e seu hash em private.booking_gateway. O segredo não vai ao navegador. Para deploy, copie a variável privada do ambiente local para o ambiente servidor da Vercel com cuidado; não gere um segredo diferente sem atualizar o hash no banco. Localmente, as reservas compartilham o limite de IP; na Vercel é usado o header de IP definido pela plataforma. Somente o provedor pode preencher esse header em produção.
