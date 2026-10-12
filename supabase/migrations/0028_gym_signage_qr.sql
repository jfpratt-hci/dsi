-- Applied to the Dandy Strength project on 2026-10-12 as migration 20261012221232 (gym_signage_qr).

-- DSI Signage: lobby screens, slides, and trackable QR links (dandy.fit/q/CODE).

create table public.qr_links (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-zA-Z0-9]{4,16}$'),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  label text not null check (char_length(trim(label)) between 2 and 80),
  target_kind text not null default 'url' check (target_kind in ('url','event','service','plan','product','review','text','page','website')),
  target_id uuid,
  target_url text not null check (char_length(target_url) <= 500),
  scans integer not null default 0,
  last_scan_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.qr_links enable row level security;
create policy qr_links_read on public.qr_links for select to authenticated using (public.can_work_gym(gym_id));
create policy qr_links_manage on public.qr_links for all to authenticated
  using (public.can_manage_site(gym_id)) with check (public.can_manage_site(gym_id));

create table public.qr_scans (
  id bigint generated always as identity primary key,
  link_id uuid not null references public.qr_links(id) on delete cascade,
  gym_id uuid not null references public.gyms(id) on delete cascade,
  screen_id uuid,
  scanned_at timestamptz not null default now(),
  device text check (char_length(device) <= 40)
);
alter table public.qr_scans enable row level security;
create index qr_scans_link_time on public.qr_scans (link_id, scanned_at desc);
create policy qr_scans_read on public.qr_scans for select to authenticated using (public.can_work_gym(gym_id));

create table public.signage_screens (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 60),
  location text check (char_length(location) <= 80),
  orientation text not null default 'landscape' check (orientation in ('landscape','portrait')),
  mode text not null default 'lobby' check (mode in ('lobby','class_board','mixed')),
  pairing_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  settings jsonb not null default '{"slide_seconds":12,"show_ticker":true,"show_clock":true}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.signage_screens enable row level security;
create policy signage_screens_read on public.signage_screens for select to authenticated using (public.can_work_gym(gym_id));
create policy signage_screens_manage on public.signage_screens for all to authenticated
  using (public.can_manage_site(gym_id)) with check (public.can_manage_site(gym_id));

alter table public.qr_scans add constraint qr_scans_screen_fk foreign key (screen_id) references public.signage_screens(id) on delete set null;

create table public.signage_slides (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  kind text not null check (kind in ('event','free_class','schedule','prs','leaderboard','product','plan','review_ask','text_us','announcement','image','video','custom')),
  ref_id uuid,                                -- event, product, plan or service it pulls from
  title text check (char_length(title) <= 120),
  body text check (char_length(body) <= 600),
  media_path text,
  qr_link_id uuid references public.qr_links(id) on delete set null,
  duration_s smallint not null default 12 check (duration_s between 4 and 120),
  starts_at timestamptz, ends_at timestamptz,
  screen_ids uuid[],                          -- null means every screen in the gym
  active boolean not null default true,
  sort smallint not null default 0,
  created_by_profile uuid references public.profiles(id) on delete set null,
  created_by_agent uuid references public.ai_agents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.signage_slides enable row level security;
create trigger signage_slides_touch before update on public.signage_slides for each row execute function public.touch_updated_at();
create policy signage_slides_read on public.signage_slides for select to authenticated using (public.can_work_gym(gym_id));
create policy signage_slides_manage on public.signage_slides for all to authenticated
  using (public.can_manage_site(gym_id)) with check (public.can_manage_site(gym_id));

-- What a paired TV plays. The pairing code is the screen's secret; the TV never signs in.
create or replace function public.signage_feed(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare sc public.signage_screens; tz text;
begin
  select * into sc from public.signage_screens where pairing_code = upper(p_code);
  if sc.id is null then return null; end if;
  update public.signage_screens set last_seen_at = now() where id = sc.id;
  select g.tz into tz from public.gyms g where g.id = sc.gym_id;
  return jsonb_build_object(
    'screen', jsonb_build_object('id', sc.id, 'name', sc.name, 'orientation', sc.orientation, 'mode', sc.mode, 'settings', sc.settings),
    'gym', (select jsonb_build_object('name', g.name, 'phone', g.phone, 'address', g.address, 'city', g.city, 'tz', g.tz) from public.gyms g where g.id = sc.gym_id),
    'brand', (select s.brand from public.gym_sites s where s.gym_id = sc.gym_id),
    'slides', coalesce((select jsonb_agg(jsonb_build_object('id', sl.id, 'kind', sl.kind, 'ref_id', sl.ref_id, 'title', sl.title, 'body', sl.body, 'media', sl.media_path, 'duration_s', sl.duration_s,
        'qr', (select jsonb_build_object('code', q.code, 'label', q.label) from public.qr_links q where q.id = sl.qr_link_id and q.active)) order by sl.sort)
      from public.signage_slides sl where sl.gym_id = sc.gym_id and sl.active
        and (sl.starts_at is null or sl.starts_at <= now()) and (sl.ends_at is null or sl.ends_at > now())
        and (sl.screen_ids is null or sc.id = any(sl.screen_ids))), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'price_cents', e.price_cents, 'capacity', e.capacity,
        'spots_left', case when e.capacity is null then null else greatest(0, e.capacity - (select count(*) from public.event_registrations r where r.event_id = e.id and r.status in ('pending','confirmed','attended'))) end) order by e.starts_at)
      from public.events e where e.gym_id = sc.gym_id and e.status = 'published' and e.starts_at > now()), '[]'::jsonb),
    'classes_today', coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'start_time', c.start_time, 'duration_min', c.duration_min, 'coach', p.display_name) order by c.start_time)
      from public.classes c left join public.profiles p on p.id = c.coach_id
      where c.gym_id = sc.gym_id and c.active and extract(dow from (now() at time zone coalesce(tz,'America/New_York')))::smallint = any(c.weekdays)), '[]'::jsonb),
    'prs_week', coalesce((select jsonb_agg(x) from (select jsonb_build_object('name', p.display_name, 'lift', le.lift, 'weight_lb', le.weight_lb, 'prev_lb', le.prev_best, 'on', le.performed_on) x
      from public.lift_entries le join public.profiles p on p.id = le.profile_id
      where p.gym_id = sc.gym_id and le.is_pr and le.performed_on > current_date - 7 order by le.performed_on desc limit 12) t), '[]'::jsonb)
  );
end $$;

-- Called by the dandy.fit/q/CODE redirect. Returns where to send the phone and counts the scan.
create or replace function public.qr_scan(p_code text, p_screen uuid default null, p_device text default null)
returns text language plpgsql security definer set search_path = public as $$
declare q public.qr_links;
begin
  select * into q from public.qr_links where code = p_code and active;
  if q.id is null then return null; end if;
  update public.qr_links set scans = scans + 1, last_scan_at = now() where id = q.id;
  insert into public.qr_scans (link_id, gym_id, screen_id, device) values (q.id, q.gym_id,
    case when p_screen is not null and exists (select 1 from public.signage_screens s where s.id = p_screen and s.gym_id = q.gym_id) then p_screen end,
    left(p_device, 40));
  return q.target_url;
end $$;

grant execute on function public.signage_feed(text) to anon, authenticated;
grant execute on function public.qr_scan(text, uuid, text) to anon, authenticated;

-- CFS starter screen, links and slides
do $$
declare g uuid := 'f41e6f69-f6a4-410b-9344-4b36d5345fa7'; l_free uuid; l_review uuid; l_text uuid; l_store uuid;
begin
  if not exists (select 1 from public.gyms where id = g) then return; end if;
  insert into public.signage_screens (gym_id, name, location, mode) values (g, 'Lobby TV', 'Front entrance', 'lobby');
  insert into public.qr_links (code, gym_id, label, target_kind, target_url) values ('cfsfree', g, 'Free intro class', 'service', 'https://dandystrength.com/cfs#book') returning id into l_free;
  insert into public.qr_links (code, gym_id, label, target_kind, target_url) values ('cfsreview', g, 'Google review', 'review', 'https://dandystrength.com/cfs/review') returning id into l_review;
  insert into public.qr_links (code, gym_id, label, target_kind, target_url) values ('cfstext', g, 'Text the gym', 'text', 'sms:+15138091452') returning id into l_text;
  insert into public.qr_links (code, gym_id, label, target_kind, target_url) values ('cfsstore', g, 'CFS store', 'website', 'https://dandystrength.com/cfs#store') returning id into l_store;
  insert into public.signage_slides (gym_id, kind, title, body, qr_link_id, sort) values
    (g, 'free_class', 'Bring a friend. First class is free.', 'Every workout scaled to every level.', l_free, 1),
    (g, 'schedule', 'Today at CFS', null, null, 2),
    (g, 'prs', 'PRs this week', null, null, 3),
    (g, 'review_ask', 'Love it here? Tell Milford.', 'A quick Google review helps more people find us.', l_review, 4),
    (g, 'product', 'New CFS gear', 'Order online, pick up at the front desk.', l_store, 5),
    (g, 'text_us', 'Questions? Text us.', null, l_text, 6);
end $$;
