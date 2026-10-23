# Mercado Pago — assinaturas da Web Fidelize

**23/10/2026: integração implementada, contratação real desativada.** A verificação de telefone foi concluída e as credenciais de produção e o webhook foram configurados. Falta homologar Pix e cartão com o provedor. Nenhuma transação financeira real foi realizada nesta entrega. Testes locais não comprovam recebimentos no Mercado Pago.

**Validação publicada:** `BILLING_MODE=live` recebe notificações, com `private.billing_config.enabled=false` bloqueando novas contratações. O simulador oficial entregou um evento com HMAC válido, persistido antes da consulta ao provedor. O ID sintético inexistente retornou 404 na API e 503 no webhook; somente esse evento descartável foi removido após o teste. Isso comprova transporte e verificação de assinatura, não aprovação financeira. Publicação `3ceb416`; 27 grupos públicos e 7 grupos autenticados passaram.

## Regras comerciais preservadas

- Novas empresas recebem **sete dias grátis sem cartão** no Essencial. O PostgreSQL define e verifica a expiração; login, atualização da página ou troca de plano não reiniciam o prazo.
- A contratação fica disponível ao **OWNER com e-mail confirmado, após terminar o teste**, e somente quando a integração estiver habilitada. Empresas DEMO não podem gerar cobranças. O MANAGER não recebe o histórico financeiro nem pode contratar ou cancelar; o EMPLOYEE não acessa a tela de assinatura.
- **Pix:** pagamento mensal manual, com QR Code, copia e cola e consulta do status. O CPF é enviado ao provedor para gerar a cobrança; não é persistido no banco da aplicação. A renovação exige novo pagamento. Antecipação de Pix, quando permitida pelo banco, mantém o plano e preserva o período já pago.
- **Cartão:** assinatura mensal no checkout hospedado do Mercado Pago. PAN e CVV nunca passam pelos formulários ou banco da Web Fidelize. Cancelar a renovação exige confirmação e consulta ao provedor; não implica estorno do período já pago.
- Preços e limites vêm de `plans`. Configuração comercial atual: Essencial **R$ 49,90 / 1 profissional**, Profissional **R$ 89,90 / até 3**, Empresarial **R$ 149,90 / até 10**. O servidor compara a cotação mostrada ao cliente com o preço atual do banco antes de criar a tentativa. Se mudou, solicita nova confirmação; valores enviados pelo navegador não determinam a cobrança.
- A capacidade da equipe, o vínculo com a empresa, o plano, a modalidade e tentativas já abertas são verificados novamente no backend. Uma assinatura autorizada, um QR gerado ou o retorno do checkout **não concedem acesso pago**.

## Configuração privada

Use a aplicação Mercado Pago da própria Web Fidelize, que receberá as assinaturas, sem credenciais de empresas clientes. Configure o ambiente do servidor e a configuração privada do banco de forma consistente:

| Variável | Uso |
| --- | --- |
| `BILLING_MODE` | `disabled` por padrão; `test` para homologação ou `live` após validar o provedor. |
| `MERCADO_PAGO_TEST_ACCESS_TOKEN` | Token de teste, usado somente com `BILLING_MODE=test`. |
| `MERCADO_PAGO_ACCESS_TOKEN` | Token de produção, usado somente com `BILLING_MODE=live`. |
| `MERCADO_PAGO_COLLECTOR_ID` | Identificador numérico da conta recebedora correspondente ao ambiente. |
| `MERCADO_PAGO_WEBHOOK_SECRET` | Segredo de assinatura das notificações reais. |
| `BILLING_GATEWAY_SECRET` | Segredo independente, de pelo menos 32 caracteres, para o gateway de conciliação no banco. |
| `APP_URL` | Origem HTTPS estável da aplicação, usada no retorno do checkout e nas notificações. |
| `CRON_SECRET` | Segredo de pelo menos 32 caracteres para a reconciliação agendada. |

A migração cria `private.billing_config` com `enabled=false`, ambiente `test` e sem credenciais. Configure o ambiente e a conta recebedora corretos e armazene **somente SHA-256** de `BILLING_GATEWAY_SECRET` em `secret_hash`. A liberação exige tanto a configuração do servidor quanto a do banco; somente preencher uma variável não libera cobranças. Pagamentos em modo `test` nunca concedem acesso pago.

Não coloque segredos em `NEXT_PUBLIC_*`, SQL versionado, logs, capturas de tela ou Git. `.env.local` deve permanecer ignorado. Não reutilize os segredos de Auth, reservas ou funil. Preserve os valores existentes ao implantar, sem rotacionar credenciais de outras integrações.

## Confirmação, conciliação e acesso

O webhook é `POST /api/webhooks/mercadopago`, na origem HTTPS publicada. Os tópicos aceitos são `payment`, `subscription_preapproval` e `subscription_authorized_payment`. O endpoint valida assinatura HMAC, timestamp, identificador assinado e correspondência entre query e corpo. Em seguida consulta o recurso no Mercado Pago e confere ambiente, recebedor, moeda, valor e vínculos com a tentativa e a empresa. O corpo da notificação não é prova de pagamento.

Eventos e pagamentos são deduplicados no banco; a conciliação grava o resultado e o direito de acesso de maneira transacional. Falhas retornam erro para permitir nova entrega e mantêm o evento mínimo para reconciliação. A criação de cartão com resultado incerto não dispara outro POST automaticamente: a tentativa persistida é consultada e recuperada apenas quando a identidade pode ser comprovada.

Se a resposta de criação de um Pix se perder, **Verificar pagamento** procura pela referência da tentativa e consulta novamente o recurso encontrado. Só uma correspondência exata de ambiente, recebedor, valor, moeda e modalidade permite recuperar o QR Code. Resultado ausente ou ambíguo não gera outra cobrança; um pagamento pendente não libera acesso pago.

A documentação do Mercado Pago distingue as notificações do produto **Assinaturas** das configurações genéricas de Webhooks no painel. Homologue a criação da assinatura, a configuração da URL e os headers efetivamente entregues para cada tópico. Não considere uma simulação de painel ou um HTTP 200 isolado como prova de assinatura, cobrança ou renovação funcional.

Um pagamento de produção aprovado e confirmado cria um **período pago finito de um mês de calendário**. A autorização do cartão não cria esse período. Estorno, inclusive parcial, e contestação revogam o período correspondente. A autorização de uso consulta o período vigente e não revogado: `status=active` ou uma data futura em `paid_until`, isoladamente, não bastam.

`GET` ou `POST /api/billing/reconcile` exige `Authorization: Bearer <CRON_SECRET>`. O agendamento em `vercel.json` executa diariamente às **12h UTC (9h de Brasília)**, com lotes limitados, como recuperação de notificações e estados pendentes. O botão **Verificar pagamento** também consulta o backend. O vencimento do teste e dos períodos pagos independe do cron.

## Validação e liberação

```powershell
pnpm test
pnpm test:billing:db
pnpm typecheck
pnpm build
pnpm test:billing:http
```

Os testes unitários usam transporte e gateway controlados; a suíte de banco utiliza PostgreSQL descartável via PGlite. A suíte HTTP inicia a aplicação Next com Auth, REST e Mercado Pago sintéticos e bloqueia chamadas externas. Esses testes exercitam autorização, isolamento, preços alterados, expiração, idempotência, duplicação, cancelamento, estorno, falhas e rotas reais da aplicação. **Não enviam cobranças reais e não substituem homologação no provedor.**

Antes de habilitar produção:

1. Concluir a verificação da conta e configurar as credenciais e notificações na aplicação correta.
2. Homologar com contas de teste os dois meios: criação, confirmação consultada no backend, duplicação, falha, cancelamento, renovação e estorno. Conferir os webhooks reais, inclusive reenvios e eventos fora de ordem.
3. Confirmar a persistência no banco, a empresa e o plano corretos, a duração do período e a ausência de acesso pago em modo de teste.
4. Revisar os resultados e só então habilitar o ambiente `live` e a configuração privada correspondente. Não criar transações de produção apenas para simular uma validação.

Referências oficiais:

- [Assinatura com pagamento pendente](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/integration-configuration/subscription-no-associated-plan/pending-payments)
- [Integração Pix](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/integration-configuration/integrate-pix)
- [Webhooks](https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks)
- [Gerenciamento e cancelamento](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/subscription-management)
