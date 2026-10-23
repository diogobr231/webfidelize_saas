-- A previously issued receipt is a narrow capability, not a new reservation.
-- The server verifies its tenant-bound HMAC before using this private gateway.
-- Preserve current status after trial/payment expiry or publication is disabled;
-- catalog, availability and reservation writes retain their existing checks.
create or replace function private.public_booking_receipt(slug text, request_id uuid, gateway_secret text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare receipt jsonb;
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
  where c.booking_slug = slug;
  return receipt;
end;
$$;

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
    where c.booking_slug=p_slug and q.request_id=p_request_id);
end;
$$;

-- Keep the existing invoker wrappers and their narrow execution grants; no
-- direct grants on companies, customers, appointments or class registrations.
revoke all on function private.public_booking_receipt(text,uuid,text), private.public_class_booking_receipt(text,uuid,text) from public;
grant execute on function private.public_booking_receipt(text,uuid,text), private.public_class_booking_receipt(text,uuid,text) to anon,authenticated;
