-- Explicitly authorized DEMO fixture for the three-plan acceptance test.
-- Run through a trusted administrative SQL connection only. No application RPC,
-- password literal, provider credential, paid status, new trial or email send.
-- Existing demo owners keep their credentials; new synthetic employee accounts
-- use the corresponding demo owner's existing password hash (never returned).
-- This fixture intentionally refuses real companies, expired trials or unknown
-- pre-existing employee accounts. It does not modify Auth settings or triggers.
begin;
do $$
declare fixture record; tenant public.companies%rowtype; owner_account auth.users%rowtype;
  employee uuid; professional public.professionals%rowtype; unused public.professionals%rowtype;
  limit_count integer; preserved_access text;
begin
  select md5(string_agg(id::text || status || coalesce(trial_ends_at::text,''), ',' order by id))
    into preserved_access from public.companies;
  for fixture in select * from (values
    ('demo-academia','academia@example.invalid','essencial.colaborador@example.invalid','essencial'),
    ('demo-escritorio','escritorio@example.invalid','profissional.colaborador@example.invalid','profissional'),
    ('demo-salao','salao@example.invalid','empresarial.colaborador@example.invalid','empresarial')
  ) as f(slug, owner_email, employee_email, plan) loop
    select * into strict tenant from public.companies where booking_slug=fixture.slug for update;
    if not tenant.is_demo or tenant.name not like 'DEMO%' or tenant.trial_card_required
      or tenant.status <> 'trialing' or tenant.trial_ends_at is null
      or not isfinite(tenant.trial_ends_at) or tenant.trial_ends_at <= now() then
      raise exception 'Only pre-existing, unexpired DEMO fixtures are allowed';
    end if;
    select u.* into strict owner_account from auth.users u join public.memberships m on m.user_id=u.id
      where m.company_id=tenant.id and m.role='OWNER' and u.email=fixture.owner_email;
    if owner_account.email_confirmed_at is null or nullif(owner_account.encrypted_password,'') is null
      or exists(select 1 from private.platform_admins where user_id=owner_account.id) then
      raise exception 'Expected ordinary confirmed DEMO owner';
    end if;
    perform set_config('request.jwt.claim.sub',owner_account.id::text,true);
    select id into employee from auth.users where email=fixture.employee_email;
    if employee is null then
      employee := gen_random_uuid();
      insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
        raw_app_meta_data,raw_user_meta_data,is_super_admin,is_sso_user,is_anonymous,
        confirmation_token,recovery_token,email_change_token_new,email_change_token_current,
        email_change,phone_change,phone_change_token,reauthentication_token,created_at,updated_at)
      values(owner_account.instance_id,employee,'authenticated','authenticated',fixture.employee_email,
        owner_account.encrypted_password,now(),
        jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'demo_fixture','plan_access'),
        jsonb_build_object('name','Colaborador DEMO '||fixture.plan),false,false,false,
        '','','','','','','','',now(),now());
      insert into auth.identities(user_id,provider_id,provider,identity_data,created_at,updated_at)
      values(employee,employee::text,'email',jsonb_build_object('sub',employee::text,
        'email',fixture.employee_email,'email_verified',true,'phone_verified',false),now(),now());
    elsif not exists(select 1 from auth.users where id=employee and raw_app_meta_data->>'demo_fixture'='plan_access')
      or exists(select 1 from public.memberships where user_id=employee and (company_id<>tenant.id or role<>'EMPLOYEE'))
      or exists(select 1 from private.platform_admins where user_id=employee) then
      raise exception 'Refusing to repurpose an unrelated user';
    end if;
    insert into public.memberships(company_id,user_id,role) values(tenant.id,employee,'EMPLOYEE')
      on conflict(company_id,user_id) do nothing;
    if fixture.plan='essencial' then
      select * into strict unused from public.professionals where company_id=tenant.id and name='Profissional DEMO 02';
      if unused.user_id is not null or exists(select 1 from public.appointments where company_id=tenant.id and professional_id=unused.id) then
        raise exception 'Cannot archive a used professional for this fixture';
      end if;
      if unused.archived_at is null then
        perform public.archive_business_record(tenant.id,'professionals',unused.id,unused.record_version,true);
      end if;
    end if;
    select staff_limit into strict limit_count from public.plans where id=fixture.plan;
    if (select count(*) from public.professionals where company_id=tenant.id and archived_at is null)>limit_count
      or (select count(*) from public.memberships where company_id=tenant.id and role<>'OWNER')>limit_count then
      raise exception 'Fixture exceeds the requested plan capacity';
    end if;
    update public.companies set plan_id=fixture.plan where id=tenant.id and is_demo;
    select * into strict professional from public.professionals
      where company_id=tenant.id and name='Profissional DEMO 01' and archived_at is null;
    if professional.user_id is distinct from owner_account.id and professional.user_id is distinct from employee then
      raise exception 'Refusing to replace an unrelated professional assignment';
    end if;
    perform public.assign_professional_member(tenant.id,professional.id,employee,professional.user_id,true);
  end loop;
  if preserved_access is distinct from (select md5(string_agg(id::text || status || coalesce(trial_ends_at::text,''), ',' order by id)) from public.companies) then
    raise exception 'Fixture must never change subscription status or trial deadlines';
  end if;
end;
$$;
commit;
