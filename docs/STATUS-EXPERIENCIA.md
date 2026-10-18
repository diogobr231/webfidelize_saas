# Atualização — experiência do cliente — 18/10/2026

Este relatório complementa `STATUS-AGENDAMENTO.md`. Registra as melhorias do painel, da agenda e da página pública, com os limites da validação realizada.

## Etapa 1 — primeiro uso e painel da empresa

- Entrada direta no painel quando há uma única empresa vinculada, mantendo a opção de trocar empresa.
- Navegação com seção ativa e identificação do papel do usuário; acesso da equipe continua limitado pelas permissões do servidor e por RLS.
- Indicadores de atendimentos de hoje e concluídos, próximos atendimentos e atalhos para a agenda.
- Checklist de serviços, profissionais, turnos e publicação da página, acompanhado de cópia do link e compartilhamento pelo WhatsApp.
- Empresa com assinatura bloqueada mantém consulta e configuração preservadas; o checklist não anuncia que ela pode receber reservas.
- Proprietário que já possui empresa recebe orientação para expansão pelo suporte, respeitando o limite atual do backend.

Arquivos principais: `src/app/painel/page.tsx`, `src/app/painel/[companyId]/page.tsx`, `src/app/painel/[companyId]/layout.tsx`, `src/app/painel/painel.css`, `src/components/setup-guide.tsx`, `src/components/share-booking.tsx` e `src/components/workspace-nav.tsx`.

## Etapa 2 — agenda e operação dos atendimentos

- Visualizações por dia e semana, filtro por profissional, nomes de cliente/serviço/profissional e estados em português.
- Criação por campos de data e horário, com conversão explícita para o fuso de São Paulo.
- Detalhes do atendimento e ações de remarcar, cancelar e concluir para OWNER/MANAGER com assinatura regularizada.
- Remarcação preserva cliente, serviço, profissional e duração originalmente reservada. Conflitos e horários fora dos turnos continuam rejeitados no banco.
- Cancelamento libera o horário; conclusão exige que o atendimento tenha terminado. Alterações de status continuam possíveis após a passagem do tempo ou remoção do turno antigo.
- Limites visuais do calendário consideram os turnos cadastrados, inclusive antes das 8h e depois das 19h.

Arquivos principais: `src/app/painel/[companyId]/agenda/`, `src/app/painel/actions.ts`, `src/components/agenda-experience.tsx`, `src/lib/scheduling.ts` e `tests/scheduling.test.ts`.

## Etapa 3 — apresentação pública e confirmação da reserva

- OWNER configura apresentação, endereço, WhatsApp público e uma das quatro cores disponíveis. Alterações respeitam limites de tamanho, validação no servidor e autorização no banco.
- Página de agendamento com identidade da empresa, serviços, profissional, data, horários e resumo antes da confirmação.
- Recibo detalhado assinado; os detalhes e o estado atual são consultados novamente no banco, inclusive após remarcação ou cancelamento. Reenvio com a mesma chave de idempotência descreve a reserva original.
- Download de arquivo de calendário com o horário atual da reserva. O recibo e o arquivo não incluem nome ou telefone do cliente.
- Comprovantes antigos usam mensagem neutra, sem afirmar um estado atual que não foi consultado.
- Empresas e cadastros de demonstração permanecem identificados como fictícios.

Arquivos principais: `src/app/agendar/[slug]/`, `src/components/booking/reserve-form.tsx`, `src/lib/booking-receipt.ts`, `src/app/painel/[companyId]/disponibilidade/` e `tests/booking-receipt.test.ts`.

## Banco e preservação dos dados

A migração `supabase/migrations/20261018214604_booking_experience.sql` foi aplicada. Ela acrescenta campos de apresentação pública, RPCs de perfil/gestão de atendimento/consulta do recibo e adapta a validação de status. Não recria empresas, usuários ou tabelas, nem altera os cadastros e agendamentos anteriores.

Continuam preservados: autorização por vínculo e papel, `company_id`, FKs compostas, RLS, limites de assinatura, prevenção de conflito e segredo de reserva restrito ao servidor. Não foi concedido UPDATE direto de agendamentos aos clientes da API.

## Validação executada

- TypeScript e build de produção: aprovados.
- Testes unitários: **13 aprovados**.
- Testes PostgreSQL em banco descartável: **56 aprovados**, carregando somente as migrações versionadas.
- Smoke HTTP: **26 verificações aprovadas**.
- Integração real: **10 grupos aprovados** em `scripts/test-experience-live.ts`, exercitando o fluxo completo pelas Next Server Actions e pelo Supabase. A reserva usada na demonstração foi explicitamente fictícia e terminou cancelada; dados anteriores foram preservados.
- Revisão de autorização, isolamento, datas, recibos e transições de estado realizada; os problemas encontrados nesta rodada foram corrigidos.

A inspeção visual em navegador desktop, com largura de 1265 pixels, confirmou a página pública, o onboarding, a agenda e os diálogos. Uma sessão DEMO separada por host permitiu criar, remarcar e cancelar pelo navegador sem trocar a sessão do proprietário. A inspeção encontrou um desalinhamento do diálogo, corrigido com centralização explícita.

Também foi observada a agenda em largura de celular (390 pixels). A alteração de viewport não se propagou a todas as abas da ferramenta; a revisão móvel completa da página pública e dos diálogos continua pendente. Os estilos responsivos estão implementados, mas essa cobertura parcial não deve ser apresentada como homologação completa de celular.

Após os testes, o banco manteve nove usuários, nove empresas e nove vínculos. Foram adicionados somente um cliente fictício e dois agendamentos de demonstração, ambos cancelados ao final. Nenhum registro anterior foi excluído.

Os testes aprovados não equivalem a homologação de cobrança, entrega de e-mail, carga distribuída ou conclusão de toda a revisão visual.

## Advisors e pendências

Não surgiram novos alertas de RLS na validação desta etapa. Permanece o alerta preexistente de proteção contra senhas vazadas desativada no Auth; avaliar a habilitação conforme o plano antes do lançamento. Referência: [segurança de senhas no Supabase](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Pendências para lançamento e próximos incrementos:

- Mercado Pago: aplicação/credenciais ainda necessárias; checkout, webhook e conciliação não estão homologados.
- SMTP de produção e validação de entrega/recuperação de senha por e-mail.
- Termos de uso e política de privacidade.
- Exceções por data, feriados e bloqueios pontuais de agenda.
- Upload do logotipo da empresa.
- Notificações automáticas.
- Cancelamento e remarcação pelo próprio cliente na página pública.
- Concluir a validação móvel da página pública e dos diálogos.

O teste HTTP entende os redirecionamentos por streaming do Next.js, além dos códigos 3xx; respostas HTML comuns continuam sendo rejeitadas como redirecionamento. A senha de teste fica somente na variável temporária do processo. Capturas de validação ficam na pasta local ignorada `test-results/ux/`.
