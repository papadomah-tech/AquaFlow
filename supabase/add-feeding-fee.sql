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
