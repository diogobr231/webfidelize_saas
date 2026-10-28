# Movimento e carregamento

Issue principal: #21. Relacionadas: #22, #23, #24, #25, #26 e #27.

Skill aplicada: [Design Motion Principles](https://github.com/kylezantos/design-motion-principles), instalada a pedido do proprietário. Contexto e direção confirmados em 27/10/2026: SaaS de produtividade, Emil Kowalski principal e Jakub Krehel secundária.

## Implementação compartilhada

- Template de rota: entrada de 180ms, deslocamento de 5px e opacidade. Filtros/digitação não têm atraso artificial.
- Saídas de navegação documental usam View Transitions quando suportado; navegadores sem suporte mantêm a navegação normal. Navegação SPA do Next não recebe promessa de saída animada universal.
- Diálogo de confirmação usa transições discretas nativas de display/overlay quando suportadas. Entrada de 180ms e saída mais curta, com foco/cancelamento nativos preservados. Details têm fade de conteúdo com melhoria progressiva.
- Teclado desativa as transições compartilhadas a partir da primeira interação. `prefers-reduced-motion` mantém conteúdo e ações imediatos, sem shimmer/translação.
- Skeleton global cobre rotas que não têm fallback próprio. Há variantes de tabela/formulário e novos fallbacks para admin, espaços, integrações e marketing.
- Progresso indeterminado só aparece enquanto o fallback está carregando; não existe porcentagem inventada. Botões existentes continuam usando o pending real das Server Actions; o botão compartilhado anuncia a mudança de texto.
- Prévia de arte e logotipo de personalização fora da região crítica usam carregamento lazy. Logo principal e capa acima da dobra continuam prioritárias. A capa informa `aria-busy` até carregar e conserva o fallback em caso de erro.

## Cobertura e limites

Rotas Next já têm divisão de código. Lazy loading deve servir a um custo real: não transforme cada campo ou botão em um chunk, nem atrase o conteúdo principal. Não use skeleton em conteúdo que já está disponível.

Os componentes específicos de formulários, downloads, CEP, importação, IA, cobrança e agendamento têm estados próprios. Esta mudança compartilhada não comprova todas as transições de todos os fluxos. A matriz de verificação E2E deve cobrir admin, clientes, público/autenticação e reservas antes de encerrar #27. Homologações externas continuam separadas.

## Como verificar

1. Abrir páginas com resposta lenta e conferir skeleton, status e preservação do layout.
2. Navegar por mouse e teclado, reabrir/cancelar confirmação e testar detalhes.
3. Repetir com movimento reduzido e em celular; todos os controles devem continuar utilizáveis.
4. Salvar dados fictícios e conferir pending, erro e sucesso reais; não executar pagamentos ou envios externos.
5. Conferir imagens lentas, em cache e com erro; manter dimensões e evitar imagem principal lazy.

Os PRs devem registrar evidências efetivamente executadas. Não declarar cobertura global aprovada somente pela existência de CSS compartilhado.
