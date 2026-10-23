-- Benchmarks come from the gym only. A coach marks a part of the day as a benchmark (sections[].bench = 'fran' | 'row2k');
-- a member's time for that part ('<part>_t' in their log, in seconds) becomes their benchmark entry for that day.
-- Rx or scaled follows the member's level: Beginner counts as scaled. Members no longer add benchmark times themselves.
alter table public.benchmark_entries add column if not exists workout_id uuid references public.workouts(id) on delete cascade;
create unique index if not exists benchmark_entries_workout on public.benchmark_entries (workout_id, profile_id, bench) where workout_id is not null;
drop policy if exists bench_insert on public.benchmark_entries;

create or replace function public.bench_from_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare w public.workouts; sec jsonb; k text; secs int; lvl text;
begin
  select * into w from public.workouts where id = new.workout_id;
  if w.id is null or w.gym_id is null then return null; end if;
  for sec in select * from jsonb_array_elements(coalesce(w.sections, '[]'::jsonb)) loop
    if sec->>'bench' in ('fran', 'row2k') then
      k := lower(sec->>'part') || '_t';
      secs := case when (new.entries->>k) ~ '^\d+(\.\d+)?$' then round((new.entries->>k)::numeric)::int else null end;
      delete from public.benchmark_entries where workout_id = w.id and profile_id = new.profile_id and bench = sec->>'bench';
      if secs between 60 and 7200 and coalesce(new.status, 'ok') <> 'struck' then
        select level into lvl from public.profiles where id = new.profile_id;
        insert into public.benchmark_entries (profile_id, bench, seconds, rx, performed_on, source, workout_id)
        values (new.profile_id, sec->>'bench', secs, coalesce(lvl, 'beginner') <> 'beginner', least(w.day, current_date), 'workout', w.id);
      end if;
    end if;
  end loop;
  return null;
exception when others then return null; -- a benchmark problem never blocks a log
end $$;
revoke all on function public.bench_from_log() from public, anon, authenticated;
drop trigger if exists workout_logs_bench on public.workout_logs;
create trigger workout_logs_bench after insert or update of entries, status on public.workout_logs for each row execute function public.bench_from_log();
