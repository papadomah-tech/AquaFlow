-- Opening balances table — stores one row per key
CREATE TABLE IF NOT EXISTS public.opening_balances (
  key         text primary key,
  value       numeric not null default 0,
  notes       text,
  updated_at  timestamptz default now()
);
ALTER TABLE public.opening_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ob_all" ON public.opening_balances
  FOR ALL USING (auth.uid() IS NOT NULL);

-- Seed the keys
INSERT INTO public.opening_balances (key, value, notes) VALUES
  ('stock_bags',         0, 'Bags on hand before going live'),
  ('cash_balance',       0, 'Cash/bank balance before going live'),
  ('total_receivables',  0, 'Total amount customers already owe'),
  ('total_payables',     0, 'Total expenses already incurred')
ON CONFLICT (key) DO NOTHING;


-- Add created_by to customers so riders only see their own customers
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;


-- ── Fix historical double-entries in finished_inventory ───────────────────────
-- Rider retail sales created a finished_inventory bags_out entry, but rider
-- bags were ALREADY deducted when the bulk dispatch went out.
-- Remove the duplicate finished_inventory entries from rider retail sales.

-- Step 1: identify rider employee IDs
-- Step 2: delete finished_inventory rows for sales (reference_type='sale')
--         where the linked sale was a rider retail sale

DELETE FROM public.finished_inventory fi
WHERE fi.reference_type = 'sale'
  AND fi.sale_id IN (
    SELECT s.id FROM public.sales s
    JOIN public.employees e ON e.id = s.salesperson_id
    WHERE s.sale_type = 'retail'
      AND e.employee_type = 'rider'
  );

-- Step 3: Fix protocol bag entries — change reference_type from 'sale' to 'write-off'
-- and remove them from any sale-linked entries (they should be standalone write-offs)
-- This is informational only — existing entries are left in place to avoid
-- disrupting historical stock figures. New protocol bag entries going forward
-- will use reference_type = 'write-off'.

SELECT 'Historical rider retail inventory entries removed' as status,
       COUNT(*) as removed_count
FROM public.finished_inventory
WHERE reference_type = 'sale'
  AND sale_id IN (
    SELECT s.id FROM public.sales s
    JOIN public.employees e ON e.id = s.salesperson_id
    WHERE s.sale_type = 'retail'
      AND e.employee_type = 'rider'
  );


-- ── Remove rider retail entries from finished_inventory ────────────────────────
-- Rider retail sales created bags_out entries in finished_inventory, but
-- bags already left the factory at bulk dispatch. These are double-deductions.

-- Step 1: Find and delete finished_inventory rows tied to rider retail sales
-- (reference_type='sale' AND the linked sale was retail by a rider)
DELETE FROM public.finished_inventory
WHERE reference_type = 'sale'
  AND notes ILIKE '%retail sale%'
  AND notes ILIKE '%rider%';

-- Step 2: Also delete by matching sale_id if the column exists
-- (some entries may have a sale_id foreign key)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='finished_inventory' AND column_name='sale_id'
  ) THEN
    DELETE FROM public.finished_inventory fi
    WHERE fi.reference_type = 'sale'
      AND fi.sale_id IN (
        SELECT s.id FROM public.sales s
        JOIN public.employees e ON e.id = s.salesperson_id
        WHERE s.sale_type = 'retail'
          AND e.employee_type = 'rider'
      );
  END IF;
END $$;

-- Step 3: Mark remaining 'sale' reference_type entries from factory direct retail
-- as 'factory_retail' to distinguish them going forward
UPDATE public.finished_inventory
SET reference_type = 'factory_retail'
WHERE reference_type = 'sale'
  AND notes ILIKE '%factory retail%';

-- Verify remaining stock
SELECT reference_type, COUNT(*), SUM(bags_in) as total_in, SUM(bags_out) as total_out
FROM public.finished_inventory
GROUP BY reference_type
ORDER BY reference_type;
