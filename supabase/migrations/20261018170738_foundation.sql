-- Staging source. Promoted to a CLI-generated versioned migration before deployment.
create extension if not exists btree_gist;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
create table private.platform_admins(user_id uuid primary key references auth.users(id) on delete cascade);
alter table private.platform_admins enable row level security;

create table public.plans (
 id text primary key, name text not null, price_cents integer not null check(price_cents>=0), staff_limit integer not null check(staff_limit>0)
);
insert into public.plans values ('essencial','Essencial',6990,1),('profissional','Profissional',11990,3),('empresarial','Empresarial',19990,10);
create table public.companies (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 2 and 100),
 niche text not null check(niche in ('salao','pet-shop','clinica','escritorio','restaurante','fornecedores','logistica','academia')),
 plan_id text not null default 'essencial' references public.plans(id),
 status text not null default 'trialing' check(status in ('trialing','active','past_due','canceled','suspended')),
 trial_ends_at timestamptz not null default (now()+interval '7 days'), created_at timestamptz not null default now()
);
create table public.memberships (
 company_id uuid not null references public.companies(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check(role in ('OWNER','MANAGER','EMPLOYEE')), primary key(company_id,user_id)
);
create index memberships_user_idx on public.memberships(user_id,company_id);
create table public.customers (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 name text not null check(length(name) between 2 and 120), phone text not null default '' check(length(phone)<=30), unique(company_id,id)
);
create table public.services (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 name text not null check(length(name) between 2 and 120), duration_minutes integer not null check(duration_minutes between 5 and 480),
 price_cents integer not null check(price_cents between 0 and 10000000), unique(company_id,id)
);
create table public.professionals (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 user_id uuid, name text not null check(length(name) between 2 and 120),
 foreign key(company_id,user_id) references public.memberships(company_id,user_id), unique(company_id,id), unique(company_id,user_id)
);
create table public.appointments (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 customer_id uuid not null, service_id uuid not null, professional_id uuid not null,
 starts_at timestamptz not null, ends_at timestamptz not null,
 status text not null default 'scheduled' check(status in ('scheduled','completed','canceled')),
 check(ends_at>starts_at),
 foreign key(company_id,customer_id) references public.customers(company_id,id),
 foreign key(company_id,service_id) references public.services(company_id,id),
 foreign key(company_id,professional_id) references public.professionals(company_id,id),
 exclude using gist (professional_id with =, tstzrange(starts_at,ends_at,'[)') with &&) where(status<>'canceled')
);
create index appointments_company_time_idx on public.appointments(company_id,starts_at);
create index customers_company_idx on public.customers(company_id);
create index services_company_idx on public.services(company_id);
create index professionals_company_idx on public.professionals(company_id);

create function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from private.platform_admins where user_id=auth.uid());
$$;
create function public.is_super_admin() returns boolean language sql stable security invoker set search_path='' as $$ select private.is_admin(); $$;
create function private.member_role(c uuid) returns text language sql stable security definer set search_path='' as $$
 select role from public.memberships where company_id=c and user_id=auth.uid() and auth.uid() is not null;
$$;
create function private.writable(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.companies where id=c and (status='active' or (status='trialing' and trial_ends_at>now())));
$$;
create function private.assigned(c uuid,p uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.professionals where company_id=c and id=p and user_id=auth.uid());
$$;
create function private.customer_visible(c uuid,customer uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.appointments a join public.professionals p on p.company_id=a.company_id and p.id=a.professional_id where a.company_id=c and a.customer_id=customer and p.user_id=auth.uid());
$$;
create function private.create_company(company_name text,company_niche text) returns uuid language plpgsql security definer set search_path='' as $$
 declare result uuid; begin
 if auth.uid() is null then raise exception 'authentication required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if exists(select 1 from public.memberships where user_id=auth.uid() and role='OWNER') then raise exception 'existing owner: contact support'; end if;
 insert into public.companies(name,niche) values(company_name,company_niche) returning id into result;
 insert into public.memberships values(result,auth.uid(),'OWNER'); return result;
 end;
$$;
create function public.create_company(company_name text,company_niche text) returns uuid language sql security invoker set search_path='' as $$ select private.create_company(company_name,company_niche); $$;

create function private.check_professional_limit() returns trigger language plpgsql security definer set search_path='' as $$
 declare max_staff integer; begin
 if auth.uid() is null then raise exception 'authentication required'; end if;
 perform 1 from public.companies where id=new.company_id for update;
 select p.staff_limit into max_staff from public.companies c join public.plans p on p.id=c.plan_id where c.id=new.company_id;
 if (select count(*) from public.professionals where company_id=new.company_id and id<>new.id)>=max_staff then raise exception 'professional limit reached'; end if;
 return new; end;
$$;
create trigger professional_limit before insert or update on public.professionals for each row execute function private.check_professional_limit();

create function public.book_appointment(p_company uuid,p_customer uuid,p_service uuid,p_professional uuid,p_start timestamptz) returns uuid language plpgsql security invoker set search_path='' as $$
 declare duration integer; result uuid; finish timestamptz; local_start timestamp; local_end timestamp; begin
 if private.member_role(p_company) not in ('OWNER','MANAGER') or private.member_role(p_company) is null or not private.writable(p_company) then raise exception 'not authorized'; end if;
 select duration_minutes into duration from public.services where company_id=p_company and id=p_service;
 if duration is null or p_start<now() then raise exception 'invalid service or start'; end if;
 finish:=p_start+make_interval(mins=>duration);
 local_start:=p_start at time zone 'America/Sao_Paulo'; local_end:=finish at time zone 'America/Sao_Paulo';
 if extract(isodow from local_start)>5 or local_start::date<>local_end::date or local_start::time<'08:00' or local_end::time>'18:00' then raise exception 'outside business hours'; end if;
 insert into public.appointments(company_id,customer_id,service_id,professional_id,starts_at,ends_at) values(p_company,p_customer,p_service,p_professional,p_start,finish) returning id into result;
 return result; end;
$$;
-- Defense in depth: direct Data API inserts must enforce the same scheduling rules.
create function private.validate_appointment() returns trigger language plpgsql security invoker set search_path='' as $$
 declare duration integer; local_start timestamp; local_end timestamp; begin
 select duration_minutes into duration from public.services where company_id=new.company_id and id=new.service_id;
 if duration is null or new.ends_at<>new.starts_at+make_interval(mins=>duration) or new.starts_at<now() then raise exception 'invalid interval'; end if;
 local_start:=new.starts_at at time zone 'America/Sao_Paulo'; local_end:=new.ends_at at time zone 'America/Sao_Paulo';
 if extract(isodow from local_start)>5 or local_start::date<>local_end::date or local_start::time<'08:00' or local_end::time>'18:00' then raise exception 'outside business hours'; end if;
 return new; end;
$$;
create trigger validate_appointment before insert or update on public.appointments for each row execute function private.validate_appointment();

alter table public.plans enable row level security;
create policy plans_read on public.plans for select to authenticated using(true);
alter table public.companies enable row level security;
create policy companies_read on public.companies for select to authenticated using(private.member_role(id) is not null or private.is_admin());
alter table public.memberships enable row level security;
create policy memberships_read on public.memberships for select to authenticated using(user_id=auth.uid() or private.member_role(company_id)='OWNER');
alter table public.customers enable row level security;
create policy customers_read on public.customers for select to authenticated using(private.member_role(company_id) in ('OWNER','MANAGER') or (private.member_role(company_id)='EMPLOYEE' and private.customer_visible(company_id,id)));
alter table public.services enable row level security;
create policy services_read on public.services for select to authenticated using(private.member_role(company_id) is not null);
alter table public.professionals enable row level security;
create policy professionals_read on public.professionals for select to authenticated using(private.member_role(company_id) in ('OWNER','MANAGER') or user_id=auth.uid());
alter table public.appointments enable row level security;
create policy appointments_read on public.appointments for select to authenticated using(private.member_role(company_id) in ('OWNER','MANAGER') or (private.member_role(company_id)='EMPLOYEE' and private.assigned(company_id,professional_id)));
do $$ declare t text; begin foreach t in array array['customers','services','professionals','appointments'] loop
 execute format('create policy %I on public.%I for insert to authenticated with check (private.member_role(company_id) in (''OWNER'',''MANAGER'') and private.writable(company_id))',t||'_insert',t);
 end loop; end $$;
-- Mutations are intentionally limited to tested create flows in this first increment.
revoke all on all tables in schema public from anon,authenticated;
grant select on public.plans,public.companies,public.memberships,public.customers,public.services,public.professionals,public.appointments to authenticated;
grant insert on public.customers,public.services,public.professionals,public.appointments to authenticated;
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.is_admin(),private.member_role(uuid),private.writable(uuid),private.assigned(uuid,uuid),private.customer_visible(uuid,uuid),private.create_company(text,text) to authenticated;
revoke all on function public.is_super_admin(),public.create_company(text,text),public.book_appointment(uuid,uuid,uuid,uuid,timestamptz) from public,anon;
grant execute on function public.is_super_admin(),public.create_company(text,text),public.book_appointment(uuid,uuid,uuid,uuid,timestamptz) to authenticated;
