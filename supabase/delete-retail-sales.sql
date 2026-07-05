
-- ══════════════════════════════════════════════════════════════════
-- DELETE ALL RETAIL SALES — retail removed from app scope
-- Run in Supabase SQL editor
-- ══════════════════════════════════════════════════════════════════

-- Preview first
SELECT COUNT(*) AS retail_records_to_delete
FROM public.sales
WHERE sale_type = 'retail';

-- Delete retail sales
DELETE FROM public.sales WHERE sale_type = 'retail';

-- Also remove any finished_inventory entries linked to retail sales
DELETE FROM public.finished_inventory
WHERE reference_type = 'sale'
  AND sale_id IN (
    SELECT id FROM public.sales WHERE sale_type = 'retail'
  );

-- Verify
SELECT sale_type, COUNT(*) FROM public.sales GROUP BY sale_type;
