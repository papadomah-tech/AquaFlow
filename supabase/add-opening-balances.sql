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
