-- Manual production setup only. Never put secrets or localhost URLs here.
-- Enable pg_cron and pg_net using Supabase Extensions first.
-- In Supabase Vault create:
--   webfidelize_whatsapp_process_url = https://YOUR_DOMAIN/api/whatsapp/process
--   webfidelize_whatsapp_cron_secret = same private CRON_SECRET as the app
-- Read docs/WHATSAPP.md before executing. Re-running updates this named job.
do $$
begin
  if not exists(select 1 from vault.decrypted_secrets
    where name='webfidelize_whatsapp_process_url'
      and decrypted_secret ~ '^https://[^/@?#[:space:]]+/api/whatsapp/process$')
    or not exists(select 1 from vault.decrypted_secrets
      where name='webfidelize_whatsapp_cron_secret' and length(decrypted_secret)>=32) then
    raise exception 'Configure the production URL and cron secret in Vault first';
  end if;
end;
$$;

select cron.schedule('webfidelize-whatsapp-reminders','* * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='webfidelize_whatsapp_process_url'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='webfidelize_whatsapp_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$job$);
