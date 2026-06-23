-- ============================================================
-- AquaFlow Manager — Supabase PostgreSQL Schema
-- Run this entire file in: Supabase Dashboard → SQL Editor
-- ============================================================

create extension if not exists "uuid-ossp";

-- ── PROFILES (extends Supabase auth.users) ────────────────────
create table if not exists public.profiles (
  id         uuid references auth.users(id) on delete cascade primary key,
  full_name  text not null,
  role       text not null default 'operator'
               check (role in ('admin','manager','operator','viewer')),
  is_active  boolean default true,
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;
create policy "profiles_select" on public.profiles for select using (auth.uid() is not null);
create policy "profiles_insert" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update" on public.profiles for update using (
  auth.uid() = id or
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), 'operator');
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── RAW MATERIALS ──────────────────────────────────────────────
create table if not exists public.raw_materials (
  id                  serial primary key,
  name                text not null,
  unit                text not null,
  current_stock       numeric default 0,
  low_stock_threshold numeric default 0,
  created_at          timestamptz default now()
);
alter table public.raw_materials enable row level security;
create policy "rm_all" on public.raw_materials for all using (auth.uid() is not null);

create table if not exists public.raw_material_purchases (
  id             serial primary key,
  material_id    int references public.raw_materials(id),
  purchase_date  date not null,
  supplier_name  text not null,
  quantity       numeric not null,
  unit_price     numeric not null,
  total_cost     numeric not null,
  notes          text,
  created_at     timestamptz default now()
);
alter table public.raw_material_purchases enable row level security;
create policy "rmp_all" on public.raw_material_purchases for all using (auth.uid() is not null);

create table if not exists public.raw_material_usage (
  id            serial primary key,
  batch_id      int,
  material_id   int references public.raw_materials(id),
  quantity_used numeric not null,
  usage_date    date not null,
  notes         text,
  created_at    timestamptz default now()
);
alter table public.raw_material_usage enable row level security;
create policy "rmu_all" on public.raw_material_usage for all using (auth.uid() is not null);

-- ── ROLL FILMS ─────────────────────────────────────────────────
create table if not exists public.roll_films (
  id             serial primary key,
  label          text not null,
  weight_kg      numeric not null,
  purchase_date  date,
  supplier       text,
  cost           numeric default 0,
  bags_expected  int default 0,
  bags_produced  int default 0,
  status         text default 'available'
                   check (status in ('available','in_use','finished')),
  notes          text,
  created_at     timestamptz default now()
);
alter table public.roll_films enable row level security;
create policy "rf_all" on public.roll_films for all using (auth.uid() is not null);

-- ── PRODUCTION BATCHES ─────────────────────────────────────────
create table if not exists public.production_batches (
  id            serial primary key,
  batch_date    date not null,
  batch_number  text unique not null,
  roll_film_id  int references public.roll_films(id),
  roll_ref      text,
  roll_kg_used  numeric default 0,
  bags_consumed int default 0,
  water_used    numeric default 0,
  bags_produced int default 0,
  yield_ratio   numeric default 0,
  notes         text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz default now()
);
alter table public.production_batches enable row level security;
create policy "pb_all" on public.production_batches for all using (auth.uid() is not null);

-- ── EMPLOYEES ──────────────────────────────────────────────────
create table if not exists public.employees (
  id                 serial primary key,
  full_name          text not null,
  role               text not null,
  phone              text,
  email              text,
  address            text,
  salary             numeric default 0,
  sales_target_daily int default 250,
  working_days       int default 6,
  hire_date          date not null,
  status             text default 'active' check (status in ('active','inactive')),
  perf_group_id      int,
  is_bag_source      boolean default true,
  rider_topup        boolean default false,
  team_role          text,
  accrued_perf_pay   numeric default 0,
  created_at         timestamptz default now()
);
alter table public.employees enable row level security;
create policy "emp_all" on public.employees for all using (auth.uid() is not null);

-- ── CUSTOMERS ──────────────────────────────────────────────────
create table if not exists public.customers (
  id             serial primary key,
  name           text not null,
  phone          text,
  email          text,
  address        text,
  default_rep_id int references public.employees(id) on delete set null,
  created_at     timestamptz default now()
);
alter table public.customers enable row level security;
create policy "cust_all" on public.customers for all using (auth.uid() is not null);

-- ── SALES ──────────────────────────────────────────────────────
create table if not exists public.sales (
  id                  serial primary key,
  sale_date           date not null,
  customer_id         int not null references public.customers(id),
  salesperson_id      int references public.employees(id),
  bags_sold           int not null,
  protocol_bags       int default 0,
  unit_price          numeric not null,
  total_amount        numeric not null,
  amount_paid         numeric default 0,
  outstanding_balance numeric default 0,
  payment_status      text default 'unpaid'
                        check (payment_status in ('paid','partial','unpaid')),
  notes               text,
  created_by          uuid references auth.users(id),
  created_at          timestamptz default now()
);
alter table public.sales enable row level security;
create policy "sales_all" on public.sales for all using (auth.uid() is not null);

-- ── PAYMENTS ───────────────────────────────────────────────────
create table if not exists public.payments (
  id             serial primary key,
  sale_id        int not null references public.sales(id) on delete cascade,
  payment_date   date not null,
  amount         numeric not null,
  payment_method text default 'cash',
  reference      text,
  notes          text,
  created_at     timestamptz default now()
);
alter table public.payments enable row level security;
create policy "pay_all" on public.payments for all using (auth.uid() is not null);

-- ── ATTENDANCE ─────────────────────────────────────────────────
create table if not exists public.attendance (
  id              serial primary key,
  employee_id     int not null references public.employees(id),
  attendance_date date not null,
  status          text not null check (status in ('present','absent','half_day','leave')),
  notes           text,
  created_at      timestamptz default now(),
  unique (employee_id, attendance_date)
);
alter table public.attendance enable row level security;
create policy "att_all" on public.attendance for all using (auth.uid() is not null);

-- ── SALARY PAYMENTS ────────────────────────────────────────────
create table if not exists public.salary_payments (
  id           serial primary key,
  employee_id  int not null references public.employees(id),
  payment_date date not null,
  amount       numeric not null,
  payment_type text default 'performance',
  period_start date,
  period_end   date,
  notes        text,
  created_at   timestamptz default now()
);
alter table public.salary_payments enable row level security;
create policy "sp_all" on public.salary_payments for all using (auth.uid() is not null);

-- ── EMPLOYEE LOSSES ────────────────────────────────────────────
create table if not exists public.employee_losses (
  id          serial primary key,
  employee_id int not null references public.employees(id),
  loss_date   date not null,
  loss_type   text not null,
  description text not null,
  quantity    numeric default 0,
  unit        text default '',
  unit_cost   numeric default 0,
  loss_amount numeric not null,
  source_ref  text default '',
  posted      boolean default false,
  posted_date date,
  notes       text,
  created_at  timestamptz default now()
);
alter table public.employee_losses enable row level security;
create policy "el_all" on public.employee_losses for all using (auth.uid() is not null);

-- ── EXPENSES ───────────────────────────────────────────────────
create table if not exists public.expenses (
  id           serial primary key,
  expense_date date not null,
  category     text not null,
  description  text not null,
  amount       numeric not null,
  paid_to      text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz default now()
);
alter table public.expenses enable row level security;
create policy "exp_all" on public.expenses for all using (auth.uid() is not null);

-- ── BANK DEPOSITS ──────────────────────────────────────────────
create table if not exists public.bank_deposits (
  id             serial primary key,
  deposit_date   date not null,
  bank_name      text not null,
  account_number text,
  amount         numeric not null,
  reference      text,
  deposited_by   text,
  notes          text,
  created_by     uuid references auth.users(id),
  created_at     timestamptz default now()
);
alter table public.bank_deposits enable row level security;
create policy "bd_all" on public.bank_deposits for all using (auth.uid() is not null);

-- ── FINISHED INVENTORY ─────────────────────────────────────────
create table if not exists public.finished_inventory (
  id               serial primary key,
  bags_in          int default 0,
  bags_out         int default 0,
  transaction_date date not null,
  reference_type   text,
  sale_id          int references public.sales(id) on delete set null,
  notes            text,
  created_at       timestamptz default now()
);
alter table public.finished_inventory enable row level security;
create policy "fi_all" on public.finished_inventory for all using (auth.uid() is not null);

-- ── STOCK TAKES ────────────────────────────────────────────────
create table if not exists public.stock_takes (
  id         serial primary key,
  take_date  date not null,
  taken_by   int references public.employees(id),
  notes      text,
  status     text default 'draft' check (status in ('draft','finalised')),
  created_at timestamptz default now()
);
alter table public.stock_takes enable row level security;
create policy "st_all" on public.stock_takes for all using (auth.uid() is not null);

create table if not exists public.stock_take_items (
  id                 serial primary key,
  stock_take_id      int not null references public.stock_takes(id) on delete cascade,
  item_type          text not null,
  item_id            int,
  item_name          text not null,
  unit               text,
  system_qty         numeric default 0,
  counted_qty        numeric default 0,
  variance           numeric default 0,
  responsible_emp_id int references public.employees(id),
  deduction_amount   numeric default 0,
  deduction_posted   boolean default false,
  notes              text
);
alter table public.stock_take_items enable row level security;
create policy "sti_all" on public.stock_take_items for all using (auth.uid() is not null);

create table if not exists public.stock_adjustments (
  id                serial primary key,
  adjustment_date   date not null,
  stock_take_id     int references public.stock_takes(id),
  item_type         text,
  item_id           int,
  item_name         text,
  quantity_adjusted numeric,
  reason            text,
  created_at        timestamptz default now()
);
alter table public.stock_adjustments enable row level security;
create policy "sa_all" on public.stock_adjustments for all using (auth.uid() is not null);

-- ── REALTIME: enable for live mobile sync ─────────────────────
-- In Supabase Dashboard: Database → Replication → enable for:
-- sales, payments, production_batches, finished_inventory,
-- expenses, bank_deposits, stock_takes, employee_losses
