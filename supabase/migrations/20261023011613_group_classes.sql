-- Group sessions use the same company lock as individual bookings and blocks.
-- Participants consume seats in a session, never the plan's professional quota.
create table public.class_sessions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  service_id uuid not null, professional_id uuid not null, title text not null check(length(trim(title)) between 2 and 120),
  starts_at timestamptz not null, ends_at timestamptz not null,
  capacity integer not null check(capacity between 1 and 100),
  status text not null default 'scheduled' check(status in ('scheduled','completed','canceled')),
  is_public boolean not null default false, version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(), unique(company_id,id),
  foreign key(company_id,service_id) references public.services(company_id,id),
  foreign key(company_id,professional_id) references public.professionals(company_id,id),
  check(isfinite(starts_at) and isfinite(ends_at) and ends_at>starts_at),
  exclude using gist(professional_id with =,tstzrange(starts_at,ends_at,'[)') with &&) where(status<>'canceled')
);
create index class_sessions_company_start_idx on public.class_sessions(company_id,starts_at,id);
create index class_sessions_service_idx on public.class_sessions(company_id,service_id);
create index class_sessions_professional_idx on public.class_sessions(company_id,professional_id);
create table public.class_registrations (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  class_session_id uuid not null, customer_id uuid not null, request_id uuid not null,
  status text not null default 'reserved' check(status in ('reserved','attended','canceled')),
  version integer not null default 1 check(version>0), created_at timestamptz not null default now(),
  unique(company_id,id), unique(company_id,request_id),
  foreign key(company_id,class_session_id) references public.class_sessions(company_id,id),
  foreign key(company_id,customer_id) references public.customers(company_id,id)
);
create unique index class_registrations_active_customer_idx on public.class_registrations(company_id,class_session_id,customer_id) where(status<>'canceled');
create index class_registrations_session_idx on public.class_registrations(company_id,class_session_id,created_at,id);
create index class_registrations_customer_idx on public.class_registrations(company_id,customer_id);
create table private.class_booking_requests (
  company_id uuid not null references public.companies(id), request_id uuid not null,
  registration_id uuid not null, fingerprint text not null, primary key(company_id,request_id),
  foreign key(company_id,registration_id) references public.class_registrations(company_id,id)
);
create index class_booking_requests_registration_idx on private.class_booking_requests(company_id,registration_id);
alter table public.class_sessions enable row level security;
alter table public.class_registrations enable row level security;
alter table private.class_booking_requests enable row level security;
revoke all on public.class_sessions,public.class_registrations,private.class_booking_requests from public,anon,authenticated;
grant select on public.class_sessions,public.class_registrations to authenticated;

create function private.class_visible(p_company uuid,p_session uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from public.class_sessions s where s.company_id=p_company and s.id=p_session
    and (private.member_role(p_company) in ('OWNER','MANAGER') or
      (private.member_role(p_company)='EMPLOYEE' and private.assigned(p_company,s.professional_id))));
$$;
create function private.class_customer_visible(p_company uuid,p_customer uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and private.member_role(p_company)='EMPLOYEE' and exists(
    select 1 from public.class_registrations r join public.class_sessions s on s.company_id=r.company_id and s.id=r.class_session_id
    where r.company_id=p_company and r.customer_id=p_customer and private.assigned(p_company,s.professional_id));
$$;
revoke all on function private.class_visible(uuid,uuid),private.class_customer_visible(uuid,uuid) from public,anon,authenticated;
grant execute on function private.class_visible(uuid,uuid),private.class_customer_visible(uuid,uuid) to authenticated;
create policy class_sessions_member_read on public.class_sessions for select to authenticated using(
  private.member_role(company_id) in ('OWNER','MANAGER') or
  (private.member_role(company_id)='EMPLOYEE' and private.assigned(company_id,professional_id)));
create policy class_registrations_member_read on public.class_registrations for select to authenticated using(private.class_visible(company_id,class_session_id));
create policy class_customers_employee_read on public.customers for select to authenticated using(private.class_customer_visible(company_id,id));

-- Existing appointment validation remains intact. This additional guard closes
-- cross-table occupancy for ALL paths, including direct authorized Data API INSERT.
create function private.check_class_occupancy() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.companies where id=new.company_id for update;
  if tg_table_name='appointments' then
    if new.status='canceled' then return new; end if;
  end if;
  if exists(select 1 from public.class_sessions s where s.company_id=new.company_id and s.status<>'canceled'
    and (new.professional_id is null or s.professional_id=new.professional_id)
    and tstzrange(s.starts_at,s.ends_at,'[)') && tstzrange(new.starts_at,new.ends_at,'[)')) then raise exception 'schedule conflict'; end if;
  return new;
end;
$$;
revoke all on function private.check_class_occupancy() from public,anon,authenticated;
create trigger class_occupancy_appointment before insert or update on public.appointments for each row execute function private.check_class_occupancy();
create trigger class_occupancy_block before insert or update on public.schedule_blocks for each row execute function private.check_class_occupancy();

create function private.save_class_session(p_company uuid,p_session uuid,p_version integer,p_service uuid,p_professional uuid,p_title text,p_start timestamptz,p_capacity integer,p_public boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.class_sessions%rowtype; result uuid; duration integer; finish timestamptz; s timestamp; e timestamp; sm integer; em integer;
begin
  perform private.lock_business_company(p_company);
  if p_title is null or length(trim(p_title)) not between 2 and 120 or p_start is null or not isfinite(p_start)
    or p_capacity is null or p_capacity not between 1 and 100 or p_public is null then raise exception 'invalid class'; end if;
  if p_session is not null then
    select * into previous from public.class_sessions where company_id=p_company and id=p_session for update;
    if not found or previous.status<>'scheduled' or previous.starts_at<=now() then raise exception 'class unavailable'; end if;
    if p_version is null or p_version<>previous.version then raise exception 'class version conflict'; end if;
    if p_capacity<(select count(*) from public.class_registrations where company_id=p_company and class_session_id=p_session and status<>'canceled') then raise exception 'class full'; end if;
  elsif p_version is not null then raise exception 'invalid class'; end if;
  select duration_minutes into duration from public.services where company_id=p_company and id=p_service and archived_at is null;
  if duration is null or not exists(select 1 from public.professionals where company_id=p_company and id=p_professional and archived_at is null) then raise exception 'invalid class'; end if;
  finish:=p_start+case when previous.id is not null and previous.service_id=p_service then previous.ends_at-previous.starts_at else make_interval(mins=>duration) end;
  if p_start<=now() then raise exception 'invalid class'; end if;
  s:=p_start at time zone 'America/Sao_Paulo';e:=finish at time zone 'America/Sao_Paulo';
  sm:=extract(hour from s)::integer*60+extract(minute from s)::integer;em:=extract(hour from e)::integer*60+extract(minute from e)::integer;
  if s::date<>e::date or extract(second from s)<>0 or not exists(select 1 from public.availability
    where company_id=p_company and professional_id=p_professional and weekday=extract(isodow from s) and start_minute<=sm and end_minute>=em) then raise exception 'outside business hours'; end if;
  if exists(select 1 from public.appointments where company_id=p_company and professional_id=p_professional and status<>'canceled'
      and tstzrange(starts_at,ends_at,'[)') && tstzrange(p_start,finish,'[)'))
    or exists(select 1 from public.schedule_blocks where company_id=p_company and (professional_id is null or professional_id=p_professional)
      and tstzrange(starts_at,ends_at,'[)') && tstzrange(p_start,finish,'[)'))
    or exists(select 1 from public.class_sessions where company_id=p_company and professional_id=p_professional and status<>'canceled'
      and (p_session is null or id<>p_session) and tstzrange(starts_at,ends_at,'[)') && tstzrange(p_start,finish,'[)')) then raise exception 'schedule conflict'; end if;
  if previous.id is null then
    insert into public.class_sessions(company_id,service_id,professional_id,title,starts_at,ends_at,capacity,is_public)
      values(p_company,p_service,p_professional,trim(p_title),p_start,finish,p_capacity,p_public) returning id into result;
  else
    update public.class_sessions set service_id=p_service,professional_id=p_professional,title=trim(p_title),starts_at=p_start,ends_at=finish,capacity=p_capacity,is_public=p_public,version=version+1
      where company_id=p_company and id=p_session returning id into result;
  end if;
  return result;
end;
$$;

create function private.manage_class_session(p_company uuid,p_session uuid,p_version integer,p_action text) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.class_sessions%rowtype;
begin
  perform private.lock_business_company(p_company);
  if p_action is null or p_action not in ('cancel','complete') then raise exception 'invalid class'; end if;
  select * into s from public.class_sessions where company_id=p_company and id=p_session for update;
  if not found then raise exception 'class unavailable'; end if;
  if p_version is null or p_version<>s.version then raise exception 'class version conflict'; end if;
  if s.status<>'scheduled' then raise exception 'class unavailable'; end if;
  if p_action='complete' and s.ends_at>now() then raise exception 'class has not ended'; end if;
  if p_action='cancel' and exists(select 1 from public.class_registrations where company_id=p_company and class_session_id=p_session and status='attended') then raise exception 'class has attendance'; end if;
  update public.class_sessions set status=case when p_action='cancel' then 'canceled' else 'completed' end,version=version+1 where company_id=p_company and id=p_session;
  if p_action='cancel' then update public.class_registrations set status='canceled',version=version+1 where company_id=p_company and class_session_id=p_session and status='reserved'; end if;
  return p_session;
end;
$$;

create function private.save_class_registration(p_company uuid,p_session uuid,p_customer uuid,p_request uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.class_sessions%rowtype; existing public.class_registrations%rowtype; result uuid;
begin
  perform private.lock_business_company(p_company);
  if p_request is null or p_customer is null then raise exception 'invalid registration'; end if;
  select * into existing from public.class_registrations where company_id=p_company and request_id=p_request;
  if found then
    if existing.class_session_id is distinct from p_session or existing.customer_id is distinct from p_customer then raise exception 'registration idempotency conflict'; end if;
    return existing.id;
  end if;
  select * into s from public.class_sessions where company_id=p_company and id=p_session for update;
  if not found or s.status<>'scheduled' or s.starts_at<=now() then raise exception 'class unavailable'; end if;
  if not exists(select 1 from public.customers where company_id=p_company and id=p_customer and archived_at is null)
    or not exists(select 1 from public.services where company_id=p_company and id=s.service_id and archived_at is null)
    or not exists(select 1 from public.professionals where company_id=p_company and id=s.professional_id and archived_at is null) then raise exception 'invalid registration'; end if;
  if exists(select 1 from public.class_registrations where company_id=p_company and class_session_id=p_session and customer_id=p_customer and status<>'canceled') then raise exception 'already reserved'; end if;
  if (select count(*) from public.class_registrations where company_id=p_company and class_session_id=p_session and status<>'canceled')>=s.capacity then raise exception 'class full'; end if;
  insert into public.class_registrations(company_id,class_session_id,customer_id,request_id) values(p_company,p_session,p_customer,p_request) returning id into result;
  return result;
end;
$$;

create function private.manage_class_registration(p_company uuid,p_registration uuid,p_version integer,p_action text) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.class_registrations%rowtype; s public.class_sessions%rowtype; member text;
begin
  if auth.uid() is null or private.member_role(p_company) is null then raise exception 'not authorized'; end if;
  perform 1 from public.companies where id=p_company for update;
  member:=private.member_role(p_company);
  if not found or member is null then raise exception 'not authorized'; end if;
  if not private.writable(p_company) then raise exception 'subscription blocked'; end if;
  if p_action is null or p_action not in ('cancel','attend') then raise exception 'invalid registration'; end if;
  select * into r from public.class_registrations where company_id=p_company and id=p_registration for update;
  if not found then raise exception 'registration unavailable'; end if;
  select * into s from public.class_sessions where company_id=p_company and id=r.class_session_id for update;
  if member not in ('OWNER','MANAGER') and not (member='EMPLOYEE' and p_action='attend' and exists(
    select 1 from public.professionals where company_id=p_company and id=s.professional_id and user_id=auth.uid() and archived_at is null)) then raise exception 'not authorized'; end if;
  if p_version is null or p_version<>r.version then raise exception 'registration version conflict'; end if;
  if r.status<>'reserved' or s.status='canceled' then raise exception 'registration unavailable'; end if;
  if p_action='attend' and s.starts_at>now() then raise exception 'class has not started'; end if;
  update public.class_registrations set status=case when p_action='cancel' then 'canceled' else 'attended' end,version=version+1 where company_id=p_company and id=p_registration;
  return p_registration;
end;
$$;

create function private.public_classes(p_slug text,p_day date) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'starts_at',s.starts_at,'ends_at',s.ends_at,'capacity',s.capacity,
    'remaining',greatest(0,s.capacity-(select count(*) from public.class_registrations r where r.company_id=s.company_id and r.class_session_id=s.id and r.status<>'canceled')),
    'service',jsonb_build_object('id',v.id,'name',v.name,'duration',extract(epoch from(s.ends_at-s.starts_at))::integer/60,'price_cents',v.price_cents),
    'professional',jsonb_build_object('id',p.id,'name',p.name)) order by s.starts_at,s.id),'[]'::jsonb)
  from public.class_sessions s join public.companies c on c.id=s.company_id
  join public.services v on v.company_id=c.id and v.id=s.service_id and v.archived_at is null
  join public.professionals p on p.company_id=c.id and p.id=s.professional_id and p.archived_at is null
  where c.booking_slug=p_slug and c.booking_enabled and (c.status='active' or(c.status='trialing' and c.trial_ends_at>now()))
    and s.is_public and s.status='scheduled' and s.starts_at>now()+interval '30 minutes'
    and isfinite(p_day) and p_day between (now() at time zone 'America/Sao_Paulo')::date and (now() at time zone 'America/Sao_Paulo')::date+60
    and s.starts_at>=(p_day::timestamp at time zone 'America/Sao_Paulo') and s.starts_at<((p_day+1)::timestamp at time zone 'America/Sao_Paulo');
$$;

create function private.submit_public_class_booking(p_slug text,p_session uuid,p_customer_name text,p_phone text,p_request_id uuid,p_gateway_secret text,p_ip_hash text) returns uuid
language plpgsql security definer set search_path='' as $$
declare c uuid; s public.class_sessions%rowtype; previous private.class_booking_requests%rowtype; fingerprint text; customer uuid; result uuid;
begin
  if not exists(select 1 from private.booking_gateway where secret_hash=encode(sha256(convert_to(p_gateway_secret,'UTF8')),'hex')) then raise exception 'gateway unauthorized'; end if;
  if p_request_id is null or p_session is null or p_customer_name is null or length(trim(p_customer_name)) not between 2 and 120
    or p_phone is null or p_phone !~ '^[0-9]{10,13}$' or p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid registration'; end if;
  select id into c from public.companies where booking_slug=p_slug for update;
  if c is null or not exists(select 1 from public.companies where id=c and booking_enabled and (status='active' or(status='trialing' and trial_ends_at>now()))) then raise exception 'class unavailable'; end if;
  fingerprint:=encode(sha256(convert_to(jsonb_build_array(p_session,trim(p_customer_name),p_phone)::text,'UTF8')),'hex');
  select * into previous from private.class_booking_requests where company_id=c and request_id=p_request_id;
  if found then
    if previous.fingerprint<>fingerprint then raise exception 'registration idempotency conflict'; end if;
    return previous.registration_id;
  end if;
  select * into s from public.class_sessions where company_id=c and id=p_session for update;
  if not found or not s.is_public or s.status<>'scheduled' or s.starts_at<=now()+interval '30 minutes'
    or (s.starts_at at time zone 'America/Sao_Paulo')::date>(now() at time zone 'America/Sao_Paulo')::date+60
    or not exists(select 1 from public.services where company_id=c and id=s.service_id and archived_at is null)
    or not exists(select 1 from public.professionals where company_id=c and id=s.professional_id and archived_at is null) then raise exception 'class unavailable'; end if;
  if (select count(*) from public.class_registrations where company_id=c and class_session_id=p_session and status<>'canceled')>=s.capacity then raise exception 'class full'; end if;
  if exists(select 1 from public.class_registrations r join public.customers u on u.company_id=r.company_id and u.id=r.customer_id
    where r.company_id=c and r.class_session_id=p_session and r.status<>'canceled' and regexp_replace(u.phone,'[^0-9]','','g')=p_phone) then raise exception 'already reserved'; end if;
  -- Share the existing public-booking quotas so classes cannot bypass them.
  perform private.limit_booking('ip:'||p_ip_hash,date_trunc('hour',now()),10);
  perform private.limit_booking('phone:'||c::text||encode(sha256(convert_to(p_phone,'UTF8')),'hex'),date_trunc('day',now()),5);
  perform private.limit_booking('company:'||c::text,date_trunc('day',now()),200);
  insert into public.customers(company_id,name,phone) values(c,trim(p_customer_name),p_phone) returning id into customer;
  insert into public.class_registrations(company_id,class_session_id,customer_id,request_id) values(c,p_session,customer,p_request_id) returning id into result;
  insert into private.class_booking_requests values(c,p_request_id,result,fingerprint);
  delete from private.booking_limits where bucket<now()-interval '2 days';
  return result;
end;
$$;

create function private.public_class_booking_receipt(p_slug text,p_request_id uuid,p_gateway_secret text) returns jsonb
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
    where c.booking_slug=p_slug and q.request_id=p_request_id and c.booking_enabled
      and (c.status='active' or(c.status='trialing' and c.trial_ends_at>now())));
end;
$$;

-- Individual availability must also hide time already occupied by a class.
create or replace function private.public_slots(slug text,service uuid,professional uuid,day date)
returns table(starts_at timestamptz) language sql stable security definer set search_path='' as $$
  select ((day::timestamp+make_interval(mins=>m)) at time zone 'America/Sao_Paulo') as starts_at
  from public.companies c join public.services s on s.company_id=c.id and s.id=service and s.archived_at is null
  join public.professionals p on p.company_id=c.id and p.id=professional and p.archived_at is null
  join public.availability a on a.company_id=c.id and a.professional_id=p.id and a.weekday=extract(isodow from day)
  cross join lateral generate_series(a.start_minute,a.end_minute-s.duration_minutes,15) m
  where c.booking_slug=slug and c.booking_enabled and (c.status='active' or(c.status='trialing' and c.trial_ends_at>now()))
    and isfinite(day) and day>=(now() at time zone 'America/Sao_Paulo')::date and day<=(now() at time zone 'America/Sao_Paulo')::date+60
    and ((day::timestamp+make_interval(mins=>m)) at time zone 'America/Sao_Paulo')>now()+interval '30 minutes'
    and not exists(select 1 from public.appointments ap where ap.company_id=c.id and ap.professional_id=p.id and ap.status<>'canceled'
      and tstzrange(ap.starts_at,ap.ends_at,'[)') && tstzrange(((day::timestamp+make_interval(mins=>m)) at time zone 'America/Sao_Paulo'),((day::timestamp+make_interval(mins=>m+s.duration_minutes)) at time zone 'America/Sao_Paulo'),'[)'))
    and not exists(select 1 from public.schedule_blocks b where b.company_id=c.id and(b.professional_id is null or b.professional_id=p.id)
      and tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(((day::timestamp+make_interval(mins=>m)) at time zone 'America/Sao_Paulo'),((day::timestamp+make_interval(mins=>m+s.duration_minutes)) at time zone 'America/Sao_Paulo'),'[)'))
    and not exists(select 1 from public.class_sessions g where g.company_id=c.id and g.professional_id=p.id and g.status<>'canceled'
      and tstzrange(g.starts_at,g.ends_at,'[)') && tstzrange(((day::timestamp+make_interval(mins=>m)) at time zone 'America/Sao_Paulo'),((day::timestamp+make_interval(mins=>m+s.duration_minutes)) at time zone 'America/Sao_Paulo'),'[)'))
  order by starts_at;
$$;

-- Archiving must preserve future class commitments just as individual bookings.
create function private.guard_class_archive() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.archived_at is null or old.archived_at is not null then return new; end if;
  perform 1 from public.companies where id=new.company_id for update;
  if exists(select 1 from public.class_sessions s where s.company_id=new.company_id and s.status='scheduled' and s.ends_at>now()
    and (case tg_table_name when 'services' then s.service_id=new.id when 'professionals' then s.professional_id=new.id else
      exists(select 1 from public.class_registrations r where r.company_id=s.company_id and r.class_session_id=s.id and r.customer_id=new.id and r.status<>'canceled') end)) then raise exception 'future scheduled classes'; end if;
  return new;
end;
$$;
revoke all on function private.guard_class_archive() from public,anon,authenticated;
create trigger class_archive_service before update on public.services for each row execute function private.guard_class_archive();
create trigger class_archive_professional before update on public.professionals for each row execute function private.guard_class_archive();
create trigger class_archive_customer before update on public.customers for each row execute function private.guard_class_archive();

create function public.save_class_session(p_company uuid,p_session uuid,p_version integer,p_service uuid,p_professional uuid,p_title text,p_start timestamptz,p_capacity integer,p_public boolean) returns uuid language sql security invoker set search_path='' as $$select private.save_class_session(p_company,p_session,p_version,p_service,p_professional,p_title,p_start,p_capacity,p_public)$$;
create function public.manage_class_session(p_company uuid,p_session uuid,p_version integer,p_action text) returns uuid language sql security invoker set search_path='' as $$select private.manage_class_session(p_company,p_session,p_version,p_action)$$;
create function public.save_class_registration(p_company uuid,p_session uuid,p_customer uuid,p_request uuid) returns uuid language sql security invoker set search_path='' as $$select private.save_class_registration(p_company,p_session,p_customer,p_request)$$;
create function public.manage_class_registration(p_company uuid,p_registration uuid,p_version integer,p_action text) returns uuid language sql security invoker set search_path='' as $$select private.manage_class_registration(p_company,p_registration,p_version,p_action)$$;
create function public.public_classes(p_slug text,p_day date) returns jsonb language sql stable security invoker set search_path='' as $$select private.public_classes(p_slug,p_day)$$;
create function public.submit_public_class_booking(p_slug text,p_session uuid,p_customer_name text,p_phone text,p_request_id uuid,p_gateway_secret text,p_ip_hash text) returns uuid language sql security invoker set search_path='' as $$select private.submit_public_class_booking(p_slug,p_session,p_customer_name,p_phone,p_request_id,p_gateway_secret,p_ip_hash)$$;
create function public.public_class_booking_receipt(p_slug text,p_request_id uuid,p_gateway_secret text) returns jsonb language sql stable security invoker set search_path='' as $$select private.public_class_booking_receipt(p_slug,p_request_id,p_gateway_secret)$$;
do $$ declare f text; begin
  foreach f in array array['save_class_session(uuid,uuid,integer,uuid,uuid,text,timestamptz,integer,boolean)','manage_class_session(uuid,uuid,integer,text)',
    'save_class_registration(uuid,uuid,uuid,uuid)','manage_class_registration(uuid,uuid,integer,text)'] loop
    execute 'revoke all on function public.'||f||',private.'||f||' from public,anon,authenticated';
    execute 'grant execute on function public.'||f||',private.'||f||' to authenticated';
  end loop;
  foreach f in array array['public_classes(text,date)','submit_public_class_booking(text,uuid,text,text,uuid,text,text)','public_class_booking_receipt(text,uuid,text)'] loop
    execute 'revoke all on function public.'||f||',private.'||f||' from public,anon,authenticated';
    execute 'grant execute on function public.'||f||',private.'||f||' to anon,authenticated';
  end loop;
end; $$;
