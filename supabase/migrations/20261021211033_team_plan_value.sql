-- New plan benefits only. Existing agenda, CRM, booking and dashboard access are
-- unchanged, including existing subscriptions and trial deadlines.
alter table public.plans
  add column team_insights boolean not null default false,
  add column team_export boolean not null default false;
update public.plans set team_insights = true where id in ('profissional', 'empresarial');
update public.plans set team_export = true where id = 'empresarial';
grant select(team_insights, team_export) on public.plans to anon;

create function private.collect_team_insights(p_company uuid, p_from date, p_to date, p_export boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare insight_allowed boolean; export_allowed boolean; max_days integer; period_days integer;
  first_instant timestamptz; end_instant timestamptz; result jsonb;
begin
  if auth.uid() is null or coalesce(private.member_role(p_company), '') not in ('OWNER', 'MANAGER') then
    raise exception 'not authorized';
  end if;
  -- Keep the plan and tenant stable while assembling one bounded report; verify
  -- membership again after waiting for any concurrent revocation or downgrade.
  perform 1 from public.companies where id = p_company for share;
  if not found or coalesce(private.member_role(p_company), '') not in ('OWNER', 'MANAGER') then
    raise exception 'not authorized';
  end if;
  select p.team_insights, p.team_export into insight_allowed, export_allowed
    from public.companies c join public.plans p on p.id = c.plan_id where c.id = p_company;
  if not insight_allowed or (p_export and not export_allowed) then raise exception 'plan feature unavailable'; end if;
  max_days := case when export_allowed then 90 else 31 end;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
    or p_from < date '1900-01-01' or p_to > date '2099-12-31' or p_to < p_from then
    raise exception 'invalid team report period';
  end if;
  period_days := p_to - p_from + 1;
  if period_days > max_days then raise exception 'team report period limit'; end if;
  first_instant := p_from::timestamp at time zone 'America/Sao_Paulo';
  end_instant := (p_to + 1)::timestamp at time zone 'America/Sao_Paulo';
  -- Date ranges use the appointment start in the company's supported time zone.
  -- There are no customer identities, contact details, prices or invented revenue.
  with scoped as materialized (
    select professional_id, status, attendance_confirmed_at,
      extract(epoch from (ends_at - starts_at)) / 60 as duration_minutes
    from public.appointments
    where company_id = p_company and starts_at >= first_instant and starts_at < end_instant
  ), professional_counts as (
    select p.id as professional_id, p.name, p.archived_at is not null as archived,
      count(a.professional_id)::integer as total,
      count(a.professional_id) filter (where a.status = 'scheduled')::integer as scheduled,
      count(a.professional_id) filter (where a.status = 'completed')::integer as completed,
      count(a.professional_id) filter (where a.status = 'canceled')::integer as canceled,
      count(a.professional_id) filter (where a.attendance_confirmed_at is not null and a.status <> 'canceled')::integer as confirmed,
      coalesce(sum(a.duration_minutes) filter (where a.status <> 'canceled'), 0)::integer as booked_minutes
    from public.professionals p left join scoped a on a.professional_id = p.id
    where p.company_id = p_company
    group by p.id, p.name, p.archived_at
    having p.archived_at is null or count(a.professional_id) > 0
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'timezone', 'America/Sao_Paulo', 'max_days', max_days,
    'professionals', coalesce((select jsonb_agg(to_jsonb(p) order by p.archived, p.name, p.professional_id) from professional_counts p), '[]'::jsonb),
    'totals', (select jsonb_build_object(
      'total', coalesce(sum(total), 0), 'scheduled', coalesce(sum(scheduled), 0),
      'completed', coalesce(sum(completed), 0), 'canceled', coalesce(sum(canceled), 0),
      'confirmed', coalesce(sum(confirmed), 0), 'booked_minutes', coalesce(sum(booked_minutes), 0)
    ) from professional_counts)
  ) into result;
  return result;
end;
$$;
revoke all on function private.collect_team_insights(uuid, date, date, boolean) from public, anon, authenticated;

create function private.company_team_insights(p_company uuid, p_from date, p_to date)
returns jsonb language sql security definer set search_path = '' as $$
  select private.collect_team_insights(p_company, p_from, p_to, false);
$$;
create function private.company_team_export(p_company uuid, p_from date, p_to date)
returns jsonb language sql security definer set search_path = '' as $$
  select private.collect_team_insights(p_company, p_from, p_to, true);
$$;
create function public.company_team_insights(p_company uuid, p_from date, p_to date)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.company_team_insights(p_company, p_from, p_to);
$$;
create function public.company_team_export(p_company uuid, p_from date, p_to date)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.company_team_export(p_company, p_from, p_to);
$$;
revoke all on function private.company_team_insights(uuid, date, date), private.company_team_export(uuid, date, date),
  public.company_team_insights(uuid, date, date), public.company_team_export(uuid, date, date) from public, anon, authenticated;
grant execute on function private.company_team_insights(uuid, date, date), private.company_team_export(uuid, date, date),
  public.company_team_insights(uuid, date, date), public.company_team_export(uuid, date, date) to authenticated;

create function private.complete_my_appointment(p_company uuid, p_appointment uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare appointment public.appointments%rowtype;
begin
  if auth.uid() is null or private.member_role(p_company) is distinct from 'EMPLOYEE' then raise exception 'not authorized'; end if;
  perform 1 from public.companies where id = p_company for update;
  if not found or private.member_role(p_company) is distinct from 'EMPLOYEE' then raise exception 'not authorized'; end if;
  if not private.writable(p_company) then raise exception 'subscription blocked'; end if;
  select a.* into appointment from public.appointments a
    join public.professionals p on p.company_id = a.company_id and p.id = a.professional_id
    where a.company_id = p_company and a.id = p_appointment and p.user_id = auth.uid() and p.archived_at is null
    for update of a;
  if not found then raise exception 'appointment not found'; end if;
  if appointment.ends_at > now() then raise exception 'appointment has not ended'; end if;
  if appointment.status = 'completed' then return appointment.id; end if;
  if appointment.status <> 'scheduled' then raise exception 'appointment is terminal'; end if;
  update public.appointments set status = 'completed' where company_id = p_company and id = p_appointment;
  return appointment.id;
end;
$$;
create function public.complete_my_appointment(p_company uuid, p_appointment uuid)
returns uuid language sql security invoker set search_path = '' as $$
  select private.complete_my_appointment(p_company, p_appointment);
$$;
revoke all on function private.complete_my_appointment(uuid, uuid), public.complete_my_appointment(uuid, uuid) from public, anon, authenticated;
grant execute on function private.complete_my_appointment(uuid, uuid), public.complete_my_appointment(uuid, uuid) to authenticated;

-- The one new employee mutation is an ended appointment belonging to their
-- currently linked, active professional. No direct UPDATE grant is introduced.
create or replace function private.validate_appointment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare duration integer; expected_duration interval; s timestamp; e timestamp; sm integer; em integer; member text;
begin
  perform 1 from public.companies where id = new.company_id for update;
  if not found then raise exception 'booking unavailable'; end if;
  member := private.member_role(new.company_id);
  if auth.uid() is not null and coalesce(member, '') not in ('OWNER', 'MANAGER') then
    if member = 'EMPLOYEE' and tg_op = 'UPDATE'
      and old.status = 'scheduled' and new.status = 'completed' and old.ends_at <= now()
      and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status')
      and private.writable(new.company_id)
      and exists (select 1 from public.professionals where company_id = new.company_id and id = new.professional_id and user_id = auth.uid() and archived_at is null) then
      return new;
    end if;
    raise exception 'not authorized';
  end if;
  if tg_op = 'UPDATE' then
    if row(new.company_id, new.customer_id, new.service_id, new.professional_id) is distinct from row(old.company_id, old.customer_id, old.service_id, old.professional_id) then raise exception 'appointment identity is immutable'; end if;
    if new.starts_at = old.starts_at and new.ends_at = old.ends_at then return new; end if;
    if old.status <> 'scheduled' or new.status <> old.status then raise exception 'appointment cannot be rescheduled'; end if;
    expected_duration := old.ends_at - old.starts_at;
  end if;
  if not exists (select 1 from public.companies where id = new.company_id and (status = 'active' or (status = 'trialing' and trial_ends_at > now()))) then raise exception 'subscription blocked'; end if;
  if exists (select 1 from public.customers where company_id = new.company_id and id = new.customer_id and archived_at is not null)
    or exists (select 1 from public.professionals where company_id = new.company_id and id = new.professional_id and archived_at is not null) then raise exception 'record unavailable'; end if;
  select duration_minutes into duration from public.services where company_id = new.company_id and id = new.service_id and archived_at is null;
  if duration is null then raise exception 'invalid service'; end if;
  if tg_op = 'INSERT' then expected_duration := make_interval(mins => duration); end if;
  if new.starts_at is null or new.ends_at is null or not isfinite(new.starts_at) or not isfinite(new.ends_at)
    or new.starts_at < now() or new.ends_at - new.starts_at <> expected_duration then raise exception 'invalid interval'; end if;
  s := new.starts_at at time zone 'America/Sao_Paulo'; e := new.ends_at at time zone 'America/Sao_Paulo';
  sm := extract(hour from s)::integer * 60 + extract(minute from s)::integer; em := extract(hour from e)::integer * 60 + extract(minute from e)::integer;
  if s::date <> e::date or extract(second from s) <> 0 or not exists (select 1 from public.availability
    where company_id = new.company_id and professional_id = new.professional_id and weekday = extract(isodow from s) and start_minute <= sm and end_minute >= em) then raise exception 'outside business hours'; end if;
  if exists (select 1 from public.schedule_blocks where company_id = new.company_id and (professional_id is null or professional_id = new.professional_id)
    and tstzrange(starts_at, ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')) then raise exception 'schedule blocked'; end if;
  return new;
end;
$$;
