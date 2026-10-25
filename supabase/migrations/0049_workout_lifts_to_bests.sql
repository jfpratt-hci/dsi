-- Class workouts feed the DSI page. When a member (or a coach for them) logs a weight on a workout part that is a
-- catalog lift, and it beats their best for that lift, it becomes a lift entry: a new best, a PR on the boards,
-- and it shows on the DSI page. Any weight moved for reps is at least that heavy as a single, so it is a fair best.

-- Which catalog lift a workout part is, from its name. Variations (hang, tempo, box, kettlebell...) do not count.
create or replace function public.lift_from_name(p text) returns text
language sql immutable as $$
  with n as (select ' ' || regexp_replace(lower(coalesce(p, '')), '[^a-z0-9&]+', ' ', 'g') || ' ' as s)
  select case
    when s ~ ' (hang|hangs|tempo|pause|paused|deficit|box|dumbbell|dumbbells|db|kb|kettlebell|kettlebells|banded|band|block|blocks|pin|swing|swings|thruster|thrusters|wall|ball|balls|sandbag|landmine|single arm|single leg|split squat|bulgarian|goblet|zercher|romanian|rdl|stiff|good morning|pull|pulls|row|rows|air|jump|step|lunge|lunges|cluster|clusters|complex|drill|drills|technique|skill|muscle|stance|staggered|snatch dl|snatch deadlift|clean dl|clean deadlift|z press|floor) ' then null
    when s ~ ' (clean (and|&) jerk|c ?& ?j|cnj) ' then 'clean_and_jerk'
    when s ~ ' squat snatch ' then 'squat_snatch'
    when s ~ ' power snatch ' then 'power_snatch'
    when s ~ ' snatch ' then 'snatch'
    when s ~ ' squat clean ' then 'squat_clean'
    when s ~ ' power clean ' then 'power_clean'
    when s ~ ' clean ' then 'clean'
    when s ~ ' (push|split)? ?jerk ' then 'jerk'
    when s ~ ' front squat ' then 'front_squat'
    when s ~ ' (overhead squat|ohs) ' then 'overhead_squat'
    when s ~ ' (back squat|squat|squats) ' then 'squat'
    when s ~ ' sumo (deadlift|dl) ' then 'sumo_deadlift'
    when s ~ ' (deadlift|deadlifts|dl) ' then 'deadlift'
    when s ~ ' bench ' then 'bench'
    when s ~ ' push press ' then 'push_press'
    when s ~ ' (strict press|shoulder press|overhead press|ohp|press) ' then 'strict_press'
  end from n;
$$;

create or replace function public.workout_log_bests() returns trigger
language plpgsql security definer set search_path = public as $$
declare w record; it jsonb; lid text; v numeric; best numeric; me uuid := public.my_profile_id();
begin
  select id, day, title, lifts, pr_lift into w from public.workouts where id = new.workout_id;
  if w.id is null or w.day > current_date or jsonb_typeof(w.lifts) <> 'array' then return new; end if;
  for it in select * from jsonb_array_elements(w.lifts) loop
    v := case when (new.entries ->> (it ->> 'id')) ~ '^\d+(\.\d+)?$' then (new.entries ->> (it ->> 'id'))::numeric end;
    if v is null or v <= 0 or v >= 1500 then continue; end if;
    -- Only when this log changed that number.
    if tg_op = 'UPDATE' and (old.entries ->> (it ->> 'id')) is not distinct from (new.entries ->> (it ->> 'id')) then continue; end if;
    lid := case when coalesce((it ->> 'max')::boolean, false) and w.pr_lift is not null then w.pr_lift else public.lift_from_name(it ->> 'n') end;
    if lid is null or not exists (select 1 from public.lifts where id = lid) then continue; end if;
    select max(weight_lb) into best from public.lift_entries where profile_id = new.profile_id and lift = lid and status <> 'struck';
    if v <= coalesce(best, 0) then continue; end if;
    insert into public.lift_entries (profile_id, lift, weight_lb, performed_on, source, note, entered_by)
    values (new.profile_id, lid, v, w.day, 'workout', left('From class: ' || coalesce(w.title, 'workout'), 280), case when me is distinct from new.profile_id then me end);
  end loop;
  return new;
end $$;
revoke all on function public.workout_log_bests() from public, anon, authenticated;
drop trigger if exists workout_log_bests on public.workout_logs;
create trigger workout_log_bests after insert or update of entries on public.workout_logs for each row execute function public.workout_log_bests();
