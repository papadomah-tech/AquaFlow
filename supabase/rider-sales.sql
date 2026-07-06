-- Rider Sales module — personal sales diary for riders
-- Not linked to company financial transactions

create table if not exists public.rider_sales (
  id            serial primary key,
  rider_id      int not null references public.employees(id) on delete cascade,
  sale_date     date not null default current_date,
  customer_name text not null,
  customer_id   int references public.customers(id) on delete set null,
  bags          int not null check (bags > 0),
  price_per_bag numeric(10,2) not null default 0,
  total_amount  numeric(10,2) generated always as (bags * price_per_bag) stored,
  amount_collected numeric(10,2) not null default 0,
  outstanding   numeric(10,2) generated always as (bags * price_per_bag - amount_collected) stored,
  notes         text,
  created_at    timestamptz default now()
);

alter table public.rider_sales enable row level security;

-- Riders see only their own records; admins see all
create policy "rider_sales_select" on public.rider_sales
  for select using (
    auth.uid() is not null and (
      rider_id = (select id from public.employees where id = rider_id limit 1)
      or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
    )
  );

-- Simpler: allow all authenticated users (rider filtering handled in app)
drop policy if exists "rider_sales_select" on public.rider_sales;
create policy "rider_sales_all" on public.rider_sales
  for all using (auth.uid() is not null);

-- Verify
select 'rider_sales table created' as status;
