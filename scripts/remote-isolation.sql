begin;
-- Explicit disposable fixtures. Rolled back in the same request, never shown as business data.
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000091'),('00000000-0000-4000-8000-000000000092');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000091',true);
select public.create_company('TESTE DESCARTÁVEL A','salao');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000092',true);
select public.create_company('TESTE DESCARTÁVEL B','pet-shop');
do $$ begin
 if (select count(*) from public.companies)<>1 or (select name from public.companies)<>'TESTE DESCARTÁVEL B' then raise exception 'ISOLATION FAILED'; end if;
 begin
  update public.companies set status='active';
  raise exception 'BILLING ESCALATION ALLOWED';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.memberships select id,'00000000-0000-4000-8000-000000000092','OWNER' from public.companies;
  raise exception 'ROLE ESCALATION ALLOWED';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: remote tenant isolation, billing protection and role escalation denied; fixtures rolled back' as verification;
rollback;
