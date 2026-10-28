# Administração da Web Fidelize

Atualização de 25/10/2026. As áreas abaixo exigem sessão SUPER_ADMIN e continuam usando as autorizações do banco. Não criam vínculos de proprietário nem sessões em nome de clientes.

## Empresas

**Ver espaços** abre `/admin/espacos`. A consulta inclui todas as empresas, inclusive DEMO, com contagem exata, páginas de 25 e filtros por nome, plano, segmento e situação. Não existe o antigo teto de 100 na listagem. Empresas aparecem após concluir a criação da empresa; um usuário que só criou login e ainda não criou empresa não é um espaço.

Cada resultado leva ao diagnóstico de acesso, responsáveis, estrutura e pagamentos, ou aos controles administrativos de plano/situação. A listagem não permite entrar no painel como o proprietário. O SUPER_ADMIN continua sem receber automaticamente um vínculo operacional de cliente. Cobrança e cancelamento da recorrência continuam no fluxo do proprietário.

O endereço antigo `/painel?empresas=1` redireciona administradores para a nova lista; clientes continuam vendo somente seus próprios vínculos. A visão geral mostra até 12 empresas recentes e oferece **Ver todas**. A listagem de cotas do WhatsApp também usa páginas de 25 e busca por nome.

## Navegação

O mesmo menu aparece em todas as áreas: Operação, Crescimento e Configuração. Ícones acompanham rótulos; a guia ativa usa `aria-current`. No celular, **Guias do admin** abre o menu recolhível. Breadcrumb informa a área atual. As sete caixas de atalhos que repetiam o menu na visão geral foram removidas. Detalhes longos de pagamentos e integrações ficam recolhidos.

O visual administrativo usa superfícies neutras e destaca ações/estados, sem mudar o tema das páginas de empresas ou públicas. A navegação, espaços e integrações foram conferidos no navegador com autenticação fictícia e backend isolado, em desktop e celular de 390px. O menu móvel abriu e navegou corretamente; integrações não apresentou rolagem horizontal. A conferência com o perfil real em produção ficou pendente: a ferramenta interrompeu a automação do Edge. Os dados fictícios não foram enviados à produção.

## Integrações e custos

`/admin/integracoes` reúne status de configuração do servidor, próximos passos, painel oficial e botões de planos, taxas ou créditos. Não recebe senhas/chaves pelo navegador, não confirma saldo ou plano contratado e não compra nem assina serviços ao abrir links.

- **Vercel:** revisar plano para uso comercial. [Hobby é para uso pessoal não comercial](https://vercel.com/docs/plans/hobby); [planos](https://vercel.com/pricing).
- **Supabase:** banco, autenticação e arquivos; [capacidade e planos](https://supabase.com/pricing). Backup/restauração não são comprovados pela presença das variáveis.
- **E-mail:** Brevo foi escolhido na preparação; [planos](https://www.brevo.com/pricing/). O SMTP de autenticação é [configurado no Supabase](https://supabase.com/docs/guides/auth/auth-smtp), separado do transporte de convites na Vercel. Configuração não comprova entrega.
- **Mercado Pago:** [taxas do checkout](https://www.mercadopago.com.br/ferramentas-para-vender/check-out); credenciais e webhook, estado privado no banco e homologação são etapas distintas. `BILLING_MODE=disabled` aparece como cobranças pausadas. Não se deve habilitar cobranças antes da homologação.
- **AI Gateway:** [créditos por uso](https://vercel.com/docs/ai-gateway/pricing), separados da hospedagem. Não presumir que o modelo escolhido está coberto por crédito gratuito; conta verificada, acesso e saldo precisam de conferência no provedor.
- **WhatsApp:** [cobrança da Meta](https://whatsappbusiness.com/products/platform-pricing/), número oficial, modelos, autorização e rotina. A listagem de cotas não tem teto de 100; o parser atual ainda aceita até **100 conexões oficiais**. As cotas do banco não comprovam envio. O cron do WhatsApp precisa ser configurado externamente; não está em `vercel.json`.
- **Redes sociais:** a Central de Marketing prepara campanhas. OAuth/publicação, anúncios e atendimento automático ainda precisam de integração própria. [Meta Marketing API](https://www.postman.com/meta/facebook-marketing-api/overview).
- **Metricool/Windsor:** opcionais. [Metricool](https://metricool.com/pricing/) indica API nos planos Advanced/Custom; [Windsor](https://windsor.ai/pricing/) varia conforme recursos. Plugin na conversa não instala integração permanente no SaaS.
- **CEP/mapas:** o fluxo implementado usa [ViaCEP](https://viacep.com.br/) e links de mapas; não contrata API paga do Google Maps.

As fontes oficiais foram consultadas em 25/10/2026. Confira condições e preços no fornecedor antes de contratar. Nenhum valor fixo ou contratação automática foi introduzido no catálogo administrativo.

## Verificação

`tests/admin-spaces.test.ts` cobre normalização de filtros, busca literal de curingas, paginação acima de 100 empresas e preservação dos filtros. A suíte HTTP isolada usa autenticação fictícia e backend local; não cria contas nem dados reais. O teste de deployment usa GETs anônimos nas novas rotas, e o teste autenticado usa somente os DEMOs quando `TEST_SKIP_ADMIN=1`. A senha DEMO nunca é usada como alternativa para o proprietário da plataforma.

Na validação consolidada de 26/10/2026 passaram build/TypeScript, 273 testes unitários, 14 grupos de banco do marketing e 12 grupos HTTP isolados. O cenário de 201 empresas confirmou acesso até a última página, filtros, listagem de cotas e redirecionamento sem vínculos de cliente. As integrações foram verificadas quanto a links/status/segredos; não foi realizada contratação, publicação social, pagamento ou envio real.
