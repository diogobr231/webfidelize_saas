alter table public.companies add column booking_slug text unique;
alter table public.companies add column booking_enabled boolean not null default false;
alter table public.companies add column is_demo boolean not null default false;
alter table public.companies add constraint booking_slug_format check(booking_slug is null or booking_slug ~ '^[a-z0-9][a-z0-9-]{2,59}$');
create table public.availability (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 professional_id uuid not null, weekday integer not null check(weekday between 1 and 7),
 start_minute integer not null check(start_minute between 0 and 1439), end_minute integer not null check(end_minute between 1 and 1440),
 check(end_minute>start_minute),foreign key(company_id,professional_id) references public.professionals(company_id,id),
 exclude using gist(professional_id with =,weekday with =,int4range(start_minute,end_minute,'[)') with &&)
);
create index availability_company_idx on public.availability(company_id,professional_id);
alter table public.availability enable row level security;
create policy availability_read on public.availability for select to authenticated using(private.member_role(company_id) in ('OWNER','MANAGER') or (private.member_role(company_id)='EMPLOYEE' and private.assigned(company_id,professional_id)));
create policy availability_insert on public.availability for insert to authenticated with check(private.member_role(company_id) in ('OWNER','MANAGER') and private.writable(company_id));
create policy availability_delete on public.availability for delete to authenticated using(private.member_role(company_id) in ('OWNER','MANAGER') and private.writable(company_id));
grant select,insert,delete on public.availability to authenticated;
revoke all on public.availability from anon;
-- Preserve existing weekday defaults while making every subsequent shift configurable.
insert into public.availability(company_id,professional_id,weekday,start_minute,end_minute) select p.company_id,p.id,d,480,1080 from public.professionals p cross join generate_series(1,5) d;
create function private.default_availability() returns trigger language plpgsql security definer set search_path='' as $$ begin
 insert into public.availability(company_id,professional_id,weekday,start_minute,end_minute) select new.company_id,new.id,d,480,1080 from generate_series(1,5) d; return new; end $$;
revoke all on function private.default_availability() from public,anon,authenticated;
create trigger professional_availability after insert on public.professionals for each row execute function private.default_availability();

create or replace function private.validate_appointment() returns trigger language plpgsql security definer set search_path='' as $$
 declare duration integer; s timestamp; e timestamp; sm integer; em integer; begin
 select duration_minutes into duration from public.services where company_id=new.company_id and id=new.service_id;
 if duration is null or new.ends_at<>new.starts_at+make_interval(mins=>duration) or new.starts_at<now() then raise exception 'invalid interval'; end if;
 s:=new.starts_at at time zone 'America/Sao_Paulo';e:=new.ends_at at time zone 'America/Sao_Paulo';
 sm:=extract(hour from s)::integer*60+extract(minute from s)::integer;em:=extract(hour from e)::integer*60+extract(minute from e)::integer;
 if s::date<>e::date or extract(second from s)<>0 or not exists(select 1 from public.availability where company_id=new.company_id and professional_id=new.professional_id and weekday=extract(isodow from s) and start_minute<=sm and end_minute>=em) then raise exception 'outside business hours';end if;
 return new; end $$;
revoke all on function private.validate_appointment() from public,anon,authenticated;
create or replace function public.book_appointment(p_company uuid,p_customer uuid,p_service uuid,p_professional uuid,p_start timestamptz) returns uuid language plpgsql security invoker set search_path='' as $$
 declare duration integer; result uuid; begin
 if private.member_role(p_company) is null or private.member_role(p_company) not in ('OWNER','MANAGER') or not private.writable(p_company) then raise exception 'not authorized'; end if;
 select duration_minutes into duration from public.services where company_id=p_company and id=p_service;
 if duration is null then raise exception 'invalid service'; end if;
 insert into public.appointments(company_id,customer_id,service_id,professional_id,starts_at,ends_at) values(p_company,p_customer,p_service,p_professional,p_start,p_start+make_interval(mins=>duration)) returning id into result;return result; end $$;
create function public.configure_booking(c uuid,slug text,enabled boolean) returns void language plpgsql security invoker set search_path='' as $$ begin
 if private.member_role(c) is distinct from 'OWNER' or not private.writable(c) then raise exception 'not authorized';end if;
 update public.companies set booking_slug=slug,booking_enabled=enabled where id=c;end $$;
-- Grant only the safe columns, with OWNER authorization repeated by RLS.
grant update(booking_slug,booking_enabled) on public.companies to authenticated;
create policy companies_booking_update on public.companies for update to authenticated using(private.member_role(id)='OWNER' and private.writable(id)) with check(private.member_role(id)='OWNER' and private.writable(id));
revoke all on function public.configure_booking(uuid,text,boolean) from public,anon;
grant execute on function public.configure_booking(uuid,text,boolean) to authenticated;

create table private.booking_gateway(singleton boolean primary key default true check(singleton),secret_hash text not null);
create table private.booking_limits(key text not null,bucket timestamptz not null,hits integer not null,primary key(key,bucket));
create table private.booking_requests(company_id uuid not null references public.companies(id),request_id uuid not null,appointment_id uuid not null references public.appointments(id),primary key(company_id,request_id));
alter table private.booking_gateway enable row level security;
alter table private.booking_limits enable row level security;
alter table private.booking_requests enable row level security;
create policy gateway_deny on private.booking_gateway for all to authenticated using(false) with check(false);
create policy limits_deny on private.booking_limits for all to authenticated using(false) with check(false);
create policy requests_deny on private.booking_requests for all to authenticated using(false) with check(false);
revoke all on private.booking_gateway,private.booking_limits,private.booking_requests from public,anon,authenticated;
create function private.limit_booking(k text,b timestamptz,max_hits integer) returns void language plpgsql security definer set search_path='' as $$ declare n integer;begin
 insert into private.booking_limits values(k,b,1) on conflict(key,bucket) do update set hits=private.booking_limits.hits+1 returning hits into n;
 if n>max_hits then raise exception 'booking rate limit';end if;end $$;
revoke all on function private.limit_booking(text,timestamptz,integer) from public,anon,authenticated;
create function private.public_catalog(slug text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('name',c.name,'slug',c.booking_slug,'is_demo',c.is_demo,
 'services',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'duration',s.duration_minutes,'price_cents',s.price_cents) order by s.name) from public.services s where s.company_id=c.id),'[]'::jsonb),
 'professionals',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) order by p.name) from public.professionals p where p.company_id=c.id),'[]'::jsonb))
 from public.companies c where c.booking_slug=slug and c.booking_enabled and (c.status='active' or(c.status='trialing' and c.trial_ends_at>now()));
$$;
create function private.public_slots(slug text,service uuid,professional uuid,day date) returns table(starts_at timestamptz) language sql stable security definer set search_path='' as $$
 select ((day::timestamp+make_interval(mins=>m)) at time zone 'America/Sao_Paulo') as starts_at
 from public.companies c join public.services s on s.company_id=c.id and s.id=service join public.professionals p on p.company_id=c.id and p.id=professional
 join public.availability a on a.company_id=c.id and a.professional_id=p.id and a.weekday=extract(isodow from day)
 cross join lateral generate_series(a.start_minute,a.end_minute-s.duration_minutes,15) m
 where c.booking_slug=slug and c.booking_enabled and (c.status='active' or(c.status='trialing' and c.trial_ends_at>now()))
 and day>=(now() at time zone 'America/Sao_Paulo')::date and day<=(now() at time zone 'America/Sao_Paulo')::date+60
 and ((day::timestamp+make_interval(mins=>m)) at time zone 'America/Sao_Paulo')>now()+interval '30 minutes'
 and not exists(select 1 from public.appointments ap where ap.professional_id=p.id and ap.status<>'canceled' and tstzrange(ap.starts_at,ap.ends_at,'[)') && tstzrange(((day::timestamp+make_interval(mins=>m)) at time zone 'America/Sao_Paulo'),((day::timestamp+make_interval(mins=>m+s.duration_minutes)) at time zone 'America/Sao_Paulo'),'[)')) order by starts_at;
$$;
create function private.submit_public_booking(slug text,service uuid,professional uuid,start_time timestamptz,customer_name text,phone text,request_id uuid,gateway_secret text,ip_hash text) returns uuid language plpgsql security definer set search_path='' as $$
 declare c uuid;customer uuid;appointment uuid;duration integer;begin
 if not exists(select 1 from private.booking_gateway where secret_hash=encode(sha256(convert_to(gateway_secret,'UTF8')),'hex')) then raise exception 'gateway unauthorized';end if;
 if length(customer_name) not between 2 and 120 or phone !~ '^[0-9]{10,13}$' or ip_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid booking';end if;
 select id into c from public.companies where booking_slug=slug and booking_enabled and (status='active' or(status='trialing' and trial_ends_at>now()));
 if c is null then raise exception 'booking unavailable';end if;
 -- Serialize reservations per company; limits, retries and competing slots remain atomic.
 perform pg_advisory_xact_lock(hashtextextended(c::text,1));
 select appointment_id into appointment from private.booking_requests br where br.company_id=c and br.request_id=submit_public_booking.request_id;
 if appointment is not null then return appointment;end if;
 if not exists(select 1 from private.public_slots(slug,service,professional,(start_time at time zone 'America/Sao_Paulo')::date) ps where ps.starts_at=start_time) then raise exception 'slot unavailable';end if;
 perform private.limit_booking('ip:'||ip_hash,date_trunc('hour',now()),10);
 perform private.limit_booking('phone:'||c::text||encode(sha256(convert_to(phone,'UTF8')),'hex'),date_trunc('day',now()),5);
 perform private.limit_booking('company:'||c::text,date_trunc('day',now()),200);
 select duration_minutes into duration from public.services where company_id=c and id=service;
 insert into public.customers(company_id,name,phone) values(c,customer_name,phone) returning id into customer;
 insert into public.appointments(company_id,customer_id,service_id,professional_id,starts_at,ends_at) values(c,customer,service,professional,start_time,start_time+make_interval(mins=>duration)) returning id into appointment;
 insert into private.booking_requests values(c,request_id,appointment);
 delete from private.booking_limits where bucket<now()-interval '2 days';return appointment;end $$;

create function public.public_catalog(slug text) returns jsonb language sql stable security invoker set search_path='' as $$select private.public_catalog(slug)$$;
create function public.public_slots(slug text,service uuid,professional uuid,day date) returns table(starts_at timestamptz) language sql stable security invoker set search_path='' as $$select * from private.public_slots(slug,service,professional,day)$$;
create function public.submit_public_booking(slug text,service uuid,professional uuid,start_time timestamptz,customer_name text,phone text,request_id uuid,gateway_secret text,ip_hash text) returns uuid language sql security invoker set search_path='' as $$select private.submit_public_booking(slug,service,professional,start_time,customer_name,phone,request_id,gateway_secret,ip_hash)$$;
grant usage on schema private to anon;
revoke all on function private.public_catalog(text),private.public_slots(text,uuid,uuid,date),private.submit_public_booking(text,uuid,uuid,timestamptz,text,text,uuid,text,text),public.public_catalog(text),public.public_slots(text,uuid,uuid,date),public.submit_public_booking(text,uuid,uuid,timestamptz,text,text,uuid,text,text) from public;
grant execute on function private.public_catalog(text),private.public_slots(text,uuid,uuid,date),private.submit_public_booking(text,uuid,uuid,timestamptz,text,text,uuid,text,text),public.public_catalog(text),public.public_slots(text,uuid,uuid,date),public.submit_public_booking(text,uuid,uuid,timestamptz,text,text,uuid,text,text) to anon,authenticated;
