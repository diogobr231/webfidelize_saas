-- Expose only the effective access bit to authorized company members.
-- Financial records remain OWNER/SUPER_ADMIN-only in billing_snapshot.
create function private.company_access_state(p_company_id uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or (private.member_role(p_company_id) is null and not private.is_admin()) then
    raise exception 'company access denied';
  end if;
  return private.company_access_valid(p_company_id);
end;
$$;

create function public.company_access_state(p_company_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select private.company_access_state(p_company_id);
$$;

revoke all on function private.company_access_state(uuid),public.company_access_state(uuid) from public,anon,authenticated;
grant execute on function private.company_access_state(uuid),public.company_access_state(uuid) to authenticated;
