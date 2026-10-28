# Instruções para qualquer agente — Web Fidelize

Estas regras se aplicam a todo o repositório, independentemente de modelo, ferramenta ou fornecedor. Leia também README.md e docs/WORKFLOW.md antes de iniciar trabalho. Instruções explícitas do proprietário prevalecem.

## Issue antes de implementar

- Toda correção, melhoria ou nova função deve ter uma issue no GitHub `diogobr231/webfidelize_saas`. Pesquise antes para evitar duplicatas.
- Registre problema/objetivo, evidência, prioridade, escopo e critérios verificáveis de conclusão. Diferencie fato observado de hipótese e de proposta.
- Não invente números de issues, links, testes ou estados. Se faltar acesso de escrita, registre a pendência em docs/backlog e informe o bloqueio; use somente credenciais autorizadas.

## Branch e pull request

- Use uma branch `codex/<numero-da-issue>-<descricao-curta>` por tarefa ou conjunto coeso de issues. Preserve mudanças preexistentes do usuário.
- Trabalhe por PRs. A descrição deve mencionar as issues reais: `Closes #123` quando o merge concluir a tarefa; `Refs #123` para trabalho parcial ou dependência.
- Descreva problema/resultado, escopo, testes realmente executados, limitações, migrações e efeitos em produção. Inclua evidência visual em mudanças de interface.
- Use draft enquanto houver trabalho necessário ou verificações pendentes. Não declare uma feature homologada só por testes sintéticos.
- Não faça merge, force-push ou altere proteções de branch automaticamente sem autorização que cubra a ação.

## Deploy rastreável

- O fluxo normal é issue → branch → PR → CI/revisão/preview → merge autorizado → deploy identificado pelo commit/PR → smoke test.
- Confira repositório, branch de produção, projeto/time Vercel, ambiente e revisão exatos. Não publique direto do diretório sujo como atalho ao PR.
- Use preview antes de produção. Só publique/promova dentro do escopo autorizado pelo proprietário. Registre URL/ID/revisão, migrações, validação e rollback no PR.
- Releases históricos anteriores à adoção devem ser identificados como regularização de versão já publicada; não reaplique migrações nem faça downgrade acidental.
- Incidentes excepcionais exigem justificativa e registro em issue/PR; uma exceção não revoga o padrão dos próximos trabalhos.

## Segurança e usuários ativos

- Nunca exponha senhas, tokens, cookies, variáveis privadas ou dados de clientes em código, issues, PRs ou logs.
- Use dados fictícios identificados como teste; preserve produção, isolamento entre empresas e autorizações no servidor/banco.
- Não execute pagamentos, contratação de serviços, mensagens ou anúncios reais sem autorização específica. Estados e progresso devem refletir operações reais.

## Interface e movimento

- Siga docs/DESIGN-SYSTEM.md. Use a skill Design Motion Principles (`kylezantos/design-motion-principles`) quando disponível e aplicável; não alegue tê-la usado sem ler SKILL.md.
- Planeje estados de carregamento/skeleton, pending, vazio, erro e sucesso para rotas e operações assíncronas. Carregue recursos pesados sob demanda; preserve conteúdo crítico e layout estável.
- Use entradas e saídas discretas, feedback imediato e progresso determinado apenas quando houver medição real. Respeite `prefers-reduced-motion`, teclado, foco e leitores de tela.
- Não adicione atrasos, spinners ou animações em loop a elementos que não estão carregando. Cobertura compartilhada não substitui verificar os fluxos por área.
