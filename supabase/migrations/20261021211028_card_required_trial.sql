-- Existing customers keep their original status and trial deadline. Only companies
-- created after this migration require card authorization before a trial can start.
alter table public.companies
  add column trial_card_required boolean not null default false;
alter table public.companies
  alter column trial_card_required set default true,
  alter column status set default 'pending_card',
  alter column trial_ends_at drop not null,
  alter column trial_ends_at drop default;
alter table public.companies drop constraint companies_status_check;
alter table public.companies
  add constraint companies_status_check
    check (status in ('pending_card', 'trialing', 'active', 'past_due', 'canceled', 'suspended')),
  add constraint companies_pending_card_no_trial
    check (status <> 'pending_card' or trial_ends_at is null);

comment on column public.companies.trial_card_required is
  'Immutable enrollment cohort: true for companies created after the card-required trial policy. No card or payment credential is stored here.';

-- Neither a browser write nor a manual SUPER_ADMIN trial extension is evidence
-- of card authorization. The payment provider is not integrated yet: deliberately
-- fail closed rather than accepting a checkbox, token supplied by a browser, or a
-- fabricated approval. A later provider migration must add verified authorization.
create function private.guard_company_trial_card() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending_card' or new.trial_ends_at is not null then
      raise exception 'card authorization required';
    end if;
  elsif new.trial_card_required is distinct from old.trial_card_required then
    raise exception 'trial enrollment policy is immutable';
  end if;
  if new.trial_card_required and (new.status = 'trialing' or new.trial_ends_at is not null) then
    raise exception 'card authorization required';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_company_trial_card() from public, anon, authenticated;
create trigger guard_company_trial_card
  before insert or update on public.companies
  for each row execute function private.guard_company_trial_card();
revoke insert(trial_card_required), update(trial_card_required) on public.companies from anon, authenticated;

create or replace function private.create_company(company_name text, company_niche text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  if exists (select 1 from public.memberships where user_id = auth.uid() and role = 'OWNER') then
    raise exception 'existing owner: contact support';
  end if;
  insert into public.companies(name, niche, status, trial_ends_at)
    values (company_name, company_niche, 'pending_card', null) returning id into result;
  insert into public.memberships values (result, auth.uid(), 'OWNER');
  return result;
end;
$$;

create or replace function private.admin_company(c uuid, new_plan text, new_status text, new_trial timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare max_staff integer; card_required boolean;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'not authorized'; end if;
  select trial_card_required into card_required from public.companies where id = c for update;
  if not found then raise exception 'company not found'; end if;
  select staff_limit into max_staff from public.plans where id = new_plan;
  if max_staff is null or max_staff < (select count(*) from public.professionals where company_id = c and archived_at is null)
     or max_staff < (select count(*) from public.memberships where company_id = c and role <> 'OWNER') then
    raise exception 'plan limit';
  end if;
  if card_required then
    if new_status = 'trialing' or new_trial is not null then raise exception 'card authorization required'; end if;
    if new_status is null or new_status not in ('pending_card', 'suspended', 'canceled') then raise exception 'invalid manual status'; end if;
  else
    if new_status is null or new_status not in ('trialing', 'suspended', 'canceled') then raise exception 'invalid manual status'; end if;
    if new_trial is null or not isfinite(new_trial) then raise exception 'invalid trial date'; end if;
    if new_trial > now() + interval '30 days' then raise exception 'trial extension maximum 30 days'; end if;
  end if;
  update public.companies set plan_id = new_plan, status = new_status, trial_ends_at = new_trial where id = c;
end;
$$;

-- CREATE OR REPLACE preserves the existing restricted grants on these RPC bodies.
-- Existing RLS / booking / reminder checks allow only active or unexpired trialing
-- companies, so pending_card has read access through membership and no business use.
