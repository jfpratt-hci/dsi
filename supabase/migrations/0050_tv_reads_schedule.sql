-- Dandy TV runs signed out on some screens. It needs today's class times to run the class clock and the
-- real time marker across the top, so the class schedule is readable without a login, as on the gym's public website.
-- Approved by John Oct 29 2026.
drop policy if exists sessions_public_read on public.sessions;
create policy sessions_public_read on public.sessions for select to anon using (true);
