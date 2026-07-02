-- Add base_pay and feeding_fee to employees
-- base_pay  = the proportional component (GHc 1,500 for rider, GHc 1,000 for mate)
-- feeding_fee = fixed top-up always paid in full (GHc 300 for both)
-- monthly_target = total bags for the month (default 6,500)

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS base_pay        numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS feeding_fee     numeric DEFAULT 300,
  ADD COLUMN IF NOT EXISTS monthly_target  int    DEFAULT 6500;

-- Back-fill from existing salary column (treat existing salary as base_pay)
UPDATE public.employees
  SET base_pay = salary,
      feeding_fee = 300,
      monthly_target = sales_target_daily * 26
  WHERE base_pay = 0 AND salary > 0;

-- Allow 'feeding' as a payment_type in salary_payments
-- (was only 'performance' | 'advance' | 'salary' before)
ALTER TABLE public.salary_payments
  DROP CONSTRAINT IF EXISTS salary_payments_payment_type_check;

ALTER TABLE public.salary_payments
  ADD CONSTRAINT salary_payments_payment_type_check
  CHECK (payment_type IN ('performance','feeding','advance','salary','other'));

-- Link salary_payments to their auto-generated expense record
ALTER TABLE public.salary_payments
  ADD COLUMN IF NOT EXISTS expense_id int REFERENCES public.expenses(id) ON DELETE SET NULL;

-- ── Back-fill: create expense records for salary_payments with no expense_id ──
-- Step 1: Insert missing expenses for feeding fee payments
WITH inserted AS (
  INSERT INTO public.expenses (expense_date, category, description, amount, paid_to)
  SELECT
    sp.payment_date,
    'Feeding Fee',
    'Feeding fee — ' || e.full_name || ' (' || to_char(sp.payment_date, 'YYYY-MM') || ')',
    sp.amount,
    e.full_name
  FROM public.salary_payments sp
  JOIN public.employees e ON e.id = sp.employee_id
  WHERE sp.payment_type = 'feeding'
    AND sp.expense_id IS NULL
  RETURNING id, description, amount
)
-- Step 2: Link the new expense IDs back to the salary_payment rows
UPDATE public.salary_payments sp
SET expense_id = ins.id
FROM inserted ins
JOIN public.expenses exp ON exp.id = ins.id
JOIN public.employees e ON e.full_name = exp.paid_to
WHERE sp.payment_type = 'feeding'
  AND sp.expense_id IS NULL
  AND sp.employee_id = e.id
  AND sp.amount = ins.amount;

-- Step 3: Same for performance pay payments
WITH inserted2 AS (
  INSERT INTO public.expenses (expense_date, category, description, amount, paid_to)
  SELECT
    sp.payment_date,
    'Performance Pay',
    'Performance pay — ' || e.full_name || ' (' || to_char(sp.period_start, 'YYYY-MM-DD') || ' → ' || to_char(sp.period_end, 'YYYY-MM-DD') || ')',
    sp.amount,
    e.full_name
  FROM public.salary_payments sp
  JOIN public.employees e ON e.id = sp.employee_id
  WHERE sp.payment_type = 'performance'
    AND sp.expense_id IS NULL
  RETURNING id, description, amount
)
UPDATE public.salary_payments sp
SET expense_id = ins2.id
FROM inserted2 ins2
JOIN public.expenses exp ON exp.id = ins2.id
JOIN public.employees e ON e.full_name = exp.paid_to
WHERE sp.payment_type = 'performance'
  AND sp.expense_id IS NULL
  AND sp.employee_id = e.id
  AND sp.amount = ins2.amount;

-- Verify
SELECT sp.id, sp.payment_type, sp.amount, sp.payment_date,
       e.full_name, sp.expense_id
FROM public.salary_payments sp
JOIN public.employees e ON e.id = sp.employee_id
ORDER BY sp.payment_date DESC;
