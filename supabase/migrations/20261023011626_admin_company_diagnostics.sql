-- Support diagnostics are read-only. They never expose password hashes, reset
-- tokens, session credentials, customer records, or an impersonated session.
create function private.admin_company_diagnostics(p_company uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.companies%rowtype; owners jsonb; reason text;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'not authorized'; end if;
  perform 1 from private.platform_admins where user_id=auth.uid() for share;
  if not found then raise exception 'not authorized'; end if;
  select * into c from public.companies where id=p_company;
  if not found then return null; end if;
  reason:=case when c.status='trialing' and(c.trial_ends_at is null or c.trial_ends_at<=now()) then 'trial_expired' else c.status end;
  select coalesce(jsonb_agg(jsonb_build_object('email',u.email,'confirmed',u.email_confirmed_at is not null,
    'last_sign_in_at',to_jsonb(u)->'last_sign_in_at') order by lower(u.email),u.id),'[]'::jsonb) into owners
    from (select a.* from auth.users a join public.memberships m on m.user_id=a.id
      where m.company_id=p_company and m.role='OWNER' order by lower(a.email),a.id limit 20) u;
  return jsonb_build_object(
    'company',jsonb_build_object('id',c.id,'name',c.name,'niche',c.niche,'plan_id',c.plan_id,'status',c.status,
      'trial_ends_at',c.trial_ends_at,'trial_card_required',c.trial_card_required,'booking_enabled',c.booking_enabled,'booking_slug',c.booking_slug,'is_demo',c.is_demo),
    'owners',owners,
    'access',jsonb_build_object('writable',c.status='active' or(c.status='trialing' and coalesce(c.trial_ends_at>now(),false)),'reason',reason),
    'counts',jsonb_build_object(
      'customers',(select count(*) from public.customers where company_id=p_company),
      'services',(select count(*) from public.services where company_id=p_company),
      'professionals',(select count(*) from public.professionals where company_id=p_company),
      'appointments',(select count(*) from public.appointments where company_id=p_company),
      'classes',(select count(*) from public.class_sessions where company_id=p_company),
      'blocks',(select count(*) from public.schedule_blocks where company_id=p_company),
      'pending_invitations',(select count(*) from public.invitations where company_id=p_company and accepted_at is null and canceled_at is null and expires_at>now())));
end;
$$;
create function public.admin_company_diagnostics(p_company uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.admin_company_diagnostics(p_company); $$;
revoke all on function private.admin_company_diagnostics(uuid),public.admin_company_diagnostics(uuid) from public,anon,authenticated;
grant execute on function private.admin_company_diagnostics(uuid),public.admin_company_diagnostics(uuid) to authenticated;
