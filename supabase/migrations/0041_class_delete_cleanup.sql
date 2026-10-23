-- Deleting a weekly class left its upcoming sessions behind: the foreign key cleared their class_id before the
-- after delete trigger looked for them, so the schedule showed two classes at the same time once the class was re-added.
-- The cleanup now runs before the delete. Duplicates already left behind were canceled (note: Duplicate of a weekly class).
drop trigger if exists classes_changed on public.classes;
create trigger classes_changed after update on public.classes for each row execute function public.classes_changed();
drop trigger if exists classes_removed on public.classes;
create trigger classes_removed before delete on public.classes for each row execute function public.classes_changed();
update public.sessions s set status = 'canceled', note = 'Duplicate of a weekly class'
where s.class_id is null and s.status = 'scheduled'
  and (exists (select 1 from public.sessions t where t.gym_id = s.gym_id and t.class_id is not null and t.starts_at = s.starts_at)
       or (s.starts_at >= now() and not exists (select 1 from public.bookings b where b.session_id = s.id and b.status in ('booked', 'waitlist', 'attended'))));
