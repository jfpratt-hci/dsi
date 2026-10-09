-- Coaches log weights during class.
-- A coach can enter results for anyone booked into a class at their gym that day (drop ins included),
-- not only members whose home gym it is. On a max out day the coach's entry also records the PR,
-- so the DSI and the PR wall move right away. Every coach entry keeps who entered it.

alter table public.workout_logs add column if not exists entered_by uuid references public.profiles(id) on delete set null;
alter table public.lift_entries add column if not exists entered_by uuid references public.profiles(id) on delete set null;

-- True when I coach at a gym where this person trains: their home gym, or a class they booked there that day.
create or replace function public.coach_can_enter(p_gym uuid, p_profile uuid, p_day date) returns boolean
language sql stable security definer set search_path = public as $$
  select p_gym is not null and public.is_gym_staff(p_gym) and (
    exists (select 1 from public.profiles p where p.id = p_profile and p.gym_id = p_gym)
    or exists (select 1 from public.bookings b join public.sessions s on s.id = b.session_id join public.gyms g on g.id = s.gym_id
               where b.profile_id = p_profile and s.gym_id = p_gym and b.status <> 'canceled'
                 and (s.starts_at at time zone g.tz)::date = p_day)
  )
$$;
revoke all on function public.coach_can_enter(uuid, uuid, date) from public, anon;
grant execute on function public.coach_can_enter(uuid, uuid, date) to authenticated;

create or replace function public.coach_can_log(p_workout uuid, p_profile uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workouts w where w.id = p_workout and public.coach_can_enter(w.gym_id, p_profile, w.day));
$$;

-- PRs a coach enters on a max out day: source 'workout', stamped with the coach.
drop policy if exists lifts_coach_insert on public.lift_entries;
create policy lifts_coach_insert on public.lift_entries for insert to authenticated with check (
  source = 'workout' and entered_by = public.my_profile_id() and exists (
    select 1 from public.workouts w
    where w.gym_id is not null and w.day = performed_on and w.pr_lift = lift
      and public.coach_can_enter(w.gym_id, profile_id, w.day)));
