create table public.invitations (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 email text not null check(length(email)<=254), role text not null check(role in ('MANAGER','EMPLOYEE')),
 token_hash text not null unique, expires_at timestamptz not null default now()+interval '48 hours',
 accepted_at timestamptz, created_at timestamptz not null default now()
);
create index invitations_company_idx on public.invitations(company_id);
alter table public.invitations enable row level security;
create policy invitations_owner_read on public.invitations for select to authenticated using(private.member_role(company_id)='OWNER');
revoke all on public.invitations from anon,authenticated;
grant select(id,company_id,email,role,expires_at,accepted_at,created_at) on public.invitations to authenticated;

create function private.invite_member(c uuid,e text,r text) returns text language plpgsql security definer set search_path='' as $$
 declare token text; begin
 if auth.uid() is null or private.member_role(c) is distinct from 'OWNER' or not private.writable(c) then raise exception 'not authorized'; end if;
 if r not in ('MANAGER','EMPLOYEE') or length(e)>254 or e not like '%@%.%' then raise exception 'invalid invitation'; end if;
 if (select count(*) from public.invitations where company_id=c and created_at>now()-interval '1 day')>=25 then raise exception 'daily invitation limit'; end if;
 token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into public.invitations(company_id,email,role,token_hash) values(c,lower(trim(e)),r,encode(sha256(convert_to(token,'UTF8')),'hex'));
 return token; end;
$$;
create function public.invite_member(c uuid,e text,r text) returns text language sql security invoker set search_path='' as $$ select private.invite_member(c,e,r); $$;
create function private.accept_invitation(token text) returns uuid language plpgsql security definer set search_path='' as $$
 declare inv public.invitations; user_email text; max_staff integer; begin
 if auth.uid() is null or length(token)<>64 then raise exception 'not authorized'; end if;
 select lower(email) into user_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
 select * into inv from public.invitations where token_hash=encode(sha256(convert_to(token,'UTF8')),'hex') and accepted_at is null and expires_at>now() for update;
 if inv.id is null or user_email is distinct from inv.email then raise exception 'invalid invitation'; end if;
 perform 1 from public.companies where id=inv.company_id for update;
 if not private.writable(inv.company_id) then raise exception 'subscription blocked'; end if;
 select p.staff_limit into max_staff from public.companies c join public.plans p on p.id=c.plan_id where c.id=inv.company_id;
 if exists(select 1 from public.memberships where company_id=inv.company_id and user_id=auth.uid()) then raise exception 'already a member'; end if;
 if (select count(*) from public.memberships where company_id=inv.company_id and role<>'OWNER')>=max_staff then raise exception 'member limit'; end if;
 insert into public.memberships values(inv.company_id,auth.uid(),inv.role);
 update public.invitations set accepted_at=now() where id=inv.id;
 return inv.company_id; end;
$$;
create function public.accept_invitation(token text) returns uuid language sql security invoker set search_path='' as $$ select private.accept_invitation(token); $$;

create function private.admin_company(c uuid,new_plan text,new_status text,new_trial timestamptz) returns void language plpgsql security definer set search_path='' as $$
 declare max_staff integer; begin
 if auth.uid() is null or not private.is_admin() then raise exception 'not authorized'; end if;
 perform 1 from public.companies where id=c for update;
 select staff_limit into max_staff from public.plans where id=new_plan;
 if max_staff is null or max_staff<(select count(*) from public.professionals where company_id=c) or max_staff<(select count(*) from public.memberships where company_id=c and role<>'OWNER') then raise exception 'plan limit'; end if;
 -- Active status is reserved for reconciled payment webhooks, never a manual form.
 if new_status not in ('trialing','suspended','canceled') then raise exception 'invalid manual status'; end if;
 if new_trial>now()+interval '30 days' then raise exception 'trial extension maximum 30 days'; end if;
 update public.companies set plan_id=new_plan,status=new_status,trial_ends_at=new_trial where id=c;
 end;
$$;
create function public.admin_company(c uuid,new_plan text,new_status text,new_trial timestamptz) returns void language sql security invoker set search_path='' as $$ select private.admin_company(c,new_plan,new_status,new_trial); $$;
revoke all on function private.invite_member(uuid,text,text),private.accept_invitation(text),private.admin_company(uuid,text,text,timestamptz) from public,anon;
revoke all on function public.invite_member(uuid,text,text),public.accept_invitation(text),public.admin_company(uuid,text,text,timestamptz) from public,anon;
grant execute on function private.invite_member(uuid,text,text),private.accept_invitation(text),private.admin_company(uuid,text,text,timestamptz),public.invite_member(uuid,text,text),public.accept_invitation(text),public.admin_company(uuid,text,text,timestamptz) to authenticated;

