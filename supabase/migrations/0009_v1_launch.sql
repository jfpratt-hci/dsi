-- v1 launch: push notifications, set by set logs, Pro rules in the database, Pro group creation, purchases

-- Notification settings and purchase state on the profile
alter table public.profiles
  add column if not exists reminder_hour smallint not null default 18 check (reminder_hour between 0 and 23),
  add column if not exists notify_reminders boolean not null default true,
  add column if not exists notify_prs boolean not null default true,
  add column if not exists notify_program boolean not null default true,
  add column if not exists pro_until timestamptz,
  add column if not exists pro_source text;

-- Expo push tokens, one row per device
create table if not exists public.push_tokens (
  token text primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  platform text,
  updated_at timestamptz not null default now()
);
alter table public.push_tokens enable row level security;
drop policy if exists push_own on public.push_tokens;
create policy push_own on public.push_tokens for all to authenticated
  using (profile_id = public.my_profile_id()) with check (profile_id = public.my_profile_id());

-- Set by set detail on a workout log: {"fs":[{"w":185,"r":8},...]}
alter table public.workout_logs add column if not exists sets jsonb not null default '{}'::jsonb;

-- Groups remember who made them
alter table public.groups add column if not exists created_by uuid references public.profiles(id) on delete set null;

-- Pro rules the database enforces (staff always pass; sys jobs pass)
create or replace function public.lift_import_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.sys_on() then return new; end if;
  if new.source = 'import' and not public.is_pro() then
    raise exception 'History import is a DSI Pro feature';
  end if;
  if new.lift not in ('bench','squat','deadlift','clean') and new.source <> 'workout' and not public.is_pro() then
    raise exception 'Logging other lifts is a DSI Pro feature';
  end if;
  return new;
end $$;

create or replace function public.pro_only() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.sys_on() and not public.is_pro() then
    raise exception '% is a DSI Pro feature', tg_argv[0];
  end if;
  return new;
end $$;

drop trigger if exists workout_logs_pro on public.workout_logs;
create trigger workout_logs_pro before insert or update on public.workout_logs
  for each row execute function public.pro_only('Logging workouts');
drop trigger if exists goals_pro on public.goals;
create trigger goals_pro before insert or update on public.goals
  for each row execute function public.pro_only('Goals');

-- Threads (PR, day and protest rooms) are read by everyone, posted in by Pro. Group rooms stay open.
create or replace function public.thread_post_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if public.sys_on() then return new; end if;
  select kind into k from public.chat_rooms where id = new.room_id;
  if k is distinct from 'group' and not public.is_pro() then
    raise exception 'Posting in threads is a DSI Pro feature';
  end if;
  return new;
end $$;
drop trigger if exists messages_thread_pro on public.messages;
create trigger messages_thread_pro before insert on public.messages
  for each row execute function public.thread_post_guard();

-- Roast mode is Pro
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.sys_on() and not public.has_role(array['admin']) and auth.uid() is not null then
    new.tier := old.tier; new.role := old.role; new.user_id := old.user_id;
    new.pro_until := old.pro_until; new.pro_source := old.pro_source;
    if new.roast_opt_in and not old.roast_opt_in and not public.is_pro() then new.roast_opt_in := false; end if;
  end if;
  if new.sex = 'female' and old.sex <> 'female' and new.division = old.division then new.division := 'women'; end if;
  new.updated_at := now();
  return new;
end $$;

-- Pro members create groups
create or replace function public.create_group(p_name text, p_open boolean default true, p_pro_only boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_profile_id(); gid uuid; s text;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if not public.is_pro() then raise exception 'Creating groups is a DSI Pro feature'; end if;
  if length(trim(coalesce(p_name,''))) < 3 then raise exception 'Name the group, at least 3 characters'; end if;
  if (select count(*) from public.groups where created_by = me) >= 10 then raise exception 'You can run up to 10 groups'; end if;
  s := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(md5(random()::text), 1, 5);
  perform set_config('dsi.sys', 'on', true);
  insert into public.groups (slug, name, kind, is_open, min_tier, created_by)
    values (s, left(trim(p_name), 40), 'custom', p_open, case when p_pro_only then 'pro' else 'free' end, me)
    returning id into gid;
  insert into public.group_members (group_id, profile_id) values (gid, me) on conflict do nothing;
  return gid;
end $$;
revoke execute on function public.create_group(text, boolean, boolean) from anon;

-- Secrets the database uses to call its own functions (no policies: nobody reads this through the API)
create table if not exists public.app_secrets (k text primary key, v text not null);
alter table public.app_secrets enable row level security;

-- Push events: new PR and new programming call the push function
create extension if not exists pg_net;
create or replace function public.push_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare sec text; body jsonb;
begin
  select v into sec from public.app_secrets where k = 'push_hook';
  if sec is null then return new; end if;
  if tg_table_name = 'lift_entries' then
    if not new.is_pr or new.prev_best is null then return new; end if;
    body := jsonb_build_object('type', 'pr', 'entry_id', new.id);
  else
    body := jsonb_build_object('type', 'program', 'workout_id', new.id, 'day', new.day);
  end if;
  perform net.http_post(
    url := 'https://fairfhgyrosjqualmhwu.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dsi-hook', sec),
    body := body);
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists lift_entries_push on public.lift_entries;
create trigger lift_entries_push after insert on public.lift_entries
  for each row execute function public.push_event();
drop trigger if exists workouts_push on public.workouts;
create trigger workouts_push after insert on public.workouts
  for each row execute function public.push_event();

-- What the push function has sent, so a week of imported programming sends one push, not seven
create table if not exists public.push_log (
  id bigint generated always as identity primary key,
  kind text not null,
  ref text,
  sent int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.push_log enable row level security;
