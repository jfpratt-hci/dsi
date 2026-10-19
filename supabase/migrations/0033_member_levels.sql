-- Member levels: Beginner, Rx, Comp. Everyone starts at Beginner and graduates by what they log.
--   Beginner -> Rx    3 logs at or above the Rx weight, or 8 weighted logs and 2 PRs in the last 120 days
--   Rx -> Comp        3 logs at or above the Rx+ (Comp) weight in the last 120 days
-- Levels only go up on their own. A coach can set any level (level_by = 'coach'), and the app shows the history.

alter table public.profiles
  add column if not exists level text not null default 'beginner' check (level in ('beginner', 'rx', 'comp')),
  add column if not exists level_by text not null default 'auto' check (level_by in ('auto', 'coach')),
  add column if not exists level_at timestamptz;

create table if not exists public.level_events (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  from_level text,
  to_level text not null,
  reason text,
  set_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists level_events_profile on public.level_events (profile_id, created_at desc);
alter table public.level_events enable row level security;
drop policy if exists level_events_read on public.level_events;
create policy level_events_read on public.level_events for select to authenticated
  using (profile_id = public.my_profile_id() or exists (select 1 from public.profiles p where p.id = level_events.profile_id and p.gym_id is not null and public.can_work_gym(p.gym_id)));
revoke all on public.level_events from anon;
grant select on public.level_events to authenticated;

-- Members cannot set their own level. Coaches use set_member_level; graduation runs as the system.
create or replace function public.profiles_level_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.level is distinct from old.level or new.level_by is distinct from old.level_by or new.level_at is distinct from old.level_at then
    if not (public.sys_on() or auth.uid() is null) then
      new.level := old.level; new.level_by := old.level_by; new.level_at := old.level_at;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_level_guard on public.profiles;
create trigger profiles_level_guard before update on public.profiles for each row execute function public.profiles_level_guard();

-- Where a member stands: counts toward the next level.
create or replace function public.level_progress(p_profile uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pr public.profiles; rx int := 0; comp int := 0; logs int := 0; prs int := 0;
begin
  select * into pr from public.profiles where id = p_profile;
  if pr.id is null then return null; end if;
  with l as (
    select w.day, wl.entries, li
    from public.workout_logs wl join public.workouts w on w.id = wl.workout_id
    cross join lateral jsonb_array_elements(coalesce(w.lifts, '[]'::jsonb)) li
    where wl.profile_id = p_profile and w.day > current_date - 120 and coalesce(wl.status, 'ok') = 'ok'
  ), v as (
    select day, (entries->>(li->>'id'))::numeric wt,
      case when pr.sex = 'female' and li ? 'rxw' then li->'rxw' else li->'rx' end rxa
    from l where entries ? (li->>'id') and (entries->>(li->>'id')) ~ '^\d+(\.\d+)?$'
  )
  select count(distinct day) filter (where rxa is not null and wt >= (rxa->>0)::numeric),
         count(distinct day) filter (where rxa is not null and (rxa->>1)::numeric > (rxa->>0)::numeric and wt >= (rxa->>1)::numeric),
         count(distinct day)
    into rx, comp, logs from v;
  select count(*) into prs from public.lift_entries where profile_id = p_profile and is_pr and performed_on > current_date - 120 and coalesce(status, 'ok') = 'ok';
  return jsonb_build_object('level', pr.level, 'level_by', pr.level_by, 'level_at', pr.level_at,
    'rx_logs', rx, 'comp_logs', comp, 'weighted_logs', logs, 'prs', prs,
    'next', case pr.level when 'beginner' then 'rx' when 'rx' then 'comp' else null end,
    'ready', case pr.level when 'beginner' then rx >= 3 or (logs >= 8 and prs >= 2) when 'rx' then comp >= 3 else false end);
end $$;
revoke execute on function public.level_progress(uuid) from public, anon;
grant execute on function public.level_progress(uuid) to authenticated;

-- Graduate when ready. Returns the new level, or null when nothing changed.
create or replace function public.level_check(p_profile uuid) returns text
language plpgsql security definer set search_path = public as $$
declare g jsonb := public.level_progress(p_profile); nx text; why text; prev text := coalesce(current_setting('dsi.sys', true), '');
begin
  if g is null or not (g->>'ready')::boolean then return null; end if;
  nx := g->>'next';
  why := case nx when 'rx' then case when (g->>'rx_logs')::int >= 3 then 'Logged Rx weights ' || (g->>'rx_logs') || ' times' else (g->>'weighted_logs') || ' weighted logs and ' || (g->>'prs') || ' PRs' end
    else 'Logged Comp weights ' || (g->>'comp_logs') || ' times' end;
  perform set_config('dsi.sys', 'on', true);
  update public.profiles set level = nx, level_by = 'auto', level_at = now() where id = p_profile;
  perform set_config('dsi.sys', prev, true);
  insert into public.level_events (profile_id, from_level, to_level, reason) values (p_profile, g->>'level', nx, why);
  -- Rx straight to Comp in one go when the logs are already there.
  perform public.level_check(p_profile);
  return nx;
end $$;
revoke execute on function public.level_check(uuid) from public, anon, authenticated;

create or replace function public.level_after_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.level_check(new.profile_id);
  return null;
exception when others then return null; -- a level problem never blocks a log
end $$;
drop trigger if exists workout_logs_level on public.workout_logs;
create trigger workout_logs_level after insert or update of entries on public.workout_logs for each row execute function public.level_after_log();
drop trigger if exists lift_entries_level on public.lift_entries;
create trigger lift_entries_level after insert on public.lift_entries for each row execute function public.level_after_log();

-- A coach sets a level by hand.
create or replace function public.set_member_level(p_profile uuid, p_level text) returns text
language plpgsql security definer set search_path = public as $$
declare pr public.profiles; prev text := coalesce(current_setting('dsi.sys', true), '');
begin
  select * into pr from public.profiles where id = p_profile;
  if pr.id is null or pr.gym_id is null or not public.can_work_gym(pr.gym_id) then raise exception 'Only a coach at their gym can set a level.'; end if;
  if p_level not in ('beginner', 'rx', 'comp') then raise exception 'Pick Beginner, Rx or Comp.'; end if;
  if p_level = pr.level then return p_level; end if;
  perform set_config('dsi.sys', 'on', true);
  update public.profiles set level = p_level, level_by = 'coach', level_at = now() where id = p_profile;
  perform set_config('dsi.sys', prev, true);
  insert into public.level_events (profile_id, from_level, to_level, reason, set_by) values (p_profile, pr.level, p_level, 'Set by a coach', public.my_profile_id());
  return p_level;
end $$;
revoke execute on function public.set_member_level(uuid, text) from public, anon;
grant execute on function public.set_member_level(uuid, text) to authenticated;

-- Everyone who already qualifies graduates now.
select public.level_check(id) from public.profiles;
