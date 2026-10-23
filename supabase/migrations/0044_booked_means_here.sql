-- Everyone who books a class is counted as there. Coaches mark the ones who did not come as no shows.
-- When a class ends, bookings still marked booked become attended (that is what attendance, insights and levels read).
create or replace function public.mark_no_show(p_session uuid, p_profile uuid, p_no boolean) returns text
language plpgsql security definer set search_path = public as $$
declare s public.sessions; st text;
begin
  select * into s from public.sessions where id = p_session;
  if s.id is null or not public.is_gym_staff(s.gym_id) then raise exception 'Coaches only'; end if;
  st := case when p_no then 'no_show' when s.ends_at <= now() then 'attended' else 'booked' end;
  update public.bookings set status = st, checked_in_at = case when st = 'attended' then coalesce(checked_in_at, s.starts_at) else null end, updated_at = now()
    where session_id = p_session and profile_id = p_profile;
  if not found then raise exception 'They are not in this class.'; end if;
  return st;
end $$;
revoke all on function public.mark_no_show(uuid, uuid, boolean) from public, anon;
grant execute on function public.mark_no_show(uuid, uuid, boolean) to authenticated;

create or replace function public.close_finished_classes() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.bookings b set status = 'attended', checked_in_at = coalesce(b.checked_in_at, s.starts_at), updated_at = now()
  from public.sessions s
  where s.id = b.session_id and b.status = 'booked' and s.status <> 'canceled' and s.ends_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.close_finished_classes() from public, anon, authenticated;

select cron.unschedule('dsi-close-classes') where exists (select 1 from cron.job where jobname = 'dsi-close-classes');
select cron.schedule('dsi-close-classes', '*/10 * * * *', 'select public.close_finished_classes()');
select public.close_finished_classes();
