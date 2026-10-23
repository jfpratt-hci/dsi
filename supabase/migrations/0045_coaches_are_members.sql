-- Coaches and owners are members of their gym like anyone else, just another type, and they do not need a paid membership.
-- One list (profiles.gym_id) holds everyone; gym_staff says who is a coach or owner.

-- 1. Everyone who coaches or owns a gym is a member of it.
update public.profiles p set gym_id = s.gym_id from public.gym_staff s where s.profile_id = p.id and p.gym_id is null;

create or replace function public.gym_staff_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('dsi.sys', 'on', true);
  update public.profiles set gym_id = new.gym_id where id = new.profile_id and gym_id is null;
  return null;
end $$;
revoke all on function public.gym_staff_member() from public, anon, authenticated;
drop trigger if exists gym_staff_member on public.gym_staff;
create trigger gym_staff_member after insert on public.gym_staff for each row execute function public.gym_staff_member();

-- 2. Change someone's type: member, coach or owner. The gym always keeps at least one owner.
create or replace function public.gym_set_type(p_gym uuid, p_profile uuid, p_type text) returns text
language plpgsql security definer set search_path = public as $$
declare was text;
begin
  if not (public.is_gym_owner(p_gym) or public.has_role(array['admin'])) then raise exception 'Only the gym owner or a Dandy admin can change this.'; end if;
  if p_type not in ('member', 'coach', 'owner') then raise exception 'Pick member, coach or owner.'; end if;
  if not exists (select 1 from public.profiles where id = p_profile and gym_id = p_gym) and not exists (select 1 from public.gym_staff where gym_id = p_gym and profile_id = p_profile) then
    raise exception 'They are not part of this gym.'; end if;
  select role into was from public.gym_staff where gym_id = p_gym and profile_id = p_profile;
  if was = 'owner' and p_type <> 'owner' and not exists (select 1 from public.gym_staff where gym_id = p_gym and role = 'owner' and profile_id <> p_profile) then
    raise exception 'The gym needs at least one owner. Make someone else an owner first.'; end if;
  if p_type = 'member' then delete from public.gym_staff where gym_id = p_gym and profile_id = p_profile;
  else insert into public.gym_staff (gym_id, profile_id, role) values (p_gym, p_profile, p_type) on conflict (gym_id, profile_id) do update set role = excluded.role;
  end if;
  perform set_config('dsi.sys', 'on', true);
  update public.profiles set gym_id = p_gym where id = p_profile and gym_id is null;
  return p_type;
end $$;
revoke all on function public.gym_set_type(uuid, uuid, text) from public, anon;
grant execute on function public.gym_set_type(uuid, uuid, text) to authenticated;

-- 3. Removing someone from the gym also takes them off its coaches (never the last owner).
create or replace function public.remove_member(p_gym uuid, p_profile uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
begin
  if not (public.is_gym_owner(p_gym) or public.has_role(array['admin'])) then raise exception 'Owners only'; end if;
  if not exists (select 1 from public.profiles where id = p_profile and gym_id = p_gym) then raise exception 'They are not a member of this gym'; end if;
  if exists (select 1 from public.gym_staff where gym_id = p_gym and profile_id = p_profile and role = 'owner') and not exists (select 1 from public.gym_staff where gym_id = p_gym and role = 'owner' and profile_id <> p_profile) then
    raise exception 'The gym needs at least one owner. Make someone else an owner first.'; end if;
  if exists (select 1 from public.memberships where gym_id = p_gym and profile_id = p_profile and status <> 'canceled' and stripe_subscription is not null) then
    raise exception 'Stop their autopay first, then remove them';
  end if;
  update public.memberships set status = 'canceled', end_date = least(coalesce(end_date, current_date), current_date), updated_at = now()
    where gym_id = p_gym and profile_id = p_profile and status <> 'canceled';
  update public.bookings b set status = 'canceled', updated_at = now()
    from public.sessions s
    where b.session_id = s.id and b.gym_id = p_gym and b.profile_id = p_profile and b.status in ('booked', 'waitlist') and s.starts_at > now();
  delete from public.gym_staff where gym_id = p_gym and profile_id = p_profile;
  update public.profiles set gym_id = null where id = p_profile and gym_id = p_gym;
  return 'removed';
end $$;

-- 4. Adding a coach or owner makes them a member of the gym too.
create or replace function public.gym_add_person(p_gym uuid, p_name text, p_email text default null, p_phone text default null, p_role text default 'member')
returns jsonb language plpgsql security definer set search_path = public as $$
declare em text := lower(trim(coalesce(p_email, ''))); nm text := trim(coalesce(p_name, '')); pid uuid; how text; base text; n int := 1; cur_gym uuid; prev text := coalesce(current_setting('dsi.sys', true), '');
begin
  if not (public.is_gym_owner(p_gym) or public.has_role(array['admin'])) then raise exception 'Only the gym owner or a Dandy admin can add people.'; end if;
  if p_role not in ('member', 'coach', 'owner') then raise exception 'Pick member, coach or owner.'; end if;
  if char_length(nm) < 2 or char_length(nm) > 60 then raise exception 'Type their name.'; end if;
  if em <> '' and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email does not look right. Fix it or leave it blank for now.'; end if;
  if em <> '' then
    select p.id into pid from public.profiles p join auth.users u on u.id = p.user_id where lower(u.email) = em limit 1;
    if pid is not null then how := 'existing';
    else select profile_id into pid from public.profile_claims where email = em; if pid is not null then how := 'waiting'; end if;
    end if;
  end if;
  if pid is null then
    base := left(nm, 24);
    while exists (select 1 from public.profiles where lower(display_name) = lower(case when n = 1 then base else left(base, 21) || ' ' || n end)) loop n := n + 1; end loop;
    perform set_config('dsi.sys', 'on', true);
    insert into public.profiles (display_name, gym_id) values (case when n = 1 then base else left(base, 21) || ' ' || n end, p_gym) returning id into pid;
    perform set_config('dsi.sys', prev, true);
    if em <> '' then insert into public.profile_claims (profile_id, email) values (pid, em); end if;
    perform public.sync_division(pid);
    how := case when em <> '' then 'created' else 'no_email' end;
  end if;
  insert into public.member_details (profile_id, legal_name, email, phone) values (pid, nm, nullif(em, ''), nullif(trim(coalesce(p_phone, '')), ''))
    on conflict (profile_id) do update set legal_name = coalesce(public.member_details.legal_name, excluded.legal_name), email = coalesce(public.member_details.email, excluded.email), phone = coalesce(public.member_details.phone, excluded.phone), updated_at = now();
  if p_role = 'member' then
    select gym_id into cur_gym from public.profiles where id = pid;
    if cur_gym is not null and cur_gym <> p_gym and not public.has_role(array['admin']) then raise exception 'That person is already a member of another gym.'; end if;
    perform set_config('dsi.sys', 'on', true);
    update public.profiles set gym_id = p_gym where id = pid;
    perform set_config('dsi.sys', prev, true);
  else
    insert into public.gym_staff (gym_id, profile_id, role) values (p_gym, pid, p_role) on conflict (gym_id, profile_id) do update set role = excluded.role;
    perform set_config('dsi.sys', 'on', true);
    update public.profiles set gym_id = p_gym where id = pid and gym_id is null;
    perform set_config('dsi.sys', prev, true);
  end if;
  return jsonb_build_object('profile_id', pid, 'how', how, 'name', (select display_name from public.profiles where id = pid));
end $$;
revoke execute on function public.gym_add_person(uuid, text, text, text, text) from public, anon;
grant execute on function public.gym_add_person(uuid, text, text, text, text) to authenticated;

