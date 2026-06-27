-- Bulk dispatch returns table
CREATE TABLE IF NOT EXISTS public.bulk_returns (
  id                serial primary key,
  return_date       date not null,
  original_sale_id  int references public.sales(id) on delete set null,
  employee_id       int not null references public.employees(id),
  bags_returned     int not null,
  unit_price        numeric not null,
  total_credit      numeric not null,   -- bags_returned × unit_price
  notes             text,
  recorded_by       uuid references auth.users(id),
  created_at        timestamptz default now()
);
ALTER TABLE public.bulk_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "br_all" ON public.bulk_returns
  FOR ALL USING (auth.uid() IS NOT NULL);

-- Verify
SELECT 'bulk_returns table created' as status;
