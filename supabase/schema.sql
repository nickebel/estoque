-- Estoque da Padaria: schema inicial para Supabase
-- Execute no SQL Editor do projeto Supabase.
-- Acesso apenas para usuários autenticados que também estejam em public.team_members.

create extension if not exists pgcrypto;

create table if not exists public.team_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('admin', 'staff')),
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default '',
  unit text not null,
  quantity numeric(12,2) not null default 0 check (quantity >= 0),
  min_quantity numeric(12,2) not null default 0 check (min_quantity >= 0),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_name_not_blank check (length(trim(name)) > 0),
  constraint products_unit_not_blank check (length(trim(unit)) > 0)
);

create table if not exists public.movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  unit text not null,
  movement_type text not null check (movement_type in ('entrada', 'saida')),
  quantity numeric(12,2) not null check (quantity > 0),
  balance_after numeric(12,2) not null check (balance_after >= 0),
  note text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists products_name_idx on public.products (lower(name));
create index if not exists movements_created_at_idx on public.movements (created_at desc);
create index if not exists movements_product_id_idx on public.movements (product_id);

-- Helper functions run with the table owner's privileges to avoid RLS recursion.
create or replace function public.is_team_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.team_members
    where user_id = (select auth.uid())
  );
$$;

create or replace function public.is_team_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.team_members
    where user_id = (select auth.uid()) and role = 'admin'
  );
$$;

revoke all on function public.is_team_member() from public, anon;
revoke all on function public.is_team_admin() from public, anon;
grant execute on function public.is_team_member() to authenticated;
grant execute on function public.is_team_admin() to authenticated;

alter table public.team_members enable row level security;
alter table public.products enable row level security;
alter table public.movements enable row level security;

drop policy if exists "team members can see their own membership" on public.team_members;
create policy "team members can see their own membership"
on public.team_members for select to authenticated
using (user_id = (select auth.uid()) or (select public.is_team_admin()));

drop policy if exists "team can read products" on public.products;
create policy "team can read products"
on public.products for select to authenticated
using ((select public.is_team_member()));

drop policy if exists "team can create products" on public.products;
create policy "team can create products"
on public.products for insert to authenticated
with check ((select public.is_team_member()));

drop policy if exists "team can update product details" on public.products;
create policy "team can update product details"
on public.products for update to authenticated
using ((select public.is_team_member()))
with check ((select public.is_team_member()));

drop policy if exists "admins can delete products" on public.products;
create policy "admins can delete products"
on public.products for delete to authenticated
using ((select public.is_team_admin()));

drop policy if exists "team can read movements" on public.movements;
create policy "team can read movements"
on public.movements for select to authenticated
using ((select public.is_team_member()));

-- Clients cannot directly set stock quantity or write arbitrary movement records.
revoke all on public.team_members from anon, authenticated;
grant select on public.team_members to authenticated;
revoke all on public.products from anon, authenticated;
grant select, delete on public.products to authenticated;
grant insert (name, category, unit, min_quantity, notes) on public.products to authenticated;
grant update (name, category, unit, min_quantity, notes) on public.products to authenticated;
revoke all on public.movements from anon, authenticated;
grant select on public.movements to authenticated;

-- Stock adjustment and history are written in a single transaction.
create or replace function public.record_stock_movement(
  p_product_id uuid,
  p_type text,
  p_quantity numeric,
  p_note text default ''
)
returns public.movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_after numeric(12,2);
  v_movement public.movements%rowtype;
begin
  if not public.is_team_member() then
    raise exception 'Acesso não autorizado.';
  end if;

  if p_type not in ('entrada', 'saida') then
    raise exception 'Tipo de movimentação inválido.';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'A quantidade deve ser maior que zero.';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
  for update;

  if not found then
    raise exception 'Produto não encontrado.';
  end if;

  if p_type = 'entrada' then
    v_after := v_product.quantity + p_quantity;
  else
    v_after := v_product.quantity - p_quantity;
  end if;

  if v_after < 0 then
    raise exception 'A saída é maior que o saldo disponível.';
  end if;

  update public.products
  set quantity = v_after, updated_at = now()
  where id = p_product_id;

  insert into public.movements (
    product_id, product_name, unit, movement_type,
    quantity, balance_after, note, created_by
  ) values (
    v_product.id, v_product.name, v_product.unit, p_type,
    p_quantity, v_after, coalesce(p_note, ''), (select auth.uid())
  )
  returning * into v_movement;

  return v_movement;
end;
$$;

revoke all on function public.record_stock_movement(uuid, text, numeric, text) from public, anon;
grant execute on function public.record_stock_movement(uuid, text, numeric, text) to authenticated;
