# Central de Marketing interna

Rota: `/admin/marketing`. Acesso exclusivo de SUPER_ADMIN para divulgar a própria Web Fidelize. Não aparece no painel das empresas assinantes.

## O que funciona

- Campanhas persistidas com público, segmento, canal, objetivo, briefing e orçamento **planejado**.
- Criação idempotente e edição com versão: reenviar a criação não duplica a campanha; uma versão antiga não sobrescreve uma edição recente.
- Título, legenda e chamada editáveis. O botão de modelo usa textos determinísticos, identificados como modelos; não simula geração por IA.
- Revisão interna: rascunho → em revisão → aprovada internamente. Editar uma campanha aprovada a devolve a rascunho. Arquivamento é reversível.
- Links com UTM para cadastro/demonstração e link comercial fixo de WhatsApp. Não há analytics de cliques ou atribuição de conversões nesta entrega.
- Kit com texto/planejamento em TXT e arte gráfica própria em SVG ou PNG 1080 × 1350. A arte é um template de código, sem geração de imagem por IA, scripts ou recursos externos. A legenda completa fica no TXT; o template gráfico usa título e chamada, com quebras/truncamento limitado para preservar o quadro. Confira a prévia antes de publicar.
- Modelos de resposta a comentários/directs para revisar e copiar. Não há envio automático.
- Geração opcional de texto com AI SDK e o modelo já usado pelo projeto no Vercel AI Gateway. Saída estruturada, sem ferramentas e sem repetição automática. A geração exige confirmação de consumo na tela, conexão e conta/créditos disponíveis no provedor.

## Uso

1. Entre como administrador e abra **Marketing**.
2. Informe público, canal, objetivo e briefing. O orçamento é somente planejamento; salvar não compra mídia.
3. Use **Usar modelo de texto** ou escreva o anúncio. Salve a campanha.
4. Revise o texto e a arte. Baixe o kit e copie o link.
5. Envie para revisão e aprove internamente quando estiver pronto. Essa aprovação não ativa anúncios nem publica conteúdo.
6. Para gerar texto por IA, salve antes a versão que deseja usar e abra **Gerar outro texto com IA**. A geração substitui o texto salvo por um novo rascunho, se a campanha não tiver mudado durante o processamento.

## O que depende de integração externa

**Não implementado como automação nesta entrega:** publicação/agendamento em redes, criação/ativação de campanhas pagas, alterações de orçamento real, leitura de directs/comentários, respostas automáticas e métricas de anúncios. Os links para Meta Business Suite e Gerenciador de Anúncios abrem os serviços oficiais; não são botões que executam uma ação na Meta.

Windsor.ai e Metricool foram encontrados como plugins úteis para operar contas pela conversa. Instalar/conectar um plugin na conversa não cria automaticamente uma integração permanente no backend do SaaS. Não há tokens Meta nem chaves desses serviços armazenados por este módulo.

Uma integração posterior precisa conectar as contas corretas, obter os escopos e acessos necessários, confirmar a titularidade e respeitar as permissões e os limites de cada plataforma. A publicação e o atendimento usam APIs próprias; a integração de anúncios pagos é separada. Antes de ativar campanhas, definir limite de investimento, duração e condições de pausa; antes de respostas automáticas, definir conteúdo autorizado, janelas de atendimento e encaminhamento humano.

Fontes oficiais consultadas em 25/10/2026: [Instagram API, coleção oficial da Meta](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api), [Marketing API, coleção oficial da Meta](https://www.postman.com/meta/facebook-marketing-api/overview), [Conversations API](https://www.postman.com/meta/messenger-platform-api/folder/22794852-255610cd-47f5-4f4d-b3fa-71aec360be9a).

## Dados e segurança

Tabelas `platform_marketing_campaigns`, `platform_marketing_events` e `platform_marketing_generations`, todas com RLS. Clientes/colaboradores não têm leitura; nem o administrador possui INSERT/UPDATE/DELETE diretos. Cada RPC revalida a autorização atual de administrador no banco.

O histórico de eventos guarda tipo, autor e data, sem copiar briefing ou conteúdo. Exportação e SVG exigem autenticação/autorização e respondem com `private, no-store`. Conteúdo do SVG é escapado, sem HTML, scripts, imagens ou URLs externas.

IA: o servidor lê a campanha atual e o catálogo autorizado. O prompt usa somente público, objetivo, segmento, canal, briefing e informações públicas do produto; dados livres são tratados como não confiáveis e passam por remoção de contatos/credenciais óbvios. Isso não garante anonimização completa: não inserir segredos ou dados de clientes no briefing.

Cada tentativa é reservada no banco antes da chamada. Limites globais: 10/dia e 100/mês no fuso de São Paulo, separados das tentativas da antiga Central IA. Esses limites contam tentativas; não são limite em reais nem saldo do provedor. Falhas e resultados desconhecidos continuam no consumo. Uma reserva pendente impede outra chamada para a mesma campanha por até 15 minutos. Resultado atrasado ou de versão antiga não substitui o texto atual. Crédito e verificação do provedor continuam necessários; não há compra ou recarga automática.

## Verificação

- `pnpm test`: schemas, URLs, orçamento, fatos dos modelos/prompt e escaping do SVG.
- `pnpm test:marketing:db`: PostgreSQL descartável; criação/replay, versões, revisão/arquivamento, RLS, negações, quotas e resultados de IA sintéticos. Não contata provedores nem o banco real.
- `pnpm test:marketing:http`: login e formulário reais do Next com autenticação/REST locais isolados. Verifica persistência, revisão, edição, conflito de versão, acesso indevido, falha do backend, SVG e TXT; bloqueia tráfego externo e não prova funcionamento de provedores reais.
- Build e TypeScript obrigatórios antes de publicar.
- A geração por provedor real, conexão de redes e entrega/publicação precisam de homologação própria. Resultados sintéticos não comprovam essas ações.

Em 25/10/2026, passaram 269 testes unitários, 14 grupos do banco de marketing e 7 grupos HTTP isolados. A inspeção visual em desktop/celular e o download PNG foram feitos com campanha fictícia no backend de teste. A inspeção do perfil real no Edge foi interrompida pela ferramenta antes de acessar a aba; não representa aprovação visual autenticada em produção.
