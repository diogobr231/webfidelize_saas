# Operação interna da Web Fidelize

`/admin` reúne empresas, oportunidades, suporte e pendências. `/admin/automacoes` configura as regras, acompanha tarefas e exibe as últimas execuções. As métricas de empresas e as rotinas de teste/suporte excluem espaços marcados como demonstração (`is_demo`). Valores de propostas comerciais não são tratados como receita recebida.

## Rotinas

- **Retorno comercial atrasado:** negociação aberta cujo próximo contato passou do prazo configurado.
- **Novo contato sem acompanhamento:** contato na etapa inicial, sem próximo retorno, sem atualização por mais horas que o limite.
- **Teste próximo do fim:** empresa real em teste, dentro da antecedência configurada, incluindo testes vencidos ainda sem acompanhamento.
- **Suporte aguardando atendimento:** chamado de empresa real ainda aberto ou em andamento, sem atualização pelo período configurado.

As rotinas criam tarefas internas. Elas não enviam mensagens, iniciam testes, alteram planos, bloqueiam empresas, processam pagamentos ou encerram chamados. O administrador abre o registro de origem para tomar a próxima ação. Pode concluir, reabrir ou adiar uma tarefa por 24 horas.

Cada evento de origem tem uma chave única. Executar novamente não duplica tarefas nem reabre tarefas concluídas pelo administrador. Mudanças relevantes na origem podem gerar uma nova tarefa; pendências abertas que deixam de corresponder à regra são resolvidas na próxima execução. Se a condição voltar a ocorrer para o mesmo evento, a tarefa resolvida automaticamente pode voltar a ficar aberta. Pausar uma regra interrompe a criação e a atualização automática de suas tarefas.

## Agendamento e segurança

As migrações `20261022023757_admin_operations.sql` e `20261022023927_admin_operations_scheduler.sql` instalam as regras e, em PostgreSQL com `pg_cron` disponível, um job a cada 15 minutos. PGlite não possui essa extensão: os testes locais chamam o mesmo motor diretamente. O agendador precisa ser verificado também no Supabase hospedado.

O job `webfidelize-platform-operations` executa a função privada no banco. Não usa chamadas externas nem chaves no frontend. Uma rotina diária mantém os logs técnicos do cron por 30 dias e os resumos de execução por 90 dias. Tarefas e registros de negócio são preservados.

Tabelas de operação usam RLS exclusiva de SUPER_ADMIN e não aceitam escrita direta de usuários autenticados. As funções públicas validam a autorização atual no banco; mudanças de regras e tarefas também exigem a versão observada. O trabalhador privado não é executável por `anon` ou `authenticated`. Dados pessoais de clientes das empresas não são consultados por essa central.

## Validação e operação

```powershell
pnpm test:admin-operations:db
```

O teste HTTP `pnpm test:admin-operations` exige autorização explícita por variáveis de processo e credenciais existentes, conforme o cabeçalho do script. Ele usa um contato comercial sintético identificado por `QA-OPS-`, nunca envia mensagens e informa os IDs de limpeza ao terminar. Não imprima senhas ou tokens.

Confira a última execução automática em `/admin/automacoes`. A execução manual permite validar o motor, mas não substitui a evidência do agendador. Falhas aparecem com uma categoria segura, sem detalhes internos de SQL. Se o projeto Supabase estiver pausado, o agendador não executará até o banco retornar.

### Evidência desta entrega

Validação em 22/10/2026: 17 grupos de banco da central, 128 testes unitários, 16 grupos HTTP públicos, 6 grupos HTTP autenticados da central e build de produção aprovados. O teste autenticado usou somente um contato `QA-OPS-` e sua tarefa; ambos foram removidos após a verificação. Empresas, planos e parâmetros das regras permaneceram inalterados.

O `pg_cron` do Supabase executou o motor com sucesso às 02:50 UTC, registrado também em `platform_automation_runs` com origem `scheduled`. Para observar o disparo, o intervalo foi temporariamente reduzido a um minuto e depois restaurado e conferido em `*/15 * * * *`. A rotina diária de retenção está cadastrada, mas seu primeiro disparo diário ainda não foi observado.

Publicação de produção `5b46fb4` confirmada na Vercel. Os 26 grupos HTTP públicos passaram. No navegador autenticado, execução manual, salvamento sem alteração de parâmetros e filtros funcionaram com feedback persistente. Admin e automações foram revisados em 320, 390, 768 e 1280 pixels, sem transbordamento horizontal; controles das automações com altura mínima de 44 pixels. A consulta de erros/falhas da implantação não retornou registros na janela verificada. Evidências locais em `test-results/admin-responsive-proof.json` e capturas `admin-central-publicado.png` / `admin-automacoes-mobile.png`, excluídas do Git e do deploy.
