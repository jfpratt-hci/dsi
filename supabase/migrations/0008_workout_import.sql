-- Commissioners can post the week too (import workouts tool)
drop policy if exists workouts_admin on public.workouts;
create policy workouts_staff on public.workouts for all to authenticated
  using (public.has_role(array['admin','commissioner'])) with check (public.has_role(array['admin','commissioner']));
