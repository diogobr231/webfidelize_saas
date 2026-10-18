# Primeiro acesso e configuração guiada — 18/10/2026

## Comportamento implementado

O fluxo começa em `/comecar` para uma conta autenticada sem empresa. A pessoa informa o nome do negócio e seleciona um dos oito segmentos; nenhum segmento vem marcado. A criação reutiliza a operação transacional existente de empresa e OWNER e o trial de sete dias calculado no banco. Se o proprietário já tiver empresa, o sistema retoma a configuração existente.

Depois de criar a empresa, a rota `/painel/[companyId]/configuracao` apresenta quatro telas:

| Etapa      | Conteúdo                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------- |
| `empresa`  | Revisão do nome, segmento e plano já salvos.                                                        |
| `servicos` | Nome do serviço, duração de 5 a 480 minutos e preço em reais; aceita vírgula ou ponto nos centavos. |
| `equipe`   | Cadastro do profissional que recebe os agendamentos, respeitando o limite do plano.                 |
| `resumo`   | Cadastros persistidos, itens ainda faltantes e próximos passos de disponibilidade e página pública. |

O indicador de progresso considera três fatos salvos: empresa existente, ao menos um serviço e ao menos um profissional. Concluir esses cadastros não significa que os horários foram revisados ou que a página está pública. O resumo mantém essas tarefas separadas e explica os turnos iniciais dos profissionais. Serviços e equipe podem ser deixados para depois, sem mostrar conclusão falsa.

O menu **Primeiros passos** permite retomar o fluxo e revisar as etapas. Cadastros anteriores aparecem na tela, com formulários para adicionar outros quando há permissão e capacidade no plano. Abrir novamente a configuração não reinicia o trial, não troca o plano e não publica automaticamente a página.

## Salvar, pausar e validar

- **Salvar e continuar depois:** envia, valida e salva a etapa antes de abrir o painel com indicação de pausa.
- **Continuar depois**, no cabeçalho: sai da tela preservando somente os cadastros já salvos. Os campos ainda não enviados não são persistidos.
- **Continuar:** salva a etapa e avança para a próxima tela.
- Erros são apresentados no campo e no resumo do formulário, preservando o preenchimento para correção. O roteiro HTTP também verifica essa preservação na resposta HTML sem JavaScript. O formulário adicional permanece aberto quando há erro. Com JavaScript, os botões informam o envio pendente e impedem repetição enquanto aguardam a resposta.

Não há armazenamento de rascunhos em localStorage, nem senha nos dados de configuração. Os estados de formulário transportam apenas os valores necessários ao retorno de validação. A resposta ao POST HTML de validação sem JavaScript foi concluída e verificada no roteiro live.

## Profissional e acesso ao painel

O cadastro de profissional identifica quem atende e ocupa uma vaga no plano. Se o proprietário atende clientes, seu próprio nome também ocupa essa vaga. Cadastrar o profissional não cria uma conta e não envia convite.

Convites e permissões ficam em **Equipe e acessos**. Para a agenda atribuída de um colaborador, também é necessário vincular seu usuário ao profissional. Esse vínculo não é criado automaticamente pelo novo formulário. A interface deixa essa diferença explícita e permite continuar sem convidar outras pessoas.

## Segurança e persistência

O incremento reutiliza o esquema existente: **nenhuma migração SQL nova foi necessária**. Permanecem as políticas RLS, as chaves estrangeiras por empresa, o limite transacional de profissionais e as verificações de assinatura.

As Server Actions consultam o usuário e validam o vínculo e as permissões da empresa antes de gravar. UUIDs, nomes, preços e duração são validados no servidor. O `companyId` da rota ou de um argumento do formulário não concede acesso por si só. OWNER e MANAGER seguem as regras de gerenciamento; EMPLOYEE não recebe permissão para configurar o negócio.

Cada formulário de serviço ou profissional recebe um `record_id` UUID. Antes de inserir, a ação procura esse registro dentro da empresa autorizada. Se o mesmo identificador e conteúdo já tiverem sido gravados, retoma o fluxo sem duplicar o cadastro. Se o identificador já existir com conteúdo diferente, retorna erro. A verificação é repetida após erro de inserção para tratar a conclusão de um envio concorrente. Essa idempotência vale para o mesmo UUID; abrir outro formulário gera uma nova intenção de cadastro.

## Arquivos principais

- `src/app/comecar/page.tsx` e `actions.ts`: entrada autenticada e ações de criação/cadastro.
- `src/app/painel/[companyId]/configuracao/page.tsx`: etapas e resumo a partir dos registros persistidos.
- `src/components/onboarding/forms.tsx`, `frame.tsx` e `onboarding.css`: formulários, navegação, progresso e apresentação responsiva.
- `src/lib/onboarding.ts`: regras de progresso, destinos, dicas e validação.
- Entrada do painel e navegação da empresa: acesso e retomada por **Primeiros passos**.
- `scripts/test-onboarding-live.ts` e testes unitários: roteiro opt-in de homologação e regras do fluxo.
- `README.md`: instruções de execução e limites da validação.

## Validação executada

| Verificação                                            | Resultado registrado neste incremento                                                                |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| TypeScript e build de produção                         | Aprovados.                                                                                           |
| Testes unitários                                       | 22 aprovados.                                                                                        |
| PostgreSQL descartável: isolamento e regras existentes | 56 aprovados.                                                                                        |
| Verificações HTTP gerais                               | 28 aprovadas.                                                                                        |
| Verificações da landing e SEO                          | 8 aprovadas.                                                                                         |
| Navegador com JavaScript                               | Erro de validação, preenchimento preservado, saída pelo cabeçalho sem salvar e retomada verificados. |
| Suíte live completa `test:onboarding`                  | 8 grupos aprovados, incluindo salvamento com pausa e POST HTML sem JavaScript.                       |

A suíte live confirmou o cadastro de serviço e profissional, com apenas um registro após o reenvio de cada formulário; salvamento com pausa e recarga; resposta HTML de erro encerrada, campos preservados e `<details>` aberto; e acesso negado a outra empresa. Trial, plano e estado de publicação permaneceram inalterados. O salvamento com pausa foi verificado pelo roteiro HTTP; a revisão no navegador verificou a saída pelo link do cabeçalho, que não salva campos pendentes.

Os testes locais não substituem os fluxos de Supabase Auth, entrega de e-mail ou cobrança. A criação inicial da primeira empresa pelo novo fluxo, usando conta recém-cadastrada, e a entrega/confirmação de um novo e-mail **não foram homologadas ponta a ponta neste incremento**.

### Correção do POST sem JavaScript e prevenção de regressão

Uma versão intermediária retornava status 200 e parte do HTML após um envio inválido, mas não encerrava a resposta. A correção vincula o `companyId` à Server Action com `.bind` no Server Component e passa a ação serializada estável ao `useActionState`. Os formulários também usam permalinks explícitos para a rota da etapa. A vinculação não é recriada dentro do componente cliente.

Os formulários adicionais controlam seu próprio `<details>` e o abrem quando recebem erro de validação. O teste de regressão lê a resposta HTML completa e verifica erro visível, valores preservados, formulário aberto e ausência de inserção inválida. A execução integral de `test:onboarding` passou após essas correções.

## Executar a homologação live

O comando `pnpm test:onboarding` exige `TEST_ONBOARDING_LIVE=1`, servidor local em `TEST_BASE_URL`, conta sintética em `DEMO_EMAIL` terminada em `@example.invalid` e `SEED_PASSWORD` fornecida somente pelo processo. URL e chave publicável do Supabase vêm da configuração local. O script não lê a senha do arquivo `.env.local`.

Use empresas de demonstração já existentes, ativas para gravação, e sessões isoladas. A suíte usa uma segunda conta demo distinta para verificar isolamento. Não altera trial, assinatura ou publicação. Cadastros criados são identificados como **Teste guiado fictício** e mantidos para inspeção; o teste não apaga dados existentes. O exemplo de comando sem credenciais está no README.

## Próximos passos

1. Homologar criação de conta, entrega/confirmação de e-mail e primeira empresa em ambiente de teste.
2. Manter o teste de regressão do POST HTML sem JavaScript ao evoluir as Server Actions e os formulários.
3. Manter a revisão visual em telas pequenas e a regressão de permissões ao evoluir as etapas.

Mercado Pago, cobrança automática e módulos específicos dos nichos permanecem fora deste incremento. A nova configuração não modifica as condições de liberação comercial registradas no README.
