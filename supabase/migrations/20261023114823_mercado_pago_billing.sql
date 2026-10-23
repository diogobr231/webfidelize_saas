-- Payments are disabled until the server gateway is configured explicitly.
-- No legacy trial is renewed and no paid access is invented by this migration.
alter table public.companies add column paid_until timestamptz;
alter table public.companies add constraint company_paid_until_finite
  check(paid_until is null or isfinite(paid_until));
do $$ begin
  if exists(select 1 from public.companies where status='active') then
    raise exception 'Review existing paid companies before enabling billing';
  end if;
end $$;

create table private.billing_config (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  environment text not null default 'test' check(environment in ('test','live')),
  collector_id text check(collector_id ~ '^[0-9]{1,30}$'),
  secret_hash text check(secret_hash ~ '^[a-f0-9]{64}$')
);
insert into private.billing_config(singleton) values(true);
create table private.billing_checkouts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  requested_by uuid not null references auth.users(id),
  plan_id text not null references public.plans(id),
  method text not null check(method in ('pix','card')),
  amount_cents integer not null check(amount_cents>0),
  currency text not null default 'BRL' check(currency='BRL'),
  environment text not null check(environment in ('test','live')),
  collector_id text not null,
  external_reference text not null unique,
  status text not null default 'creating' check(status in ('creating','pending','unknown','completed','failed','expired')),
  provider_id text,
  checkout_url text,
  qr_code text,
  qr_code_base64 text,
  expires_at timestamptz,
  reserved_start timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  leased_until timestamptz,
  creation_claimed boolean not null default false,
  error_code text,
  last_polled_at timestamptz,
  unique(company_id,id),
  check(expires_at is null or isfinite(expires_at)),
  check(isfinite(reserved_start))
);
create unique index billing_one_open_checkout on private.billing_checkouts(company_id)
  where status in ('creating','pending','unknown');
create unique index billing_checkout_provider_unique on private.billing_checkouts(environment,collector_id,method,provider_id)
  where provider_id is not null;
create index billing_checkout_company_time on private.billing_checkouts(company_id,created_at desc);
create table private.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  checkout_id uuid not null unique,
  provider_id text not null,
  environment text not null,
  collector_id text not null,
  plan_id text not null references public.plans(id),
  status text not null check(status in ('pending','authorized','paused','cancelled')),
  next_payment_at timestamptz,
  last_modified timestamptz not null,
  reconciled_at timestamptz not null default now(),
  last_polled_at timestamptz,
  foreign key(company_id,checkout_id) references private.billing_checkouts(company_id,id),
  unique(environment,collector_id,provider_id)
);
create unique index billing_one_card_contract on private.billing_subscriptions(company_id)
  where status<>'cancelled';
create table private.billing_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  checkout_id uuid not null,
  provider_id text not null,
  environment text not null,
  collector_id text not null,
  subscription_id text,
  authorized_payment_id text,
  method text not null check(method in ('pix','card')),
  amount_cents integer not null check(amount_cents>0),
  currency text not null check(currency='BRL'),
  status text not null check(status in ('pending','in_process','authorized','approved','rejected','cancelled','refunded','charged_back')),
  approved_at timestamptz,
  last_modified timestamptz not null,
  reconciled_at timestamptz not null default now(),
  last_polled_at timestamptz,
  foreign key(company_id,checkout_id) references private.billing_checkouts(company_id,id),
  unique(environment,collector_id,provider_id),
  unique(company_id,id),
  check(approved_at is null or isfinite(approved_at))
);
create index billing_payments_company on private.billing_payments(company_id,reconciled_at desc);
create unique index billing_payment_invoice_unique on private.billing_payments(environment,collector_id,authorized_payment_id) where authorized_payment_id is not null;
create table private.billing_entitlements (
  payment_id uuid primary key,
  company_id uuid not null,
  plan_id text not null references public.plans(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  revoked_at timestamptz,
  foreign key(company_id,payment_id) references private.billing_payments(company_id,id),
  check(isfinite(starts_at) and isfinite(ends_at) and ends_at>starts_at)
);
create index billing_entitlements_company on private.billing_entitlements(company_id,ends_at) where revoked_at is null;
create table private.billing_events (
  event_key text primary key check(length(event_key) between 1 and 200),
  event_type text not null check(event_type in ('payment','subscription_preapproval','subscription_authorized_payment')),
  resource_id text not null check(resource_id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  received_at timestamptz not null default now(),
  finished_at timestamptz
  ,last_polled_at timestamptz
);
create index billing_events_pending on private.billing_events(received_at) where finished_at is null;
do $$ declare t text; begin
  foreach t in array array['billing_config','billing_checkouts','billing_subscriptions','billing_payments','billing_entitlements','billing_events'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated',t);
  end loop;
end $$;

create function private.company_access_valid(c uuid, stamp timestamptz default now()) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.companies co where co.id=c and (
    (co.status='trialing' and co.trial_ends_at>stamp) or
    (co.status='active' and co.paid_until>stamp and exists(select 1 from private.billing_entitlements e
      where e.company_id=co.id and e.revoked_at is null and e.starts_at<=stamp and e.ends_at>stamp))));
$$;
create or replace function private.writable(c uuid) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and private.company_access_valid(c);
$$;
revoke all on function private.company_access_valid(uuid,timestamptz) from public,anon,authenticated;

create function private.billing_checkout_dto(p_row private.billing_checkouts) returns jsonb
language sql immutable security invoker set search_path='' as $$
  select jsonb_build_object('id',p_row.id,'company_id',p_row.company_id,'plan_id',p_row.plan_id,'method',p_row.method,
    'amount_cents',p_row.amount_cents,'currency',p_row.currency,'environment',p_row.environment,
    'external_reference',p_row.external_reference,'status',p_row.status,'provider_id',p_row.provider_id,
    'checkout_url',p_row.checkout_url,'qr_code',p_row.qr_code,'qr_code_base64',p_row.qr_code_base64,'expires_at',p_row.expires_at,
    'error_code',p_row.error_code,'created_at',p_row.created_at);
$$;
create function private.billing_begin_checkout(p_company_id uuid,p_plan_id text,p_method text,p_quoted_amount_cents integer default null) returns jsonb
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
  select * into attempt from private.billing_checkouts where company_id=c.id and status in ('creating','pending','unknown') for update;
  if found then
    if attempt.plan_id<>p_plan_id or attempt.method<>p_method or attempt.environment<>cfg.environment or attempt.requested_by<>auth.uid() then raise exception 'billing checkout already open'; end if;
    if p_quoted_amount_cents is not null and p_quoted_amount_cents<>attempt.amount_cents then raise exception 'billing price changed'; end if;
    return private.billing_checkout_dto(attempt);
  end if;
  if p_quoted_amount_cents is not null and p_quoted_amount_cents<>price then raise exception 'billing price changed'; end if;
  if exists(select 1 from private.billing_subscriptions where company_id=c.id and status<>'cancelled') then raise exception 'billing card contract exists'; end if;
  if c.paid_until>now() and (p_method='card' or p_plan_id<>c.plan_id) then raise exception 'billing current period still running'; end if;
  if c.paid_until>now() and not private.company_access_valid(c.id) then raise exception 'billing current period still running'; end if;
  insert into private.billing_checkouts(id,company_id,requested_by,plan_id,method,amount_cents,environment,collector_id,external_reference,reserved_start)
    values(v_id,c.id,auth.uid(),p_plan_id,p_method,price,cfg.environment,cfg.collector_id,v_id::text,greatest(now(),coalesce(c.paid_until,now()))) returning * into attempt;
  return private.billing_checkout_dto(attempt);
end;
$$;
create function private.billing_snapshot(p_company_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.companies; cfg private.billing_config; checkout jsonb; subscription jsonb; payments jsonb;
begin
  if auth.uid() is null or (private.member_role(p_company_id) is distinct from 'OWNER' and not private.is_admin()) then raise exception 'billing owner required'; end if;
  select * into c from public.companies where id=p_company_id;
  if not found then return null; end if;
  select * into cfg from private.billing_config where singleton;
  select private.billing_checkout_dto(b) into checkout from private.billing_checkouts b where company_id=c.id order by created_at desc,id limit 1;
  select jsonb_build_object('provider_id',provider_id,'status',status,'plan_id',plan_id,'next_payment_at',next_payment_at,'environment',environment)
    into subscription from private.billing_subscriptions where company_id=c.id order by reconciled_at desc,id limit 1;
  select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) into payments from (select provider_id,amount_cents,currency,status,method,approved_at,environment,reconciled_at
    from private.billing_payments where company_id=c.id order by reconciled_at desc,id limit 20) p;
  return jsonb_build_object('company',jsonb_build_object('id',c.id,'status',c.status,'plan_id',c.plan_id,'paid_until',c.paid_until,'trial_ends_at',c.trial_ends_at,'access',private.company_access_valid(c.id)),
    'configuration',jsonb_build_object('enabled',cfg.enabled and cfg.secret_hash is not null and cfg.collector_id is not null,'environment',cfg.environment),
    'checkout',checkout,'subscription',subscription,'payments',payments);
end;
$$;
create function private.billing_refresh_company(c uuid) returns void
language plpgsql security definer set search_path='' as $$
declare co public.companies; deadline timestamptz; target_plan text;
begin
  select * into co from public.companies where id=c for update;
  select max(ends_at) into deadline from private.billing_entitlements where company_id=c and revoked_at is null;
  select plan_id into target_plan from private.billing_entitlements where company_id=c and revoked_at is null order by ends_at desc,payment_id limit 1;
  update public.companies set paid_until=deadline,
    plan_id=case when deadline>now() then coalesce(target_plan,co.plan_id) else co.plan_id end,
    status=case when co.status in ('suspended','canceled') then co.status when deadline>now() then 'active'
      when co.status='trialing' and co.trial_ends_at>now() then 'trialing' else 'past_due' end where id=c;
end;
$$;
create function private.billing_gateway(p_secret text,p_operation text,p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg private.billing_config; b private.billing_checkouts; sub private.billing_subscriptions; pay private.billing_payments;
  co public.companies; v_status text; stamp timestamptz:=clock_timestamp(); modified timestamptz; approved timestamptz;
  period_start timestamptz; v_id uuid; allowed boolean; v_url text; v_error text; result jsonb;
  batch_size integer; pending_checkouts jsonb; pending_subscriptions jsonb; pending_payments jsonb; pending_events jsonb;
begin
  select * into cfg from private.billing_config where singleton;
  if p_secret is null or length(p_secret)<32 or cfg.secret_hash is null
    or encode(sha256(convert_to(p_secret,'UTF8')),'hex')<>cfg.secret_hash then raise exception 'billing gateway unauthorized'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>200000 then raise exception 'billing payload invalid'; end if;
  if p_operation='record_event' then
    if length(p_payload->>'event_key') not between 1 and 200 or (p_payload->>'resource_id')!~'^[a-zA-Z0-9_-]{1,100}$' then raise exception 'billing event invalid'; end if;
    insert into private.billing_events(event_key,event_type,resource_id) values(p_payload->>'event_key',p_payload->>'event_type',p_payload->>'resource_id') on conflict do nothing;
    if exists(select 1 from private.billing_events where event_key=p_payload->>'event_key' and (event_type<>p_payload->>'event_type' or resource_id<>p_payload->>'resource_id')) then raise exception 'billing event conflict'; end if;
    return (select jsonb_build_object('processed',finished_at is not null) from private.billing_events where event_key=p_payload->>'event_key');
  elsif p_operation='event_done' then
    update private.billing_events set finished_at=coalesce(finished_at,stamp) where event_key=p_payload->>'event_key';
    return jsonb_build_object('updated',found);
  elsif p_operation='resource_context' then
    if p_payload->>'resource_type'='payment' then
      select c.* into b from private.billing_checkouts c where c.id in
        (select p.checkout_id from private.billing_payments p where p.provider_id=p_payload->>'provider_id' and p.environment=cfg.environment and p.collector_id=cfg.collector_id)
        or (c.method='pix' and c.provider_id=p_payload->>'provider_id' and c.environment=cfg.environment and c.collector_id=cfg.collector_id) limit 1;
    elsif p_payload->>'resource_type'='subscription' then
      select c.* into b from private.billing_checkouts c where c.method='card' and c.provider_id=p_payload->>'provider_id' and c.environment=cfg.environment and c.collector_id=cfg.collector_id limit 1;
    else raise exception 'billing resource invalid'; end if;
    if not found then return null; end if;
    return private.billing_checkout_dto(b)||jsonb_build_object('collector_id',b.collector_id,'payer_email',(select email from auth.users where id=b.requested_by));
  elsif p_operation='list_pending' then
    batch_size:=least(greatest(coalesce((p_payload->>'limit')::integer,20),1),50);
    with selected as (select id from private.billing_checkouts where status in ('creating','pending','unknown') and environment=cfg.environment and collector_id=cfg.collector_id
      order by last_polled_at nulls first,updated_at,id limit batch_size for update skip locked),
    polled as (update private.billing_checkouts x set last_polled_at=stamp where x.id in(select id from selected) returning x.*)
      select coalesce(jsonb_agg(private.billing_checkout_dto(polled)),'[]'::jsonb) into pending_checkouts from polled;
    with selected as (select id from private.billing_subscriptions where status<>'cancelled' and environment=cfg.environment and collector_id=cfg.collector_id
      order by last_polled_at nulls first,reconciled_at,id limit batch_size for update skip locked),
    polled as (update private.billing_subscriptions x set last_polled_at=stamp where x.id in(select id from selected) returning x.*)
      select coalesce(jsonb_agg(jsonb_build_object('external_reference',bc.external_reference,'provider_id',s.provider_id,'environment',s.environment)),'[]'::jsonb)
      into pending_subscriptions from polled s join private.billing_checkouts bc on bc.id=s.checkout_id;
    with selected as (select id from private.billing_payments where status='approved' and environment=cfg.environment and collector_id=cfg.collector_id
      order by last_polled_at nulls first,reconciled_at,id limit batch_size for update skip locked),
    polled as (update private.billing_payments x set last_polled_at=stamp where x.id in(select id from selected) returning x.*)
      select coalesce(jsonb_agg(jsonb_build_object('external_reference',bc.external_reference,'provider_id',p.provider_id,'environment',p.environment,'method',p.method,'subscription_id',p.subscription_id)),'[]'::jsonb)
      into pending_payments from polled p join private.billing_checkouts bc on bc.id=p.checkout_id;
    with selected as (select event_key from private.billing_events where finished_at is null order by last_polled_at nulls first,received_at,event_key limit batch_size for update skip locked),
    polled as (update private.billing_events x set last_polled_at=stamp where x.event_key in(select event_key from selected) returning x.*)
      select coalesce(jsonb_agg(jsonb_build_object('event_key',event_key,'event_type',event_type,'resource_id',resource_id)),'[]'::jsonb) into pending_events from polled;
    return jsonb_build_object('checkouts',pending_checkouts,'subscriptions',pending_subscriptions,'payments',pending_payments,'events',pending_events);
  end if;
  if p_operation in ('checkout_context','checkout_created','checkout_failed') then
    select * into b from private.billing_checkouts where id=(p_payload->>'checkout_id')::uuid;
  elsif p_operation in ('record_subscription','record_payment') then
    select * into b from private.billing_checkouts where external_reference=p_payload->>'external_reference';
  else raise exception 'billing operation invalid'; end if;
  if not found then raise exception 'billing checkout unknown'; end if;
  select * into co from public.companies where id=b.company_id for update;
  select * into b from private.billing_checkouts where id=b.id for update;
  if p_operation='checkout_context' then
    allowed:=coalesce((p_payload->>'claim')::boolean,true) and cfg.enabled and b.environment=cfg.environment and b.collector_id=cfg.collector_id
      and co.status not in ('suspended','canceled','pending_card') and not co.is_demo and not(co.trial_ends_at>stamp)
      and exists(select 1 from public.memberships where company_id=b.company_id and user_id=b.requested_by and role='OWNER')
      and b.status in ('creating','unknown') and (b.leased_until is null or b.leased_until<=stamp)
      and (b.method='pix' or not b.creation_claimed);
    if allowed then update private.billing_checkouts set creation_claimed=true,leased_until=stamp+interval '60 seconds',updated_at=stamp where id=b.id;
    elsif coalesce((p_payload->>'claim')::boolean,true) and b.method='card' and b.creation_claimed and b.status='creating' and b.leased_until<=stamp then
      update private.billing_checkouts set status='unknown',error_code='creation_unknown',updated_at=stamp where id=b.id;
    end if;
    return private.billing_checkout_dto(b)||jsonb_build_object('create_allowed',allowed,'idempotency_key',b.id::text,'collector_id',b.collector_id,
      'payer_email',(select email from auth.users where id=b.requested_by));
  elsif p_operation='checkout_failed' then
    v_error:=p_payload->>'error_code';
    if v_error is null or v_error not in ('provider_rejected','provider_unavailable','creation_unknown','invalid_provider_response','configuration') then raise exception 'billing error invalid'; end if;
    if b.status in ('creating','unknown') then update private.billing_checkouts set status=case when coalesce((p_payload->>'uncertain')::boolean,true) then 'unknown' else 'failed' end,
      error_code=v_error,leased_until=null,updated_at=stamp where id=b.id returning * into b; end if;
    return private.billing_checkout_dto(b);
  elsif p_operation='checkout_created' then
    if (p_payload->>'provider_id') is null or (p_payload->>'provider_id')!~'^[a-zA-Z0-9_-]{1,100}$' then raise exception 'billing provider id invalid'; end if;
    if b.provider_id is not null and b.provider_id<>p_payload->>'provider_id' then raise exception 'billing provider id conflict'; end if;
    v_url:=nullif(p_payload->>'checkout_url','');
    if v_url is not null and (length(v_url)>2000 or v_url!~'^https://(www\.)?mercadopago\.com\.br/') then raise exception 'billing checkout url invalid'; end if;
    if length(coalesce(p_payload->>'qr_code',''))>16000 or length(coalesce(p_payload->>'qr_code_base64',''))>150000 then raise exception 'billing qr invalid'; end if;
    if b.status in ('completed','failed','expired') then return private.billing_checkout_dto(b); end if;
    update private.billing_checkouts set provider_id=p_payload->>'provider_id',checkout_url=v_url,
      qr_code=p_payload->>'qr_code',qr_code_base64=p_payload->>'qr_code_base64',expires_at=nullif(p_payload->>'expires_at','')::timestamptz,
      status='pending',leased_until=null,error_code=null,updated_at=stamp where id=b.id returning * into b;
    return private.billing_checkout_dto(b);
  end if;
  -- Only authoritative provider reads, passed by the secret-bearing backend, reach here.
  if (p_payload->>'environment') is distinct from b.environment or (p_payload->>'collector_id') is distinct from b.collector_id
    or (p_payload->>'collector_id') is distinct from cfg.collector_id or (p_payload->>'currency') is distinct from 'BRL'
    or (p_payload->>'amount_cents')::integer is distinct from b.amount_cents
    or (p_payload->>'provider_id') is null or (p_payload->>'provider_id')!~'^[a-zA-Z0-9_-]{1,100}$' then raise exception 'billing provider mismatch'; end if;
  modified:=nullif(p_payload->>'last_modified','')::timestamptz;
  if modified is null or not isfinite(modified) or modified>stamp+interval '5 minutes' then raise exception 'billing provider date invalid'; end if;
  v_status:=p_payload->>'status';
  if p_operation='record_subscription' then
    if b.method<>'card' or v_status is null or v_status not in ('pending','authorized','paused','cancelled')
      or (b.provider_id is not null and b.provider_id<>p_payload->>'provider_id') then raise exception 'billing subscription mismatch'; end if;
    select * into sub from private.billing_subscriptions where environment=b.environment and collector_id=b.collector_id and provider_id=p_payload->>'provider_id' for update;
    if found and sub.checkout_id<>b.id then raise exception 'billing subscription tenant mismatch'; end if;
    if sub.id is not null and (modified<sub.last_modified or sub.status='cancelled') then return jsonb_build_object('applied',false); end if;
    insert into private.billing_subscriptions(company_id,checkout_id,provider_id,environment,collector_id,plan_id,status,next_payment_at,last_modified)
      values(b.company_id,b.id,p_payload->>'provider_id',b.environment,b.collector_id,b.plan_id,v_status,nullif(p_payload->>'next_payment_at','')::timestamptz,modified)
      on conflict(checkout_id) do update set status=excluded.status,next_payment_at=excluded.next_payment_at,last_modified=excluded.last_modified,reconciled_at=stamp;
    update private.billing_checkouts set provider_id=p_payload->>'provider_id',status=case when v_status='pending' then 'pending' else 'completed' end,leased_until=null,updated_at=stamp where id=b.id;
    return jsonb_build_object('applied',true,'status',v_status);
  end if;
  if (p_payload->>'method') is distinct from b.method or v_status is null or v_status not in ('pending','in_process','authorized','approved','rejected','cancelled','refunded','charged_back') then raise exception 'billing payment mismatch'; end if;
  if b.method='card' then
    select * into sub from private.billing_subscriptions where checkout_id=b.id and provider_id=p_payload->>'subscription_id';
    if not found then raise exception 'billing subscription unknown'; end if;
  elsif p_payload->>'subscription_id' is not null or (b.provider_id is not null and b.provider_id<>p_payload->>'provider_id') then raise exception 'billing pix mismatch'; end if;
  approved:=nullif(p_payload->>'approved_at','')::timestamptz;
  if v_status='approved' and (approved is null or not isfinite(approved) or approved>stamp+interval '5 minutes' or approved<b.created_at-interval '5 minutes') then raise exception 'billing approval invalid'; end if;
  select * into pay from private.billing_payments where environment=b.environment and collector_id=b.collector_id and provider_id=p_payload->>'provider_id' for update;
  if found and pay.checkout_id<>b.id then raise exception 'billing payment tenant mismatch'; end if;
  if b.method='card' and v_status='approved' and pay.authorized_payment_id is null and
    (p_payload->>'authorized_payment_id' is null or (p_payload->>'authorized_payment_id')!~'^[a-zA-Z0-9_-]{1,100}$') then raise exception 'billing invoice proof required'; end if;
  if pay.authorized_payment_id is not null and p_payload->>'authorized_payment_id' is not null
    and pay.authorized_payment_id<>p_payload->>'authorized_payment_id' then raise exception 'billing invoice mismatch'; end if;
  if pay.id is not null and (modified<pay.last_modified or pay.status in ('refunded','charged_back')
    or (pay.status='approved' and v_status in ('pending','in_process','authorized','rejected','cancelled'))) then return jsonb_build_object('applied',false); end if;
  insert into private.billing_payments(company_id,checkout_id,provider_id,environment,collector_id,subscription_id,authorized_payment_id,method,amount_cents,currency,status,approved_at,last_modified)
    values(b.company_id,b.id,p_payload->>'provider_id',b.environment,b.collector_id,p_payload->>'subscription_id',p_payload->>'authorized_payment_id',b.method,b.amount_cents,'BRL',v_status,approved,modified)
    on conflict(environment,collector_id,provider_id) do update set status=excluded.status,approved_at=coalesce(private.billing_payments.approved_at,excluded.approved_at),
      authorized_payment_id=coalesce(private.billing_payments.authorized_payment_id,excluded.authorized_payment_id),last_modified=excluded.last_modified,reconciled_at=stamp
    returning * into pay;
  if v_status='approved' and b.environment='live' and cfg.environment='live' then
    if b.method='pix' and exists(select 1 from private.billing_payments where checkout_id=b.id and id<>pay.id and status='approved') then raise exception 'billing checkout already settled'; end if;
    period_start:=case when b.method='pix' then greatest(b.reserved_start,pay.approved_at) else pay.approved_at end;
    insert into private.billing_entitlements(payment_id,company_id,plan_id,starts_at,ends_at)
      values(pay.id,b.company_id,b.plan_id,period_start,period_start+interval '1 month') on conflict do nothing;
  elsif v_status in ('refunded','charged_back') then
    update private.billing_entitlements set revoked_at=coalesce(revoked_at,stamp) where payment_id=pay.id;
  end if;
  if b.method='pix' then update private.billing_checkouts set provider_id=pay.provider_id,status=case when v_status in ('approved','refunded','charged_back') then 'completed' when v_status in ('rejected','cancelled') then 'failed' else 'pending' end,updated_at=stamp where id=b.id; end if;
  if b.environment='live' then perform private.billing_refresh_company(b.company_id); end if;
  return jsonb_build_object('applied',true,'status',v_status,'paid_until',(select paid_until from public.companies where id=b.company_id));
end;
$$;

create function public.billing_begin_checkout(p_company_id uuid,p_plan_id text,p_method text,p_quoted_amount_cents integer default null) returns jsonb
language sql security invoker set search_path='' as $$ select private.billing_begin_checkout(p_company_id,p_plan_id,p_method,p_quoted_amount_cents); $$;
create function public.billing_snapshot(p_company_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.billing_snapshot(p_company_id); $$;
create function public.billing_gateway(p_secret text,p_operation text,p_payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.billing_gateway(p_secret,p_operation,p_payload); $$;
revoke all on function private.billing_checkout_dto(private.billing_checkouts),private.billing_refresh_company(uuid),private.billing_begin_checkout(uuid,text,text,integer),private.billing_snapshot(uuid),private.billing_gateway(text,text,jsonb),public.billing_begin_checkout(uuid,text,text,integer),public.billing_snapshot(uuid),public.billing_gateway(text,text,jsonb) from public,anon,authenticated;
grant execute on function private.billing_begin_checkout(uuid,text,text,integer),private.billing_snapshot(uuid),public.billing_begin_checkout(uuid,text,text,integer),public.billing_snapshot(uuid) to authenticated;
grant execute on function private.billing_gateway(text,text,jsonb),public.billing_gateway(text,text,jsonb) to anon,authenticated;

-- All existing public-booking, staff, reminder, and diagnostic gates now share the same finite entitlement check.

-- Source: 20261021211033_team_plan_value.sql
create or replace function private.validate_appointment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare duration integer; expected_duration interval; s timestamp; e timestamp; sm integer; em integer; member text;
begin
  perform 1 from public.companies where id = new.company_id for update;
  if not found then raise exception 'booking unavailable'; end if;
  member := private.member_role(new.company_id);
  if auth.uid() is not null and coalesce(member, '') not in ('OWNER', 'MANAGER') then
    if member = 'EMPLOYEE' and tg_op = 'UPDATE'
      and old.status = 'scheduled' and new.status = 'completed' and old.ends_at <= now()
      and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status')
      and private.writable(new.company_id)
      and exists (select 1 from public.professionals where company_id = new.company_id and id = new.professional_id and user_id = auth.uid() and archived_at is null) then
      return new;
    end if;
    raise exception 'not authorized';
  end if;
  if tg_op = 'UPDATE' then
    if row(new.company_id, new.customer_id, new.service_id, new.professional_id) is distinct from row(old.company_id, old.customer_id, old.service_id, old.professional_id) then raise exception 'appointment identity is immutable'; end if;
    if new.starts_at = old.starts_at and new.ends_at = old.ends_at then return new; end if;
    if old.status <> 'scheduled' or new.status <> old.status then raise exception 'appointment cannot be rescheduled'; end if;
    expected_duration := old.ends_at - old.starts_at;
  end if;
  if not exists (select 1 from public.companies where id = new.company_id and private.company_access_valid(id,now())) then raise exception 'subscription blocked'; end if;
  if exists (select 1 from public.customers where company_id = new.company_id and id = new.customer_id and archived_at is not null)
    or exists (select 1 from public.professionals where company_id = new.company_id and id = new.professional_id and archived_at is not null) then raise exception 'record unavailable'; end if;
  select duration_minutes into duration from public.services where company_id = new.company_id and id = new.service_id and archived_at is null;
  if duration is null then raise exception 'invalid service'; end if;
  if tg_op = 'INSERT' then expected_duration := make_interval(mins => duration); end if;
  if new.starts_at is null or new.ends_at is null or not isfinite(new.starts_at) or not isfinite(new.ends_at)
    or new.starts_at < now() or new.ends_at - new.starts_at <> expected_duration then raise exception 'invalid interval'; end if;
  s := new.starts_at at time zone 'America/Sao_Paulo'; e := new.ends_at at time zone 'America/Sao_Paulo';
  sm := extract(hour from s)::integer * 60 + extract(minute from s)::integer; em := extract(hour from e)::integer * 60 + extract(minute from e)::integer;
  if s::date <> e::date or extract(second from s) <> 0 or not exists (select 1 from public.availability
    where company_id = new.company_id and professional_id = new.professional_id and weekday = extract(isodow from s) and start_minute <= sm and end_minute >= em) then raise exception 'outside business hours'; end if;
  if exists (select 1 from public.schedule_blocks where company_id = new.company_id and (professional_id is null or professional_id = new.professional_id)
    and tstzrange(starts_at, ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')) then raise exception 'schedule blocked'; end if;
  return new;
end;
$$;

-- Source: 20261022013722_company_booking_cover.sql
create or replace function private.public_catalog(slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', c.name, 'slug', c.booking_slug, 'is_demo', c.is_demo,
    'description', c.booking_description, 'address', c.booking_address, 'phone', c.booking_phone, 'theme', c.booking_theme,
    'logo_path', case when c.logo_published then c.logo_path else null end,
    'cover_path', case when c.cover_published then c.cover_path else null end,
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'duration', s.duration_minutes, 'price_cents', s.price_cents) order by s.name) from public.services s where s.company_id = c.id and s.archived_at is null), '[]'::jsonb),
    'professionals', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name) from public.professionals p where p.company_id = c.id and p.archived_at is null), '[]'::jsonb)
  ) from public.companies c where c.booking_slug = slug and c.booking_enabled
    and private.company_access_valid(c.id,now());
$$;

-- Source: 20261023011613_group_classes.sql
create or replace function private.public_slots(slug text,service uuid,professional uuid,day date)
returns table(starts_at timestamptz) language sql stable security definer set search_path='' as $$
  select ((day::timestamp+make_interval(mins=>m)) at time zone 'America/Sao_Paulo') as starts_at
  from public.companies c join public.services s on s.company_id=c.id and s.id=service and s.archived_at is null
  join public.professionals p on p.company_id=c.id and p.id=professional and p.archived_at is null
  join public.availability a on a.company_id=c.id and a.professional_id=p.id and a.weekday=extract(isodow from day)
  cross join lateral generate_series(a.start_minute,a.end_minute-s.duration_minutes,15) m
  where c.booking_slug=slug and c.booking_enabled and private.company_access_valid(c.id,now())
    and isfinite(day) and day>=(now() at time zone 'America/Sao_Paulo')::date and day<=(now() at time zone 'America/Sao_Paulo')::date+60
    and ((day::timestamp+make_interval(mins=>m)) at time zone 'America/Sao_Paulo')>now()+interval '30 minutes'
    and not exists(select 1 from public.appointments ap where ap.company_id=c.id and ap.professional_id=p.id and ap.status<>'canceled'
      and tstzrange(ap.starts_at,ap.ends_at,'[)') && tstzrange(((day::timestamp+make_interval(mins=>m)) at time zone 'America/Sao_Paulo'),((day::timestamp+make_interval(mins=>m+s.duration_minutes)) at time zone 'America/Sao_Paulo'),'[)'))
    and not exists(select 1 from public.schedule_blocks b where b.company_id=c.id and(b.professional_id is null or b.professional_id=p.id)
      and tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(((day::timestamp+make_interval(mins=>m)) at time zone 'America/Sao_Paulo'),((day::timestamp+make_interval(mins=>m+s.duration_minutes)) at time zone 'America/Sao_Paulo'),'[)'))
    and not exists(select 1 from public.class_sessions g where g.company_id=c.id and g.professional_id=p.id and g.status<>'canceled'
      and tstzrange(g.starts_at,g.ends_at,'[)') && tstzrange(((day::timestamp+make_interval(mins=>m)) at time zone 'America/Sao_Paulo'),((day::timestamp+make_interval(mins=>m+s.duration_minutes)) at time zone 'America/Sao_Paulo'),'[)'))
  order by starts_at;
$$;

-- Source: 20261021013325_business_operations.sql
create or replace function private.submit_public_booking(slug text, service uuid, professional uuid, start_time timestamptz, customer_name text, phone text, request_id uuid, gateway_secret text, ip_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c uuid; customer uuid; appointment uuid; duration integer;
begin
  if not exists (select 1 from private.booking_gateway where secret_hash = encode(sha256(convert_to(gateway_secret, 'UTF8')), 'hex')) then raise exception 'gateway unauthorized'; end if;
  if request_id is null or customer_name is null or length(customer_name) not between 2 and 120 or phone is null or phone !~ '^[0-9]{10,13}$' or ip_hash is null or ip_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid booking'; end if;
  -- Lock before the active check, idempotency lookup and slot check; no separate
  -- advisory-lock namespace can race against internal reservations or blocks.
  select id into c from public.companies where booking_slug = slug for update;
  if c is null or not exists (select 1 from public.companies where id = c and booking_enabled and private.company_access_valid(id,now())) then raise exception 'booking unavailable'; end if;
  select appointment_id into appointment from private.booking_requests br where br.company_id = c and br.request_id = submit_public_booking.request_id;
  if appointment is not null then return appointment; end if;
  if not exists (select 1 from private.public_slots(slug, service, professional, (start_time at time zone 'America/Sao_Paulo')::date) ps where ps.starts_at = start_time) then raise exception 'slot unavailable'; end if;
  perform private.limit_booking('ip:' || ip_hash, date_trunc('hour', now()), 10);
  perform private.limit_booking('phone:' || c::text || encode(sha256(convert_to(phone, 'UTF8')), 'hex'), date_trunc('day', now()), 5);
  perform private.limit_booking('company:' || c::text, date_trunc('day', now()), 200);
  select duration_minutes into duration from public.services where company_id = c and id = service and archived_at is null;
  -- Preserve existing behavior: each public request creates its own customer;
  -- an archived customer's phone never causes silent restoration or modification.
  insert into public.customers(company_id, name, phone) values(c, customer_name, phone) returning id into customer;
  insert into public.appointments(company_id, customer_id, service_id, professional_id, starts_at, ends_at)
    values(c, customer, service, professional, start_time, start_time + make_interval(mins => duration)) returning id into appointment;
  insert into private.booking_requests values(c, request_id, appointment);
  delete from private.booking_limits where bucket < now() - interval '2 days';
  return appointment;
end;
$$;

-- Source: 20261018214604_booking_experience.sql
create or replace function private.public_booking_receipt(slug text, request_id uuid, gateway_secret text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  receipt jsonb;
begin
  if not exists (
    select 1 from private.booking_gateway
    where secret_hash = encode(sha256(convert_to(gateway_secret, 'UTF8')), 'hex')
  ) then raise exception 'gateway unauthorized'; end if;
  select jsonb_build_object(
    'id', a.id, 'service_name', s.name, 'professional_name', p.name,
    'starts_at', a.starts_at, 'ends_at', a.ends_at, 'status', a.status
  ) into receipt
  from public.companies c
  join private.booking_requests br on br.company_id = c.id and br.request_id = public_booking_receipt.request_id
  join public.appointments a on a.company_id = c.id and a.id = br.appointment_id
  join public.services s on s.company_id = c.id and s.id = a.service_id
  join public.professionals p on p.company_id = c.id and p.id = a.professional_id
  where c.booking_slug = slug and c.booking_enabled
    and private.company_access_valid(c.id,now());
  return receipt;
end;
$$;

-- Source: 20261019022843_company_personalization.sql
create or replace function private.is_public_company_logo(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.companies c
    where c.id = private.logo_company(object_name) and c.logo_path = object_name
      and c.logo_published and c.booking_enabled
      and private.company_access_valid(c.id,now()));
$$;

-- Source: 20261021205059_whatsapp_reminders.sql
create or replace function private.public_booking_whatsapp_consent(p_slug text,p_request_id uuid,p_gateway_secret text,p_allowed boolean) returns boolean language plpgsql security definer set search_path = '' as $$
declare c uuid; customer uuid; v_phone text;
begin
  if p_gateway_secret is null or length(p_gateway_secret) not between 32 and 1024 or not exists(select 1 from private.booking_gateway where secret_hash=encode(sha256(convert_to(p_gateway_secret,'UTF8')),'hex')) then raise exception 'gateway unauthorized'; end if;
  if p_allowed is distinct from true then return false; end if;
  select id into c from public.companies where booking_slug=p_slug and booking_enabled and private.company_access_valid(id,now()) for update;
  if c is null then return false; end if;
  select a.customer_id,private.whatsapp_phone(cu.phone) into customer,v_phone
    from private.booking_requests br join public.appointments a on a.id=br.appointment_id and a.company_id=br.company_id
    join public.customers cu on cu.id=a.customer_id and cu.company_id=a.company_id
    where br.company_id=c and br.request_id=p_request_id and a.status='scheduled' and a.starts_at>now() and cu.archived_at is null;
  if customer is null or v_phone is null then return false; end if;
  -- A retry can never silently re-enable a later opt-out.
  insert into public.whatsapp_consents(company_id,customer_id,phone,source) values(c,customer,v_phone,'booking') on conflict(company_id,customer_id) do nothing;
  return exists(select 1 from public.whatsapp_consents wc where wc.company_id=c and wc.customer_id=customer and wc.phone=v_phone and wc.revoked_at is null);
end;
$$;

-- Source: 20261021205059_whatsapp_reminders.sql
create or replace function private.claim_whatsapp_reminders(p_secret text,p_companies uuid[],p_batch integer default 25) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c uuid; item record; job uuid; result jsonb := '[]'::jsonb; stamp timestamptz := clock_timestamp();
begin
  perform private.check_whatsapp_gateway(p_secret);
  if p_companies is null or cardinality(p_companies) not between 1 and 100 or p_batch is null or p_batch not between 1 and 100 then raise exception 'invalid whatsapp batch'; end if;
  -- All worker and tenant mutations lock the company first, then job rows.
  for c in select co.id from public.companies co where co.id=any(p_companies) order by co.id for update skip locked loop
    update public.whatsapp_reminders set status='unknown',error_code='worker_interrupted',updated_at=stamp
      where company_id=c and status='sending' and updated_at<stamp-interval '15 minutes';
    update public.whatsapp_reminders set status='canceled',error_code='not_eligible',updated_at=stamp
      where company_id=c and status='claimed' and created_at<stamp-interval '15 minutes';
    for item in
      select a.id,a.starts_at,a.customer_id,co.name,cu.name customer_name,wc.phone,wc.opted_in_at,o.offset_minutes
      from public.companies co join public.whatsapp_settings ws on ws.company_id=co.id and ws.enabled
      join public.appointments a on a.company_id=co.id and a.status='scheduled' and a.starts_at>stamp
      join public.customers cu on cu.company_id=co.id and cu.id=a.customer_id and cu.archived_at is null
      join public.services s on s.company_id=co.id and s.id=a.service_id and s.archived_at is null
      join public.professionals pr on pr.company_id=co.id and pr.id=a.professional_id and pr.archived_at is null
      join public.whatsapp_consents wc on wc.company_id=co.id and wc.customer_id=cu.id and wc.revoked_at is null and wc.phone=private.whatsapp_phone(cu.phone)
      cross join lateral unnest(ws.offsets_minutes) o(offset_minutes)
      where co.id=c and private.company_access_valid(co.id,stamp)
        and a.starts_at-make_interval(mins=>o.offset_minutes) between stamp-interval '15 minutes' and stamp
        and not exists(select 1 from public.whatsapp_reminders r where r.appointment_id=a.id and r.starts_at=a.starts_at and r.offset_minutes=o.offset_minutes)
      order by a.starts_at,a.id,o.offset_minutes desc limit p_batch-jsonb_array_length(result)
    loop
      insert into public.whatsapp_reminders(company_id,appointment_id,starts_at,offset_minutes) values(c,item.id,item.starts_at,item.offset_minutes) returning id into job;
      insert into private.whatsapp_payloads(job_id,customer_id,recipient,consent_at) values(job,item.customer_id,item.phone,item.opted_in_at);
      result := result || jsonb_build_array(private.whatsapp_job_data(job));
    end loop;
    exit when jsonb_array_length(result)>=p_batch;
  end loop;
  return result;
end;
$$;

-- Source: 20261022013657_staff_whatsapp_notifications.sql
create or replace function private.prepare_whatsapp_reminder(p_secret text,p_job uuid,p_token_hash text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c uuid; r public.whatsapp_reminders%rowtype; cap integer; used bigint; stamp timestamptz := clock_timestamp(); month_start timestamptz;
begin
  perform private.check_whatsapp_gateway(p_secret);
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid whatsapp token'; end if;
  select company_id into c from public.whatsapp_reminders where id=p_job;
  if c is null then return null; end if;
  perform 1 from public.companies where id=c for update;
  select * into r from public.whatsapp_reminders where id=p_job for update;
  if r.status<>'claimed' then return null; end if;
  if not exists (
    select 1 from public.appointments a join public.companies co on co.id=a.company_id
    join public.whatsapp_settings ws on ws.company_id=co.id and ws.enabled and r.offset_minutes=any(ws.offsets_minutes)
    join private.whatsapp_payloads wp on wp.job_id=r.id and wp.customer_id=a.customer_id
    join public.customers cu on cu.company_id=co.id and cu.id=a.customer_id and cu.archived_at is null and private.whatsapp_phone(cu.phone)=wp.recipient
    join public.services s on s.company_id=co.id and s.id=a.service_id and s.archived_at is null
    join public.professionals pr on pr.company_id=co.id and pr.id=a.professional_id and pr.archived_at is null
    join public.whatsapp_consents wc on wc.company_id=co.id and wc.customer_id=a.customer_id and wc.revoked_at is null and wc.phone=wp.recipient and wc.opted_in_at=wp.consent_at
    where a.id=r.appointment_id and a.company_id=c and a.status='scheduled' and a.starts_at=r.starts_at and a.starts_at>stamp
      and private.company_access_valid(co.id,stamp)
      and r.starts_at-make_interval(mins=>r.offset_minutes) between stamp-interval '15 minutes' and stamp
  ) then
    update public.whatsapp_reminders set status='canceled',error_code='not_eligible',updated_at=stamp where id=p_job;
    return null;
  end if;
  month_start := date_trunc('month',stamp at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  select least(monthly_limit,platform_limit) into cap from public.whatsapp_settings where company_id=c;
  used := private.whatsapp_consumed(c,stamp);
  if used>=coalesce(cap,0) then
    update public.whatsapp_reminders set status='limit_reached',error_code='limit_reached',updated_at=stamp where id=p_job;
    return null;
  end if;
  -- Reservation never refunds on timeout or ambiguous provider result; no duplicate retry.
  update public.whatsapp_reminders set status='sending',consumed_at=stamp,updated_at=stamp where id=p_job;
  update private.whatsapp_payloads set token_hash=p_token_hash,token_expires_at=r.starts_at where job_id=p_job;
  return private.whatsapp_job_data(p_job);
end;
$$;

-- Source: 20261021205059_whatsapp_reminders.sql
create or replace function private.whatsapp_confirmation(p_secret text,p_token_hash text,p_action text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c uuid; r public.whatsapp_reminders%rowtype; p private.whatsapp_payloads%rowtype; a public.appointments%rowtype; opted_out boolean; confirmed boolean;
begin
  perform private.check_whatsapp_gateway(p_secret);
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_action is null or p_action not in ('view','confirm','optout') then return null; end if;
  select r0.company_id into c from private.whatsapp_payloads p0 join public.whatsapp_reminders r0 on r0.id=p0.job_id where p0.token_hash=p_token_hash;
  if c is null then return null; end if;
  perform 1 from public.companies where id=c for update;
  select * into p from private.whatsapp_payloads where token_hash=p_token_hash;
  select * into r from public.whatsapp_reminders where id=p.job_id;
  if r.consumed_at is null then return null; end if;
  if p_action='optout' then
    if r.consumed_at<now()-interval '30 days' then return null; end if;
    perform private.whatsapp_opt_out(p_secret,c,p.recipient);
    return jsonb_build_object('company_name',(select name from public.companies where id=c),'starts_at',r.starts_at,'confirmed',false,'opted_out',true);
  end if;
  select * into a from public.appointments where id=r.appointment_id and company_id=c;
  if not found or a.customer_id<>p.customer_id or a.status<>'scheduled' or a.starts_at<>r.starts_at or a.starts_at<=now() or p.token_expires_at is null or p.token_expires_at<=now()
    or not exists(select 1 from public.customers where id=p.customer_id and company_id=c and archived_at is null and private.whatsapp_phone(phone)=p.recipient)
    or not exists(select 1 from public.companies where id=c and private.company_access_valid(id,now())) then return null; end if;
  if p_action='confirm' and a.attendance_confirmed_at is null then
    update public.appointments set attendance_confirmed_at=clock_timestamp() where id=a.id;
    a.attendance_confirmed_at := clock_timestamp();
  end if;
  opted_out := not exists(select 1 from public.whatsapp_consents where company_id=c and customer_id=p.customer_id and phone=p.recipient and revoked_at is null);
  confirmed := a.attendance_confirmed_at is not null;
  return jsonb_build_object('company_name',(select name from public.companies where id=c),'starts_at',a.starts_at,'confirmed',confirmed,'opted_out',opted_out);
end;
$$;

-- Source: 20261022013657_staff_whatsapp_notifications.sql
create or replace function private.queue_whatsapp_staff_new_appointment() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient record; job uuid;
begin
  if new.status<>'scheduled' or new.starts_at<=clock_timestamp() then return new; end if;
  perform 1 from public.companies where id=new.company_id for update;
  select pr.user_id,wp.phone,wp.opted_in_at into recipient
    from public.companies c join public.whatsapp_settings ws on ws.company_id=c.id and ws.staff_new_appointment_enabled
    join public.professionals pr on pr.company_id=c.id and pr.id=new.professional_id and pr.archived_at is null
    join public.memberships m on m.company_id=c.id and m.user_id=pr.user_id
    join private.whatsapp_staff_preferences wp on wp.company_id=c.id and wp.user_id=pr.user_id and wp.revoked_at is null
    where c.id=new.company_id and private.company_access_valid(c.id,clock_timestamp());
  if not found then return new; end if;
  insert into public.whatsapp_staff_notifications(company_id,professional_id,kind,local_date,appointment_id,starts_at)
    values(new.company_id,new.professional_id,'new_appointment',(new.starts_at at time zone 'America/Sao_Paulo')::date,new.id,new.starts_at)
    on conflict do nothing returning id into job;
  if job is not null then
    insert into private.whatsapp_staff_payloads(job_id,user_id,recipient,consent_at) values(job,recipient.user_id,recipient.phone,recipient.opted_in_at);
    insert into private.whatsapp_staff_items values(job,new.id,new.starts_at,new.customer_id,new.service_id);
  end if;
  return new;
end; $$;

-- Source: 20261022013657_staff_whatsapp_notifications.sql
create or replace function private.claim_whatsapp_staff_notifications(p_secret text,p_companies uuid[],p_batch integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c uuid; person record; entry record; part integer; total integer; job uuid; item_ids uuid[]; payload jsonb; result jsonb:='[]'::jsonb; stamp timestamptz:=clock_timestamp(); day date:=(clock_timestamp() at time zone 'America/Sao_Paulo')::date;
begin
  perform private.check_whatsapp_gateway(p_secret);
  if p_companies is null or cardinality(p_companies) not between 1 and 100 or p_batch is null or p_batch not between 1 and 100 then raise exception 'invalid whatsapp batch'; end if;
  for c in select co.id from public.companies co where co.id=any(p_companies) order by co.id for update skip locked loop
    update public.whatsapp_staff_notifications set status='unknown',error_code='worker_interrupted',updated_at=stamp where company_id=c and status='sending' and updated_at<stamp-interval '15 minutes';
    update public.whatsapp_staff_notifications set status='canceled',error_code='not_eligible',updated_at=stamp where company_id=c and
      ((status='claimed' and updated_at<stamp-interval '15 minutes') or (status='queued' and ((kind='new_appointment' and (created_at<stamp-interval '24 hours' or starts_at<=stamp)) or (kind='daily' and local_date<>day))));
    for person in
      select pr.id,pr.user_id,wp.phone,wp.opted_in_at from public.companies co
      join public.whatsapp_settings ws on ws.company_id=co.id and ws.staff_daily_enabled
      join public.professionals pr on pr.company_id=co.id and pr.archived_at is null
      join public.memberships m on m.company_id=co.id and m.user_id=pr.user_id
      join private.whatsapp_staff_preferences wp on wp.company_id=co.id and wp.user_id=pr.user_id and wp.revoked_at is null
      where co.id=c and private.company_access_valid(co.id,stamp)
        and stamp between ((day+ws.staff_daily_time) at time zone 'America/Sao_Paulo') and ((day+ws.staff_daily_time) at time zone 'America/Sao_Paulo')+interval '60 minutes'
        and not exists(select 1 from private.whatsapp_staff_daily_runs n where n.company_id=c and n.professional_id=pr.id and n.local_date=day)
      order by pr.id
    loop
      insert into private.whatsapp_staff_daily_runs(company_id,professional_id,local_date) values(c,person.id,day);
      select array_agg(a.id order by a.starts_at,a.id) into item_ids from public.appointments a
        join public.customers cu on cu.company_id=c and cu.id=a.customer_id and cu.archived_at is null
        join public.services s on s.company_id=c and s.id=a.service_id and s.archived_at is null
        where a.company_id=c and a.professional_id=person.id and a.status='scheduled'
          and a.starts_at>=(day::timestamp at time zone 'America/Sao_Paulo') and a.starts_at<((day+1)::timestamp at time zone 'America/Sao_Paulo');
      total:=coalesce((cardinality(item_ids)+1)/2,0);
      -- Every appointment is materialized, even when a small worker batch only
      -- claims the first page. Each page has a separate quota and receipt.
      for part in 1..total loop
        insert into public.whatsapp_staff_notifications(company_id,professional_id,kind,local_date,part_index,part_count)
          values(c,person.id,'daily',day,part,total) returning id into job;
        insert into private.whatsapp_staff_payloads(job_id,user_id,recipient,consent_at) values(job,person.user_id,person.phone,person.opted_in_at);
        insert into private.whatsapp_staff_items select job,a.id,a.starts_at,a.customer_id,a.service_id from public.appointments a where a.id=any(item_ids[(part*2-1):(part*2)]) and a.company_id=c;
      end loop;
    end loop;
    for entry in select n.id from public.whatsapp_staff_notifications n where n.company_id=c and n.status='queued'
      order by n.created_at,n.id for update skip locked loop
      payload:=private.whatsapp_staff_job_data(entry.id);
      if jsonb_array_length(payload->'appointments')=0 then
        update public.whatsapp_staff_notifications set status='canceled',error_code='not_eligible',updated_at=stamp where id=entry.id;
        continue;
      end if;
      update public.whatsapp_staff_notifications set status='claimed',updated_at=stamp where id=entry.id;
      result:=result||jsonb_build_array(payload);
      exit when jsonb_array_length(result)>=p_batch;
    end loop;
    exit when jsonb_array_length(result)>=p_batch;
  end loop;
  return result;
end; $$;

-- Source: 20261022013657_staff_whatsapp_notifications.sql
create or replace function private.prepare_whatsapp_staff_notification(p_secret text,p_job uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c uuid; n public.whatsapp_staff_notifications%rowtype; result jsonb; cap integer; stamp timestamptz:=clock_timestamp();
begin
  perform private.check_whatsapp_gateway(p_secret);
  select company_id into c from public.whatsapp_staff_notifications where id=p_job;
  if c is null then return null; end if;
  perform 1 from public.companies where id=c for update;
  select * into n from public.whatsapp_staff_notifications where id=p_job for update;
  if n.status<>'claimed' then return null; end if;
  result:=private.whatsapp_staff_job_data(p_job);
  if jsonb_array_length(result->'appointments')=0 or not exists(
    select 1 from public.companies co join public.whatsapp_settings ws on ws.company_id=co.id
    join public.professionals pr on pr.company_id=co.id and pr.id=n.professional_id and pr.archived_at is null
    join public.memberships m on m.company_id=co.id and m.user_id=pr.user_id
    join private.whatsapp_staff_payloads p on p.job_id=n.id and p.user_id=pr.user_id
    join private.whatsapp_staff_preferences wp on wp.company_id=co.id and wp.user_id=pr.user_id and wp.revoked_at is null and wp.phone=p.recipient and wp.opted_in_at=p.consent_at
    where co.id=c and private.company_access_valid(co.id,stamp)
      and n.updated_at>=stamp-interval '15 minutes'
      and ((n.kind='daily' and ws.staff_daily_enabled and n.local_date=(stamp at time zone 'America/Sao_Paulo')::date
        and stamp between ((n.local_date+ws.staff_daily_time) at time zone 'America/Sao_Paulo') and ((n.local_date+ws.staff_daily_time) at time zone 'America/Sao_Paulo')+interval '60 minutes')
        or (n.kind='new_appointment' and ws.staff_new_appointment_enabled and n.created_at>=stamp-interval '24 hours' and n.starts_at>stamp))
  ) then
    update public.whatsapp_staff_notifications set status='canceled',error_code='not_eligible',updated_at=stamp where id=p_job;
    return null;
  end if;
  select least(monthly_limit,platform_limit) into cap from public.whatsapp_settings where company_id=c;
  if private.whatsapp_consumed(c,stamp)>=coalesce(cap,0) then
    update public.whatsapp_staff_notifications set status='limit_reached',error_code='limit_reached',updated_at=stamp where id=p_job;
    return null;
  end if;
  update public.whatsapp_staff_notifications set status='sending',consumed_at=stamp,updated_at=stamp where id=p_job;
  return result;
end; $$;

-- Source: 20261022013722_company_booking_cover.sql
create or replace function private.is_public_company_cover(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.companies c
    where c.id = private.cover_company(object_name) and c.cover_path = object_name
      and c.cover_published and c.booking_enabled
      and private.company_access_valid(c.id,now()));
$$;

-- Source: 20261022023757_admin_operations.sql
create or replace function private.admin_operations_summary() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare companies jsonb; sales jsonb; support jsonb; tasks jsonb; last_run jsonb; last_scheduled_run jsonb;
  stamp timestamptz := clock_timestamp(); trial_hours integer; support_hours integer;
begin
  perform private.lock_sales_admin();
  select threshold_hours into trial_hours from public.platform_automation_rules where id='trial_ending';
  select threshold_hours into support_hours from public.platform_automation_rules where id='support_waiting';
  select jsonb_build_object(
    'total',count(*) filter(where not is_demo),'demo',count(*) filter(where is_demo),
    'pending_card',count(*) filter(where not is_demo and status='pending_card'),
    'trialing',count(*) filter(where not is_demo and status='trialing' and trial_ends_at>stamp),
    'active',count(*) filter(where not is_demo and status='active' and private.company_access_valid(id,stamp)),
    'expiring',count(*) filter(where not is_demo and status='trialing' and trial_ends_at>stamp and trial_ends_at<=stamp+make_interval(hours=>trial_hours)),
    'expired',count(*) filter(where not is_demo and status='trialing' and trial_ends_at<=stamp),
    'suspended',count(*) filter(where not is_demo and status='suspended'),
    'canceled',count(*) filter(where not is_demo and status='canceled')) into companies from public.companies;
  select jsonb_build_object('open',count(*) filter(where stage not in ('won','lost')),
    'overdue',count(*) filter(where stage not in ('won','lost') and next_contact_at<stamp),
    'new',count(*) filter(where stage='new')) into sales from public.sales_leads;
  select jsonb_build_object('open',count(*) filter(where t.status in ('open','in_progress')),
    'waiting',count(*) filter(where t.status in ('open','in_progress') and t.updated_at<=stamp-make_interval(hours=>support_hours)))
    into support from public.support_tickets t join public.companies c on c.id=t.company_id and not c.is_demo;
  select jsonb_build_object('open',count(*) filter(where status='open'),'done',count(*) filter(where status='done')) into tasks from public.platform_tasks;
  select to_jsonb(r) into last_run from public.platform_automation_runs r order by started_at desc,id limit 1;
  select to_jsonb(r) into last_scheduled_run from public.platform_automation_runs r where trigger='scheduled' order by started_at desc,id limit 1;
  return jsonb_build_object('companies',companies,'sales',sales,'support',support,'tasks',tasks,'last_run',last_run,'last_scheduled_run',last_scheduled_run);
end;
$$;

-- Source: 20261023011613_group_classes.sql
create or replace function private.public_classes(p_slug text,p_day date) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'starts_at',s.starts_at,'ends_at',s.ends_at,'capacity',s.capacity,
    'remaining',greatest(0,s.capacity-(select count(*) from public.class_registrations r where r.company_id=s.company_id and r.class_session_id=s.id and r.status<>'canceled')),
    'service',jsonb_build_object('id',v.id,'name',v.name,'duration',extract(epoch from(s.ends_at-s.starts_at))::integer/60,'price_cents',v.price_cents),
    'professional',jsonb_build_object('id',p.id,'name',p.name)) order by s.starts_at,s.id),'[]'::jsonb)
  from public.class_sessions s join public.companies c on c.id=s.company_id
  join public.services v on v.company_id=c.id and v.id=s.service_id and v.archived_at is null
  join public.professionals p on p.company_id=c.id and p.id=s.professional_id and p.archived_at is null
  where c.booking_slug=p_slug and c.booking_enabled and private.company_access_valid(c.id,now())
    and s.is_public and s.status='scheduled' and s.starts_at>now()+interval '30 minutes'
    and isfinite(p_day) and p_day between (now() at time zone 'America/Sao_Paulo')::date and (now() at time zone 'America/Sao_Paulo')::date+60
    and s.starts_at>=(p_day::timestamp at time zone 'America/Sao_Paulo') and s.starts_at<((p_day+1)::timestamp at time zone 'America/Sao_Paulo');
$$;

-- Source: 20261023011613_group_classes.sql
create or replace function private.submit_public_class_booking(p_slug text,p_session uuid,p_customer_name text,p_phone text,p_request_id uuid,p_gateway_secret text,p_ip_hash text) returns uuid
language plpgsql security definer set search_path='' as $$
declare c uuid; s public.class_sessions%rowtype; previous private.class_booking_requests%rowtype; fingerprint text; customer uuid; result uuid;
begin
  if not exists(select 1 from private.booking_gateway where secret_hash=encode(sha256(convert_to(p_gateway_secret,'UTF8')),'hex')) then raise exception 'gateway unauthorized'; end if;
  if p_request_id is null or p_session is null or p_customer_name is null or length(trim(p_customer_name)) not between 2 and 120
    or p_phone is null or p_phone !~ '^[0-9]{10,13}$' or p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid registration'; end if;
  select id into c from public.companies where booking_slug=p_slug for update;
  if c is null or not exists(select 1 from public.companies where id=c and booking_enabled and private.company_access_valid(id,now())) then raise exception 'class unavailable'; end if;
  fingerprint:=encode(sha256(convert_to(jsonb_build_array(p_session,trim(p_customer_name),p_phone)::text,'UTF8')),'hex');
  select * into previous from private.class_booking_requests where company_id=c and request_id=p_request_id;
  if found then
    if previous.fingerprint<>fingerprint then raise exception 'registration idempotency conflict'; end if;
    return previous.registration_id;
  end if;
  select * into s from public.class_sessions where company_id=c and id=p_session for update;
  if not found or not s.is_public or s.status<>'scheduled' or s.starts_at<=now()+interval '30 minutes'
    or (s.starts_at at time zone 'America/Sao_Paulo')::date>(now() at time zone 'America/Sao_Paulo')::date+60
    or not exists(select 1 from public.services where company_id=c and id=s.service_id and archived_at is null)
    or not exists(select 1 from public.professionals where company_id=c and id=s.professional_id and archived_at is null) then raise exception 'class unavailable'; end if;
  if (select count(*) from public.class_registrations where company_id=c and class_session_id=p_session and status<>'canceled')>=s.capacity then raise exception 'class full'; end if;
  if exists(select 1 from public.class_registrations r join public.customers u on u.company_id=r.company_id and u.id=r.customer_id
    where r.company_id=c and r.class_session_id=p_session and r.status<>'canceled' and regexp_replace(u.phone,'[^0-9]','','g')=p_phone) then raise exception 'already reserved'; end if;
  -- Share the existing public-booking quotas so classes cannot bypass them.
  perform private.limit_booking('ip:'||p_ip_hash,date_trunc('hour',now()),10);
  perform private.limit_booking('phone:'||c::text||encode(sha256(convert_to(p_phone,'UTF8')),'hex'),date_trunc('day',now()),5);
  perform private.limit_booking('company:'||c::text,date_trunc('day',now()),200);
  insert into public.customers(company_id,name,phone) values(c,trim(p_customer_name),p_phone) returning id into customer;
  insert into public.class_registrations(company_id,class_session_id,customer_id,request_id) values(c,p_session,customer,p_request_id) returning id into result;
  insert into private.class_booking_requests values(c,p_request_id,result,fingerprint);
  delete from private.booking_limits where bucket<now()-interval '2 days';
  return result;
end;
$$;

-- Source: 20261023011613_group_classes.sql
create or replace function private.public_class_booking_receipt(p_slug text,p_request_id uuid,p_gateway_secret text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from private.booking_gateway where secret_hash=encode(sha256(convert_to(p_gateway_secret,'UTF8')),'hex')) then raise exception 'gateway unauthorized'; end if;
  return (select jsonb_build_object('registration_id',r.id,'class_id',s.id,'title',s.title,'starts_at',s.starts_at,'ends_at',s.ends_at,
    'status',r.status,'class_status',s.status,'service_name',v.name,'professional_name',p.name,'company_name',c.name)
    from private.class_booking_requests q join public.companies c on c.id=q.company_id
    join public.class_registrations r on r.company_id=c.id and r.id=q.registration_id
    join public.class_sessions s on s.company_id=c.id and s.id=r.class_session_id
    join public.services v on v.company_id=c.id and v.id=s.service_id
    join public.professionals p on p.company_id=c.id and p.id=s.professional_id
    where c.booking_slug=p_slug and q.request_id=p_request_id and c.booking_enabled
      and private.company_access_valid(c.id,now()));
end;
$$;

-- Source: 20261023011626_admin_company_diagnostics.sql
create or replace function private.admin_company_diagnostics(p_company uuid) returns jsonb
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
    'access',jsonb_build_object('writable',private.company_access_valid(c.id),'reason',reason),
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
