-- Removing people. Owners take a member off the gym: they leave the member list, their desk paid
-- memberships end today and their future class bookings are canceled. Their account, lifts, PRs and
-- past attendance stay, so the history and the Insights numbers do not change. Autopay must be
-- stopped first so nobody keeps getting charged by a gym they are no longer in.
-- Coaches can also take someone off a single class (added by mistake).

create or replace function public.remove_member(p_gym uuid, p_profile uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_gym_owner(p_gym) then raise exception 'Owners only'; end if;
  if not exists (select 1 from public.profiles where id = p_profile and gym_id = p_gym) then raise exception 'They are not a member of this gym'; end if;
  if exists (select 1 from public.memberships where gym_id = p_gym and profile_id = p_profile and status <> 'canceled' and stripe_subscription is not null) then
    raise exception 'Stop their autopay first, then remove them';
  end if;
  update public.memberships set status = 'canceled', end_date = least(coalesce(end_date, current_date), current_date), updated_at = now()
    where gym_id = p_gym and profile_id = p_profile and status <> 'canceled';
  update public.bookings b set status = 'canceled', updated_at = now()
    from public.sessions s
    where b.session_id = s.id and b.gym_id = p_gym and b.profile_id = p_profile and b.status in ('booked', 'waitlist') and s.starts_at > now();
  update public.profiles set gym_id = null where id = p_profile and gym_id = p_gym;
  return 'removed';
end $$;

create or replace function public.remove_from_class(p_session uuid, p_profile uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
declare s public.sessions;
begin
  select * into s from public.sessions where id = p_session;
  if s.id is null or not public.is_gym_staff(s.gym_id) then raise exception 'Coaches only'; end if;
  update public.bookings set status = 'canceled', checked_in_at = null, updated_at = now()
    where session_id = p_session and profile_id = p_profile;
  return 'canceled';
end $$;

revoke all on function public.remove_member(uuid, uuid) from public, anon;
revoke all on function public.remove_from_class(uuid, uuid) from public, anon;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.remove_from_class(uuid, uuid) to authenticated;
