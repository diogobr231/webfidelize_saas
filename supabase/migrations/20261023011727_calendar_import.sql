-- A migration copies occupancy; it never stores uploaded files, titles or contacts.
create table private.calendar_import_entries (
  company_id uuid not null references public.companies(id),
  professional_id uuid not null,
  source_key text not null check (source_key ~ '^[a-f0-9]{64}$'),
  payload_hash text not null,
  kind text not null check (kind in ('block','appointment')),
  target_id uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key(company_id, professional_id, source_key),
  foreign key(company_id, professional_id) references public.professionals(company_id,id)
);
alter table private.calendar_import_entries enable row level security;
revoke all on private.calendar_import_entries from public,anon,authenticated;

create function private.import_calendar_entries(p_company uuid, p_items jsonb, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  item jsonb; results jsonb := '[]'::jsonb; seen text[] := '{}';
  source text; professional uuid; customer uuid; service uuid; starts timestamptz; ends timestamptz;
  kind text; fingerprint text; existing private.calendar_import_entries%rowtype;
  target uuid; item_status text; reason text; error_message text;
  imported integer := 0; duplicates integer := 0; conflicts integer := 0; invalid integer := 0;
begin
  perform private.lock_business_company(p_company);
  if p_dry_run is null or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) not between 1 and 200
     or octet_length(p_items::text) > 300000 then raise exception 'invalid import batch'; end if;

  -- Subtransactions use the real scheduling validators for preview as well as
  -- commit. Raising our private rollback code undoes ALL inserts and trigger
  -- side effects, while retaining the per-row report in PL/pgSQL variables.
  begin
    for item in select value from jsonb_array_elements(p_items) loop
      source := item->>'source_key'; item_status := 'ready'; reason := null;
      begin
        if jsonb_typeof(item) is distinct from 'object' or source is null or source !~ '^[a-f0-9]{64}$'
          or (item->>'kind') is null or (item->>'kind') not in ('block','appointment') then
          raise exception 'invalid import item';
        end if;
        professional := (item->>'professional_id')::uuid;
        customer := nullif(item->>'customer_id','')::uuid;
        service := nullif(item->>'service_id','')::uuid;
        starts := (item->>'starts_at')::timestamptz; ends := (item->>'ends_at')::timestamptz;
        kind := item->>'kind';
        if professional is null or starts is null or ends is null or not isfinite(starts) or not isfinite(ends)
          or starts < now() or ends <= starts or ends - starts > interval '31 days'
          or ends > now() + interval '2 years' then raise exception 'invalid import interval'; end if;
        if not exists(select 1 from public.professionals where company_id=p_company and id=professional and archived_at is null) then
          raise exception 'unavailable import record'; end if;
        if kind = 'appointment' and (customer is null or service is null or
          not exists(select 1 from public.customers where company_id=p_company and id=customer and archived_at is null) or
          not exists(select 1 from public.services where company_id=p_company and id=service and archived_at is null)) then
          raise exception 'unavailable import record'; end if;
        if kind='block' and (customer is not null or service is not null) then raise exception 'invalid import item'; end if;
        fingerprint := encode(sha256(convert_to(jsonb_build_object('professional',professional,'customer',customer,
          'service',service,'starts',starts,'ends',ends,'kind',kind)::text,'UTF8')),'hex');
        if (professional::text || ':' || source) = any(seen) then raise exception 'duplicate in import batch'; end if;
        seen := array_append(seen,professional::text || ':' || source);
        select * into existing from private.calendar_import_entries
          where company_id=p_company and professional_id=professional and source_key=source;
        if found then
          if existing.payload_hash <> fingerprint then raise exception 'import source changed'; end if;
          item_status := 'duplicate'; duplicates := duplicates + 1;
        else
          if exists(select 1 from public.schedule_blocks b where b.company_id=p_company
            and (b.professional_id is null or b.professional_id=professional)
            and tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(starts,ends,'[)')) then
            raise exception 'schedule blocked'; end if;
          if kind='block' then
            target := gen_random_uuid();
            perform private.create_schedule_block(p_company,target,professional,starts,ends,'Compromisso importado');
          else
            if ends - starts <> (select make_interval(mins=>duration_minutes) from public.services where company_id=p_company and id=service) then
              raise exception 'invalid service duration'; end if;
            select public.book_appointment(p_company,customer,service,professional,starts) into target;
          end if;
          insert into private.calendar_import_entries(company_id,professional_id,source_key,payload_hash,kind,target_id,created_by)
            values(p_company,professional,source,fingerprint,kind,target,auth.uid());
          imported := imported + 1;
        end if;
      exception when others then
        get stacked diagnostics error_message = message_text;
        if error_message like '%conflict%' or error_message like '%blocked%' or sqlstate='23P01' then
          item_status := 'conflict'; reason := 'schedule_conflict'; conflicts := conflicts+1;
        elsif error_message = 'import source changed' then
          item_status := 'conflict'; reason := 'source_changed'; conflicts := conflicts+1;
        else
          item_status := 'invalid'; invalid := invalid+1;
          reason := case error_message
            when 'unavailable import record' then 'unavailable_record'
            when 'invalid import interval' then 'invalid_interval'
            when 'outside business hours' then 'outside_hours'
            when 'invalid service duration' then 'invalid_service_duration'
            when 'duplicate in import batch' then 'duplicate_in_batch'
            else 'invalid' end;
        end if;
      end;
      results := results || jsonb_build_array(jsonb_build_object('source_key',source,'status',item_status,'reason',reason));
    end loop;
    if p_dry_run or conflicts > 0 or invalid > 0 then raise exception using errcode='WF001',message='import preview rollback'; end if;
  exception when sqlstate 'WF001' then imported := 0;
  end;
  if not p_dry_run and conflicts=0 and invalid=0 then
    select jsonb_agg(case when value->>'status'='ready' then jsonb_set(value,'{status}','"imported"'::jsonb) else value end)
      into results from jsonb_array_elements(results);
  end if;
  return jsonb_build_object('items',results,'imported',imported,'duplicates',duplicates,'conflicts',conflicts,'invalid',invalid);
end;
$$;
create function public.import_calendar_entries(p_company uuid, p_items jsonb, p_dry_run boolean default true)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.import_calendar_entries(p_company,p_items,p_dry_run);
$$;
revoke all on function private.import_calendar_entries(uuid,jsonb,boolean),public.import_calendar_entries(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function private.import_calendar_entries(uuid,jsonb,boolean),public.import_calendar_entries(uuid,jsonb,boolean) to authenticated;
