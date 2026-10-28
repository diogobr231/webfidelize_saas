-- Run as the database administrator AFTER 20261023114823_mercado_pago_billing.sql.
-- Also requires the company_access_state migration for member-facing access checks.
-- This is verification, not a migration. Execute the entire file in one call.
-- READ ONLY also prevents accidental application writes if an assertion regresses.
-- No credentials, fixture accounts, payments, emails or provider calls are used.
-- Role/JWT settings are transaction-local and are discarded by ROLLBACK.
begin transaction read only;
set local statement_timeout = '15s';
set local lock_timeout = '2s';

do $$
declare
  result jsonb := '[]'::jsonb;
  row record;
  target_company uuid;
  owner_id uuid;
  manager_id uuid;
  outsider_id uuid;
  snapshot jsonb;
  expected_access boolean;
  admin_body text;
  denied boolean;
  checked integer;
begin
  if to_regclass('private.billing_entitlements') is null then
    raise exception 'Billing migration has not been applied';
  end if;

  -- ACLs complement RLS: browser roles must not have any direct ledger access.
  for row in select c.oid, c.relname, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private' and c.relname in
      ('billing_config','billing_checkouts','billing_subscriptions','billing_payments','billing_entitlements','billing_events')
  loop
    if not row.relrowsecurity or has_table_privilege('anon',row.oid,'SELECT,INSERT,UPDATE,DELETE')
      or has_table_privilege('authenticated',row.oid,'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'Unsafe ledger ACL/RLS on %',row.relname;
    end if;
  end loop;
  -- A whole-table grant also makes has_column_privilege true.
  if has_column_privilege('anon','public.companies','paid_until','UPDATE')
    or has_column_privilege('authenticated','public.companies','paid_until','UPDATE')
    or has_column_privilege('authenticated','public.companies','status','UPDATE')
    or has_column_privilege('authenticated','public.companies','trial_ends_at','UPDATE') then
    raise exception 'Browser role can mutate billing access fields';
  end if;
  if has_function_privilege('anon','public.billing_snapshot(uuid)','EXECUTE')
    or has_function_privilege('anon','public.billing_begin_checkout(uuid,text,text,integer)','EXECUTE')
    or has_function_privilege('anon','public.company_access_state(uuid)','EXECUTE')
    or has_function_privilege('authenticated','private.billing_refresh_company(uuid)','EXECUTE')
    or has_function_privilege('anon','private.billing_refresh_company(uuid)','EXECUTE') then
    raise exception 'Unsafe billing RPC grant';
  end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('billing_snapshot','billing_begin_checkout','billing_gateway','company_access_state') and p.prosecdef) then
    raise exception 'Public billing wrappers must remain SECURITY INVOKER';
  end if;
  result := result || jsonb_build_array(jsonb_build_object('check','Ledger RLS, direct ACLs, billing columns and RPC grants','status','passed'));

  -- Evaluate the real stored dates without advancing time or updating a company.
  checked := 0;
  for row in select c.id,c.status,c.trial_ends_at,c.paid_until,c.booking_enabled,c.booking_slug,
    (c.status='trialing' and c.trial_ends_at>now()) or
    (c.status='active' and c.paid_until>now() and exists(select 1 from private.billing_entitlements e
      where e.company_id=c.id and e.revoked_at is null and e.starts_at<=now() and e.ends_at>now())) as expected
    from public.companies c
  loop
    if private.company_access_valid(row.id) is distinct from coalesce(row.expected,false) then
      raise exception 'Current access does not match authoritative entitlement';
    end if;
    if row.status='trialing' and row.trial_ends_at is not null
      and private.company_access_valid(row.id,row.trial_ends_at) then
      raise exception 'Trial remains usable at its backend expiration';
    end if;
    if row.status='active' and (row.paid_until is null or not isfinite(row.paid_until)) then
      raise exception 'An active company has no finite paid deadline';
    end if;
    if row.status='active' and private.company_access_valid(row.id,row.paid_until) then
      raise exception 'Paid access remains usable at its backend expiration';
    end if;
    if not private.company_access_valid(row.id) and row.booking_enabled and row.booking_slug is not null
      and private.public_catalog(row.booking_slug) is not null then
      raise exception 'Public booking bypasses the backend expiration';
    end if;
    checked := checked+1;
  end loop;
  result := result || jsonb_build_array(jsonb_build_object('check','Actual company dates and public-booking expiration','status','passed','companies_checked',checked));

  select m.company_id,m.user_id into target_company,owner_id from public.memberships m
    where m.role='OWNER' and not exists(select 1 from private.platform_admins p where p.user_id=m.user_id)
    order by m.company_id,m.user_id limit 1;
  if target_company is null then
    result := result || jsonb_build_array(jsonb_build_object('check','OWNER snapshot and company RLS','status','skipped','reason','No existing non-admin OWNER'));
  else
    expected_access := private.company_access_valid(target_company);
    perform set_config('request.jwt.claim.sub',owner_id::text,true);
    execute 'set local role authenticated';
    snapshot := public.billing_snapshot(target_company);
    if snapshot->'company'->>'id' is distinct from target_company::text
      or (snapshot->'company'->>'access')::boolean is distinct from expected_access then
      raise exception 'OWNER snapshot mismatch';
    end if;
    if public.company_access_state(target_company) is distinct from expected_access then
      raise exception 'OWNER access bit mismatch';
    end if;
    if exists(select 1 from public.companies c where private.member_role(c.id) is null) then
      raise exception 'OWNER can read an unrelated company';
    end if;
    denied := false;
    begin perform 1 from private.billing_payments limit 1;
      exception when insufficient_privilege then denied := true;
    end;
    if not denied then raise exception 'OWNER can directly read the private payment ledger'; end if;
    execute 'reset role';
    result := result || jsonb_build_array(jsonb_build_object('check','OWNER snapshot and company RLS','status','passed'));

    select u.id into outsider_id from auth.users u
      where not exists(select 1 from public.memberships m where m.company_id=target_company and m.user_id=u.id)
        and not exists(select 1 from private.platform_admins p where p.user_id=u.id)
      order by u.id limit 1;
    if outsider_id is null then
      result := result || jsonb_build_array(jsonb_build_object('check','Authenticated non-member denial','status','skipped','reason','No existing non-member account'));
    else
      perform set_config('request.jwt.claim.sub',outsider_id::text,true);
      execute 'set local role authenticated';
      denied := false;
      begin perform public.billing_snapshot(target_company);
        exception when raise_exception then
          if sqlerrm='billing owner required' then denied := true; else raise; end if;
      end;
      if not denied then raise exception 'Non-member obtained a billing snapshot'; end if;
      denied := false;
      begin perform public.company_access_state(target_company);
        exception when raise_exception then
          if sqlerrm='company access denied' then denied := true; else raise; end if;
      end;
      if not denied then raise exception 'Non-member obtained a company access bit'; end if;
      if exists(select 1 from public.companies where id=target_company) then
        raise exception 'Non-member company RLS leak';
      end if;
      execute 'reset role';
      result := result || jsonb_build_array(jsonb_build_object('check','Authenticated non-member denial','status','passed'));
    end if;
  end if;

  select m.company_id,m.user_id into target_company,manager_id from public.memberships m
    where m.role='MANAGER' and not exists(select 1 from private.platform_admins p where p.user_id=m.user_id)
    order by m.company_id,m.user_id limit 1;
  if manager_id is null then
    result := result || jsonb_build_array(jsonb_build_object('check','MANAGER financial snapshot denial','status','skipped','reason','No existing non-admin MANAGER'));
  else
    expected_access := private.company_access_valid(target_company);
    perform set_config('request.jwt.claim.sub',manager_id::text,true);
    execute 'set local role authenticated';
    if public.company_access_state(target_company) is distinct from expected_access then
      raise exception 'MANAGER access bit mismatch';
    end if;
    denied := false;
    begin perform public.billing_snapshot(target_company);
      exception when raise_exception then
        if sqlerrm='billing owner required' then denied := true; else raise; end if;
    end;
    if not denied then raise exception 'MANAGER obtained an OWNER billing snapshot'; end if;
    execute 'reset role';
    result := result || jsonb_build_array(jsonb_build_object('check','MANAGER financial snapshot denial','status','passed'));
  end if;

  perform set_config('request.jwt.claim.sub','',true);
  execute 'set local role anon';
  denied := false;
  begin perform public.billing_snapshot('00000000-0000-0000-0000-000000000000');
    exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Anonymous caller can execute billing_snapshot'; end if;
  denied := false;
  begin perform public.company_access_state('00000000-0000-0000-0000-000000000000');
    exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Anonymous caller can execute company_access_state'; end if;
  denied := false;
  begin perform public.billing_gateway('deliberately-invalid-short-value','list_pending','{}');
    exception when raise_exception then
      if sqlerrm='billing gateway unauthorized' then denied := true; else raise; end if;
  end;
  if not denied then raise exception 'Billing gateway accepted an invalid secret'; end if;
  denied := false;
  begin perform 1 from private.billing_config limit 1;
    exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Anonymous caller can read private billing configuration'; end if;
  execute 'reset role';
  result := result || jsonb_build_array(jsonb_build_object('check','Anonymous ACLs and invalid gateway secret','status','passed'));

  -- admin_company takes a row lock, so do not invoke it in a READ ONLY audit.
  -- Assert the same explicit status allowlists exercised by test:trial:db.
  select regexp_replace(lower(prosrc),'\s','','g') into admin_body
    from pg_proc where oid='private.admin_company(uuid,text,text,timestamptz)'::regprocedure;
  if position('ifnew_statusisnullornew_statusnotin(''pending_card'',''suspended'',''canceled'')thenraiseexception''invalidmanualstatus'';endif;' in admin_body)=0
    or position('ifnew_statusisnullornew_statusnotin(''trialing'',''suspended'',''canceled'')thenraiseexception''invalidmanualstatus'';endif;' in admin_body)=0 then
    raise exception 'Manual status allowlist changed; review before enabling billing';
  end if;
  result := result || jsonb_build_array(jsonb_build_object('check','Manual activation allowlists inspected (behavior tested in isolated SQL)','status','passed'));
  perform set_config('webfidelize.billing_verification',result::text,true);
end;
$$;

-- Only aggregate verification results, never account names, emails, IDs or secrets.
select current_setting('webfidelize.billing_verification')::jsonb as billing_verification;
rollback;
