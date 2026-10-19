-- Help content is shared editorial material. Tickets always belong to one company.
create table public.help_articles (
 id uuid primary key default gen_random_uuid(),
 title text not null check(char_length(trim(title)) between 5 and 140),
 module text not null check(module in ('primeiros-passos','agenda','clientes','servicos','equipe','assinatura','seguranca')),
 kind text not null check(kind in ('faq','tutorial')),
 body text not null check(char_length(trim(body)) between 20 and 12000),
 published boolean not null default false,
 sort_order integer not null default 0 check(sort_order between 0 and 1000),
 updated_at timestamptz not null default now()
);
create index help_articles_module_idx on public.help_articles(module,published,sort_order);
alter table public.help_articles enable row level security;
create policy help_articles_read on public.help_articles for select to authenticated using(published or private.is_admin());
create policy help_articles_insert on public.help_articles for insert to authenticated with check(private.is_admin());
create policy help_articles_update on public.help_articles for update to authenticated using(private.is_admin()) with check(private.is_admin());
revoke all on public.help_articles from public,anon,authenticated;
grant select,insert,update on public.help_articles to authenticated;

create table public.support_tickets (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 requester_id uuid not null references auth.users(id),
 request_key uuid not null,
 module text not null check(module in ('primeiros-passos','agenda','clientes','servicos','equipe','assinatura','seguranca')),
 subject text not null check(char_length(trim(subject)) between 5 and 140),
 message text not null check(char_length(trim(message)) between 20 and 4000),
 status text not null default 'open' check(status in ('open','in_progress','resolved')),
 response text not null default '' check(char_length(response)<=4000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(company_id,requester_id,request_key)
);
create index support_tickets_company_idx on public.support_tickets(company_id,created_at desc);
create index support_tickets_requester_idx on public.support_tickets(requester_id,created_at desc);
create index support_tickets_status_idx on public.support_tickets(status,updated_at desc);
alter table public.support_tickets enable row level security;
create policy support_tickets_read on public.support_tickets for select to authenticated using(
 private.is_admin() or private.member_role(company_id) in ('OWNER','MANAGER') or
 (private.member_role(company_id)='EMPLOYEE' and requester_id=(select auth.uid()))
);
revoke all on public.support_tickets from public,anon,authenticated;
grant select on public.support_tickets to authenticated;

-- Only this operation may create tickets. It validates membership independently
-- of subscription state and serializes per-user rate limits and retries.
create function private.open_support_ticket(p_company uuid,p_key uuid,p_module text,p_subject text,p_message text)
 returns uuid language plpgsql security definer set search_path='' as $$
 declare existing public.support_tickets; result uuid;
 begin
 if auth.uid() is null or private.member_role(p_company) is null then raise exception 'not authorized'; end if;
 if p_key is null or p_module is null or p_module not in ('primeiros-passos','agenda','clientes','servicos','equipe','assinatura','seguranca')
 or p_subject is null or char_length(trim(p_subject)) not between 5 and 140
 or p_message is null or char_length(trim(p_message)) not between 20 and 4000 then raise exception 'invalid ticket'; end if;
 perform pg_advisory_xact_lock(hashtextextended('support:'||auth.uid()::text,0));
 select * into existing from public.support_tickets where company_id=p_company and requester_id=auth.uid() and request_key=p_key;
 if existing.id is not null then
   if existing.module<>p_module or existing.subject<>trim(p_subject) or existing.message<>trim(p_message) then raise exception 'request key conflict'; end if;
   return existing.id;
 end if;
 if (select count(*) from public.support_tickets where requester_id=auth.uid() and created_at>now()-interval '1 hour')>=5 then raise exception 'support rate limit'; end if;
 insert into public.support_tickets(company_id,requester_id,request_key,module,subject,message)
 values(p_company,auth.uid(),p_key,p_module,trim(p_subject),trim(p_message)) returning id into result;
 return result;
 end;
$$;
create function public.open_support_ticket(p_company uuid,p_key uuid,p_module text,p_subject text,p_message text)
 returns uuid language sql security invoker set search_path='' as $$ select private.open_support_ticket(p_company,p_key,p_module,p_subject,p_message); $$;

create function private.respond_support_ticket(p_ticket uuid,p_status text,p_response text)
 returns void language plpgsql security definer set search_path='' as $$
 begin
 if auth.uid() is null or not private.is_admin() then raise exception 'not authorized'; end if;
 if p_status is null or p_status not in ('open','in_progress','resolved') or p_response is null or char_length(trim(p_response))>4000
 or (p_status='resolved' and char_length(trim(p_response))<5) then raise exception 'invalid response'; end if;
 update public.support_tickets set status=p_status,response=trim(p_response),updated_at=now() where id=p_ticket;
 if not found then raise exception 'ticket not found'; end if;
 end;
$$;
create function public.respond_support_ticket(p_ticket uuid,p_status text,p_response text)
 returns void language sql security invoker set search_path='' as $$ select private.respond_support_ticket(p_ticket,p_status,p_response); $$;
revoke all on function private.open_support_ticket(uuid,uuid,text,text,text),public.open_support_ticket(uuid,uuid,text,text,text),private.respond_support_ticket(uuid,text,text),public.respond_support_ticket(uuid,text,text) from public,anon,authenticated;
grant execute on function private.open_support_ticket(uuid,uuid,text,text,text),public.open_support_ticket(uuid,uuid,text,text,text),private.respond_support_ticket(uuid,text,text),public.respond_support_ticket(uuid,text,text) to authenticated;

-- Product guidance, not customer data. Plain text is rendered escaped by React.
insert into public.help_articles(title,module,kind,body,published,sort_order) values
('Como configurar minha empresa pela primeira vez?','primeiros-passos','tutorial',E'1. Abra Primeiros passos no menu do seu espaço.\n2. Confira o nome e o segmento da empresa.\n3. Cadastre ao menos um serviço com duração e preço.\n4. Adicione quem realiza os atendimentos.\n5. Revise a disponibilidade antes de compartilhar seu link.\nVocê pode salvar cada etapa e continuar a configuração depois.',true,10),
('Posso continuar a configuração depois?','primeiros-passos','faq','Sim. Use Salvar e continuar depois. As informações confirmadas permanecem na sua empresa. Retome pelo menu Primeiros passos. O andamento considera os cadastros já salvos.',true,20),
('Como criar e acompanhar um agendamento?','agenda','tutorial',E'1. Cadastre o cliente, o serviço e o profissional.\n2. Abra Agenda e escolha Novo agendamento.\n3. Informe o cliente, o serviço, o profissional, a data e o horário.\n4. Confira as informações e salve.\nO sistema verifica a disponibilidade e evita horários sobrepostos. Na agenda, abra um atendimento para consultar as ações disponíveis para seu perfil.',true,10),
('Por que um horário não aparece para o cliente?','agenda','faq','Confira se o profissional tem disponibilidade cadastrada naquele dia, se o horário comporta toda a duração do serviço e se já existe outro atendimento. A página pública também depende do acesso válido da empresa. A disponibilidade usa o fuso de São Paulo.',true,20),
('Como compartilhar minha página de agendamento?','agenda','tutorial',E'1. Conclua o cadastro de serviços e profissionais.\n2. Configure os horários em Disponibilidade.\n3. No painel, copie o link de agendamento da empresa.\n4. Abra o link e confira as informações antes de enviá-lo aos seus clientes.\nO cliente escolhe o serviço, o profissional e um horário disponível para solicitar o agendamento.',true,30),
('Como cadastrar um cliente?','clientes','tutorial','Abra Clientes, informe o nome e, se disponível, o telefone. Salve o cadastro e use esse cliente ao criar um agendamento. Proprietários e gerentes têm acesso de gestão; colaboradores acessam somente informações autorizadas pelo seu perfil.',true,10),
('Como definir a duração e o preço dos serviços?','servicos','faq','No cadastro de serviços, preencha o nome, a duração em minutos e o preço em reais. A duração é usada para calcular os horários de atendimento e prevenir conflitos. O preço cadastrado não é uma confirmação de pagamento recebido.',true,10),
('Profissional e colaborador com login são a mesma coisa?','equipe','faq','O profissional identifica quem atende na agenda. O convite de acesso permite que uma pessoa entre na plataforma com seu próprio login. O proprietário envia convites no gerenciamento da equipe e escolhe o perfil permitido. Os limites do plano são verificados pelo sistema.',true,10),
('Como convidar alguém para acessar minha empresa?','equipe','tutorial',E'1. Entre com a conta do proprietário.\n2. Abra Acessos da equipe e informe o e-mail da pessoa.\n3. Escolha o perfil disponível e gere o convite.\n4. Compartilhe o link de convite com a pessoa correta.\nA pessoa deve usar o e-mail convidado e aceitar o convite antes da expiração. Nunca compartilhe sua senha.',true,20),
('Como funciona o período de teste?','assinatura','faq','O período de teste é controlado pelo servidor. Consulte no seu painel a data de expiração e o estado atual da empresa. O teste não reinicia ao entrar novamente ou retomar a configuração. Uma assinatura paga só fica ativa após confirmação do pagamento pelo backend.',true,10),
('Ainda posso pedir ajuda se meu acesso estiver bloqueado?','assinatura','faq','Sim. A Central de ajuda e a abertura de solicitações continuam disponíveis para membros da empresa mesmo quando o trial acabou ou a assinatura está bloqueada. Use também o botão de WhatsApp para falar com a Web Fidelize.',true,20),
('Como proteger as informações da minha empresa?','seguranca','faq','Cada pessoa deve usar sua própria conta. Convide somente os colaboradores autorizados e conceda apenas o perfil necessário. Os dados operacionais são isolados por empresa. Nas solicitações de suporte, não informe senhas, chaves privadas, números completos de cartão ou informações sensíveis de clientes.',true,10);
