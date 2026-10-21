-- Commercial pipeline only. A won deal never changes subscriptions or payments.
create table public.sales_offers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (length(slug) between 3 and 60 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (length(trim(title)) between 3 and 120),
  summary text not null check (length(trim(summary)) between 10 and 2000),
  niche text check (niche in ('salao','pet-shop','clinica','escritorio','restaurante','fornecedores','logistica','academia','outro')),
  active boolean not null default true,
  published boolean not null default false check (not published or active),
  setup_price_cents bigint check (setup_price_cents between 0 and 999999999),
  monthly_price_cents bigint check (monthly_price_cents between 0 and 999999999),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.sales_leads (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.sales_offers(id),
  contact_name text not null check (length(trim(contact_name)) between 2 and 120),
  company_name text not null check (length(trim(company_name)) between 2 and 160),
  email text not null default '' check (length(email) <= 254 and email = lower(email)),
  phone text not null check (phone ~ '^55[1-9][1-9][0-9]{8,9}$'),
  niche text not null default '' check (niche in ('','salao','pet-shop','clinica','escritorio','restaurante','fornecedores','logistica','academia','outro')),
  team_size text not null default '' check (team_size in ('','solo','2-5','6-10','11-30','31-plus')),
  budget_range text not null default '' check (budget_range in ('','explore','under-1000','1000-3000','3000-10000','over-10000')),
  timeline text not null default '' check (timeline in ('','soon','30-days','90-days','research')),
  decision_role text not null default '' check (decision_role in ('','owner','manager','team')),
  challenge text not null default '' check (length(challenge) <= 2000),
  consent_at timestamptz,
  source text not null check (source in ('site','manual')),
  utm_source text not null default '' check (length(utm_source) <= 120),
  utm_medium text not null default '' check (length(utm_medium) <= 120),
  utm_campaign text not null default '' check (length(utm_campaign) <= 120),
  stage text not null default 'new' check (stage in ('new','qualified','discovery','proposal','negotiation','won','lost')),
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  setup_value_cents bigint check (setup_value_cents between 0 and 999999999),
  monthly_value_cents bigint check (monthly_value_cents between 0 and 999999999),
  next_action text not null default '' check (length(next_action) <= 500),
  next_contact_at timestamptz check (isfinite(next_contact_at)),
  loss_reason text not null default '' check (length(loss_reason) <= 1000),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  closed_at timestamptz,
  check (stage <> 'lost' or length(trim(loss_reason)) >= 3),
  check ((stage in ('won','lost')) = (closed_at is not null)),
  check (source <> 'site' or consent_at is not null)
);
create index sales_leads_offer_created_idx on public.sales_leads(offer_id, created_at desc, id desc);
create index sales_leads_stage_created_idx on public.sales_leads(stage, created_at desc, id desc);
create index sales_leads_next_contact_idx on public.sales_leads(next_contact_at) where stage not in ('won','lost');
create index sales_leads_dedupe_idx on public.sales_leads(offer_id, email, created_at desc) where source = 'site';
create table public.sales_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.sales_leads(id),
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('created','updated','stage_changed','note')),
  body text not null check (length(trim(body)) between 2 and 2000),
  created_at timestamptz not null default now()
);
create index sales_activities_lead_time_idx on public.sales_activities(lead_id, created_at desc, id desc);
create index sales_activities_actor_idx on public.sales_activities(actor_id);
alter table public.sales_offers enable row level security;
alter table public.sales_leads enable row level security;
alter table public.sales_activities enable row level security;
revoke all on public.sales_offers, public.sales_leads, public.sales_activities from public, anon, authenticated;
grant select on public.sales_offers to anon, authenticated;
grant select on public.sales_leads, public.sales_activities to authenticated;
create policy sales_offers_public on public.sales_offers for select to anon, authenticated using (active and published);
create policy sales_offers_admin on public.sales_offers for select to authenticated using ((select public.is_super_admin()));
create policy sales_leads_admin on public.sales_leads for select to authenticated using ((select public.is_super_admin()));
create policy sales_activities_admin on public.sales_activities for select to authenticated using ((select public.is_super_admin()));

-- Closed until a separate, server-only random secret is provisioned as SHA-256.
create table private.sales_gateway_config (
  singleton boolean primary key default true check (singleton),
  secret_hash text check (secret_hash ~ '^[a-f0-9]{64}$')
);
insert into private.sales_gateway_config(singleton) values(true);
create table private.sales_capture_requests (
  request_id uuid primary key,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  contact_hash text not null check (contact_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);
create index sales_capture_requests_contact_time_idx on private.sales_capture_requests(contact_hash, created_at);
create index sales_capture_requests_time_idx on private.sales_capture_requests(created_at);
alter table private.sales_gateway_config enable row level security;
alter table private.sales_capture_requests enable row level security;
revoke all on private.sales_gateway_config, private.sales_capture_requests from public, anon, authenticated;

create function private.lock_sales_admin() returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'not authorized'; end if;
  -- Serialize privilege removal with mutations, including when a lead row is busy.
  perform 1 from private.platform_admins where user_id = auth.uid() for share;
  if not found then raise exception 'not authorized'; end if;
end;
$$;
create function private.sales_keys(p_input jsonb, p_allowed text[]) returns void language plpgsql set search_path = '' as $$
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' or octet_length(p_input::text) > 20000 then raise exception 'invalid sales input'; end if;
  if exists (select 1 from jsonb_object_keys(p_input) k where not k = any(p_allowed)) then raise exception 'invalid sales input'; end if;
end;
$$;
create function private.sales_text(p_input jsonb, p_key text, p_min integer, p_max integer, p_default text default null)
returns text language plpgsql set search_path = '' as $$
declare v text;
begin
  if not p_input ? p_key then v := p_default;
  elsif jsonb_typeof(p_input -> p_key) <> 'string' then raise exception 'invalid sales input';
  else v := trim(p_input ->> p_key); end if;
  if v is null or length(v) not between p_min and p_max then raise exception 'invalid sales input'; end if;
  return v;
end;
$$;
create function private.sales_cents(p_value jsonb) returns bigint language plpgsql set search_path = '' as $$
begin
  if p_value is null or p_value = 'null'::jsonb then return null; end if;
  if jsonb_typeof(p_value) <> 'number' or p_value::text !~ '^[0-9]{1,9}$' then raise exception 'invalid sales input'; end if;
  return p_value::text::bigint;
end;
$$;
create function private.sales_contact(p_input jsonb, p_strict boolean) returns jsonb language plpgsql set search_path = '' as $$
declare v jsonb := '{}'::jsonb; k text; s text; offer uuid; email text; phone text;
begin
  if jsonb_typeof(p_input -> 'offer_id') is distinct from 'string' then raise exception 'invalid sales input'; end if;
  begin offer := (p_input ->> 'offer_id')::uuid; exception when invalid_text_representation then raise exception 'invalid sales input'; end;
  if offer is null then raise exception 'invalid sales input'; end if;
  email := lower(private.sales_text(p_input, 'email', 0, 254, ''));
  if (p_strict or email <> '') and email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?([.][A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$' then raise exception 'invalid sales input'; end if;
  phone := private.sales_text(p_input, 'phone', 10, 30);
  if phone ~ '[^0-9[:space:]()+.-]' then raise exception 'invalid sales input'; end if;
  phone := regexp_replace(phone, '[^0-9]', '', 'g');
  if phone ~ '^[1-9][1-9][0-9]{8,9}$' then phone := '55' || phone; end if;
  if phone !~ '^55[1-9][1-9][0-9]{8,9}$' then raise exception 'invalid sales input'; end if;
  v := jsonb_build_object('offer_id', offer, 'contact_name', private.sales_text(p_input, 'contact_name', 2, 120),
    'company_name', private.sales_text(p_input, 'company_name', 2, 160), 'email', email, 'phone', phone,
    'challenge', private.sales_text(p_input, 'challenge', case when p_strict then 10 else 0 end, 2000, ''));
  foreach k in array array['niche','team_size','budget_range','timeline','decision_role'] loop
    s := private.sales_text(p_input, k, case when p_strict then 1 else 0 end, 30, '');
    if s <> '' and not (case k
      when 'niche' then s = any(array['salao','pet-shop','clinica','escritorio','restaurante','fornecedores','logistica','academia','outro'])
      when 'team_size' then s = any(array['solo','2-5','6-10','11-30','31-plus'])
      when 'budget_range' then s = any(array['explore','under-1000','1000-3000','3000-10000','over-10000'])
      when 'timeline' then s = any(array['soon','30-days','90-days','research'])
      when 'decision_role' then s = any(array['owner','manager','team']) end) then raise exception 'invalid sales input'; end if;
    v := v || jsonb_build_object(k,s);
  end loop;
  return v;
end;
$$;

create function private.admin_save_sales_offer(p_id uuid, p_input jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
<<offer_values>>
declare slug text; title text; summary text; niche text; active boolean; published boolean; result uuid;
begin
  perform private.lock_sales_admin();
  perform private.sales_keys(p_input,array['slug','title','summary','niche','active','published','setup_price_cents','monthly_price_cents']);
  slug := private.sales_text(p_input,'slug',3,60); title := private.sales_text(p_input,'title',3,120); summary := private.sales_text(p_input,'summary',10,2000);
  if slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or jsonb_typeof(p_input -> 'active') is distinct from 'boolean'
    or jsonb_typeof(p_input -> 'published') is distinct from 'boolean' then raise exception 'invalid sales input'; end if;
  active := (p_input ->> 'active')::boolean; published := (p_input ->> 'published')::boolean;
  if published and not active then raise exception 'invalid sales input'; end if;
  if p_input ? 'niche' and p_input -> 'niche' <> 'null'::jsonb then
    niche := private.sales_text(p_input,'niche',1,30);
    if niche not in ('salao','pet-shop','clinica','escritorio','restaurante','fornecedores','logistica','academia','outro') then raise exception 'invalid sales input'; end if;
  end if;
  if p_id is null then
    insert into public.sales_offers(slug,title,summary,niche,active,published,setup_price_cents,monthly_price_cents)
      values(slug,title,summary,niche,active,published,private.sales_cents(p_input -> 'setup_price_cents'),private.sales_cents(p_input -> 'monthly_price_cents')) returning id into result;
  else
    update public.sales_offers o set slug = offer_values.slug, title = offer_values.title, summary = offer_values.summary,
      niche = offer_values.niche, active = offer_values.active, published = offer_values.published,
      setup_price_cents = private.sales_cents(p_input -> 'setup_price_cents'), monthly_price_cents = private.sales_cents(p_input -> 'monthly_price_cents'), updated_at = clock_timestamp()
      where o.id = p_id returning id into result;
    if not found then raise exception 'sales record unavailable'; end if;
  end if;
  return result;
end;
$$;

create function private.admin_save_sales_lead(p_id uuid, p_expected_version integer, p_input jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare original public.sales_leads%rowtype; v jsonb; item public.sales_leads%rowtype; result uuid; stamp timestamptz := clock_timestamp(); agreed boolean := false;
begin
  perform private.lock_sales_admin();
  if p_id is null then
    if p_expected_version is not null then raise exception 'invalid sales input'; end if;
    perform private.sales_keys(p_input,array['offer_id','contact_name','company_name','email','phone','niche','team_size','budget_range','timeline','decision_role','challenge','consent','source']);
    if p_input ? 'source' and p_input -> 'source' is distinct from '"manual"'::jsonb then raise exception 'invalid sales input'; end if;
    if p_input ? 'consent' then
      if jsonb_typeof(p_input -> 'consent') <> 'boolean' then raise exception 'invalid sales input'; end if;
      agreed := (p_input ->> 'consent')::boolean;
    end if;
    v := private.sales_contact(p_input,false);
    select * into item from jsonb_populate_record(null::public.sales_leads,v);
    if not exists(select 1 from public.sales_offers where id = item.offer_id) then raise exception 'sales record unavailable'; end if;
    insert into public.sales_leads(offer_id,contact_name,company_name,email,phone,niche,team_size,budget_range,timeline,decision_role,challenge,consent_at,source)
      values(item.offer_id,item.contact_name,item.company_name,item.email,item.phone,item.niche,item.team_size,item.budget_range,item.timeline,item.decision_role,item.challenge,case when agreed then stamp end,'manual') returning id into result;
    insert into public.sales_activities(lead_id,actor_id,kind,body) values(result,auth.uid(),'created','Contato cadastrado manualmente.');
  else
    perform private.sales_keys(p_input,array['offer_id','contact_name','company_name','email','phone','niche','team_size','budget_range','timeline','decision_role','challenge','stage','priority','setup_value_cents','monthly_value_cents','next_action','next_contact_at','loss_reason']);
    if p_input = '{}'::jsonb then raise exception 'invalid sales input'; end if;
    select * into original from public.sales_leads where id = p_id for update;
    if not found then raise exception 'sales record unavailable'; end if;
    if p_expected_version is null or original.version <> p_expected_version then raise exception 'sales version conflict'; end if;
    v := to_jsonb(original) || p_input;
    v := v || private.sales_contact(v,false);
    v := v || jsonb_build_object('stage',private.sales_text(v,'stage',1,20),'priority',private.sales_text(v,'priority',1,10),
      'next_action',private.sales_text(v,'next_action',0,500),'loss_reason',private.sales_text(v,'loss_reason',0,1000),
      'setup_value_cents',private.sales_cents(v -> 'setup_value_cents'),'monthly_value_cents',private.sales_cents(v -> 'monthly_value_cents'));
    if v ->> 'stage' not in ('new','qualified','discovery','proposal','negotiation','won','lost') or v ->> 'priority' not in ('low','normal','high')
      or (v ->> 'stage' = 'lost' and length(v ->> 'loss_reason') < 3) then raise exception 'invalid sales input'; end if;
    if v -> 'next_contact_at' <> 'null'::jsonb and (jsonb_typeof(v -> 'next_contact_at') <> 'string'
      or (v ->> 'next_contact_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$') then raise exception 'invalid sales input'; end if;
    begin select * into item from jsonb_populate_record(null::public.sales_leads,v);
    exception when invalid_datetime_format or datetime_field_overflow then raise exception 'invalid sales input'; end;
    if not exists(select 1 from public.sales_offers where id = item.offer_id) then raise exception 'sales record unavailable'; end if;
    update public.sales_leads set offer_id=item.offer_id,contact_name=item.contact_name,company_name=item.company_name,email=item.email,phone=item.phone,
      niche=item.niche,team_size=item.team_size,budget_range=item.budget_range,timeline=item.timeline,decision_role=item.decision_role,challenge=item.challenge,
      stage=item.stage,priority=item.priority,setup_value_cents=item.setup_value_cents,monthly_value_cents=item.monthly_value_cents,
      next_action=item.next_action,next_contact_at=item.next_contact_at,loss_reason=item.loss_reason,version=original.version+1,updated_at=stamp,
      closed_at=case when item.stage in ('won','lost') then coalesce(original.closed_at,stamp) else null end
      where id=p_id returning id into result;
    insert into public.sales_activities(lead_id,actor_id,kind,body) values(result,auth.uid(),
      case when original.stage <> item.stage then 'stage_changed' else 'updated' end,
      case when original.stage <> item.stage then 'Etapa: ' || original.stage || ' → ' || item.stage || '.' else 'Dados comerciais atualizados.' end);
  end if;
  return result;
end;
$$;
create function private.admin_add_sales_note(p_lead_id uuid,p_body text) returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  perform private.lock_sales_admin();
  if p_body is null or length(trim(p_body)) not between 2 and 2000 then raise exception 'invalid sales input'; end if;
  perform 1 from public.sales_leads where id = p_lead_id for key share;
  if not found then raise exception 'sales record unavailable'; end if;
  insert into public.sales_activities(lead_id,actor_id,kind,body) values(p_lead_id,auth.uid(),'note',trim(p_body)) returning id into result;
  return result;
end;
$$;
create function private.admin_sales_summary(p_offer_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform private.lock_sales_admin();
  select jsonb_build_object('total',count(*),'open',count(*) filter(where stage not in ('won','lost')),
    'won',count(*) filter(where stage='won'),'lost',count(*) filter(where stage='lost'),
    'overdue',count(*) filter(where stage not in ('won','lost') and next_contact_at < now()),
    'setup_pipeline_cents',coalesce(sum(setup_value_cents) filter(where stage not in ('won','lost')),0),
    'monthly_pipeline_cents',coalesce(sum(monthly_value_cents) filter(where stage not in ('won','lost')),0),
    'won_setup_cents',coalesce(sum(setup_value_cents) filter(where stage='won'),0),
    'won_monthly_cents',coalesce(sum(monthly_value_cents) filter(where stage='won'),0),
    'by_stage',jsonb_build_object('new',count(*) filter(where stage='new'),'qualified',count(*) filter(where stage='qualified'),
      'discovery',count(*) filter(where stage='discovery'),'proposal',count(*) filter(where stage='proposal'),
      'negotiation',count(*) filter(where stage='negotiation'),'won',count(*) filter(where stage='won'),'lost',count(*) filter(where stage='lost')))
    into result from public.sales_leads where p_offer_id is null or offer_id = p_offer_id;
  return result;
end;
$$;

create function private.sales_capture(p_gateway_secret text,p_request_id uuid,p_input jsonb) returns boolean language plpgsql security definer set search_path = '' as $$
declare configured_hash text; v jsonb; item public.sales_leads%rowtype; fingerprint text; contact text; previous_hash text; stamp timestamptz; result uuid;
begin
  if p_gateway_secret is null or length(p_gateway_secret) not between 32 and 1024 or p_request_id is null then raise exception 'sales capture unavailable'; end if;
  select secret_hash into configured_hash from private.sales_gateway_config where singleton for update;
  if configured_hash is null or configured_hash <> encode(sha256(convert_to(p_gateway_secret,'UTF8')),'hex') then raise exception 'sales capture unavailable'; end if;
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
  if (select count(*) from private.sales_capture_requests where created_at > stamp - interval '1 hour') >= 100
    or (select count(*) from private.sales_capture_requests where contact_hash=contact and created_at > stamp - interval '1 hour') >= 5 then raise exception 'sales capture limit'; end if;
  insert into private.sales_capture_requests(request_id,payload_hash,contact_hash,created_at) values(p_request_id,fingerprint,contact,stamp);
  -- New nonces count even when the same contact/offer was already captured.
  -- No public response exposes whether an existing lead was found or updated.
  if exists(select 1 from public.sales_leads where offer_id=item.offer_id and email=item.email and source='site' and created_at > stamp - interval '24 hours') then return true; end if;
  insert into public.sales_leads(offer_id,contact_name,company_name,email,phone,niche,team_size,budget_range,timeline,decision_role,challenge,consent_at,source,utm_source,utm_medium,utm_campaign,created_at,updated_at)
    values(item.offer_id,item.contact_name,item.company_name,item.email,item.phone,item.niche,item.team_size,item.budget_range,item.timeline,item.decision_role,item.challenge,stamp,'site',v ->> 'utm_source',v ->> 'utm_medium',v ->> 'utm_campaign',stamp,stamp) returning id into result;
  insert into public.sales_activities(lead_id,kind,body,created_at) values(result,'created','Solicitação recebida pelo site com consentimento para contato.',stamp);
  return true;
end;
$$;

-- The public API delegates to narrowly granted functions in the private schema.
create function public.admin_save_sales_offer(p_id uuid,p_input jsonb) returns uuid language sql security invoker set search_path = '' as $$ select private.admin_save_sales_offer(p_id,p_input); $$;
create function public.admin_save_sales_lead(p_id uuid,p_expected_version integer,p_input jsonb) returns uuid language sql security invoker set search_path = '' as $$ select private.admin_save_sales_lead(p_id,p_expected_version,p_input); $$;
create function public.admin_add_sales_note(p_lead_id uuid,p_body text) returns uuid language sql security invoker set search_path = '' as $$ select private.admin_add_sales_note(p_lead_id,p_body); $$;
create function public.admin_sales_summary(p_offer_id uuid default null) returns jsonb language sql security invoker set search_path = '' as $$ select private.admin_sales_summary(p_offer_id); $$;
create function public.sales_capture(p_gateway_secret text,p_request_id uuid,p_input jsonb) returns boolean language sql security invoker set search_path = '' as $$ select private.sales_capture(p_gateway_secret,p_request_id,p_input); $$;
revoke all on function private.lock_sales_admin(), private.sales_keys(jsonb,text[]), private.sales_text(jsonb,text,integer,integer,text), private.sales_cents(jsonb), private.sales_contact(jsonb,boolean) from public,anon,authenticated;
revoke all on function private.admin_save_sales_offer(uuid,jsonb), private.admin_save_sales_lead(uuid,integer,jsonb), private.admin_add_sales_note(uuid,text), private.admin_sales_summary(uuid),
  public.admin_save_sales_offer(uuid,jsonb), public.admin_save_sales_lead(uuid,integer,jsonb), public.admin_add_sales_note(uuid,text), public.admin_sales_summary(uuid) from public,anon,authenticated;
grant execute on function private.admin_save_sales_offer(uuid,jsonb), private.admin_save_sales_lead(uuid,integer,jsonb), private.admin_add_sales_note(uuid,text), private.admin_sales_summary(uuid),
  public.admin_save_sales_offer(uuid,jsonb), public.admin_save_sales_lead(uuid,integer,jsonb), public.admin_add_sales_note(uuid,text), public.admin_sales_summary(uuid) to authenticated;
revoke all on function private.sales_capture(text,uuid,jsonb), public.sales_capture(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.sales_capture(text,uuid,jsonb), public.sales_capture(text,uuid,jsonb) to anon,authenticated;

insert into public.sales_offers(slug,title,summary,active,published)
values('web-fidelize','Web Fidelize · Implantação acompanhada',
  'Organize clientes, serviços, profissionais e agendamentos na Web Fidelize, com página pública de reservas e acesso por empresa. Converse sobre a implantação para a sua operação.',true,true);
