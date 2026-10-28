# Central IA interna

`/admin/ia` é exclusiva de SUPER_ADMIN. Analisa oportunidades já cadastradas, solicitações de suporte e tarefas da central de operações. Não busca contatos na internet. A geração depende de uma conta AI Gateway habilitada; não existe resultado fictício nem fallback apresentado como IA.

## Uso

1. Abra uma oportunidade, solicitação ou tarefa e escolha a análise pela Central IA.
2. A solicitação entra numa fila persistida, deduplicada pela origem e sua versão.
3. **Processar fila** tenta até três análises. A rotina diária faz a mesma preparação/processamento, entre 08h e 09h de Brasília na hospedagem atual. As regras administrativas de tarefas continuam com seu agendador independente de 15 minutos.
4. Revise resumo, próximo passo e rascunho. Salve ajustes, descarte ou aprove o texto.
5. Aprovar uma oportunidade salva uma **nota interna** no funil. Aprovar suporte mantém um **rascunho interno** na Central IA; a publicação de uma resposta continua sendo uma ação separada na solicitação. Nenhuma aprovação envia WhatsApp/e-mail, resolve chamados, conclui tarefas ou muda assinaturas.

Se a origem mudou, a aprovação é bloqueada. Repetir uma aprovação não cria outra nota. Uma falha não repete automaticamente a chamada; uma nova tentativa exige confirmação e mantém a tentativa anterior no consumo. O conteúdo deve ser revisado pelo administrador, pois modelos podem cometer erros.

## Consumo e segurança

O limite inicial é 10 tentativas por dia e 100 por mês, com períodos no fuso de Brasília. A reserva é feita atomicamente no banco antes de chamar o provedor. Falhas e execuções com resultado desconhecido mantêm sua reserva: um timeout não prova ausência de cobrança. Os tokens só aparecem quando o provedor os informou. Os limites da aplicação contam tentativas, não reais nem saldo de créditos do provedor.

Modelo fixado após consulta ao catálogo: `google/gemini-3.5-flash-lite`, via Vercel AI Gateway com rota permitida `vertex`, declarada sem treinamento e com retenção zero no catálogo consultado em 22/10/2026. Limites: 1.800 tokens de saída, 15 segundos por geração e nenhuma repetição automática. Não há ferramentas de navegação, código, SQL ou envio à disposição do modelo. Nenhuma compra ou recarga automática é configurada por esta entrega.

O contexto exclui nomes, telefone, e-mail, IDs de contato e dados de clientes/agendamentos das empresas. Campos livres passam por remoção de identificadores óbvios e credenciais, com limite de tamanho; isso não garante anonimização completa. Não insira segredos ou dados sensíveis nesses campos. Preços vêm do catálogo atual do banco, sem valores presumidos quando indisponível. O prompt declara os recursos existentes e os módulos ainda não implementados. A saída estruturada é validada no servidor e novamente no banco; HTML nunca é executado.

RLS protege configurações, fila e histórico; usuários comuns não podem lê-los ou escrever diretamente. Revisões exigem a autorização atual no banco e a versão do registro. A execução usa segredo de escopo limitado, autorização administrativa revogável e lease por análise. O token de execução e o contexto bruto ficam no schema privado. Logs e mensagens de erro guardam somente categorias conhecidas.

## Configuração de produção

- Na Vercel, a geração utiliza OIDC automaticamente. Para desenvolvimento fora dela, use uma credencial temporária OIDC ou `AI_GATEWAY_API_KEY`, apenas em ambiente privado.
- `AI_WORKER_SECRET`: segredo exclusivo de 32 bytes aleatórios. Guardar somente o SHA256 correspondente em `private.platform_ai_gateway.secret_hash`.
- `CRON_SECRET`: autentica `/api/admin-ai/process`. Não exponha esses valores no navegador, chat, logs ou Git.
- `vercel.json` cadastra a rotina diária `0 11 * * *`. O cron não executa por abrir a página; seu resultado é registrado no banco. O primeiro disparo real precisa ser observado separadamente da execução manual.
- Configure/ative a central autenticado como SUPER_ADMIN. Conexão configurada não comprova geração autorizada nem saldo. Erros de verificação, saldo ou credencial pausam o processamento para impedir repetição de falhas.

Para homologar após a verificação, `scripts/test-admin-ai-success-live.ts` exige opt-ins explícitos e uma fila sem trabalhos alheios; solicita uma única geração sobre um lead sintético e verifica revisão/aprovação interna. Preservar os jobs consumidos e seu uso: o contador de quota deriva de `consumed_at`, portanto excluir esses registros apagaria tentativas contabilizadas. Ao encerrar o teste, arquivar a fonte QA sem apagar o histórico de consumo.

Uma chamada autenticada ao endpoint do cron com uma fila QA e `auto_enqueue=false` valida o processamento, mas não comprova um disparo pelo agendador nem a seleção automática global. Esta seleção é verificada separadamente em PostgreSQL descartável, incluindo criação efetiva, `automatic=true`, deduplicação, autorização e ausência de consumo antes da execução. Não introduzir filtros ou bypasses exclusivos de teste no endpoint de produção.

**Dependência observada em 22/10/2026:** OIDC autenticou, mas o Gateway retornou `customer_verification_required` (HTTP 403), com saldo disponível zero. A geração real permanece bloqueada até o responsável concluir a verificação na Vercel e ter crédito disponível. Pagamentos de assinaturas dos clientes permanecem fora desta entrega.

## Testes

`pnpm test`, `pnpm test:ai:db` e build validam regras, filas, permissões, limites, saída e revisão com fixtures isoladas. `pnpm test:ai:live` exige opt-in e contas existentes; o roteiro identificado por `QA-AI-` verifica o bloqueio real do provedor, sem inserir um rascunho artificial em produção. Confira os pré-requisitos no cabeçalho do script e remova somente os registros identificados por ele.

Validação de 22/10/2026: 137 testes unitários; 21 grupos SQL da Central IA; 128 verificações de regressão de banco, comercial, suporte e automações; TypeScript e build aprovados. O teste HTTP no build local com o banco real passou em 6 grupos, incluindo formulários de configuração/fila, isolamento, deduplicação e a recusa real `verification_required`. O mesmo roteiro passou online após corrigir a detecção do OIDC por contexto da requisição, coberta por teste de regressão. Os registros `QA-AI-` desses testes foram removidos por seus IDs, sem alterar contatos reais. A revisão de uma resposta bem-sucedida foi validada com fixtures no banco isolado; não houve geração bem-sucedida no provedor real.

Publicação final do produto: commit `26fcbb4`, deployment `dpl_5AhTETLHdrABKfH6rgoi2QQipfpg`, promovido para [Central IA online](https://webfidelize-saas.vercel.app/admin/ia). A verificação pública passou em 27 grupos. Navegador autenticado validado em 320, 390, 768 e 1280 px, sem transbordamento horizontal; área de toque da confirmação ampliada e conferida online. Nenhuma resposta fictícia foi inserida para demonstrar o editor.

O endpoint publicado da rotina recusou chamada sem autenticação (401) e respondeu corretamente à chamada autenticada com processamento pausado (200, zero gerações). Esta chamada de teste ao endpoint **não comprova um disparo pelo relógio do cron**. O agendamento diário está registrado na Vercel; a primeira execução pelo agendador permanece por observar. A central ficou pausada devido à verificação exigida pelo provedor. Depois de liberar a conta/créditos, reative o processamento e a entrada automática em **Limites e configuração**, e valide uma geração real antes de utilizá-la comercialmente.

Documentação: [AI Gateway e autenticação](https://vercel.com/docs/ai-gateway/authentication-and-byok), [créditos](https://vercel.com/docs/ai-gateway/pricing), [limites do cron](https://vercel.com/docs/cron-jobs/usage-and-pricing).
