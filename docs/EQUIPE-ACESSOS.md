# Equipe, agenda atribuída e revogação

O cadastro de um profissional e a conta de acesso ao sistema continuam separados. Na tela **Equipe e acessos**, o proprietário convida uma pessoa e, depois do aceite, vincula essa conta ao profissional existente. A associação não cria profissionais, não altera limites de plano e não envia e-mails automaticamente.

## Permissões

- Somente o OWNER consulta o diretório com e-mails dos membros da própria empresa. O RPC não permite consultar outra empresa; gerentes, colaboradores e visitantes não podem usá-lo.
- Somente o OWNER associa ou remove o vínculo entre profissional e membro existente da mesma empresa. Uma conta pode ser vinculada a um profissional por empresa, conforme a restrição já existente no banco.
- Alterar ou remover um vínculo atual exige confirmação no formulário e no backend. Uma comparação do vínculo esperado impede sobrescrever uma alteração concorrente feita em outra aba.
- O EMPLOYEE consulta apenas o profissional atribuído, seus horários, agendamentos e clientes relacionados, conforme o RLS existente. O MANAGER mantém as permissões de agenda da empresa já previstas.
- A criação comum de profissionais continua disponível aos papéis autorizados, com o mesmo limite de plano. O INSERT direto não aceita mais a coluna `user_id`, impedindo contornar a autorização de associação através da Data API.

## Revogação de acesso

O proprietário pode revogar acesso de MANAGER ou EMPLOYEE após confirmar a ação. Essa operação continua disponível com trial vencido, inadimplência ou suspensão, pois remove uma autorização existente. Convites novos e alterações de vínculo continuam sujeitos ao acesso comercial ativo.

A transação remove a associação de login do profissional, revoga a participação na empresa e encerra convites ainda pendentes para aquele e-mail. Preserva o cadastro do profissional, sua disponibilidade, clientes e agendamentos. Não permite remover o OWNER nem modificar a participação em outra empresa.

Uma sessão de autenticação ainda válida não substitui a associação à empresa: após a revogação, as consultas seguintes deixam de retornar os dados dessa empresa pelo RLS. O usuário permanece autenticado e pode acessar outras empresas às quais ainda pertença. Dados já exibidos ou baixados antes da revogação não podem ser recolhidos.

## Verificações executadas

- `tests/team.test.ts`: **3 testes unitários aprovados**, incluindo parâmetros e confirmação obrigatória.
- `scripts/test-team-db.ts`: **18 verificações PostgreSQL/RLS aprovadas**, incluindo agendas preenchidas, isolamento entre empresas, bloqueio de gerente/colaborador, vínculo concorrente, limites do plano, revogação com identidade ainda válida e revogação após bloqueio comercial.
- `scripts/test-team-live.ts`: **9 grupos reais aprovados em 19/10/2026, às 12:59 UTC**, usando HTTP local, Supabase Auth e banco remoto configurado. O convite, o vínculo e a revogação passaram pelas Server Actions; o aceite usou o RPC com uma conta fictícia já confirmada.

O teste real usa exclusivamente `logistica@example.invalid` e `fornecedores@example.invalid`, com `is_demo` verificado nas duas empresas. Recusa vínculo preexistente, convite pendente anterior ou falta de profissional livre. Confere a visibilidade dos registros existentes; não cria agendamentos para completar a cobertura, que também é verificada com dados preenchidos no teste PostgreSQL descartável.

Ao terminar, o teste comparou profissionais, agendamentos, clientes, disponibilidade e situação comercial com as cópias anteriores e confirmou que permaneceram iguais. O vínculo temporário foi removido. Apenas o registro de auditoria do convite fictício aceito foi mantido. Nenhuma mensagem foi enviada e as sessões do navegador não foram utilizadas.

Para repetir, inicie o servidor local e execute `pnpm test:team` com `TEST_TEAM_LIVE=1` e `SEED_PASSWORD` definidos somente no processo. O script não imprime credenciais, cookies ou tokens de convite e tenta limpar apenas a participação que consiga atribuir à sua própria execução.
