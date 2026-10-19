-- Only the non-sensitive commercial catalogue is readable without a session.
grant select (id,name,price_cents,staff_limit) on public.plans to anon;
create policy plans_public_catalog on public.plans for select to anon using (true);
