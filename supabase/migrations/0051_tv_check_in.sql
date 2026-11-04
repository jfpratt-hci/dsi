-- Dandy TV check in. A coach or owner signed in on the TV taps a member's tile to mark them attended for the class on now;
-- a second tap (confirmed) takes them back off. Soft change only: the booking is set to canceled, never deleted.
create or replace function public.tv_attend(p_session uuid, p_profile uuid, p_in boolean) returns text
language plpgsql security definer set search_path = public as $$
declare s public.sessions;
begin
  select * into s from public.sessions where id = p_session;
  if s.id is null or not public.is_gym_staff(s.gym_id) then raise exception 'Sign in on this TV as a coach to check people in.'; end if;
  if not exists (select 1 from public.profiles where id = p_profile and gym_id = s.gym_id) then raise exception 'They are not part of this gym.'; end if;
  if p_in then
    insert into public.bookings (session_id, gym_id, profile_id, status, checked_in_at) values (s.id, s.gym_id, p_profile, 'attended', now())
    on conflict (session_id, profile_id) do update set status = 'attended', checked_in_at = coalesce(public.bookings.checked_in_at, now()), updated_at = now();
    return 'attended';
  end if;
  update public.bookings set status = 'canceled', checked_in_at = null, updated_at = now() where session_id = p_session and profile_id = p_profile;
  return 'canceled';
end $$;
revoke all on function public.tv_attend(uuid, uuid, boolean) from public, anon;
grant execute on function public.tv_attend(uuid, uuid, boolean) to authenticated;
