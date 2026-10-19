-- Draft for a CLI-generated migration. Requires the current Supabase Storage operation helpers.
alter table public.companies
  add column logo_path text,
  add column logo_published boolean not null default false,
  add column display_density text not null default 'comfortable' check (display_density in ('comfortable', 'compact')),
  add column agenda_view text not null default 'day' check (agenda_view in ('day', 'week')),
  add constraint company_logo_path check (
    logo_path is null or (split_part(logo_path, '/', 1) = id::text
      and logo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$')),
  add constraint company_logo_publication check (not logo_published or logo_path is not null);

-- Existing OWNER + writable RLS covers these presentation columns only.
grant update(name, display_density, agenda_view) on public.companies to authenticated;
create function public.configure_company_personalization(
  c uuid, name text, description text, address text, phone text, theme text, density text, agenda_view text
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or private.member_role(c) is distinct from 'OWNER' or not private.writable(c) then
    raise exception 'not authorized';
  end if;
  update public.companies set
    name = trim(configure_company_personalization.name),
    booking_description = trim(description), booking_address = trim(address),
    booking_phone = phone, booking_theme = theme, display_density = density,
    agenda_view = configure_company_personalization.agenda_view
  where id = c;
end;
$$;
revoke all on function public.configure_company_personalization(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.configure_company_personalization(uuid, text, text, text, text, text, text, text) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('company-logos', 'company-logos', false, 768000, array['image/png', 'image/jpeg', 'image/webp']);

create function private.logo_company(object_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case when object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
    then split_part(object_name, '/', 1)::uuid else null end;
$$;
create function private.is_current_company_logo(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.companies c where c.id = private.logo_company(object_name) and c.logo_path = object_name);
$$;
create function private.is_public_company_logo(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.companies c
    where c.id = private.logo_company(object_name) and c.logo_path = object_name
      and c.logo_published and c.booking_enabled
      and (c.status = 'active' or (c.status = 'trialing' and c.trial_ends_at > now())));
$$;
revoke all on function private.logo_company(text), private.is_current_company_logo(text), private.is_public_company_logo(text) from public, anon, authenticated;
grant execute on function private.logo_company(text), private.is_public_company_logo(text) to anon, authenticated;
grant execute on function private.is_current_company_logo(text) to authenticated;

create policy company_logos_member_read on storage.objects for select to authenticated
using (bucket_id = 'company-logos' and private.member_role(private.logo_company(name)) is not null);
create policy company_logos_owner_upload on storage.objects for insert to authenticated
with check (bucket_id = 'company-logos'
  and private.member_role(private.logo_company(name)) = 'OWNER'
  and private.writable(private.logo_company(name)));
-- UUID filenames are immutable: intentionally no UPDATE / overwrite policy.
create policy company_logos_owner_cleanup on storage.objects for delete to authenticated
using (bucket_id = 'company-logos'
  and private.member_role(private.logo_company(name)) = 'OWNER'
  and private.writable(private.logo_company(name))
  and not private.is_current_company_logo(name));
-- Only explicit, current public branding can be signed. Listing / direct anon SELECT stays denied.
create policy company_logos_public_sign on storage.objects for select to anon, authenticated
using (bucket_id = 'company-logos'
  and storage.allow_only_operation('object.sign')
  and private.is_public_company_logo(name));

-- The gateway capability ensures the application has checked the bytes before attaching a logo.
-- It never replaces membership authorization and is never returned to a browser.
create function private.configure_company_logo(c uuid, path text, published boolean, gateway_secret text, expected_path text)
returns text language plpgsql security definer set search_path = '' as $$
declare previous text;
begin
  if auth.uid() is null or private.member_role(c) is distinct from 'OWNER' then raise exception 'not authorized'; end if;
  if not exists (select 1 from private.booking_gateway where secret_hash = encode(sha256(convert_to(gateway_secret, 'UTF8')), 'hex')) then
    raise exception 'gateway unauthorized';
  end if;
  select logo_path into previous from public.companies where id = c for update;
  if not found or not private.writable(c) then raise exception 'subscription blocked'; end if;
  -- Prevent an older form submission from restoring a file being cleaned up by a newer save.
  if previous is distinct from expected_path then raise exception 'logo version conflict'; end if;
  if path is not null and (private.logo_company(path) is distinct from c or not exists (
    select 1 from storage.objects o where o.bucket_id = 'company-logos' and o.name = path
      and o.metadata->>'mimetype' in ('image/png', 'image/jpeg', 'image/webp')
      and case when o.metadata->>'size' ~ '^[0-9]{1,7}$' then (o.metadata->>'size')::integer between 1 and 768000 else false end
  )) then raise exception 'invalid logo'; end if;
  if published is null or (published and path is null) then raise exception 'invalid publication'; end if;
  update public.companies set logo_path = path, logo_published = published where id = c;
  return previous;
end;
$$;
create function public.configure_company_logo(c uuid, path text, published boolean, gateway_secret text, expected_path text)
returns text language sql security invoker set search_path = '' as $$
  select private.configure_company_logo(c, path, published, gateway_secret, expected_path);
$$;
revoke all on function private.configure_company_logo(uuid, text, boolean, text, text), public.configure_company_logo(uuid, text, boolean, text, text) from public, anon, authenticated;
grant execute on function private.configure_company_logo(uuid, text, boolean, text, text), public.configure_company_logo(uuid, text, boolean, text, text) to authenticated;

create or replace function private.public_catalog(slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', c.name, 'slug', c.booking_slug, 'is_demo', c.is_demo,
    'description', c.booking_description, 'address', c.booking_address,
    'phone', c.booking_phone, 'theme', c.booking_theme,
    'logo_path', case when c.logo_published then c.logo_path else null end,
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'duration', s.duration_minutes, 'price_cents', s.price_cents) order by s.name) from public.services s where s.company_id = c.id), '[]'::jsonb),
    'professionals', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name) from public.professionals p where p.company_id = c.id), '[]'::jsonb)
  ) from public.companies c where c.booking_slug = slug and c.booking_enabled
    and (c.status = 'active' or (c.status = 'trialing' and c.trial_ends_at > now()));
$$;
