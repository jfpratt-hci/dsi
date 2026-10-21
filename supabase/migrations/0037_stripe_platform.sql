-- One payment platform for all of Dandy Strength (Stripe Connect, Express accounts, destination charges).
-- Every card payment runs through Dandy's Stripe platform account and is paid out to the gym's connected account.
-- Dandy takes no fee on gym payments for now (no application fee). Members keep one card across Dandy (stripe_customers).
-- Gyms pay Dandy for their plan (Run or Grow, founder prices and trials) on the platform account (gym_billing).

create table if not exists public.stripe_customers (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  customer_id text not null unique,
  created_at timestamptz not null default now()
);
alter table public.stripe_customers enable row level security; -- server only

alter table public.payments add column if not exists stripe_invoice text unique;
alter table public.payments add column if not exists description text check (char_length(description) <= 200);
alter table public.payments drop constraint if exists payments_kind_check;
alter table public.payments add constraint payments_kind_check check (kind in ('membership','invoice','event','order','appointment','drop_in','other'));

alter table public.gym_billing drop constraint if exists gym_billing_tier_check;
alter table public.gym_billing add constraint gym_billing_tier_check check (tier in ('run','grow','founder','base','build','peak','custom'));
alter table public.gym_billing add column if not exists note text check (char_length(note) <= 300);
alter table public.gym_billing enable row level security;
drop policy if exists gym_billing_read on public.gym_billing;
create policy gym_billing_read on public.gym_billing for select to authenticated using (public.is_gym_owner(gym_id) or public.is_platform_staff(gym_id));
drop policy if exists gym_billing_dsi on public.gym_billing;
create policy gym_billing_dsi on public.gym_billing for all to authenticated
  using (public.is_platform_staff(gym_id, array['admin','manager'])) with check (public.is_platform_staff(gym_id, array['admin','manager']));
