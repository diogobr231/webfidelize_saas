-- Business-owned Google Maps link shown on the public booking page, plus
-- bounded niche-specific intake details kept private with the appointment.
alter table public.companies
  add column booking_maps_url text not null default ''
    check (length(booking_maps_url) <= 500 and (
      booking_maps_url = '' or booking_maps_url ~ '^https://(maps\.app\.goo\.gl/[^[:space:]]+|maps\.google\.com/[^[:space:]]*|www\.google\.com/maps([/?#][^[:space:]]*)?)$'
    ));

grant update (booking_maps_url) on public.companies to authenticated;

create function public.configure_company_personalization(
  c uuid, name text, description text, address text, phone text, theme text,
  density text, agenda_view text, maps_url text
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or private.member_role(c) is distinct from 'OWNER' or not private.writable(c) then
    raise exception 'not authorized';
  end if;
  if maps_url is null or length(maps_url) > 500 or
     (maps_url <> '' and maps_url !~ '^https://(maps\.app\.goo\.gl/[^[:space:]]+|maps\.google\.com/[^[:space:]]*|www\.google\.com/maps([/?#][^[:space:]]*)?)$') then
    raise exception 'invalid maps url';
  end if;
  update public.companies set
    name = trim(configure_company_personalization.name),
    booking_description = trim(description), booking_address = trim(address),
    booking_phone = phone, booking_theme = theme, display_density = density,
    agenda_view = configure_company_personalization.agenda_view,
    booking_maps_url = trim(maps_url)
  where id = c;
end;
$$;
revoke all on function public.configure_company_personalization(uuid,text,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.configure_company_personalization(uuid,text,text,text,text,text,text,text,text) to authenticated;

alter table public.appointments
  add column booking_details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(booking_details) = 'object' and length(booking_details::text) <= 1200);

create or replace function private.public_catalog(slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', c.name, 'slug', c.booking_slug, 'is_demo', c.is_demo, 'niche', c.niche,
    'description', c.booking_description, 'address', c.booking_address,
    'maps_url', c.booking_maps_url, 'phone', c.booking_phone, 'theme', c.booking_theme,
    'logo_path', case when c.logo_published then c.logo_path else null end,
    'cover_path', case when c.cover_published then c.cover_path else null end,
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'duration', s.duration_minutes, 'price_cents', s.price_cents) order by s.name) from public.services s where s.company_id = c.id and s.archived_at is null), '[]'::jsonb),
    'professionals', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name) from public.professionals p where p.company_id = c.id and p.archived_at is null), '[]'::jsonb)
  ) from public.companies c where c.booking_slug = slug and c.booking_enabled
    and private.company_access_valid(c.id,now());
$$;

create function private.submit_public_booking_with_details(
  p_slug text, p_service uuid, p_professional uuid, p_start_time timestamptz,
  p_customer_name text, p_phone text, p_request_id uuid, p_gateway_secret text,
  p_ip_hash text, p_booking_details jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  c uuid;
  niche text;
  appointment uuid;
  detail text;
begin
  if not exists (select 1 from private.booking_gateway
    where secret_hash = encode(sha256(convert_to(p_gateway_secret, 'UTF8')), 'hex')) then
    raise exception 'gateway unauthorized';
  end if;
  if p_booking_details is null or jsonb_typeof(p_booking_details) <> 'object'
     or length(p_booking_details::text) > 1200 then
    raise exception 'invalid booking details';
  end if;

  select id, companies.niche into c, niche
  from public.companies
  where booking_slug = p_slug and booking_enabled and private.company_access_valid(id, now())
  for update;
  if c is null then raise exception 'booking unavailable'; end if;

  -- An idempotent retry may never replace the details of an existing booking.
  select appointment_id into appointment from private.booking_requests
    where company_id = c and request_id = p_request_id;
  if appointment is not null then return appointment; end if;

  if niche in ('fornecedores', 'logistica') then
    if p_booking_details - array['delivery_location'] <> '{}'::jsonb then raise exception 'invalid booking details'; end if;
    if p_booking_details ? 'delivery_location' and jsonb_typeof(p_booking_details -> 'delivery_location') <> 'string' then raise exception 'invalid booking details'; end if;
    detail := nullif(trim(p_booking_details ->> 'delivery_location'), '');
    if length(coalesce(detail, '')) > 500 or
       (detail ~* '^https?://' and detail !~ '^https://(maps\.app\.goo\.gl/[^[:space:]]+|maps\.google\.com/[^[:space:]]*|www\.google\.com/maps([/?#][^[:space:]]*)?)$') then
      raise exception 'invalid booking details';
    end if;
  elsif niche = 'pet-shop' then
    if p_booking_details - array['pet_name','pet_species','pet_size'] <> '{}'::jsonb
       or (p_booking_details ? 'pet_name' and jsonb_typeof(p_booking_details -> 'pet_name') <> 'string')
       or (p_booking_details ? 'pet_species' and jsonb_typeof(p_booking_details -> 'pet_species') <> 'string')
       or (p_booking_details ? 'pet_size' and jsonb_typeof(p_booking_details -> 'pet_size') <> 'string')
       or coalesce(length(trim(p_booking_details ->> 'pet_name')), 0) not between 2 and 80
       or coalesce(p_booking_details ->> 'pet_species', '') not in ('dog','cat','other')
       or coalesce(p_booking_details ->> 'pet_size', '') not in ('','small','medium','large') then
      raise exception 'invalid booking details';
    end if;
  elsif niche = 'escritorio' then
    if p_booking_details - array['meeting_topic'] <> '{}'::jsonb
       or (p_booking_details ? 'meeting_topic' and jsonb_typeof(p_booking_details -> 'meeting_topic') <> 'string')
       or length(coalesce(p_booking_details ->> 'meeting_topic', '')) > 120 then
      raise exception 'invalid booking details';
    end if;
  elsif p_booking_details <> '{}'::jsonb then
    raise exception 'invalid booking details';
  end if;

  appointment := private.submit_public_booking(
    p_slug, p_service, p_professional, p_start_time, p_customer_name,
    p_phone, p_request_id, p_gateway_secret, p_ip_hash
  );
  update public.appointments set booking_details = p_booking_details
    where company_id = c and id = appointment;
  return appointment;
end;
$$;
revoke all on function private.submit_public_booking_with_details(text,uuid,uuid,timestamptz,text,text,uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function private.submit_public_booking_with_details(text,uuid,uuid,timestamptz,text,text,uuid,text,text,jsonb) to anon, authenticated;

create function public.submit_public_booking_with_details(
  p_slug text, p_service uuid, p_professional uuid, p_start_time timestamptz,
  p_customer_name text, p_phone text, p_request_id uuid, p_gateway_secret text,
  p_ip_hash text, p_booking_details jsonb
) returns uuid language sql security invoker set search_path = '' as $$
  select private.submit_public_booking_with_details(
    p_slug, p_service, p_professional, p_start_time, p_customer_name,
    p_phone, p_request_id, p_gateway_secret, p_ip_hash, p_booking_details
  );
$$;
revoke all on function public.submit_public_booking_with_details(text,uuid,uuid,timestamptz,text,text,uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.submit_public_booking_with_details(text,uuid,uuid,timestamptz,text,text,uuid,text,text,jsonb) to anon, authenticated;
