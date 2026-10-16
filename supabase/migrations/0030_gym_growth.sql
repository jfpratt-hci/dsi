-- Gym growth game: a weekly check in of the gym's numbers and a board of quests (simple growth ideas worth points).
-- Private to the gym's owners and Dandy admins: nobody else can read or write these rows.

create table if not exists public.gym_growth_checkins (
  gym_id uuid not null references public.gyms(id) on delete cascade,
  week date not null,                       -- the Monday of the week
  members int check (members is null or members >= 0),        -- paying members at the end of the week
  new_members int check (new_members is null or new_members >= 0),
  cancels int check (cancels is null or cancels >= 0),
  trials int check (trials is null or trials >= 0),           -- free classes or intro sessions booked
  leads int check (leads is null or leads >= 0),              -- calls, texts, forms, walk ins
  revenue_cents int check (revenue_cents is null or revenue_cents >= 0), -- money in this week, all sources
  google_rating numeric(2,1) check (google_rating is null or google_rating between 1 and 5),
  google_reviews int check (google_reviews is null or google_reviews >= 0),
  note text,
  entered_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (gym_id, week)
);

create table if not exists public.gym_growth_quests (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  title text not null check (length(title) between 2 and 120),
  why text,
  area text not null default 'members' check (area in ('members', 'retention', 'revenue', 'reputation', 'space')),
  points int not null default 50 check (points between 5 and 500),
  due date,
  status text not null default 'open' check (status in ('open', 'done', 'skipped')),
  done_at timestamptz,
  sort int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists gym_growth_quests_gym on public.gym_growth_quests (gym_id, status, sort);

-- The season goal and what sets the handicap (size comes from the check ins; age from the year the gym opened).
create table if not exists public.gym_growth_settings (
  gym_id uuid primary key references public.gyms(id) on delete cascade,
  opened_year int check (opened_year is null or opened_year between 1950 and 2100),
  goal_members int check (goal_members is null or goal_members > 0),
  goal_date date,
  updated_at timestamptz not null default now()
);

alter table public.gym_growth_settings enable row level security;
drop policy if exists growth_settings_owner on public.gym_growth_settings;
create policy growth_settings_owner on public.gym_growth_settings for all to authenticated
  using (public.is_gym_owner(gym_id)) with check (public.is_gym_owner(gym_id));
alter table public.gym_growth_checkins enable row level security;
alter table public.gym_growth_quests enable row level security;
drop policy if exists growth_checkins_owner on public.gym_growth_checkins;
create policy growth_checkins_owner on public.gym_growth_checkins for all to authenticated
  using (public.is_gym_owner(gym_id)) with check (public.is_gym_owner(gym_id));
drop policy if exists growth_quests_owner on public.gym_growth_quests;
create policy growth_quests_owner on public.gym_growth_quests for all to authenticated
  using (public.is_gym_owner(gym_id)) with check (public.is_gym_owner(gym_id));
revoke all on public.gym_growth_checkins, public.gym_growth_quests, public.gym_growth_settings from anon;
grant select, insert, update, delete on public.gym_growth_checkins, public.gym_growth_quests, public.gym_growth_settings to authenticated;
