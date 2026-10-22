-- Internal AI produces reviewable drafts only. It cannot send messages, change
-- subscriptions, grant access, publish responses or mutate operational tenants.
create table public.platform_ai_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default true,
  auto_enqueue boolean not null default true,
  daily_limit integer not null default 10 check(daily_limit between 0 and 50),
  monthly_limit integer not null default 100 check(monthly_limit between 0 and 500),
  authorized_by uuid references auth.users(id) on delete set null,
  authorization_id uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default clock_timestamp(),
  last_error_code text,
  last_worker_at timestamptz,
  last_worker_trigger text check(last_worker_trigger in ('manual','scheduled'))
);
insert into public.platform_ai_settings(singleton) values(true);
create table public.platform_ai_jobs (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check(source_type in ('lead','ticket','task')),
  source_id uuid not null,
  source_label text not null check(length(source_label) between 1 and 160),
  source_fingerprint text not null check(source_fingerprint ~ '^[a-f0-9]{64}$'),
  attempt integer not null default 1 check(attempt>0),
  status text not null default 'queued' check(status in ('queued','processing','draft','approved','discarded','failed','stale')),
  requested_by uuid references auth.users(id) on delete set null,
  authorization_id uuid not null,
  automatic boolean not null default false,
  output jsonb,
  reviewed_body text not null default '' check(length(reviewed_body)<=2000),
  usage_input_tokens integer check(usage_input_tokens between 0 and 1000000),
  usage_output_tokens integer check(usage_output_tokens between 0 and 1000000),
  model text check(length(model) between 1 and 120),
  error_code text,
  consumed_at timestamptz,
  leased_until timestamptz,
  applied_note_id uuid references public.sales_activities(id),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(source_type,source_id,source_fingerprint,attempt)
);
create index platform_ai_jobs_queue_idx on public.platform_ai_jobs(created_at,id) where status='queued';
create index platform_ai_jobs_consumed_idx on public.platform_ai_jobs(consumed_at) where consumed_at is not null;
create index platform_ai_jobs_status_time_idx on public.platform_ai_jobs(status,created_at desc,id);
create index platform_ai_jobs_requested_idx on public.platform_ai_jobs(requested_by);
create index platform_ai_jobs_reviewer_idx on public.platform_ai_jobs(reviewed_by);
create index platform_ai_jobs_applied_note_idx on public.platform_ai_jobs(applied_note_id);
create index platform_ai_settings_authorized_idx on public.platform_ai_settings(authorized_by);
create table public.platform_ai_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  trigger text not null check(trigger in ('manual','scheduled')),
  processed integer not null check(processed between 0 and 3),
  failed integer not null check(failed between 0 and 3),
  check(processed+failed<=3),
  error_code text
);
create index platform_ai_runs_time_idx on public.platform_ai_runs(created_at desc,id);
create table private.platform_ai_gateway (
  singleton boolean primary key default true check(singleton),
  secret_hash text check(secret_hash ~ '^[a-f0-9]{64}$')
);
insert into private.platform_ai_gateway(singleton) values(true);
create table private.platform_ai_payloads (
  job_id uuid primary key references public.platform_ai_jobs(id),
  snapshot jsonb not null,
  claim_hash text check(claim_hash ~ '^[a-f0-9]{64}$'),
  result_hash text check(result_hash ~ '^[a-f0-9]{64}$')
);
alter table public.platform_ai_settings enable row level security;
alter table public.platform_ai_jobs enable row level security;
alter table public.platform_ai_runs enable row level security;
alter table private.platform_ai_gateway enable row level security;
alter table private.platform_ai_payloads enable row level security;
revoke all on public.platform_ai_settings,public.platform_ai_jobs,public.platform_ai_runs,private.platform_ai_gateway,private.platform_ai_payloads from public,anon,authenticated;
grant select on public.platform_ai_settings,public.platform_ai_jobs,public.platform_ai_runs to authenticated;
create policy platform_ai_settings_admin_read on public.platform_ai_settings for select to authenticated using((select public.is_super_admin()));
create policy platform_ai_jobs_admin_read on public.platform_ai_jobs for select to authenticated using((select public.is_super_admin()));
create policy platform_ai_runs_admin_read on public.platform_ai_runs for select to authenticated using((select public.is_super_admin()));

create function private.platform_ai_error_valid(p_code text) returns boolean language sql immutable security invoker set search_path='' as $$
  select p_code is null or p_code in ('provider_unavailable','verification_required','quota_exceeded','invalid_output','provider_failed','worker_interrupted',
    'source_changed','authorization_revoked','integration_paused','daily_limit','monthly_limit','configuration_missing');
$$;
alter table public.platform_ai_jobs add constraint platform_ai_jobs_error_safe check(private.platform_ai_error_valid(error_code));
alter table public.platform_ai_settings add constraint platform_ai_settings_error_safe check(private.platform_ai_error_valid(last_error_code));
alter table public.platform_ai_runs add constraint platform_ai_runs_error_safe check(private.platform_ai_error_valid(error_code));
revoke all on function private.platform_ai_error_valid(text) from public,anon,authenticated;

-- The snapshot omits direct contact identifiers and customer/appointment data.
-- Free text remains untrusted data and is additionally redacted by the worker.
create function private.platform_ai_source(p_type text,p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' set timezone='UTC' as $$
declare l public.sales_leads; t public.support_tickets; c public.companies; task public.platform_tasks;
  facts jsonb; snapshot jsonb; identity jsonb; nested jsonb; label text; lead_id uuid;
begin
  if p_type='lead' then
    select * into l from public.sales_leads where id=p_id and stage not in ('won','lost');
    if not found then return null; end if;
    facts:=jsonb_build_object('niche',l.niche,'stage',l.stage,'priority',l.priority,'team_size',l.team_size,'budget_range',l.budget_range,
      'timeline',l.timeline,'decision_role',l.decision_role,'challenge',l.challenge,'next_action',l.next_action,'next_contact_at',l.next_contact_at);
    snapshot:=jsonb_build_object('kind','lead','facts',facts,'task',null);
    identity:=jsonb_build_object('version',l.version,'snapshot',snapshot); label:=l.company_name; lead_id:=l.id;
  elsif p_type='ticket' then
    select * into t from public.support_tickets where id=p_id and status in ('open','in_progress');
    if not found or not exists(select 1 from public.companies where id=t.company_id and not is_demo) then return null; end if;
    select name into label from public.companies where id=t.company_id;
    snapshot:=jsonb_build_object('kind','ticket','facts',jsonb_build_object('module',t.module,'status',t.status,'subject',t.subject,'message',t.message),'task',null);
    identity:=jsonb_build_object('updated_at',t.updated_at,'snapshot',snapshot);
  elsif p_type='task' then
    select * into task from public.platform_tasks where id=p_id and status='open' and (snoozed_until is null or snoozed_until<=clock_timestamp());
    if not found then return null; end if;
    if task.rule_id in ('lead_followup','lead_idle') then
      nested:=private.platform_ai_source('lead',task.entity_id);
    elsif task.rule_id='support_waiting' then
      nested:=private.platform_ai_source('ticket',task.entity_id);
    elsif task.rule_id='trial_ending' then
      select * into c from public.companies where id=task.entity_id and not is_demo and status='trialing';
      if not found then return null; end if;
      nested:=jsonb_build_object('snapshot',jsonb_build_object('kind','company','facts',jsonb_build_object('niche',c.niche,'status',c.status,'plan_id',c.plan_id,'trial_ends_at',c.trial_ends_at),'task',null));
    end if;
    if nested is null then return null; end if;
    snapshot:=(nested->'snapshot')||jsonb_build_object('task',jsonb_build_object('rule_id',task.rule_id,'title',task.title,'priority',task.priority));
    identity:=jsonb_build_object('updated_at',task.updated_at,'context',task.context_key,'nested_fingerprint',nested->'fingerprint','snapshot',snapshot);
    label:=task.source_label; lead_id:=(nested->>'lead_id')::uuid;
  else
    raise exception 'invalid ai source';
  end if;
  return jsonb_build_object('label',label,'snapshot',snapshot,'lead_id',lead_id,
    'fingerprint',encode(sha256(convert_to((identity||jsonb_build_object('prompt_version','ops-v1'))::text,'UTF8')),'hex'));
end;
$$;
revoke all on function private.platform_ai_source(text,uuid) from public,anon,authenticated;

create function private.lock_platform_ai_worker(p_secret text) returns void
language plpgsql security definer set search_path='' as $$
declare configured text;
begin
  if p_secret is null or length(p_secret) not between 32 and 1024 then raise exception 'ai worker unavailable'; end if;
  select secret_hash into configured from private.platform_ai_gateway where singleton;
  if configured is null or configured<>encode(sha256(convert_to(p_secret,'UTF8')),'hex') then raise exception 'ai worker unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended('web-fidelize:platform-ai',0));
end;
$$;
create function private.platform_ai_authorized() returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  -- Hold current authority through the transaction so revocation cannot race a claim.
  perform 1 from private.platform_admins a join public.platform_ai_settings s on s.authorized_by=a.user_id
    where s.singleton and s.enabled for share of a;
  return found;
end;
$$;
-- Revoke outstanding authority promptly when the worker or an admin checks it.
create function private.platform_ai_expire_jobs() returns void
language plpgsql security invoker set search_path='' as $$
declare stamp timestamptz:=clock_timestamp();
begin
  update public.platform_ai_jobs j set status='stale',error_code='authorization_revoked',leased_until=null,updated_at=greatest(stamp,j.updated_at+interval '1 microsecond')
  where j.status in ('queued','processing','draft') and (not exists(select 1 from public.platform_ai_settings s join private.platform_admins a on a.user_id=s.authorized_by
    where s.singleton and s.authorization_id=j.authorization_id) or not exists(select 1 from private.platform_admins where user_id=j.requested_by));
  update public.platform_ai_jobs j set status='failed',error_code='worker_interrupted',leased_until=null,updated_at=greatest(stamp,j.updated_at+interval '1 microsecond')
    where j.status='processing' and j.leased_until<=stamp;
end;
$$;
revoke all on function private.lock_platform_ai_worker(text),private.platform_ai_authorized(),private.platform_ai_expire_jobs() from public,anon,authenticated;

create function private.admin_ai_settings_save(p_enabled boolean,p_auto_enqueue boolean,p_daily_limit integer,p_monthly_limit integer,p_expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare settings public.platform_ai_settings; changed_authority boolean; stamp timestamptz:=clock_timestamp();
begin
  perform private.lock_sales_admin(); perform pg_advisory_xact_lock(hashtextextended('web-fidelize:platform-ai',0));
  if p_enabled is null or p_auto_enqueue is null or p_daily_limit is null or p_daily_limit not between 0 and 50 or p_monthly_limit is null
    or p_monthly_limit not between 0 and 500 or p_expected_updated_at is null or not isfinite(p_expected_updated_at) then raise exception 'invalid ai settings'; end if;
  select * into settings from public.platform_ai_settings where singleton for update;
  if settings.updated_at<>p_expected_updated_at then raise exception 'ai version conflict'; end if;
  changed_authority:=settings.authorized_by is distinct from auth.uid();
  update public.platform_ai_settings set enabled=p_enabled,auto_enqueue=p_auto_enqueue,daily_limit=p_daily_limit,monthly_limit=p_monthly_limit,authorized_by=auth.uid(),
    authorization_id=case when changed_authority then gen_random_uuid() else settings.authorization_id end,
    last_error_code=null,updated_at=greatest(stamp,settings.updated_at+interval '1 microsecond') where singleton returning * into settings;
  if changed_authority then
    update public.platform_ai_jobs j set status='stale',error_code='authorization_revoked',
      leased_until=null,updated_at=greatest(stamp,j.updated_at+interval '1 microsecond') where status in ('queued','processing','draft');
  elsif not p_enabled then
    update public.platform_ai_jobs j set status='stale',error_code='integration_paused',leased_until=null,
      updated_at=greatest(stamp,j.updated_at+interval '1 microsecond') where status='processing';
  end if;
  return to_jsonb(settings);
end;
$$;

create function private.platform_ai_insert_job(p_type text,p_id uuid,p_actor uuid,p_automatic boolean) returns uuid
language plpgsql security invoker set search_path='' as $$
declare source jsonb; settings public.platform_ai_settings; result uuid; day_start timestamptz;
begin
  select * into settings from public.platform_ai_settings where singleton;
  if not private.platform_ai_authorized() or not exists(select 1 from private.platform_admins where user_id=p_actor) then raise exception 'ai not authorized or disabled'; end if;
  source:=private.platform_ai_source(p_type,p_id);
  if source is null then raise exception 'ai source unavailable'; end if;
  select id into result from public.platform_ai_jobs where source_type=p_type and source_id=p_id and source_fingerprint=source->>'fingerprint' order by attempt desc limit 1;
  if found then return result; end if;
  day_start:=date_trunc('day',clock_timestamp() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  if (select count(*) from public.platform_ai_jobs where created_at>=day_start)>=50 then raise exception 'ai queue daily limit'; end if;
  insert into public.platform_ai_jobs(source_type,source_id,source_label,source_fingerprint,requested_by,authorization_id,automatic)
    values(p_type,p_id,source->>'label',source->>'fingerprint',p_actor,settings.authorization_id,p_automatic) returning id into result;
  insert into private.platform_ai_payloads(job_id,snapshot) values(result,source->'snapshot');
  return result;
end;
$$;

create function private.admin_ai_retry(p_job uuid,p_expected_updated_at timestamptz) returns uuid
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare job public.platform_ai_jobs; settings public.platform_ai_settings; source jsonb; result uuid; stamp timestamptz:=clock_timestamp(); day_start timestamptz;
begin
  perform private.lock_sales_admin(); perform pg_advisory_xact_lock(hashtextextended('web-fidelize:platform-ai',0));
  if p_job is null or p_expected_updated_at is null or not isfinite(p_expected_updated_at) then raise exception 'invalid ai retry'; end if;
  perform private.platform_ai_expire_jobs();
  select * into settings from public.platform_ai_settings where singleton;
  if not private.platform_ai_authorized() then raise exception 'ai not authorized or disabled'; end if;
  select * into job from public.platform_ai_jobs where id=p_job for update;
  if not found or not(job.status='failed' or (job.status='stale' and job.error_code in ('integration_paused','authorization_revoked'))) then raise exception 'ai retry unavailable'; end if;
  if job.updated_at<>p_expected_updated_at then raise exception 'ai version conflict'; end if;
  if exists(select 1 from public.platform_ai_jobs where source_type=job.source_type and source_id=job.source_id and source_fingerprint=job.source_fingerprint and attempt>job.attempt) then raise exception 'ai retry already requested'; end if;
  source:=private.platform_ai_source(job.source_type,job.source_id);
  if source is null or source->>'fingerprint'<>job.source_fingerprint then raise exception 'ai source changed'; end if;
  day_start:=date_trunc('day',stamp at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  if (select count(*) from public.platform_ai_jobs where created_at>=day_start)>=50 then raise exception 'ai queue daily limit'; end if;
  if (select count(*) from public.platform_ai_jobs where source_type=job.source_type and source_id=job.source_id and created_at>=day_start)>=3 then raise exception 'ai retry daily limit'; end if;
  insert into public.platform_ai_jobs(source_type,source_id,source_label,source_fingerprint,attempt,requested_by,authorization_id,automatic)
    values(job.source_type,job.source_id,source->>'label',job.source_fingerprint,job.attempt+1,auth.uid(),settings.authorization_id,false) returning id into result;
  insert into private.platform_ai_payloads(job_id,snapshot) values(result,source->'snapshot');
  return result;
end;
$$;
create function private.admin_ai_request(p_source_type text,p_source_id uuid) returns uuid
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
begin
  perform private.lock_sales_admin(); perform pg_advisory_xact_lock(hashtextextended('web-fidelize:platform-ai',0));
  if p_source_type is null or p_source_type not in ('lead','ticket','task') or p_source_id is null then raise exception 'invalid ai source'; end if;
  perform private.platform_ai_expire_jobs();
  return private.platform_ai_insert_job(p_source_type,p_source_id,auth.uid(),false);
end;
$$;

create function private.platform_ai_enqueue(p_secret text,p_limit integer default 3) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare settings public.platform_ai_settings; candidate record; created integer:=0; before_count bigint; stamp timestamptz:=clock_timestamp();
begin
  perform private.lock_platform_ai_worker(p_secret); perform private.platform_ai_expire_jobs();
  if p_limit is null or p_limit not between 1 and 50 then raise exception 'invalid ai batch'; end if;
  select * into settings from public.platform_ai_settings where singleton for update;
  if not private.platform_ai_authorized() or not settings.auto_enqueue then return jsonb_build_object('enqueued',0); end if;
  -- Enqueue at most 50 new snapshots per local day. Existing context is not retried.
  before_count:=(select count(*) from public.platform_ai_jobs where created_at>=(date_trunc('day',stamp at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'));
  for candidate in
    select candidates.kind,candidates.id from (
      select 'task'::text as kind,id,updated_at from public.platform_tasks where status='open' and (snoozed_until is null or snoozed_until<=stamp)
      union all select 'lead',id,updated_at from public.sales_leads where stage='new'
      union all select 'ticket',t.id,t.updated_at from public.support_tickets t join public.companies c on c.id=t.company_id and not c.is_demo where t.status in ('open','in_progress')
    ) candidates
    cross join lateral (select private.platform_ai_source(candidates.kind,candidates.id) as snapshot) state
    where state.snapshot is not null and not exists(select 1 from public.platform_ai_jobs j
      where j.source_type=candidates.kind and j.source_id=candidates.id and j.source_fingerprint=state.snapshot->>'fingerprint')
    order by candidates.updated_at desc,candidates.id limit least(p_limit,greatest(0,50-before_count))
  loop
    perform private.platform_ai_insert_job(candidate.kind,candidate.id,settings.authorized_by,true); created:=created+1;
  end loop;
  return jsonb_build_object('enqueued',created);
end;
$$;

create function private.platform_ai_claim(p_secret text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare settings public.platform_ai_settings; job public.platform_ai_jobs; source jsonb; token text; stamp timestamptz:=clock_timestamp();
  day_start timestamptz; month_start timestamptz; day_used integer; month_used integer;
begin
  perform private.lock_platform_ai_worker(p_secret); perform private.platform_ai_expire_jobs();
  select * into settings from public.platform_ai_settings where singleton for update;
  if not private.platform_ai_authorized() then return null; end if;
  day_start:=date_trunc('day',stamp at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  month_start:=date_trunc('month',stamp at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  select count(*) filter(where consumed_at>=day_start),count(*) into day_used,month_used from public.platform_ai_jobs where consumed_at>=month_start;
  if day_used>=settings.daily_limit or month_used>=settings.monthly_limit then
    update public.platform_ai_settings set last_error_code=case when day_used>=settings.daily_limit then 'daily_limit' else 'monthly_limit' end where singleton;
    return null;
  end if;
  for job in select * from public.platform_ai_jobs where status='queued' order by created_at,id limit 50 for update skip locked loop
    perform 1 from private.platform_admins where user_id=job.requested_by for share;
    if not found then
      update public.platform_ai_jobs set status='stale',error_code='authorization_revoked',updated_at=greatest(stamp,updated_at+interval '1 microsecond') where id=job.id;
      continue;
    end if;
    source:=private.platform_ai_source(job.source_type,job.source_id);
    if source is null or source->>'fingerprint'<>job.source_fingerprint then
      update public.platform_ai_jobs set status='stale',error_code='source_changed',updated_at=greatest(stamp,updated_at+interval '1 microsecond') where id=job.id;
      continue;
    end if;
    token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
    update private.platform_ai_payloads set claim_hash=encode(sha256(convert_to(token,'UTF8')),'hex') where job_id=job.id;
    update public.platform_ai_jobs set status='processing',consumed_at=stamp,leased_until=stamp+interval '120 seconds',error_code=null,
      updated_at=greatest(stamp,updated_at+interval '1 microsecond') where id=job.id returning * into job;
    update public.platform_ai_settings set last_error_code=null where singleton;
    return jsonb_build_object('job',jsonb_build_object('id',job.id,'source_type',job.source_type,'source_id',job.source_id,'source_label',job.source_label,'updated_at',job.updated_at),
      'claim_token',token,'snapshot',source->'snapshot');
  end loop;
  return null;
end;
$$;

create function private.platform_ai_finish(p_secret text,p_job uuid,p_claim_token text,p_result jsonb,p_error_code text default null) returns boolean
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare job public.platform_ai_jobs; payload private.platform_ai_payloads; source jsonb; v_result_hash text; stamp timestamptz:=clock_timestamp(); body jsonb;
begin
  perform private.lock_platform_ai_worker(p_secret);
  if p_job is null or p_claim_token is null or length(p_claim_token)<>64 or not private.platform_ai_error_valid(p_error_code) then raise exception 'invalid ai result'; end if;
  select * into job from public.platform_ai_jobs where id=p_job for update;
  select * into payload from private.platform_ai_payloads where job_id=p_job for update;
  if job.id is null or payload.claim_hash is null or payload.claim_hash<>encode(sha256(convert_to(p_claim_token,'UTF8')),'hex') then raise exception 'ai claim unavailable'; end if;
  v_result_hash:=encode(sha256(convert_to(jsonb_build_object('result',p_result,'error',p_error_code)::text,'UTF8')),'hex');
  if payload.result_hash is not null then
    if payload.result_hash<>v_result_hash then raise exception 'ai result conflict'; end if;
    return job.status in ('draft','approved','discarded','failed');
  end if;
  perform private.platform_ai_expire_jobs();
  select * into job from public.platform_ai_jobs where id=p_job;
  if job.status<>'processing' or not private.platform_ai_authorized() then return false; end if;
  perform 1 from private.platform_admins where user_id=job.requested_by for share;
  if not found then
    update public.platform_ai_jobs set status='stale',error_code='authorization_revoked',leased_until=null,updated_at=greatest(stamp,updated_at+interval '1 microsecond') where id=job.id;
    return false;
  end if;
  source:=private.platform_ai_source(job.source_type,job.source_id);
  if source is null or source->>'fingerprint'<>job.source_fingerprint then
    update public.platform_ai_jobs set status='stale',error_code='source_changed',leased_until=null,updated_at=greatest(stamp,updated_at+interval '1 microsecond') where id=job.id;
    return false;
  end if;
  if p_error_code is not null then
    if p_result is not null then raise exception 'invalid ai result'; end if;
    update public.platform_ai_jobs set status='failed',error_code=p_error_code,leased_until=null,updated_at=greatest(stamp,updated_at+interval '1 microsecond') where id=job.id;
    update public.platform_ai_settings set last_error_code=p_error_code,
      enabled=case when p_error_code in ('provider_unavailable','verification_required','quota_exceeded') then false else enabled end,
      updated_at=greatest(stamp,updated_at+interval '1 microsecond') where singleton;
  else
    if p_result is null or jsonb_typeof(p_result) is distinct from 'object' or octet_length(p_result::text)>30000 then raise exception 'invalid ai result'; end if;
    if (select count(*) from jsonb_object_keys(p_result))<>4
      or not (p_result ?& array['output','model','input_tokens','output_tokens']) then raise exception 'invalid ai result'; end if;
    body:=p_result->'output';
    if jsonb_typeof(body) is distinct from 'object' then raise exception 'invalid ai result'; end if;
    if (select count(*) from jsonb_object_keys(body))<>4 or not(body ?& array['summary','next_action','priority','suggested_reply'])
      or jsonb_typeof(body->'summary') is distinct from 'string' or length(trim(body->>'summary')) not between 20 and 2000
      or jsonb_typeof(body->'next_action') is distinct from 'string' or length(trim(body->>'next_action')) not between 3 and 500
      or jsonb_typeof(body->'priority') is distinct from 'string' or body->>'priority' not in ('low','normal','high')
      or jsonb_typeof(body->'suggested_reply') is distinct from 'string' or length(body->>'suggested_reply')>2000
      or jsonb_typeof(p_result->'model') is distinct from 'string' or length(trim(p_result->>'model')) not between 1 and 120
      or jsonb_typeof(p_result->'input_tokens') is distinct from 'number' or (p_result->>'input_tokens') !~ '^[0-9]{1,7}$'
      or jsonb_typeof(p_result->'output_tokens') is distinct from 'number' or (p_result->>'output_tokens') !~ '^[0-9]{1,7}$' then raise exception 'invalid ai result'; end if;
    if (p_result->>'input_tokens')::numeric>1000000 or (p_result->>'output_tokens')::numeric>1000000 then raise exception 'invalid ai result'; end if;
    update public.platform_ai_jobs set status='draft',output=body,model=p_result->>'model',usage_input_tokens=(p_result->>'input_tokens')::integer,
      usage_output_tokens=(p_result->>'output_tokens')::integer,leased_until=null,updated_at=greatest(stamp,updated_at+interval '1 microsecond') where id=job.id;
  end if;
  update private.platform_ai_payloads set result_hash=v_result_hash where job_id=job.id;
  return true;
end;
$$;

create function private.admin_ai_review(p_job uuid,p_action text,p_body text,p_expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare job public.platform_ai_jobs; v_source jsonb; note uuid; stamp timestamptz:=clock_timestamp();
begin
  perform private.lock_sales_admin(); perform pg_advisory_xact_lock(hashtextextended('web-fidelize:platform-ai',0));
  if p_job is null or p_action is null or p_action not in ('save','approve','discard') or p_expected_updated_at is null or not isfinite(p_expected_updated_at)
    or p_body is null or length(p_body)>2000 or (p_action<>'discard' and length(trim(p_body))<3) then raise exception 'invalid ai review'; end if;
  perform private.platform_ai_expire_jobs();
  select * into job from public.platform_ai_jobs where id=p_job for update;
  if not found then raise exception 'ai job unavailable'; end if;
  if job.status='stale' then return to_jsonb(job); end if;
  -- A duplicate approval can return its receipt, but cannot append a second note.
  if job.status='approved' and p_action='approve' and job.reviewed_body=trim(p_body) then return to_jsonb(job); end if;
  if job.updated_at<>p_expected_updated_at then raise exception 'ai version conflict'; end if;
  if job.status<>'draft' then raise exception 'ai draft unavailable'; end if;
  -- Draft review remains available while paused, but requires both original authorities.
  perform 1 from private.platform_admins a join public.platform_ai_settings s on s.authorized_by=a.user_id
    where s.singleton and s.authorization_id=job.authorization_id for share of a;
  if not found then raise exception 'ai authorization revoked'; end if;
  perform 1 from private.platform_admins where user_id=job.requested_by for share;
  if not found then raise exception 'ai authorization revoked'; end if;
  if p_action='discard' then
    update public.platform_ai_jobs set status='discarded',reviewed_by=auth.uid(),reviewed_at=stamp,updated_at=greatest(stamp,updated_at+interval '1 microsecond') where id=job.id returning * into job;
    return to_jsonb(job);
  end if;
  -- Protect the reviewed source from edits until the internal approval commits.
  if job.source_type='task' then
    perform 1 from public.platform_tasks where id=job.source_id for share;
    perform 1 from public.sales_leads where id in (select entity_id from public.platform_tasks where id=job.source_id and rule_id in ('lead_followup','lead_idle')) for share;
    perform 1 from public.support_tickets where id in (select entity_id from public.platform_tasks where id=job.source_id and rule_id='support_waiting') for share;
    perform 1 from public.companies where id in (select entity_id from public.platform_tasks where id=job.source_id and rule_id='trial_ending') for share;
  elsif job.source_type='lead' then
    perform 1 from public.sales_leads where id=job.source_id for share;
  elsif job.source_type='ticket' then
    perform 1 from public.support_tickets where id=job.source_id for share;
  end if;
  v_source:=private.platform_ai_source(job.source_type,job.source_id);
  if v_source is null or v_source->>'fingerprint'<>job.source_fingerprint then
    update public.platform_ai_jobs set status='stale',error_code='source_changed',updated_at=greatest(stamp,updated_at+interval '1 microsecond') where id=job.id returning * into job;
    return to_jsonb(job);
  end if;
  if p_action='approve' and v_source->>'lead_id' is not null then
    -- Lock the source before checking again; source edits cannot race approval.
    perform 1 from public.sales_leads where id=(v_source->>'lead_id')::uuid for update;
    v_source:=private.platform_ai_source(job.source_type,job.source_id);
    if v_source is null or v_source->>'fingerprint'<>job.source_fingerprint then raise exception 'ai source changed'; end if;
    note:=private.admin_add_sales_note((v_source->>'lead_id')::uuid,trim(p_body));
  end if;
  update public.platform_ai_jobs set status=case when p_action='approve' then 'approved' else 'draft' end,reviewed_body=trim(p_body),
    reviewed_by=auth.uid(),reviewed_at=stamp,applied_note_id=note,updated_at=greatest(stamp,updated_at+interval '1 microsecond') where id=job.id returning * into job;
  return to_jsonb(job);
end;
$$;

create function private.platform_ai_worker_report(p_secret text,p_trigger text,p_error_code text,p_processed integer,p_failed integer) returns void
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare stamp timestamptz:=clock_timestamp();
begin
  perform private.lock_platform_ai_worker(p_secret);
  if p_trigger is null or p_trigger not in ('manual','scheduled') or not private.platform_ai_error_valid(p_error_code)
    or p_processed is null or p_processed not between 0 and 3 or p_failed is null or p_failed not between 0 and 3 or p_processed+p_failed>3 then raise exception 'invalid ai report'; end if;
  insert into public.platform_ai_runs(trigger,processed,failed,error_code) values(p_trigger,p_processed,p_failed,p_error_code);
  update public.platform_ai_settings set last_worker_at=stamp,last_worker_trigger=p_trigger,
    last_error_code=case when p_error_code is not null then p_error_code when not enabled then last_error_code else null end,
    enabled=case when p_error_code in ('provider_unavailable','verification_required','quota_exceeded') then false else enabled end,
    updated_at=case when p_error_code in ('provider_unavailable','verification_required','quota_exceeded') then greatest(stamp,updated_at+interval '1 microsecond') else updated_at end where singleton;
  -- Technical execution records only; usage-bearing jobs and reviewed work stay.
  delete from public.platform_ai_runs where created_at<stamp-interval '90 days';
end;
$$;
create function private.admin_ai_summary() returns jsonb
language plpgsql security definer set search_path='' as $$
declare settings public.platform_ai_settings; counters jsonb; day_start timestamptz; month_start timestamptz; stamp timestamptz:=clock_timestamp(); day_used integer; month_used integer; last_run jsonb;
begin
  perform private.lock_sales_admin();
  select * into settings from public.platform_ai_settings where singleton;
  day_start:=date_trunc('day',stamp at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  month_start:=date_trunc('month',stamp at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  select count(*) filter(where consumed_at>=day_start),count(*) into day_used,month_used from public.platform_ai_jobs where consumed_at>=month_start;
  select jsonb_build_object('queued',count(*) filter(where status='queued'),'processing',count(*) filter(where status='processing'),'draft',count(*) filter(where status='draft'),
    'approved',count(*) filter(where status='approved'),'discarded',count(*) filter(where status='discarded'),'failed',count(*) filter(where status='failed'),'stale',count(*) filter(where status='stale')) into counters from public.platform_ai_jobs;
  select to_jsonb(r) into last_run from public.platform_ai_runs r order by created_at desc,id limit 1;
  return jsonb_build_object('settings',to_jsonb(settings),'quota',jsonb_build_object('day',to_char(stamp at time zone 'America/Sao_Paulo','YYYY-MM-DD'),
    'month',to_char(stamp at time zone 'America/Sao_Paulo','YYYY-MM'),'daily_used',day_used,'monthly_used',month_used,
    'daily_remaining',greatest(0,settings.daily_limit-day_used),'monthly_remaining',greatest(0,settings.monthly_limit-month_used)),
    'counts',counters,'last_error_code',settings.last_error_code,'last_run',last_run);
end;
$$;

create function public.admin_ai_settings_save(p_enabled boolean,p_auto_enqueue boolean,p_daily_limit integer,p_monthly_limit integer,p_expected_updated_at timestamptz) returns jsonb
  language sql security invoker set search_path='' as $$select private.admin_ai_settings_save(p_enabled,p_auto_enqueue,p_daily_limit,p_monthly_limit,p_expected_updated_at)$$;
create function public.admin_ai_request(p_source_type text,p_source_id uuid) returns uuid language sql security invoker set search_path='' as $$select private.admin_ai_request(p_source_type,p_source_id)$$;
create function public.admin_ai_retry(p_job uuid,p_expected_updated_at timestamptz) returns uuid language sql security invoker set search_path='' as $$select private.admin_ai_retry(p_job,p_expected_updated_at)$$;
create function public.admin_ai_review(p_job uuid,p_action text,p_body text,p_expected_updated_at timestamptz) returns jsonb
  language sql security invoker set search_path='' as $$select private.admin_ai_review(p_job,p_action,p_body,p_expected_updated_at)$$;
create function public.admin_ai_summary() returns jsonb language sql security invoker set search_path='' as $$select private.admin_ai_summary()$$;
create function public.platform_ai_enqueue(p_secret text,p_limit integer default 3) returns jsonb language sql security invoker set search_path='' as $$select private.platform_ai_enqueue(p_secret,p_limit)$$;
create function public.platform_ai_claim(p_secret text) returns jsonb language sql security invoker set search_path='' as $$select private.platform_ai_claim(p_secret)$$;
create function public.platform_ai_finish(p_secret text,p_job uuid,p_claim_token text,p_result jsonb,p_error_code text default null) returns boolean
  language sql security invoker set search_path='' as $$select private.platform_ai_finish(p_secret,p_job,p_claim_token,p_result,p_error_code)$$;
create function public.platform_ai_worker_report(p_secret text,p_trigger text,p_error_code text,p_processed integer,p_failed integer) returns void
  language sql security invoker set search_path='' as $$select private.platform_ai_worker_report(p_secret,p_trigger,p_error_code,p_processed,p_failed)$$;
revoke all on function private.platform_ai_insert_job(text,uuid,uuid,boolean) from public,anon,authenticated;
do $grants$
declare f text;
begin
  foreach f in array array['admin_ai_settings_save(boolean,boolean,integer,integer,timestamptz)','admin_ai_request(text,uuid)','admin_ai_retry(uuid,timestamptz)','admin_ai_review(uuid,text,text,timestamptz)','admin_ai_summary()'] loop
    execute 'revoke all on function private.'||f||',public.'||f||' from public,anon,authenticated';
    execute 'grant execute on function private.'||f||',public.'||f||' to authenticated';
  end loop;
  foreach f in array array['platform_ai_enqueue(text,integer)','platform_ai_claim(text)','platform_ai_finish(text,uuid,text,jsonb,text)','platform_ai_worker_report(text,text,text,integer,integer)'] loop
    execute 'revoke all on function private.'||f||',public.'||f||' from public,anon,authenticated';
    execute 'grant execute on function private.'||f||',public.'||f||' to anon,authenticated';
  end loop;
end;
$grants$;
