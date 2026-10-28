-- Preserve historical investment bands. New inquiries can identify a plan instead.
alter table public.sales_leads drop constraint sales_leads_budget_range_check;
alter table public.sales_leads add constraint sales_leads_budget_range_check check (budget_range in ('','explore','under-1000','1000-3000','3000-10000','over-10000','plan-essencial','plan-profissional','plan-empresarial','other'));

create or replace function private.sales_contact(p_input jsonb, p_strict boolean) returns jsonb language plpgsql set search_path = '' as $$
declare v jsonb := '{}'::jsonb; k text; s text; offer uuid; email text; phone text;
begin
  if jsonb_typeof(p_input -> 'offer_id') is distinct from 'string' then raise exception 'invalid sales input'; end if;
  begin offer := (p_input ->> 'offer_id')::uuid; exception when invalid_text_representation then raise exception 'invalid sales input'; end;
  if offer is null then raise exception 'invalid sales input'; end if;
  email := lower(private.sales_text(p_input, 'email', 0, 254, ''));
  if (p_strict or email <> '') and email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?([.][A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$' then raise exception 'invalid sales input'; end if;
  phone := private.sales_text(p_input, 'phone', 10, 30);
  if phone ~ '[^0-9[:space:]()+.-]' then raise exception 'invalid sales input'; end if;
  phone := regexp_replace(phone, '[^0-9]', '', 'g');
  if phone ~ '^[1-9][1-9][0-9]{8,9}$' then phone := '55' || phone; end if;
  if phone !~ '^55[1-9][1-9][0-9]{8,9}$' then raise exception 'invalid sales input'; end if;
  v := jsonb_build_object('offer_id', offer, 'contact_name', private.sales_text(p_input, 'contact_name', 2, 120),
    'company_name', private.sales_text(p_input, 'company_name', 2, 160), 'email', email, 'phone', phone,
    'challenge', private.sales_text(p_input, 'challenge', case when p_strict then 10 else 0 end, 2000, ''));
  foreach k in array array['niche','team_size','budget_range','timeline','decision_role'] loop
    s := private.sales_text(p_input, k, case when p_strict then 1 else 0 end, 30, '');
    if s <> '' and not (case k
      when 'niche' then s = any(array['salao','pet-shop','clinica','escritorio','restaurante','fornecedores','logistica','academia','outro'])
      when 'team_size' then s = any(array['solo','2-5','6-10','11-30','31-plus'])
      when 'budget_range' then s = any(array['explore','under-1000','1000-3000','3000-10000','over-10000','plan-essencial','plan-profissional','plan-empresarial','other'])
      when 'timeline' then s = any(array['soon','30-days','90-days','research'])
      when 'decision_role' then s = any(array['owner','manager','team']) end) then raise exception 'invalid sales input'; end if;
    if k = 'budget_range' and s like 'plan-%' and not exists(select 1 from public.plans where id=substr(s,6)) then raise exception 'invalid sales input'; end if;
    v := v || jsonb_build_object(k,s);
  end loop;
  return v;
end;
$$;
