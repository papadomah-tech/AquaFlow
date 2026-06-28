-- Add teammate support to bulk dispatch sales
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS teammate_employee_id int
    REFERENCES public.employees(id) ON DELETE SET NULL;

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_sales_teammate
  ON public.sales(teammate_employee_id);

SELECT 'teammate column added' as status;
