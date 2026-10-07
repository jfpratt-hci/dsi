-- 0011 Gym side: owners and coaches run a gym page, post the gym's own daily workouts,
-- enter members' results at the gym, and put a live dashboard on the big screen (/tv/<gym id>).

-- Who runs each gym. Owners are approved by the Founder; owners add coaches.
create table if not exists public.gym_staff (
  gym_id uuid not null references public.gyms(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'coach' check (role in ('owner','coach')),
  created_at timestamptz not null default now(),
  primary key (gym_id, profile_id)
);
alter table public.gym_staff enable row level security;

create or replace function public.is_gym_staff(p_gym uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role(array['admin']) or exists (select 1 from public.gym_staff where gym_id = p_gym and profile_id = public.my_profile_id());
$$;
create or replace function public.is_gym_owner(p_gym uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role(array['admin']) or exists (select 1 from public.gym_staff where gym_id = p_gym and profile_id = public.my_profile_id() and role = 'owner');
$$;
revoke all on function public.is_gym_staff(uuid) from public, anon;
revoke all on function public.is_gym_owner(uuid) from public, anon;
grant execute on function public.is_gym_staff(uuid) to authenticated;
grant execute on function public.is_gym_owner(uuid) to authenticated;

create policy gym_staff_read on public.gym_staff for select using (true);
create policy gym_staff_add on public.gym_staff for insert to authenticated
  with check (public.has_role(array['admin']) or (role = 'coach' and public.is_gym_owner(gym_id)));
create policy gym_staff_remove on public.gym_staff for delete to authenticated
  using (public.has_role(array['admin']) or (role = 'coach' and public.is_gym_owner(gym_id)) or profile_id = public.my_profile_id());

-- Owners edit their gym's name and city.
create policy gyms_owner_update on public.gyms for update to authenticated using (public.is_gym_owner(id)) with check (public.is_gym_owner(id));

-- Claim a gym: a member asks to run it, the Founder approves.
create table if not exists public.gym_claims (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  note text check (char_length(note) <= 300),
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  created_at timestamptz not null default now()
);
create unique index if not exists gym_claims_once on public.gym_claims (gym_id, profile_id) where status = 'pending';
alter table public.gym_claims enable row level security;
create policy gym_claims_read on public.gym_claims for select to authenticated using (profile_id = public.my_profile_id() or public.has_role(array['admin']));
create policy gym_claims_insert on public.gym_claims for insert to authenticated with check (profile_id = public.my_profile_id() and status = 'pending');

create or replace function public.decide_gym_claim(p_id uuid, p_approve boolean) returns text
language plpgsql security definer set search_path = public as $$
declare c public.gym_claims;
begin
  if not public.has_role(array['admin']) then raise exception 'Only the Founder approves gym owners'; end if;
  select * into c from public.gym_claims where id = p_id for update;
  if c.id is null or c.status <> 'pending' then raise exception 'That request is already handled'; end if;
  update public.gym_claims set status = case when p_approve then 'approved' else 'declined' end where id = p_id;
  if p_approve then
    insert into public.gym_staff (gym_id, profile_id, role) values (c.gym_id, c.profile_id, 'owner')
      on conflict (gym_id, profile_id) do update set role = 'owner';
    update public.profiles set gym_id = c.gym_id where id = c.profile_id and gym_id is null;
  end if;
  return case when p_approve then 'approved' else 'declined' end;
end $$;
revoke all on function public.decide_gym_claim(uuid, boolean) from public, anon;
grant execute on function public.decide_gym_claim(uuid, boolean) to authenticated;

-- Gym programming lives next to the DSI week. A null gym_id is the DSI week; one workout per gym per day.
alter table public.workouts add column if not exists gym_id uuid references public.gyms(id) on delete cascade;
alter table public.workouts drop constraint if exists workouts_day_key;
alter table public.workouts drop constraint if exists workouts_gym_day_key;
alter table public.workouts add constraint workouts_gym_day_key unique nulls not distinct (gym_id, day);
create policy workouts_gym_staff on public.workouts for all to authenticated
  using (gym_id is not null and public.is_gym_staff(gym_id)) with check (gym_id is not null and public.is_gym_staff(gym_id));

-- Coaches enter results for their members on the gym's own workouts.
create or replace function public.coach_can_log(p_workout uuid, p_profile uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workouts w join public.profiles p on p.id = p_profile
    where w.id = p_workout and w.gym_id is not null and p.gym_id = w.gym_id and public.is_gym_staff(w.gym_id));
$$;
revoke all on function public.coach_can_log(uuid, uuid) from public, anon;
grant execute on function public.coach_can_log(uuid, uuid) to authenticated;
create policy logs_coach_insert on public.workout_logs for insert to authenticated with check (public.coach_can_log(workout_id, profile_id));
create policy logs_coach_update on public.workout_logs for update to authenticated using (public.coach_can_log(workout_id, profile_id));

-- Logging stays Pro for members; gym staff can always enter results on their gym's workouts.
create or replace function public.workout_logs_pro() returns trigger
language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  if public.sys_on() or public.is_pro() then return new; end if;
  select gym_id into g from public.workouts where id = new.workout_id;
  if g is not null and public.is_gym_staff(g) then return new; end if;
  raise exception 'Logging workouts is a DSI Pro feature';
end $$;
revoke execute on function public.workout_logs_pro() from public, anon, authenticated;
drop trigger if exists workout_logs_pro on public.workout_logs;
create trigger workout_logs_pro before insert or update on public.workout_logs
  for each row execute function public.workout_logs_pro();

-- New gym programming notifies that gym's members only (the push function reads gym_id).
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
    body := jsonb_build_object('type', 'program', 'workout_id', new.id, 'day', new.day, 'gym_id', new.gym_id);
  end if;
  perform net.http_post(
    url := 'https://fairfhgyrosjqualmhwu.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dsi-hook', sec),
    body := body);
  return new;
exception when others then
  return new;
end $$;
revoke execute on function public.push_event() from public, anon, authenticated;

-- Live dashboard: the big screen listens for new workouts too.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'workouts') then
    alter publication supabase_realtime add table public.workouts;
  end if;
end $$;
