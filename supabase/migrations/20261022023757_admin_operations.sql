-- Internal business operations only. No customer messages, payment changes,
-- subscription activation or access-policy changes are performed by these rules.
create table public.platform_automation_rules (
  id text primary key check (id in ('lead_followup','lead_idle','trial_ending','support_waiting')),
  enabled boolean not null default true,
  threshold_hours integer not null check (threshold_hours between 1 and 720),
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.platform_automation_rules(id,threshold_hours) values
  ('lead_followup',1),('lead_idle',24),('trial_ending',72),('support_waiting',24);

create table public.platform_tasks (
  id uuid primary key default gen_random_uuid(),
  rule_id text not null references public.platform_automation_rules(id),
  entity_id uuid not null,
  source_label text not null check (length(source_label) between 1 and 160),
  context_key text not null check (length(context_key) between 1 and 100),
  title text not null check (length(title) between 3 and 180),
  priority text not null check (priority in ('normal','high')),
  status text not null default 'open' check (status in ('open','done','resolved')),
  snoozed_until timestamptz check (isfinite(snoozed_until)),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique(rule_id,entity_id,context_key),
  check ((status = 'open') = (completed_at is null)),
  check (status = 'open' or snoozed_until is null)
);
create index platform_tasks_status_time_idx on public.platform_tasks(status,created_at,id);
create index platform_tasks_rule_entity_idx on public.platform_tasks(rule_id,entity_id);
create table public.platform_automation_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null check (trigger in ('manual','scheduled')),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  status text not null check (status in ('succeeded','failed')),
  created_count integer not null default 0 check (created_count >= 0),
  resolved_count integer not null default 0 check (resolved_count >= 0),
  error_code text check (error_code in ('interrupted','busy','timeout','operation_failed'))
);
create index platform_automation_runs_started_idx on public.platform_automation_runs(started_at desc,id);
create index platform_automation_runs_trigger_time_idx on public.platform_automation_runs(trigger,started_at desc,id);
create index platform_sales_idle_idx on public.sales_leads(updated_at,id) where stage = 'new' and next_contact_at is null;
create index platform_trial_ending_idx on public.companies(trial_ends_at,id) where status = 'trialing' and not is_demo;
create index platform_support_waiting_idx on public.support_tickets(updated_at,id) where status in ('open','in_progress');

alter table public.platform_automation_rules enable row level security;
alter table public.platform_tasks enable row level security;
alter table public.platform_automation_runs enable row level security;
revoke all on public.platform_automation_rules,public.platform_tasks,public.platform_automation_runs from public,anon,authenticated;
grant select on public.platform_automation_rules,public.platform_tasks,public.platform_automation_runs to authenticated;
create policy platform_automation_rules_admin_read on public.platform_automation_rules for select to authenticated using ((select public.is_super_admin()));
create policy platform_tasks_admin_read on public.platform_tasks for select to authenticated using ((select public.is_super_admin()));
create policy platform_automation_runs_admin_read on public.platform_automation_runs for select to authenticated using ((select public.is_super_admin()));

-- Dates used for identity must not depend on the connection's timezone. These
-- records intentionally contain only the business label, never client PII.
create function private.platform_automation_candidates(p_rule text,p_entity uuid,p_stamp timestamptz)
returns table(entity_id uuid,source_label text,context_key text,title text,priority text)
language sql security invoker set search_path = '' as $$
  select l.id,l.company_name,to_char(l.next_contact_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'Retomar contato comercial'::text,'high'::text
  from public.sales_leads l join public.platform_automation_rules r on r.id = 'lead_followup' and r.enabled
  where p_rule = r.id and (p_entity is null or l.id = p_entity)
    and l.stage not in ('won','lost') and l.next_contact_at <= p_stamp - make_interval(hours => r.threshold_hours)
  union all
  select l.id,l.company_name,to_char(l.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'Dar o primeiro retorno'::text,'normal'::text
  from public.sales_leads l join public.platform_automation_rules r on r.id = 'lead_idle' and r.enabled
  where p_rule = r.id and (p_entity is null or l.id = p_entity)
    and l.stage = 'new' and l.next_contact_at is null and l.updated_at <= p_stamp - make_interval(hours => r.threshold_hours)
  union all
  select c.id,c.name,to_char(c.trial_ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'Acompanhar prazo do teste'::text,'high'::text
  from public.companies c join public.platform_automation_rules r on r.id = 'trial_ending' and r.enabled
  where p_rule = r.id and (p_entity is null or c.id = p_entity)
    and not c.is_demo and c.status = 'trialing' and c.trial_ends_at is not null
    and c.trial_ends_at <= p_stamp + make_interval(hours => r.threshold_hours)
  union all
  select t.id,c.name,to_char(t.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'Responder solicitação de suporte'::text,'high'::text
  from public.support_tickets t join public.companies c on c.id = t.company_id and not c.is_demo
    join public.platform_automation_rules r on r.id = 'support_waiting' and r.enabled
  where p_rule = r.id and (p_entity is null or t.id = p_entity)
    and t.status in ('open','in_progress') and t.updated_at <= p_stamp - make_interval(hours => r.threshold_hours);
$$;
revoke all on function private.platform_automation_candidates(text,uuid,timestamptz) from public,anon,authenticated;

-- Only the database owner (scheduler) or a guarded admin definer may invoke this
-- core. Limit each pass to 250 creations and 250 resolutions per enabled rule.
-- Candidates already present are excluded BEFORE the limit to avoid starvation.
create function private.run_platform_automations(p_trigger text default 'scheduled') returns jsonb
language plpgsql security invoker set search_path = '' set lock_timeout = '2s' as $$
declare run public.platform_automation_runs; stamp timestamptz := clock_timestamp(); rule record; affected integer; created integer := 0; resolved integer := 0;
begin
  if p_trigger is null or p_trigger not in ('manual','scheduled') then raise exception 'invalid automation trigger'; end if;
  insert into public.platform_automation_runs(trigger,started_at,status,error_code)
    values(p_trigger,stamp,'failed','interrupted') returning * into run;
  if not pg_try_advisory_xact_lock(hashtextextended('web-fidelize:platform-operations',0)) then
    update public.platform_automation_runs set finished_at=clock_timestamp(),error_code='busy' where id=run.id returning * into run;
    return to_jsonb(run);
  end if;
  begin
    for rule in select id from public.platform_automation_rules where enabled order by id loop
      -- Disabled rules leave existing work intact. Enabled rules retire only
      -- still-open tasks; an administrator's completed history remains intact.
      with stale as (
        select t.id from public.platform_tasks t where t.rule_id=rule.id and t.status='open'
          and not exists(select 1 from private.platform_automation_candidates(rule.id,t.entity_id,stamp) x where x.context_key=t.context_key)
        order by t.created_at,t.id limit 250 for update
      )
      update public.platform_tasks t set status='resolved',snoozed_until=null,completed_at=stamp,updated_at=greatest(stamp,t.updated_at+interval '1 microsecond')
        from stale where t.id=stale.id;
      get diagnostics affected = row_count;
      resolved := resolved + affected;
      insert into public.platform_tasks(rule_id,entity_id,source_label,context_key,title,priority,created_at,updated_at)
      select rule.id,x.entity_id,x.source_label,x.context_key,x.title,x.priority,stamp,stamp
      from private.platform_automation_candidates(rule.id,null,stamp) x
      where not exists(select 1 from public.platform_tasks t where t.rule_id=rule.id and t.entity_id=x.entity_id and t.context_key=x.context_key and t.status<>'resolved')
      order by x.context_key,x.entity_id limit 250
      on conflict(rule_id,entity_id,context_key) do update set status='open',completed_at=null,snoozed_until=null,
        source_label=excluded.source_label,title=excluded.title,priority=excluded.priority,
        updated_at=greatest(excluded.updated_at,public.platform_tasks.updated_at+interval '1 microsecond')
        where public.platform_tasks.status='resolved';
      get diagnostics affected = row_count;
      created := created + affected;
    end loop;
    update public.platform_automation_runs set status='succeeded',finished_at=clock_timestamp(),created_count=created,resolved_count=resolved,error_code=null
      where id=run.id returning * into run;
  exception
    -- Roll back this pass's task mutations, but retain a safe failure record.
    -- Never persist SQLERRM: it may contain private business data.
    when query_canceled then
      update public.platform_automation_runs set finished_at=clock_timestamp(),error_code='timeout' where id=run.id returning * into run;
    when others then
      update public.platform_automation_runs set finished_at=clock_timestamp(),error_code='operation_failed' where id=run.id returning * into run;
  end;
  return to_jsonb(run);
end;
$$;
revoke all on function private.run_platform_automations(text) from public,anon,authenticated;

create function private.admin_run_operations() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.lock_sales_admin();
  return private.run_platform_automations('manual');
end;
$$;
create function private.admin_save_automation(p_rule text,p_enabled boolean,p_threshold_hours integer,p_expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare item public.platform_automation_rules;
begin
  perform private.lock_sales_admin();
  if not pg_try_advisory_xact_lock(hashtextextended('web-fidelize:platform-operations',0)) then raise exception 'operations busy'; end if;
  if p_rule is null or p_rule not in ('lead_followup','lead_idle','trial_ending','support_waiting') or p_enabled is null
    or p_threshold_hours is null or p_threshold_hours not between 1 and 720 or p_expected_updated_at is null or not isfinite(p_expected_updated_at) then
    raise exception 'invalid automation settings';
  end if;
  select * into item from public.platform_automation_rules where id=p_rule for update;
  if not found then raise exception 'invalid automation settings'; end if;
  if item.updated_at <> p_expected_updated_at then raise exception 'operations version conflict'; end if;
  update public.platform_automation_rules set enabled=p_enabled,threshold_hours=p_threshold_hours,updated_at=greatest(clock_timestamp(),item.updated_at+interval '1 microsecond')
    where id=p_rule returning * into item;
  return to_jsonb(item);
end;
$$;
create function private.admin_manage_task(p_id uuid,p_action text,p_expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare item public.platform_tasks; stamp timestamptz := clock_timestamp();
begin
  perform private.lock_sales_admin();
  if not pg_try_advisory_xact_lock(hashtextextended('web-fidelize:platform-operations',0)) then raise exception 'operations busy'; end if;
  if p_id is null or p_action is null or p_action not in ('done','reopen','snooze24h') or p_expected_updated_at is null or not isfinite(p_expected_updated_at) then
    raise exception 'invalid task action';
  end if;
  select * into item from public.platform_tasks where id=p_id for update;
  if not found then raise exception 'task unavailable'; end if;
  if item.updated_at <> p_expected_updated_at then raise exception 'operations version conflict'; end if;
  if (p_action in ('done','snooze24h') and item.status <> 'open') or (p_action='reopen' and item.status <> 'done') then raise exception 'invalid task action'; end if;
  update public.platform_tasks set status=case when p_action='done' then 'done' else 'open' end,
    snoozed_until=case when p_action='snooze24h' then stamp+interval '24 hours' else null end,
    completed_at=case when p_action='done' then stamp else null end,
    updated_at=greatest(stamp,item.updated_at+interval '1 microsecond')
    where id=p_id returning * into item;
  return to_jsonb(item);
end;
$$;

create function private.admin_operations_summary() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare companies jsonb; sales jsonb; support jsonb; tasks jsonb; last_run jsonb; last_scheduled_run jsonb;
  stamp timestamptz := clock_timestamp(); trial_hours integer; support_hours integer;
begin
  perform private.lock_sales_admin();
  select threshold_hours into trial_hours from public.platform_automation_rules where id='trial_ending';
  select threshold_hours into support_hours from public.platform_automation_rules where id='support_waiting';
  select jsonb_build_object(
    'total',count(*) filter(where not is_demo),'demo',count(*) filter(where is_demo),
    'pending_card',count(*) filter(where not is_demo and status='pending_card'),
    'trialing',count(*) filter(where not is_demo and status='trialing' and trial_ends_at>stamp),
    'active',count(*) filter(where not is_demo and status='active'),
    'expiring',count(*) filter(where not is_demo and status='trialing' and trial_ends_at>stamp and trial_ends_at<=stamp+make_interval(hours=>trial_hours)),
    'expired',count(*) filter(where not is_demo and status='trialing' and trial_ends_at<=stamp),
    'suspended',count(*) filter(where not is_demo and status='suspended'),
    'canceled',count(*) filter(where not is_demo and status='canceled')) into companies from public.companies;
  select jsonb_build_object('open',count(*) filter(where stage not in ('won','lost')),
    'overdue',count(*) filter(where stage not in ('won','lost') and next_contact_at<stamp),
    'new',count(*) filter(where stage='new')) into sales from public.sales_leads;
  select jsonb_build_object('open',count(*) filter(where t.status in ('open','in_progress')),
    'waiting',count(*) filter(where t.status in ('open','in_progress') and t.updated_at<=stamp-make_interval(hours=>support_hours)))
    into support from public.support_tickets t join public.companies c on c.id=t.company_id and not c.is_demo;
  select jsonb_build_object('open',count(*) filter(where status='open'),'done',count(*) filter(where status='done')) into tasks from public.platform_tasks;
  select to_jsonb(r) into last_run from public.platform_automation_runs r order by started_at desc,id limit 1;
  select to_jsonb(r) into last_scheduled_run from public.platform_automation_runs r where trigger='scheduled' order by started_at desc,id limit 1;
  return jsonb_build_object('companies',companies,'sales',sales,'support',support,'tasks',tasks,'last_run',last_run,'last_scheduled_run',last_scheduled_run);
end;
$$;

create function public.admin_run_operations() returns jsonb language sql security invoker set search_path='' as $$select private.admin_run_operations()$$;
create function public.admin_save_automation(p_rule text,p_enabled boolean,p_threshold_hours integer,p_expected_updated_at timestamptz) returns jsonb
  language sql security invoker set search_path='' as $$select private.admin_save_automation(p_rule,p_enabled,p_threshold_hours,p_expected_updated_at)$$;
create function public.admin_manage_task(p_id uuid,p_action text,p_expected_updated_at timestamptz) returns jsonb
  language sql security invoker set search_path='' as $$select private.admin_manage_task(p_id,p_action,p_expected_updated_at)$$;
create function public.admin_operations_summary() returns jsonb language sql security invoker set search_path='' as $$select private.admin_operations_summary()$$;
revoke all on function private.admin_run_operations(),private.admin_save_automation(text,boolean,integer,timestamptz),private.admin_manage_task(uuid,text,timestamptz),private.admin_operations_summary(),
  public.admin_run_operations(),public.admin_save_automation(text,boolean,integer,timestamptz),public.admin_manage_task(uuid,text,timestamptz),public.admin_operations_summary() from public,anon,authenticated;
grant execute on function private.admin_run_operations(),private.admin_save_automation(text,boolean,integer,timestamptz),private.admin_manage_task(uuid,text,timestamptz),private.admin_operations_summary(),
  public.admin_run_operations(),public.admin_save_automation(text,boolean,integer,timestamptz),public.admin_manage_task(uuid,text,timestamptz),public.admin_operations_summary() to authenticated;
