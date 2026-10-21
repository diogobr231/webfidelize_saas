# Web Fidelize — revisão para o primeiro piloto

Atualização de **21/10/2026**. Este registro complementa a auditoria de 19/10 e o incremento de operações. Abrange o código atual, testes locais, Supabase real com empresas DEMO e a preparação de e-mails. Não representa lançamento em produção ou aprovação de cobrança.

## Parecer comercial

O produto que pode ser demonstrado hoje é um **sistema de agenda e organização de atendimentos**: clientes, serviços, profissionais, horários, reservas públicas, histórico, equipe e indicadores operacionais. O primeiro piloto deve ser um negócio que compre esse conjunto, por exemplo um salão. Não apresentar oito sistemas especializados como se já existissem.

Os preços continuam vindo do catálogo configurado, sem alteração nesta revisão. Para avaliar o valor com o primeiro empreendedor, acompanhe tarefas reais: configurar a semana, receber uma reserva pelo celular, encontrar o histórico de um cliente, remarcar um atendimento e bloquear uma ausência. Registre tempo gasto e dificuldades durante o piloto; não anuncie economia, aumento de vendas ou redução de faltas antes de medir.

**A abertura comercial ainda depende de domínio/SMTP, homologação publicada e operação mínima. Pagamentos permanecem por último, conforme solicitado, e ainda exigem desenvolvimento.** A conta DEMO confirmada não prova que um novo cliente consegue receber o e-mail de cadastro.

## Correções e melhorias deste incremento

- Acesso por e-mail: destino do convite preservado no login/cadastro; confirmação por POST, sem consumir token em GET; reenvio e erros de SMTP/limite; recuperação com prova assinada, curta e vinculada à sessão verificada; confirmação da nova senha e encerramento da sessão após a troca.
- Equipe: lista paginada de convites, renovação que invalida o link anterior, cancelamento confirmado, limites persistidos por empresa/destinatário e revogação preservando os dados. Token devolvido somente no resultado privado do POST, sem entrar na query do painel.
- E-mails: três templates de Auth e transporte SMTP opcional para convites, com TLS obrigatório, credenciais só no servidor e estados honestos de envio. Nenhum e-mail real foi enviado nesta rodada.
- Apresentação: tour ilustrativo com agenda, ficha do cliente e página pública; navegação comercial móvel; página de planos com comparação, trial e condições. Não há vídeo demonstrando funcionalidades inexistentes, depoimentos ou estatísticas inventadas.
- Uso diário: menu móvel contextual, indicação da seção em fichas internas, formulários de acesso com texto maior no celular, links com área de toque maior, contraste e foco aprimorados.
- Marca: identidade grafite/menta preservada, ícones próprios para aba do navegador e atalho Apple, recuperação de navegação nas páginas de erro e 404. Ícones de atalho não significam funcionamento offline.

## Matriz de produto por segmento

Os oito logins específicos foram exercitados pelo Server Action real, com sessão própria e dados autorizados. Foram consultadas **64 páginas autenticadas**, mais **7 tentativas negadas entre empresas**.

| Segmento     | O que foi validado                                            | Limite comercial atual                                   |
| ------------ | ------------------------------------------------------------- | -------------------------------------------------------- |
| Salão        | Login, núcleo compartilhado, dashboard, listas e suporte      | Agenda e profissionais disponíveis; sem caixa integrado. |
| Pet shop     | Login, reserva pública e configuração guiada                  | Sem cadastro especializado de pets/tutores.              |
| Clínica      | Login, edição, histórico, arquivamento, conflitos e bloqueios | Agenda/recepção; sem prontuário.                         |
| Escritório   | Login, núcleo compartilhado, personalização e Storage         | Clientes e compromissos; sem módulo de tarefas.          |
| Restaurante  | Login e núcleo compartilhado                                  | Sem mesas, comandas, pedidos ou caixa.                   |
| Fornecedores | Login e núcleo compartilhado                                  | Sem pedidos, entregadores ou entregas.                   |
| Logística    | Login e núcleo compartilhado                                  | Sem planejamento de rotas.                               |
| Academia     | Login e núcleo compartilhado                                  | Sem turmas, alunos ou mensalidades próprias.             |

OWNER, MANAGER e EMPLOYEE foram exercitados por HTTP/Auth/banco. MANAGER criou, editou e arquivou apenas um cliente fictício; ações exclusivas do proprietário e acesso administrativo foram recusados. Após revogação, a mesma sessão perdeu acesso à empresa temporária e preservou sua empresa original. O acesso positivo de SUPER_ADMIN não foi reexecutado com a conta real nesta rodada; suas regras possuem testes SQL, e contas comuns foram impedidas de entrar.

## Evidências de teste

| Verificação                | Resultado e alcance                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unitários                  | **73 aprovados**, incluindo validação, assinaturas, recuperação e composição/tratamento de SMTP.                                                       |
| Banco local                | **154 grupos aprovados**: fundação 56, dashboard 10, ajuda 21, personalização 11, equipe 31, operações 25. PostgreSQL descartável PGlite.              |
| Auth isolado               | **8 grupos HTTP aprovados** com serviço Auth/JWT/JWKS sintético e bloqueio de rede externa. Não envia e-mails.                                         |
| Equipe integrada           | **9 grupos aprovados**, com Auth e Supabase reais em DEMOs; sem envio de e-mail.                                                                       |
| Operações                  | **11 grupos aprovados**: edição, histórico, arquivamento, bloqueios e concorrência.                                                                    |
| Experiência de agendamento | **10 grupos aprovados**: reserva, disponibilidade, comprovante, remarcação e cancelamento.                                                             |
| Primeiro acesso            | **8 grupos aprovados**: configuração, persistência, retomada e repetição idempotente.                                                                  |
| Auditoria operacional      | **10 grupos aprovados**: dashboard, planos, ajuda, permissões e validação.                                                                             |
| Listas                     | **7 grupos aprovados**: busca, paginação, totais e semântica HTML.                                                                                     |
| Personalização             | **7 grupos aprovados**, incluindo Storage real, publicação e retirada do logo.                                                                         |
| MANAGER                    | **7 grupos aprovados**, incluindo escrita permitida, negativas de autorização e revogação.                                                             |
| Nichos                     | **8 grupos de login aprovados**, 64 páginas e 7 negativas de isolamento.                                                                               |
| Dependências de produção   | `pnpm audit --prod --json`: **zero vulnerabilidades conhecidas reportadas** nesta execução. Não é garantia de ausência de vulnerabilidades.            |
| Contraste                  | Cinco pares compartilhados e 25 pares do tour/planos calculados; ajustes nos textos com contraste insuficiente. Não constitui auditoria WCAG completa. |

As suítes operacionais foram executadas no build que contém as correções de Auth/equipe. Após o acabamento visual, **o build consolidado e o TypeScript passaram**; também passaram novamente os **8 grupos de Auth isolado** e os **8 logins/64 páginas/7 negativas por nicho**. A suíte pública ampliada passou em **13 grupos HTTP**, cobrindo landing, planos, tour, navegação, SEO, ícones SVG/PNG reais e página 404. O teste foi ajustado para interpretar corretamente os fragmentos de HTML transmitidos pelo Next, sem exigir uma estrutura diferente da aplicação.

Foram examinados **50 arquivos estáticos do cliente** procurando os dois valores privados configurados neste ambiente: nenhuma ocorrência. A verificação não imprime nem versiona esses valores e não representa inspeção do ambiente de hospedagem. A revisão de aparência, interações JavaScript e aparelhos físicos permanece separada dos testes HTTP. O workflow [Validate no GitHub](https://github.com/diogobr231/webfidelize_saas/actions) executa TypeScript, testes unitários, seis suítes de banco, build e Auth isolado em cada versão enviada.

Os scripts de listas e configuração guiada tinham expectativas antigas que incluíam registros arquivados como ativos. Foram corrigidos para acompanhar as regras existentes; nenhum dado real foi apagado para fazer os testes passarem.

## Segurança e preservação

A migração `20261021023033_team_invitation_lifecycle.sql` foi aplicada no projeto separado Web Fidelize, com histórico e permissões conferidos. Funções internas não ficaram acessíveis diretamente ao cliente e o ledger privado de emissões usa RLS com negação por padrão. A autenticação continua sem `service_role` no aplicativo.

As associações temporárias foram revogadas, os bloqueios de teste removidos, as reservas de teste canceladas e a personalização restaurada. Permaneceram cadastros e históricos fictícios identificados como QA/DEMO, incluindo serviço/profissional de onboarding e chamado de teste. Nenhuma assinatura, trial ou empresa real foi alterada; nenhum WhatsApp ou e-mail foi enviado.

Os advisors ainda apontam a configuração preexistente de proteção contra senhas vazadas desabilitada e oportunidades anteriores de índices/RLS para escala. O aviso de RLS sem políticas no ledger privado é intencional: clientes não acessam essa tabela. Referências: [segurança de senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) e [avaliação de RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## O que falta para conquistar o primeiro cliente pagante

1. **Comprar o domínio e configurar envio.** `webfidelize.com.br` ainda não pertence ao projeto. Escolher provedor SMTP, validar DNS/remetente e configurar o Supabase e o envio opcional de convites. Guia: [EMAIL-PRODUCAO](EMAIL-PRODUCAO.md).
2. **Publicar o ambiente definitivo.** Configurar HTTPS, origem, segredo de recuperação, segredo de reservas e callbacks; instalar templates somente com a aplicação compatível. A conexão Vercel solicitou autenticação nas tentativas desta rodada, sem permitir concluir a inspeção; não houve deploy novo confirmado.
3. **Homologar acesso real e visual.** Receber os e-mails em caixas autorizadas, testar um novo cadastro completo e recuperação, abrir convites em outro dispositivo, verificar Gmail/Outlook e revisar a interface em 320/390/768/1280 px. A política do navegador recusou o acesso local nesta rodada; não houve nova homologação visual mobile. Evidências antigas não validam automaticamente o acabamento novo.
4. **Preparar a operação mínima.** Revisar termos/privacidade com os dados reais do negócio, definir suporte, trocar credenciais provisórias e separar contas DEMO, verificar backups e executar restauração de teste. Não coletar dados clínicos no produto atual.
5. **Conduzir um piloto acompanhado.** Usar serviços, horários e responsáveis autorizados de um único empreendedor. Observar as tarefas acima e corrigir dificuldades antes de anunciar módulos adicionais.
6. **Implementar pagamentos por último.** Criar a aplicação Mercado Pago e desenvolver/homologar checkout, webhook verificado, idempotência, conciliação e bloqueio por inadimplência. Não ativar assinatura paga por simulação ou por retorno visual do checkout.

Próximas melhorias de produto, após validar o piloto: seleção pesquisável no formulário da agenda para bases acima de 1.000 registros; cancelamento/remarcação pelo próprio cliente com autorização adequada; módulos de nicho guiados por demanda real. Esses itens não são recursos concluídos nesta entrega.

## Reprodução

Comandos e efeitos estão no [README](../README.md). As suítes `test:manager` e `test:niches` exigem, respectivamente, `TEST_MANAGER_LIVE=1` ou `TEST_NICHES_LIVE=1`, além da senha DEMO fornecida somente ao processo. Nunca execute testes de escrita em empresas reais. A suíte de nichos só lê dados de negócio; a de gerente cria uma associação e um cadastro temporários e encerra o acesso ao final.
