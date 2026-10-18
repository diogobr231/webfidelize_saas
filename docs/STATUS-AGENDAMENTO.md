# Atualização — agenda pública e demonstração — 18/10/2026

## Implementado

- Página `/agendar/[slug]` com serviço, profissional, dia e horários livres, sem leitura pública de clientes ou agendamentos.
- Turnos por profissional/dia, com múltiplos turnos e prevenção de sobreposição; intervalos de almoço ficam fora dos horários oferecidos. O padrão seg–sex 08h–18h foi preservado como ponto de partida editável.
- OWNER configura slug único e ativa/desativa a página; OWNER/MANAGER gerenciam turnos, sujeitos à assinatura e RLS. Remover um turno não cancela reservas existentes.
- Reservas públicas criam dados somente na empresa selecionada. A duração vem do serviço e o banco rejeita conflitos, inclusive em concorrência.
- Gateway privado no servidor, com hash da credencial no banco; idempotência por request_id, limites transacionais por IP/telefone/empresa e recibo assinado. Site e consultas públicas não recebem essa credencial.
- Lead time de 30 minutos, horizonte de 60 dias, intervalos de início de 15 minutos e fuso São Paulo. Ainda não há feriados/bloqueios por data, turnos atravessando meia-noite, reagendamento ou cancelamento público.
- Administrador criado via Auth Admin por autorização do proprietário, com a senha informada, sem gravá-la em fontes ou documentação. Bootstrap privado consumido. Confirmação administrativa não equivale a teste de entrega de e-mail.
- Oito contas e empresas DEMO criadas, com serviços/clientes/profissionais/agendamento fictícios e banner explícito. Domínio de teste `.invalid`, sem envio a pessoas reais. Plano Empresarial para homologar durante trial; nenhum pagamento fictício foi cadastrado.
- SUPER_ADMIN passa a abrir `/admin` após login; “Suas empresas” lista somente vínculos pessoais do usuário.

## Arquivos principais

`supabase/migrations/20261018174530_public_booking.sql`, `src/app/agendar`, `src/app/painel/[companyId]/disponibilidade`, `src/lib/booking-receipt.ts`, `src/lib/supabase/public.ts`, `scripts/seed-demo.sql`, `scripts/test-live.ts`, `scripts/test-db.ts`, `tests/booking-receipt.test.ts`, `.env.example` e documentos deste diretório.

CLI Supabase voltou a não concluir o download. A migração foi validada em PostgreSQL descartável e aplicada pelo conector; o nome local usa a versão real retornada pelo histórico do servidor.

## Validação executada

- 37 testes PostgreSQL aprovados, incluindo isolamento, turnos, intervalos, conflito, idempotência, gateway, quota e inadimplência.
- 4 testes de regras/recibo assinado aprovados.
- TypeScript e build de produção aprovados com o ambiente real configurado.
- Logins das oito contas DEMO e do administrador testados pela API real. Cada conta DEMO viu somente sua própria empresa, clientes e catálogo. Houve uma falha transitória de rede na primeira rodada; o teste usa no máximo três tentativas de fetch e a rodada seguinte passou integralmente.
- Reserva real pelo formulário do navegador, com cliente explicitamente fictício na empresa DEMO Salão, confirmada por consulta ao banco. Não houve pagamento ou atendimento real.
- 18 verificações HTTP existentes aprovadas; extensão opcional para as oito páginas DEMO disponível com TEST_DEMOS=1.
- Advisors do Supabase: sem alerta de RLS/extensão/função para a nova migração; há alerta de proteção contra senhas vazadas desativada no Auth. Avaliar habilitação conforme plano antes do lançamento: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.

Os testes não equivalem a validação de carga distribuída, proteção completa contra bots, recuperação de senha por e-mail ou cobrança real. A opção de login e a reserva pública foram exercitadas; a alteração de turno pela UI ainda deve ser ampliada em E2E automatizado.

## Mercado Pago

Avanço feito: consulta à documentação oficial, escolha do fluxo de assinatura pendente com checkout hospedado, roteiro de credenciais e validação em `MERCADO_PAGO.md`, painel oficial aberto. O proprietário informou não ter a aplicação. O painel permanece em login, sem credenciais de teste no ambiente; checkout/webhook ainda não foram implementados nem anunciados como prontos.

A skill Marketplace orienta provisionar antes de implementar e interromper essa etapa quando depender da conta do usuário. A descoberta pelo CLI Vercel foi tentada, mas falhou por dependência ausente (`is-node-process`). Não foi provisionado outro provedor ou simulado pagamento. A próxima ação é entrar na conta Mercado Pago, criar a aplicação e configurar credenciais privadas; depois implementar checkout, notificação verificada, idempotência persistida e conciliação em sandbox.
