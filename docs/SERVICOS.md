# Serviços, missão e demonstração

Solicitação do proprietário em 28/10/2026; issues #38, #39, #40 e #41.

Missão publicada no código da landing e de `/servicos`: **A missão da Web Fidelize é digitalizar negócios.** A navegação leva aos serviços e ao formulário comercial existente. A demonstração mantém “Seu espaço de trabalho”, inclui a logo e usa o escritório fictício Aurora. Pessoas e empresas de exemplo não são clientes reais nem depoimentos.

Contato comercial público informado pelo proprietário: contato@webfidelize.com. Os links `mailto:` da landing e de Serviços usam esse endereço. Essa apresentação não comprova SMTP de envio, recebimento ou alteração de conta de acesso.

## Oferta proposta

A página apresenta quatro módulos: agenda personalizada integrada ao SaaS; conteúdo; gestão de tráfego; fotografia mensal. O cliente pode pedir módulos separados ou o combo. As condições são definidas em proposta, sem checkout nem débito automático.

| Serviço                 | Preço inicial proposto     | Escopo inicial                                                                                                |
| ----------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Agenda                  | Catálogo de planos do SaaS | Assinatura própria; configuração e reserva pela página pública existente                                      |
| Conteúdo                | R$ 997/mês                 | Até 30 posts de imagem, mesmo conteúdo em Instagram/Facebook, legenda, até 5 hashtags e uma rodada de ajustes |
| Gestão de tráfego       | R$ 697/mês                 | Uma conta Meta Ads, uma campanha inicial e acompanhamento semanal; para verba de até R$ 1.500/mês             |
| Combo conteúdo + gestão | R$ 1.690/mês               | Escopos anteriores, com verba de mídia e SaaS separados                                                       |
| Fotografia              | A partir de R$ 790/mês     | Uma visita de até uma hora e 15 fotos tratadas; região, parceiro, data e deslocamento sob confirmação         |

Estes valores são **sugestões comerciais adotadas como preços iniciais**, não médias estatísticas de mercado nem cotações já aceitas por fotógrafos. O proprietário informou que contratará estúdios/parceiros por conta, em diferentes cidades. A oferta não garante cobertura nacional ou o mesmo custo em todas as regiões. Avaliar margem, impostos, retrabalho e custo do parceiro antes de fechar cada proposta.

Os preços dos serviços vêm de `sales_offers`, consultado no servidor; a migração `20261028200913_managed_service_offers.sql` insere as quatro ofertas de proposta sem alterar assinaturas. Sem registro disponível, a página mostra “Sob consulta”. Não há um valor alternativo fixado no JSX. As ofertas podem ser mantidas pelo comercial do admin. A preferência chega ao formulário de diagnóstico por slug autorizado, com um briefing inicial editável; o envio continua passando pela validação, consentimento, antispam e idempotência do funil existente.

## Pesquisa de referência em 28/10/2026

Preços publicados pelos próprios prestadores, com escopos diferentes; não equivalem a uma cotação para a Web Fidelize:

- [Mente Mestra](https://mentemestraia.com.br/gestao-de-redes-sociais/): R$ 497 por 12 posts, R$ 697 por até 20 entregas e R$ 997 por até 30 entregas; gestão de tráfego e captação presencial ficam fora desses planos.
- [Salazar Digital](https://loja.salazardigital.com.br/servico/gestao-trafego-meta/): gestão Meta Bronze por R$ 697/mês, para verba de até R$ 1.500 e uma campanha ativa. A verba de mídia é separada da gestão.
- [Sturm Agency](https://sturmagency.com.br/gestao-de-trafego-pago/): gestão a partir de R$ 1.500/mês em um canal para verba de até R$ 3.000, separada da mídia. Evidencia a variação de escopo/preço, sem afirmar que seja uma média.
- [Zoompro Studio](https://zoomprostudio.com.br/orcamento): pacote Cápsula de duas horas/30 fotos por R$ 700, com deslocamento indicado à parte por R$ 100. Referência de um prestador; não há contratação ou disponibilidade confirmada em outras cidades.

## Fotografias usadas na interface

Arquivos locais WebP, otimizados pela URL de entrega do banco de imagens; a página não depende de requisições remotas ao exibir as fotos.

| Arquivo                                   | Autor e origem                                                                                                    | Uso                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `public/demo/photos/office-interior.webp` | [Nastuh Abootalebi / Unsplash](https://unsplash.com/photos/room-with-glass-divider-and-white-curtain-rSpMla5RItA) | Banner do escritório fictício e demonstração do segmento escritório |
| `public/demo/photos/content-team.webp`    | [CoWomen / Unsplash](https://unsplash.com/photos/two-women-looking-at-a-laptop-on-a-table-YqBORf3ggKA)            | Página Serviços, com crédito e identificação de foto ilustrativa    |

Ambas as páginas indicavam download gratuito sob a [licença Unsplash](https://unsplash.com/license), consultada nesta data. Não associar as pessoas retratadas a depoimentos, identidades de clientes fictícios ou à equipe real da Web Fidelize. A foto do escritório também não representa sede ou cliente real.

## Verificação e release

Build e TypeScript aprovados no conjunto de alterações. Revisão no Chromium em 1280 e 390 px, incluindo links, legibilidade, ausência de overflow horizontal e movimento reduzido; imagens conferidas no navegador e por inspeção dos arquivos. Evidências em `docs/evidence/servicos/`. As capturas administrativas usam backend e empresas fictícios.

A publicação depende do fluxo issue → PR → CI/preview → merge autorizado → deploy identificado. Este documento não prova que a produção já foi atualizada. A operação das redes sociais está em uma entrega separada; conectar um aplicativo na Meta e homologar a entrega não são feitos por uma alteração no texto da oferta.
