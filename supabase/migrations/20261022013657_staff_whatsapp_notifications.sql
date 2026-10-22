-- Staff alerts are independent opt-ins. A company cannot opt in on behalf of a
-- worker, and neither queue stores a browser-readable phone or customer payload.
alter table public.whatsapp_settings
  add column staff_daily_enabled boolean not null default false,
  add column staff_daily_time time not null default '08:00',
  add column staff_new_appointment_enabled boolean not null default false;

create table private.whatsapp_staff_preferences (
  company_id uuid not null references public.companies(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  phone text not null check(phone ~ '^55[1-9][1-9][0-9]{8,9}$'),
  opted_in_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  primary key(company_id,user_id)
);
create index whatsapp_staff_preferences_phone_idx on private.whatsapp_staff_preferences(company_id,phone) where revoked_at is null;
-- A checked empty day is still a completed daily run. Later appointments use
-- the new-event alert instead of causing a second daily summary and charge.
create table private.whatsapp_staff_daily_runs (
  company_id uuid not null references public.companies(id),
  professional_id uuid not null,
  local_date date not null,
  checked_at timestamptz not null default clock_timestamp(),
  primary key(company_id,professional_id,local_date),
  foreign key(company_id,professional_id) references public.professionals(company_id,id)
);
create table public.whatsapp_staff_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  professional_id uuid not null,
  kind text not null check(kind in ('daily','new_appointment')),
  local_date date not null,
  appointment_id uuid references public.appointments(id),
  starts_at timestamptz,
  part_index integer not null default 1 check(part_index between 1 and 1000),
  part_count integer not null default 1 check(part_count between 1 and 1000 and part_index<=part_count),
  status text not null default 'queued' check(status in ('queued','claimed','sending','accepted','sent','delivered','read','failed','unknown','canceled','limit_reached')),
  consumed_at timestamptz,
  error_code text check(error_code in ('provider_rejected','network_unknown','worker_interrupted','invalid_recipient','not_eligible','limit_reached','delivery_failed')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key(company_id,professional_id) references public.professionals(company_id,id),
  check((kind='daily' and appointment_id is null and starts_at is null) or (kind='new_appointment' and appointment_id is not null and starts_at is not null and part_count=1))
);
create unique index whatsapp_staff_daily_once_idx on public.whatsapp_staff_notifications(company_id,professional_id,local_date,part_index) where kind='daily';
create unique index whatsapp_staff_new_once_idx on public.whatsapp_staff_notifications(appointment_id) where kind='new_appointment';
create index whatsapp_staff_notifications_company_created_idx on public.whatsapp_staff_notifications(company_id,created_at desc,id);
create index whatsapp_staff_notifications_usage_idx on public.whatsapp_staff_notifications(company_id,consumed_at) where consumed_at is not null;
create index whatsapp_staff_notifications_pending_idx on public.whatsapp_staff_notifications(company_id,updated_at,id) where status in ('queued','claimed','sending');
create index whatsapp_staff_notifications_professional_idx on public.whatsapp_staff_notifications(professional_id);
create table private.whatsapp_staff_payloads (
  job_id uuid primary key references public.whatsapp_staff_notifications(id),
  user_id uuid not null references auth.users(id),
  recipient text not null,
  consent_at timestamptz not null,
  message_id text unique check(length(message_id) between 1 and 512)
);
create index whatsapp_staff_payloads_user_idx on private.whatsapp_staff_payloads(user_id);
create table private.whatsapp_staff_items (
  job_id uuid not null references public.whatsapp_staff_notifications(id),
  appointment_id uuid not null references public.appointments(id),
  starts_at timestamptz not null,
  customer_id uuid not null,
  service_id uuid not null,
  primary key(job_id,appointment_id)
);
create index whatsapp_staff_items_appointment_idx on private.whatsapp_staff_items(appointment_id);
alter table private.whatsapp_staff_preferences enable row level security;
alter table private.whatsapp_staff_daily_runs enable row level security;
alter table public.whatsapp_staff_notifications enable row level security;
alter table private.whatsapp_staff_payloads enable row level security;
alter table private.whatsapp_staff_items enable row level security;
revoke all on private.whatsapp_staff_preferences,private.whatsapp_staff_daily_runs,public.whatsapp_staff_notifications,private.whatsapp_staff_payloads,private.whatsapp_staff_items from public,anon,authenticated;
grant select on public.whatsapp_staff_notifications to authenticated;
create policy whatsapp_staff_notifications_read on public.whatsapp_staff_notifications for select to authenticated using(private.member_role(company_id) in ('OWNER','MANAGER'));

create function private.save_whatsapp_staff_settings(p_company uuid,p_daily_enabled boolean,p_daily_time text,p_new_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_business_company(p_company);
  if p_daily_enabled is null or p_new_enabled is null or p_daily_time is null or p_daily_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'invalid staff whatsapp settings'; end if;
  insert into public.whatsapp_settings(company_id,staff_daily_enabled,staff_daily_time,staff_new_appointment_enabled)
    values(p_company,p_daily_enabled,p_daily_time::time,p_new_enabled)
    on conflict(company_id) do update set staff_daily_enabled=excluded.staff_daily_enabled,staff_daily_time=excluded.staff_daily_time,
      staff_new_appointment_enabled=excluded.staff_new_appointment_enabled,updated_at=clock_timestamp();
end; $$;

create function private.get_my_whatsapp_staff_preferences(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or private.member_role(p_company) is null then raise exception 'not authorized'; end if;
  select jsonb_build_object('phone',wp.phone,'enabled',coalesce(wp.revoked_at is null and wp.phone is not null,false),
    'professional_id',pr.id,'professional_name',pr.name) into result
    from (select 1) seed left join private.whatsapp_staff_preferences wp on wp.company_id=p_company and wp.user_id=auth.uid()
    left join public.professionals pr on pr.company_id=p_company and pr.user_id=auth.uid() and pr.archived_at is null;
  return result;
end; $$;

create function private.save_my_whatsapp_staff_preferences(p_company uuid,p_phone text,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
declare phone text;
begin
  if auth.uid() is null or private.member_role(p_company) is null then raise exception 'not authorized'; end if;
  perform 1 from public.companies where id=p_company for update;
  if not found or private.member_role(p_company) is null then raise exception 'not authorized'; end if;
  if p_enabled is null then raise exception 'invalid staff whatsapp consent'; end if;
  if not p_enabled then
    update private.whatsapp_staff_preferences set revoked_at=coalesce(revoked_at,clock_timestamp()) where company_id=p_company and user_id=auth.uid();
    return;
  end if;
  if not private.writable(p_company) then raise exception 'subscription blocked'; end if;
  if not exists(select 1 from public.professionals where company_id=p_company and user_id=auth.uid() and archived_at is null) then raise exception 'professional unavailable'; end if;
  if ltrim(p_phone) like '+%' and regexp_replace(p_phone,'[^0-9]','','g') !~ '^55[1-9][1-9][0-9]{8,9}$' then raise exception 'invalid whatsapp phone'; end if;
  phone:=private.whatsapp_phone(p_phone);
  if phone is null then raise exception 'invalid whatsapp phone'; end if;
  insert into private.whatsapp_staff_preferences(company_id,user_id,phone) values(p_company,auth.uid(),phone)
    on conflict(company_id,user_id) do update set phone=excluded.phone,opted_in_at=clock_timestamp(),revoked_at=null;
end; $$;

create function private.revoke_changed_whatsapp_staff_member() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.user_id is not null and (new.user_id is distinct from old.user_id or new.archived_at is not null) then
    update private.whatsapp_staff_preferences set revoked_at=coalesce(revoked_at,clock_timestamp()) where company_id=old.company_id and user_id=old.user_id;
  end if;
  return new;
end; $$;
create trigger revoke_changed_whatsapp_staff_member after update of user_id,archived_at on public.professionals for each row execute function private.revoke_changed_whatsapp_staff_member();

create function private.revoke_removed_whatsapp_staff_member() returns trigger language plpgsql security definer set search_path='' as $$
begin
  update private.whatsapp_staff_preferences set revoked_at=coalesce(revoked_at,clock_timestamp()) where company_id=old.company_id and user_id=old.user_id;
  return old;
end; $$;
create trigger revoke_removed_whatsapp_staff_member after delete on public.memberships for each row execute function private.revoke_removed_whatsapp_staff_member();

create function private.expire_changed_whatsapp_staff_items() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if row(new.starts_at,new.customer_id,new.service_id,new.professional_id) is distinct from row(old.starts_at,old.customer_id,old.service_id,old.professional_id)
    or (new.status<>'scheduled' and old.status='scheduled') then
    delete from private.whatsapp_staff_items i using public.whatsapp_staff_notifications n
      where i.job_id=n.id and i.appointment_id=new.id and n.status in ('queued','claimed');
  end if;
  return new;
end; $$;
create trigger expire_changed_whatsapp_staff_items after update on public.appointments for each row execute function private.expire_changed_whatsapp_staff_items();

-- Capture new events at creation, never by backfilling historical appointments
-- after settings or consent are enabled. No external request runs in a trigger.
create function private.queue_whatsapp_staff_new_appointment() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient record; job uuid;
begin
  if new.status<>'scheduled' or new.starts_at<=clock_timestamp() then return new; end if;
  perform 1 from public.companies where id=new.company_id for update;
  select pr.user_id,wp.phone,wp.opted_in_at into recipient
    from public.companies c join public.whatsapp_settings ws on ws.company_id=c.id and ws.staff_new_appointment_enabled
    join public.professionals pr on pr.company_id=c.id and pr.id=new.professional_id and pr.archived_at is null
    join public.memberships m on m.company_id=c.id and m.user_id=pr.user_id
    join private.whatsapp_staff_preferences wp on wp.company_id=c.id and wp.user_id=pr.user_id and wp.revoked_at is null
    where c.id=new.company_id and (c.status='active' or (c.status='trialing' and c.trial_ends_at>clock_timestamp()));
  if not found then return new; end if;
  insert into public.whatsapp_staff_notifications(company_id,professional_id,kind,local_date,appointment_id,starts_at)
    values(new.company_id,new.professional_id,'new_appointment',(new.starts_at at time zone 'America/Sao_Paulo')::date,new.id,new.starts_at)
    on conflict do nothing returning id into job;
  if job is not null then
    insert into private.whatsapp_staff_payloads(job_id,user_id,recipient,consent_at) values(job,recipient.user_id,recipient.phone,recipient.opted_in_at);
    insert into private.whatsapp_staff_items values(job,new.id,new.starts_at,new.customer_id,new.service_id);
  end if;
  return new;
end; $$;
create trigger queue_whatsapp_staff_new_appointment after insert on public.appointments for each row execute function private.queue_whatsapp_staff_new_appointment();

create function private.whatsapp_staff_job_data(p_job uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('job_id',n.id,'company_id',n.company_id,'kind',n.kind,'professional_id',n.professional_id,
    'professional_name',pr.name,'company_name',c.name,'recipient',p.recipient,'local_date',n.local_date,
    'part_index',n.part_index,'part_count',n.part_count,'appointments',coalesce((
      select jsonb_agg(jsonb_build_object('appointment_id',a.id,'starts_at',a.starts_at,'customer_name',cu.name,'service_name',s.name) order by a.starts_at,a.id)
      from private.whatsapp_staff_items i join public.appointments a on a.id=i.appointment_id and a.company_id=n.company_id
        and a.professional_id=n.professional_id and a.starts_at=i.starts_at and a.customer_id=i.customer_id and a.service_id=i.service_id and a.status='scheduled'
      join public.customers cu on cu.company_id=a.company_id and cu.id=a.customer_id and cu.archived_at is null
      join public.services s on s.company_id=a.company_id and s.id=a.service_id and s.archived_at is null
      where i.job_id=n.id and (n.kind='daily' or a.starts_at>now())
    ),'[]'::jsonb))
  from public.whatsapp_staff_notifications n join private.whatsapp_staff_payloads p on p.job_id=n.id
  join public.companies c on c.id=n.company_id join public.professionals pr on pr.company_id=n.company_id and pr.id=n.professional_id where n.id=p_job;
$$;

create function private.claim_whatsapp_staff_notifications(p_secret text,p_companies uuid[],p_batch integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c uuid; person record; entry record; part integer; total integer; job uuid; item_ids uuid[]; payload jsonb; result jsonb:='[]'::jsonb; stamp timestamptz:=clock_timestamp(); day date:=(clock_timestamp() at time zone 'America/Sao_Paulo')::date;
begin
  perform private.check_whatsapp_gateway(p_secret);
  if p_companies is null or cardinality(p_companies) not between 1 and 100 or p_batch is null or p_batch not between 1 and 100 then raise exception 'invalid whatsapp batch'; end if;
  for c in select co.id from public.companies co where co.id=any(p_companies) order by co.id for update skip locked loop
    update public.whatsapp_staff_notifications set status='unknown',error_code='worker_interrupted',updated_at=stamp where company_id=c and status='sending' and updated_at<stamp-interval '15 minutes';
    update public.whatsapp_staff_notifications set status='canceled',error_code='not_eligible',updated_at=stamp where company_id=c and
      ((status='claimed' and updated_at<stamp-interval '15 minutes') or (status='queued' and ((kind='new_appointment' and (created_at<stamp-interval '24 hours' or starts_at<=stamp)) or (kind='daily' and local_date<>day))));
    for person in
      select pr.id,pr.user_id,wp.phone,wp.opted_in_at from public.companies co
      join public.whatsapp_settings ws on ws.company_id=co.id and ws.staff_daily_enabled
      join public.professionals pr on pr.company_id=co.id and pr.archived_at is null
      join public.memberships m on m.company_id=co.id and m.user_id=pr.user_id
      join private.whatsapp_staff_preferences wp on wp.company_id=co.id and wp.user_id=pr.user_id and wp.revoked_at is null
      where co.id=c and (co.status='active' or (co.status='trialing' and co.trial_ends_at>stamp))
        and stamp between ((day+ws.staff_daily_time) at time zone 'America/Sao_Paulo') and ((day+ws.staff_daily_time) at time zone 'America/Sao_Paulo')+interval '60 minutes'
        and not exists(select 1 from private.whatsapp_staff_daily_runs n where n.company_id=c and n.professional_id=pr.id and n.local_date=day)
      order by pr.id
    loop
      insert into private.whatsapp_staff_daily_runs(company_id,professional_id,local_date) values(c,person.id,day);
      select array_agg(a.id order by a.starts_at,a.id) into item_ids from public.appointments a
        join public.customers cu on cu.company_id=c and cu.id=a.customer_id and cu.archived_at is null
        join public.services s on s.company_id=c and s.id=a.service_id and s.archived_at is null
        where a.company_id=c and a.professional_id=person.id and a.status='scheduled'
          and a.starts_at>=(day::timestamp at time zone 'America/Sao_Paulo') and a.starts_at<((day+1)::timestamp at time zone 'America/Sao_Paulo');
      total:=coalesce((cardinality(item_ids)+1)/2,0);
      -- Every appointment is materialized, even when a small worker batch only
      -- claims the first page. Each page has a separate quota and receipt.
      for part in 1..total loop
        insert into public.whatsapp_staff_notifications(company_id,professional_id,kind,local_date,part_index,part_count)
          values(c,person.id,'daily',day,part,total) returning id into job;
        insert into private.whatsapp_staff_payloads(job_id,user_id,recipient,consent_at) values(job,person.user_id,person.phone,person.opted_in_at);
        insert into private.whatsapp_staff_items select job,a.id,a.starts_at,a.customer_id,a.service_id from public.appointments a where a.id=any(item_ids[(part*2-1):(part*2)]) and a.company_id=c;
      end loop;
    end loop;
    for entry in select n.id from public.whatsapp_staff_notifications n where n.company_id=c and n.status='queued'
      order by n.created_at,n.id for update skip locked loop
      payload:=private.whatsapp_staff_job_data(entry.id);
      if jsonb_array_length(payload->'appointments')=0 then
        update public.whatsapp_staff_notifications set status='canceled',error_code='not_eligible',updated_at=stamp where id=entry.id;
        continue;
      end if;
      update public.whatsapp_staff_notifications set status='claimed',updated_at=stamp where id=entry.id;
      result:=result||jsonb_build_array(payload);
      exit when jsonb_array_length(result)>=p_batch;
    end loop;
    exit when jsonb_array_length(result)>=p_batch;
  end loop;
  return result;
end; $$;

-- Both customer and worker sends reserve against this one shared ledger while
-- holding the company row. Ambiguous failures keep their reservation.
create function private.whatsapp_consumed(p_company uuid,p_stamp timestamptz) returns bigint language sql stable security definer set search_path='' as $$
  with bounds as (select date_trunc('month',p_stamp at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' as first)
  select (select count(*) from public.whatsapp_reminders r,bounds b where r.company_id=p_company and r.consumed_at>=b.first and r.consumed_at<b.first+interval '1 month')+
    (select count(*) from public.whatsapp_staff_notifications n,bounds b where n.company_id=p_company and n.consumed_at>=b.first and n.consumed_at<b.first+interval '1 month');
$$;
create or replace function private.whatsapp_usage(p_company uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or (coalesce(private.member_role(p_company),'') not in ('OWNER','MANAGER') and not public.is_super_admin()) then raise exception 'not authorized'; end if;
  return jsonb_build_object('month',to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM'),'consumed',private.whatsapp_consumed(p_company,now()),
    'effective_limit',coalesce((select least(monthly_limit,platform_limit) from public.whatsapp_settings where company_id=p_company),0));
end; $$;

create function private.prepare_whatsapp_staff_notification(p_secret text,p_job uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c uuid; n public.whatsapp_staff_notifications%rowtype; result jsonb; cap integer; stamp timestamptz:=clock_timestamp();
begin
  perform private.check_whatsapp_gateway(p_secret);
  select company_id into c from public.whatsapp_staff_notifications where id=p_job;
  if c is null then return null; end if;
  perform 1 from public.companies where id=c for update;
  select * into n from public.whatsapp_staff_notifications where id=p_job for update;
  if n.status<>'claimed' then return null; end if;
  result:=private.whatsapp_staff_job_data(p_job);
  if jsonb_array_length(result->'appointments')=0 or not exists(
    select 1 from public.companies co join public.whatsapp_settings ws on ws.company_id=co.id
    join public.professionals pr on pr.company_id=co.id and pr.id=n.professional_id and pr.archived_at is null
    join public.memberships m on m.company_id=co.id and m.user_id=pr.user_id
    join private.whatsapp_staff_payloads p on p.job_id=n.id and p.user_id=pr.user_id
    join private.whatsapp_staff_preferences wp on wp.company_id=co.id and wp.user_id=pr.user_id and wp.revoked_at is null and wp.phone=p.recipient and wp.opted_in_at=p.consent_at
    where co.id=c and (co.status='active' or (co.status='trialing' and co.trial_ends_at>stamp))
      and n.updated_at>=stamp-interval '15 minutes'
      and ((n.kind='daily' and ws.staff_daily_enabled and n.local_date=(stamp at time zone 'America/Sao_Paulo')::date
        and stamp between ((n.local_date+ws.staff_daily_time) at time zone 'America/Sao_Paulo') and ((n.local_date+ws.staff_daily_time) at time zone 'America/Sao_Paulo')+interval '60 minutes')
        or (n.kind='new_appointment' and ws.staff_new_appointment_enabled and n.created_at>=stamp-interval '24 hours' and n.starts_at>stamp))
  ) then
    update public.whatsapp_staff_notifications set status='canceled',error_code='not_eligible',updated_at=stamp where id=p_job;
    return null;
  end if;
  select least(monthly_limit,platform_limit) into cap from public.whatsapp_settings where company_id=c;
  if private.whatsapp_consumed(c,stamp)>=coalesce(cap,0) then
    update public.whatsapp_staff_notifications set status='limit_reached',error_code='limit_reached',updated_at=stamp where id=p_job;
    return null;
  end if;
  update public.whatsapp_staff_notifications set status='sending',consumed_at=stamp,updated_at=stamp where id=p_job;
  return result;
end; $$;

create function private.finish_whatsapp_staff_notification(p_secret text,p_job uuid,p_status text,p_message_id text default null,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare c uuid; n public.whatsapp_staff_notifications%rowtype; message text;
begin
  perform private.check_whatsapp_gateway(p_secret);
  if p_status is null or p_status not in ('accepted','failed','unknown') or (p_status='accepted' and (p_message_id is null or length(p_message_id) not between 1 and 512))
    or (p_error is not null and p_error not in ('provider_rejected','network_unknown','worker_interrupted','invalid_recipient','delivery_failed')) then raise exception 'invalid whatsapp result'; end if;
  select company_id into c from public.whatsapp_staff_notifications where id=p_job;
  if c is null then return false; end if;
  perform 1 from public.companies where id=c for update;
  select * into n from public.whatsapp_staff_notifications where id=p_job for update;
  select message_id into message from private.whatsapp_staff_payloads where job_id=p_job;
  if message is not null and p_message_id is not null and message<>p_message_id then return false; end if;
  if n.status not in ('sending','unknown') then return n.status in ('accepted','sent','delivered','read') and p_status='accepted' and message=p_message_id; end if;
  if p_message_id is not null then
    if exists(select 1 from private.whatsapp_staff_payloads where message_id=p_message_id and job_id<>p_job)
      or exists(select 1 from private.whatsapp_payloads where message_id=p_message_id) then return false; end if;
    update private.whatsapp_staff_payloads set message_id=p_message_id where job_id=p_job;
  end if;
  update public.whatsapp_staff_notifications set status=p_status,error_code=case when p_status='accepted' then null else p_error end,updated_at=clock_timestamp() where id=p_job;
  return true;
end; $$;

create function private.whatsapp_staff_delivery_event(p_secret text,p_company uuid,p_job uuid,p_message_id text,p_status text,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare n public.whatsapp_staff_notifications%rowtype; message text; job uuid; current_rank integer; incoming_rank integer;
begin
  perform private.check_whatsapp_gateway(p_secret);
  if p_message_id is null or length(p_message_id) not between 1 and 512 or p_status is null or p_status not in ('sent','delivered','read','failed')
    or (p_error is not null and p_error not in ('provider_rejected','network_unknown','worker_interrupted','invalid_recipient','delivery_failed')) then raise exception 'invalid whatsapp event'; end if;
  perform 1 from public.companies where id=p_company for update;
  job:=coalesce(p_job,(select p.job_id from private.whatsapp_staff_payloads p join public.whatsapp_staff_notifications w on w.id=p.job_id where p.message_id=p_message_id and w.company_id=p_company));
  select * into n from public.whatsapp_staff_notifications where id=job and company_id=p_company for update;
  if not found or n.consumed_at is null or n.status in ('queued','claimed','canceled','limit_reached') then return false; end if;
  select message_id into message from private.whatsapp_staff_payloads where job_id=job;
  if message is not null and message<>p_message_id then return false; end if;
  if exists(select 1 from private.whatsapp_staff_payloads where message_id=p_message_id and job_id<>job)
    or exists(select 1 from private.whatsapp_payloads where message_id=p_message_id) then return false; end if;
  update private.whatsapp_staff_payloads set message_id=p_message_id where job_id=job;
  current_rank:=case n.status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end;
  incoming_rank:=case p_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end;
  if incoming_rank>current_rank or (p_status='failed' and current_rank<2) then
    update public.whatsapp_staff_notifications set status=p_status,error_code=case when p_status='failed' then coalesce(p_error,'delivery_failed') end,updated_at=clock_timestamp() where id=job;
  end if;
  return true;
end; $$;

create or replace function private.whatsapp_opt_out(p_secret text,p_company uuid,p_phone text) returns boolean language plpgsql security definer set search_path='' as $$
declare v_phone text; customers integer; staff integer;
begin
  perform private.check_whatsapp_gateway(p_secret);
  v_phone:=private.whatsapp_phone(p_phone);
  if v_phone is null then return false; end if;
  perform 1 from public.companies where id=p_company for update;
  update public.whatsapp_consents set revoked_at=coalesce(revoked_at,clock_timestamp()) where company_id=p_company and whatsapp_consents.phone=v_phone;
  get diagnostics customers=row_count;
  update private.whatsapp_staff_preferences set revoked_at=coalesce(revoked_at,clock_timestamp()) where company_id=p_company and whatsapp_staff_preferences.phone=v_phone;
  get diagnostics staff=row_count;
  return customers+staff>0;
end; $$;

create function public.save_whatsapp_staff_settings(p_company uuid,p_daily_enabled boolean,p_daily_time text,p_new_enabled boolean) returns void language sql security invoker set search_path='' as $$select private.save_whatsapp_staff_settings(p_company,p_daily_enabled,p_daily_time,p_new_enabled)$$;
create function public.get_my_whatsapp_staff_preferences(p_company uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.get_my_whatsapp_staff_preferences(p_company)$$;
create function public.save_my_whatsapp_staff_preferences(p_company uuid,p_phone text,p_enabled boolean) returns void language sql security invoker set search_path='' as $$select private.save_my_whatsapp_staff_preferences(p_company,p_phone,p_enabled)$$;
create function public.claim_whatsapp_staff_notifications(p_secret text,p_companies uuid[],p_batch integer default 25) returns jsonb language sql security invoker set search_path='' as $$select private.claim_whatsapp_staff_notifications(p_secret,p_companies,p_batch)$$;
create function public.prepare_whatsapp_staff_notification(p_secret text,p_job uuid) returns jsonb language sql security invoker set search_path='' as $$select private.prepare_whatsapp_staff_notification(p_secret,p_job)$$;
create function public.finish_whatsapp_staff_notification(p_secret text,p_job uuid,p_status text,p_message_id text default null,p_error text default null) returns boolean language sql security invoker set search_path='' as $$select private.finish_whatsapp_staff_notification(p_secret,p_job,p_status,p_message_id,p_error)$$;
create function public.whatsapp_staff_delivery_event(p_secret text,p_company uuid,p_job uuid,p_message_id text,p_status text,p_error text default null) returns boolean language sql security invoker set search_path='' as $$select private.whatsapp_staff_delivery_event(p_secret,p_company,p_job,p_message_id,p_status,p_error)$$;

revoke all on function private.revoke_changed_whatsapp_staff_member(),private.revoke_removed_whatsapp_staff_member(),private.expire_changed_whatsapp_staff_items(),private.queue_whatsapp_staff_new_appointment(),private.whatsapp_staff_job_data(uuid),private.whatsapp_consumed(uuid,timestamptz) from public,anon,authenticated;
do $$ declare f text; begin
  foreach f in array array['save_whatsapp_staff_settings(uuid,boolean,text,boolean)','get_my_whatsapp_staff_preferences(uuid)','save_my_whatsapp_staff_preferences(uuid,text,boolean)'] loop
    execute 'revoke all on function public.'||f||',private.'||f||' from public,anon,authenticated';
    execute 'grant execute on function public.'||f||',private.'||f||' to authenticated';
  end loop;
  foreach f in array array['claim_whatsapp_staff_notifications(text,uuid[],integer)','prepare_whatsapp_staff_notification(text,uuid)','finish_whatsapp_staff_notification(text,uuid,text,text,text)','whatsapp_staff_delivery_event(text,uuid,uuid,text,text,text)'] loop
    execute 'revoke all on function public.'||f||',private.'||f||' from public,anon,authenticated';
    execute 'grant execute on function public.'||f||',private.'||f||' to anon,authenticated';
  end loop;
end; $$;
create or replace function private.prepare_whatsapp_reminder(p_secret text,p_job uuid,p_token_hash text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c uuid; r public.whatsapp_reminders%rowtype; cap integer; used bigint; stamp timestamptz := clock_timestamp(); month_start timestamptz;
begin
  perform private.check_whatsapp_gateway(p_secret);
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid whatsapp token'; end if;
  select company_id into c from public.whatsapp_reminders where id=p_job;
  if c is null then return null; end if;
  perform 1 from public.companies where id=c for update;
  select * into r from public.whatsapp_reminders where id=p_job for update;
  if r.status<>'claimed' then return null; end if;
  if not exists (
    select 1 from public.appointments a join public.companies co on co.id=a.company_id
    join public.whatsapp_settings ws on ws.company_id=co.id and ws.enabled and r.offset_minutes=any(ws.offsets_minutes)
    join private.whatsapp_payloads wp on wp.job_id=r.id and wp.customer_id=a.customer_id
    join public.customers cu on cu.company_id=co.id and cu.id=a.customer_id and cu.archived_at is null and private.whatsapp_phone(cu.phone)=wp.recipient
    join public.services s on s.company_id=co.id and s.id=a.service_id and s.archived_at is null
    join public.professionals pr on pr.company_id=co.id and pr.id=a.professional_id and pr.archived_at is null
    join public.whatsapp_consents wc on wc.company_id=co.id and wc.customer_id=a.customer_id and wc.revoked_at is null and wc.phone=wp.recipient and wc.opted_in_at=wp.consent_at
    where a.id=r.appointment_id and a.company_id=c and a.status='scheduled' and a.starts_at=r.starts_at and a.starts_at>stamp
      and (co.status='active' or (co.status='trialing' and co.trial_ends_at>stamp))
      and r.starts_at-make_interval(mins=>r.offset_minutes) between stamp-interval '15 minutes' and stamp
  ) then
    update public.whatsapp_reminders set status='canceled',error_code='not_eligible',updated_at=stamp where id=p_job;
    return null;
  end if;
  month_start := date_trunc('month',stamp at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  select least(monthly_limit,platform_limit) into cap from public.whatsapp_settings where company_id=c;
  used := private.whatsapp_consumed(c,stamp);
  if used>=coalesce(cap,0) then
    update public.whatsapp_reminders set status='limit_reached',error_code='limit_reached',updated_at=stamp where id=p_job;
    return null;
  end if;
  -- Reservation never refunds on timeout or ambiguous provider result; no duplicate retry.
  update public.whatsapp_reminders set status='sending',consumed_at=stamp,updated_at=stamp where id=p_job;
  update private.whatsapp_payloads set token_hash=p_token_hash,token_expires_at=r.starts_at where job_id=p_job;
  return private.whatsapp_job_data(p_job);
end;
$$;
