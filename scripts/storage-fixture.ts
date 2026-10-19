// Minimal disposable Storage schema for RLS integration tests. The real Storage
// HTTP service is verified separately by test-personalization-live.ts.
export const storageFixture = `
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,created_at timestamptz default now(),unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated;
grant select on storage.objects to anon;
grant select,insert,update,delete on storage.objects to authenticated;
create function storage.allow_only_operation(operation text) returns boolean language sql stable as $$
 select coalesce(replace(current_setting('storage.operation',true),'storage.','') = replace(operation,'storage.',''),false)
$$;
grant execute on function storage.allow_only_operation(text) to anon,authenticated;
`;
