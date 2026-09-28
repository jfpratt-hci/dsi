-- DSI core schema
create extension if not exists citext;

-- Membership tiers
create table public.tiers (
  id text primary key,
  name text not null,
  price_cents int not null default 0,
  perks jsonb not null default '[]'::jsonb,
  sort int not null default 0
);
insert into public.tiers (id, name, price_cents, perks, sort) values
  ('free','Member',0,'["Leaderboards","PR wall","Daily log","Chat"]',0),
  ('pro','DSI Pro',500,'["Everything in Member","AI coaching","Goal plans","History import"]',1);

-- Profiles. user_id is null until the person signs in and claims it.
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  display_name citext unique,
  sex text not null default 'male' check (sex in ('male','female','unspecified')),
  division text not null default 'men' check (division in ('men','women','open')),
  birth_year int check (birth_year between 1920 and 2015),
  bodyweight numeric(5,1) check (bodyweight between 80 and 450),
  roast_opt_in boolean not null default false,
  tier text not null default 'free' references public.tiers(id),
  role text not null default 'member' check (role in ('member','commissioner','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Private: email to match a legacy profile when that person first signs in.
create table public.profile_claims (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  email citext not null unique
);

-- Groups: divisions plus any custom groups (chat rooms hang off these)
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  kind text not null default 'custom' check (kind in ('division','custom')),
  description text,
  is_open boolean not null default true,
  min_tier text not null default 'free' references public.tiers(id),
  created_at timestamptz not null default now()
);
insert into public.groups (slug,name,kind,description,is_open) values
  ('everyone','Everyone','custom','The whole gym',true),
  ('men','Battle of Men','division','Men''s division',false),
  ('women','Women','division','Women''s division',false),
  ('open','Open','division','Open division',false);

create table public.group_members (
  group_id uuid references public.groups(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('member','mod')),
  joined_at timestamptz not null default now(),
  primary key (group_id, profile_id)
);

-- Lift entries: every logged max. PR flags set by trigger.
create table public.lift_entries (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  lift text not null check (lift in ('bench','squat','deadlift','clean','jerk','snatch','front_squat','overhead_squat')),
  weight_lb numeric(6,1) not null check (weight_lb > 0 and weight_lb < 1500),
  performed_on date not null default (now() at time zone 'America/New_York')::date,
  source text not null default 'manual' check (source in ('manual','workout','import')),
  is_pr boolean not null default false,
  prev_best numeric(6,1),
  status text not null default 'ok' check (status in ('ok','protested','struck')),
  note text check (char_length(note) <= 280),
  created_at timestamptz not null default now()
);
create index on public.lift_entries (profile_id, lift, weight_lb desc);
create index on public.lift_entries (performed_on desc);

create table public.goals (
  profile_id uuid references public.profiles(id) on delete cascade,
  lift text not null check (lift in ('bench','squat','deadlift','clean')),
  target_lb numeric(6,1) not null check (target_lb > 0),
  updated_at timestamptz not null default now(),
  primary key (profile_id, lift)
);

-- Workouts (programming) and daily logs
create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  day date not null unique,
  title text not null,
  source text,
  sections jsonb not null default '[]'::jsonb,
  lifts jsonb not null default '[]'::jsonb,
  score_label text,
  score_type text check (score_type in ('time','text')),
  rest_note text,
  pr_lift text,
  created_at timestamptz not null default now()
);

create table public.workout_logs (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  entries jsonb not null default '{}'::jsonb,
  score text check (char_length(score) <= 40),
  note text check (char_length(note) <= 280),
  status text not null default 'ok' check (status in ('ok','protested','struck')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workout_id, profile_id)
);

-- Protests
create table public.protests (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('lift_entry','workout_log')),
  target_id uuid not null,
  filed_by uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 500),
  status text not null default 'open' check (status in ('open','upheld','struck')),
  ruled_by uuid references public.profiles(id),
  ruling_note text check (char_length(ruling_note) <= 500),
  created_at timestamptz not null default now(),
  ruled_at timestamptz
);
create index on public.protests (status, created_at desc);

-- Chat
create table public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('group','pr','workout','protest')),
  group_id uuid references public.groups(id) on delete cascade,
  ref_id uuid,
  title text not null,
  created_at timestamptz not null default now(),
  unique (kind, ref_id),
  unique (group_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  deleted boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.messages (room_id, created_at desc);
