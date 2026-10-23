# Sistema visual da Web Fidelize

O sistema visual usa superfícies claras, texto azul-marinho e detalhes em ciano na landing, no acesso, no painel das empresas e no admin. Cabeçalhos, navegação e formulários usam a mesma identidade clara. A hierarquia privilegia a tarefa principal, os dados do negócio e o próximo passo. Bordas finas, cantos moderados e sombras discretas separam o conteúdo sem depender de grandes efeitos decorativos.

Este documento descreve os padrões e os pontos de manutenção do código. Resultados de build, testes e revisão visual são registrados nos relatórios de cada incremento, separadamente.

## Superfícies e cores

Os tokens comuns ficam em [globals.css](../src/app/globals.css). O tema base grafite permanece restrito às páginas públicas legadas que ainda o usam. `.workspace-shell`, `.admin-shell`, `.onb-entry` e `.ui-state-page` aplicam os tokens claros; a autenticação possui tokens claros próprios. Cabeçalhos e navegação usam branco, com item atual identificado por ciano, fundo suave, borda e `aria-current`. O fundo do documento acompanha esses contêineres, inclusive durante carregamento e erro.

| Token              | Tema grafite | Área de trabalho clara | Uso                            |
| ------------------ | ------------ | ---------------------- | ------------------------------ |
| `--bg`             | `#101216`    | `#f7fafc`              | Fundo da página                |
| `--panel`          | `#181c23`    | `#ffffff`              | Cartões e painéis              |
| `--surface-subtle` | `#20252d`    | `#edf6fa`              | Superfícies secundárias        |
| `--line`           | `#303640`    | `#dce7ef`              | Bordas e divisores             |
| `--text`           | `#f5f7fa`    | `#082b46`              | Conteúdo principal             |
| `--muted`          | `#a3aab8`    | `#52677a`              | Descrições e metadados         |
| `--cyan`           | `#5eead4`    | `#00758c`              | Ação principal, seleção e foco |
| `--on-accent`      | `#093b35`    | `#ffffff`              | Texto sobre a ação principal   |
| `--accent-soft`    | `#173c38`    | `#e5f8fc`              | Destaques suaves               |

Na interface clara, `--cyan` usa ciano escuro para preservar o contraste de texto, botões e foco. O ciano intenso da marca fica nos detalhes decorativos. Erros usam o conjunto `--danger`, `--danger-bg` e `--danger-line`, acompanhado de texto que explica o problema.

Estilos específicos ficam limitados ao contêiner da experiência:

- Landing: `.wf-site` e tokens `--wf-*` em [landing.css](../src/app/landing.css). O tema claro é independente dos tokens globais; ciano intenso fica nos detalhes, com azul-marinho ou ciano escuro para textos legíveis. As camadas decorativas ficam atrás do conteúdo e não interceptam cliques.
- Autenticação: [auth.css](../src/components/auth.css), com apresentação de marca e formulário claro.
- Painel: [painel.css](../src/app/painel/painel.css), [operations.css](../src/app/painel/operations.css) e estilos próprios da agenda.
- Configuração guiada: `.onb-page`, tokens `--onb-*` e [onboarding.css](../src/components/onboarding/onboarding.css).
- Agendamento público: `.booking-page`, tokens `--booking-*` e [booking.css](../src/app/agendar/[slug]/booking.css). As quatro opções da empresa — `teal`, `blue`, `violet` e `rose` — mudam a cor de destaque e seu fundo suave, preservando a base clara e o texto neutro.

Ao criar uma tela, reutilize os tokens do contêiner. Uma alteração local não deve redefinir cores de `body`, `label` ou `input` fora desse escopo. A escolha de tema visual não altera permissões nem disponibilidade de recursos.

## Tipografia e origem da fonte

A fonte é **Geist variável**, armazenada em [src/app/fonts/Geist.woff2](../src/app/fonts/Geist.woff2) e carregada por `next/font/local` no [layout raiz](../src/app/layout.tsx), com pesos `100 900` e `display: "swap"`. A variável `--font-geist` compõe `--font-sans`, seguida de fontes de sistema como fallback. O carregamento usa o arquivo local, sem buscar a fonte em um serviço externo durante o uso da página.

Origem registrada:

- Repositório oficial: [vercel/geist-font](https://github.com/vercel/geist-font).
- Commit: `e1f671c727f6de7e97c1e1d26dbb44f349c19459`.
- Arquivo de origem: [`fonts/Geist/webfonts/Geist[wght].woff2`](https://github.com/vercel/geist-font/blob/e1f671c727f6de7e97c1e1d26dbb44f349c19459/fonts/Geist/webfonts/Geist%5Bwght%5D.woff2), salvo localmente como `Geist.woff2`.
- Licença: **SIL Open Font License 1.1**, com copyright dos Geist Project Authors, preservada em [src/app/fonts/OFL.txt](../src/app/fonts/OFL.txt). Mantenha esse arquivo junto da fonte ao distribuir o projeto.

O corpo global usa 14px. Títulos têm peso intermediário, espaçamento entre letras moderadamente reduzido e tamanhos fluidos. A configuração guiada e a reserva pública usam corpo de 14px e notas de 12px; formulários no celular usam texto de 16px. Valores e horários podem usar `font-variant-numeric: tabular-nums` para facilitar a comparação.

## Espaçamento e forma

A escala global de espaçamento é de 4, 8, 12, 16, 24 e 32px, disponível em `--space-*`. Os raios globais são 8px para controles, 12px para agrupamentos e 16px para painéis. Componentes específicos podem ajustar esses valores sem perder a proporção do conjunto.

Use `--shadow-sm` para separação sutil e `--shadow-md` em superfícies com maior destaque. A cor e a borda devem continuar distinguindo os elementos quando a sombra não for perceptível. Botões secundários mantêm fundo discreto e borda; a ação principal recebe a cor de destaque.

## Componentes reutilizáveis

Os componentes estão em `src/components/ui` e usam SVG local e CSS do projeto, sem uma biblioteca externa de ícones.

| Componente                                         | Contrato                                       | Aplicação                                                                                                                                                                 |
| -------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Brand](../src/components/ui/brand.tsx)            | `href?`, `className?`                          | Marca com símbolo, nome e link. O destino padrão é `/`; possui nome acessível.                                                                                            |
| [Icon](../src/components/ui/icon.tsx)              | `name: IconName`, `size?`, propriedades SVG    | Ícone de traço com `currentColor`; tamanho padrão de 20px. É decorativo, com `aria-hidden` e sem foco. O controle que o contém deve fornecer seu texto ou nome acessível. |
| [PageHeader](../src/components/ui/page-header.tsx) | `title`, `eyebrow?`, `description?`, `action?` | Cabeçalho de tela com um `h1` e área para ação contextual.                                                                                                                |
| [EmptyState](../src/components/ui/empty-state.tsx) | `title`, `description?`, `icon?`, `children?`  | Estado vazio com explicação e, quando aplicável, ação para começar. Renderiza título `h3`; confira a hierarquia ao inseri-lo.                                             |

Prefira esses componentes ao repetir símbolos, cabeçalhos e estados vazios. A ação exibida deve existir e respeitar as permissões já calculadas no servidor. Estados vazios mostram ausência de registros; não devem receber dados fictícios para preencher a tela.

## Ícones do site

A marca compartilhada usa [public/webfidelize-logo.png](../public/webfidelize-logo.png), arquivo original de 1600 × 533 enviado pelo proprietário, sem redesenho. O componente `Brand` preserva a proporção e contém o espaço externo da imagem por CSS. A placa clara mantém o contraste também nos cabeçalhos escuros. `public/logo.png` é a versão transparente preexistente da mesma identidade, incorporada ao SVG do ícone com enquadramento no monograma WF. Não substituir pelo antigo símbolo genérico em formato de W.

O símbolo da marca também aparece em [src/app/icon.svg](../src/app/icon.svg), para identificação do site no navegador, e em [src/app/apple-icon.tsx](../src/app/apple-icon.tsx), que gera um PNG de 180 × 180 com `ImageResponse` de `next/og`. São arquivos locais, sem imagens ou fontes externas. O Next.js inclui os metadados de ícone conforme suas [convenções nativas de app icons](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons).

Esses arquivos identificam visualmente o site. Eles não implementam instalação de aplicativo, suporte offline, notificações ou sincronização em segundo plano. A geração do PNG e as tags resultantes devem ser verificadas no build e nas respostas HTTP; revisão somente do código não comprova a renderização nos dispositivos.

## Responsividade e interação

Grids usam colunas com `minmax(0, 1fr)` e os filhos devem permitir redução com `min-width: 0`. Textos variáveis, como nome da empresa e serviço, precisam quebrar sem ampliar a página. Tabelas e a agenda podem ter rolagem dentro de seu próprio contêiner.

Os pontos de quebra acompanham a densidade da experiência. A base global reduz grids a duas colunas em 850px e uma em 560px. A configuração guiada empilha o resumo lateral em 920px e ajusta os formulários em 580px. A reserva pública empilha sua lateral em 850px e simplifica o layout em 580px. A navegação do painel possui tratamento próprio no celular, preservando o acesso às rotas.

Ao acrescentar controles, planeje área de toque de pelo menos 44px para ações principais. Os botões globais usam esse mínimo; agendamento e configuração guiada também o preservam em seus controles principais. Teste textos longos e estados de erro, além do estado vazio e do preenchido.

O foco por teclado usa `:focus-visible`, contorno de destaque e afastamento do elemento. Seletores em cartões preservam o `input` nativo e mostram o foco no cartão correspondente. Campos mantêm rótulos; erros devem preservar `aria-invalid`, relações de descrição e mensagens visíveis. Ícones e cores complementam o texto, sem substituí-lo.

Transições são curtas e discretas, em geral de 160ms. `prefers-reduced-motion: reduce` desliga animações e transições e retira a rolagem suave. Estados de carregamento precisam continuar informativos por texto e atributos como `aria-busy` ou `role="status"`, mesmo sem animação.

## Acesso e orientação no celular

O `AuthShell` apresenta a marca sobre fundo claro com detalhes suaves em ciano e formulário branco. O símbolo existente é preservado; os detalhes visuais usam apenas CSS e SVG local. O link de pular conteúdo aparece ao receber foco e leva diretamente ao formulário. No celular, os campos usam 16px e os links auxiliares têm área de toque mínima de 44px. As notas e os placeholders usam cores de leitura, sem depender de cinza muito claro. Os recuos consideram a área segura do dispositivo.

O botão do menu móvel mostra a seção atual e mantém o nome acessível de abrir ou fechar o menu. A página exata usa `aria-current="page"`; uma ficha dentro da seção usa `aria-current="location"`, com o mesmo destaque visual na navegação lateral e nos atalhos inferiores. A lista continua sendo montada conforme o papel recebido do servidor. Isso orienta o usuário sem criar novas permissões ou rotas.

Cabeçalhos e ações compartilhados permitem quebra de linha para nomes longos. Estados vazios acomodam mais de uma ação sem comprimir os botões. Controles desabilitados mostram impedimento; botões com `aria-busy="true"` mantêm o indicador de espera. Esses ajustes não substituem a validação de autorização no servidor.

## Manutenção

### Imagem da demonstração

`public/demo/espaco-ilustrativo.png` é uma imagem ilustrativa de recepção comercial, gerada com a ferramenta integrada ImageGen em 23/10/2026. Não representa uma empresa cliente. A demonstração identifica a imagem como ilustrativa; a página real continua usando a foto e a logo autorizadas da própria empresa. O arquivo original tem 1536 × 1024 px e deve ser entregue pela otimização de imagens do Next.js para reduzir o tráfego no celular.

Prompt utilizado: “Use case: photorealistic-natural. Asset type: wide cover photograph for a Brazilian SaaS online booking demonstration, 1536x1024 landscape. Create an inviting small-business reception space, contemporary and realistic: light oak reception desk, white and warm off-white walls, two comfortable navy fabric chairs, a small indoor plant, soft natural daylight from large windows, a subtle cyan design accent. Neutral reception suitable for many service businesses, with no equipment specific to one niche. Eye-level architectural interior photography, clean balanced composition, believable materials, welcoming rather than luxury-hotel scale. No people, no writing, no logos, no watermark, no frames or UI. This will be explicitly labeled as an illustrative AI-generated space in the demo, never as a real customer business.”

Uma mudança visual deve preservar os contratos dos fluxos: destinos dos links, nomes e IDs dos campos, ações no servidor, estados de erro, idempotência e autorização. Na configuração guiada, mantenha as ações vinculadas no Server Component, os permalinks e a abertura do formulário adicional quando houver erro. A revisão do layout deve incluir desktop, celular, teclado e movimento reduzido; registre as verificações efetivamente executadas no relatório do incremento.
