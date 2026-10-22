-- Prices explicitly requested by the platform owner. This updates the catalogue,
-- not company access, trials, subscription status or existing commercial proposals.
update public.plans set price_cents=4990, staff_limit=1 where id='essencial';
update public.plans set price_cents=8990, staff_limit=3 where id='profissional';
update public.plans set price_cents=19990, staff_limit=10 where id='empresarial';
