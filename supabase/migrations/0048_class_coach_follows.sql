-- Coaches are assigned on the Schedule page. A new coach on a weekly class takes every upcoming class that had
-- the old coach or none, booked or not; a one off sub on a single class stays.
create or replace function public.classes_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.sessions s where s.class_id = old.id and s.starts_at > now()
    and not exists (select 1 from public.bookings b where b.session_id = s.id and b.status <> 'canceled');
  if tg_op = 'UPDATE' then
    update public.sessions s set name = new.name, capacity = new.capacity,
      coach_id = case when s.coach_id is null or s.coach_id is not distinct from old.coach_id then new.coach_id else s.coach_id end
      where s.class_id = new.id and s.starts_at > now();
    return new;
  end if;
  return old;
end $$;
