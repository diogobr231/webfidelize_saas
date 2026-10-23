# E-mails de acesso em produção

**Atualizado em 23/10/2026:** `webfidelize.com.br` ainda não foi comprado e não há SMTP próprio configurado. Uma confirmação real foi recebida na caixa autorizada do proprietário, com o remetente e template padrão do Supabase. Após corrigir o retorno que apontava para localhost, um reenvio pela aplicação chegou com o callback público correto e concluiu confirmação PKCE, configuração da empresa e acesso ao painel. Isso valida esse destinatário; não comprova entrega para todos os clientes. O SMTP padrão restringe destinatários e volume. Os templates da Web Fidelize continuam preparados para instalação após configurar SMTP próprio.

O fluxo de autenticação e os templates precisam ser publicados juntos. Pagamentos continuam fora desta etapa.

Preparação seguinte em 23/10: os três templates foram alinhados à paleta clara navy/ciano e receberam nove testes automatizados do HTML e dos links. O Brevo Free foi escolhido para o início sem mensalidade (até 300 e-mails por dia; inclui identificação do provedor). Ainda falta concluir a conta do provedor, verificar o remetente, habilitar o transporte e homologar o recebimento. Nenhuma credencial SMTP foi configurada e estes templates **ainda não estão ativos no Supabase**. Sem domínio próprio autenticado, o Brevo pode substituir temporariamente o endereço do remetente por um domínio de envio dele; não prometer remetente `@webfidelize.com.br` antes da compra e verificação. [Plano gratuito](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan), [remetentes e autenticação](https://help.brevo.com/hc/en-us/articles/14925263522578-Comply-with-Gmail-Yahoo-and-Microsoft-s-requirements-for-email-senders).

## O que será enviado

| Finalidade no Supabase | Assunto sugerido                       | Arquivo                                                                |
| ---------------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| Confirm sign up        | Confirme seu e-mail na Web Fidelize    | [`confirmation.html`](../supabase/templates/confirmation.html)         |
| Reset password         | Redefina sua senha da Web Fidelize     | [`recovery.html`](../supabase/templates/recovery.html)                 |
| Password changed       | Sua senha da Web Fidelize foi alterada | [`password-changed.html`](../supabase/templates/password-changed.html) |

Os HTMLs usam tabelas de apresentação, CSS inline, fontes do sistema e links descritivos, com a logo servida pela origem pública da aplicação e texto alternativo, sem scripts ou pixels de rastreamento. O aviso **Password changed** só deve ser habilitado junto ao recurso correspondente do Supabase, para ser disparado por uma alteração real de senha. Não enviar esse aviso apenas porque alguém pediu recuperação. [Templates e notificações de segurança](https://supabase.com/docs/guides/auth/auth-email-templates).

Convites de participação em empresas são outro fluxo: o sistema gera um link próprio de uso único, válido por 48 horas, vinculado ao e-mail e ao papel definidos pelo OWNER. O template Auth **Invite user** não substitui esse convite. Configurar SMTP no Supabase não configura automaticamente o transporte de convites da aplicação. Sem transporte configurado, a interface deve informar a geração do link, sem afirmar que houve envio. O aceite continua exigindo conta autenticada com o e-mail confirmado correspondente.

O transporte de convites já está implementado com Nodemailer, TLS obrigatório e timeout. Configure no ambiente **servidor** `TEAM_SMTP_HOST`, `TEAM_SMTP_PORT` (465 ou 587), `TEAM_SMTP_USER`, `TEAM_SMTP_PASSWORD` e `TEAM_SMTP_FROM` (somente o endereço autorizado, sem nome de exibição). Ele exige `APP_URL` HTTPS de produção. A opção **Enviar este convite também por e-mail** começa desmarcada; gerar o link sem marcá-la não envia mensagem. O destinatário vem da emissão autorizada no banco. Endereços sintéticos `.invalid`, `.test` e `.example` não são enviados. Falhas ambíguas não geram repetição automática, e o link continua disponível para compartilhar. Não há fila, webhook de entrega ou rastreamento de abertura nesta etapa.

Configure também `AUTH_FLOW_SECRET`, uma chave privada exclusiva de pelo menos 32 bytes aleatórios, em base64url. Ela assina uma prova de recuperação com duração de 15 minutos, vinculada ao usuário e à sessão verificados no Supabase. Exemplo de geração local, sem imprimir o valor: use um gerenciador de segredos ou `crypto.randomBytes(32).toString("base64url")` e grave diretamente no ambiente privado. Não reutilize o segredo de reservas, não coloque no frontend e não use os valores sintéticos dos testes. A chave já foi criada no `.env.local` ignorado; a configuração da hospedagem continua pendente. A ausência da chave impede consumir um link de recuperação no novo fluxo.

## 1. Domínio e endereço da aplicação

Confirme a compra e o controle DNS do domínio antes de usá-lo como origem de produção ou remetente. Não publique links operacionais apontando para `webfidelize.com.br` enquanto ele não estiver sob controle do proprietário. Se a homologação usar outro domínio, ele também deve pertencer ao projeto e oferecer HTTPS válido.

Defina a origem pública da aplicação e um subdomínio separado para os e-mails de acesso. Exemplos de configuração futura, ainda não ativos: aplicação em `https://webfidelize.com.br`, domínio de envio `auth.webfidelize.com.br` e remetente `Web Fidelize <acesso@auth.webfidelize.com.br>`. Separe autenticação de campanhas promocionais para preservar a reputação dos envios de acesso. [Recomendações de SMTP do Supabase](https://supabase.com/docs/guides/auth/auth-smtp#additional-best-practices).

## 2. DNS e remetente verificado

No provedor escolhido, adicione o domínio de envio e copie exatamente os registros de verificação, DKIM, SPF e Return-Path solicitados. Confira também DMARC e seu alinhamento com o remetente. Os nomes e valores dependem da conta: não copie chaves DNS de exemplos nem substitua registros do serviço de e-mail já existente. Quando houver CNAME de verificação, mantenha-o sem proxy. Aguarde o estado de domínio verificado antes de prosseguir. [Exemplo oficial de configuração DNS no Resend](https://resend.com/docs/add-a-domain).

O nome do remetente deve ser **Web Fidelize**. O endereço precisa estar autorizado no domínio verificado. Se houver um endereço de resposta, confirme que ele existe e é acompanhado; o serviço de envio não implica que uma caixa postal foi criada.

## 3. Provedor e SMTP

O SMTP padrão do Supabase não atende ao lançamento: restringe destinatários aos membros da organização e tem limites reduzidos. Projetos Free novos desde 03/06/2026 precisam de SMTP próprio para personalizar os templates de autenticação. [Limitações do SMTP padrão](https://supabase.com/docs/guides/auth/auth-smtp), [mudança na personalização do Free](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier).

Para um piloto de baixo volume, compare o plano gratuito do Resend com o Brevo ou com um SMTP transacional já contratado. Na consulta desta etapa, o Resend oferece 3.000 e-mails/mês, até 100/dia; o Brevo Free oferece 300/dia, inclui marca Brevo e pode manter envios excedentes em fila. Verifique os limites atuais e a disponibilidade da conta antes de escolher. Uma fila pode fazer um link chegar depois de expirar. [Resend](https://resend.com/pricing), [limites do Brevo](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan).

No Supabase, habilite **Custom SMTP** e preencha host, porta com TLS, usuário, senha SMTP, endereço e nome do remetente. Use credencial exclusiva para autenticação. No Resend, o usuário é `resend`, o host é `smtp.resend.com` e a senha é uma API key; as portas `465` e `587` usam, respectivamente, TLS implícito e STARTTLS. No Brevo, a senha é uma **SMTP key**, diferente da API key e da senha da conta. [SMTP Resend](https://resend.com/docs/send-with-smtp), [SMTP Brevo](https://help.brevo.com/hc/en-us/articles/7924908994450-Send-transactional-emails-using-Brevo-SMTP).

Restrinja a credencial ao envio e, quando suportado, ao domínio selecionado. No Resend, isso corresponde a **Sending access** com restrição de domínio. Guarde o segredo no painel seguro do Supabase; eventual credencial de envio de convites pertence somente ao ambiente servidor da aplicação, conforme `.env.example`. Não colocar segredos em `NEXT_PUBLIC_*`, Git, logs ou capturas de tela. [Escopo das chaves Resend](https://resend.com/docs/create-an-api-key).

Desative rastreamento de abertura e de cliques para os e-mails de acesso. Ajuste as cotas de Auth e do provedor de forma compatível e mantenha proteção contra abuso. Verifique rejeições e destinatários suprimidos antes de repetir um envio; “aceito pelo SMTP” ainda não significa “entregue à caixa de entrada”. [Limites do Auth](https://supabase.com/docs/guides/auth/rate-limits).

## 4. URLs, confirmação e expiração

Configure `APP_URL` e o **Site URL** do Supabase com a mesma origem HTTPS, sem caminho, query, fragmento ou barra final. A configuração de produção não deve apontar para localhost. O Site URL é uma configuração administrativa confiável; o template o usa como destino principal dos links.

Configuração remota conferida em 23/10: Site URL `https://webfidelize-saas.vercel.app`; Redirect URLs `https://webfidelize-saas.vercel.app/auth/callback` e `https://webfidelize-saas.vercel.app/auth/callback?next=*`. A origem e a rota ficam restritas à aplicação, com variação apenas para os destinos codificados pelo servidor. O link efetivamente recebido foi usado sem reescrever seu token ou endereço. E-mails enviados antes da correção podem conter o retorno antigo; solicite novo link pela tela de entrada.

O aplicativo monta o callback com `/auth/callback?next=...`. Os destinos de `next` aceitos são `/painel` ou `/convite/` seguido pelo token próprio de 64 caracteres hexadecimais. Recuperação usa `/nova-senha`. Adicione os callbacks necessários à lista **Redirect URLs**, incluindo a query codificada conforme gerada pela aplicação. Para o destino variável do convite, use apenas o padrão mínimo para a rota e a origem necessárias; evite liberar todo o domínio com `/**`. O backend continua validando o destino independentemente dessa configuração. [Configuração de redirects](https://supabase.com/docs/guides/auth/redirect-urls).

Mantenha a confirmação de e-mail habilitada. Confira o valor efetivo de **Email OTP expiration** antes de mencionar prazos nos e-mails. Essa configuração controla também os links de confirmação e recuperação do Supabase; ela é independente das 48 horas dos convites de empresa. Os templates fornecidos deliberadamente não fixam um prazo de Auth. [Expiração dos links](https://supabase.com/docs/guides/auth/auth-email-passwordless#enabling-email-otp).

## 5. Instalar os templates e conferir o contrato

Em **Authentication → Email Templates**, copie o conteúdo completo de cada arquivo para sua finalidade e ajuste o assunto conforme a tabela. Não troque o template Auth **Invite user** pelos convites de participação. Habilite a notificação **Password changed** somente após instalar seu conteúdo e conferir que o projeto a suporta.

Confirmação e recuperação usam, respectivamente:

```text
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email&amp;redirect_to={{ .RedirectTo | urlquery }}
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery&amp;redirect_to={{ .RedirectTo | urlquery }}
```

A base fixa mantém o link no Site URL. `urlquery` codifica o callback inteiro como um único parâmetro, preservando o destino de convite sem misturar seus parâmetros com os de confirmação. O parser da aplicação só aproveita `redirect_to` se for uma URL da mesma origem de `APP_URL` e da rota exata `/auth/callback`. Se estiver vazio, for apenas o Site URL ou tiver um destino inesperado, a confirmação segue para `/painel`; recuperação sempre segue para `/nova-senha`. Isso também oferece fallback para solicitações feitas fora do aplicativo. [Funções de templates Go](https://pkg.go.dev/text/template#hdr-Functions).

Abrir o link faz um **GET que não consome o token**. O usuário confirma a ação em um formulário; o servidor chama `verifyOtp` no POST. Essa separação evita que uma simples prévia de link de e-mail consuma a credencial. Links, hashes e cookies não devem aparecer em logs da aplicação ou em ferramentas de analytics. Não acrescente rastreamento a essas páginas. [Prefetch e rastreamento em e-mails](https://supabase.com/docs/guides/auth/auth-email-templates#limitations).

O hash de autenticação do Supabase não é o token de convite da empresa. Não recorte, converta ou acrescente prefixos a `{{ .TokenHash }}` no template. A notificação de senha alterada não contém token; seu botão abre apenas `{{ .SiteURL }}/recuperar`.

## 6. Homologar a entrega e os fluxos

Use caixas de teste reais autorizadas, sem clientes reais, depois de configurar o domínio e o SMTP. Endereços `@example.invalid` são fixtures e não comprovam recebimento de e-mail. Não use tokens de links reais em commits, relatórios ou capturas.

1. Conferir o preview dos três templates, links completos e assuntos. Validar leitura em celular, Gmail e Outlook, inclusive com imagens externas desabilitadas.
2. Criar uma conta de teste pela aplicação, receber a confirmação, abrir o link, confirmar pelo botão e entrar. Repetir a abertura antes do POST para verificar que o GET não consumiu o token.
3. Conferir nos cabeçalhos recebidos os resultados SPF, DKIM e DMARC, remetente e ausência de reescrita de links. Registrar o resultado de entrega e verificar spam/rejeição sem expor dados sensíveis.
4. Solicitar recuperação pela aplicação, receber o e-mail, confirmar e definir a nova senha. Verificar login com a nova senha, rejeição da antiga e recebimento do aviso de alteração quando habilitado.
5. Testar link expirado, reaproveitado, adulterado e aberto em outro navegador/dispositivo. Verificar que erros explicam como solicitar outro link e que redirecionamentos externos são recusados.
6. Testar confirmação iniciada fora do app com `redirect_to` ausente ou igual ao Site URL. O resultado esperado é o fallback seguro, sem erro de montagem do link.
7. Testar convite para conta existente e conta nova: preservar o retorno após cadastro/login, exigir o e-mail confirmado correto e confirmar o aceite. Validar cancelamento, reemissão, expiração e rejeição do link anterior; nenhuma mensagem deve anunciar entrega apenas porque um link foi gerado.
8. Conferir limites e respostas neutras de recuperação para evitar revelar se um endereço possui conta. Registrar cada resultado antes de liberar cadastro público.

## Registro da validação

Em 21/10/2026, passaram **73 testes unitários**, **154 grupos de banco PGlite**, TypeScript e build. A suíte `pnpm test:auth:isolated` passou em **8 grupos HTTP**: cadastro e erros de envio/limite, reenvio, GET sem consumo e POST de confirmação, token usado, retorno ao convite, recuperação, troca de senha e encerramento da sessão, prova ausente/adulterada/expirada/de outra sessão e compatibilidade PKCE. Ela inicia um Auth sintético com JWT/JWKS locais e bloqueia requisições externas. Isso valida a aplicação e seu contrato; **não é homologação do serviço real de e-mail**.

A suíte `pnpm test:team` passou em **9 grupos** com contas DEMO confirmadas no Supabase real, sem envio de e-mail: geração, aceite, vínculo, restrições, revogação e preservação do estado. A migração `20261021023033_team_invitation_lifecycle.sql` foi aplicada no projeto Web Fidelize e conferida no histórico e nas permissões. O ledger privado de emissões tem RLS sem políticas e acesso revogado aos clientes intencionalmente; apenas funções autorizadas o utilizam. O aviso preexistente de [proteção contra senhas vazadas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) ainda requer avaliação na configuração do Supabase.

O envio de convites passou por testes de composição MIME real do Nodemailer, escaping de HTML/assunto, bloqueio de destinos fictícios, configuração TLS e tratamento de aceite/recusa/falha ambígua com transporte controlado. Nenhuma conexão SMTP externa foi aberta, e nenhuma senha de conta real foi alterada.

| Verificação                                                          | Situação nesta entrega                                                                                         |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Domínio comprado e controle DNS                                      | **Pendente externo** — `webfidelize.com.br` ainda não foi comprado.                                            |
| Provedor SMTP e remetente verificado                                 | **Pendente externo** — provedor não configurado.                                                               |
| Templates instalados no projeto remoto                               | **Pendente** — arquivos locais preparados.                                                                     |
| Preview do Supabase e compatibilidade em clientes de e-mail          | **Pendente** — depende da instalação e de envio autorizado.                                                    |
| Confirmação, recuperação, aviso e convites recebidos em caixas reais | **Pendente** — não há evidência de entrega nesta etapa.                                                        |
| Revisão visual das novas telas em navegador/celular                  | **Pendente nesta rodada** — acesso ao navegador local recusado. A evidência HTTP não substitui revisão visual. |

Validação local desta entrega: os três arquivos foram formatados e passaram em nove casos estruturais de links, com valores sintéticos para `RedirectTo` vazio, igual à origem e contendo um convite. Foram conferidos idioma, variáveis permitidas, ausência de recursos externos e referências locais da documentação. Esse teste substitui as variáveis para inspecionar as URLs; ele não executa o motor Go do Supabase nem um cliente de e-mail.

Testes locais do HTML e do código não substituem essas verificações. Atualize este registro com data e resultado quando cada etapa realmente for executada.
