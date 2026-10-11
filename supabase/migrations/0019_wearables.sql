-- Wearables: WHOOP (online, through the whoop function), Apple Health and Android Health Connect (from the phone app).
-- Each member's daily recovery, HRV, resting heart rate, sleep and strain land in wearable_days.
-- Only the member can see their own rows. Tokens are never readable from the app or the website.

create table if not exists public.wearable_links (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('whoop', 'apple', 'health_connect')),
  external_id text,                 -- WHOOP user id, so webhooks find the member
  connected_at timestamptz not null default now(),
  last_sync timestamptz,
  status text not null default 'ok' check (status in ('ok', 'reconnect')),
  primary key (profile_id, provider)
);
create index if not exists wearable_links_external on public.wearable_links (provider, external_id);
alter table public.wearable_links enable row level security;
drop policy if exists wearable_links_read on public.wearable_links;
create policy wearable_links_read on public.wearable_links for select to authenticated using (profile_id = public.my_profile_id());
-- The phone app registers Apple Health and Health Connect itself; WHOOP links are made by the function.
drop policy if exists wearable_links_phone on public.wearable_links;
create policy wearable_links_phone on public.wearable_links for insert to authenticated
  with check (profile_id = public.my_profile_id() and provider in ('apple', 'health_connect'));
drop policy if exists wearable_links_phone_upd on public.wearable_links;
create policy wearable_links_phone_upd on public.wearable_links for update to authenticated
  using (profile_id = public.my_profile_id() and provider in ('apple', 'health_connect'))
  with check (profile_id = public.my_profile_id() and provider in ('apple', 'health_connect'));
drop policy if exists wearable_links_phone_del on public.wearable_links;
create policy wearable_links_phone_del on public.wearable_links for delete to authenticated
  using (profile_id = public.my_profile_id() and provider in ('apple', 'health_connect'));
grant select, insert, update, delete on public.wearable_links to authenticated;

-- OAuth tokens: server only. No policies, no grants.
create table if not exists public.wearable_tokens (
  profile_id uuid not null,
  provider text not null,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz not null,
  scope text,
  updated_at timestamptz not null default now(),
  primary key (profile_id, provider),
  foreign key (profile_id, provider) references public.wearable_links(profile_id, provider) on delete cascade
);
alter table public.wearable_tokens enable row level security;
revoke all on public.wearable_tokens from public, anon, authenticated;

-- One short lived row per Connect click, to check WHOOP sends the member back to us.
create table if not exists public.wearable_states (
  state text primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null,
  created_at timestamptz not null default now()
);
alter table public.wearable_states enable row level security;
revoke all on public.wearable_states from public, anon, authenticated;

create table if not exists public.wearable_days (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('whoop', 'apple', 'health_connect')),
  day date not null,
  recovery int check (recovery between 0 and 100),   -- WHOOP recovery score
  hrv_ms numeric(6,1),                                -- WHOOP and Health Connect: RMSSD; Apple: SDNN
  rhr int,
  sleep_hours numeric(4,2),
  sleep_perf int,
  strain numeric(4,1),
  calories int,
  bodyweight_lb numeric(5,1),
  updated_at timestamptz not null default now(),
  primary key (profile_id, provider, day)
);
create index if not exists wearable_days_recent on public.wearable_days (profile_id, day desc);
alter table public.wearable_days enable row level security;
drop policy if exists wearable_days_read on public.wearable_days;
create policy wearable_days_read on public.wearable_days for select to authenticated using (profile_id = public.my_profile_id());
drop policy if exists wearable_days_phone on public.wearable_days;
create policy wearable_days_phone on public.wearable_days for insert to authenticated
  with check (profile_id = public.my_profile_id() and provider in ('apple', 'health_connect'));
drop policy if exists wearable_days_phone_upd on public.wearable_days;
create policy wearable_days_phone_upd on public.wearable_days for update to authenticated
  using (profile_id = public.my_profile_id() and provider in ('apple', 'health_connect'))
  with check (profile_id = public.my_profile_id() and provider in ('apple', 'health_connect'));
drop policy if exists wearable_days_own_del on public.wearable_days;
create policy wearable_days_own_del on public.wearable_days for delete to authenticated using (profile_id = public.my_profile_id());
grant select, insert, update, delete on public.wearable_days to authenticated;
