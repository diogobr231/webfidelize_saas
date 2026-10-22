-- User correction: Empresarial costs R$149.90/month for up to 10 professionals.
-- Only the catalogue changes; subscription, trial and billing state stay intact.
update public.plans
set price_cents = 14990, staff_limit = 10
where id = 'empresarial';
