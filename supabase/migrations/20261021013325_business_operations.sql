-- Operational records remain available to authorized history queries after archiving.
alter table public.customers add column archived_at timestamptz, add column record_version integer not null default 1 check (record_version > 0);
alter table public.services add column archived_at timestamptz, add column record_version integer not null default 1 check (record_version > 0);
alter table public.professionals add column archived_at timestamptz, add column record_version integer not null default 1 check (record_version > 0);
create index customers_active_company_idx on public.customers(company_id, name, id) where archived_at is null;
create index services_active_company_idx on public.services(company_id, name, id) where archived_at is null;
create index professionals_active_company_idx on public.professionals(company_id, name, id) where archived_at is null;
create index appointments_customer_history_idx on public.appointments(company_id, customer_id, starts_at desc, id desc);
create index appointments_scheduled_end_idx on public.appointments(company_id, ends_at) where status = 'scheduled';

-- Creation may not inject archive/version metadata or assignment privileges through the Data API.
revoke insert on public.customers, public.services from authenticated;
grant insert(id, company_id, name, phone) on public.customers to authenticated;
grant insert(id, company_id, name, duration_minutes, price_cents) on public.services to authenticated;
-- A browser cannot create a future appointment as completed/canceled to bypass
-- the guarded status transition, archive checks or block conflict checks.
revoke insert on public.appointments from authenticated;
grant insert(id, company_id, customer_id, service_id, professional_id, starts_at, ends_at) on public.appointments to authenticated;

-- Reused by the guarded definer RPCs only. Recheck membership after acquiring the
-- company lock, shared with booking, archive, subscription and member revocation.
create function private.lock_business_company(p_company uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce(private.member_role(p_company), '') not in ('OWNER', 'MANAGER') then raise exception 'not authorized'; end if;
  perform 1 from public.companies where id = p_company for update;
  if not found or coalesce(private.member_role(p_company), '') not in ('OWNER', 'MANAGER') then raise exception 'not authorized'; end if;
  if not private.writable(p_company) then raise exception 'subscription blocked'; end if;
end;
$$;
revoke all on function private.lock_business_company(uuid) from public, anon, authenticated;

create function private.update_business_record(p_company uuid, p_section text, p_record uuid, p_version integer, p_name text, p_phone text default null, p_duration integer default null, p_price integer default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare current_version integer; archived timestamptz; result integer;
begin
  perform private.lock_business_company(p_company);
  if p_section is null or p_section not in ('customers', 'services', 'professionals') or p_record is null or p_version is null or p_version < 1
     or p_name is null or length(trim(p_name)) not between 2 and 120 then raise exception 'invalid business record'; end if;
  if (p_section = 'customers' and (p_phone is null or length(trim(p_phone)) > 30 or p_duration is not null or p_price is not null))
     or (p_section = 'services' and (p_phone is not null or p_duration is null or p_duration not between 5 and 480 or p_price is null or p_price not between 0 and 10000000))
     or (p_section = 'professionals' and (p_phone is not null or p_duration is not null or p_price is not null)) then raise exception 'invalid business record'; end if;
  -- The identifier comes from the whitelist above; values remain bound parameters.
  execute format('select record_version, archived_at from public.%I where company_id = $1 and id = $2 for update', p_section)
    into current_version, archived using p_company, p_record;
  if current_version is null then raise exception 'record unavailable'; end if;
  if current_version <> p_version then raise exception 'record version conflict'; end if;
  if archived is not null then raise exception 'record archived'; end if;
  result := current_version;
  if p_section = 'customers' then
    update public.customers set name = trim(p_name), phone = trim(p_phone), record_version = record_version + 1
      where company_id = p_company and id = p_record and row(name, phone) is distinct from row(trim(p_name), trim(p_phone)) returning record_version into result;
  elsif p_section = 'services' then
    update public.services set name = trim(p_name), duration_minutes = p_duration, price_cents = p_price, record_version = record_version + 1
      where company_id = p_company and id = p_record and row(name, duration_minutes, price_cents) is distinct from row(trim(p_name), p_duration, p_price) returning record_version into result;
  else
    update public.professionals set name = trim(p_name), record_version = record_version + 1
      where company_id = p_company and id = p_record and name is distinct from trim(p_name) returning record_version into result;
  end if;
  return coalesce(result, current_version);
end;
$$;
create function public.update_business_record(p_company uuid, p_section text, p_record uuid, p_version integer, p_name text, p_phone text default null, p_duration integer default null, p_price integer default null)
returns integer language sql security invoker set search_path = '' as $$
  select private.update_business_record(p_company, p_section, p_record, p_version, p_name, p_phone, p_duration, p_price);
$$;

create function private.archive_business_record(p_company uuid, p_section text, p_record uuid, p_version integer, p_archived boolean)
returns integer language plpgsql security definer set search_path = '' as $$
declare current_version integer; archived timestamptz; relation_column text; busy boolean;
begin
  perform private.lock_business_company(p_company);
  if p_section is null or p_section not in ('customers', 'services', 'professionals') or p_record is null or p_version is null or p_version < 1 or p_archived is null then raise exception 'invalid business record'; end if;
  execute format('select record_version, archived_at from public.%I where company_id = $1 and id = $2 for update', p_section)
    into current_version, archived using p_company, p_record;
  if current_version is null then raise exception 'record unavailable'; end if;
  if current_version <> p_version then raise exception 'record version conflict'; end if;
  if (archived is not null) = p_archived then return current_version; end if;
  if p_archived then
    relation_column := case p_section when 'customers' then 'customer_id' when 'services' then 'service_id' else 'professional_id' end;
    execute format('select exists(select 1 from public.appointments where company_id = $1 and %I = $2 and status = ''scheduled'' and ends_at > now())', relation_column)
      into busy using p_company, p_record;
    if busy then raise exception 'future scheduled appointments'; end if;
  end if;
  execute format('update public.%I set archived_at = $1, record_version = record_version + 1 where company_id = $2 and id = $3 returning record_version', p_section)
    into current_version using case when p_archived then now() else null::timestamptz end, p_company, p_record;
  return current_version;
end;
$$;
create function public.archive_business_record(p_company uuid, p_section text, p_record uuid, p_version integer, p_archived boolean)
returns integer language sql security invoker set search_path = '' as $$
  select private.archive_business_record(p_company, p_section, p_record, p_version, p_archived);
$$;
revoke all on function private.update_business_record(uuid,text,uuid,integer,text,text,integer,integer), public.update_business_record(uuid,text,uuid,integer,text,text,integer,integer),
  private.archive_business_record(uuid,text,uuid,integer,boolean), public.archive_business_record(uuid,text,uuid,integer,boolean) from public, anon, authenticated;
grant execute on function private.update_business_record(uuid,text,uuid,integer,text,text,integer,integer), public.update_business_record(uuid,text,uuid,integer,text,text,integer,integer),
  private.archive_business_record(uuid,text,uuid,integer,boolean), public.archive_business_record(uuid,text,uuid,integer,boolean) to authenticated;

create or replace function private.check_professional_limit() returns trigger language plpgsql security definer set search_path = '' as $$
declare max_staff integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  -- Editing/removing a login on an existing record must never depend on capacity.
  if tg_op = 'UPDATE' and new.company_id = old.company_id and (new.archived_at is not null or old.archived_at is null) then return new; end if;
  if new.archived_at is not null then return new; end if;
  perform 1 from public.companies where id = new.company_id for update;
  if coalesce(private.member_role(new.company_id), '') not in ('OWNER', 'MANAGER') then raise exception 'not authorized'; end if;
  select p.staff_limit into max_staff from public.companies c join public.plans p on p.id = c.plan_id where c.id = new.company_id;
  if max_staff is null or (select count(*) from public.professionals where company_id = new.company_id and id <> new.id and archived_at is null) >= max_staff then raise exception 'professional limit reached'; end if;
  return new;
end;
$$;
create or replace function private.admin_company(c uuid, new_plan text, new_status text, new_trial timestamptz) returns void language plpgsql security definer set search_path = '' as $$
declare max_staff integer;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'not authorized'; end if;
  perform 1 from public.companies where id = c for update;
  select staff_limit into max_staff from public.plans where id = new_plan;
  if max_staff is null or max_staff < (select count(*) from public.professionals where company_id = c and archived_at is null)
     or max_staff < (select count(*) from public.memberships where company_id = c and role <> 'OWNER') then raise exception 'plan limit'; end if;
  if new_status not in ('trialing', 'suspended', 'canceled') then raise exception 'invalid manual status'; end if;
  if new_trial > now() + interval '30 days' then raise exception 'trial extension maximum 30 days'; end if;
  update public.companies set plan_id = new_plan, status = new_status, trial_ends_at = new_trial where id = c;
end;
$$;
create or replace function private.assign_professional_member(c uuid, professional uuid, member uuid, expected_member uuid, confirmed boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare previous uuid; archived timestamptz;
begin
  if auth.uid() is null or private.member_role(c) is distinct from 'OWNER' then raise exception 'not authorized'; end if;
  perform 1 from public.companies where id = c for update;
  if not found or private.member_role(c) is distinct from 'OWNER' then raise exception 'not authorized'; end if;
  if not private.writable(c) then raise exception 'subscription blocked'; end if;
  select p.user_id, p.archived_at into previous, archived from public.professionals p where p.company_id = c and p.id = professional for update;
  if not found then raise exception 'professional not found'; end if;
  if previous is distinct from expected_member then raise exception 'assignment version conflict'; end if;
  if previous is not null and previous is distinct from member and confirmed is distinct from true then raise exception 'confirmation required'; end if;
  if member is not null then
    if archived is not null and member is distinct from previous then raise exception 'professional archived'; end if;
    if not exists (select 1 from public.memberships m where m.company_id = c and m.user_id = member) then raise exception 'member not found'; end if;
    if exists (select 1 from public.professionals p where p.company_id = c and p.user_id = member and p.id <> professional) then raise exception 'member already assigned'; end if;
  end if;
  update public.professionals p set user_id = member where p.company_id = c and p.id = professional;
  return professional;
end;
$$;

create table public.schedule_blocks (
  id uuid primary key, company_id uuid not null references public.companies(id),
  professional_id uuid, starts_at timestamptz not null, ends_at timestamptz not null,
  reason text not null default '' check (length(reason) <= 160), created_at timestamptz not null default now(),
  foreign key(company_id, professional_id) references public.professionals(company_id, id),
  check (isfinite(starts_at) and isfinite(ends_at) and ends_at > starts_at)
);
create index schedule_blocks_company_range_idx on public.schedule_blocks using gist (company_id, tstzrange(starts_at, ends_at, '[)'));
create index schedule_blocks_company_start_idx on public.schedule_blocks(company_id, starts_at, id);
create index schedule_blocks_company_professional_idx on public.schedule_blocks(company_id, professional_id);
alter table public.schedule_blocks enable row level security;
create policy schedule_blocks_read on public.schedule_blocks for select to authenticated using (
  private.member_role(company_id) in ('OWNER', 'MANAGER') or
  (private.member_role(company_id) = 'EMPLOYEE' and (professional_id is null or private.assigned(company_id, professional_id)))
);
revoke all on public.schedule_blocks from public, anon, authenticated;
grant select on public.schedule_blocks to authenticated;

create function private.create_schedule_block(p_company uuid, p_id uuid, p_professional uuid, p_start timestamptz, p_end timestamptz, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare existing public.schedule_blocks%rowtype;
begin
  perform private.lock_business_company(p_company);
  if p_id is null or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or p_end <= p_start then raise exception 'invalid block interval'; end if;
  if p_reason is null or length(trim(p_reason)) > 160 then raise exception 'invalid block reason'; end if;
  select * into existing from public.schedule_blocks where id = p_id;
  if found then
    if row(existing.company_id, existing.professional_id, existing.starts_at, existing.ends_at, existing.reason)
       is distinct from row(p_company, p_professional, p_start, p_end, trim(p_reason)) then raise exception 'block idempotency conflict'; end if;
    return p_id;
  end if;
  if p_end <= now() then raise exception 'invalid block interval'; end if;
  if p_professional is not null and not exists (select 1 from public.professionals where company_id = p_company and id = p_professional and archived_at is null) then raise exception 'professional unavailable'; end if;
  if exists (select 1 from public.appointments where company_id = p_company and status = 'scheduled'
    and (p_professional is null or professional_id = p_professional)
    and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_start, p_end, '[)')) then raise exception 'scheduled appointment conflict'; end if;
  insert into public.schedule_blocks(id, company_id, professional_id, starts_at, ends_at, reason) values(p_id, p_company, p_professional, p_start, p_end, trim(p_reason));
  return p_id;
end;
$$;
create function public.create_schedule_block(p_company uuid, p_id uuid, p_professional uuid, p_start timestamptz, p_end timestamptz, p_reason text)
returns uuid language sql security invoker set search_path = '' as $$ select private.create_schedule_block(p_company, p_id, p_professional, p_start, p_end, p_reason); $$;
create function private.remove_schedule_block(p_company uuid, p_block uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.lock_business_company(p_company);
  delete from public.schedule_blocks where company_id = p_company and id = p_block;
  if not found then raise exception 'block unavailable'; end if;
end;
$$;
create function public.remove_schedule_block(p_company uuid, p_block uuid)
returns void language sql security invoker set search_path = '' as $$ select private.remove_schedule_block(p_company, p_block); $$;
revoke all on function private.create_schedule_block(uuid,uuid,uuid,timestamptz,timestamptz,text), public.create_schedule_block(uuid,uuid,uuid,timestamptz,timestamptz,text),
  private.remove_schedule_block(uuid,uuid), public.remove_schedule_block(uuid,uuid) from public, anon, authenticated;
grant execute on function private.create_schedule_block(uuid,uuid,uuid,timestamptz,timestamptz,text), public.create_schedule_block(uuid,uuid,uuid,timestamptz,timestamptz,text),
  private.remove_schedule_block(uuid,uuid), public.remove_schedule_block(uuid,uuid) to authenticated;

-- Every reservation path, including direct Data API INSERT and rescheduling, takes
-- the same company row lock as create_schedule_block and archive_business_record.
create or replace function private.validate_appointment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare duration integer; expected_duration interval; s timestamp; e timestamp; sm integer; em integer;
begin
  perform 1 from public.companies where id = new.company_id for update;
  if not found then raise exception 'booking unavailable'; end if;
  -- Public booking uses the server-only gateway with an anonymous client. Direct
  -- authenticated INSERTs recheck role after waiting, rather than a stale RLS snapshot.
  if auth.uid() is not null and coalesce(private.member_role(new.company_id), '') not in ('OWNER', 'MANAGER') then raise exception 'not authorized'; end if;
  if tg_op = 'UPDATE' then
    if row(new.company_id, new.customer_id, new.service_id, new.professional_id) is distinct from row(old.company_id, old.customer_id, old.service_id, old.professional_id) then raise exception 'appointment identity is immutable'; end if;
    -- Completion/cancellation remains possible for historical records and removed shifts.
    if new.starts_at = old.starts_at and new.ends_at = old.ends_at then return new; end if;
    if old.status <> 'scheduled' or new.status <> old.status then raise exception 'appointment cannot be rescheduled'; end if;
    expected_duration := old.ends_at - old.starts_at;
  end if;
  if not exists (select 1 from public.companies where id = new.company_id and (status = 'active' or (status = 'trialing' and trial_ends_at > now()))) then raise exception 'subscription blocked'; end if;
  -- Composite foreign keys continue rejecting missing/cross-tenant references.
  -- This guard adds archive checks without replacing those identity constraints.
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
revoke all on function private.validate_appointment(), private.check_professional_limit() from public, anon, authenticated;

create or replace function private.manage_appointment(p_company uuid, p_appointment uuid, p_action text, p_start timestamptz default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare appointment public.appointments%rowtype;
begin
  -- A revoked manager waiting on the company row must not retain write access.
  perform private.lock_business_company(p_company);
  select * into appointment from public.appointments where company_id = p_company and id = p_appointment for update;
  if not found then raise exception 'appointment not found'; end if;
  if p_action is null or p_action not in ('cancel', 'reschedule', 'complete') then raise exception 'invalid action'; end if;
  if appointment.status <> 'scheduled' then raise exception 'appointment is terminal'; end if;
  if p_action = 'reschedule' then
    if p_start is null then raise exception 'start required'; end if;
    update public.appointments set starts_at = p_start, ends_at = p_start + (appointment.ends_at - appointment.starts_at)
      where company_id = p_company and id = p_appointment;
  else
    if p_start is not null then raise exception 'unexpected start'; end if;
    if p_action = 'complete' and appointment.ends_at > now() then raise exception 'appointment has not ended'; end if;
    update public.appointments set status = case when p_action = 'cancel' then 'canceled' else 'completed' end
      where company_id = p_company and id = p_appointment;
  end if;
  return appointment.id;
end;
$$;

create or replace function private.public_catalog(slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', c.name, 'slug', c.booking_slug, 'is_demo', c.is_demo,
    'description', c.booking_description, 'address', c.booking_address, 'phone', c.booking_phone, 'theme', c.booking_theme,
    'logo_path', case when c.logo_published then c.logo_path else null end,
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'duration', s.duration_minutes, 'price_cents', s.price_cents) order by s.name) from public.services s where s.company_id = c.id and s.archived_at is null), '[]'::jsonb),
    'professionals', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name) from public.professionals p where p.company_id = c.id and p.archived_at is null), '[]'::jsonb)
  ) from public.companies c where c.booking_slug = slug and c.booking_enabled
    and (c.status = 'active' or (c.status = 'trialing' and c.trial_ends_at > now()));
$$;
create or replace function private.public_slots(slug text, service uuid, professional uuid, day date)
returns table(starts_at timestamptz) language sql stable security definer set search_path = '' as $$
  select ((day::timestamp + make_interval(mins => m)) at time zone 'America/Sao_Paulo') as starts_at
  from public.companies c
  join public.services s on s.company_id = c.id and s.id = service and s.archived_at is null
  join public.professionals p on p.company_id = c.id and p.id = professional and p.archived_at is null
  join public.availability a on a.company_id = c.id and a.professional_id = p.id and a.weekday = extract(isodow from day)
  cross join lateral generate_series(a.start_minute, a.end_minute - s.duration_minutes, 15) m
  where c.booking_slug = slug and c.booking_enabled and (c.status = 'active' or (c.status = 'trialing' and c.trial_ends_at > now()))
    and isfinite(day) and day >= (now() at time zone 'America/Sao_Paulo')::date and day <= (now() at time zone 'America/Sao_Paulo')::date + 60
    and ((day::timestamp + make_interval(mins => m)) at time zone 'America/Sao_Paulo') > now() + interval '30 minutes'
    and not exists (select 1 from public.appointments ap where ap.company_id = c.id and ap.professional_id = p.id and ap.status <> 'canceled'
      and tstzrange(ap.starts_at, ap.ends_at, '[)') && tstzrange(((day::timestamp + make_interval(mins => m)) at time zone 'America/Sao_Paulo'), ((day::timestamp + make_interval(mins => m + s.duration_minutes)) at time zone 'America/Sao_Paulo'), '[)'))
    and not exists (select 1 from public.schedule_blocks b where b.company_id = c.id and (b.professional_id is null or b.professional_id = p.id)
      and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(((day::timestamp + make_interval(mins => m)) at time zone 'America/Sao_Paulo'), ((day::timestamp + make_interval(mins => m + s.duration_minutes)) at time zone 'America/Sao_Paulo'), '[)'))
  order by starts_at;
$$;

create or replace function private.submit_public_booking(slug text, service uuid, professional uuid, start_time timestamptz, customer_name text, phone text, request_id uuid, gateway_secret text, ip_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c uuid; customer uuid; appointment uuid; duration integer;
begin
  if not exists (select 1 from private.booking_gateway where secret_hash = encode(sha256(convert_to(gateway_secret, 'UTF8')), 'hex')) then raise exception 'gateway unauthorized'; end if;
  if request_id is null or customer_name is null or length(customer_name) not between 2 and 120 or phone is null or phone !~ '^[0-9]{10,13}$' or ip_hash is null or ip_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid booking'; end if;
  -- Lock before the active check, idempotency lookup and slot check; no separate
  -- advisory-lock namespace can race against internal reservations or blocks.
  select id into c from public.companies where booking_slug = slug for update;
  if c is null or not exists (select 1 from public.companies where id = c and booking_enabled and (status = 'active' or (status = 'trialing' and trial_ends_at > now()))) then raise exception 'booking unavailable'; end if;
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
