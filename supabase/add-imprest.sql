-- Imprest float tracking
CREATE TABLE IF NOT EXISTS public.imprest_floats (
  id              serial primary key,
  employee_id     int not null references public.employees(id),
  advance_date    date not null,
  advance_amount  numeric not null,         -- the original cash advanced
  expense_id      int references public.expenses(id) on delete set null,  -- linked expense record for the advance
  status          text not null default 'active'
                    check (status in ('active','reconciled','topped_up')),
  reconciled_date date,
  unspent_action  text,                     -- 'refunded' | 'rolled_over' | 'written_off' | null
  unspent_amount  numeric default 0,
  notes           text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz default now()
);

-- Individual petty cash entries spent against a float
CREATE TABLE IF NOT EXISTS public.imprest_entries (
  id            serial primary key,
  float_id      int not null references public.imprest_floats(id) on delete cascade,
  entry_date    date not null,
  category      text not null,
  description   text not null,
  amount        numeric not null,
  receipt_ref   text,
  recorded_by   uuid references auth.users(id),
  created_at    timestamptz default now()
);

ALTER TABLE public.imprest_floats  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imprest_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "if_all" ON public.imprest_floats  FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "ie_all" ON public.imprest_entries FOR ALL USING (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_imprest_floats_emp ON public.imprest_floats(employee_id);
CREATE INDEX IF NOT EXISTS idx_imprest_entries_float ON public.imprest_entries(float_id);

SELECT 'imprest tables created' as status;
