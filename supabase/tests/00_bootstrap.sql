-- ===========================================================================
-- Local bootstrap: emulates the objects that Supabase manages for us
-- (roles, the `auth` schema, `auth.uid()`). Run BEFORE the migrations.
-- This file is test scaffolding only; it is never applied to a real project.
-- ===========================================================================
create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now()
);

-- Supabase resolves the caller from the request JWT. In tests we set the GUC directly.
create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
