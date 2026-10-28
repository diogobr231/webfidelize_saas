-- Proposal catalog only: these offers do not create subscriptions or charge anyone.
insert into public.sales_offers(slug,title,summary,active,published,monthly_price_cents) values
 ('conteudo-gerenciado','Conteúdo gerenciado · até 30 posts/mês','Conteúdo para Instagram/Facebook, fotos autorizadas ou arte acordada, legenda e revisão. Início e conexões definidos na proposta.',true,true,99700),
 ('trafego-gerenciado','Gestão de tráfego · Meta Ads','Gestão de 1 conta Meta, verba de até R$ 1.500/mês paga à parte; uma campanha inicial e acompanhamento semanal. Proposta antes de ativar.',true,true,69700),
 ('gestao-digital-combo','Combo · Conteúdo e tráfego','Até 30 posts de imagem por mês e gestão de uma conta Meta Ads. Verba de mídia, SaaS e fotografia separados. Sob proposta.',true,true,169000),
 ('fotografia-mensal','Fotografia mensal · parceiro local','Uma visita mensal de até uma hora e 15 fotos tratadas, a partir do valor indicado. Região, parceiro, data e deslocamento sob confirmação prévia.',true,true,79000);
