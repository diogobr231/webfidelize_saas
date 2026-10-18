create schema if not exists extensions;
alter extension btree_gist set schema extensions;
create policy platform_admins_deny_direct on private.platform_admins for all to authenticated using(false) with check(false);
