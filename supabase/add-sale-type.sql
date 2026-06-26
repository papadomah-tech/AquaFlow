-- Run in Supabase SQL Editor
-- Adds sale_type to distinguish factory→rider (bulk) vs rider→customer (retail)

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS sale_type text
    DEFAULT 'retail'
    CHECK (sale_type IN ('bulk', 'retail'));

-- bulk  = Factory Manager sells to a Rider/Sales Rep
-- retail = Rider/Sales Rep sells to a Customer

-- Mark existing sales as retail (they were customer sales)
UPDATE public.sales SET sale_type = 'retail' WHERE sale_type IS NULL;

-- Add buyer_employee_id for bulk sales (who is the rider buying)
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS buyer_employee_id int
    REFERENCES public.employees(id) ON DELETE SET NULL;

-- Add employee role type to distinguish rider vs factory
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS employee_type text
    DEFAULT 'staff'
    CHECK (employee_type IN ('rider', 'staff', 'factory_manager'));

-- Verify
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'sales' AND table_schema = 'public'
ORDER BY ordinal_position;
