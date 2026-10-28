-- A company-owned cover complements the logo; all existing branding stays intact.
alter table public.companies
  add column cover_path text,
  add column cover_published boolean not null default false,
  add constraint company_cover_path check (
    cover_path is null or (split_part(cover_path, '/', 1) = id::text
      and cover_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$')),
  add constraint company_cover_publication check (not cover_published or cover_path is not null);

-- No direct UPDATE grant for the cover columns. Attachment is validated server-side.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('company-covers', 'company-covers', false, 768000, array['image/png', 'image/jpeg', 'image/webp']);

create function private.cover_company(object_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case when object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
    then split_part(object_name, '/', 1)::uuid else null end;
$$;
create function private.is_current_company_cover(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.companies c where c.id = private.cover_company(object_name) and c.cover_path = object_name);
$$;
create function private.is_public_company_cover(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.companies c
    where c.id = private.cover_company(object_name) and c.cover_path = object_name
      and c.cover_published and c.booking_enabled
      and (c.status = 'active' or (c.status = 'trialing' and c.trial_ends_at > now())));
$$;
revoke all on function private.cover_company(text), private.is_current_company_cover(text), private.is_public_company_cover(text) from public, anon, authenticated;
grant execute on function private.cover_company(text), private.is_public_company_cover(text) to anon, authenticated;
grant execute on function private.is_current_company_cover(text) to authenticated;

create policy company_covers_member_read on storage.objects for select to authenticated
using (bucket_id = 'company-covers' and private.member_role(private.cover_company(name)) is not null);
create policy company_covers_owner_upload on storage.objects for insert to authenticated
with check (bucket_id = 'company-covers'
  and private.member_role(private.cover_company(name)) = 'OWNER'
  and private.writable(private.cover_company(name)));
-- UUID filenames are immutable: intentionally no UPDATE / overwrite policy.
create policy company_covers_owner_cleanup on storage.objects for delete to authenticated
using (bucket_id = 'company-covers'
  and private.member_role(private.cover_company(name)) = 'OWNER'
  and private.writable(private.cover_company(name))
  and not private.is_current_company_cover(name));
-- Only explicit, current public branding can be signed. Listing / direct anon SELECT stays denied.
create policy company_covers_public_sign on storage.objects for select to anon, authenticated
using (bucket_id = 'company-covers'
  and storage.allow_only_operation('object.sign')
  and private.is_public_company_cover(name));

-- The gateway capability ensures the application has checked the bytes before attaching a cover.
-- It never replaces membership authorization and is never returned to a browser.
create function private.configure_company_cover(c uuid, path text, published boolean, gateway_secret text, expected_path text)
returns text language plpgsql security definer set search_path = '' as $$
declare previous text;
begin
  if auth.uid() is null or private.member_role(c) is distinct from 'OWNER' then raise exception 'not authorized'; end if;
  if not exists (select 1 from private.booking_gateway where secret_hash = encode(sha256(convert_to(gateway_secret, 'UTF8')), 'hex')) then
    raise exception 'gateway unauthorized';
  end if;
  select cover_path into previous from public.companies where id = c for update;
  if not found or not private.writable(c) then raise exception 'subscription blocked'; end if;
  -- Prevent an older form submission from restoring a file being cleaned up by a newer save.
  if previous is distinct from expected_path then raise exception 'cover version conflict'; end if;
  if path is not null and (private.cover_company(path) is distinct from c or not exists (
    select 1 from storage.objects o where o.bucket_id = 'company-covers' and o.name = path
      and o.metadata->>'mimetype' in ('image/png', 'image/jpeg', 'image/webp')
      and case when o.metadata->>'size' ~ '^[0-9]{1,7}$' then (o.metadata->>'size')::integer between 1 and 768000 else false end
  )) then raise exception 'invalid cover'; end if;
  if published is null or (published and path is null) then raise exception 'invalid publication'; end if;
  update public.companies set cover_path = path, cover_published = published where id = c;
  return previous;
end;
$$;
create function public.configure_company_cover(c uuid, path text, published boolean, gateway_secret text, expected_path text)
returns text language sql security invoker set search_path = '' as $$
  select private.configure_company_cover(c, path, published, gateway_secret, expected_path);
$$;
revoke all on function private.configure_company_cover(uuid, text, boolean, text, text), public.configure_company_cover(uuid, text, boolean, text, text) from public, anon, authenticated;
grant execute on function private.configure_company_cover(uuid, text, boolean, text, text), public.configure_company_cover(uuid, text, boolean, text, text) to authenticated;

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
    and (c.status = 'active' or (c.status = 'trialing' and c.trial_ends_at > now()));
$$;

