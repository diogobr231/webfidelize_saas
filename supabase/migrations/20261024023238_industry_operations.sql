-- Typed, company-scoped operational records for supported business niches.
-- Clinical records are intentionally excluded.
create table public.industry_operations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  related_operation_id uuid,
  kind text not null check (kind in (
    'restaurant_table','restaurant_order','restaurant_cash',
    'supplier_order','delivery','logistics_driver','logistics_route','logistics_delivery',
    'pet_profile','pet_visit','pet_stock',
    'office_task','office_document','office_process',
    'salon_commission','salon_cash','salon_stock',
    'academy_training','academy_attendance','academy_membership'
  )),
  name text not null check (length(trim(name)) between 2 and 120),
  details text not null default '' check (length(details) <= 1200),
  status text not null check (length(status) between 2 and 24),
  reference text not null default '' check (length(reference) <= 120),
  phone text not null default '' check (phone = '' or phone ~ '^[0-9]{10,13}$'),
  quantity integer check (quantity is null or quantity between 0 and 1000000),
  unit text not null default '' check (length(unit) <= 24),
  amount_cents integer check (amount_cents is null or amount_cents between 0 and 10000000),
  due_at timestamptz,
  location_url text not null default '' check (length(location_url) <= 500),
  record_version integer not null default 1 check (record_version > 0),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, related_operation_id) references public.industry_operations(company_id,id),
  check (
    location_url = '' or location_url ~ '^https://[A-Za-z0-9.-]+([/?#][^[:space:]]*)?$'
  )
);
create index industry_operations_company_kind_created_idx
  on public.industry_operations(company_id, kind, created_at desc, id desc);
create index industry_operations_company_due_idx
  on public.industry_operations(company_id, due_at)
  where due_at is not null;
create unique index industry_operation_table_name_unique
  on public.industry_operations(company_id,lower(name)) where kind='restaurant_table';
create unique index industry_active_order_per_table_unique
  on public.industry_operations(company_id,related_operation_id)
  where kind='restaurant_order' and status in ('open','preparing','ready','served') and related_operation_id is not null;
create unique index industry_active_route_per_driver_unique
  on public.industry_operations(company_id,related_operation_id)
  where kind='logistics_route' and status in ('planned','in_progress') and related_operation_id is not null;
alter table public.industry_operations enable row level security;
revoke all on public.industry_operations from anon, authenticated;
grant select on public.industry_operations to authenticated;
create policy industry_operations_managed_read on public.industry_operations
  for select to authenticated
  using (private.member_role(company_id) in ('OWNER','MANAGER'));

create table public.industry_stock_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  operation_id uuid not null,
  delta integer not null check (delta between -1000000 and 1000000 and delta <> 0),
  reason text not null check (length(trim(reason)) between 2 and 160),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (company_id, operation_id) references public.industry_operations(company_id,id) on delete cascade
);
create index industry_stock_movement_history_idx
  on public.industry_stock_movements(company_id,operation_id,created_at desc,id desc);
alter table public.industry_stock_movements enable row level security;
revoke all on public.industry_stock_movements from anon, authenticated;
grant select on public.industry_stock_movements to authenticated;
create policy industry_stock_movements_managed_read on public.industry_stock_movements
  for select to authenticated
  using (private.member_role(company_id) in ('OWNER','MANAGER'));

create function private.create_industry_operation(
  p_company uuid, p_kind text, p_name text, p_details text, p_status text,
  p_reference text, p_phone text, p_quantity integer, p_unit text,
  p_amount_cents integer, p_due_at timestamptz, p_location_url text,
  p_related_operation_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare n text; result uuid; required_status text; allowed boolean := false; reference_value text; related public.industry_operations%rowtype;
begin
  perform private.lock_business_company(p_company);
  select niche into n from public.companies where id = p_company;
  allowed := case p_kind
    when 'restaurant_table' then n = 'restaurante'
    when 'restaurant_order' then n = 'restaurante'
    when 'restaurant_cash' then n = 'restaurante'
    when 'supplier_order' then n = 'fornecedores'
    when 'delivery' then n = 'fornecedores'
    when 'logistics_driver' then n = 'logistica'
    when 'logistics_route' then n = 'logistica'
    when 'logistics_delivery' then n = 'logistica'
    when 'pet_profile' then n = 'pet-shop'
    when 'pet_visit' then n = 'pet-shop'
    when 'pet_stock' then n = 'pet-shop'
    when 'office_task' then n = 'escritorio'
    when 'office_document' then n = 'escritorio'
    when 'office_process' then n = 'escritorio'
    when 'salon_commission' then n = 'salao'
    when 'salon_cash' then n = 'salao'
    when 'salon_stock' then n = 'salao'
    when 'academy_training' then n = 'academia'
    when 'academy_attendance' then n = 'academia'
    when 'academy_membership' then n = 'academia'
    else false end;
  if not allowed then raise exception 'operation kind unavailable'; end if;
  required_status := case p_kind
    when 'restaurant_table' then 'available'
    when 'restaurant_order' then 'open'
    when 'restaurant_cash' then 'recorded'
    when 'supplier_order' then 'requested'
    when 'delivery' then 'pending'
    when 'logistics_driver' then 'available'
    when 'logistics_route' then 'planned'
    when 'logistics_delivery' then 'pending'
    when 'pet_profile' then 'active'
    when 'pet_visit' then 'scheduled'
    when 'pet_stock' then 'active'
    when 'office_task' then 'open'
    when 'office_document' then 'active'
    when 'office_process' then 'open'
    when 'salon_commission' then 'pending'
    when 'salon_cash' then 'recorded'
    when 'salon_stock' then 'active'
    when 'academy_training' then 'active'
    when 'academy_attendance' then 'scheduled'
    when 'academy_membership' then 'active'
  end;
  if p_status is distinct from required_status then raise exception 'invalid initial status'; end if;
  if p_name is null or length(trim(p_name)) not between 2 and 120
     or p_details is null or length(p_details) > 1200
     or p_reference is null or length(p_reference) > 120
     or p_phone is null or (p_phone <> '' and p_phone !~ '^[0-9]{10,13}$')
     or p_unit is null or length(p_unit) > 24
     or (p_quantity is not null and p_quantity not between 0 and 1000000)
     or (p_amount_cents is not null and p_amount_cents not between 0 and 10000000)
     or p_location_url is null or length(p_location_url) > 500 then
    raise exception 'invalid operation fields';
  end if;
  if p_kind in ('restaurant_table') and (p_quantity is null or p_quantity not between 1 and 50) then raise exception 'invalid table capacity'; end if;
  if p_kind in ('pet_stock','salon_stock') and (p_quantity is null or p_unit = '') then raise exception 'stock quantity required'; end if;
  if p_kind in ('supplier_order','logistics_driver','pet_profile','office_task','office_document','office_process','salon_commission','salon_cash','academy_training','academy_attendance','academy_membership') and p_reference = '' then raise exception 'reference required'; end if;
  if p_kind in ('restaurant_cash','salon_cash','salon_commission') and (p_amount_cents is null or p_amount_cents < 1) then raise exception 'amount required'; end if;
  if p_kind in ('restaurant_cash','salon_cash') and lower(trim(p_reference)) not in ('entrada','saida') then raise exception 'invalid cash direction'; end if;
  if p_kind in ('delivery','logistics_delivery') and p_reference = '' then raise exception 'recipient required'; end if;
  if p_kind in ('delivery','logistics_delivery','logistics_route') and p_location_url <> ''
     and p_location_url !~ '^https://(maps\.app\.goo\.gl/[^[:space:]]+|maps\.google\.com/[^[:space:]]*|www\.google\.com/maps([/?#][^[:space:]]*)?)$' then raise exception 'invalid Maps link'; end if;
  if p_kind = 'office_document' and p_location_url <> '' and p_location_url !~ '^https://[A-Za-z0-9.-]+([/?#][^[:space:]]*)?$' then raise exception 'invalid document link'; end if;
  if p_kind in ('delivery','logistics_delivery','logistics_driver') and p_phone = '' then raise exception 'phone required'; end if;
  if p_kind in ('restaurant_order','supplier_order','delivery','logistics_route','logistics_delivery','office_task','office_process','academy_attendance','academy_membership') and p_due_at is null then raise exception 'date required'; end if;
  if p_quantity is not null and p_kind not in ('restaurant_table','pet_stock','salon_stock') then raise exception 'quantity not allowed'; end if;
  if p_unit <> '' and p_kind not in ('pet_stock','salon_stock') then raise exception 'unit not allowed'; end if;
  if p_amount_cents is not null and p_kind not in ('restaurant_order','restaurant_cash','supplier_order','salon_commission','salon_cash') then raise exception 'amount not allowed'; end if;
  if p_due_at is not null and p_kind not in ('restaurant_order','supplier_order','delivery','logistics_route','logistics_delivery','office_task','office_process','academy_attendance','academy_membership') then raise exception 'date not allowed'; end if;
  if p_phone <> '' and p_kind not in ('delivery','logistics_delivery','logistics_driver','pet_profile') then raise exception 'phone not allowed'; end if;
  if p_location_url <> '' and p_kind not in ('delivery','logistics_route','logistics_delivery','office_document') then raise exception 'link not allowed'; end if;
  if p_kind in ('restaurant_order','logistics_route','pet_visit') and p_related_operation_id is null then raise exception 'related record required'; end if;
  if p_related_operation_id is not null then
    select * into related from public.industry_operations where company_id=p_company and id=p_related_operation_id for update;
    if not found then raise exception 'related record unavailable'; end if;
    if (p_kind='restaurant_order' and (related.kind<>'restaurant_table' or related.status not in ('available','reserved')))
       or (p_kind='logistics_route' and (related.kind<>'logistics_driver' or related.status<>'available'))
       or (p_kind='logistics_delivery' and (related.kind<>'logistics_route' or related.status not in ('planned','in_progress')))
       or (p_kind='pet_visit' and (related.kind<>'pet_profile' or related.status<>'active'))
       or p_kind not in ('restaurant_order','logistics_route','logistics_delivery','pet_visit') then
      raise exception 'related record unavailable';
    end if;
  end if;
  reference_value := trim(p_reference);
  if p_kind in ('restaurant_order','logistics_route','pet_visit') then reference_value := related.name; end if;
  if p_kind in ('restaurant_cash','salon_cash') then reference_value := lower(reference_value); end if;
  insert into public.industry_operations(
    company_id,kind,name,details,status,reference,phone,quantity,unit,amount_cents,due_at,location_url,related_operation_id
  ) values (
    p_company,p_kind,trim(p_name),trim(p_details),p_status,reference_value,p_phone,
    p_quantity,trim(p_unit),p_amount_cents,p_due_at,trim(p_location_url),p_related_operation_id
  ) returning id into result;
  if p_kind='restaurant_order' then
    update public.industry_operations set status='occupied',record_version=record_version+1,updated_at=now()
      where company_id=p_company and id=p_related_operation_id;
  elsif p_kind='logistics_route' then
    update public.industry_operations set status='on_route',record_version=record_version+1,updated_at=now()
      where company_id=p_company and id=p_related_operation_id;
  end if;
  if p_kind in ('pet_stock','salon_stock') and p_quantity > 0 then
    insert into public.industry_stock_movements(company_id,operation_id,delta,reason)
      values(p_company,result,p_quantity,'Estoque inicial');
  end if;
  return result;
end;
$$;

create function public.create_industry_operation(
  p_company uuid, p_kind text, p_name text, p_details text, p_status text,
  p_reference text, p_phone text, p_quantity integer, p_unit text,
  p_amount_cents integer, p_due_at timestamptz, p_location_url text,
  p_related_operation_id uuid
) returns uuid language sql security invoker set search_path = '' as $$
  select private.create_industry_operation(p_company,p_kind,p_name,p_details,p_status,p_reference,p_phone,p_quantity,p_unit,p_amount_cents,p_due_at,p_location_url,p_related_operation_id);
$$;
revoke all on function private.create_industry_operation(uuid,text,text,text,text,text,text,integer,text,integer,timestamptz,text,uuid) from public, anon, authenticated;
grant execute on function private.create_industry_operation(uuid,text,text,text,text,text,text,integer,text,integer,timestamptz,text,uuid) to authenticated;
revoke all on function public.create_industry_operation(uuid,text,text,text,text,text,text,integer,text,integer,timestamptz,text,uuid) from public, anon, authenticated;
grant execute on function public.create_industry_operation(uuid,text,text,text,text,text,text,integer,text,integer,timestamptz,text,uuid) to authenticated;

create function private.change_industry_operation_status(
  p_company uuid, p_record uuid, p_version integer, p_status text
) returns integer language plpgsql security definer set search_path = '' as $$
declare op public.industry_operations%rowtype; valid_transition boolean := false;
begin
  perform private.lock_business_company(p_company);
  select * into op from public.industry_operations where company_id=p_company and id=p_record for update;
  if not found then raise exception 'operation unavailable'; end if;
  if op.record_version <> p_version then raise exception 'operation version conflict'; end if;
  if p_status is null or p_status = op.status then return op.record_version; end if;
  valid_transition := case op.kind
    when 'restaurant_table' then (op.status='available' and p_status='reserved') or (op.status='reserved' and p_status='available')
    when 'restaurant_order' then (op.status='open' and p_status in ('preparing','cancelled')) or (op.status='preparing' and p_status in ('ready','cancelled')) or (op.status='ready' and p_status='served') or (op.status='served' and p_status='paid')
    when 'restaurant_cash' then op.status='recorded' and p_status='voided'
    when 'supplier_order' then (op.status='requested' and p_status in ('approved','cancelled')) or (op.status='approved' and p_status in ('received','cancelled'))
    when 'delivery' then (op.status='pending' and p_status in ('in_transit','cancelled')) or (op.status='in_transit' and p_status='delivered')
    when 'logistics_driver' then (op.status='available' and p_status in ('on_route','inactive')) or (op.status='on_route' and p_status in ('available','inactive')) or (op.status='inactive' and p_status='available')
    when 'logistics_route' then (op.status='planned' and p_status in ('in_progress','cancelled')) or (op.status='in_progress' and p_status in ('completed','cancelled'))
    when 'logistics_delivery' then (op.status='pending' and p_status in ('in_transit','cancelled')) or (op.status='in_transit' and p_status='delivered')
    when 'pet_profile' then (op.status='active' and p_status='inactive') or (op.status='inactive' and p_status='active')
    when 'pet_visit' then op.status='scheduled' and p_status in ('completed','cancelled')
    when 'pet_stock' then (op.status='active' and p_status='inactive') or (op.status='inactive' and p_status='active')
    when 'office_task' then (op.status='open' and p_status in ('in_progress','cancelled')) or (op.status='in_progress' and p_status in ('completed','cancelled'))
    when 'office_document' then op.status='active' and p_status='archived'
    when 'office_process' then (op.status='open' and p_status in ('in_progress','cancelled')) or (op.status='in_progress' and p_status in ('completed','cancelled'))
    when 'salon_commission' then op.status='pending' and p_status in ('paid','cancelled')
    when 'salon_cash' then op.status='recorded' and p_status='voided'
    when 'salon_stock' then (op.status='active' and p_status='inactive') or (op.status='inactive' and p_status='active')
    when 'academy_training' then (op.status='active' and p_status='inactive') or (op.status='inactive' and p_status='active')
    when 'academy_attendance' then op.status='scheduled' and p_status in ('attended','missed')
    when 'academy_membership' then op.status='active' and p_status in ('expired','cancelled')
    else false end;
  if not valid_transition then raise exception 'invalid operation transition'; end if;
  if op.kind='restaurant_table' and p_status='available' and exists (
    select 1 from public.industry_operations where company_id=p_company and related_operation_id=op.id
      and kind='restaurant_order' and status in ('open','preparing','ready','served')
  ) then raise exception 'table has open order'; end if;
  if op.kind='logistics_route' and p_status in ('completed','cancelled') and exists (
    select 1 from public.industry_operations where company_id=p_company
      and related_operation_id=op.id and kind='logistics_delivery' and status in ('pending','in_transit')
  ) then raise exception 'route has open deliveries'; end if;
  update public.industry_operations set status=p_status, record_version=record_version+1, updated_at=now()
    where id=p_record and company_id=p_company;
  if op.kind='restaurant_order' and p_status in ('paid','cancelled') then
    update public.industry_operations set status='available',record_version=record_version+1,updated_at=now()
      where company_id=p_company and id=op.related_operation_id and kind='restaurant_table';
  elsif op.kind='logistics_route' and p_status in ('completed','cancelled') then
    update public.industry_operations set status='available',record_version=record_version+1,updated_at=now()
      where company_id=p_company and id=op.related_operation_id and kind='logistics_driver';
  end if;
  return op.record_version + 1;
end;
$$;
create function public.change_industry_operation_status(
  p_company uuid, p_record uuid, p_version integer, p_status text
) returns integer language sql security invoker set search_path = '' as $$
  select private.change_industry_operation_status(p_company,p_record,p_version,p_status);
$$;
revoke all on function private.change_industry_operation_status(uuid,uuid,integer,text) from public, anon, authenticated;
grant execute on function private.change_industry_operation_status(uuid,uuid,integer,text) to authenticated;
revoke all on function public.change_industry_operation_status(uuid,uuid,integer,text) from public, anon, authenticated;
grant execute on function public.change_industry_operation_status(uuid,uuid,integer,text) to authenticated;

create function private.adjust_industry_stock(
  p_company uuid, p_record uuid, p_version integer, p_delta integer, p_reason text
) returns integer language plpgsql security definer set search_path = '' as $$
declare op public.industry_operations%rowtype;
begin
  perform private.lock_business_company(p_company);
  if p_record is null or p_version is null or p_version < 1 or p_delta is null
     or p_delta = 0 or p_delta not between -1000000 and 1000000
     or p_reason is null or length(trim(p_reason)) not between 2 and 160 then
    raise exception 'invalid stock adjustment';
  end if;
  select * into op from public.industry_operations
    where company_id=p_company and id=p_record for update;
  if not found or op.kind not in ('pet_stock','salon_stock') then raise exception 'stock unavailable'; end if;
  if op.record_version <> p_version then raise exception 'operation version conflict'; end if;
  if coalesce(op.quantity,0) + p_delta < 0 then raise exception 'stock cannot be negative'; end if;
  if coalesce(op.quantity,0) + p_delta > 1000000 then raise exception 'stock limit reached'; end if;
  update public.industry_operations set quantity=coalesce(quantity,0)+p_delta,
    record_version=record_version+1,updated_at=now()
    where company_id=p_company and id=p_record;
  insert into public.industry_stock_movements(company_id,operation_id,delta,reason)
    values(p_company,p_record,p_delta,trim(p_reason));
  return op.record_version+1;
end;
$$;
create function public.adjust_industry_stock(
  p_company uuid, p_record uuid, p_version integer, p_delta integer, p_reason text
) returns integer language sql security invoker set search_path = '' as $$
  select private.adjust_industry_stock(p_company,p_record,p_version,p_delta,p_reason);
$$;
revoke all on function private.adjust_industry_stock(uuid,uuid,integer,integer,text) from public, anon, authenticated;
grant execute on function private.adjust_industry_stock(uuid,uuid,integer,integer,text) to authenticated;
revoke all on function public.adjust_industry_stock(uuid,uuid,integer,integer,text) from public, anon, authenticated;
grant execute on function public.adjust_industry_stock(uuid,uuid,integer,integer,text) to authenticated;

create function private.industry_operations_summary(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or coalesce(private.member_role(p_company),'') not in ('OWNER','MANAGER') then
    raise exception 'not authorized';
  end if;
  select jsonb_build_object(
    'cash_in_cents',coalesce(sum(amount_cents) filter (where kind in ('restaurant_cash','salon_cash') and reference='entrada' and status='recorded'),0),
    'cash_out_cents',coalesce(sum(amount_cents) filter (where kind in ('restaurant_cash','salon_cash') and reference='saida' and status='recorded'),0),
    'cash_net_cents',coalesce(sum(case when kind in ('restaurant_cash','salon_cash') and status='recorded' then case reference when 'entrada' then amount_cents when 'saida' then -amount_cents else 0 end else 0 end),0),
    'commission_pending_cents',coalesce(sum(amount_cents) filter (where kind='salon_commission' and status='pending'),0),
    'commission_paid_cents',coalesce(sum(amount_cents) filter (where kind='salon_commission' and status='paid'),0)
  ) into result from public.industry_operations where company_id=p_company;
  return result;
end;
$$;
create function public.industry_operations_summary(p_company uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.industry_operations_summary(p_company);
$$;
revoke all on function private.industry_operations_summary(uuid) from public, anon, authenticated;
grant execute on function private.industry_operations_summary(uuid) to authenticated;
revoke all on function public.industry_operations_summary(uuid) from public, anon, authenticated;
grant execute on function public.industry_operations_summary(uuid) to authenticated;
