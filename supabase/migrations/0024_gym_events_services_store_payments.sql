-- Applied to the Dandy Strength project on 2026-10-12 as migration 20261012213530 (gym_events_services_store_payments).

-- Events, services and appointments, print on demand store, payments (Stripe Connect), DSI billing for gyms.

create table public.events (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 2 and 100),
  slug text check (slug is null or slug ~ '^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$'),
  description text check (char_length(description) <= 4000),
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text check (char_length(location) <= 200),
  price_cents integer not null default 0 check (price_cents between 0 and 10000000),
  member_price_cents integer check (member_price_cents between 0 and 10000000),
  capacity integer check (capacity is null or capacity between 1 and 100000),
  divisions text[] not null default '{}',
  ask_shirt_size boolean not null default false,
  shirt_product_id uuid,
  status text not null default 'draft' check (status in ('draft','published','canceled','done')),
  internal_note text check (char_length(internal_note) <= 1000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gym_id, slug)
);
alter table public.events enable row level security;
create index events_gym_start on public.events (gym_id, starts_at);
create trigger events_touch before update on public.events for each row execute function public.touch_updated_at();
create policy events_public on public.events for select to anon using (status in ('published','done'));
create policy events_read on public.events for select to authenticated using (status in ('published','done') or public.can_work_gym(gym_id));
create policy events_manage on public.events for all to authenticated
  using (public.can_manage_site(gym_id)) with check (public.can_manage_site(gym_id));

create table public.services (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 80),
  description text check (char_length(description) <= 1000),
  kind text not null default 'appointment' check (kind in ('intro_class','drop_in','appointment','waitlist')),
  duration_min smallint check (duration_min between 5 and 600),
  price_cents integer not null default 0 check (price_cents between 0 and 10000000),
  price_note text check (char_length(price_note) <= 60),
  coach_ids uuid[] not null default '{}',
  require_payment boolean not null default false,
  active boolean not null default true,
  sort smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.services enable row level security;
create trigger services_touch before update on public.services for each row execute function public.touch_updated_at();
create policy services_public on public.services for select to anon using (active);
create policy services_read on public.services for select to authenticated using (active or public.can_work_gym(gym_id));
create policy services_manage on public.services for all to authenticated
  using (public.can_manage_site(gym_id)) with check (public.can_manage_site(gym_id));

-- Store: products can belong to a gym, or to DSI (gym_id null) as a shared catalog
create table public.products (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid references public.gyms(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 100),
  description text check (char_length(description) <= 2000),
  price_cents integer not null check (price_cents between 0 and 10000000),
  cost_cents integer check (cost_cents between 0 and 10000000),
  fulfillment text not null default 'print_on_demand' check (fulfillment in ('print_on_demand','in_stock','preorder','digital')),
  pod_provider text check (pod_provider in ('printful','printify','apliiq','gooten','other')),
  pod_product_ref text,
  ship_or_pickup text not null default 'both' check (ship_or_pickup in ('ship','pickup','both')),
  image_paths text[] not null default '{}',
  tag text check (char_length(tag) <= 30),
  visible boolean not null default false,
  sort smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.products enable row level security;
create trigger products_touch before update on public.products for each row execute function public.touch_updated_at();
create policy products_public on public.products for select to anon using (visible);
create policy products_read on public.products for select to authenticated
  using (visible or (gym_id is not null and public.can_work_gym(gym_id)) or public.is_platform_staff());
create policy products_manage on public.products for all to authenticated
  using ((gym_id is not null and public.can_manage_site(gym_id)) or (gym_id is null and public.is_platform_staff(null, array['admin','manager','designer'])))
  with check ((gym_id is not null and public.can_manage_site(gym_id)) or (gym_id is null and public.is_platform_staff(null, array['admin','manager','designer'])));

alter table public.events add constraint events_shirt_product_fk foreign key (shirt_product_id) references public.products(id) on delete set null;

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  size text check (char_length(size) <= 20),
  color text check (char_length(color) <= 40),
  sku text check (char_length(sku) <= 60),
  price_cents integer check (price_cents between 0 and 10000000),
  pod_variant_ref text,
  stock integer check (stock is null or stock >= 0),
  active boolean not null default true,
  sort smallint not null default 0
);
alter table public.product_variants enable row level security;
create policy product_variants_read on public.product_variants for select to anon, authenticated using (true);
create policy product_variants_manage on public.product_variants for all to authenticated
  using (exists (select 1 from public.products p where p.id = product_id and ((p.gym_id is not null and public.can_manage_site(p.gym_id)) or (p.gym_id is null and public.is_platform_staff(null, array['admin','manager','designer'])))))
  with check (exists (select 1 from public.products p where p.id = product_id and ((p.gym_id is not null and public.can_manage_site(p.gym_id)) or (p.gym_id is null and public.is_platform_staff(null, array['admin','manager','designer'])))));

-- Payments: written only by the server (Stripe webhooks with service role). Gyms are Stripe Connect accounts (gyms.stripe_account).
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete restrict,
  profile_id uuid references public.profiles(id) on delete set null,
  payer_name text check (char_length(payer_name) <= 120),
  payer_email text check (char_length(payer_email) <= 160),
  kind text not null check (kind in ('membership','event','order','appointment','drop_in','other')),
  ref_table text, ref_id uuid,
  amount_cents integer not null check (amount_cents between 0 and 10000000),
  application_fee_cents integer not null default 0 check (application_fee_cents >= 0),
  processor_fee_cents integer check (processor_fee_cents >= 0),
  refunded_cents integer not null default 0 check (refunded_cents >= 0),
  currency text not null default 'usd',
  status text not null default 'pending' check (status in ('pending','succeeded','failed','refunded','partially_refunded','disputed','canceled')),
  method text check (method in ('card','apple_pay','google_pay','ach','cash','check','other')),
  stripe_checkout_session text unique,
  stripe_payment_intent text unique,
  stripe_charge text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.payments enable row level security;
create index payments_gym_time on public.payments (gym_id, created_at desc);
create trigger payments_touch before update on public.payments for each row execute function public.touch_updated_at();
create policy payments_read on public.payments for select to authenticated
  using (profile_id = public.my_profile_id() or public.is_gym_owner(gym_id) or public.is_platform_staff(gym_id, array['admin','manager','support']));

create table public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  gym_id uuid not null references public.gyms(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  name text not null check (char_length(trim(name)) between 2 and 120),
  email text check (char_length(email) <= 160),
  phone text check (char_length(phone) <= 40),
  division text check (char_length(division) <= 60),
  team_name text check (char_length(team_name) <= 80),
  shirt_size text check (char_length(shirt_size) <= 10),
  price_cents integer not null default 0 check (price_cents >= 0),
  pay_at_gym boolean not null default false,
  payment_id uuid references public.payments(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','confirmed','waitlist','canceled','attended')),
  source text not null default 'website',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.event_registrations enable row level security;
create index event_regs_event on public.event_registrations (event_id);
create trigger event_registrations_touch before update on public.event_registrations for each row execute function public.touch_updated_at();
create policy event_regs_read on public.event_registrations for select to authenticated
  using (profile_id = public.my_profile_id() or public.can_work_gym(gym_id));
create policy event_regs_staff on public.event_registrations for all to authenticated
  using (public.can_work_gym(gym_id)) with check (public.can_work_gym(gym_id));

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  session_id uuid references public.sessions(id) on delete set null,  -- for intro class and drop in requests
  profile_id uuid references public.profiles(id) on delete set null,
  name text not null check (char_length(trim(name)) between 2 and 120),
  email text check (char_length(email) <= 160),
  phone text check (char_length(phone) <= 40),
  starts_at timestamptz,
  coach_id uuid references public.profiles(id) on delete set null,
  price_cents integer not null default 0 check (price_cents >= 0),
  payment_id uuid references public.payments(id) on delete set null,
  status text not null default 'requested' check (status in ('requested','confirmed','waitlist','done','canceled','no_show')),
  notes text check (char_length(notes) <= 1000),
  source text not null default 'website',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.appointments enable row level security;
create index appointments_gym_time on public.appointments (gym_id, starts_at);
create trigger appointments_touch before update on public.appointments for each row execute function public.touch_updated_at();
create policy appointments_read on public.appointments for select to authenticated
  using (profile_id = public.my_profile_id() or public.can_work_gym(gym_id));
create policy appointments_staff on public.appointments for all to authenticated
  using (public.can_work_gym(gym_id)) with check (public.can_work_gym(gym_id));

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity,
  gym_id uuid not null references public.gyms(id) on delete restrict,
  profile_id uuid references public.profiles(id) on delete set null,
  name text not null check (char_length(trim(name)) between 2 and 120),
  email text check (char_length(email) <= 160),
  phone text check (char_length(phone) <= 40),
  delivery text not null default 'pickup' check (delivery in ('pickup','ship')),
  ship_to jsonb,
  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  shipping_cents integer not null default 0 check (shipping_cents >= 0),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  total_cents integer not null default 0 check (total_cents >= 0),
  status text not null default 'pending' check (status in ('pending','paid','in_production','shipped','ready','picked_up','canceled','refunded')),
  fulfillment_provider text,
  provider_order_ref text,
  tracking_url text,
  payment_id uuid references public.payments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.orders enable row level security;
create trigger orders_touch before update on public.orders for each row execute function public.touch_updated_at();
create policy orders_read on public.orders for select to authenticated
  using (profile_id = public.my_profile_id() or public.can_work_gym(gym_id));
create policy orders_staff on public.orders for update to authenticated
  using (public.can_work_gym(gym_id)) with check (public.can_work_gym(gym_id));

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  name text not null,
  size text, color text,
  qty smallint not null check (qty between 1 and 50),
  unit_cents integer not null check (unit_cents >= 0),
  cost_cents integer check (cost_cents >= 0)
);
alter table public.order_items enable row level security;
create policy order_items_read on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (o.profile_id = public.my_profile_id() or public.can_work_gym(o.gym_id))));

-- What each gym pays DSI
create table public.gym_billing (
  gym_id uuid primary key references public.gyms(id) on delete cascade,
  tier text not null default 'base' check (tier in ('base','build','peak','custom')),
  price_cents integer not null default 0 check (price_cents >= 0),
  addons jsonb not null default '[]'::jsonb,
  per_member_pro_cents integer not null default 0 check (per_member_pro_cents >= 0),
  platform_fee_bps integer not null default 0 check (platform_fee_bps between 0 and 2000),
  status text not null default 'trial' check (status in ('trial','active','past_due','paused','canceled')),
  trial_ends_at date,
  stripe_customer text, stripe_subscription text,
  updated_at timestamptz not null default now()
);
alter table public.gym_billing enable row level security;
create trigger gym_billing_touch before update on public.gym_billing for each row execute function public.touch_updated_at();
create policy gym_billing_read on public.gym_billing for select to authenticated
  using (public.is_gym_owner(gym_id) or public.is_platform_staff(gym_id));
create policy gym_billing_dsi on public.gym_billing for all to authenticated
  using (public.is_platform_staff(gym_id, array['admin','manager'])) with check (public.is_platform_staff(gym_id, array['admin','manager']));
