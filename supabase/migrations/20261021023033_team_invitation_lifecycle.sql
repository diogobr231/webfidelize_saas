-- Team invitations are separate from Auth account creation and SMTP delivery.
-- Store only the token hash; a new issue rotates it and returns the token once.
alter table public.invitations
  add column canceled_at timestamptz,
  add column last_issued_at timestamptz;
update public.invitations set last_issued_at = created_at;
alter table public.invitations alter column last_issued_at set not null;
alter table public.invitations alter column last_issued_at set default now();
grant select(canceled_at, last_issued_at) on public.invitations to authenticated;
create index invitations_company_created_idx on public.invitations(company_id, created_at desc, id desc);
create index invitations_company_email_idx on public.invitations(company_id, email);

create table private.team_invitation_issues (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  invitation_id uuid not null references public.invitations(id),
  issued_at timestamptz not null default now()
);
create index team_invitation_issues_company_time_idx on private.team_invitation_issues(company_id, issued_at);
create index team_invitation_issues_invitation_idx on private.team_invitation_issues(invitation_id);
alter table private.team_invitation_issues enable row level security;
revoke all on private.team_invitation_issues from public, anon, authenticated;
-- Existing invitations still count towards the same rolling 24-hour allowance.
insert into private.team_invitation_issues(company_id, invitation_id, issued_at)
  select company_id, id, created_at from public.invitations;

create function private.lock_invitation_owner(p_company uuid, p_write boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.member_role(p_company) is distinct from 'OWNER' then raise exception 'not authorized'; end if;
  perform 1 from public.companies where id = p_company for update;
  if not found or private.member_role(p_company) is distinct from 'OWNER' then raise exception 'not authorized'; end if;
  if p_write and not private.writable(p_company) then raise exception 'subscription blocked'; end if;
end;
$$;
revoke all on function private.lock_invitation_owner(uuid, boolean) from public, anon, authenticated;

-- Internal common path: public callers cannot choose email/role during reissue.
create function private.issue_team_invitation(p_company uuid, p_invitation uuid, p_email text, p_role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare inv public.invitations%rowtype; destination text; assigned_role text; raw_token text; issue uuid; max_staff integer; company_name text;
begin
  perform private.lock_invitation_owner(p_company, true);
  if p_invitation is null then
    destination := lower(trim(p_email)); assigned_role := p_role;
    if destination is null or length(destination) not between 3 and 254
      or destination !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      or assigned_role is null or assigned_role not in ('MANAGER', 'EMPLOYEE') then raise exception 'invalid invitation'; end if;
  else
    if p_email is not null or p_role is not null then raise exception 'invalid invitation'; end if;
    select * into inv from public.invitations where company_id = p_company and id = p_invitation for update;
    if not found or inv.accepted_at is not null or inv.canceled_at is not null then raise exception 'invitation unavailable'; end if;
    destination := inv.email; assigned_role := inv.role;
  end if;
  if exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id
      where m.company_id = p_company and lower(u.email) = destination) then raise exception 'already a member'; end if;
  select p.staff_limit, c.name into max_staff, company_name from public.companies c join public.plans p on p.id = c.plan_id where c.id = p_company;
  if max_staff is null or (select count(*) from public.memberships where company_id = p_company and role <> 'OWNER') >= max_staff then raise exception 'member limit'; end if;
  if exists (select 1 from public.invitations i where i.company_id = p_company and i.email = destination
      and (p_invitation is null or i.id <> p_invitation) and i.accepted_at is null and i.canceled_at is null and i.expires_at > now()) then raise exception 'pending invitation exists'; end if;
  -- Per-address cooldown also prevents cancel+create from bypassing reissue pacing.
  if exists (select 1 from public.invitations i where i.company_id = p_company and i.email = destination and i.last_issued_at > now() - interval '60 seconds') then raise exception 'invitation cooldown'; end if;
  if (select count(*) from private.team_invitation_issues where company_id = p_company and issued_at > now() - interval '1 day') >= 25 then raise exception 'daily invitation limit'; end if;
  raw_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  if p_invitation is null then
    insert into public.invitations(company_id, email, role, token_hash)
      values(p_company, destination, assigned_role, encode(sha256(convert_to(raw_token, 'UTF8')), 'hex')) returning * into inv;
  else
    update public.invitations set token_hash = encode(sha256(convert_to(raw_token, 'UTF8')), 'hex'),
      last_issued_at = now(), expires_at = now() + interval '48 hours'
      where company_id = p_company and id = p_invitation returning * into inv;
  end if;
  insert into private.team_invitation_issues(company_id, invitation_id) values(p_company, inv.id) returning id into issue;
  return jsonb_build_object('id', inv.id, 'issue_id', issue, 'token', raw_token, 'email', inv.email,
    'role', inv.role, 'company_name', company_name, 'expires_at', inv.expires_at);
end;
$$;
revoke all on function private.issue_team_invitation(uuid, uuid, text, text) from public, anon, authenticated;

create function private.create_team_invitation(p_company uuid, p_email text, p_role text)
returns jsonb language sql security definer set search_path = '' as $$
  select private.issue_team_invitation(p_company, null, p_email, p_role);
$$;
create function public.create_team_invitation(p_company uuid, p_email text, p_role text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.create_team_invitation(p_company, p_email, p_role);
$$;
create function private.resend_team_invitation(p_company uuid, p_invitation uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_invitation is null then raise exception 'invitation unavailable'; end if;
  return private.issue_team_invitation(p_company, p_invitation, null, null);
end;
$$;
create function public.resend_team_invitation(p_company uuid, p_invitation uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.resend_team_invitation(p_company, p_invitation);
$$;
-- Compatibility wrapper cannot bypass cooldown, duplicates, capacity or quota.
create or replace function private.invite_member(c uuid, e text, r text)
returns text language sql security definer set search_path = '' as $$
  select private.issue_team_invitation(c, null, e, r)->>'token';
$$;

create function private.cancel_team_invitation(p_company uuid, p_invitation uuid, p_confirmed boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare inv public.invitations%rowtype;
begin
  -- Removing a pending grant is a security operation, including blocked companies.
  perform private.lock_invitation_owner(p_company, false);
  if p_confirmed is distinct from true then raise exception 'confirmation required'; end if;
  select * into inv from public.invitations where company_id = p_company and id = p_invitation for update;
  if not found or inv.accepted_at is not null then raise exception 'invitation unavailable'; end if;
  if inv.canceled_at is not null then return; end if;
  update public.invitations set canceled_at = now(), expires_at = least(expires_at, now()) where company_id = p_company and id = p_invitation;
end;
$$;
create function public.cancel_team_invitation(p_company uuid, p_invitation uuid, p_confirmed boolean)
returns void language sql security invoker set search_path = '' as $$
  select private.cancel_team_invitation(p_company, p_invitation, p_confirmed);
$$;
revoke all on function private.create_team_invitation(uuid,text,text), public.create_team_invitation(uuid,text,text),
  private.resend_team_invitation(uuid,uuid), public.resend_team_invitation(uuid,uuid),
  private.cancel_team_invitation(uuid,uuid,boolean), public.cancel_team_invitation(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function private.create_team_invitation(uuid,text,text), public.create_team_invitation(uuid,text,text),
  private.resend_team_invitation(uuid,uuid), public.resend_team_invitation(uuid,uuid),
  private.cancel_team_invitation(uuid,uuid,boolean), public.cancel_team_invitation(uuid,uuid,boolean) to authenticated;

create or replace function private.accept_invitation(token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare inv public.invitations%rowtype; target_company uuid; user_email text; max_staff integer;
begin
  if auth.uid() is null or token is null or token !~ '^[a-f0-9]{64}$' then raise exception 'not authorized'; end if;
  -- Find the lock scope without locking the invitation first. The authoritative
  -- reread below detects a cancellation, rotation or acceptance while waiting.
  select company_id into target_company from public.invitations where token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex');
  if target_company is null then raise exception 'invalid invitation'; end if;
  perform 1 from public.companies where id = target_company for update;
  select * into inv from public.invitations where company_id = target_company
    and token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex')
    and accepted_at is null and canceled_at is null and expires_at > now() for update;
  select lower(email) into user_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if inv.id is null or user_email is null or user_email is distinct from inv.email then raise exception 'invalid invitation'; end if;
  if not private.writable(target_company) then raise exception 'subscription blocked'; end if;
  select p.staff_limit into max_staff from public.companies c join public.plans p on p.id = c.plan_id where c.id = target_company;
  if exists (select 1 from public.memberships where company_id = target_company and user_id = auth.uid()) then raise exception 'already a member'; end if;
  if max_staff is null or (select count(*) from public.memberships where company_id = target_company and role <> 'OWNER') >= max_staff then raise exception 'member limit'; end if;
  insert into public.memberships values(target_company, auth.uid(), inv.role);
  update public.invitations set accepted_at = now() where id = inv.id;
  return target_company;
end;
$$;

create or replace function private.revoke_company_member(c uuid, member uuid, confirmed boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare target_role text; target_email text;
begin
  perform private.lock_invitation_owner(c, false);
  if confirmed is distinct from true then raise exception 'confirmation required'; end if;
  select m.role into target_role from public.memberships m where m.company_id = c and m.user_id = member for update;
  if not found then raise exception 'member not found'; end if;
  if target_role = 'OWNER' then raise exception 'cannot revoke owner'; end if;
  select lower(u.email) into target_email from auth.users u where u.id = member;
  update public.professionals p set user_id = null where p.company_id = c and p.user_id = member;
  delete from public.memberships m where m.company_id = c and m.user_id = member;
  -- Merely expiring a revoked invitation would let resend resurrect that grant.
  update public.invitations i set canceled_at = coalesce(canceled_at, now()), expires_at = least(expires_at, now())
    where i.company_id = c and i.accepted_at is null and lower(i.email) = target_email;
end;
$$;
