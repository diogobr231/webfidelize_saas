import { PGlite } from "@electric-sql/pglite";

/**
 * Old-cohort fixtures for unrelated regression suites in disposable PostgreSQL.
 * Never import this into the application or apply its SQL to a remote database.
 * The card policy suite deliberately does NOT install this helper.
 */
export async function installLegacyTrialFixtures(db: PGlite) {
  if (!(db instanceof PGlite)) {
    throw new Error(
      "Legacy trial fixtures require a disposable PGlite instance",
    );
  }
  await db.exec(`
    alter table public.companies alter column trial_card_required set default false;
    create function private.test_fixture_legacy_trial() returns trigger
    language plpgsql security invoker set search_path = '' as $$
    begin
      if not new.trial_card_required and new.status = 'pending_card' then
        update public.companies set status = 'trialing', trial_ends_at = now() + interval '7 days'
          where id = new.id;
      end if;
      return new;
    end;
    $$;
    revoke all on function private.test_fixture_legacy_trial() from public, anon, authenticated;
    create trigger test_fixture_legacy_trial after insert on public.companies
      for each row execute function private.test_fixture_legacy_trial();
  `);
  // Unrelated legacy suites explicitly set status='active' as a paid fixture.
  // Give those disposable rows an equally explicit synthetic payment/period,
  // rather than weakening the production entitlement predicate for old tests.
  if (
    (
      await db.query<{ present: string | null }>(
        "select to_regclass('private.billing_entitlements') as present",
      )
    ).rows[0]?.present
  ) {
    await db.exec(`
      create function private.test_fixture_paid_period() returns trigger
      language plpgsql security definer set search_path='' as $$
      declare payer uuid; checkout uuid:=gen_random_uuid(); payment uuid:=gen_random_uuid(); price integer;
        deadline timestamptz:=now()+interval '1 month';
      begin
        if new.status<>'active' or exists(select 1 from private.billing_entitlements where company_id=new.id) then return new; end if;
        select user_id into payer from public.memberships where company_id=new.id and role='OWNER' limit 1;
        if payer is null then select id into payer from auth.users order by id limit 1; end if;
        if payer is null then raise exception 'Synthetic paid fixture requires a synthetic auth user'; end if;
        select greatest(price_cents,1) into price from public.plans where id=new.plan_id;
        insert into private.billing_checkouts(id,company_id,requested_by,plan_id,method,amount_cents,environment,collector_id,external_reference,status,reserved_start)
          values(checkout,new.id,payer,new.plan_id,'pix',price,'live','0','fixture-'||checkout::text,'completed',now());
        insert into private.billing_payments(id,company_id,checkout_id,provider_id,environment,collector_id,method,amount_cents,currency,status,approved_at,last_modified)
          values(payment,new.id,checkout,'fixture-'||payment::text,'live','0','pix',price,'BRL','approved',now(),now());
        insert into private.billing_entitlements(payment_id,company_id,plan_id,starts_at,ends_at)
          values(payment,new.id,new.plan_id,now()-interval '1 day',deadline);
        update public.companies set paid_until=deadline where id=new.id;
        return new;
      end $$;
      revoke all on function private.test_fixture_paid_period() from public,anon,authenticated;
      create trigger test_fixture_paid_period after update of status on public.companies
        for each row execute function private.test_fixture_paid_period();
    `);
  }
}
