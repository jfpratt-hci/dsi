-- 0010 Compete and grow: gyms and the gym league, benchmark workouts, weekly head to head battles.
-- Seasons and the year recap are computed from lift_entries in the client, so they need no tables.

-- Gyms. Any member can add one and pick it on their profile. The league ranks gyms by their top lifters.
create table if not exists public.gyms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 3 and 60),
  city text check (char_length(city) <= 60),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists gyms_name_ci on public.gyms (lower(trim(name)));
alter table public.gyms enable row level security;
create policy gyms_read on public.gyms for select using (true);
create policy gyms_insert on public.gyms for insert to authenticated with check (created_by = public.my_profile_id());
create policy gyms_staff on public.gyms for all to authenticated using (public.has_role(array['admin','commissioner'])) with check (public.has_role(array['admin','commissioner']));

alter table public.profiles add column if not exists gym_id uuid references public.gyms(id) on delete set null;

-- Benchmarks: staff name a workout as a benchmark ("Fran", "Grace"). Every log of that benchmark ranks on its board.
alter table public.workouts add column if not exists benchmark text check (benchmark is null or char_length(benchmark) between 2 and 40);
create index if not exists workouts_benchmark on public.workouts (benchmark) where benchmark is not null;

-- Weekly battles: a Pro lifter challenges anyone for a Monday to Sunday week. Most DSI points gained that week wins.
create table if not exists public.battles (
  id uuid primary key default gen_random_uuid(),
  challenger uuid not null references public.profiles(id) on delete cascade,
  opponent uuid not null references public.profiles(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  trash_talk text check (char_length(trash_talk) <= 140),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (challenger <> opponent)
);
create index if not exists battles_week on public.battles (week_start desc);
create unique index if not exists battles_once on public.battles (least(challenger, opponent), greatest(challenger, opponent), week_start) where status in ('pending','accepted');
alter table public.battles enable row level security;
create policy battles_read on public.battles for select using (true);
create policy battles_insert on public.battles for insert to authenticated with check (
  challenger = public.my_profile_id() and public.is_pro() and status = 'pending'
  and week_start >= (date_trunc('week', (now() at time zone 'America/New_York'))::date)
  and week_start <= (date_trunc('week', (now() at time zone 'America/New_York'))::date + 28)
);

create or replace function public.respond_battle(p_id uuid, p_action text)
returns text language plpgsql security definer set search_path = public as $$
declare b public.battles; me uuid := public.my_profile_id();
begin
  select * into b from public.battles where id = p_id for update;
  if b.id is null then raise exception 'Battle not found'; end if;
  if b.status <> 'pending' then raise exception 'This battle is already %', b.status; end if;
  if p_action in ('accept','decline') then
    if b.opponent <> me then raise exception 'Only the lifter who was challenged can answer'; end if;
    if p_action = 'accept' and b.week_start + 6 < (now() at time zone 'America/New_York')::date then raise exception 'That week is over'; end if;
    update public.battles set status = case when p_action = 'accept' then 'accepted' else 'declined' end, responded_at = now() where id = p_id;
  elsif p_action = 'cancel' then
    if b.challenger <> me then raise exception 'Only the challenger can call it off'; end if;
    update public.battles set status = 'cancelled', responded_at = now() where id = p_id;
  else
    raise exception 'Unknown action';
  end if;
  return (select status from public.battles where id = p_id);
end $$;
revoke all on function public.respond_battle(uuid, text) from public, anon;
grant execute on function public.respond_battle(uuid, text) to authenticated;

-- Battle threads ("Talk" on a battle) use the same room_for path as PR, day and protest threads.
alter table public.chat_rooms drop constraint if exists chat_rooms_kind_check;
alter table public.chat_rooms add constraint chat_rooms_kind_check check (kind in ('group','pr','workout','protest','battle'));
create or replace function public.room_for(p_kind text, p_ref uuid, p_title text) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if public.my_profile_id() is null then raise exception 'Sign in first'; end if;
  if p_kind not in ('pr','workout','protest','battle') then raise exception 'Bad room kind'; end if;
  select id into rid from public.chat_rooms where kind = p_kind and ref_id = p_ref;
  if rid is null then
    insert into public.chat_rooms (kind, ref_id, title) values (p_kind, p_ref, left(coalesce(p_title,'Thread'),80))
      on conflict (kind, ref_id) do nothing returning id into rid;
    if rid is null then select id into rid from public.chat_rooms where kind = p_kind and ref_id = p_ref; end if;
  end if;
  return rid;
end $$;

-- Trigger functions do not need to be callable through the API.
revoke execute on function public.pro_only() from public, anon, authenticated;
revoke execute on function public.push_event() from public, anon, authenticated;
revoke execute on function public.thread_post_guard() from public, anon, authenticated;
revoke execute on function public.create_group(text, boolean, boolean) from public, anon;
grant execute on function public.create_group(text, boolean, boolean) to authenticated;
