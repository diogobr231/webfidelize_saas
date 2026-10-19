# Personalização por empresa

A página `/painel/{companyId}/personalizacao` permite ao OWNER configurar nome comercial, descrição, endereço, telefone, quatro paletas de cor, densidade do painel, visualização inicial da agenda e logotipo. As informações e cores reaproveitam os mesmos campos do agendamento público. Os horários continuam na tela de disponibilidade, acessível por um atalho, sem criar uma segunda fonte de regras.

## Segurança e armazenamento

- Toda gravação valida a sessão e a associação do OWNER à empresa no servidor. O banco valida novamente papel, `company_id` e acesso comercial ativo.
- As preferências são colunas da empresa protegidas pelo RLS existente. Elas não modificam planos, trial, permissões ou status de assinatura.
- `company-logos` é um bucket privado, com limite de 750 KB por arquivo e tipos PNG, JPEG e WebP. O servidor verifica tamanho, MIME e assinatura binária; não aceita SVG, nome de arquivo enviado pelo cliente ou URL externa.
- Os nomes são `{company_id}/{UUID}.ext`, sem sobrescrita. A assinatura de visualização usa o JWT do usuário e RLS, sem `service_role`.
- A publicação é uma opção explícita. A política pública autoriza apenas a operação exata `object.sign` do arquivo atualmente publicado, com agendamento habilitado e assinatura/trial ativo. A listagem anônima é negada. A aplicação emite URLs válidas por 60 segundos; URLs já emitidas podem continuar acessíveis até expirar e uma imagem publicada pode ser baixada por visitantes.
- O RPC que associa um arquivo à empresa também exige a capacidade de servidor `BOOKING_GATEWAY_SECRET`, já existente. Essa capacidade não substitui a autorização do OWNER e não é enviada ao navegador.
- A troca do ponteiro usa bloqueio de linha e comparação do caminho esperado. Uma solicitação concorrente antiga não consegue restaurar um arquivo substituído. O RLS impede apagar o logotipo atual; a aplicação remove o anterior após a troca e tenta limpar arquivos órfãos com mais de 24 horas nas gravações seguintes. Uma falha transitória nessa limpeza pode deixar um arquivo órfão até a próxima tentativa.

## Integração

- Layout: `data-density={company.display_density || 'comfortable'}`.
- Agenda: `company.agenda_view` como padrão somente quando o usuário não escolher `view=day|week` na URL. O padrão inicial é `day` para preservar o comportamento anterior.
- Logotipo interno: `signedCompanyLogo(db, companyId, company.logo_path)`, de `src/lib/company-logo.ts`.
- Agendamento público: `public_catalog` retorna `logo_path` somente quando publicado; `signedPublicLogo` gera a URL exata no servidor. Falhas de assinatura exibem as iniciais da empresa, sem interromper as reservas.
- Migração aplicada: `supabase/migrations/20261019022843_company_personalization.sql`, gerada pela CLI e sincronizada com o histórico remoto. Exige `storage.allow_only_operation(text)` disponível no projeto.

## Verificação

`tests/company-personalization.test.ts` cobre validação de preferências, formatos, limite de arquivo, MIME falso, URLs externas e caminhos de outra empresa. `scripts/test-personalization-db.ts` usa PostgreSQL descartável e fixtures do Storage para verificar RLS, publicação, bloqueio por assinatura, concorrência do ponteiro e limpeza. Esse teste não representa uma chamada ao serviço HTTP de Storage.

`scripts/test-personalization-live.ts` é opt-in (`TEST_PERSONALIZATION_LIVE=1` e `SEED_PASSWORD` no processo) e usa apenas uma conta `@example.invalid` cuja empresa esteja marcada `is_demo`. O padrão é `escritorio@example.invalid`; recusa substituir um logotipo preexistente. Envia uma imagem fictícia, verifica validação no servidor, isolamento, publicação, download assinado e despublicação, removendo exclusivamente o arquivo criado pelo teste ao finalizar. Não imprime credenciais ou URLs assinadas.

Referências oficiais consultadas: [controle de acesso do Storage](https://supabase.com/docs/guides/storage/security/access-control), [operações autorizadas nas políticas](https://supabase.com/docs/guides/storage/schema/helper-functions) e [URLs assinadas](https://supabase.com/docs/reference/javascript/storage-from-createsignedurl).
