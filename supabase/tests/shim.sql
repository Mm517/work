-- Minimal emulation of the Supabase pieces our migrations touch.
-- ONLY for local RLS testing on plain Postgres (never run on a real Supabase project).
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'sub', '')::uuid
$$;

create schema if not exists realtime;
create table if not exists realtime.messages (
  id bigserial primary key,
  topic text not null,
  extension text not null default 'broadcast',
  payload jsonb
);
alter table realtime.messages enable row level security;
create or replace function realtime.topic() returns text language sql stable as $$
  select nullif(current_setting('realtime.topic', true), '')
$$;

do $$ begin
  if not exists (select from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

grant usage on schema public, auth, realtime to anon, authenticated, service_role;
grant select on auth.users to authenticated;
grant select, insert on realtime.messages to authenticated;
grant usage, select on all sequences in schema realtime to authenticated;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
