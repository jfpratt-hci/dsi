-- Applied to the Dandy Strength project on 2026-10-12 as migration 20261012213427 (platform_staff_agents).

-- DSI platform team (people who manage gyms for owners), AI agents, a shared work queue and an activity log.

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$ begin new.updated_at := now(); return new; end $$;

create table public.platform_staff (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null default 'manager' check (role in ('admin','manager','designer','support')),
  gym_ids uuid[],               -- null means every gym
  active boolean not null default true,
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now()
);
alter table public.platform_staff enable row level security;

create or replace function public.is_platform_staff(p_gym uuid default null, p_roles text[] default null)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['admin']) or exists (
    select 1 from public.platform_staff s
    where s.profile_id = public.my_profile_id() and s.active
      and (p_roles is null or s.role = any(p_roles))
      and (s.gym_ids is null or p_gym is null or p_gym = any(s.gym_ids)));
$$;

create or replace function public.can_manage_site(p_gym uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_gym_owner(p_gym) or public.is_platform_staff(p_gym);
$$;

create or replace function public.can_work_gym(p_gym uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_gym_staff(p_gym) or public.is_platform_staff(p_gym);
$$;

create policy platform_staff_read on public.platform_staff for select to authenticated using (public.is_platform_staff());
create policy platform_staff_admin on public.platform_staff for all to authenticated
  using (public.has_role(array['admin'])) with check (public.has_role(array['admin']));

create table public.ai_agents (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 60),
  kind text not null check (kind in ('reviews','social','leads','listings','website','billing','support','general')),
  gym_id uuid references public.gyms(id) on delete cascade,  -- null means works across all gyms
  autonomy text not null default 'suggest' check (autonomy in ('suggest','approve','auto')),
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ai_agents enable row level security;
create trigger ai_agents_touch before update on public.ai_agents for each row execute function public.touch_updated_at();
create policy ai_agents_read on public.ai_agents for select to authenticated
  using (public.is_platform_staff(gym_id) or (gym_id is not null and public.is_gym_owner(gym_id)));
create policy ai_agents_admin on public.ai_agents for all to authenticated
  using (public.is_platform_staff(null, array['admin','manager'])) with check (public.is_platform_staff(null, array['admin','manager']));

create table public.work_items (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid references public.gyms(id) on delete cascade,
  kind text not null check (kind in ('lead','review','listing','post','website','event','order','billing','setup','support','other')),
  title text not null check (char_length(trim(title)) between 2 and 200),
  detail text check (char_length(detail) <= 4000),
  ref_table text, ref_id uuid,
  visibility text not null default 'gym' check (visibility in ('gym','dsi')),
  status text not null default 'open' check (status in ('open','in_progress','waiting','done','dismissed')),
  priority smallint not null default 2 check (priority between 1 and 4),
  assigned_profile uuid references public.profiles(id) on delete set null,
  assigned_agent uuid references public.ai_agents(id) on delete set null,
  due_at timestamptz,
  created_by_profile uuid references public.profiles(id) on delete set null,
  created_by_agent uuid references public.ai_agents(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.work_items enable row level security;
create index work_items_gym_status on public.work_items (gym_id, status);
create trigger work_items_touch before update on public.work_items for each row execute function public.touch_updated_at();
create policy work_items_read on public.work_items for select to authenticated
  using (public.is_platform_staff(gym_id) or (visibility = 'gym' and gym_id is not null and public.is_gym_staff(gym_id)));
create policy work_items_write on public.work_items for all to authenticated
  using (public.is_platform_staff(gym_id) or (visibility = 'gym' and gym_id is not null and public.is_gym_staff(gym_id)))
  with check (public.is_platform_staff(gym_id) or (visibility = 'gym' and gym_id is not null and public.is_gym_staff(gym_id)));

create table public.activity_log (
  id bigint generated always as identity primary key,
  gym_id uuid references public.gyms(id) on delete cascade,
  actor_profile uuid references public.profiles(id) on delete set null,
  actor_agent uuid references public.ai_agents(id) on delete set null,
  action text not null check (char_length(action) <= 80),
  target_table text, target_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.activity_log enable row level security;
create index activity_log_gym_time on public.activity_log (gym_id, created_at desc);
create policy activity_log_read on public.activity_log for select to authenticated
  using (public.is_platform_staff(gym_id) or (gym_id is not null and public.is_gym_owner(gym_id)));
create policy activity_log_insert on public.activity_log for insert to authenticated
  with check (actor_profile = public.my_profile_id() and actor_agent is null and (gym_id is null or public.can_work_gym(gym_id)));

revoke execute on function public.is_platform_staff(uuid, text[]) from public, anon;
revoke execute on function public.can_manage_site(uuid) from public, anon;
revoke execute on function public.can_work_gym(uuid) from public, anon;
grant execute on function public.is_platform_staff(uuid, text[]) to authenticated;
grant execute on function public.can_manage_site(uuid) to authenticated;
grant execute on function public.can_work_gym(uuid) to authenticated;
