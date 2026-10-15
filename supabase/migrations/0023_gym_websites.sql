-- Applied to the Dandy Strength project on 2026-10-12 as migration 20261012213451 (gym_websites).

-- Gym website settings (the only part that changes per gym), DSI only custom code, pages, media, public staff bios.

create table public.gym_sites (
  gym_id uuid primary key references public.gyms(id) on delete cascade,
  published boolean not null default false,
  template text not null default 'v1',
  brand jsonb not null default '{}'::jsonb,         -- name, short, tagline, bg, primary, accent, logo_path, fonts
  hero jsonb not null default '{}'::jsonb,          -- headline, sub, image_path
  announcement jsonb not null default '{}'::jsonb,  -- on, text, link
  hours jsonb not null default '[]'::jsonb,         -- [{label, text}]
  social jsonb not null default '{}'::jsonb,        -- ig, fb, tiktok, youtube
  sections jsonb not null default '{"schedule":true,"plans":true,"events":true,"book":true,"store":true,"coaches":true}'::jsonb,
  seo jsonb not null default '{}'::jsonb,           -- title, description, keywords
  links jsonb not null default '{}'::jsonb,         -- kilo, waiver, map
  subdomain text unique check (subdomain is null or subdomain ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$'),
  custom_domain citext unique check (custom_domain is null or char_length(custom_domain) <= 120),
  domain_status text not null default 'none' check (domain_status in ('none','pending','verifying','live','error')),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.gym_sites enable row level security;
create trigger gym_sites_touch before update on public.gym_sites for each row execute function public.touch_updated_at();
create policy gym_sites_public on public.gym_sites for select to anon using (published);
create policy gym_sites_read on public.gym_sites for select to authenticated using (published or public.can_manage_site(gym_id));
create policy gym_sites_manage on public.gym_sites for all to authenticated
  using (public.can_manage_site(gym_id)) with check (public.can_manage_site(gym_id));

-- Domains are set by the DSI team only (they need DNS and certificate work).
create or replace function public.gym_sites_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.sys_on() or auth.uid() is null or public.is_platform_staff(new.gym_id) then return new; end if;
  if tg_op = 'INSERT' then new.custom_domain := null; new.domain_status := 'none';
  else new.custom_domain := old.custom_domain; new.domain_status := old.domain_status; new.subdomain := old.subdomain; end if;
  return new;
end $$;
create trigger gym_sites_guard before insert or update on public.gym_sites for each row execute function public.gym_sites_guard();

-- Custom CSS and head code: readable by the site, editable only by the DSI team.
create table public.gym_site_code (
  gym_id uuid primary key references public.gyms(id) on delete cascade,
  custom_css text not null default '' check (char_length(custom_css) <= 100000),
  custom_head text not null default '' check (char_length(custom_head) <= 20000),
  notes text check (char_length(notes) <= 2000),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.gym_site_code enable row level security;
create trigger gym_site_code_touch before update on public.gym_site_code for each row execute function public.touch_updated_at();
create policy gym_site_code_public on public.gym_site_code for select to anon
  using (exists (select 1 from public.gym_sites s where s.gym_id = gym_site_code.gym_id and s.published));
create policy gym_site_code_read on public.gym_site_code for select to authenticated
  using (public.can_manage_site(gym_id) or exists (select 1 from public.gym_sites s where s.gym_id = gym_site_code.gym_id and s.published));
create policy gym_site_code_dsi on public.gym_site_code for all to authenticated
  using (public.is_platform_staff(gym_id, array['admin','manager','designer']))
  with check (public.is_platform_staff(gym_id, array['admin','manager','designer']));

create table public.site_pages (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$'),
  title text not null check (char_length(trim(title)) between 2 and 120),
  body text not null default '' check (char_length(body) <= 50000),  -- markdown
  published boolean not null default false,
  in_nav boolean not null default false,
  sort smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gym_id, slug)
);
alter table public.site_pages enable row level security;
create trigger site_pages_touch before update on public.site_pages for each row execute function public.touch_updated_at();
create policy site_pages_public on public.site_pages for select to anon using (published);
create policy site_pages_read on public.site_pages for select to authenticated using (published or public.can_manage_site(gym_id));
create policy site_pages_manage on public.site_pages for all to authenticated
  using (public.can_manage_site(gym_id)) with check (public.can_manage_site(gym_id));

create table public.gym_media (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  path text not null unique,               -- storage path in bucket gym-media, first folder = gym id
  kind text not null default 'image' check (kind in ('image','video','logo','mockup','document')),
  alt text check (char_length(alt) <= 200),
  tags text[] not null default '{}',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.gym_media enable row level security;
create policy gym_media_public on public.gym_media for select to anon, authenticated using (true);
create policy gym_media_manage on public.gym_media for all to authenticated
  using (public.can_manage_site(gym_id)) with check (public.can_manage_site(gym_id));

-- Public coach bios on the website
alter table public.gym_staff
  add column if not exists title text check (char_length(title) <= 60),
  add column if not exists bio text check (char_length(bio) <= 1000),
  add column if not exists photo_path text,
  add column if not exists show_on_site boolean not null default true,
  add column if not exists site_sort smallint not null default 0;
