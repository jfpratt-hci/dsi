-- Lift catalog: any lift can have PRs and goals. dsi_scored marks the four in the DSI score.
create table public.lifts (
  id text primary key,
  name text not null,
  category text not null check (category in ('squat','pull','press','olympic')),
  dsi_scored boolean not null default false,
  sort int not null default 100
);
insert into public.lifts (id, name, category, dsi_scored, sort) values
  ('bench','Bench press','press',true,1),
  ('squat','Back squat','squat',true,2),
  ('deadlift','Deadlift','pull',true,3),
  ('clean','Clean','olympic',true,4),
  ('front_squat','Front squat','squat',false,10),
  ('overhead_squat','Overhead squat','squat',false,11),
  ('snatch','Snatch','olympic',false,20),
  ('squat_snatch','Squat snatch','olympic',false,21),
  ('power_snatch','Power snatch','olympic',false,22),
  ('squat_clean','Squat clean','olympic',false,23),
  ('power_clean','Power clean','olympic',false,24),
  ('clean_and_jerk','Clean and jerk','olympic',false,25),
  ('jerk','Jerk','olympic',false,26),
  ('strict_press','Strict press','press',false,30),
  ('push_press','Push press','press',false,31),
  ('sumo_deadlift','Sumo deadlift','pull',false,32);
alter table public.lifts enable row level security;
create policy lifts_catalog_read on public.lifts for select using (true);
create policy lifts_catalog_admin on public.lifts for all to authenticated using (public.has_role(array['admin'])) with check (public.has_role(array['admin']));

alter table public.lift_entries drop constraint if exists lift_entries_lift_check;
alter table public.lift_entries add constraint lift_entries_lift_fk foreign key (lift) references public.lifts(id);
alter table public.goals drop constraint if exists goals_lift_check;
alter table public.goals add constraint goals_lift_fk foreign key (lift) references public.lifts(id);

create or replace view public.lift_bests with (security_invoker = true) as
select distinct on (e.profile_id, e.lift) e.profile_id, p.display_name as name, e.lift, l.name as lift_name, e.weight_lb, e.performed_on, e.prev_best
from public.lift_entries e join public.profiles p on p.id = e.profile_id join public.lifts l on l.id = e.lift
where e.status <> 'struck' and p.display_name is not null
order by e.profile_id, e.lift, e.weight_lb desc, e.performed_on asc;
grant select on public.lift_bests to anon, authenticated;
grant select on public.lifts to anon, authenticated;
