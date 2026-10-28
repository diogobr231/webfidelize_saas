-- Managed social services: exclusively operated by current platform administrators.
create table public.platform_social_accounts (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 network text not null check(network in ('instagram','facebook')),
 external_id text not null check(external_id ~ '^[0-9]{5,30}$'), label text not null check(length(label) between 1 and 200),
 active boolean not null default true, updated_at timestamptz not null default now(),
 unique(network,external_id), unique(id,company_id)
);
create table private.social_credentials (
 account_id uuid primary key references public.platform_social_accounts(id),
 encrypted_token text not null check(length(encrypted_token) between 40 and 20000)
);
create table private.social_worker_configuration (
 singleton boolean primary key default true check(singleton), secret_hash text not null check(length(secret_hash)=64)
);
create table public.platform_social_posts (
 id uuid primary key, company_id uuid not null references public.companies(id),
 account_id uuid, title text not null check(length(trim(title)) between 3 and 100),
 caption text not null default '' check(length(caption)<=2200), alt_text text not null default '' check(length(alt_text)<=1000),
 asset_path text check(asset_path=company_id::text||'/'||id::text||'.jpg'),
 scheduled_at timestamptz, time_zone text not null default 'America/Sao_Paulo' check(time_zone in ('America/Sao_Paulo','America/Manaus','America/Rio_Branco','America/Noronha')),
 status text not null default 'draft' check(status in ('draft','planned','scheduled','publishing','published','failed','unknown','cancelled')),
 version integer not null default 1, provider_id text, error_code text,
 attempt_id uuid, started_at timestamptz, approved_by uuid references auth.users(id),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(account_id,company_id) references public.platform_social_accounts(id,company_id)
);
create index social_posts_company_time on public.platform_social_posts(company_id,created_at desc,id);
create index social_posts_due on public.platform_social_posts(scheduled_at,id) where status='scheduled';
create index social_accounts_company on public.platform_social_accounts(company_id);
create index social_posts_account on public.platform_social_posts(account_id,company_id);
create index social_posts_creator on public.platform_social_posts(created_by);
create index social_posts_approver on public.platform_social_posts(approved_by);
create table public.platform_social_events (
 id bigint generated always as identity primary key, post_id uuid not null references public.platform_social_posts(id),
 kind text not null, actor_id uuid references auth.users(id), created_at timestamptz not null default now()
);
create index social_events_post on public.platform_social_events(post_id,created_at desc);
create index social_events_actor on public.platform_social_events(actor_id);
create table public.platform_social_generations (
 id uuid primary key default gen_random_uuid(), post_id uuid not null references public.platform_social_posts(id), actor_id uuid not null references auth.users(id),
 expected_version integer not null, status text not null default 'reserved' check(status in ('reserved','succeeded','failed','stale')), created_at timestamptz not null default now()
);
create index social_generations_usage on public.platform_social_generations(created_at);
create index social_generations_post on public.platform_social_generations(post_id);
create index social_generations_actor on public.platform_social_generations(actor_id);
create table public.platform_ad_plans (
 id uuid primary key, company_id uuid not null references public.companies(id),
 name text not null check(length(trim(name)) between 3 and 100), objective text not null check(objective in ('traffic','leads','awareness')),
 ad_account_id text not null check(ad_account_id ~ '^[0-9]{5,30}$'),
 media_budget_cents integer not null check(media_budget_cents between 100 and 10000000),
 management_fee_cents integer not null check(management_fee_cents between 0 and 10000000),
 start_date date not null, end_date date not null check(end_date>=start_date), notes text not null default '' check(length(notes)<=1500),
 status text not null default 'draft' check(status in ('draft','reviewed','cancelled')), version integer not null default 1,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index ad_plans_company on public.platform_ad_plans(company_id,created_at desc);
create index ad_plans_creator on public.platform_ad_plans(created_by);
alter table private.social_credentials enable row level security;
alter table private.social_worker_configuration enable row level security;
alter table public.platform_social_accounts enable row level security;
alter table public.platform_social_posts enable row level security;
alter table public.platform_social_events enable row level security;
alter table public.platform_social_generations enable row level security;
alter table public.platform_ad_plans enable row level security;
revoke all on public.platform_social_accounts,public.platform_social_posts,public.platform_social_events,public.platform_social_generations,public.platform_ad_plans from public,anon,authenticated;
revoke all on private.social_credentials,private.social_worker_configuration from public,anon,authenticated;
grant select on public.platform_social_accounts,public.platform_social_posts,public.platform_social_events,public.platform_social_generations,public.platform_ad_plans to authenticated;
create policy social_accounts_admin on public.platform_social_accounts for select to authenticated using((select private.is_admin()));
create policy social_posts_admin on public.platform_social_posts for select to authenticated using((select private.is_admin()));
create policy social_events_admin on public.platform_social_events for select to authenticated using((select private.is_admin()));
create policy social_generations_admin on public.platform_social_generations for select to authenticated using((select private.is_admin()));
create policy ad_plans_admin on public.platform_ad_plans for select to authenticated using((select private.is_admin()));

create function private.social_connect(p_company uuid,p_network text,p_external text,p_label text,p_token text) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.platform_social_accounts;
begin
 if not coalesce(private.is_admin(),false) then raise exception 'social admin required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_network||p_external,3671));
 select * into a from public.platform_social_accounts where network=p_network and external_id=p_external for update;
 if found and a.company_id<>p_company then raise exception 'social account belongs to another company'; end if;
 if a.id is null then
  insert into public.platform_social_accounts(company_id,network,external_id,label) values(p_company,p_network,p_external,p_label) returning * into a;
 else update public.platform_social_accounts set label=p_label,active=true,updated_at=now() where id=a.id; end if;
 insert into private.social_credentials values(a.id,p_token) on conflict(account_id) do update set encrypted_token=excluded.encrypted_token;
 return a.id;
end; $$;
create function public.social_connect(p_company uuid,p_network text,p_external text,p_label text,p_token text) returns uuid
language sql security invoker set search_path='' as $$select private.social_connect(p_company,p_network,p_external,p_label,p_token)$$;

create function private.social_save_post(p_id uuid,p_company uuid,p_version integer,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.platform_social_posts; account uuid;
begin
 if not coalesce(private.is_admin(),false) then raise exception 'social admin required'; end if;
 if p_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload-array['account_id','title','caption','alt_text','asset_path','scheduled_at','time_zone']<>'{}'::jsonb then raise exception 'social invalid fields'; end if;
 account:=nullif(p_payload->>'account_id','')::uuid;
 if account is not null and not exists(select 1 from public.platform_social_accounts where id=account and company_id=p_company and active) then raise exception 'social account mismatch'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,3672));
 select * into r from public.platform_social_posts where id=p_id for update;
 if found then
  if p_version is null and r.company_id=p_company and row(r.title,r.caption,r.alt_text,r.account_id,r.asset_path,r.scheduled_at,r.time_zone) is not distinct from row(trim(p_payload->>'title'),trim(p_payload->>'caption'),trim(p_payload->>'alt_text'),account,p_payload->>'asset_path',nullif(p_payload->>'scheduled_at','')::timestamptz,p_payload->>'time_zone') then return to_jsonb(r); end if;
  if r.company_id<>p_company or p_version is null or r.version<>p_version then raise exception 'social version conflict'; end if;
  if r.status not in ('draft','planned','cancelled','failed') then raise exception 'social post locked'; end if;
  update public.platform_social_posts set title=trim(p_payload->>'title'),caption=trim(p_payload->>'caption'),alt_text=trim(p_payload->>'alt_text'),account_id=account,
   scheduled_at=nullif(p_payload->>'scheduled_at','')::timestamptz,time_zone=p_payload->>'time_zone',status='draft',version=version+1,approved_by=null,updated_at=now() where id=p_id returning * into r;
 else
  if p_version is not null then raise exception 'social version conflict'; end if;
  insert into public.platform_social_posts(id,company_id,account_id,title,caption,alt_text,asset_path,scheduled_at,time_zone,created_by)
   values(p_id,p_company,account,trim(p_payload->>'title'),trim(p_payload->>'caption'),trim(p_payload->>'alt_text'),p_payload->>'asset_path',nullif(p_payload->>'scheduled_at','')::timestamptz,p_payload->>'time_zone',auth.uid()) returning * into r;
 end if;
 insert into public.platform_social_events(post_id,kind,actor_id) values(r.id,'saved',auth.uid());
 return to_jsonb(r);
end; $$;
create function public.social_save_post(p_id uuid,p_company uuid,p_version integer,p_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.social_save_post(p_id,p_company,p_version,p_payload)$$;

create function private.social_transition(p_id uuid,p_version integer,p_status text) returns void
language plpgsql security definer set search_path='' as $$
declare r public.platform_social_posts;
begin
 if not coalesce(private.is_admin(),false) then raise exception 'social admin required'; end if;
 select * into r from public.platform_social_posts where id=p_id for update;
 if not found or p_version is null or r.version<>p_version then raise exception 'social version conflict'; end if;
 if r.status in ('publishing','published','unknown') or p_status is null or p_status not in ('planned','scheduled','cancelled','draft') then raise exception 'social invalid transition'; end if;
 if p_status in ('planned','scheduled') then
  if r.scheduled_at is null or r.scheduled_at<now()+interval '5 minutes' or r.scheduled_at>now()+interval '366 days' then raise exception 'social invalid schedule'; end if;
  if length(trim(r.caption))<15 or r.asset_path is null then raise exception 'social content required'; end if;
  if not exists(select 1 from storage.objects where bucket_id='social-assets' and name=r.asset_path) then raise exception 'social asset unavailable'; end if;
 end if;
 if p_status='scheduled' and not exists(select 1 from public.platform_social_accounts where id=r.account_id and company_id=r.company_id and active) then raise exception 'social connection required'; end if;
 update public.platform_social_posts set status=p_status,version=version+1,approved_by=case when p_status='scheduled' then auth.uid() else null end,updated_at=now() where id=p_id;
 insert into public.platform_social_events(post_id,kind,actor_id) values(p_id,p_status,auth.uid());
end; $$;
create function public.social_transition(p_id uuid,p_version integer,p_status text) returns void
language sql security invoker set search_path='' as $$select private.social_transition(p_id,p_version,p_status)$$;

create function private.social_revoke(p_account uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(private.is_admin(),false) then raise exception 'social admin required'; end if;
 if exists(select 1 from public.platform_social_posts where account_id=p_account and status='publishing') then raise exception 'social publishing in progress'; end if;
 update public.platform_social_accounts set active=false,updated_at=now() where id=p_account;
 delete from private.social_credentials where account_id=p_account;
 update public.platform_social_posts set status='planned',approved_by=null,version=version+1 where account_id=p_account and status='scheduled';
end; $$;
create function public.social_revoke(p_account uuid) returns void language sql security invoker set search_path='' as $$select private.social_revoke(p_account)$$;

-- Durable reservations count failed attempts too; a slow/stale generation never overwrites edits.
create function private.social_begin_generation(p_id uuid,p_version integer) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.platform_social_posts; g uuid;
begin
 if not coalesce(private.is_admin(),false) then raise exception 'social admin required'; end if;
 perform pg_advisory_xact_lock(3673,1);
 select * into r from public.platform_social_posts where id=p_id for update;
 if not found or r.version is distinct from p_version or r.status not in ('draft','planned') then raise exception 'social version conflict'; end if;
 if (select count(*) from public.platform_social_generations where created_at>=date_trunc('day',now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')>=20
 or (select count(*) from public.platform_social_generations where created_at>=date_trunc('month',now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')>=300
 or exists(select 1 from public.platform_social_generations where post_id=p_id and status='reserved' and created_at>now()-interval '5 minutes') then raise exception 'social generation limit'; end if;
 insert into public.platform_social_generations(post_id,actor_id,expected_version) values(p_id,auth.uid(),p_version) returning id into g; return g;
end; $$;
create function public.social_begin_generation(p_id uuid,p_version integer) returns uuid language sql security invoker set search_path='' as $$select private.social_begin_generation(p_id,p_version)$$;
create function private.social_finish_generation(p_generation uuid,p_caption text) returns text language plpgsql security definer set search_path='' as $$
declare g public.platform_social_generations; r public.platform_social_posts; result text;
begin
 if not coalesce(private.is_admin(),false) then raise exception 'social admin required'; end if;
 select * into g from public.platform_social_generations where id=p_generation and actor_id=auth.uid() for update;
 if not found or g.status<>'reserved' then raise exception 'social generation unavailable'; end if;
 select * into r from public.platform_social_posts where id=g.post_id for update;
 result:=case when p_caption is null then 'failed' when r.version<>g.expected_version or r.status not in ('draft','planned') or g.created_at<now()-interval '5 minutes' then 'stale' else 'succeeded' end;
 if result='succeeded' then
  if length(trim(p_caption)) not between 15 and 2200 then raise exception 'social invalid caption'; end if;
  update public.platform_social_posts set caption=trim(p_caption),status='draft',version=version+1,updated_at=now() where id=r.id;
  insert into public.platform_social_events(post_id,kind,actor_id) values(r.id,'ai_caption',auth.uid());
 end if;
 update public.platform_social_generations set status=result where id=g.id; return result;
end; $$;
create function public.social_finish_generation(p_generation uuid,p_caption text) returns text language sql security invoker set search_path='' as $$select private.social_finish_generation(p_generation,p_caption)$$;

create function private.social_worker_allowed(p_secret text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.is_admin(),false) or (length(p_secret)>=32 and exists(select 1 from private.social_worker_configuration where secret_hash=encode(sha256(convert_to(p_secret,'UTF8')),'hex')))
$$;
create function private.social_claim(p_secret text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.platform_social_posts; a public.platform_social_accounts; token text;
begin
 if not coalesce(private.social_worker_allowed(p_secret),false) then raise exception 'social worker denied'; end if;
 -- Never retry a publication whose external outcome was not acknowledged.
 update public.platform_social_posts set status='unknown',error_code='interrupted',version=version+1 where status='publishing' and started_at<now()-interval '10 minutes';
 update public.platform_social_posts set status='failed',error_code='missed_schedule',version=version+1 where status='scheduled' and scheduled_at<now()-interval '15 minutes';
 select * into r from public.platform_social_posts where status='scheduled' and scheduled_at<=now() order by scheduled_at,id limit 1 for update skip locked;
 if not found then return null; end if;
 select * into a from public.platform_social_accounts where id=r.account_id and company_id=r.company_id and active for update;
 select encrypted_token into token from private.social_credentials where account_id=a.id;
 if a.id is null or token is null or not exists(select 1 from private.platform_admins where user_id=r.approved_by) then
  update public.platform_social_posts set status='failed',error_code='authorization_revoked',version=version+1 where id=r.id; return null;
 end if;
 update public.platform_social_posts set status='publishing',attempt_id=gen_random_uuid(),started_at=now(),version=version+1 where id=r.id returning * into r;
 insert into public.platform_social_events(post_id,kind) values(r.id,'publishing');
 return to_jsonb(r)||jsonb_build_object('network',a.network,'external_id',a.external_id,'encrypted_token',token);
end; $$;
create function public.social_claim(p_secret text) returns jsonb language sql security invoker set search_path='' as $$select private.social_claim(p_secret)$$;
create function private.social_finish(p_secret text,p_id uuid,p_attempt uuid,p_status text,p_provider_id text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(private.social_worker_allowed(p_secret),false) then raise exception 'social worker denied'; end if;
 if p_status is null or p_status not in ('published','failed','unknown') or (p_status='published' and coalesce(p_provider_id,'') !~ '^[0-9_]{5,80}$') then raise exception 'social invalid outcome'; end if;
 update public.platform_social_posts set status=p_status,provider_id=case when p_status='published' then p_provider_id end,error_code=case when p_status<>'published' then 'provider_unconfirmed' end,version=version+1,updated_at=now()
 where id=p_id and attempt_id=p_attempt and status='publishing';
 if not found then raise exception 'social attempt conflict'; end if;
 insert into public.platform_social_events(post_id,kind) values(p_id,p_status);
end; $$;
create function public.social_finish(p_secret text,p_id uuid,p_attempt uuid,p_status text,p_provider_id text) returns void language sql security invoker set search_path='' as $$select private.social_finish(p_secret,p_id,p_attempt,p_status,p_provider_id)$$;

create function private.social_save_ad(p_id uuid,p_company uuid,p_version integer,p_payload jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r public.platform_ad_plans;
begin
 if not coalesce(private.is_admin(),false) then raise exception 'social admin required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,3674));
 select * into r from public.platform_ad_plans where id=p_id for update;
 if found then
  if r.company_id<>p_company or r.version is distinct from p_version then raise exception 'social version conflict'; end if;
  update public.platform_ad_plans set name=trim(p_payload->>'name'),objective=p_payload->>'objective',ad_account_id=p_payload->>'ad_account_id',media_budget_cents=(p_payload->>'media_budget_cents')::integer,management_fee_cents=(p_payload->>'management_fee_cents')::integer,start_date=(p_payload->>'start_date')::date,end_date=(p_payload->>'end_date')::date,notes=p_payload->>'notes',status='draft',version=version+1,updated_at=now() where id=p_id;
 else
  if p_version is not null then raise exception 'social version conflict'; end if;
  insert into public.platform_ad_plans(id,company_id,name,objective,ad_account_id,media_budget_cents,management_fee_cents,start_date,end_date,notes,created_by)
   values(p_id,p_company,trim(p_payload->>'name'),p_payload->>'objective',p_payload->>'ad_account_id',(p_payload->>'media_budget_cents')::integer,(p_payload->>'management_fee_cents')::integer,(p_payload->>'start_date')::date,(p_payload->>'end_date')::date,p_payload->>'notes',auth.uid());
 end if;
end; $$;
create function public.social_save_ad(p_id uuid,p_company uuid,p_version integer,p_payload jsonb) returns void language sql security invoker set search_path='' as $$select private.social_save_ad(p_id,p_company,p_version,p_payload)$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('social-assets','social-assets',false,1500000,array['image/jpeg']);
create policy social_assets_insert on storage.objects for insert to authenticated with check(bucket_id='social-assets' and (select private.is_admin()) and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$' and exists(select 1 from public.companies c where c.id::text=split_part(storage.objects.name,'/',1)));
create policy social_assets_read on storage.objects for select to authenticated using(bucket_id='social-assets' and (select private.is_admin()));

-- Every definer is private; exposed wrappers are invokers with explicit grants.
revoke all on function private.social_connect(uuid,text,text,text,text),private.social_save_post(uuid,uuid,integer,jsonb),private.social_transition(uuid,integer,text),private.social_revoke(uuid),private.social_begin_generation(uuid,integer),private.social_finish_generation(uuid,text),private.social_worker_allowed(text),private.social_claim(text),private.social_finish(text,uuid,uuid,text,text),private.social_save_ad(uuid,uuid,integer,jsonb) from public,anon,authenticated;
revoke all on function public.social_connect(uuid,text,text,text,text),public.social_save_post(uuid,uuid,integer,jsonb),public.social_transition(uuid,integer,text),public.social_revoke(uuid),public.social_begin_generation(uuid,integer),public.social_finish_generation(uuid,text),public.social_claim(text),public.social_finish(text,uuid,uuid,text,text),public.social_save_ad(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function private.social_connect(uuid,text,text,text,text),private.social_save_post(uuid,uuid,integer,jsonb),private.social_transition(uuid,integer,text),private.social_revoke(uuid),private.social_begin_generation(uuid,integer),private.social_finish_generation(uuid,text),private.social_save_ad(uuid,uuid,integer,jsonb),public.social_connect(uuid,text,text,text,text),public.social_save_post(uuid,uuid,integer,jsonb),public.social_transition(uuid,integer,text),public.social_revoke(uuid),public.social_begin_generation(uuid,integer),public.social_finish_generation(uuid,text),public.social_save_ad(uuid,uuid,integer,jsonb) to authenticated;
grant execute on function private.social_claim(text),private.social_finish(text,uuid,uuid,text,text),public.social_claim(text),public.social_finish(text,uuid,uuid,text,text) to anon,authenticated;
