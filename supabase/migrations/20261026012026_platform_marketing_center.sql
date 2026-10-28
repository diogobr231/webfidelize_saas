-- Internal Web Fidelize marketing workspace. No social tokens, publication or
-- ad purchases: approval is strictly an internal editorial decision.
create table public.platform_marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  create_hash text not null,
  name text not null check(length(trim(name)) between 3 and 100),
  channel text not null check(channel in ('instagram','facebook','both')),
  goal text not null check(goal in ('trial','demo','whatsapp')),
  niche text not null check(niche in ('all','salao','pet-shop','clinica','escritorio','restaurante','fornecedores','logistica','academia')),
  audience text not null check(length(trim(audience)) between 3 and 500),
  brief text not null default '' check(length(brief)<=1500),
  budget_cents integer not null default 0 check(budget_cents between 0 and 10000000),
  headline text not null default '' check(length(headline)<=120),
  body text not null default '' check(length(body)<=2200),
  cta text not null default '' check(length(cta)<=80),
  status text not null default 'draft' check(status in ('draft','review','approved','archived')),
  version integer not null default 1 check(version>0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index marketing_campaigns_status_time_idx on public.platform_marketing_campaigns(status,created_at desc,id desc);
create index marketing_campaigns_creator_idx on public.platform_marketing_campaigns(created_by);
create table public.platform_marketing_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.platform_marketing_campaigns(id),
  actor_id uuid not null references auth.users(id),
  kind text not null check(kind in ('created','updated','status_changed','ai_draft')),
  created_at timestamptz not null default clock_timestamp()
);
create index marketing_events_campaign_idx on public.platform_marketing_events(campaign_id,created_at desc);
create index marketing_events_actor_idx on public.platform_marketing_events(actor_id);
create table public.platform_marketing_generations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.platform_marketing_campaigns(id),
  requested_by uuid not null references auth.users(id),
  expected_version integer not null,
  status text not null default 'reserved' check(status in ('reserved','succeeded','failed','stale')),
  error_code text check(error_code in ('configuration_missing','provider_failed','invalid_output','verification_required','quota_exceeded','source_changed')),
  input_tokens integer check(input_tokens between 0 and 1000000),
  output_tokens integer check(output_tokens between 0 and 1000000),
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz
);
create index marketing_generations_campaign_idx on public.platform_marketing_generations(campaign_id,created_at desc);
create index marketing_generations_usage_idx on public.platform_marketing_generations(created_at);
create index marketing_generations_actor_idx on public.platform_marketing_generations(requested_by);
alter table public.platform_marketing_campaigns enable row level security;
alter table public.platform_marketing_events enable row level security;
alter table public.platform_marketing_generations enable row level security;
revoke all on public.platform_marketing_campaigns, public.platform_marketing_events, public.platform_marketing_generations from public,anon,authenticated;
grant select on public.platform_marketing_campaigns,public.platform_marketing_events,public.platform_marketing_generations to authenticated;
create policy marketing_campaigns_admin_read on public.platform_marketing_campaigns for select to authenticated using((select public.is_super_admin()));
create policy marketing_events_admin_read on public.platform_marketing_events for select to authenticated using((select public.is_super_admin()));
create policy marketing_generations_admin_read on public.platform_marketing_generations for select to authenticated using((select public.is_super_admin()));

create function private.marketing_save_campaign(p_request_id uuid,p_campaign uuid,p_version integer,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.platform_marketing_campaigns; k text; budget integer;
begin
  if not coalesce(private.is_admin(),false) then raise exception 'marketing admin required'; end if;
  if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or p_payload - array['name','channel','goal','niche','audience','brief','budget_cents','headline','body','cta'] <> '{}'::jsonb
    or (select count(*) from jsonb_object_keys(p_payload))<>10 then raise exception 'marketing invalid fields'; end if;
  foreach k in array array['name','channel','goal','niche','audience','brief','headline','body','cta'] loop
    if jsonb_typeof(p_payload->k) is distinct from 'string' then raise exception 'marketing invalid fields'; end if;
  end loop;
  if jsonb_typeof(p_payload->'budget_cents') is distinct from 'number'
    or (p_payload->>'budget_cents') !~ '^[0-9]{1,8}$' then raise exception 'marketing invalid budget'; end if;
  budget:=(p_payload->>'budget_cents')::integer;
  if p_campaign is null then
    perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 6291));
    select * into c from public.platform_marketing_campaigns where request_id=p_request_id;
    if found then
      if c.create_hash is distinct from md5(p_payload::text) then raise exception 'marketing request conflict'; end if;
      return to_jsonb(c)-'create_hash'-'created_by';
    end if;
    insert into public.platform_marketing_campaigns(request_id,create_hash,name,channel,goal,niche,audience,brief,budget_cents,headline,body,cta,created_by)
      values(p_request_id,md5(p_payload::text),trim(p_payload->>'name'),p_payload->>'channel',p_payload->>'goal',p_payload->>'niche',trim(p_payload->>'audience'),trim(p_payload->>'brief'),budget,trim(p_payload->>'headline'),trim(p_payload->>'body'),trim(p_payload->>'cta'),auth.uid()) returning * into c;
    insert into public.platform_marketing_events(campaign_id,actor_id,kind) values(c.id,auth.uid(),'created');
  else
    select * into c from public.platform_marketing_campaigns where id=p_campaign for update;
    if not found then raise exception 'marketing campaign unavailable'; end if;
    if p_version is null or c.version<>p_version then raise exception 'marketing version conflict'; end if;
    if c.status='archived' then raise exception 'marketing campaign archived'; end if;
    if row(c.name,c.channel,c.goal,c.niche,c.audience,c.brief,c.budget_cents,c.headline,c.body,c.cta) is not distinct from
      row(trim(p_payload->>'name'),p_payload->>'channel',p_payload->>'goal',p_payload->>'niche',trim(p_payload->>'audience'),trim(p_payload->>'brief'),budget,trim(p_payload->>'headline'),trim(p_payload->>'body'),trim(p_payload->>'cta')) then
      return to_jsonb(c)-'create_hash'-'created_by';
    end if;
    update public.platform_marketing_campaigns set name=trim(p_payload->>'name'),channel=p_payload->>'channel',goal=p_payload->>'goal',niche=p_payload->>'niche',audience=trim(p_payload->>'audience'),brief=trim(p_payload->>'brief'),budget_cents=budget,
      headline=trim(p_payload->>'headline'),body=trim(p_payload->>'body'),cta=trim(p_payload->>'cta'),status='draft',version=version+1,updated_at=clock_timestamp() where id=c.id returning * into c;
    insert into public.platform_marketing_events(campaign_id,actor_id,kind) values(c.id,auth.uid(),'updated');
  end if;
  return to_jsonb(c)-'create_hash'-'created_by';
end; $$;
create function public.marketing_save_campaign(p_request_id uuid,p_campaign uuid,p_version integer,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select private.marketing_save_campaign(p_request_id,p_campaign,p_version,p_payload); $$;

create function private.marketing_change_status(p_campaign uuid,p_version integer,p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.platform_marketing_campaigns; allowed boolean;
begin
  if not coalesce(private.is_admin(),false) then raise exception 'marketing admin required'; end if;
  select * into c from public.platform_marketing_campaigns where id=p_campaign for update;
  if not found then raise exception 'marketing campaign unavailable'; end if;
  if p_version is null or c.version<>p_version then raise exception 'marketing version conflict'; end if;
  if p_status is null then raise exception 'marketing invalid status'; end if;
  if c.status=p_status then return to_jsonb(c)-'create_hash'-'created_by'; end if;
  allowed:=p_status='archived' or
    (p_status='draft' and c.status in ('review','approved','archived')) or
    (c.status='draft' and p_status='review') or (c.status='review' and p_status='approved');
  if not allowed then raise exception 'marketing invalid transition'; end if;
  if p_status in ('review','approved') and (length(trim(c.headline))<3 or length(trim(c.body))<20 or length(trim(c.cta))<3) then raise exception 'marketing copy required'; end if;
  update public.platform_marketing_campaigns set status=p_status,version=version+1,updated_at=clock_timestamp() where id=c.id returning * into c;
  insert into public.platform_marketing_events(campaign_id,actor_id,kind) values(c.id,auth.uid(),'status_changed');
  return to_jsonb(c)-'create_hash'-'created_by';
end; $$;
create function public.marketing_change_status(p_campaign uuid,p_version integer,p_status text)
returns jsonb language sql security invoker set search_path='' as $$ select private.marketing_change_status(p_campaign,p_version,p_status); $$;

create function private.marketing_begin_generation(p_campaign uuid,p_version integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.platform_marketing_campaigns; result uuid; current_sp timestamp; day_start timestamptz; month_start timestamptz;
begin
  if not coalesce(private.is_admin(),false) then raise exception 'marketing admin required'; end if;
  perform pg_advisory_xact_lock(6291,2026);
  select * into c from public.platform_marketing_campaigns where id=p_campaign for update;
  if not found or c.status='archived' then raise exception 'marketing campaign unavailable'; end if;
  if p_version is null or c.version<>p_version then raise exception 'marketing version conflict'; end if;
  current_sp:=clock_timestamp() at time zone 'America/Sao_Paulo';
  day_start:=date_trunc('day',current_sp) at time zone 'America/Sao_Paulo';
  month_start:=date_trunc('month',current_sp) at time zone 'America/Sao_Paulo';
  if (select count(*) from public.platform_marketing_generations where created_at>=day_start)>=10
    or (select count(*) from public.platform_marketing_generations where created_at>=month_start)>=100 then raise exception 'marketing generation limit'; end if;
  if exists(select 1 from public.platform_marketing_generations where campaign_id=c.id and status='reserved' and created_at>clock_timestamp()-interval '15 minutes') then raise exception 'marketing generation pending'; end if;
  insert into public.platform_marketing_generations(campaign_id,requested_by,expected_version) values(c.id,auth.uid(),c.version) returning id into result;
  return result;
end; $$;
create function public.marketing_begin_generation(p_campaign uuid,p_version integer)
returns uuid language sql security invoker set search_path='' as $$ select private.marketing_begin_generation(p_campaign,p_version); $$;

create function private.marketing_finish_generation(p_generation uuid,p_output jsonb default null,p_error text default null,p_input_tokens integer default null,p_output_tokens integer default null)
returns text language plpgsql security definer set search_path='' as $$
declare g public.platform_marketing_generations; c public.platform_marketing_campaigns; k text;
begin
  if not coalesce(private.is_admin(),false) then raise exception 'marketing admin required'; end if;
  select * into g from public.platform_marketing_generations where id=p_generation and requested_by=auth.uid();
  if not found then raise exception 'marketing generation unavailable'; end if;
  select * into c from public.platform_marketing_campaigns where id=g.campaign_id for update;
  select * into g from public.platform_marketing_generations where id=p_generation for update;
  if g.status<>'reserved' then return g.status; end if;
  if p_error is not null then
    if p_output is not null or p_error not in ('configuration_missing','provider_failed','invalid_output','verification_required','quota_exceeded') then raise exception 'marketing invalid generation'; end if;
    update public.platform_marketing_generations set status='failed',error_code=p_error,finished_at=clock_timestamp() where id=g.id;
    return 'failed';
  end if;
  if c.version<>g.expected_version or c.status='archived' or g.created_at<clock_timestamp()-interval '15 minutes' then
    update public.platform_marketing_generations set status='stale',error_code='source_changed',finished_at=clock_timestamp() where id=g.id;
    return 'stale';
  end if;
  if p_output is null or jsonb_typeof(p_output)<>'object' or p_output-array['headline','body','cta']<>'{}'::jsonb
    or (select count(*) from jsonb_object_keys(p_output))<>3 then raise exception 'marketing invalid generation'; end if;
  foreach k in array array['headline','body','cta'] loop
    if jsonb_typeof(p_output->k) is distinct from 'string' then raise exception 'marketing invalid generation'; end if;
  end loop;
  if length(trim(p_output->>'headline')) not between 3 and 120 or length(trim(p_output->>'body')) not between 20 and 2200 or length(trim(p_output->>'cta')) not between 3 and 80
    or p_input_tokens is null or p_output_tokens is null or p_input_tokens not between 0 and 1000000 or p_output_tokens not between 0 and 1000000 then raise exception 'marketing invalid generation'; end if;
  update public.platform_marketing_campaigns set headline=trim(p_output->>'headline'),body=trim(p_output->>'body'),cta=trim(p_output->>'cta'),status='draft',version=version+1,updated_at=clock_timestamp() where id=c.id;
  update public.platform_marketing_generations set status='succeeded',input_tokens=p_input_tokens,output_tokens=p_output_tokens,finished_at=clock_timestamp() where id=g.id;
  insert into public.platform_marketing_events(campaign_id,actor_id,kind) values(c.id,auth.uid(),'ai_draft');
  return 'succeeded';
end; $$;
create function public.marketing_finish_generation(p_generation uuid,p_output jsonb default null,p_error text default null,p_input_tokens integer default null,p_output_tokens integer default null)
returns text language sql security invoker set search_path='' as $$ select private.marketing_finish_generation(p_generation,p_output,p_error,p_input_tokens,p_output_tokens); $$;

revoke all on function private.marketing_save_campaign(uuid,uuid,integer,jsonb),public.marketing_save_campaign(uuid,uuid,integer,jsonb),private.marketing_change_status(uuid,integer,text),public.marketing_change_status(uuid,integer,text),private.marketing_begin_generation(uuid,integer),public.marketing_begin_generation(uuid,integer),private.marketing_finish_generation(uuid,jsonb,text,integer,integer),public.marketing_finish_generation(uuid,jsonb,text,integer,integer) from public,anon,authenticated;
grant execute on function private.marketing_save_campaign(uuid,uuid,integer,jsonb),public.marketing_save_campaign(uuid,uuid,integer,jsonb),private.marketing_change_status(uuid,integer,text),public.marketing_change_status(uuid,integer,text),private.marketing_begin_generation(uuid,integer),public.marketing_begin_generation(uuid,integer),private.marketing_finish_generation(uuid,jsonb,text,integer,integer),public.marketing_finish_generation(uuid,jsonb,text,integer,integer) to authenticated;
