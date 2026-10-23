-- Temporary commercial policy: the first seven days do not require a card.
-- Deadlines are created by PostgreSQL, not accepted from browser parameters.
-- No subscription, payment authorization or paid status is created here.
alter table public.companies
  alter column trial_card_required set default false,
  alter column status set default 'trialing',
  alter column trial_ends_at set default (now() + interval '7 days');

-- DDL holds the table lock for this migration's transaction. Remove only this
-- trigger while converting the never-started cohort, then immediately restore
-- its immutable-cohort guard. Expired/running trials and administrative blocks
-- are deliberately excluded, and rerunning this migration cannot renew a trial.
drop trigger guard_company_trial_card on public.companies;
update public.companies
  set trial_card_required = false,
      status = 'trialing',
      trial_ends_at = now() + interval '7 days'
  where trial_card_required
    and status = 'pending_card'
    and trial_ends_at is null;

create or replace function private.guard_company_trial_card() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.trial_card_required then
      if new.status <> 'pending_card' or new.trial_ends_at is not null then
        raise exception 'card authorization required';
      end if;
    elsif new.status <> 'trialing'
      or new.trial_ends_at is distinct from (now() + interval '7 days') then
      raise exception 'new trial must last seven days';
    end if;
  elsif new.trial_card_required is distinct from old.trial_card_required then
    raise exception 'trial enrollment policy is immutable';
  end if;
  if new.trial_card_required and (new.status = 'trialing' or new.trial_ends_at is not null) then
    raise exception 'card authorization required';
  end if;
  if new.status = 'trialing' and (new.trial_ends_at is null or not isfinite(new.trial_ends_at)) then
    raise exception 'invalid trial date';
  end if;
  return new;
end;
$$;
create trigger guard_company_trial_card
  before insert or update on public.companies
  for each row execute function private.guard_company_trial_card();
revoke all on function private.guard_company_trial_card() from public, anon, authenticated;

comment on column public.companies.trial_card_required is
  'Immutable enrollment policy. New companies and never-started pending-card companies receive a server-timed seven-day no-card trial. Historical blocked card cohorts remain blocked. No card credentials are stored here.';

create or replace function private.create_company(company_name text, company_niche text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  if exists (select 1 from public.memberships where user_id = auth.uid() and role = 'OWNER') then
    raise exception 'existing owner: contact support';
  end if;
  insert into public.companies(name, niche, plan_id, status, trial_ends_at, trial_card_required)
    values (company_name, company_niche, 'essencial', 'trialing', now() + interval '7 days', false)
    returning id into result;
  insert into public.memberships values (result, auth.uid(), 'OWNER');
  return result;
end;
$$;

-- CREATE OR REPLACE retains the RPC's restricted grants. The existing admin RPC
-- still rejects manual paid activation and limits authorized trial extensions.
-- Existing RLS, private.writable and public booking gates enforce expiration
-- immediately, without relying on a browser clock or a scheduled cleanup job.
