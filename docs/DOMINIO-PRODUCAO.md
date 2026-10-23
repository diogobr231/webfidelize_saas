# Domínio de produção

Atualização de 23/10/2026: `webfidelize.com` e `www.webfidelize.com` estão associados ao projeto Vercel `webfidelize-saas`, na equipe `diogobr231`. O `www` está configurado para redirecionar ao domínio principal com HTTP 308. A associação não conclui a conexão: o DNS ainda aponta para a Squarespace, e o acesso ao registrador está em recuperação.

O endereço operacional permanece `https://webfidelize-saas.vercel.app`. `APP_URL` e a configuração de autenticação remota ainda não foram trocados. Não anunciar o domínio próprio como disponível antes de validar DNS, HTTPS e os fluxos de autenticação.

## DNS solicitado pela Vercel

Valores retornados por `vercel domains verify` para este projeto nesta data; consultar novamente antes de aplicar caso a configuração mude.

| Tipo | Nome | Valor |
| --- | --- | --- |
| A | `@` | `216.198.79.1` |
| A | `@` | `64.29.17.1` |
| CNAME | `www` | `3a1755c3db9117f6.vercel-dns-017.com.` |

Alterar somente os registros web conflitantes na zona da Squarespace. Os A atuais do apex são `198.49.23.144`, `198.49.23.145`, `198.185.159.144` e `198.185.159.145`; o CNAME atual do `www` é `ext-sq.squarespace.com.`. Guardar a zona antes da alteração para permitir reversão.

Preservar os nameservers `nsa1` a `nsa4.squarespacedns.com`, o MX `1 smtp.google.com`, SPF, DKIM, DMARC e demais verificações de e-mail. Não transferir o registro nem mudar os nameservers para realizar esta conexão.

## Sequência de implantação

1. Concluir a recuperação/login do proprietário na Squarespace. A solicitação de recuperação pelo domínio foi enviada pelo formulário oficial; isso não comprova acesso recuperado.
2. Publicar e validar a compatibilidade de autenticação entre origens antes de alterar o domínio canônico. Usar somente origens exatas e confiáveis, sem wildcard e sem confiar em Host arbitrário.
3. Aplicar os registros web e verificar propagação e certificado HTTPS com `vercel domains verify` para apex e `www`.
4. Acrescentar os callbacks exatos do domínio novo no Supabase, preservando os antigos. Alinhar Site URL e `APP_URL` apenas quando o novo endereço estiver operacional.
5. Validar cadastro, confirmação, recuperação de senha, convite, login OWNER/EMPLOYEE/SUPER_ADMIN, reservas, recibos e SEO. Não reutilizar códigos de confirmação nem registrar tokens em evidências.
6. Manter o endereço `vercel.app` funcional para callbacks, recibos, notificações e retornos de pagamento antigos. Não aplicar redirecionamento global a webhooks ou callbacks PKCE.

A compatibilidade é optativa: quando o novo domínio estiver operacional, definir `APP_URL=https://webfidelize.com` e `AUTH_LEGACY_ORIGINS=https://webfidelize-saas.vercel.app`. Sem essa segunda variável, o comportamento atual permanece. Cadastro, login e recuperação iniciam no domínio canônico; callbacks já emitidos continuam na origem permitida onde o navegador guarda o verificador PKCE. Aceitar somente origens exatas, nunca curingas. Os testes de publicação exigem `TEST_DEPLOYMENT_URL` com uma dessas duas origens exatas.

O SMTP e a homologação financeira são configurações independentes do domínio. A conexão DNS, sozinha, não comprova envio de e-mail ou recebimento de pagamentos.
