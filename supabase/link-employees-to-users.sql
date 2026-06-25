-- Run in Supabase SQL Editor
-- Links employees to their auth user accounts so sales can be filtered by user

-- Step 1: Add auth_user_id column to employees
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Step 2: Add index for fast lookups
CREATE INDEX IF NOT EXISTS idx_employees_auth_user
  ON public.employees(auth_user_id);

-- Step 3: Verify
SELECT id, full_name, role, auth_user_id FROM public.employees;
