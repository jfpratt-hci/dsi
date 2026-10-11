-- Personal workout tracking: members log their own lifting sessions outside class.
-- Logging is free for everyone; charts and trends are a DSI Pro view on the same data.
-- exercises: [{ name, lift: catalog id or null, sets: [{ r: reps, w: weight_lb }] }]
-- Heavy singles on catalog lifts are also written to lift_entries by the app, so PRs and the DSI move.

create table if not exists public.personal_workouts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  day date not null default current_date,
  title text not null default 'Workout' check (char_length(trim(title)) between 1 and 80),
  note text check (char_length(note) <= 1000),
  exercises jsonb not null default '[]'::jsonb check (jsonb_typeof(exercises) = 'array' and jsonb_array_length(exercises) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists personal_workouts_profile_day on public.personal_workouts (profile_id, day desc);
alter table public.personal_workouts enable row level security;
drop policy if exists personal_workouts_own on public.personal_workouts;
create policy personal_workouts_own on public.personal_workouts for all to authenticated
  using (profile_id = public.my_profile_id()) with check (profile_id = public.my_profile_id());
grant select, insert, update, delete on public.personal_workouts to authenticated;

create or replace function public.personal_workouts_touch() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists personal_workouts_touch on public.personal_workouts;
create trigger personal_workouts_touch before update on public.personal_workouts
  for each row execute function public.personal_workouts_touch();
