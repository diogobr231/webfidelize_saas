-- Extend only public booking presentation fields; existing identity and tenant keys remain unchanged.
alter table public.companies
  add column booking_description text not null default '' check (length(booking_description) <= 240),
  add column booking_address text not null default '' check (length(booking_address) <= 200),
  add column booking_phone text not null default '' check (booking_phone = '' or booking_phone ~ '^[0-9]{10,13}$'),
  add column booking_theme text not null default 'teal' check (booking_theme in ('teal', 'blue', 'violet', 'rose'));

-- The existing companies_booking_update policy requires OWNER and a writable subscription.
grant update(booking_description, booking_address, booking_phone, booking_theme) on public.companies to authenticated;
create function public.configure_booking_profile(c uuid, description text, address text, phone text, theme text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or private.member_role(c) is distinct from 'OWNER' or not private.writable(c) then
    raise exception 'not authorized';
  end if;
  update public.companies
  set booking_description = trim(description), booking_address = trim(address),
      booking_phone = phone, booking_theme = theme
  where id = c;
end;
$$;
revoke all on function public.configure_booking_profile(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.configure_booking_profile(uuid, text, text, text, text) to authenticated;

create or replace function private.public_catalog(slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', c.name, 'slug', c.booking_slug, 'is_demo', c.is_demo,
    'description', c.booking_description, 'address', c.booking_address,
    'phone', c.booking_phone, 'theme', c.booking_theme,
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'duration', s.duration_minutes, 'price_cents', s.price_cents) order by s.name) from public.services s where s.company_id = c.id), '[]'::jsonb),
    'professionals', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name) from public.professionals p where p.company_id = c.id), '[]'::jsonb)
  )
  from public.companies c
  where c.booking_slug = slug and c.booking_enabled
    and (c.status = 'active' or (c.status = 'trialing' and c.trial_ends_at > now()));
$$;

-- Status-only changes must remain possible after the visit or after a shift was removed.
-- New appointments use the current service duration; rescheduling preserves the booked duration.
create or replace function private.validate_appointment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  duration integer;
  expected_duration interval;
  s timestamp;
  e timestamp;
  sm integer;
  em integer;
begin
  if tg_op = 'UPDATE' then
    if row(new.company_id, new.customer_id, new.service_id, new.professional_id)
       is distinct from row(old.company_id, old.customer_id, old.service_id, old.professional_id) then
      raise exception 'appointment identity is immutable';
    end if;
    if new.starts_at = old.starts_at and new.ends_at = old.ends_at then
      return new;
    end if;
    if old.status <> 'scheduled' or new.status <> old.status then
      raise exception 'appointment cannot be rescheduled';
    end if;
    expected_duration := old.ends_at - old.starts_at;
  else
    select duration_minutes into duration from public.services where company_id = new.company_id and id = new.service_id;
    if duration is null then raise exception 'invalid service'; end if;
    expected_duration := make_interval(mins => duration);
  end if;
  if new.starts_at < now() or new.ends_at - new.starts_at <> expected_duration then
    raise exception 'invalid interval';
  end if;
  s := new.starts_at at time zone 'America/Sao_Paulo';
  e := new.ends_at at time zone 'America/Sao_Paulo';
  sm := extract(hour from s)::integer * 60 + extract(minute from s)::integer;
  em := extract(hour from e)::integer * 60 + extract(minute from e)::integer;
  if s::date <> e::date or extract(second from s) <> 0 or not exists (
    select 1 from public.availability
    where company_id = new.company_id and professional_id = new.professional_id
      and weekday = extract(isodow from s) and start_minute <= sm and end_minute >= em
  ) then
    raise exception 'outside business hours';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_appointment() from public, anon, authenticated;

create function private.manage_appointment(p_company uuid, p_appointment uuid, p_action text, p_start timestamptz default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  appointment public.appointments%rowtype;
begin
  if auth.uid() is null or private.member_role(p_company) is null
     or private.member_role(p_company) not in ('OWNER', 'MANAGER') then
    raise exception 'not authorized';
  end if;
  -- Serialize subscription changes and appointment transitions for this company.
  perform 1 from public.companies where id = p_company for update;
  if not private.writable(p_company) then raise exception 'subscription blocked'; end if;
  select * into appointment from public.appointments
  where company_id = p_company and id = p_appointment for update;
  if not found then raise exception 'appointment not found'; end if;
  if p_action is null or p_action not in ('cancel', 'reschedule', 'complete') then
    raise exception 'invalid action';
  end if;
  if appointment.status <> 'scheduled' then raise exception 'appointment is terminal'; end if;
  if p_action = 'reschedule' then
    if p_start is null then raise exception 'start required'; end if;
    update public.appointments
    set starts_at = p_start, ends_at = p_start + (appointment.ends_at - appointment.starts_at)
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
create function public.manage_appointment(p_company uuid, p_appointment uuid, p_action text, p_start timestamptz default null)
returns uuid language sql security invoker set search_path = '' as $$
  select private.manage_appointment(p_company, p_appointment, p_action, p_start);
$$;
revoke all on function private.manage_appointment(uuid, uuid, text, timestamptz), public.manage_appointment(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function private.manage_appointment(uuid, uuid, text, timestamptz), public.manage_appointment(uuid, uuid, text, timestamptz) to authenticated;
-- No direct UPDATE grant or policy on appointments is introduced.

-- Server-only receipt lookup: the capability is the private gateway, not arbitrary query parameters.
create function private.public_booking_receipt(slug text, request_id uuid, gateway_secret text)
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
    and (c.status = 'active' or (c.status = 'trialing' and c.trial_ends_at > now()));
  return receipt;
end;
$$;
create function public.public_booking_receipt(slug text, request_id uuid, gateway_secret text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.public_booking_receipt(slug, request_id, gateway_secret);
$$;
revoke all on function private.public_booking_receipt(text, uuid, text), public.public_booking_receipt(text, uuid, text) from public, anon, authenticated;
grant execute on function private.public_booking_receipt(text, uuid, text), public.public_booking_receipt(text, uuid, text) to anon, authenticated;
