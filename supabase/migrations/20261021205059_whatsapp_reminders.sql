-- Official WhatsApp integration. Closed by default: no credentials, quota or consent is inferred.
alter table public.appointments add column attendance_confirmed_at timestamptz;
create function private.reset_whatsapp_attendance() returns trigger language plpgsql set search_path = '' as $$
begin
  if row(new.starts_at,new.ends_at) is distinct from row(old.starts_at,old.ends_at) or new.status = 'canceled' then
    new.attendance_confirmed_at := null;
  end if;
  return new;
end;
$$;
create trigger reset_whatsapp_attendance before update on public.appointments for each row execute function private.reset_whatsapp_attendance();
revoke all on function private.reset_whatsapp_attendance() from public,anon,authenticated;

create table public.whatsapp_settings (
  company_id uuid primary key references public.companies(id),
  enabled boolean not null default false,
  offsets_minutes integer[] not null default '{1440}' check (cardinality(offsets_minutes) between 1 and 3),
  monthly_limit integer not null default 100 check (monthly_limit between 0 and 100000),
  platform_limit integer not null default 0 check (platform_limit between 0 and 100000),
  updated_at timestamptz not null default now()
);
create table public.whatsapp_consents (
  company_id uuid not null references public.companies(id),
  customer_id uuid not null,
  phone text not null check (phone ~ '^55[1-9][1-9][0-9]{8,9}$'),
  opted_in_at timestamptz not null default now(),
  revoked_at timestamptz,
  source text not null check (source in ('manual','booking')),
  actor_id uuid references auth.users(id) on delete set null,
  primary key(company_id,customer_id),
  foreign key(company_id,customer_id) references public.customers(company_id,id)
);
create index whatsapp_consents_phone_idx on public.whatsapp_consents(company_id,phone) where revoked_at is null;
create table public.whatsapp_reminders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  appointment_id uuid not null references public.appointments(id),
  starts_at timestamptz not null,
  offset_minutes integer not null check (offset_minutes between 30 and 10080),
  status text not null default 'claimed' check (status in ('claimed','sending','accepted','sent','delivered','read','failed','unknown','canceled','limit_reached')),
  consumed_at timestamptz,
  error_code text check (error_code in ('provider_rejected','network_unknown','worker_interrupted','invalid_recipient','not_eligible','limit_reached','delivery_failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(appointment_id,starts_at,offset_minutes)
);
create index whatsapp_reminders_company_created_idx on public.whatsapp_reminders(company_id,created_at desc,id);
create index whatsapp_reminders_usage_idx on public.whatsapp_reminders(company_id,consumed_at) where consumed_at is not null;
create index whatsapp_reminders_pending_idx on public.whatsapp_reminders(company_id,updated_at) where status in ('claimed','sending');
create table private.whatsapp_gateway_config (
  singleton boolean primary key default true check(singleton),
  secret_hash text check (secret_hash ~ '^[a-f0-9]{64}$')
);
insert into private.whatsapp_gateway_config(singleton) values(true);
create table private.whatsapp_payloads (
  job_id uuid primary key references public.whatsapp_reminders(id),
  customer_id uuid not null references public.customers(id),
  recipient text not null,
  consent_at timestamptz not null,
  token_hash text unique check (token_hash ~ '^[a-f0-9]{64}$'),
  token_expires_at timestamptz,
  message_id text unique check(length(message_id) between 1 and 512)
);
-- Keep the capability available for opt-out, but permanently expire attendance
-- after a schedule change (even when moved away and later back to the same time).
create function private.expire_whatsapp_confirmation() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if row(new.starts_at,new.ends_at,new.customer_id) is distinct from row(old.starts_at,old.ends_at,old.customer_id) or (new.status='canceled' and old.status<>'canceled') then
    update private.whatsapp_payloads set token_expires_at=least(token_expires_at,clock_timestamp())
      where job_id in (select id from public.whatsapp_reminders where appointment_id=new.id);
  end if;
  return new;
end;
$$;
create trigger expire_whatsapp_confirmation after update on public.appointments for each row execute function private.expire_whatsapp_confirmation();
revoke all on function private.expire_whatsapp_confirmation() from public,anon,authenticated;
alter table public.whatsapp_settings enable row level security;
alter table public.whatsapp_consents enable row level security;
alter table public.whatsapp_reminders enable row level security;
alter table private.whatsapp_gateway_config enable row level security;
alter table private.whatsapp_payloads enable row level security;
revoke all on public.whatsapp_settings,public.whatsapp_consents,public.whatsapp_reminders,private.whatsapp_gateway_config,private.whatsapp_payloads from public,anon,authenticated;
grant select on public.whatsapp_settings,public.whatsapp_consents,public.whatsapp_reminders to authenticated;
create policy whatsapp_settings_read on public.whatsapp_settings for select to authenticated using(private.member_role(company_id) in ('OWNER','MANAGER') or (select public.is_super_admin()));
create policy whatsapp_consents_read on public.whatsapp_consents for select to authenticated using(private.member_role(company_id) in ('OWNER','MANAGER'));
create policy whatsapp_reminders_read on public.whatsapp_reminders for select to authenticated using(private.member_role(company_id) in ('OWNER','MANAGER'));

create function private.whatsapp_phone(p_phone text) returns text language plpgsql immutable set search_path = '' as $$
declare result text;
begin
  if p_phone is null or length(p_phone)>30 or p_phone ~ '[^0-9[:space:]()+.-]' then return null; end if;
  result := regexp_replace(p_phone,'[^0-9]','','g');
  if result ~ '^[1-9][1-9][0-9]{8,9}$' then result := '55' || result; end if;
  if result !~ '^55[1-9][1-9][0-9]{8,9}$' then return null; end if;
  return result;
end;
$$;
create function private.check_whatsapp_gateway(p_secret text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is null or length(p_secret) not between 32 and 1024 or not exists (
    select 1 from private.whatsapp_gateway_config where singleton and secret_hash = encode(sha256(convert_to(p_secret,'UTF8')),'hex')
  ) then raise exception 'whatsapp gateway unauthorized'; end if;
end;
$$;
create function private.revoke_changed_whatsapp_phone() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.whatsapp_phone(new.phone) is distinct from private.whatsapp_phone(old.phone) then
    update public.whatsapp_consents set revoked_at=coalesce(revoked_at,clock_timestamp()) where company_id=new.company_id and customer_id=new.id;
    update private.whatsapp_payloads set token_expires_at=least(token_expires_at,clock_timestamp()) where customer_id=new.id;
  end if;
  return new;
end;
$$;
create trigger revoke_changed_whatsapp_phone after update of phone on public.customers for each row execute function private.revoke_changed_whatsapp_phone();
revoke all on function private.revoke_changed_whatsapp_phone() from public,anon,authenticated;
create function private.save_whatsapp_settings(p_company uuid,p_enabled boolean,p_offsets integer[],p_limit integer) returns void language plpgsql security definer set search_path = '' as $$
declare offsets integer[];
begin
  perform private.lock_business_company(p_company);
  if p_enabled is null or p_limit is null or p_limit not between 0 and 100000 or p_offsets is null or cardinality(p_offsets) not between 1 and 3
    or array_ndims(p_offsets) <> 1 or exists(select 1 from unnest(p_offsets) x where x is null or x not between 30 and 10080)
    or (select count(distinct x) from unnest(p_offsets) x) <> cardinality(p_offsets) then raise exception 'invalid whatsapp settings'; end if;
  select array_agg(x order by x desc) into offsets from unnest(p_offsets) x;
  insert into public.whatsapp_settings(company_id,enabled,offsets_minutes,monthly_limit) values(p_company,p_enabled,offsets,p_limit)
    on conflict(company_id) do update set enabled=excluded.enabled,offsets_minutes=excluded.offsets_minutes,monthly_limit=excluded.monthly_limit,updated_at=clock_timestamp();
end;
$$;
create function private.admin_set_whatsapp_limit(p_company uuid,p_limit integer) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.lock_sales_admin();
  if p_company is null or p_limit is null or p_limit not between 0 and 100000 then raise exception 'invalid whatsapp settings'; end if;
  perform 1 from public.companies where id=p_company for update;
  if not found then raise exception 'company unavailable'; end if;
  insert into public.whatsapp_settings(company_id,platform_limit) values(p_company,p_limit)
    on conflict(company_id) do update set platform_limit=excluded.platform_limit,updated_at=clock_timestamp();
end;
$$;
create function private.whatsapp_usage(p_company uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare month_start timestamptz := date_trunc('month',now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'; result jsonb;
begin
  if auth.uid() is null or (coalesce(private.member_role(p_company),'') not in ('OWNER','MANAGER') and not public.is_super_admin()) then raise exception 'not authorized'; end if;
  select jsonb_build_object('month',to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM'),'consumed',
    (select count(*) from public.whatsapp_reminders where company_id=p_company and consumed_at>=month_start and consumed_at < month_start+interval '1 month'),
    'effective_limit',coalesce((select least(monthly_limit,platform_limit) from public.whatsapp_settings where company_id=p_company),0)) into result;
  return result;
end;
$$;
create function private.set_whatsapp_consent(p_company uuid,p_customer uuid,p_allowed boolean) returns void language plpgsql security definer set search_path = '' as $$
declare phone text;
begin
  if auth.uid() is null or coalesce(private.member_role(p_company),'') not in ('OWNER','MANAGER') then raise exception 'not authorized'; end if;
  perform 1 from public.companies where id=p_company for update;
  if not found or coalesce(private.member_role(p_company),'') not in ('OWNER','MANAGER') then raise exception 'not authorized'; end if;
  if p_allowed is null then raise exception 'invalid whatsapp consent'; end if;
  -- Unsubscribing remains possible after trial/subscription expiry.
  if p_allowed and not private.writable(p_company) then raise exception 'subscription blocked'; end if;
  select private.whatsapp_phone(c.phone) into phone from public.customers c where c.company_id=p_company and c.id=p_customer and c.archived_at is null;
  if not found then raise exception 'customer unavailable'; end if;
  if not p_allowed then
    update public.whatsapp_consents set revoked_at=coalesce(revoked_at,clock_timestamp()) where company_id=p_company and customer_id=p_customer;
    return;
  end if;
  if phone is null then raise exception 'invalid whatsapp phone'; end if;
  insert into public.whatsapp_consents(company_id,customer_id,phone,source,actor_id) values(p_company,p_customer,phone,'manual',auth.uid())
    on conflict(company_id,customer_id) do update set phone=excluded.phone,opted_in_at=clock_timestamp(),revoked_at=null,source='manual',actor_id=auth.uid();
end;
$$;
create function private.public_booking_whatsapp_consent(p_slug text,p_request_id uuid,p_gateway_secret text,p_allowed boolean) returns boolean language plpgsql security definer set search_path = '' as $$
declare c uuid; customer uuid; v_phone text;
begin
  if p_gateway_secret is null or length(p_gateway_secret) not between 32 and 1024 or not exists(select 1 from private.booking_gateway where secret_hash=encode(sha256(convert_to(p_gateway_secret,'UTF8')),'hex')) then raise exception 'gateway unauthorized'; end if;
  if p_allowed is distinct from true then return false; end if;
  select id into c from public.companies where booking_slug=p_slug and booking_enabled and (status='active' or (status='trialing' and trial_ends_at>now())) for update;
  if c is null then return false; end if;
  select a.customer_id,private.whatsapp_phone(cu.phone) into customer,v_phone
    from private.booking_requests br join public.appointments a on a.id=br.appointment_id and a.company_id=br.company_id
    join public.customers cu on cu.id=a.customer_id and cu.company_id=a.company_id
    where br.company_id=c and br.request_id=p_request_id and a.status='scheduled' and a.starts_at>now() and cu.archived_at is null;
  if customer is null or v_phone is null then return false; end if;
  -- A retry can never silently re-enable a later opt-out.
  insert into public.whatsapp_consents(company_id,customer_id,phone,source) values(c,customer,v_phone,'booking') on conflict(company_id,customer_id) do nothing;
  return exists(select 1 from public.whatsapp_consents wc where wc.company_id=c and wc.customer_id=customer and wc.phone=v_phone and wc.revoked_at is null);
end;
$$;

-- Worker capability is independent of signed-in sessions. Only server code has its secret.
create function private.whatsapp_job_data(p_job uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('job_id',r.id,'company_id',r.company_id,'appointment_id',r.appointment_id,'starts_at',r.starts_at,
    'offset_minutes',r.offset_minutes,'recipient',p.recipient,'customer_name',cu.name,'company_name',c.name)
  from public.whatsapp_reminders r join private.whatsapp_payloads p on p.job_id=r.id join public.companies c on c.id=r.company_id
  join public.customers cu on cu.company_id=r.company_id and cu.id=p.customer_id where r.id=p_job;
$$;
create function private.claim_whatsapp_reminders(p_secret text,p_companies uuid[],p_batch integer default 25) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c uuid; item record; job uuid; result jsonb := '[]'::jsonb; stamp timestamptz := clock_timestamp();
begin
  perform private.check_whatsapp_gateway(p_secret);
  if p_companies is null or cardinality(p_companies) not between 1 and 100 or p_batch is null or p_batch not between 1 and 100 then raise exception 'invalid whatsapp batch'; end if;
  -- All worker and tenant mutations lock the company first, then job rows.
  for c in select co.id from public.companies co where co.id=any(p_companies) order by co.id for update skip locked loop
    update public.whatsapp_reminders set status='unknown',error_code='worker_interrupted',updated_at=stamp
      where company_id=c and status='sending' and updated_at<stamp-interval '15 minutes';
    update public.whatsapp_reminders set status='canceled',error_code='not_eligible',updated_at=stamp
      where company_id=c and status='claimed' and created_at<stamp-interval '15 minutes';
    for item in
      select a.id,a.starts_at,a.customer_id,co.name,cu.name customer_name,wc.phone,wc.opted_in_at,o.offset_minutes
      from public.companies co join public.whatsapp_settings ws on ws.company_id=co.id and ws.enabled
      join public.appointments a on a.company_id=co.id and a.status='scheduled' and a.starts_at>stamp
      join public.customers cu on cu.company_id=co.id and cu.id=a.customer_id and cu.archived_at is null
      join public.services s on s.company_id=co.id and s.id=a.service_id and s.archived_at is null
      join public.professionals pr on pr.company_id=co.id and pr.id=a.professional_id and pr.archived_at is null
      join public.whatsapp_consents wc on wc.company_id=co.id and wc.customer_id=cu.id and wc.revoked_at is null and wc.phone=private.whatsapp_phone(cu.phone)
      cross join lateral unnest(ws.offsets_minutes) o(offset_minutes)
      where co.id=c and (co.status='active' or (co.status='trialing' and co.trial_ends_at>stamp))
        and a.starts_at-make_interval(mins=>o.offset_minutes) between stamp-interval '15 minutes' and stamp
        and not exists(select 1 from public.whatsapp_reminders r where r.appointment_id=a.id and r.starts_at=a.starts_at and r.offset_minutes=o.offset_minutes)
      order by a.starts_at,a.id,o.offset_minutes desc limit p_batch-jsonb_array_length(result)
    loop
      insert into public.whatsapp_reminders(company_id,appointment_id,starts_at,offset_minutes) values(c,item.id,item.starts_at,item.offset_minutes) returning id into job;
      insert into private.whatsapp_payloads(job_id,customer_id,recipient,consent_at) values(job,item.customer_id,item.phone,item.opted_in_at);
      result := result || jsonb_build_array(private.whatsapp_job_data(job));
    end loop;
    exit when jsonb_array_length(result)>=p_batch;
  end loop;
  return result;
end;
$$;
create function private.prepare_whatsapp_reminder(p_secret text,p_job uuid,p_token_hash text) returns jsonb language plpgsql security definer set search_path = '' as $$
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
  select count(*) into used from public.whatsapp_reminders where company_id=c and consumed_at>=month_start and consumed_at<month_start+interval '1 month';
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
create function private.finish_whatsapp_reminder(p_secret text,p_job uuid,p_status text,p_message_id text default null,p_error text default null) returns boolean language plpgsql security definer set search_path = '' as $$
declare c uuid; r public.whatsapp_reminders%rowtype; message text;
begin
  perform private.check_whatsapp_gateway(p_secret);
  if p_status is null or p_status not in ('accepted','failed','unknown') or (p_status='accepted' and (p_message_id is null or length(p_message_id) not between 1 and 512))
    or (p_error is not null and p_error not in ('provider_rejected','network_unknown','worker_interrupted','invalid_recipient','delivery_failed')) then raise exception 'invalid whatsapp result'; end if;
  select company_id into c from public.whatsapp_reminders where id=p_job;
  if c is null then return false; end if;
  perform 1 from public.companies where id=c for update;
  select * into r from public.whatsapp_reminders where id=p_job for update;
  select message_id into message from private.whatsapp_payloads where job_id=p_job;
  if message is not null and p_message_id is not null and message<>p_message_id then return false; end if;
  if r.status not in ('sending','unknown') then return r.status in ('accepted','sent','delivered','read') and p_status='accepted' and message=p_message_id; end if;
  if p_message_id is not null then
    if exists(select 1 from private.whatsapp_payloads where message_id=p_message_id and job_id<>p_job) then return false; end if;
    update private.whatsapp_payloads set message_id=p_message_id where job_id=p_job;
  end if;
  update public.whatsapp_reminders set status=p_status,error_code=case when p_status='accepted' then null else p_error end,updated_at=clock_timestamp() where id=p_job;
  return true;
end;
$$;
create function private.whatsapp_delivery_event(p_secret text,p_company uuid,p_job uuid,p_message_id text,p_status text,p_error text default null) returns boolean language plpgsql security definer set search_path = '' as $$
declare r public.whatsapp_reminders%rowtype; message text; current_rank integer; incoming_rank integer; job uuid;
begin
  perform private.check_whatsapp_gateway(p_secret);
  if p_message_id is null or length(p_message_id) not between 1 and 512 or p_status is null or p_status not in ('sent','delivered','read','failed')
    or (p_error is not null and p_error not in ('provider_rejected','network_unknown','worker_interrupted','invalid_recipient','delivery_failed')) then raise exception 'invalid whatsapp event'; end if;
  perform 1 from public.companies where id=p_company for update;
  job := coalesce(p_job,(select p.job_id from private.whatsapp_payloads p join public.whatsapp_reminders wr on wr.id=p.job_id where p.message_id=p_message_id and wr.company_id=p_company));
  select * into r from public.whatsapp_reminders where id=job and company_id=p_company for update;
  if not found or r.consumed_at is null or r.status in ('claimed','canceled','limit_reached') then return false; end if;
  select message_id into message from private.whatsapp_payloads where job_id=job;
  if message is not null and message<>p_message_id then return false; end if;
  if exists(select 1 from private.whatsapp_payloads where message_id=p_message_id and job_id<>job) then return false; end if;
  update private.whatsapp_payloads set message_id=p_message_id where job_id=job;
  current_rank := case r.status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end;
  incoming_rank := case p_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end;
  -- Out-of-order receipts must never downgrade delivered/read; verified delivery can resolve an earlier timeout/failure.
  if incoming_rank>current_rank or (p_status='failed' and current_rank<2) then
    update public.whatsapp_reminders set status=p_status,error_code=case when p_status='failed' then coalesce(p_error,'delivery_failed') end,updated_at=clock_timestamp() where id=job;
  end if;
  return true;
end;
$$;
create function private.whatsapp_opt_out(p_secret text,p_company uuid,p_phone text) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_phone text;
begin
  perform private.check_whatsapp_gateway(p_secret);
  v_phone := private.whatsapp_phone(p_phone);
  if v_phone is null then return false; end if;
  perform 1 from public.companies where id=p_company for update;
  update public.whatsapp_consents set revoked_at=coalesce(revoked_at,clock_timestamp()) where company_id=p_company and phone=v_phone;
  return found;
end;
$$;
create function private.whatsapp_confirmation(p_secret text,p_token_hash text,p_action text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c uuid; r public.whatsapp_reminders%rowtype; p private.whatsapp_payloads%rowtype; a public.appointments%rowtype; opted_out boolean; confirmed boolean;
begin
  perform private.check_whatsapp_gateway(p_secret);
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_action is null or p_action not in ('view','confirm','optout') then return null; end if;
  select r0.company_id into c from private.whatsapp_payloads p0 join public.whatsapp_reminders r0 on r0.id=p0.job_id where p0.token_hash=p_token_hash;
  if c is null then return null; end if;
  perform 1 from public.companies where id=c for update;
  select * into p from private.whatsapp_payloads where token_hash=p_token_hash;
  select * into r from public.whatsapp_reminders where id=p.job_id;
  if r.consumed_at is null then return null; end if;
  if p_action='optout' then
    if r.consumed_at<now()-interval '30 days' then return null; end if;
    perform private.whatsapp_opt_out(p_secret,c,p.recipient);
    return jsonb_build_object('company_name',(select name from public.companies where id=c),'starts_at',r.starts_at,'confirmed',false,'opted_out',true);
  end if;
  select * into a from public.appointments where id=r.appointment_id and company_id=c;
  if not found or a.customer_id<>p.customer_id or a.status<>'scheduled' or a.starts_at<>r.starts_at or a.starts_at<=now() or p.token_expires_at is null or p.token_expires_at<=now()
    or not exists(select 1 from public.customers where id=p.customer_id and company_id=c and archived_at is null and private.whatsapp_phone(phone)=p.recipient)
    or not exists(select 1 from public.companies where id=c and (status='active' or (status='trialing' and trial_ends_at>now()))) then return null; end if;
  if p_action='confirm' and a.attendance_confirmed_at is null then
    update public.appointments set attendance_confirmed_at=clock_timestamp() where id=a.id;
    a.attendance_confirmed_at := clock_timestamp();
  end if;
  opted_out := not exists(select 1 from public.whatsapp_consents where company_id=c and customer_id=p.customer_id and phone=p.recipient and revoked_at is null);
  confirmed := a.attendance_confirmed_at is not null;
  return jsonb_build_object('company_name',(select name from public.companies where id=c),'starts_at',a.starts_at,'confirmed',confirmed,'opted_out',opted_out);
end;
$$;

create function public.save_whatsapp_settings(p_company uuid,p_enabled boolean,p_offsets integer[],p_limit integer) returns void language sql security invoker set search_path='' as $$select private.save_whatsapp_settings(p_company,p_enabled,p_offsets,p_limit)$$;
create function public.admin_set_whatsapp_limit(p_company uuid,p_limit integer) returns void language sql security invoker set search_path='' as $$select private.admin_set_whatsapp_limit(p_company,p_limit)$$;
create function public.whatsapp_usage(p_company uuid) returns jsonb language sql security invoker set search_path='' as $$select private.whatsapp_usage(p_company)$$;
create function public.set_whatsapp_consent(p_company uuid,p_customer uuid,p_allowed boolean) returns void language sql security invoker set search_path='' as $$select private.set_whatsapp_consent(p_company,p_customer,p_allowed)$$;
create function public.public_booking_whatsapp_consent(p_slug text,p_request_id uuid,p_gateway_secret text,p_allowed boolean) returns boolean language sql security invoker set search_path='' as $$select private.public_booking_whatsapp_consent(p_slug,p_request_id,p_gateway_secret,p_allowed)$$;
create function public.claim_whatsapp_reminders(p_secret text,p_companies uuid[],p_batch integer default 25) returns jsonb language sql security invoker set search_path='' as $$select private.claim_whatsapp_reminders(p_secret,p_companies,p_batch)$$;
create function public.prepare_whatsapp_reminder(p_secret text,p_job uuid,p_token_hash text) returns jsonb language sql security invoker set search_path='' as $$select private.prepare_whatsapp_reminder(p_secret,p_job,p_token_hash)$$;
create function public.finish_whatsapp_reminder(p_secret text,p_job uuid,p_status text,p_message_id text default null,p_error text default null) returns boolean language sql security invoker set search_path='' as $$select private.finish_whatsapp_reminder(p_secret,p_job,p_status,p_message_id,p_error)$$;
create function public.whatsapp_delivery_event(p_secret text,p_company uuid,p_job uuid,p_message_id text,p_status text,p_error text default null) returns boolean language sql security invoker set search_path='' as $$select private.whatsapp_delivery_event(p_secret,p_company,p_job,p_message_id,p_status,p_error)$$;
create function public.whatsapp_opt_out(p_secret text,p_company uuid,p_phone text) returns boolean language sql security invoker set search_path='' as $$select private.whatsapp_opt_out(p_secret,p_company,p_phone)$$;
create function public.whatsapp_confirmation(p_secret text,p_token_hash text,p_action text) returns jsonb language sql security invoker set search_path='' as $$select private.whatsapp_confirmation(p_secret,p_token_hash,p_action)$$;

-- No schema-wide grants. Private helpers stay inaccessible even with a guessed function name.
revoke all on function private.whatsapp_phone(text),private.check_whatsapp_gateway(text),private.whatsapp_job_data(uuid) from public,anon,authenticated;
do $$ declare f text; begin
  foreach f in array array['save_whatsapp_settings(uuid,boolean,integer[],integer)','admin_set_whatsapp_limit(uuid,integer)','whatsapp_usage(uuid)','set_whatsapp_consent(uuid,uuid,boolean)'] loop
    execute 'revoke all on function public.'||f||',private.'||f||' from public,anon,authenticated';
    execute 'grant execute on function public.'||f||',private.'||f||' to authenticated';
  end loop;
  foreach f in array array['public_booking_whatsapp_consent(text,uuid,text,boolean)','claim_whatsapp_reminders(text,uuid[],integer)','prepare_whatsapp_reminder(text,uuid,text)',
    'finish_whatsapp_reminder(text,uuid,text,text,text)','whatsapp_delivery_event(text,uuid,uuid,text,text,text)','whatsapp_opt_out(text,uuid,text)','whatsapp_confirmation(text,text,text)'] loop
    execute 'revoke all on function public.'||f||',private.'||f||' from public,anon,authenticated';
    execute 'grant execute on function public.'||f||',private.'||f||' to anon,authenticated';
  end loop;
end; $$;
