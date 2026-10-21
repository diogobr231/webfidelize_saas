# Lembretes de agendamento por WhatsApp

Implementação pela WhatsApp Business Platform / Cloud API. O banco é a autoridade para autorização, horários, confirmação e consumo. Nenhum envio é feito enquanto a integração estiver sem credenciais, pausada ou com cota zero. Mercado Pago não participa deste fluxo.

## Uso

- Empresa: **Lembretes** no menu. Ative a preferência, escolha até três antecedências entre 30 minutos e 7 dias e defina seu limite mensal.
- SUPER_ADMIN: **WhatsApp** em `/admin/whatsapp`. Defina o teto de cada empresa. O limite efetivo é o menor entre esse teto e o escolhido pela empresa.
- Cliente: autorização opcional, desmarcada por padrão, na reserva pública. A equipe também pode registrar uma autorização obtida na ficha do cliente. Alterar o telefone exige nova autorização; consentimento não migra silenciosamente para outro número.
- A mensagem contém um botão para abrir `/confirmar/<token>`. Abrir a página não confirma nada. O cliente confirma por um botão, e a presença aparece na agenda.
- É possível parar os lembretes pelo link ou respondendo **PARAR**, **SAIR**, **STOP** ou **CANCELAR LEMBRETES** ao número conectado.

## Configuração de produção

1. Aplicar a migração `20261021205059_whatsapp_reminders.sql`.
2. Configurar um número na Cloud API e obter seu `phoneNumberId` e token com permissão de envio. Cada empresa tem seu próprio número; esta versão suporta até 100 conexões, sem cadastro OAuth automático. Todos os números devem estar associados ao aplicativo Meta cujo segredo verifica o webhook.
3. Criar e obter aprovação de um modelo de utilidade em `pt_BR`, com quatro parâmetros no corpo, nesta ordem: nome do cliente, nome da empresa, data, horário. Exemplo para submissão à Meta:

   > Olá, {{1}}! Lembrete do seu agendamento na {{2}}, dia {{3}}, às {{4}} (horário de São Paulo). Abra o link para confirmar sua presença ou parar os lembretes. Para parar, você também pode responder PARAR.

   Botão URL **Ver agendamento**, índice 0: `https://SEU_DOMINIO/confirmar/{{1}}`. O parâmetro do botão é um token aleatório; não reutiliza o primeiro parâmetro do corpo. Não incluir publicidade, especialidade médica ou detalhes de saúde. A aprovação e categoria final dependem da Meta.
4. Definir `APP_URL` com a origem HTTPS de produção. O domínio do botão aprovado precisa ser o mesmo. Configurar as variáveis privadas de `.env.example` no servidor:
   - `WHATSAPP_CONNECTIONS_JSON`: array com `companyId`, `phoneNumberId`, `accessToken`, `templateName` e `languageCode: "pt_BR"`.
   - `WHATSAPP_GRAPH_VERSION`: uma versão suportada explicitamente escolhida na aplicação Meta.
   - `WHATSAPP_APP_SECRET`: segredo do aplicativo Meta.
   - `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_GATEWAY_SECRET`, `CRON_SECRET`: segredos independentes, cada um com pelo menos 32 caracteres aleatórios.
5. Guardar apenas o SHA256 hexadecimal de `WHATSAPP_GATEWAY_SECRET` em `private.whatsapp_gateway_config.secret_hash`, usando administração do banco. Nunca publicar o segredo em SQL versionado, no browser ou em logs. Gerar/transportar o valor por um canal privado de configuração.
6. Cadastrar `https://SEU_DOMINIO/api/whatsapp/webhook` na Meta, com o verify token acima, e assinar os eventos `messages` do WABA. GET valida o desafio; POST exige HMAC-SHA256 do corpo bruto em `X-Hub-Signature-256`.
7. Configurar o agendador abaixo. Liberar a cota de uma empresa piloto e somente então definir `WHATSAPP_SEND_ENABLED=true`.
8. Com destinatário autorizado, testar uma reserva real, recebimento no aparelho, retorno de entrega e confirmação. Os testes automatizados usam provedor isolado; não provam entrega pela Meta nem aprovação do modelo.

## Agendador

O endpoint `POST /api/whatsapp/process` aceita somente `Authorization: Bearer <CRON_SECRET>`. GET autenticado também é suportado. Ele busca os horários no banco e processa até cinco mensagens por chamada. Não recebe destinatários ou `company_id` do navegador. Use um agendador de servidor a cada minuto, por exemplo Supabase Cron + pg_net; o computador do proprietário não precisa permanecer ligado.

O arquivo `scripts/configure-whatsapp-cron.sql` contém a configuração com referências ao Vault, sem credenciais literais. Ele é separado da migração: só executar depois de publicar o endpoint e criar os segredos no Vault. Nenhum cron é instalado automaticamente em desenvolvimento. Conferir tanto o histórico do cron quanto os códigos HTTP das chamadas, pois o sucesso de enfileiramento no pg_net não prova envio.

Há tolerância de 15 minutos após o horário previsto. Lembretes mais antigos são descartados para evitar uma rajada atrasada após interrupção; a antecedência não é garantia de entrega exata. Para volumes maiores, monitorar a fila e dimensionar o lote/agendador antes de vender mais capacidade.

## Consumo e integridade

- Uma unidade é reservada atomicamente antes de cada tentativa. Os limites são contagens de tentativas, **não** saldo financeiro ou crédito de IA; não há cobrança criada por esta implementação.
- O mês é o calendário de São Paulo. Duplicatas de cron não reservam duas vezes. Falhas e resultados incertos continuam consumindo a unidade, por precaução. A cobrança final da Meta pode ser diferente; não usar este contador como fatura da Meta.
- Os limites usam bloqueio transacional por empresa. Proprietário/gerente podem reduzir o consumo próprio, mas não aumentar a cota definida pelo SUPER_ADMIN nem alterar o histórico.
- Revalidação antes do envio: empresa com acesso, preferência habilitada, cliente/profissional/serviço ativos, consentimento para o telefone atual, horário ainda válido e limite disponível.
- Resultados: preparação, envio, aceito, enviado, entregue, lido, falha, incerto, cancelado ou limite atingido. A aceitação HTTP da Meta não prova entrega; somente o webhook assinado atualiza os estados de entrega.
- Não há repetição automática após resposta ambígua ou interrupção durante envio. Um webhook pode reconciliar o resultado com o identificador opaco da tentativa. Revisar incidentes; nunca reenviar manualmente o mesmo registro sem investigar.
- Tokens de confirmação têm 256 bits; só o hash fica no banco. Confirmação exige agendamento ainda válido, e remarcação/cancelamento invalida a confirmação anterior. O link não solicita login nem revela telefone ou informações clínicas.
- A configuração pode ser desativada globalmente com `WHATSAPP_SEND_ENABLED=false`; webhooks continuam funcionando para reconciliar mensagens já enviadas.
- Há uma janela inevitável entre a última checagem no banco e a chamada externa: uma alteração exatamente nesse instante pode coincidir com um envio já iniciado. O link sempre consulta o estado atual.

## Validação

`pnpm test`, `pnpm test:whatsapp:db`, `pnpm typecheck`, `pnpm build` e `pnpm test:whatsapp:http`.

Os testes HTTP iniciam um processo isolado com credenciais fictícias, bloqueiam conexões externas e redirecionam Supabase e Meta a fixtures locais. A suíte SQL aplica todas as migrações em PGlite descartável para validar RLS, permissões, limites, idempotência, consentimento, cancelamento/remarcação e confirmação. As suites anteriores devem continuar passando.

Validação em 21/10/2026: migração aplicada ao projeto Web Fidelize; verificações no Supabase real confirmaram RLS, privilégios restritos, gateway configurado, recusa de segredo inválido e ausência de exposição por token desconhecido. Não houve seleção de destinatário real nem envio de WhatsApp. A inspeção visual pelo navegador foi bloqueada pela política de acesso, portanto a aparência mobile ainda exige conferência visual. PGlite serializa consultas; teste de carga com múltiplas conexões continua sendo uma etapa de homologação.

O Security Advisor retornou avisos informativos de RLS sem políticas nas tabelas privadas, intencionalmente inacessíveis aos clientes, e o aviso preexistente de [proteção contra senhas vazadas desabilitada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Nenhuma permissão foi ampliada para eliminar avisos.

Referências: [Meta: modelos de mensagens](https://www.postman.com/meta/whatsapp-business-platform/request/lwtlz1k/send-message-template-interactive), [Meta: política](https://whatsappbusiness.com/policy/), [preços](https://whatsappbusiness.com/products/platform-pricing/), [Supabase Cron](https://supabase.com/docs/guides/cron/quickstart), [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net).

