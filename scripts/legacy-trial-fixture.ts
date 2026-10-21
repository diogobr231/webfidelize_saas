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
}
