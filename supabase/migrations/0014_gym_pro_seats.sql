-- Gym plans that include DSI Pro.
-- A gym owner marks a plan "includes DSI Pro". While a member's membership on that plan is active,
-- the member is Pro (pro_source = 'gym'). When it ends, Pro ends too, unless they bought Pro themselves
-- (App Store) or the Founder granted it. The gym pays a per member seat for every one of these members.

alter table public.plans add column if not exists includes_pro boolean not null default false;

-- Recompute one member's gym granted Pro.
create or replace function public.sync_gym_pro(p_profile uuid) returns void
language plpgsql security definer set search_path = public as $$
declare has boolean; cur record;
begin
  select exists (
    select 1 from public.memberships m join public.plans pl on pl.id = m.plan_id
    where m.profile_id = p_profile and m.status = 'active' and pl.includes_pro
      and (m.end_date is null or m.end_date >= current_date)
  ) into has;
  select tier, pro_source into cur from public.profiles where id = p_profile;
  if not found then return; end if;
  perform set_config('dsi.sys', 'on', true);
  if has and cur.tier <> 'pro' then
    update public.profiles set tier = 'pro', pro_source = 'gym' where id = p_profile;
  elsif not has and cur.tier = 'pro' and cur.pro_source = 'gym' then
    update public.profiles set tier = 'free', pro_source = null where id = p_profile;
  end if;
  perform set_config('dsi.sys', '', true);
end $$;
revoke all on function public.sync_gym_pro(uuid) from public, anon, authenticated;

create or replace function public.memberships_gym_pro() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform public.sync_gym_pro(old.profile_id); end if;
  if tg_op in ('INSERT', 'UPDATE') then perform public.sync_gym_pro(new.profile_id); end if;
  return null;
end $$;
drop trigger if exists memberships_gym_pro on public.memberships;
create trigger memberships_gym_pro after insert or update or delete on public.memberships
  for each row execute function public.memberships_gym_pro();

-- Turning the switch on or off for a plan updates everyone on it.
create or replace function public.plans_gym_pro() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.includes_pro is distinct from old.includes_pro then
    for r in select distinct profile_id from public.memberships where plan_id = new.id loop
      perform public.sync_gym_pro(r.profile_id);
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists plans_gym_pro on public.plans;
create trigger plans_gym_pro after update on public.plans
  for each row execute function public.plans_gym_pro();

-- Seats for the owner's billing page: members currently Pro through this gym.
create or replace function public.gym_pro_seats(p_gym uuid) returns integer
language sql stable security definer set search_path = public as $$
  select case when public.is_gym_staff(p_gym) then (
    select count(distinct m.profile_id)::int from public.memberships m join public.plans pl on pl.id = m.plan_id
    where m.gym_id = p_gym and m.status = 'active' and pl.includes_pro and (m.end_date is null or m.end_date >= current_date)
  ) else null end
$$;
grant execute on function public.gym_pro_seats(uuid) to authenticated;

-- Gym owners who ask to come aboard from the homepage, with or without an account.
create table if not exists public.gym_leads (
  id uuid primary key default gen_random_uuid(),
  gym_name text not null check (char_length(trim(gym_name)) between 2 and 80),
  city text check (char_length(city) <= 80),
  contact_name text not null check (char_length(trim(contact_name)) between 2 and 80),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 160),
  phone text check (char_length(phone) <= 40),
  members integer check (members between 0 and 100000),
  current_software text check (char_length(current_software) <= 60),
  tier text check (tier in ('base','build','peak','unsure')),
  note text check (char_length(note) <= 1000),
  status text not null default 'new' check (status in ('new','contacted','won','lost')),
  created_at timestamptz not null default now()
);
alter table public.gym_leads enable row level security;
drop policy if exists gym_leads_insert on public.gym_leads;
create policy gym_leads_insert on public.gym_leads for insert to anon, authenticated with check (status = 'new');
drop policy if exists gym_leads_admin on public.gym_leads;
create policy gym_leads_admin on public.gym_leads for all to authenticated using (public.has_role(array['admin'])) with check (public.has_role(array['admin']));
grant insert on public.gym_leads to anon, authenticated;
grant select, update on public.gym_leads to authenticated;
