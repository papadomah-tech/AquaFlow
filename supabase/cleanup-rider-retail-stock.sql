
-- ═══════════════════════════════════════════════════════════════════════════
-- DATA CLEANUP: Remove all rider retail entries from finished_inventory
-- Run each step and check the output before proceeding to the next.
-- ═══════════════════════════════════════════════════════════════════════════

-- STEP 1: Preview what will be deleted (run this first to verify)
SELECT
  fi.id,
  fi.transaction_date,
  fi.reference_type,
  fi.bags_in,
  fi.bags_out,
  fi.notes,
  s.sale_type,
  e.full_name AS rider_name,
  e.employee_type
FROM public.finished_inventory fi
LEFT JOIN public.sales s ON s.id = fi.sale_id
LEFT JOIN public.employees e ON e.id = s.salesperson_id
WHERE
  (
    -- Match by sale_id FK if it exists
    (fi.sale_id IS NOT NULL
      AND s.sale_type = 'retail'
      AND e.employee_type = 'rider')
    OR
    -- Match by notes text (fallback for entries without sale_id)
    (fi.reference_type = 'sale'
      AND (
        fi.notes ILIKE '%retail sale%'
        OR fi.notes ILIKE '%rider%'
      ))
  )
ORDER BY fi.transaction_date;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 2: After verifying the preview above, run this to delete them
-- ═══════════════════════════════════════════════════════════════════════════

DELETE FROM public.finished_inventory
WHERE id IN (
  SELECT fi.id
  FROM public.finished_inventory fi
  LEFT JOIN public.sales s ON s.id = fi.sale_id
  LEFT JOIN public.employees e ON e.id = s.salesperson_id
  WHERE
    (fi.sale_id IS NOT NULL
      AND s.sale_type = 'retail'
      AND e.employee_type = 'rider')
    OR
    (fi.reference_type = 'sale'
      AND (
        fi.notes ILIKE '%retail sale%'
        OR fi.notes ILIKE '%rider%'
      ))
);

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 3: Verify stock after cleanup
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  reference_type,
  COUNT(*) AS entries,
  SUM(bags_in)  AS total_bags_in,
  SUM(bags_out) AS total_bags_out,
  SUM(bags_in) - SUM(bags_out) AS net_stock
FROM public.finished_inventory
GROUP BY reference_type
ORDER BY reference_type;

-- Final stock on hand
SELECT
  SUM(bags_in) - SUM(bags_out) AS current_stock_on_hand
FROM public.finished_inventory;
