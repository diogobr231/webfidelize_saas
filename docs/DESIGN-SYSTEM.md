# Sistema visual da Web Fidelize

O sistema visual combina superfícies grafite na comunicação comercial e na navegação com uma área de trabalho clara. A hierarquia privilegia a tarefa principal, os dados do negócio e o próximo passo. Bordas finas, cantos moderados e sombras discretas separam o conteúdo sem depender de grandes efeitos decorativos.

Este documento descreve os padrões e os pontos de manutenção do código. Resultados de build, testes e revisão visual são registrados nos relatórios de cada incremento, separadamente.

## Superfícies e cores

Os tokens comuns ficam em [globals.css](../src/app/globals.css). O tema padrão é grafite. `.workspace-shell`, `.admin-shell` e `.onb-entry` sobrescrevem as cores para a área clara. O cabeçalho e a navegação lateral do painel mantêm o grafite `#11151d`, com item atual identificado por cor, fundo, borda e `aria-current`.

| Token              | Tema grafite | Área de trabalho clara | Uso                            |
| ------------------ | ------------ | ---------------------- | ------------------------------ |
| `--bg`             | `#101216`    | `#f6f7f9`              | Fundo da página                |
| `--panel`          | `#181c23`    | `#ffffff`              | Cartões e painéis              |
| `--surface-subtle` | `#20252d`    | `#f0f3f6`              | Superfícies secundárias        |
| `--line`           | `#303640`    | `#e1e6ed`              | Bordas e divisores             |
| `--text`           | `#f5f7fa`    | `#17212b`              | Conteúdo principal             |
| `--muted`          | `#a3aab8`    | `#657182`              | Descrições e metadados         |
| `--cyan`           | `#5eead4`    | `#0d8078`              | Ação principal, seleção e foco |
| `--on-accent`      | `#093b35`    | `#ffffff`              | Texto sobre a ação principal   |
| `--accent-soft`    | `#173c38`    | `#e6f4f0`              | Destaques suaves               |

O nome histórico `--cyan` permanece no código, embora seu valor varie entre menta e verde conforme a superfície. Erros usam o conjunto `--danger`, `--danger-bg` e `--danger-line`, acompanhado de texto que explica o problema.

Estilos específicos ficam limitados ao contêiner da experiência:

- Landing: `.landing` e tokens `--wf-*` em [landing.css](../src/app/landing.css).
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

## Responsividade e interação

Grids usam colunas com `minmax(0, 1fr)` e os filhos devem permitir redução com `min-width: 0`. Textos variáveis, como nome da empresa e serviço, precisam quebrar sem ampliar a página. Tabelas e a agenda podem ter rolagem dentro de seu próprio contêiner.

Os pontos de quebra acompanham a densidade da experiência. A base global reduz grids a duas colunas em 850px e uma em 560px. A configuração guiada empilha o resumo lateral em 920px e ajusta os formulários em 580px. A reserva pública empilha sua lateral em 850px e simplifica o layout em 580px. A navegação do painel possui tratamento próprio no celular, preservando o acesso às rotas.

Ao acrescentar controles, planeje área de toque de pelo menos 44px para ações principais no celular. Os botões globais chegam a essa altura no breakpoint móvel; agendamento e configuração guiada já usam esse mínimo também em seus controles principais. Teste textos longos e estados de erro, além do estado vazio e do preenchido.

O foco por teclado usa `:focus-visible`, contorno de destaque e afastamento do elemento. Seletores em cartões preservam o `input` nativo e mostram o foco no cartão correspondente. Campos mantêm rótulos; erros devem preservar `aria-invalid`, relações de descrição e mensagens visíveis. Ícones e cores complementam o texto, sem substituí-lo.

Transições são curtas e discretas, em geral de 160ms. `prefers-reduced-motion: reduce` desliga animações e transições e retira a rolagem suave. Estados de carregamento precisam continuar informativos por texto e atributos como `aria-busy` ou `role="status"`, mesmo sem animação.

## Manutenção

Uma mudança visual deve preservar os contratos dos fluxos: destinos dos links, nomes e IDs dos campos, ações no servidor, estados de erro, idempotência e autorização. Na configuração guiada, mantenha as ações vinculadas no Server Component, os permalinks e a abertura do formulário adicional quando houver erro. A revisão do layout deve incluir desktop, celular, teclado e movimento reduzido; registre as verificações efetivamente executadas no relatório do incremento.
