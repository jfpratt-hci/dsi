-- One website template for every gym. A gym's site is data, never a file:
--   gym_sites.content   copy blocks (section headings, pillars, programs, FAQ, about, directions note, text us quick replies)
--   site_coaches        the coaches shown on the site and in booking (no Dandy account needed; link one later)
--   classes.site_coach_id  who usually coaches each weekly class
--   plans.site_*        how a plan shows on the site (features, tag, per class line, order, shown or not)
--   gym_site_code.map_svg  a custom drawn map, DSI staff only (trusted markup, inlined by the template)
-- site_public(p_key) returns all of it in one call for the template and the Worker.

alter table public.gym_sites add column if not exists content jsonb not null default '{}'::jsonb;

create table if not exists public.site_coaches (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 80),
  title text check (char_length(title) <= 60),
  bio text check (char_length(bio) <= 1000),
  photo_path text check (char_length(photo_path) <= 300),
  profile_id uuid references public.profiles(id) on delete set null,
  books boolean not null default true,      -- can be booked for personal training on the site
  show boolean not null default true,
  sort smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists site_coaches_gym on public.site_coaches (gym_id, sort);
alter table public.site_coaches enable row level security;
drop trigger if exists site_coaches_touch on public.site_coaches;
create trigger site_coaches_touch before update on public.site_coaches for each row execute function public.touch_updated_at();
drop policy if exists site_coaches_public on public.site_coaches;
create policy site_coaches_public on public.site_coaches for select to anon, authenticated using (show or public.can_manage_site(gym_id));
drop policy if exists site_coaches_manage on public.site_coaches;
create policy site_coaches_manage on public.site_coaches for all to authenticated
  using (public.can_manage_site(gym_id)) with check (public.can_manage_site(gym_id));

alter table public.classes add column if not exists site_coach_id uuid references public.site_coaches(id) on delete set null;

alter table public.plans
  add column if not exists show_on_site boolean not null default true,
  add column if not exists site_features text[] not null default '{}',
  add column if not exists classes_per_month smallint check (classes_per_month between 1 and 99),
  add column if not exists site_per text check (char_length(site_per) <= 80),
  add column if not exists site_tag text check (char_length(site_tag) <= 30),
  add column if not exists featured boolean not null default false,
  add column if not exists site_sort smallint not null default 0;

alter table public.gym_site_code add column if not exists map_svg text not null default '' check (char_length(map_svg) <= 200000);

create or replace function public.site_public(p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare g uuid; s public.gym_sites; preview boolean;
begin
  g := public.site_gym_id(p_key);
  if g is null then return null; end if;
  select * into s from public.gym_sites where gym_id = g;
  preview := auth.uid() is not null and public.can_manage_site(g);
  if s.gym_id is null or (not s.published and not preview) then return null; end if;
  return jsonb_build_object(
    'preview', not s.published,
    'gym', (select jsonb_build_object('id', id, 'name', name, 'slug', slug, 'city', city, 'address', address, 'phone', phone, 'email', email, 'tz', tz, 'payments_ready', stripe_ready) from public.gyms where id = g),
    'site', to_jsonb(s) - 'updated_by',
    'code', (select jsonb_build_object('css', custom_css, 'head', custom_head, 'map_svg', map_svg) from public.gym_site_code where gym_id = g),
    'text_line', (select jsonb_build_object('phone', phone_e164, 'widget', website_widget) from public.text_lines where gym_id = g),
    'coaches', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'title', c.title, 'bio', c.bio, 'photo', c.photo_path, 'books', c.books) order by c.sort, c.name)
      from public.site_coaches c where c.gym_id = g and c.show), '[]'::jsonb),
    'classes', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'weekdays', c.weekdays, 'start_time', c.start_time, 'duration_min', c.duration_min, 'capacity', c.capacity,
        'coach', coalesce(sc.name, p.display_name)) order by c.start_time)
      from public.classes c left join public.site_coaches sc on sc.id = c.site_coach_id left join public.profiles p on p.id = c.coach_id
      where c.gym_id = g and c.active), '[]'::jsonb),
    'plans', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'description', description, 'price_cents', price_cents, 'interval', interval, 'commitment_months', commitment_months,
        'includes_pro', includes_pro, 'joinable', active, 'features', site_features, 'classes_per_month', classes_per_month, 'per', site_per, 'tag', site_tag, 'featured', featured) order by site_sort, price_cents)
      from public.plans where gym_id = g and show_on_site), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'slug', e.slug, 'description', e.description, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'location', e.location,
        'price_cents', e.price_cents, 'member_price_cents', e.member_price_cents, 'capacity', e.capacity, 'divisions', e.divisions, 'ask_shirt_size', e.ask_shirt_size,
        'spots_left', case when e.capacity is null then null else greatest(0, e.capacity - (select count(*) from public.event_registrations r where r.event_id = e.id and r.status in ('pending','confirmed','attended'))) end) order by e.starts_at)
      from public.events e where e.gym_id = g and e.status = 'published' and e.starts_at > now() - interval '1 day'), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'description', description, 'kind', kind, 'duration_min', duration_min, 'price_cents', price_cents, 'price_note', price_note, 'require_payment', require_payment) order by sort, name)
      from public.services where gym_id = g and active), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name, 'description', pr.description, 'price_cents', pr.price_cents, 'tag', pr.tag, 'images', pr.image_paths, 'ship_or_pickup', pr.ship_or_pickup,
        'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'size', v.size, 'color', v.color, 'price_cents', coalesce(v.price_cents, pr.price_cents)) order by v.sort) from public.product_variants v where v.product_id = pr.id and v.active), '[]'::jsonb)) order by pr.sort, pr.name)
      from public.products pr where pr.gym_id = g and pr.visible), '[]'::jsonb),
    'media', coalesce((select jsonb_agg(jsonb_build_object('path', path, 'kind', kind, 'alt', alt, 'tags', tags) order by created_at desc) from public.gym_media where gym_id = g), '[]'::jsonb),
    'pages', coalesce((select jsonb_agg(jsonb_build_object('slug', slug, 'title', title, 'body', body, 'in_nav', in_nav) order by sort) from public.site_pages where gym_id = g and published), '[]'::jsonb)
  );
end $$;
revoke all on function public.site_public(text) from public;
grant execute on function public.site_public(text) to anon, authenticated;

-- The Worker finds a gym from the address a visitor typed: a dandystrength.com subdomain or the gym's own domain.
create or replace function public.site_key_for_host(p_host text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(s.subdomain, g.slug) from public.gym_sites s join public.gyms g on g.id = s.gym_id
  where s.published and (s.custom_domain = lower(p_host) or s.custom_domain = lower(regexp_replace(p_host, '^www\.', '')))
  limit 1;
$$;
revoke all on function public.site_key_for_host(text) from public;
grant execute on function public.site_key_for_host(text) to anon, authenticated;
