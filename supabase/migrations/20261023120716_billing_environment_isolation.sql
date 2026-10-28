-- Test and live checkouts/contracts must not block each other's operational flow.
-- Preserve all historical rows and payment records; only current-mode state is surfaced.
drop index private.billing_one_open_checkout;
create unique index billing_one_open_checkout on private.billing_checkouts(company_id,environment)
  where status in ('creating','pending','unknown');
drop index private.billing_one_card_contract;
create unique index billing_one_card_contract on private.billing_subscriptions(company_id,environment)
  where status<>'cancelled';

create or replace function private.billing_begin_checkout(p_company_id uuid,p_plan_id text,p_method text,p_quoted_amount_cents integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.companies; cfg private.billing_config; attempt private.billing_checkouts; price integer; max_staff integer; v_id uuid:=gen_random_uuid();
begin
  if auth.uid() is null or private.member_role(p_company_id) is distinct from 'OWNER' then raise exception 'billing owner required'; end if;
  select * into c from public.companies where id=p_company_id for update;
  if not found or private.member_role(p_company_id) is distinct from 'OWNER' then raise exception 'billing owner required'; end if;
  select * into cfg from private.billing_config where singleton;
  if not cfg.enabled or cfg.secret_hash is null or cfg.collector_id is null then raise exception 'billing unavailable'; end if;
  if c.is_demo or c.status in ('suspended','canceled','pending_card') then raise exception 'billing company blocked'; end if;
  if c.trial_ends_at>now() then raise exception 'billing trial still running'; end if;
  if p_method is null or p_method not in ('pix','card') then raise exception 'billing method invalid'; end if;
  select price_cents,staff_limit into price,max_staff from public.plans where id=p_plan_id;
  if price is null or price<=0 then raise exception 'billing plan invalid'; end if;
  if max_staff<(select count(*) from public.professionals where company_id=c.id and archived_at is null)
    or max_staff<(select count(*) from public.memberships where company_id=c.id and role<>'OWNER') then raise exception 'billing plan capacity'; end if;
  -- Expiration must be reconciled with the provider before another checkout.
  -- An approval can arrive after the QR expiry notification was observed locally.
  select * into attempt from private.billing_checkouts where company_id=c.id and environment=cfg.environment and status in ('creating','pending','unknown') for update;
  if found then
    if attempt.plan_id<>p_plan_id or attempt.method<>p_method or attempt.environment<>cfg.environment or attempt.requested_by<>auth.uid() then raise exception 'billing checkout already open'; end if;
    if p_quoted_amount_cents is not null and p_quoted_amount_cents<>attempt.amount_cents then raise exception 'billing price changed'; end if;
    return private.billing_checkout_dto(attempt);
  end if;
  if p_quoted_amount_cents is not null and p_quoted_amount_cents<>price then raise exception 'billing price changed'; end if;
  if exists(select 1 from private.billing_subscriptions where company_id=c.id and environment=cfg.environment and status<>'cancelled') then raise exception 'billing card contract exists'; end if;
  if c.paid_until>now() and (p_method='card' or p_plan_id<>c.plan_id) then raise exception 'billing current period still running'; end if;
  if c.paid_until>now() and not private.company_access_valid(c.id) then raise exception 'billing current period still running'; end if;
  insert into private.billing_checkouts(id,company_id,requested_by,plan_id,method,amount_cents,environment,collector_id,external_reference,reserved_start)
    values(v_id,c.id,auth.uid(),p_plan_id,p_method,price,cfg.environment,cfg.collector_id,v_id::text,greatest(now(),coalesce(c.paid_until,now()))) returning * into attempt;
  return private.billing_checkout_dto(attempt);
end;
$$;

create or replace function private.billing_snapshot(p_company_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.companies; cfg private.billing_config; checkout jsonb; subscription jsonb; payments jsonb;
begin
  if auth.uid() is null or (private.member_role(p_company_id) is distinct from 'OWNER' and not private.is_admin()) then raise exception 'billing owner required'; end if;
  select * into c from public.companies where id=p_company_id;
  if not found then return null; end if;
  select * into cfg from private.billing_config where singleton;
  select private.billing_checkout_dto(b) into checkout from private.billing_checkouts b where company_id=c.id and environment=cfg.environment order by created_at desc,id limit 1;
  select jsonb_build_object('provider_id',provider_id,'status',status,'plan_id',plan_id,'next_payment_at',next_payment_at,'environment',environment)
    into subscription from private.billing_subscriptions where company_id=c.id and environment=cfg.environment order by reconciled_at desc,id limit 1;
  select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) into payments from (select provider_id,amount_cents,currency,status,method,approved_at,environment,reconciled_at
    from private.billing_payments where company_id=c.id order by reconciled_at desc,id limit 20) p;
  return jsonb_build_object('company',jsonb_build_object('id',c.id,'status',c.status,'plan_id',c.plan_id,'paid_until',c.paid_until,'trial_ends_at',c.trial_ends_at,'access',private.company_access_valid(c.id)),
    'configuration',jsonb_build_object('enabled',cfg.enabled and cfg.secret_hash is not null and cfg.collector_id is not null,'environment',cfg.environment),
    'checkout',checkout,'subscription',subscription,'payments',payments);
end;
$$;

-- CREATE OR REPLACE retains the restricted existing RPC grants.
