-- Benchmark workouts, tracked like the four DSI lifts: log a time, the best counts, beating it is a PR.
--   fran   21-15-9 thrusters (95/65 lb) and pull ups, for time. Rx and scaled rank apart.
--   row2k  2,000 meters on the rower, for time.
-- Lower is better for both. A PR is a faster time than the lifter's old best at the same standard (Rx or scaled).
create table if not exists public.benchmark_entries (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  bench text not null check (bench in ('fran', 'row2k')),
  seconds int not null check (seconds between 60 and 7200),
  rx boolean not null default true,
  performed_on date not null default current_date,
  note text check (char_length(note) <= 280),
  source text not null default 'manual' check (source in ('manual', 'workout')),
  is_pr boolean not null default false,
  prev_best int,
  status text not null default 'ok' check (status in ('ok', 'protested', 'struck')),
  created_at timestamptz not null default now()
);
create index if not exists benchmark_entries_board on public.benchmark_entries (bench, rx, seconds);
create index if not exists benchmark_entries_profile on public.benchmark_entries (profile_id, bench, performed_on desc);
alter table public.benchmark_entries enable row level security;

drop policy if exists bench_read on public.benchmark_entries;
create policy bench_read on public.benchmark_entries for select using (true);
drop policy if exists bench_insert on public.benchmark_entries;
create policy bench_insert on public.benchmark_entries for insert to authenticated with check (profile_id = public.my_profile_id());
drop policy if exists bench_update on public.benchmark_entries;
create policy bench_update on public.benchmark_entries for update to authenticated
  using (profile_id = public.my_profile_id() or public.has_role(array['admin', 'commissioner']));
drop policy if exists bench_delete on public.benchmark_entries;
create policy bench_delete on public.benchmark_entries for delete to authenticated using (profile_id = public.my_profile_id());
revoke all on public.benchmark_entries from anon;
grant select on public.benchmark_entries to anon, authenticated;
grant insert, update, delete on public.benchmark_entries to authenticated;

-- PR and old best are set here, never by the app. Members cannot rewrite them or the status.
create or replace function public.benchmark_entries_pr() returns trigger
language plpgsql security definer set search_path = public as $$
declare best int;
begin
  if tg_op = 'INSERT' then
    if new.performed_on > current_date then raise exception 'That date has not happened yet.'; end if;
    select min(seconds) into best from public.benchmark_entries
      where profile_id = new.profile_id and bench = new.bench and rx = new.rx and status <> 'struck';
    new.prev_best := best;
    new.is_pr := best is null or new.seconds < best;
    if not public.has_role(array['admin', 'commissioner']) then new.status := 'ok'; end if;
  else
    if not public.has_role(array['admin', 'commissioner']) then
      new.status := old.status; new.is_pr := old.is_pr; new.prev_best := old.prev_best;
      new.seconds := old.seconds; new.bench := old.bench; new.rx := old.rx; new.profile_id := old.profile_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists benchmark_entries_pr on public.benchmark_entries;
create trigger benchmark_entries_pr before insert or update on public.benchmark_entries for each row execute function public.benchmark_entries_pr();
revoke all on function public.benchmark_entries_pr() from public, anon, authenticated;

-- PRs for the wall, with names, like pr_feed for lifts.
create or replace view public.bench_pr_feed with (security_invoker = true) as
select e.id, e.profile_id, p.display_name as name, e.bench, e.seconds, e.rx, e.prev_best, e.performed_on, e.status, e.created_at
from public.benchmark_entries e join public.profiles p on p.id = e.profile_id
where e.is_pr and e.prev_best is not null and e.status <> 'struck';
grant select on public.bench_pr_feed to anon, authenticated;
