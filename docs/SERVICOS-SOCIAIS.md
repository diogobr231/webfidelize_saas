# Operação social dos clientes no admin

Issues #36 e #37; dependências #11–#14. Rota `/admin/redes`, exclusiva de SUPER_ADMIN, com acesso também pela linha da empresa em **Ver espaços → Serviços e redes**. O marketing da própria Web Fidelize continua em `/admin/marketing`.

## Implementado e verificável

1. Escolha da empresa por lista paginada/busca literal. Posts e contas são filtrados novamente pela empresa no servidor.
2. Upload privado de JPEG, ou preparação local de PNG/WebP/JPEG: recorte central quadrado ou 4:5 e claridade manual. O editor converte a imagem em JPEG sem metadados originais e limita a saída a 1,5 MB. **Esses ajustes não são IA.**
3. Rascunho persistido com título, legenda, descrição acessível, conta e horário em fuso explícito. Uma edição nunca mantém autorização anterior de envio. Versões evitam sobrescrever outra aba.
4. Geração opcional de legenda e até cinco hashtags com o AI Gateway já usado no projeto. Exige confirmação para enviar foto/briefing e consumir créditos. Reserva no PostgreSQL antes da chamada, com teto global de 20 tentativas/dia e 300/mês; falhas contam e não são repetidas. Um resultado antigo não substitui uma edição atual. Ingestão/geração real ainda precisa de homologação.
5. Estados distintos: rascunho, planejado sem envio, agendado autorizado, enviando, publicado, falhou, resultado incerto e cancelado. A confirmação de publicação exige identificador retornado pelo provedor.
6. OAuth com a Meta: página explicitamente escolhida por ID e rede; autorização vinculada a administrador atual, empresa, nonce, cookie e prazo de dez minutos. Instagram profissional precisa estar vinculado à página do Facebook neste fluxo. Uma conta externa não pode ser associada a duas empresas. Tokens ficam cifrados em tabela privada com AES-256-GCM e contexto da empresa/rede/conta, sem retorno ao navegador.
7. Adaptador de publicação de foto simples para Instagram/Facebook, fila com claim transacional e finalização por tentativa. Um envio incerto nunca é repetido automaticamente. Itens atrasados em mais de 15 minutos são marcados como falha, sem publicar conteúdo antigo quando o serviço voltar.
8. Planejamento de tráfego por empresa, com conta, objetivo, período, verba de mídia e fee separados. Botões abrem campanhas e faturamento na Meta. **Criar/ativar/pausar anúncios pela API não está implementado nesta etapa.** Nenhum orçamento planejado representa gasto medido.

Arte genérica e edição generativa de foto ainda não foram implementadas no SaaS. As visitas de fotógrafo são negociadas pelo comercial; não há despacho automático, agenda de terceiros ou contratação de estúdio.

## Ativação externa

Variáveis exclusivamente no servidor, documentadas em `.env.example`:

- `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_VERSION`: aplicativo e versão Graph explicitamente suportados; `APP_URL` canônica HTTPS.
- URL de retorno OAuth: `https://webfidelize-saas.vercel.app/api/social/callback`. Registrar exatamente a origem/rota do ambiente em teste. Não usar uma preview arbitrária nem derivar o retorno do cabeçalho Host.
- `SOCIAL_TOKEN_ENCRYPTION_KEY`: 32 bytes aleatórios em Base64. Preserve a chave para ler conexões existentes; rotação exige recriptografar ou desconectar/reconectar contas. Nunca fornecer segredos pelo chat/issue/PR.
- `SOCIAL_WORKER_SECRET`: segredo aleatório de 32+ caracteres; somente seu SHA256 deve ser inserido por operador autorizado em `private.social_worker_configuration(secret_hash)`.
- `SUPABASE_SERVICE_ROLE_KEY`: somente no servidor, para assinar URL curta de mídia privada no worker. Não aparece no navegador. A fila continua exigindo o segredo independente; os fluxos administrativos usam a sessão normal e RLS.
- `CRON_SECRET`: autentica GET `/api/social/process`.
- `SOCIAL_PUBLISHING_ENABLED=false` por padrão. Não ativar antes de homologar conta, escopos, mídia, frequência do scheduler e cancelamento.

A rotina processa **um post por chamada**. É necessário configurar e verificar um agendador com frequência/capacidade adequadas aos horários e ao volume. A presença das variáveis não prova que ele está rodando. O cron diário do plano Hobby da Vercel não atende programação por minuto; escolher uma solução/plano apropriado antes de vender pontualidade. Nenhum plano pago ou agendador adicional foi contratado automaticamente.

Escopos solicitados para este fluxo: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`. O acesso a contas de clientes pode exigir App Review/Advanced Access/verificação conforme a Meta. A integração de anúncios é distinta e precisará de escopos e homologação próprios; ela não é concedida por esses escopos de publicação. Perfil pessoal não substitui Instagram profissional. Em 28/10/2026, após o proprietário concluir o cadastro de desenvolvedor e autorizar expressamente os termos/criação, foi criado o app Web Fidelize, ID público `1433508424915180`, contato `contato@webfidelize.com`, com os casos Instagram, Páginas e Marketing API. O painel confirma Não publicado. Nenhum portfólio empresarial foi associado. Credenciais, retorno OAuth, acesso de clientes e entregas continuam pendentes de configuração/homologação.

Fontes primárias: [coleção oficial Instagram da Meta](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api), [documentação Instagram com Facebook Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing), [Graph API](https://developers.facebook.com/docs/graph-api/), [URLs assinadas Supabase Storage](https://supabase.com/docs/reference/javascript/storage-from-createsignedurl). A Meta confirmou na coleção o fluxo `media` → consulta do container → `media_publish`; o adaptador usa host fixo e não segue redirects.

## Segurança e migração

`20261028202819_client_social_operations.sql` cria tabelas novas, RLS, RPCs e bucket privado; não altera trials, pagamentos, usuários ou dados comerciais existentes. A migração foi testada em PostgreSQL descartável. **Não foi aplicada à produção nesta etapa.**

OWNER e EMPLOYEE não leem os registros nem as mídias; tabelas não aceitam escritas diretas mesmo do admin. Cada RPC administrativa revalida SUPER_ADMIN no banco. A fila verifica se o aprovador continua sendo administrador. Desconectar a conta apaga a credencial e transforma posts agendados em planejados; não é permitido desconectar durante um envio em andamento. Revogações na Meta também podem impedir chamadas, mesmo que a última conexão local pareça ativa.

Upload e registro de banco não são uma transação distribuída. Um erro/resultado desconhecido pode deixar um objeto privado sem rascunho; o aplicativo não remove a mídia porque a gravação pode ter sido confirmada sem resposta. Replay reutiliza apenas bytes idênticos e não duplica o post. Limpeza de órfãos é uma pendência operacional; não apagar objetos usados por posts ou tentativas desconhecidas.

Rollback de código: desativar publicação e scheduler, preservar tabelas/bucket/tokens cifrados e voltar à revisão anterior. Não executar down migration destrutiva. Interromper o código não desfaz posts já publicados; conferir a rede e os IDs antes de qualquer reenvio manual.

## Testes

- `pnpm test`: 284 testes unitários no conjunto, incluindo 11 novos para fuso, validações, criptografia, OAuth, contrato do adaptador e resultado incerto. Provedor simulado, sem transmissão externa.
- `pnpm test:social:db`: 9 grupos PostgreSQL descartáveis, incluindo duas empresas, OWNER/EMPLOYEE/anon, vínculo da conta, mídia privada, replay, versões, revogação, resposta de IA antiga, segredo do worker e orçamentos separados.
- `pnpm test:social:http`: 10 grupos, Next e Server Actions reais contra Auth/REST/Storage locais. Testa upload, persistência após reload, planejamento, empresa incorreta na URL, rota de imagem, revogação e cron sem autorização. Tráfego externo bloqueado. A fixture de Storage interpreta multipart; SQL e serviço Storage são validações distintas.
- Chromium com backend fictício: preparação/upload de foto real de banco de imagens, rascunho/reload, planejamento, telas públicas/admin em 1280 e 390 px, teclado e reduced-motion. Evidências em `docs/evidence/servicos/`.

Esses testes **não aprovam publicação, IA, OAuth/App Review, Storage de produção, Meta Ads ou envio para conta real de cliente**. Permanecem pendentes conexão externa e homologação autorizada. Nenhuma mensagem, anúncio, publicação real, pagamento ou contratação foi executado.
