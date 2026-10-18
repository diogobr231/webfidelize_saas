-- One-time installation bootstrap. Address is provisioned privately, never in source control.
create table private.admin_bootstrap(email text primary key);
alter table private.admin_bootstrap enable row level security;
create policy admin_bootstrap_deny on private.admin_bootstrap for all to authenticated using(false) with check(false);
revoke all on private.admin_bootstrap from public,anon,authenticated;
create function private.consume_admin_bootstrap() returns trigger language plpgsql security definer set search_path='' as $$
 begin
 if new.email_confirmed_at is null or new.email is null then return new; end if;
 -- Only the Auth service can write auth.users. Clients cannot invoke this trigger directly.
 perform pg_advisory_xact_lock(730181);
 if not exists(select 1 from private.platform_admins) and exists(select 1 from private.admin_bootstrap where email=lower(new.email)) then
   insert into private.platform_admins(user_id) values(new.id);
   delete from private.admin_bootstrap;
 end if;
 return new; end;
$$;
revoke all on function private.consume_admin_bootstrap() from public,anon,authenticated;
create trigger bootstrap_platform_admin after insert or update of email,email_confirmed_at on auth.users for each row execute function private.consume_admin_bootstrap();
