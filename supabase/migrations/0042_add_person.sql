-- Gym owners and Dandy admins add a member or a staff member by name and email.
-- Someone who already has a Dandy login is linked right away. Anyone else gets a profile now that waits for them:
-- the first time they sign in with that email, it is theirs (profile_claims, see handle_new_user).
create or replace function public.gym_add_person(p_gym uuid, p_name text, p_email text, p_phone text default null, p_role text default 'member')
returns jsonb language plpgsql security definer set search_path = public as $$
declare em text := lower(trim(coalesce(p_email, ''))); nm text := trim(coalesce(p_name, '')); pid uuid; how text; base text; n int := 1; cur_gym uuid; prev text := coalesce(current_setting('dsi.sys', true), '');
begin
  if not (public.is_gym_owner(p_gym) or public.has_role(array['admin'])) then raise exception 'Only the gym owner or a Dandy admin can add people.'; end if;
  if p_role not in ('member', 'coach', 'owner') then raise exception 'Pick member, coach or owner.'; end if;
  if char_length(nm) < 2 or char_length(nm) > 60 then raise exception 'Type their name.'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Type a real email so they can sign in.'; end if;
  -- 1. They already have a login with this email.
  select p.id into pid from public.profiles p join auth.users u on u.id = p.user_id where lower(u.email) = em limit 1;
  if pid is not null then how := 'existing';
  else
    -- 2. A profile is already waiting for this email.
    select profile_id into pid from public.profile_claims where email = em;
    if pid is not null then how := 'waiting';
    else
      -- 3. New: a profile with their name, waiting for them to sign in.
      base := left(nm, 24);
      while exists (select 1 from public.profiles where lower(display_name) = lower(case when n = 1 then base else left(base, 21) || ' ' || n end)) loop n := n + 1; end loop;
      perform set_config('dsi.sys', 'on', true);
      insert into public.profiles (display_name, gym_id) values (case when n = 1 then base else left(base, 21) || ' ' || n end, case when p_role = 'member' then p_gym else null end) returning id into pid;
      perform set_config('dsi.sys', prev, true);
      insert into public.profile_claims (profile_id, email) values (pid, em);
      perform public.sync_division(pid);
      how := 'created';
    end if;
  end if;
  insert into public.member_details (profile_id, legal_name, email, phone) values (pid, nm, em, nullif(trim(coalesce(p_phone, '')), ''))
    on conflict (profile_id) do update set legal_name = coalesce(public.member_details.legal_name, excluded.legal_name), email = coalesce(public.member_details.email, excluded.email), phone = coalesce(public.member_details.phone, excluded.phone), updated_at = now();
  if p_role = 'member' then
    select gym_id into cur_gym from public.profiles where id = pid;
    if cur_gym is not null and cur_gym <> p_gym and not public.has_role(array['admin']) then raise exception 'That person is already a member of another gym.'; end if;
    perform set_config('dsi.sys', 'on', true);
    update public.profiles set gym_id = p_gym where id = pid;
    perform set_config('dsi.sys', prev, true);
  else
    if p_role = 'owner' and not (public.is_gym_owner(p_gym) or public.has_role(array['admin'])) then raise exception 'Only an owner can add an owner.'; end if;
    insert into public.gym_staff (gym_id, profile_id, role) values (p_gym, pid, p_role) on conflict (gym_id, profile_id) do update set role = excluded.role;
  end if;
  return jsonb_build_object('profile_id', pid, 'how', how, 'name', (select display_name from public.profiles where id = pid));
end $$;
revoke execute on function public.gym_add_person(uuid, text, text, text, text) from public, anon;
grant execute on function public.gym_add_person(uuid, text, text, text, text) to authenticated;
