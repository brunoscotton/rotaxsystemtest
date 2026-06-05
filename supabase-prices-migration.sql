create table if not exists public.part_prices (
  part_number text primary key,
  price_usd numeric(14, 4) not null check (price_usd >= 0),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.part_prices enable row level security;

drop policy if exists "No direct client read for part prices" on public.part_prices;
create policy "No direct client read for part prices"
on public.part_prices
for select
using (false);

drop policy if exists "No direct client write for part prices" on public.part_prices;
create policy "No direct client write for part prices"
on public.part_prices
for all
using (false)
with check (false);

create index if not exists part_prices_updated_at_idx
on public.part_prices (updated_at desc);
