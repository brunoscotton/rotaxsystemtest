create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists cep text,
  add column if not exists complement text;

update public.profiles
set first_name = coalesce(first_name, name)
where first_name is null;

create table if not exists public.user_prefixes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('COM', 'PREFIXO')),
  value text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.user_prefixes enable row level security;

create unique index if not exists user_prefixes_one_default_per_user
on public.user_prefixes (user_id)
where is_default;

create table if not exists public.delivery_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  address text not null,
  city text not null,
  cep text not null,
  complement text,
  estado text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.delivery_addresses enable row level security;

create unique index if not exists delivery_addresses_one_default_per_user
on public.delivery_addresses (user_id)
where is_default;

create table if not exists public.quote_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  control_number text not null,
  customer jsonb not null,
  items jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.quote_history enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_prefixes' and policyname = 'User can read own prefixes'
  ) then
    create policy "User can read own prefixes"
    on public.user_prefixes for select
    using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_prefixes' and policyname = 'User can insert own prefixes'
  ) then
    create policy "User can insert own prefixes"
    on public.user_prefixes for insert
    with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_prefixes' and policyname = 'User can update own prefixes'
  ) then
    create policy "User can update own prefixes"
    on public.user_prefixes for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_prefixes' and policyname = 'User can delete own prefixes'
  ) then
    create policy "User can delete own prefixes"
    on public.user_prefixes for delete
    using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'delivery_addresses' and policyname = 'User can read own delivery addresses'
  ) then
    create policy "User can read own delivery addresses"
    on public.delivery_addresses for select
    using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'delivery_addresses' and policyname = 'User can insert own delivery addresses'
  ) then
    create policy "User can insert own delivery addresses"
    on public.delivery_addresses for insert
    with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'delivery_addresses' and policyname = 'User can update own delivery addresses'
  ) then
    create policy "User can update own delivery addresses"
    on public.delivery_addresses for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'delivery_addresses' and policyname = 'User can delete own delivery addresses'
  ) then
    create policy "User can delete own delivery addresses"
    on public.delivery_addresses for delete
    using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'quote_history' and policyname = 'User can read own quote history'
  ) then
    create policy "User can read own quote history"
    on public.quote_history for select
    using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'quote_history' and policyname = 'User can insert own quote history'
  ) then
    create policy "User can insert own quote history"
    on public.quote_history for insert
    with check (auth.uid() = user_id);
  end if;
end $$;
