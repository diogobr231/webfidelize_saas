-- A source key is an HMAC produced by the trusted server, never an IP address.
-- The existing secret and config-row lock protect and serialize all quota checks.
alter table private.sales_capture_requests add column source_hash text check(source_hash is null or source_hash ~ '^[a-f0-9]{64}$');
create index sales_capture_source_time_idx on private.sales_capture_requests(source_hash,created_at) where source_hash is not null;
-- Replace, rather than overload, so PostgREST resolves both old and new requests.
drop function public.sales_capture(text,uuid,jsonb);
drop function private.sales_capture(text,uuid,jsonb);
create function private.sales_capture(p_gateway_secret text,p_request_id uuid,p_input jsonb,p_source_hash text default null) returns boolean language plpgsql security definer set search_path = '' as $$
declare configured_hash text; v jsonb; item public.sales_leads%rowtype; fingerprint text; contact text; previous_hash text; stamp timestamptz; result uuid; source_key text;
begin
  if p_gateway_secret is null or length(p_gateway_secret) not between 32 and 1024 or p_request_id is null then raise exception 'sales capture unavailable'; end if;
  select secret_hash into configured_hash from private.sales_gateway_config where singleton for update;
  if configured_hash is null or configured_hash <> encode(sha256(convert_to(p_gateway_secret,'UTF8')),'hex') then raise exception 'sales capture unavailable'; end if;
  if p_source_hash is not null and p_source_hash !~ '^[a-f0-9]{64}$' then raise exception 'sales capture unavailable'; end if;
  -- Old deployments without the new parameter share a limited compatibility bucket.
  source_key := coalesce(p_source_hash,repeat('0',64));
  stamp := clock_timestamp();
  perform private.sales_keys(p_input,array['offer_id','contact_name','company_name','email','phone','niche','team_size','budget_range','timeline','decision_role','challenge','consent','utm_source','utm_medium','utm_campaign']);
  if p_input -> 'consent' is distinct from 'true'::jsonb then raise exception 'invalid sales input'; end if;
  v := private.sales_contact(p_input,true) || jsonb_build_object('consent',true,
    'utm_source',private.sales_text(p_input,'utm_source',0,120,''),'utm_medium',private.sales_text(p_input,'utm_medium',0,120,''),'utm_campaign',private.sales_text(p_input,'utm_campaign',0,120,''));
  fingerprint := encode(sha256(convert_to(v::text,'UTF8')),'hex');
  contact := encode(sha256(convert_to(v ->> 'email','UTF8')),'hex');
  select payload_hash into previous_hash from private.sales_capture_requests where request_id=p_request_id;
  if found then
    if previous_hash <> fingerprint then raise exception 'sales capture unavailable'; end if;
    return true;
  end if;
  select * into item from jsonb_populate_record(null::public.sales_leads,v);
  perform 1 from public.sales_offers where id=item.offer_id and active and published for share;
  if not found then raise exception 'sales capture unavailable'; end if;
  -- On the next successful capture, erase source markers older than 24 hours.
  -- Retain request IDs/payload hashes for durable retries and all original leads.
  update private.sales_capture_requests set source_hash=null where source_hash is not null and created_at<=stamp-interval '24 hours';
  -- Apply source limits before the global budget; changing email cannot evade them.
  if (select count(*) from private.sales_capture_requests where source_hash=source_key and created_at>stamp-interval '5 minutes')>=5
    or (select count(*) from private.sales_capture_requests where source_hash=source_key and created_at>stamp-interval '1 hour')>=20 then
    raise exception 'sales capture limit';
  end if;
  if (select count(*) from private.sales_capture_requests where created_at > stamp - interval '1 hour') >= 100
    or (select count(*) from private.sales_capture_requests where contact_hash=contact and created_at > stamp - interval '1 hour') >= 5 then raise exception 'sales capture limit'; end if;
  insert into private.sales_capture_requests(request_id,payload_hash,contact_hash,source_hash,created_at) values(p_request_id,fingerprint,contact,source_key,stamp);
  -- New nonces count even when the same contact/offer was already captured.
  -- No public response exposes whether an existing lead was found or updated.
  if exists(select 1 from public.sales_leads where offer_id=item.offer_id and email=item.email and source='site' and created_at > stamp - interval '24 hours') then return true; end if;
  insert into public.sales_leads(offer_id,contact_name,company_name,email,phone,niche,team_size,budget_range,timeline,decision_role,challenge,consent_at,source,utm_source,utm_medium,utm_campaign,created_at,updated_at)
    values(item.offer_id,item.contact_name,item.company_name,item.email,item.phone,item.niche,item.team_size,item.budget_range,item.timeline,item.decision_role,item.challenge,stamp,'site',v ->> 'utm_source',v ->> 'utm_medium',v ->> 'utm_campaign',stamp,stamp) returning id into result;
  insert into public.sales_activities(lead_id,kind,body,created_at) values(result,'created','Solicitação recebida pelo site com consentimento para contato.',stamp);
  return true;
end;
$$;
create function public.sales_capture(p_gateway_secret text,p_request_id uuid,p_input jsonb,p_source_hash text default null) returns boolean
language sql security invoker set search_path='' as $$ select private.sales_capture(p_gateway_secret,p_request_id,p_input,p_source_hash); $$;
revoke all on function private.sales_capture(text,uuid,jsonb,text),public.sales_capture(text,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function private.sales_capture(text,uuid,jsonb,text),public.sales_capture(text,uuid,jsonb,text) to anon,authenticated;
