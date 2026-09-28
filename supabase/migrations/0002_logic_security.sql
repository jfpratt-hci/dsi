-- Helpers
create or replace function public.my_profile_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.profiles where user_id = auth.uid()
$$;

create or replace function public.has_role(roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and role = any(roles))
$$;

create or replace function public.sys_on() returns boolean
language sql volatile as $$ select coalesce(current_setting('dsi.sys', true), '') = 'on' $$;

create or replace function public.tier_rank(t text) returns int
language sql stable set search_path = public as $$
  select coalesce((select sort from public.tiers where id = t), 0)
$$;

-- Division group sync
create or replace function public.sync_division(p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d text;
begin
  select division into d from public.profiles where id = p;
  delete from public.group_members gm using public.groups g
    where gm.group_id = g.id and gm.profile_id = p and g.kind = 'division' and g.slug <> d;
  insert into public.group_members (group_id, profile_id)
    select id, p from public.groups where slug in (d, 'everyone')
    on conflict do nothing;
end $$;

-- New auth user: claim a legacy profile by email, or create a fresh one
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  perform set_config('dsi.sys','on',true);
  select profile_id into pid from public.profile_claims where email = new.email;
  if pid is not null then
    update public.profiles set user_id = new.id, updated_at = now() where id = pid and user_id is null;
    delete from public.profile_claims where profile_id = pid;
  else
    insert into public.profiles (user_id) values (new.id) returning id into pid;
  end if;
  perform public.sync_division(pid);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Profile guard: members cannot change tier, role or ownership
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.sys_on() and not public.has_role(array['admin']) and auth.uid() is not null then
    new.tier := old.tier; new.role := old.role; new.user_id := old.user_id;
  end if;
  if new.sex = 'female' and old.sex <> 'female' and new.division = old.division then new.division := 'women'; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

create or replace function public.profiles_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.division is distinct from old.division then
    perform public.sync_division(new.id);
  end if;
  return new;
end $$;
create trigger profiles_after after insert or update of division on public.profiles
  for each row execute function public.profiles_after();

-- Lift entries: PR detection and field protection
create or replace function public.lift_entries_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare best numeric;
begin
  if tg_op = 'INSERT' then
    select max(weight_lb) into best from public.lift_entries
      where profile_id = new.profile_id and lift = new.lift and status <> 'struck';
    new.prev_best := best;
    new.is_pr := best is null or new.weight_lb > best;
    if not public.has_role(array['admin']) then new.status := 'ok'; end if;
  else
    if not public.sys_on() and not public.has_role(array['admin','commissioner']) then
      new.status := old.status; new.is_pr := old.is_pr; new.prev_best := old.prev_best;
      new.weight_lb := old.weight_lb; new.lift := old.lift; new.profile_id := old.profile_id;
    end if;
  end if;
  return new;
end $$;
create trigger lift_entries_before before insert or update on public.lift_entries
  for each row execute function public.lift_entries_before();

create or replace function public.workout_logs_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if not public.sys_on() and not public.has_role(array['admin','commissioner']) then new.status := old.status; new.profile_id := old.profile_id; end if;
    new.updated_at := now();
  else
    new.status := 'ok';
  end if;
  return new;
end $$;
create trigger workout_logs_before before insert or update on public.workout_logs
  for each row execute function public.workout_logs_before();

-- Protests
create or replace function public.protests_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('dsi.sys','on',true);
  if new.target_type = 'lift_entry' then
    update public.lift_entries set status = 'protested' where id = new.target_id and status = 'ok';
  else
    update public.workout_logs set status = 'protested' where id = new.target_id and status = 'ok';
  end if;
  return new;
end $$;
create trigger protests_after_insert after insert on public.protests
  for each row execute function public.protests_after_insert();

create or replace function public.rule_protest(p_protest uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare pr public.protests;
begin
  if not public.has_role(array['admin','commissioner']) then raise exception 'Only the Commissioner can rule'; end if;
  if p_decision not in ('upheld','struck') then raise exception 'Decision must be upheld or struck'; end if;
  select * into pr from public.protests where id = p_protest for update;
  if pr.id is null or pr.status <> 'open' then raise exception 'Protest not open'; end if;
  perform set_config('dsi.sys','on',true);
  update public.protests set status = p_decision, ruled_by = public.my_profile_id(), ruling_note = p_note, ruled_at = now() where id = p_protest;
  if p_decision = 'struck' then
    if pr.target_type = 'lift_entry' then update public.lift_entries set status = 'struck' where id = pr.target_id;
    else update public.workout_logs set status = 'struck' where id = pr.target_id; end if;
  elsif not exists (select 1 from public.protests where target_id = pr.target_id and status = 'open') then
    if pr.target_type = 'lift_entry' then update public.lift_entries set status = 'ok' where id = pr.target_id and status = 'protested';
    else update public.workout_logs set status = 'ok' where id = pr.target_id and status = 'protested'; end if;
  end if;
end $$;

-- Chat access
create or replace function public.can_access_room(p_room uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.chat_rooms; me public.profiles;
begin
  select * into me from public.profiles where user_id = auth.uid();
  if me.id is null then return false; end if;
  select * into r from public.chat_rooms where id = p_room;
  if r.id is null then return false; end if;
  if me.role in ('admin','commissioner') then return true; end if;
  if r.kind = 'group' then
    return exists (select 1 from public.group_members gm join public.groups g on g.id = gm.group_id
      where gm.group_id = r.group_id and gm.profile_id = me.id and public.tier_rank(me.tier) >= public.tier_rank(g.min_tier));
  end if;
  return true;
end $$;

create or replace function public.room_for(p_kind text, p_ref uuid, p_title text) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if public.my_profile_id() is null then raise exception 'Sign in first'; end if;
  if p_kind not in ('pr','workout','protest') then raise exception 'Bad room kind'; end if;
  select id into rid from public.chat_rooms where kind = p_kind and ref_id = p_ref;
  if rid is null then
    insert into public.chat_rooms (kind, ref_id, title) values (p_kind, p_ref, left(coalesce(p_title,'Thread'),80))
      on conflict (kind, ref_id) do nothing returning id into rid;
    if rid is null then select id into rid from public.chat_rooms where kind = p_kind and ref_id = p_ref; end if;
  end if;
  return rid;
end $$;

create or replace function public.groups_room() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.chat_rooms (kind, group_id, title) values ('group', new.id, new.name) on conflict do nothing;
  return new;
end $$;
create trigger groups_room after insert on public.groups for each row execute function public.groups_room();
insert into public.chat_rooms (kind, group_id, title) select 'group', id, name from public.groups on conflict do nothing;

-- Board view: best non struck lift per person, with PR history for the four board lifts
create or replace view public.board with (security_invoker = true) as
with best as (
  select distinct on (profile_id, lift) profile_id, lift, weight_lb, performed_on, prev_best, id as entry_id, status
  from public.lift_entries where status <> 'struck' and lift in ('bench','squat','deadlift','clean')
  order by profile_id, lift, weight_lb desc, performed_on asc
)
select p.id as profile_id, p.display_name as name, p.division, p.sex, p.bodyweight as bw,
  case when p.birth_year is null then null else extract(year from now())::int - p.birth_year end as age,
  p.roast_opt_in,
  max(b.weight_lb) filter (where b.lift='bench') as bench,
  max(b.weight_lb) filter (where b.lift='squat') as squat,
  max(b.weight_lb) filter (where b.lift='deadlift') as dead,
  max(b.weight_lb) filter (where b.lift='clean') as clean,
  max(b.performed_on) filter (where b.lift='bench') as bench_date,
  max(b.performed_on) filter (where b.lift='squat') as squat_date,
  max(b.performed_on) filter (where b.lift='deadlift') as dead_date,
  max(b.performed_on) filter (where b.lift='clean') as clean_date,
  max(b.prev_best) filter (where b.lift='bench') as bench_prev,
  max(b.prev_best) filter (where b.lift='squat') as squat_prev,
  max(b.prev_best) filter (where b.lift='deadlift') as dead_prev,
  max(b.prev_best) filter (where b.lift='clean') as clean_prev,
  bool_or(b.status = 'protested') as has_protest
from public.profiles p join best b on b.profile_id = p.id
where p.display_name is not null
group by p.id;

-- PR feed: every PR that was an improvement, newest first
create or replace view public.pr_feed with (security_invoker = true) as
select e.id, e.profile_id, p.display_name as name, e.lift, e.weight_lb, e.prev_best, e.performed_on, e.status, e.created_at
from public.lift_entries e join public.profiles p on p.id = e.profile_id
where e.is_pr and e.prev_best is not null and e.status <> 'struck'
order by e.performed_on desc, e.created_at desc;

-- Row level security
alter table public.tiers enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_claims enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.lift_entries enable row level security;
alter table public.goals enable row level security;
alter table public.workouts enable row level security;
alter table public.workout_logs enable row level security;
alter table public.protests enable row level security;
alter table public.chat_rooms enable row level security;
alter table public.messages enable row level security;

create policy tiers_read on public.tiers for select using (true);
create policy profiles_read on public.profiles for select using (true);
create policy profiles_update_own on public.profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy profiles_admin on public.profiles for all to authenticated using (public.has_role(array['admin'])) with check (public.has_role(array['admin']));
create policy groups_read on public.groups for select using (true);
create policy groups_admin on public.groups for all to authenticated using (public.has_role(array['admin'])) with check (public.has_role(array['admin']));
create policy gm_read on public.group_members for select to authenticated using (true);
create policy gm_join on public.group_members for insert to authenticated with check (
  profile_id = public.my_profile_id() and exists (select 1 from public.groups g where g.id = group_id and g.is_open and g.kind = 'custom'));
create policy gm_leave on public.group_members for delete to authenticated using (
  profile_id = public.my_profile_id() and exists (select 1 from public.groups g where g.id = group_id and g.kind = 'custom'));
create policy lifts_read on public.lift_entries for select using (true);
create policy lifts_insert_own on public.lift_entries for insert to authenticated with check (profile_id = public.my_profile_id());
create policy lifts_update on public.lift_entries for update to authenticated using (profile_id = public.my_profile_id() or public.has_role(array['admin','commissioner']));
create policy lifts_delete_own on public.lift_entries for delete to authenticated using (profile_id = public.my_profile_id() and status = 'ok');
create policy goals_read on public.goals for select using (true);
create policy goals_write on public.goals for all to authenticated using (profile_id = public.my_profile_id()) with check (profile_id = public.my_profile_id());
create policy workouts_read on public.workouts for select using (true);
create policy workouts_admin on public.workouts for all to authenticated using (public.has_role(array['admin'])) with check (public.has_role(array['admin']));
create policy logs_read on public.workout_logs for select using (true);
create policy logs_insert on public.workout_logs for insert to authenticated with check (profile_id = public.my_profile_id());
create policy logs_update on public.workout_logs for update to authenticated using (profile_id = public.my_profile_id() or public.has_role(array['admin','commissioner']));
create policy logs_delete on public.workout_logs for delete to authenticated using (profile_id = public.my_profile_id());
create policy protests_read on public.protests for select using (true);
create policy protests_file on public.protests for insert to authenticated with check (filed_by = public.my_profile_id());
create policy rooms_read on public.chat_rooms for select to authenticated using (public.can_access_room(id));
create policy msgs_read on public.messages for select to authenticated using (public.can_access_room(room_id));
create policy msgs_send on public.messages for insert to authenticated with check (profile_id = public.my_profile_id() and public.can_access_room(room_id));
create policy msgs_edit on public.messages for update to authenticated using (profile_id = public.my_profile_id() or public.has_role(array['admin','commissioner']));

grant select on public.board, public.pr_feed to anon, authenticated;
revoke execute on function public.rule_protest(uuid,text,text) from anon;
revoke execute on function public.room_for(text,uuid,text) from anon;

-- Realtime
alter publication supabase_realtime add table public.messages, public.lift_entries, public.workout_logs, public.protests;
