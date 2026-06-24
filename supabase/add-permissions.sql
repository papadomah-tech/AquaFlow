-- Run this in Supabase SQL Editor
-- Adds a permissions column to profiles for per-user module access control

alter table public.profiles
  add column if not exists permissions text[] default array['sales']::text[];

-- Give existing non-admin users basic default access
update public.profiles
set permissions = array['sales', 'production', 'stock', 'expenses']::text[]
where role != 'admin' and (permissions is null or array_length(permissions, 1) = 0);

-- Confirm
select id, full_name, role, permissions from public.profiles;
