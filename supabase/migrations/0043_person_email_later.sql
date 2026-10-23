-- Add members and coaches without an email, and add the email later so they can sign in.
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
    insert into public.profiles (display_name, gym_id) values (case when n = 1 then base else left(base, 21) || ' ' || n end, case when p_role = 'member' then p_gym else null end) returning id into pid;
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
  end if;
  return jsonb_build_object('profile_id', pid, 'how', how, 'name', (select display_name from public.profiles where id = pid));
end $$;
revoke execute on function public.gym_add_person(uuid, text, text, text, text) from public, anon;
grant execute on function public.gym_add_person(uuid, text, text, text, text) to authenticated;

-- Who in the gym can sign in, and with what email (their login, or the email waiting for them).
create or replace function public.gym_login_status(p_gym uuid)
returns table (profile_id uuid, has_login boolean, email text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_gym_staff(p_gym) or public.has_role(array['admin'])) then raise exception 'Owners and coaches only.'; end if;
  return query
  select p.id, p.user_id is not null, coalesce(u.email::text, c.email::text)
  from public.profiles p left join auth.users u on u.id = p.user_id left join public.profile_claims c on c.profile_id = p.id
  where p.gym_id = p_gym or exists (select 1 from public.gym_staff s where s.gym_id = p_gym and s.profile_id = p.id);
end $$;
revoke execute on function public.gym_login_status(uuid) from public, anon;
grant execute on function public.gym_login_status(uuid) to authenticated;

-- Add or change the email a person will sign in with, before they have a login.
create or replace function public.gym_set_email(p_gym uuid, p_profile uuid, p_email text)
returns text language plpgsql security definer set search_path = public as $$
declare em text := lower(trim(coalesce(p_email, ''))); pr public.profiles;
begin
  if not (public.is_gym_owner(p_gym) or public.has_role(array['admin'])) then raise exception 'Only the gym owner or a Dandy admin can do this.'; end if;
  select * into pr from public.profiles where id = p_profile;
  if pr.id is null or not (pr.gym_id = p_gym or exists (select 1 from public.gym_staff s where s.gym_id = p_gym and s.profile_id = pr.id)) then raise exception 'They are not part of this gym.'; end if;
  if pr.user_id is not null then raise exception 'They already sign in with their own login.'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email does not look right.'; end if;
  if exists (select 1 from public.profiles p join auth.users u on u.id = p.user_id where lower(u.email) = em) then raise exception 'That email already has a Dandy login. Add them with that email instead.'; end if;
  if exists (select 1 from public.profile_claims where email = em and profile_id <> p_profile) then raise exception 'That email is already waiting on another profile.'; end if;
  insert into public.profile_claims (profile_id, email) values (p_profile, em) on conflict (profile_id) do update set email = excluded.email;
  insert into public.member_details (profile_id, email) values (p_profile, em) on conflict (profile_id) do update set email = excluded.email, updated_at = now();
  return em;
end $$;
revoke execute on function public.gym_set_email(uuid, uuid, text) from public, anon;
grant execute on function public.gym_set_email(uuid, uuid, text) to authenticated;
