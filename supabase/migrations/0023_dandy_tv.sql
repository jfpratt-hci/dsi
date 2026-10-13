-- Dandy TV: what shows on a gym's two screens.
-- Class TV (/tv/<gym>) shows the workout, targets and boards; screens can be switched off and timed.
-- Lobby TV (/lobby/<gym>) rotates slides the gym sets up: schedule, PRs, events, offers, with a QR code on each.
create table if not exists public.gym_tv (
  gym_id uuid primary key references public.gyms(id) on delete cascade,
  class_screens jsonb not null default '{}',
  class_secs int not null default 15 check (class_secs between 5 and 120),
  lobby_slides jsonb not null default '[]',
  lobby_secs int not null default 12 check (lobby_secs between 5 and 120),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
alter table public.gym_tv enable row level security;
drop policy if exists gym_tv_read on public.gym_tv;
create policy gym_tv_read on public.gym_tv for select to anon, authenticated using (true);
drop policy if exists gym_tv_staff on public.gym_tv;
create policy gym_tv_staff on public.gym_tv for all to authenticated using (public.is_gym_staff(gym_id)) with check (public.is_gym_staff(gym_id));
grant select on public.gym_tv to anon, authenticated;
grant insert, update on public.gym_tv to authenticated;
