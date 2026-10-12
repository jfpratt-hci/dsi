-- Gym insights for owners: class attendance history and settings for the Insights dashboard.
-- Live Dandy bookings feed it on their own; these tables hold history brought in from another system
-- (Kilo and the like), one row per class held and one per person per class. Owners (and the Founder) only.

create table if not exists public.gym_class_log (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  day date not null,
  start_time time not null,
  class_name text not null default 'Class',
  coach_name text,
  capacity int,
  attendance_taken boolean not null default true,
  source text not null default 'import',
  created_at timestamptz not null default now(),
  unique (gym_id, day, start_time, class_name)
);
create table if not exists public.gym_visit_log (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  day date not null,
  start_time time not null,
  class_name text not null default 'Class',
  member_name text not null,
  profile_id uuid references public.profiles(id) on delete set null,
  status text,
  attended boolean not null default true,
  source text not null default 'import',
  created_at timestamptz not null default now(),
  unique (gym_id, day, start_time, class_name, member_name)
);
create index if not exists gym_visit_log_gym_day on public.gym_visit_log (gym_id, day);
create index if not exists gym_class_log_gym_day on public.gym_class_log (gym_id, day);

-- Dues estimate and names to leave out of member counts (coaches, kids class).
create table if not exists public.gym_insight_settings (
  gym_id uuid primary key references public.gyms(id) on delete cascade,
  avg_dues_cents int,
  exclude_names text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.gym_class_log enable row level security;
alter table public.gym_visit_log enable row level security;
alter table public.gym_insight_settings enable row level security;
do $$ declare t text; begin
  foreach t in array array['gym_class_log', 'gym_visit_log', 'gym_insight_settings'] loop
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_gym_owner(gym_id)) with check (public.is_gym_owner(gym_id))', t || '_owner', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
