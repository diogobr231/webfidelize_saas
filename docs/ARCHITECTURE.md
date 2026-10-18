# Web Fidelize — decisões de arquitetura

## Auditoria — 18/10/2026
Diretório original: somente quatro PNGs. Nenhum fonte, .git, .env ou backup local. Imagens preservadas. Busca remota sem repositório identificável; proprietário confirmou que ainda não existe. Git e Node encontrados no runtime do Codex. Projeto Supabase conectado está inativo e não foi alterado.

## Primeira venda
1. Site com preços claros, WhatsApp e entradas por nicho.
2. Login, confirmação de e-mail, recuperação e criação de empresa.
3. Clientes, serviços, profissionais e agenda sem conflitos, com horários de atendimento.
4. Link público de agendamento sem expor a carteira de clientes.
5. Trial de sete dias no banco, limite de profissionais, checkout de assinatura e conciliação por webhook.
6. Administração, suporte, backup, termos de uso e política de privacidade revisados pelo responsável.

## Implementação
Monólito modular, um deploy Next.js e um projeto Supabase. Sem microsserviços, filas, IA ou Redis no MVP. SSR por cookies; `getUser` no servidor. Cada operação valida usuário e vínculo. RLS verifica o mesmo vínculo no banco. Papéis e assinatura nunca vêm de user_metadata. SUPER_ADMIN é uma lista privada, provisionada pelo operador, sem cadastro público ou privilégio automático por e-mail.

Nicho é configuração da empresa, não uma autenticação diferente. `/entrar/[nicho]` usa a mesma identidade e leva ao painel autorizado. O usuário pode pertencer a várias empresas. Selecionar uma empresa não concede permissões. Sessões e respostas privadas não entram em cache público.

Relações entre clientes, profissionais, serviços e agenda usam chaves compostas com company_id. Sobreposição é rejeitada por constraint PostgreSQL, inclusive em concorrência. Escritas exigem assinatura ativa ou trial não expirado; cobrança e leitura permanecem disponíveis para regularização. EMPLOYEE vê apenas os próprios agendamentos e os clientes envolvidos; OWNER/MANAGER gerenciam o operacional. Somente OWNER gerencia vínculos. Limites de profissionais são transacionais.

Convites devem ser tokens de uso único, hash no banco e aceite pelo e-mail autenticado. Nenhum token ou dado de cliente em logs. Storage privado com prefixo company_id e políticas antes de habilitar uploads. Nenhum bucket público de dados pessoais.

Pagamentos: preço e plano consultados no backend; idempotência por tentativa persistida, assinatura vinculada à empresa, validação HMAC do webhook conforme documentação Mercado Pago, consulta autoritativa do recurso e transação de conciliação. Retorno do checkout nunca ativa assinatura. Reprocessamento precisa tolerar duplicatas e eventos fora de ordem. Implementação de cobrança só deve ser anunciada após sandbox e testes de assinatura inválida/replay.

## Árvore
```
src/
  app/                 site, autenticação e painéis (App Router)
  lib/                 catálogo, autorização, Supabase SSR
supabase/
  migrations/          SQL versionado
tests/                 regras de negócio
scripts/               validação SQL/isolamento
docs/                  arquitetura e relatório das etapas
public/                identidade visual
```

## Fases seguintes
Primeiro vender agenda para salão, pet ou recepção. Não anunciar prontuário, comandas, rotas, chatbot, geração IA ou publicação social como disponíveis. Expansão por módulos com concessões explícitas por empresa, mantendo a mesma fronteira de autorização. Central IA ficará exclusivamente em rotas de SUPER_ADMIN, com custos limitados e auditoria.
