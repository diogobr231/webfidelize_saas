# Landing comercial — 18/10/2026

## Entrega

A página inicial apresenta a Web Fidelize com benefícios da agenda, cadastro de clientes, serviços e profissionais, disponibilidade semanal e página pública de reservas. O design usa azul escuro e ciano, ilustrações do produto em HTML/CSS, planos comparáveis, configuração em três passos, perguntas frequentes e chamadas para cadastro e WhatsApp.

As ilustrações estão identificadas como fictícias. Não foram acrescentados depoimentos, avaliações, números de clientes ou promessas de recursos futuros como se estivessem disponíveis. Os planos exibem o catálogo atual (R$69,90, R$119,90 e R$199,90; 1, 3 e 10 profissionais). Os botões informam que o teste começa no Essencial. A cobrança online continua explicitamente indisponível.

A demonstração visual da landing é independente de contas temporárias: nenhum botão comercial depende do trial das empresas DEMO. As páginas públicas e as contas de teste existentes permanecem disponíveis conforme suas regras de acesso e validade.

Não foram adicionados pacotes, serviços pagos ou alterações de banco nesta etapa. A landing é pré-renderizada e seu CSS tem classes próprias. A agenda, a configuração guiada e a reserva pública da etapa anterior foram preservadas.

## Arquivos

- `src/app/page.tsx` e `src/app/landing.css`: conteúdo, apresentação, navegação e responsividade.
- `src/lib/seo.ts`, `src/app/layout.tsx`, `src/app/robots.ts`, `src/app/sitemap.ts` e `src/app/opengraph-image.tsx`: metadados, indexação, dados estruturados e imagem social.
- `tests/seo.test.ts`, `scripts/test-landing.ts` e `package.json`: verificações de SEO e testes HTTP da landing.
- `README.md`: configuração da origem definitiva e orientação de validação.

## Validação executada

- Build de produção e verificação TypeScript: aprovados.
- Testes unitários: **15 aprovados**, incluindo regras existentes de acesso, trial, agenda e recibos, além de indexação por ambiente.
- Landing HTTP: **8 grupos aprovados**. Cobrem H1, CTAs, WhatsApp, âncoras, canonical, Open Graph, Twitter, JSON-LD, PNG real de 1200 × 630, robots, sitemap e login sem indexação.
- Smoke das rotas existentes: **26 verificações aprovadas**, incluindo oito páginas públicas DEMO e bloqueio de páginas privadas sem sessão.
- Navegador: cadastro aberto a partir do CTA, navegação por âncoras e revisão visual em 1280 × 900 e 390 × 844. Planos e FAQ legíveis, sem rolagem horizontal nessas larguras. As capturas ficam em `test-results/ux/`, pasta local ignorada pelo Git.

O primeiro smoke não conseguiu consultar o Supabase porque o servidor local estava sem acesso de rede. Reiniciar o mesmo build com acesso autorizado resolveu a consulta; o smoke completo foi aprovado sem alterar aplicação ou teste para contornar a falha. A comparação de URLs no teste normaliza a barra final, mantendo a validação da origem e caminho.

Os testes não medem taxa de conversão, posicionamento em buscadores ou entrega de mensagens. O botão do WhatsApp foi validado pelo destino; nenhuma mensagem foi enviada.

## Implantação e próximo passo

Definir `APP_URL` com a origem HTTPS definitiva antes do build de produção. A página local e os ambientes Preview/Development usam `noindex`; o sitemap de produção inclui somente a landing. Autenticação e RLS continuam responsáveis por proteger os dados.

Mercado Pago, SMTP de produção, termos e privacidade continuam pendências de lançamento descritas no README. A nova apresentação não habilita cobrança nem altera os limites dos planos.

Validação da etapa anterior de agenda e segurança: [STATUS-EXPERIENCIA.md](STATUS-EXPERIENCIA.md).
