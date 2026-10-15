-- Gym shop: drinks, snacks and gear sold at the gym.
-- Owners stock items. Members buy from their phone (on their tab or by card) and staff ring people up
-- at the counter (tab, cash, or a walk in paying cash). Every member sale is an invoice, so it shows in
-- Billing and on the member's page and card payments go through the gym's own Stripe like everything else.

create table if not exists public.shop_items (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  price_cents int not null check (price_cents between 0 and 100000),
  emoji text not null default '🥤',
  category text not null default 'Drinks',
  stock int check (stock is null or stock >= 0),
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists shop_items_gym on public.shop_items (gym_id, active, sort);

create table if not exists public.shop_sales (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  item_id uuid references public.shop_items(id) on delete set null,
  item_name text not null,
  qty int not null check (qty > 0),
  price_cents int not null,
  total_cents int not null,
  invoice_id uuid references public.invoices(id) on delete set null,
  paid_with text not null check (paid_with in ('tab', 'card', 'cash')),
  sold_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists shop_sales_gym on public.shop_sales (gym_id, created_at desc);

alter table public.shop_items enable row level security;
alter table public.shop_sales enable row level security;
drop policy if exists shop_items_read on public.shop_items;
create policy shop_items_read on public.shop_items for select to authenticated using (true);
drop policy if exists shop_items_owner on public.shop_items;
create policy shop_items_owner on public.shop_items for all to authenticated using (public.is_gym_owner(gym_id)) with check (public.is_gym_owner(gym_id));
drop policy if exists shop_sales_read on public.shop_sales;
create policy shop_sales_read on public.shop_sales for select to authenticated
  using (public.is_gym_staff(gym_id) or profile_id in (select id from public.profiles where user_id = auth.uid()));
revoke all on public.shop_items, public.shop_sales from anon;
grant select on public.shop_items, public.shop_sales to authenticated;
grant insert, update, delete on public.shop_items to authenticated;

-- One checkout. p_items is [{"id": item, "qty": n}]. p_method: tab, card (an open invoice the buyer then
-- pays with Stripe) or cash (staff only, paid now). p_profile null means a walk in paying cash (staff only).
create or replace function public.shop_buy(p_gym uuid, p_items jsonb, p_profile uuid, p_method text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  me uuid := (select id from public.profiles where user_id = auth.uid());
  staff boolean := public.is_gym_staff(p_gym);
  buyer uuid := p_profile;
  line jsonb; it public.shop_items; q int;
  total int := 0; words text[] := '{}'; inv uuid; n int := 0;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if p_method not in ('tab', 'card', 'cash') then raise exception 'Pick how to pay'; end if;
  if not staff then
    if buyer is not null and buyer <> me then raise exception 'You can only buy for yourself'; end if;
    buyer := me;
    if p_method = 'cash' then raise exception 'Pay cash at the desk'; end if;
    if not exists (select 1 from public.profiles where id = me and gym_id = p_gym) then raise exception 'Join this gym to use its shop'; end if;
  end if;
  if buyer is null and p_method <> 'cash' then raise exception 'A walk in pays cash'; end if;
  if buyer is not null and not exists (select 1 from public.profiles where id = buyer and gym_id = p_gym) then raise exception 'They are not a member of this gym'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'The cart is empty'; end if;

  -- Price and stock check first, from the shop's own prices.
  for line in select * from jsonb_array_elements(p_items) loop
    q := greatest(1, least(50, coalesce((line->>'qty')::int, 1)));
    select * into it from public.shop_items where id = (line->>'id')::uuid and gym_id = p_gym and active for update;
    if it.id is null then raise exception 'Something in the cart is no longer sold'; end if;
    if it.stock is not null and it.stock < q then raise exception '% has only % left', it.name, it.stock; end if;
    total := total + it.price_cents * q;
    words := words || (case when q > 1 then q || ' ' else '' end || it.name);
  end loop;

  if buyer is not null then
    insert into public.invoices (gym_id, profile_id, description, amount_cents, status, paid_at, method, created_by)
    values (p_gym, buyer, left('Shop: ' || array_to_string(words, ', '), 200), total,
            case when p_method = 'cash' then 'paid' else 'open' end,
            case when p_method = 'cash' then now() end,
            case when p_method = 'cash' then 'cash' end, me)
    returning id into inv;
  end if;

  for line in select * from jsonb_array_elements(p_items) loop
    q := greatest(1, least(50, coalesce((line->>'qty')::int, 1)));
    select * into it from public.shop_items where id = (line->>'id')::uuid;
    update public.shop_items set stock = stock - q where id = it.id and stock is not null;
    insert into public.shop_sales (gym_id, profile_id, item_id, item_name, qty, price_cents, total_cents, invoice_id, paid_with, sold_by)
    values (p_gym, buyer, it.id, it.name, q, it.price_cents, it.price_cents * q, inv, p_method, me);
    n := n + q;
  end loop;
  return jsonb_build_object('invoice', inv, 'total', total, 'items', n);
end $$;
revoke all on function public.shop_buy(uuid, jsonb, uuid, text) from public, anon;
grant execute on function public.shop_buy(uuid, jsonb, uuid, text) to authenticated;
