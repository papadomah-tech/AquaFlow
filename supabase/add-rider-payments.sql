-- Rider payments back to factory
CREATE TABLE IF NOT EXISTS public.rider_payments (
  id            serial primary key,
  employee_id   int not null references public.employees(id),
  payment_date  date not null,
  amount        numeric not null,
  reference     text,
  notes         text,
  recorded_by   uuid references auth.users(id),
  created_at    timestamptz default now()
);
ALTER TABLE public.rider_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rp_all" ON public.rider_payments
  FOR ALL USING (auth.uid() IS NOT NULL);
