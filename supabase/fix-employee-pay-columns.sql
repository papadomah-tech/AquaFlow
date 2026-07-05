-- Fix: Edit Employee not saving base pay / feeding fee
-- Root cause: if any column in the update payload is missing from the live
-- employees table (or PostgREST's schema cache is stale), PostgREST rejects
-- the ENTIRE update and the app previously swallowed the error.
-- This script is idempotent. Safe to run multiple times.

-- 1. Ensure all pay-related columns exist
alter table public.employees
  add column if not exists base_pay        numeric default 0,
  add column if not exists feeding_fee     numeric default 300,
  add column if not exists monthly_target  int     default 6500;

-- 2. Ensure employee_type exists (from add-sale-type.sql)
alter table public.employees
  add column if not exists employee_type text
    default 'staff'
    check (employee_type in ('rider', 'staff', 'factory_manager'));

-- 3. Back-fill base_pay from salary where never set
update public.employees
  set base_pay = salary
  where (base_pay is null or base_pay = 0) and salary > 0;

update public.employees
  set feeding_fee = 300 where feeding_fee is null;

update public.employees
  set monthly_target = greatest(coalesce(sales_target_daily, 250), 1) * 26
  where monthly_target is null or monthly_target = 0;

-- 4. Force PostgREST to reload its schema cache immediately
--    (otherwise new columns can take a while to be recognized)
notify pgrst, 'reload schema';

-- 5. Verify
select id, full_name, salary, base_pay, feeding_fee, monthly_target, employee_type
from public.employees
order by full_name;
