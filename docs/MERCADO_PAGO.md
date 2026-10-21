# Mercado Pago — preparação para integração

Situação: proprietário informou não ter aplicação de desenvolvedor. Painel oficial foi aberto para login; ainda não há credenciais no ambiente. Não foi feita cobrança e não há checkout de produção habilitado.

## Configuração da conta

1. Entre em [Suas integrações](https://www.mercadopago.com.br/developers/panel/app) com a conta que receberá as assinaturas da Web Fidelize.
2. Crie a aplicação `Web Fidelize`, para receber pagamentos online de uma plataforma própria. Não use credenciais de clientes finais.
3. Acesse as credenciais de teste e configure o Access Token **somente em `.env.local`**, como `MERCADO_PAGO_ACCESS_TOKEN`. Não envie o token por chat, não use NEXT*PUBLIC* e não faça commit.
4. A configuração de notificações depende do produto Assinaturas. A documentação atual distingue esse produto das notificações configuradas genericamente no painel. Validar na aplicação real como o segredo de assinatura é fornecido e confirmar o header recebido antes de homologar o webhook.
5. Para receber notificações reais, precisaremos de uma URL HTTPS pública de homologação. Localhost não é alcançável pelo Mercado Pago. A URL final será registrada após preparar e validar o endpoint; não cadastrar uma URL fictícia como funcional.

## Implementação seguinte

- Exigir cartão antes de iniciar novos testes: empresas nascem em `pending_card` e `trial_ends_at=null`. A migração preserva as empresas anteriores. Não há endpoint de liberação manual de teste novo, nem campos para dados do cartão na Web Fidelize.
- Criar o fluxo de assinatura com preço/plano consultados do banco e `external_reference` vinculada à tentativa persistida. Configurar sete dias de teste gratuito no provedor e aceitar somente meios compatíveis com a cobrança recorrente por cartão. Validar o checkout hospedado da aplicação real antes de habilitar o botão; a Web Fidelize não deve receber nem armazenar PAN/CVV.
- Somente após consultar a autorização real, validar o vínculo, meio de pagamento, plano, conta recebedora e data da primeira mensalidade, iniciar o teste no backend em transação idempotente. A primeira mensalidade deve ocorrer após sete dias completos de teste; a data local e a do provedor devem concordar. A migração atual bloqueia esse início até a implementação de uma função privada dedicada à conciliação verificada.
- O Mercado Pago documenta uma transação mínima para validar o cartão, posteriormente devolvida. A comunicação deve dizer “primeira mensalidade após os sete dias”, sem prometer ausência absoluta de qualquer lançamento de validação.
- Reutilizar a tentativa em retries e impedir assinaturas duplicadas. Testar a garantia de idempotência do endpoint real antes de liberar retries automáticos de criação.
- Validar HMAC com comparação de tempo constante, headers, data.id, timestamp e política de replay de acordo com o formato confirmado pela integração real.
- Consultar o recurso autoritativo no Mercado Pago; validar conta recebedora, moeda, valor e vínculo com a empresa.
- Processar atualização e deduplicação em transação; rejeitar eventos fora de ordem. Retorno do checkout não ativa a empresa.
- Tratar autorização do cartão, teste gratuito, primeira mensalidade, falha de renovação, cancelamento e estorno separadamente. Uma tentativa criada ou retorno de checkout não prova autorização. Permitir cancelamento antes da primeira mensalidade com confirmação do provedor.
- Validar em sandbox: checkout, webhook inválido, duplicado, fora de ordem, falha de pagamento e regularização.

Referências oficiais consultadas:

- [Assinatura com pagamento pendente](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/integration-configuration/subscription-no-associated-plan/pending-payments)
- [Obter assinatura](https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/get-preapproval/get)
- [Webhooks](https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks)
- [Plano com teste gratuito](https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/create-preapproval-plan/post)
- [Validação do cartão](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/integration-configuration/subscription-no-associated-plan/authorized-payments)
- [Gerenciamento e cancelamento](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/subscription-management)

Por enquanto, os preços comerciais continuam informativos. Não existem cartões, pagamentos ou saldos fictícios apresentados como reais.
