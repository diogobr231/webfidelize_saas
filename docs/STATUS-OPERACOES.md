# Edição de cadastros e bloqueios de agenda

Incremento operacional de 20/10/2026 (São Paulo). A implementação acrescenta fichas editáveis, arquivamento reversível, histórico do cliente e bloqueios de horários para a rotina de empresas de serviços. Este relatório atualiza as pendências operacionais dos relatórios anteriores, sem substituir suas evidências históricas.

## Recursos implementados

- Fichas de clientes, serviços e profissionais acessíveis pelas listas existentes. Clientes permitem atualizar nome e telefone; serviços, nome, duração e preço; profissionais, nome.
- Valores monetários validados em centavos, com entrada como `69,90`. Alterações usam a versão lida do cadastro para recusar sobrescrita quando outra pessoa ou aba já salvou uma mudança. Erros preservam o preenchimento e orientam abrir a versão atual.
- Filtros **Ativos**, **Arquivados** e **Todos**, combinados com busca, contagem autorizada e paginação. O estado inicial mostra os ativos.
- Histórico paginado na ficha do cliente, com serviço, profissional, horário, duração registrada e estado do atendimento. A consulta respeita as permissões da empresa e do usuário.
- Bloqueios em **Horários e sua página**, para um profissional ativo ou toda a empresa, com início e fim no fuso de São Paulo e motivo opcional de até 160 caracteres. A listagem usa uma janela explícita de 30 dias e páginas de 12 registros; a agenda mostra os bloqueios que intersectam o dia ou a semana escolhidos.
- Mensagens de sucesso, erro e carregamento, formulário preservado após erro e confirmação antes de arquivar, reativar ou remover bloqueio. A confirmação também é exigida na Server Action.

## Arquivamento e preservação do histórico

Arquivar marca o cadastro como indisponível para novas reservas, sem apagar a linha nem seus relacionamentos. Os filtros, fichas e atendimentos antigos continuam acessíveis aos perfis autorizados. Cadastros arquivados saem das opções de criação de agendamento; serviços e profissionais arquivados também saem do catálogo público. É preciso reativar um cadastro antes de editá-lo novamente.

O banco recusa arquivamento quando existe atendimento relacionado em estado **Agendado** cujo término ainda está no futuro, incluindo um atendimento em andamento. O responsável deve aguardar a conclusão ou cancelar o atendimento conforme a situação real. Remarcar para outra data futura mantém o vínculo e não permite arquivar. A operação nunca cancela agendamentos automaticamente.

**Arquivar um profissional não revoga o login da conta vinculada.** A participação e o vínculo são preservados, inclusive para consulta do histórico permitido. O OWNER controla associação, desvinculação e revogação em **Equipe e acessos**, conforme [as regras de acesso](EQUIPE-ACESSOS.md). Arquivamento operacional e revogação de acesso são ações distintas. A revogação continua disponível após bloqueio comercial; edição, arquivamento, reativação e criação/remoção de bloqueios exigem acesso comercial válido.

O limite do plano considera os profissionais ativos. Reativar um profissional exige uma vaga disponível; arquivar não aumenta o limite de membros nem revoga participações existentes.

### O que o histórico apresenta

Nomes de clientes, serviços e profissionais são consultados nos cadastros atuais. Renomear um cadastro atualiza sua identificação nas telas de histórico: este incremento não cria uma cópia imutável do nome usado na data da reserva.

O início, o fim e a duração do atendimento vêm do agendamento salvo. Alterar a duração atual de um serviço não recalcula atendimentos anteriores. O preço atual do serviço também não representa um valor efetivamente vendido ou recebido; este incremento não cria faturamento nem registros financeiros.

## Regras dos bloqueios

Criar um bloqueio exige um intervalo válido, com término posterior ao início e ainda no futuro. O início pode estar no passado quando o período continua em andamento. A conversão de horário usa `America/Sao_Paulo`, sem depender do fuso do navegador ou do servidor. Há suporte a intervalos de vários dias; turnos semanais que atravessam a meia-noite continuam fora deste incremento.

O bloqueio de um profissional afeta somente seus horários; o bloqueio de toda a empresa afeta todos os profissionais. Se houver sobreposição com um atendimento em estado **Agendado**, a criação é recusada, sem mudar o atendimento existente. Novas reservas internas, reservas públicas e remarcações são validadas novamente no banco. O motivo do bloqueio fica restrito às consultas autenticadas autorizadas, sem divulgação na página pública.

Cada formulário de criação recebe um UUID de idempotência. Reenviar a mesma chave com os mesmos dados retoma o bloqueio existente; reutilizar a chave com outros dados é recusado. Remover o bloqueio libera novamente os horários que os turnos regulares permitirem, preservando agendamentos e demais bloqueios.

OWNER e MANAGER gerenciam os bloqueios com acesso comercial válido. EMPLOYEE consulta somente os bloqueios gerais da empresa e os do profissional atribuído. As ações verificam vínculo e papel no servidor e no banco; um identificador recebido da interface não concede autorização.

## Arquivos e banco

A migração [`20261021013325_business_operations.sql`](../supabase/migrations/20261021013325_business_operations.sql) foi aplicada no projeto Web Fidelize `devmjeiblhrgjyaiaukm` e sua versão foi conferida no histórico remoto. O timestamp do arquivo usa UTC. Ela acrescenta metadados de arquivamento e versão, a tabela `schedule_blocks`, índices, políticas e funções de atualização, arquivamento e bloqueio. Também adapta as validações de agendamento e o catálogo público. O SQL não recria empresas, usuários ou agendamentos existentes.

Arquivos principais:

- `src/app/painel/[companyId]/[section]/`: listas, fichas, formulários de edição e histórico.
- `src/lib/business-records.ts`: validações dos cadastros, preço, versão, confirmação e apresentação do histórico.
- `src/app/painel/[companyId]/disponibilidade/` e `src/components/scheduling-blocks/`: formulário, listagem e ações dos bloqueios.
- `src/app/painel/[companyId]/agenda/page.tsx` e `src/components/agenda-experience.tsx`: consulta dos bloqueios e opções ativas para novas reservas, mantendo registros arquivados no histórico.
- `src/lib/schedule-blocks.ts`: validação de intervalos, fuso, idempotência, confirmação e mensagens de erro.

## Testes e validação incremental

| Suíte                                                       | Cobertura                                                                                                                                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/business-records.test.ts`                            | Seções e filtros permitidos, edição por tipo, versão concorrente, preços em centavos, confirmação de arquivamento/reativação e duração histórica.                                                       |
| `tests/schedule-blocks.test.ts`                             | Datas impossíveis, intervalos inválidos, fuso e transições históricas de horário de verão, motivo, UUIDs, paginação, confirmação e mensagens seguras.                                                   |
| `scripts/test-operations-db.ts` / `pnpm test:operations:db` | PostgreSQL descartável: autorização e isolamento, mutações diretas negadas, concorrência por versão, arquivamento/reativação, histórico, limites, bloqueios, reservas públicas e restrições comerciais. |
| `scripts/test-operations-live.ts` / `pnpm test:operations`  | HTTP local e Supabase: fichas e Server Actions, edição, conflito, arquivamento, restauração, histórico, bloqueios, disponibilidade pública, isolamento e limpeza das próprias fixtures.                 |

Passaram **53 testes unitários** e **141 grupos PostgreSQL**: fundação 56, dashboard 10, ajuda 21, equipe 18, personalização 11 e operações 25. Os testes antigos mantiveram suas asserções; apenas fixtures de identidade foram corrigidas para usar o OWNER da empresa correta e limpar o identificador autenticado ao simular chamadas anônimas.

No ambiente local conectado ao Supabase passaram **29 grupos HTTP**: operações 11, experiência/reserva pública 10 e configuração guiada 8. A concorrência real entre criação de bloqueio e reserva, em duas transações, produziu exatamente um vencedor. Os testes também verificaram idempotência, versão desatualizada, confirmação, isolamento, catálogo, liberação de horários, recibo e arquivo de calendário, remarcação e cancelamento. Plano, trial e publicação das empresas DEMO foram preservados.

O teste HTTP exige `TEST_OPERATIONS_LIVE=1`, `SEED_PASSWORD` temporária no processo e aplicação local atualizada em execução. Valida contas sintéticas `@example.invalid` e empresas `is_demo=true`; usa sessões isoladas em memória. Cria registros identificados como **TESTE operação fictício**, mantém seus cadastros arquivados e seus agendamentos cancelados ao terminar, e remove os próprios bloqueios temporários. Não usa empresas reais nem envia e-mail ou WhatsApp. A senha não deve entrar em arquivos, logs, histórico de comandos ou Git.

## Revisão e evidências

| Verificação                        | Estado e evidência                                                                                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Histórico da migração              | Aplicação confirmada no projeto correto, versão `20261021013325`.                                                                                                    |
| Testes unitários e PostgreSQL      | 53 testes e 141 grupos aprovados; `test:operations:db` incluído no CI.                                                                                               |
| Fluxos HTTP DEMO                   | 11 grupos operacionais aprovados; cadastros próprios arquivados, agendamentos cancelados e bloqueios temporários removidos.                                          |
| Regressão pública e configuração   | 10 grupos de experiência e 8 de onboarding aprovados.                                                                                                                |
| Build e revisão final do navegador | `pnpm build` aprovado após a correção, incluindo TypeScript. Navegador em 320, 390, 768 e 1280 px; ficha, edição, filtros, histórico, bloqueios e agenda conferidos. |
| GitHub CI                          | O resultado da execução do commit entregue deve ser consultado no GitHub; testes locais não substituem esse resultado.                                               |

A revisão de segurança identificou e corrigiu duas brechas: rechecagem de permissões após aguardar o lock da empresa e restrição das colunas de INSERT de agendamentos para impedir um status terminal forjado. O banco mantém a duração original nas remarcações, mesmo após editar o serviço.

O teste de navegador revelou que o select de profissional podia voltar a “Toda a empresa” após um erro de validação. O formulário agora remonta os campos com os valores enviados e direciona o foco à mensagem de erro. O cenário foi repetido na compilação corrigida: selecionar profissional, enviar fim anterior ao início, verificar seleção/motivo preservados, corrigir apenas a data e confirmar que o bloqueio pertence ao mesmo profissional. A remoção com confirmação também foi conferida e o bloqueio temporário foi removido. Os 12 testes relacionados a bloqueios/agenda passaram novamente após a correção.

Na ficha do cliente foram testados salvamento, reativação, arquivamento, filtros e histórico preservado. O diálogo move o foco para “Voltar”, permite Tab até confirmar e fecha com Escape, devolvendo o foco ao botão de origem. As páginas verificadas não apresentaram transbordamento horizontal (larguras 320/390/768/1280 px); a grade da agenda mantém sua rolagem interna prevista. Não houve erros ou avisos no console da aba de teste. A validação responsiva usou viewport do navegador desktop, sem substituir um teste em aparelho iOS/Android físico.

Capturas locais, ignoradas pelo Git, em `test-results/operations/ficha-desktop.png` e `test-results/operations/bloqueio-mobile.png`. São dados explicitamente fictícios; o bloqueio da captura já foi removido após a conferência.

O advisor de segurança retornou apenas o aviso já conhecido de [proteção contra senhas vazadas desativada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). O advisor de desempenho apontou quatro FKs antigas sem índices cobrindo todas as colunas e duas políticas antigas que podem usar initplans; não houve aviso de isolamento nas novas tabelas. Referências: [índices de FK](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) e [initplans de RLS](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan). Não foram removidos índices recém-criados por ausência inicial de uso.

## Próxima etapa

Antes do piloto, homologar em produção os e-mails de confirmação/recuperação/convite, domínio HTTPS e configuração de acesso, além de backup/restauração e documentos comerciais. Os testes deste incremento usam contas DEMO existentes e não comprovam entrega de e-mail ou desempenho em carga.

**Pagamentos continuam por último nesta sequência**: aplicação/credenciais, checkout de assinatura, webhook verificado e idempotente, conciliação, inadimplência e homologação do Mercado Pago permanecem pendentes. Nenhuma cobrança ou ativação paga foi implementada nesta etapa.
