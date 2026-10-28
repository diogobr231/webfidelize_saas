-- Scheduled internal operations, with no external requests or billing changes.
-- Hosted Supabase supports pg_cron. Disposable PGlite tests do not: they still
-- exercise the same worker directly and validate scheduling on hosted Postgres.
do $install$
begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    grant usage on schema cron to postgres;
    grant all privileges on all tables in schema cron to postgres;

    perform cron.schedule(
      'webfidelize-platform-operations',
      '*/15 * * * *',
      'set statement_timeout = ''30s''; select private.run_platform_automations(''scheduled'');'
    );
    -- Keep technical execution logs bounded without deleting business history.
    perform cron.schedule(
      'webfidelize-platform-operations-log-retention',
      '17 4 * * *',
      $command$
        delete from cron.job_run_details
        where jobid in (
          select jobid from cron.job where jobname in (
            'webfidelize-platform-operations',
            'webfidelize-platform-operations-log-retention'
          )
        ) and end_time < now() - interval '30 days';
        delete from public.platform_automation_runs
        where finished_at < now() - interval '90 days';
      $command$
    );
  else
    raise notice 'pg_cron unavailable: internal worker remains callable; scheduler not installed in this environment';
  end if;
end;
$install$;
