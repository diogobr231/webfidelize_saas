# Issues, PRs e releases

Padrão definido pelo proprietário em 27/10/2026. Aplica-se a correções, melhorias, novas funções, ajustes de interface, migrações e infraestrutura. AGENTS.md é o ponto de entrada para qualquer agente/modelo.

1. Pesquisar/criar issue com evidência, escopo, prioridade e critérios de conclusão.
2. Criar branch específica a partir da base apropriada, preservando trabalho existente.
3. Implementar e validar; abrir PR mencionando a issue real na descrição.
4. Usar `Closes #numero` para tarefa concluída no merge, `Refs #numero` para etapa parcial. Dependências devem ser listadas.
5. Rodar CI e testar preview; registrar limitações, migrações, evidência visual e rollback. Não confundir teste isolado com homologação externa.
6. Fazer merge/deploy apenas quando autorizado. Identificar a revisão do release, conferir produção e registrar o resultado no PR/issue.

O template de PR e o formulário de issue ficam em .github. Templates são orientações; checks obrigatórios e proteção de branch dependem da configuração efetiva do GitHub. A branch de produção/Git integration Vercel deve ser verificada e regularizada antes de automatizar deploy por merge.

## Adoção e backlog

Na adoção, havia histórico e arquivos já publicados fora de origin/main. O PR inicial de regularização precisa explicar essa situação e listar migrações já aplicadas; ele não representa um novo deploy autorizado. Não reaplicar SQL só para adequar histórico.

`docs/backlog/issues.json` registra as tarefas levantadas e, após criação, seus números/URLs. `queued` significa ainda não criada no GitHub, nunca concluída. O GitHub é a fonte do estado operacional das issues/PRs; atualize a referência local sem duplicar tickets.
