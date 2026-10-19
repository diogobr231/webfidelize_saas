-- Historical customer creation dates were never recorded. Leave them unknown.
alter table public.customers add column created_at timestamptz;
alter table public.customers alter column created_at set default now();
create index customers_company_created_idx on public.customers(company_id, created_at);

create function private.stamp_customer_created_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  elsif new.created_at is distinct from old.created_at then
    raise exception 'customer creation date is immutable';
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_customer_created_at() from public, anon, authenticated;
create trigger customer_creation_timestamp before insert or update of created_at on public.customers
for each row execute function private.stamp_customer_created_at();

-- A single bounded aggregate avoids the Data API row limit. All reads retain RLS.
create function public.executive_dashboard(p_company uuid, p_start date, p_end date)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  member text;
  days integer;
  first_instant timestamptz;
  end_instant timestamptz;
  previous_instant timestamptz;
  result jsonb;
  customer_stats jsonb := null;
begin
  member := private.member_role(p_company);
  if auth.uid() is null or member is null then raise exception 'not authorized'; end if;
  if p_start is null or p_end is null or p_start < date '1900-01-01'
     or p_end > date '2099-12-31' or p_end < p_start or p_end - p_start > 89
     or p_end > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'invalid dashboard period';
  end if;
  days := p_end - p_start + 1;
  first_instant := p_start::timestamp at time zone 'America/Sao_Paulo';
  end_instant := (p_end + 1)::timestamp at time zone 'America/Sao_Paulo';
  previous_instant := (p_start - days)::timestamp at time zone 'America/Sao_Paulo';

  if member in ('OWNER', 'MANAGER') then
    select jsonb_build_object(
      'total', count(*),
      'new', count(*) filter (where created_at >= first_instant and created_at < end_instant),
      'previous_new', count(*) filter (where created_at >= previous_instant and created_at < first_instant),
      'without_created_at', count(*) filter (where created_at is null)
    ) into customer_stats from public.customers where company_id = p_company;
  end if;

  with scoped as materialized (
    select starts_at, status, customer_id
    from public.appointments
    where company_id = p_company and starts_at >= previous_instant and starts_at < end_instant
  ),
  current_counts as (
    select count(*) as appointments,
      count(*) filter (where status = 'scheduled') as scheduled,
      count(*) filter (where status = 'completed') as completed,
      count(*) filter (where status = 'canceled') as canceled,
      count(distinct customer_id) filter (where status = 'completed') as attended_customers
    from scoped where starts_at >= first_instant
  ),
  previous_counts as (
    select count(*) as appointments,
      count(*) filter (where status = 'scheduled') as scheduled,
      count(*) filter (where status = 'completed') as completed,
      count(*) filter (where status = 'canceled') as canceled,
      count(distinct customer_id) filter (where status = 'completed') as attended_customers
    from scoped where starts_at < first_instant
  ),
  appointments_by_day as (
    select (starts_at at time zone 'America/Sao_Paulo')::date as day,
      count(*) as appointments,
      count(*) filter (where status = 'completed') as completed,
      count(*) filter (where status = 'canceled') as canceled
    from scoped where starts_at >= first_instant group by 1
  ),
  customers_by_day as (
    select (created_at at time zone 'America/Sao_Paulo')::date as day, count(*) as new_customers
    from public.customers
    where member in ('OWNER', 'MANAGER') and company_id = p_company
      and created_at >= first_instant and created_at < end_instant group by 1
  ),
  calendar as (select p_start + i as day from generate_series(0, days - 1) i),
  daily as (
    select d.day, coalesce(a.appointments, 0) as appointments,
      coalesce(a.completed, 0) as completed, coalesce(a.canceled, 0) as canceled,
      case when member in ('OWNER', 'MANAGER') then coalesce(c.new_customers, 0) else null end as new_customers
    from calendar d left join appointments_by_day a using(day) left join customers_by_day c using(day)
  )
  select jsonb_build_object(
    'scope', case when member in ('OWNER', 'MANAGER') then 'company' else 'personal' end,
    'current', (select to_jsonb(c) from current_counts c),
    'previous', (select to_jsonb(c) from previous_counts c),
    'customers', customer_stats,
    'daily', (select jsonb_agg(to_jsonb(d) order by d.day) from daily d),
    'financial_available', false
  ) into result;
  return result;
end;
$$;
revoke all on function public.executive_dashboard(uuid, date, date) from public, anon, authenticated;
grant execute on function public.executive_dashboard(uuid, date, date) to authenticated;
