# Segurança e estabilidade — 22/10/2026

Revisão do código, dependências, políticas SQL, aplicação publicada e registros do agendador. Os resultados abaixo têm escopo limitado aos caminhos verificados; não constituem garantia de ausência de vulnerabilidades.

## Correções

- WhatsApp de clientes e equipe: o lote agora exige confirmação positiva do banco ao registrar o resultado do envio. Resposta falsa, ausente ou inválida interrompe o lote com erro genérico, sem reenviar nem informar sucesso indevido. Testes cobrem também a rota HTTP real em ambiente isolado.
- Atualizados `tsx` para 4.23.15 e `esbuild` transitivo para 0.28.2, corrigindo [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr). A vulnerabilidade afetava o servidor de desenvolvimento do esbuild no Windows; não foi observada exploração. `pnpm audit`: nenhuma vulnerabilidade conhecida após a atualização.
- CI passa a verificar as branches `codex/**`, auditar dependências e incluir as suítes de avisos da equipe e fotos do espaço.
- Atualizada a verificação do SUPER_ADMIN para validar a seção/tabela realmente existentes, em vez de exigir um título antigo. O painel real carregou corretamente.
- Atualizadas as fixtures HTTP para representar as preferências de WhatsApp e a oferta pública do diagnóstico. Mantida a rejeição de chamadas inesperadas; nenhuma permissão da aplicação foi ampliada.

## Evidências

- 139 testes unitários e 323 grupos SQL em PGlite descartável aprovados; TypeScript e build aprovados.
- Autenticação isolada: oito grupos, incluindo confirmação, recuperação, convites, rejeição de redirecionamento externo e prova de sessão para troca de senha. Nenhum e-mail real enviado.
- WhatsApp HTTP isolado: 15 grupos, incluindo assinaturas, isolamento por remetente, cotas, confirmação e interrupção do lote quando a gravação não é confirmada. Nenhuma mensagem real enviada.
- Equipe HTTP isolado: 15 grupos; landing/diagnóstico: 16 grupos. A falha de preferência individual não impede carregar a agenda, e usuários sem acesso não consultam preferências de outra empresa.
- Produção: 27 grupos de páginas públicas/proteção, sete grupos com OWNER/EMPLOYEE nos três planos e SUPER_ADMIN, e cinco grupos de reserva pública. Dados QA criados pela reserva removidos por identificadores exatos; nenhum cadastro real foi alterado.
- As duas rotas de processamento de IA/WhatsApp recusaram acesso anônimo com HTTP 401 e `no-store`.
- Banco real: nenhuma tabela pública sem RLS e nenhuma função pública `SECURITY DEFINER`. Buckets de logos/capas privados, com limites de tamanho e tipos de arquivo. Os testes também verificaram revogação de acesso e tentativas de elevação por metadados do usuário.
- Agendador de tarefas internas: cinco execuções reais consecutivas bem-sucedidas, de 07h30 a 08h30 de Brasília em 22/10, sem tarefas novas elegíveis. Isso comprova execução do agendador de tarefas, não geração por IA nem entrega de mensagens.
- Busca por padrões de credenciais em 360 arquivos versionados: nenhuma ocorrência suspeita nos padrões verificados. Apenas `.env.example` versionado; inspeção dos arquivos de deploy não incluiu segredos, `.vercel` ou resultados de testes.
- Inspeção visual do admin publicado em viewport de 465 px: controles sem transbordamento horizontal. Esta rodada não substitui uma matriz completa de aparelhos físicos.

## Pendências concretas

1. **Conta administrativa:** separar a senha do SUPER_ADMIN das contas de demonstração e habilitar MFA. Os testes existentes conseguem autenticar ambos com a mesma senha de QA; nenhuma senha foi alterada nesta revisão.
2. **Central IA:** conta AI Gateway ainda retorna `verification_required`; processamento permanece pausado. Roteiro `scripts/test-admin-ai-success-live.ts` preparado e protegido por opt-ins, mas geração bem-sucedida real ainda não executada. Não habilitar automação enquanto o provedor estiver bloqueado.
3. **E-mail/WhatsApp:** configurar remetentes, credenciais e modelos oficiais e validar recebimento real com destinatários autorizados. Os testes isolados não comprovam entrega externa.
4. **Novo cliente:** o cadastro fica em `pending_card` até confirmação real do cartão. Com Mercado Pago adiado, a ativação comercial de novos clientes continua bloqueada. Regra preservada; nenhuma assinatura foi simulada.
5. **Operação em escala:** testar concorrência/carga com múltiplas conexões PostgreSQL e recuperação de backup. PGlite serializa consultas. O Advisor sinaliza oportunidades de índices/otimização de RLS; não foram alteradas permissões para eliminar avisos.
6. **Senhas vazadas:** proteção gerenciada desabilitada no Supabase; [a documentação informa disponibilidade no plano Pro ou superior](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Os avisos informativos de RLS sem políticas são de tabelas privadas intencionalmente fechadas.

O histórico do cliente recorrente pode ficar dividido quando ele faz novas reservas públicas, pois cada reserva cria um cadastro. Uma unificação futura precisa de verificação de identidade; telefone informado publicamente não deve permitir acesso ao histórico anterior.
