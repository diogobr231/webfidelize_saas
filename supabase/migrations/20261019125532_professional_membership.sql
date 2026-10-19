-- Only an OWNER can associate login access with a professional's existing schedule.
-- Creating a professional still uses the existing INSERT policy and plan limit trigger.
revoke insert on public.professionals from authenticated;
grant insert(id, company_id, name) on public.professionals to authenticated;

create function private.company_team_directory(c uuid)
returns table(user_id uuid, role text, email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.member_role(c) is distinct from 'OWNER' then
    raise exception 'not authorized';
  end if;
  return query select m.user_id, m.role, u.email::text
    from public.memberships m join auth.users u on u.id = m.user_id
    where m.company_id = c order by lower(u.email), m.user_id;
end;
$$;
create function public.company_team_directory(c uuid)
returns table(user_id uuid, role text, email text)
language sql stable security invoker set search_path = '' as $$
  select * from private.company_team_directory(c);
$$;

create function private.assign_professional_member(c uuid, professional uuid, member uuid, expected_member uuid, confirmed boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare previous uuid;
begin
  if auth.uid() is null or private.member_role(c) is distinct from 'OWNER' then raise exception 'not authorized'; end if;
  perform 1 from public.companies where id = c for update;
  if not found or not private.writable(c) then raise exception 'subscription blocked'; end if;
  select p.user_id into previous from public.professionals p where p.company_id = c and p.id = professional for update;
  if not found then raise exception 'professional not found'; end if;
  if previous is distinct from expected_member then raise exception 'assignment version conflict'; end if;
  if previous is not null and previous is distinct from member and confirmed is distinct from true then
    raise exception 'confirmation required';
  end if;
  if member is not null then
    if not exists (select 1 from public.memberships m where m.company_id = c and m.user_id = member) then
      raise exception 'member not found';
    end if;
    if exists (select 1 from public.professionals p where p.company_id = c and p.user_id = member and p.id <> professional) then
      raise exception 'member already assigned';
    end if;
  end if;
  update public.professionals p set user_id = member where p.company_id = c and p.id = professional;
  return professional;
end;
$$;
create function public.assign_professional_member(c uuid, professional uuid, member uuid, expected_member uuid, confirmed boolean default false)
returns uuid language sql security invoker set search_path = '' as $$
  select private.assign_professional_member(c, professional, member, expected_member, confirmed);
$$;

create function private.revoke_company_member(c uuid, member uuid, confirmed boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare target_role text; target_email text;
begin
  if auth.uid() is null or private.member_role(c) is distinct from 'OWNER' then raise exception 'not authorized'; end if;
  if confirmed is distinct from true then raise exception 'confirmation required'; end if;
  perform 1 from public.companies where id = c for update;
  -- Cutting off an existing account is a security action, including after payment access expires.
  if not found then raise exception 'company not found'; end if;
  select m.role into target_role from public.memberships m where m.company_id = c and m.user_id = member for update;
  if not found then raise exception 'member not found'; end if;
  if target_role = 'OWNER' then raise exception 'cannot revoke owner'; end if;
  select lower(u.email) into target_email from auth.users u where u.id = member;
  -- Keep appointments, availability and the professional record intact.
  update public.professionals p set user_id = null where p.company_id = c and p.user_id = member;
  delete from public.memberships m where m.company_id = c and m.user_id = member;
  -- An outstanding invitation must not silently restore the access just revoked.
  update public.invitations i set expires_at = least(i.expires_at, now())
    where i.company_id = c and i.accepted_at is null and lower(i.email) = target_email;
end;
$$;
create function public.revoke_company_member(c uuid, member uuid, confirmed boolean default false)
returns void language sql security invoker set search_path = '' as $$
  select private.revoke_company_member(c, member, confirmed);
$$;

revoke all on function private.company_team_directory(uuid), public.company_team_directory(uuid),
  private.assign_professional_member(uuid, uuid, uuid, uuid, boolean), public.assign_professional_member(uuid, uuid, uuid, uuid, boolean),
  private.revoke_company_member(uuid, uuid, boolean), public.revoke_company_member(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function private.company_team_directory(uuid), public.company_team_directory(uuid),
  private.assign_professional_member(uuid, uuid, uuid, uuid, boolean), public.assign_professional_member(uuid, uuid, uuid, uuid, boolean),
  private.revoke_company_member(uuid, uuid, boolean), public.revoke_company_member(uuid, uuid, boolean) to authenticated;
