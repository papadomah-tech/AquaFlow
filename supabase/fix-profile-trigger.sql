-- Run this in Supabase SQL Editor to fix the profile auto-creation trigger

-- Drop and recreate the trigger to ensure it works correctly
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, is_active)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      split_part(new.email, '@', 1),
      'User'
    ),
    'operator',
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Also manually create profile for any existing users missing one
insert into public.profiles (id, full_name, role, is_active)
select
  id,
  coalesce(split_part(email, '@', 1), 'User'),
  'operator',
  true
from auth.users
where id not in (select id from public.profiles)
on conflict (id) do nothing;

-- Confirm profiles exist
select * from public.profiles;
