-- Applied to the Dandy Strength project on 2026-10-15 (growth_prospects).
-- Growth engine: find independent gyms, audit their website, build a redesign preview on the Dandy template,
-- and reach out with a free audit. Staff (platform_staff or admin) work the pipeline; owners see only their
-- own audit and preview through unguessable slugs, and can claim the site or opt out.

create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  gym_name text not null,
  website text,
  city text,
  state text,
  owner_name text,
  owner_email text,
  phone text,
  instagram text,
  gym_type text,                         -- CrossFit, strength, functional fitness, boutique, ...
  source text not null default 'search', -- apollo, search, referral, manual
  source_ref text,                       -- Apollo person or org id, search query, ...
  status text not null default 'found' check (status in
    ('found','audited','drafted','approved','sent','opened','replied','claimed','meeting','won','lost','opted_out','skip')),
  facts jsonb not null default '{}'::jsonb,   -- what the audit observed on the site and on Google
  audit jsonb,                                -- computed from facts by growth_score()
  score int,
  grade text,
  brand jsonb not null default '{}'::jsonb,   -- name, short, tagline, bg, primary, accent, logo
  site jsonb,                                 -- redesign preview data in the Dandy template shape
  claim jsonb,                                -- what the owner sent from the audit page
  notes text,
  audited_at timestamptz,
  last_contact_at timestamptz,
  next_step_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists prospects_status_idx on public.prospects (status, next_step_at);
create unique index if not exists prospects_website_key on public.prospects (lower(regexp_replace(website, '^https?://(www\.)?|/+$', '', 'g'))) where website is not null;
comment on table public.prospects is 'Growth engine pipeline: independent gyms found, audited and contacted with a free site audit and redesign preview.';

create table if not exists public.outreach_messages (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  step int not null default 1,                -- 1 first touch, 2 and 3 follow ups
  channel text not null default 'email' check (channel in ('email','text','call','dm')),
  subject text,
  body text not null,
  status text not null default 'draft' check (status in ('draft','approved','sent','bounced','replied','skipped')),
  send_after timestamptz,
  sent_at timestamptz,
  provider_ref text,
  created_at timestamptz not null default now(),
  unique (prospect_id, step, channel)
);
comment on table public.outreach_messages is 'Outreach drafts and sends for prospects. Drafts wait for staff approval before sending.';

create table if not exists public.prospect_views (
  id bigint generated always as identity primary key,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  page text not null check (page in ('audit','preview')),
  viewed_at timestamptz not null default now()
);
create index if not exists prospect_views_p_idx on public.prospect_views (prospect_id, viewed_at desc);

create table if not exists public.email_optouts (
  email text primary key,
  reason text,
  created_at timestamptz not null default now()
);
comment on table public.email_optouts is 'Never email these addresses again. Checked before any outreach is drafted or sent.';

alter table public.prospects enable row level security;
alter table public.outreach_messages enable row level security;
alter table public.prospect_views enable row level security;
alter table public.email_optouts enable row level security;

drop policy if exists prospects_staff on public.prospects;
create policy prospects_staff on public.prospects for all to authenticated using (public.is_platform_staff()) with check (public.is_platform_staff());
drop policy if exists outreach_staff on public.outreach_messages;
create policy outreach_staff on public.outreach_messages for all to authenticated using (public.is_platform_staff()) with check (public.is_platform_staff());
drop policy if exists pviews_staff on public.prospect_views;
create policy pviews_staff on public.prospect_views for select to authenticated using (public.is_platform_staff());
drop policy if exists optouts_staff on public.email_optouts;
create policy optouts_staff on public.email_optouts for all to authenticated using (public.is_platform_staff()) with check (public.is_platform_staff());

-- Unguessable slug: gym name plus city plus 4 random characters.
create or replace function public.growth_slug(p_name text, p_city text)
returns text language sql volatile set search_path = public as $$
  select left(trim(both '-' from regexp_replace(lower(coalesce(p_name,'gym') || ' ' || coalesce(p_city,'')), '[^a-z0-9]+', '-', 'g')), 48)
         || '-' || substr(md5(gen_random_uuid()::text), 1, 4);
$$;

-- The audit score. Five areas worth 20 points each. Checks the audit could not confirm (null) are left out
-- and the score is scaled to what was checked, so a site is never marked down for something we could not see.
create or replace function public.growth_score(f jsonb, p_city text)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  rating numeric := nullif(f->>'google_rating','')::numeric;
  reviews int := nullif(f->>'google_reviews','')::int;
  yr int := nullif(f->>'copyright_year','')::int;
  title_city boolean := case when coalesce(f->>'title','') = '' or coalesce(p_city,'') = '' then null
                             else position(lower(p_city) in lower(f->>'title')) > 0 end;
  checks jsonb;
  c jsonb; got numeric := 0; possible numeric := 0; areas jsonb := '{}'::jsonb; fixes jsonb := '[]'::jsonb; wins jsonb := '[]'::jsonb;
  pts numeric; earned numeric; pass boolean; s int; g text;
begin
  checks := jsonb_build_array(
    -- area, key, points, pass, what we checked, why it matters, the fix
    jsonb_build_array('convert','free_trial',6, (f->>'free_trial_offer')::boolean, 'A free class or intro offer', 'Most new members start with a free class. Without an offer, visitors leave to compare gyms.', 'Lead with a free first class and make it the main button.'),
    jsonb_build_array('convert','offer_top',4, (f->>'offer_above_fold')::boolean, 'The offer is on the first screen', 'Half of visitors never scroll. The first screen has to say how to start.', 'Put "Book a free class" in the first screen on phones.'),
    jsonb_build_array('convert','booking',6, (f->>'online_booking')::boolean, 'Book online without calling', 'People shop gyms at night. If they cannot book then, they book somewhere that lets them.', 'Let visitors pick a class time and book in under a minute.'),
    jsonb_build_array('convert','pricing',4, (f->>'pricing_listed')::boolean, 'Prices or plans on the site', 'Hidden prices read as expensive. Showing a starting price brings in more trial bookings.', 'Show your plans, or at least a starting price.'),
    jsonb_build_array('respond','text',8, (f->>'text_or_chat')::boolean, 'Text or chat from the site', 'Leads answered in five minutes join far more often than leads answered tomorrow.', 'Add a "Text us" button that reaches a coach''s phone.'),
    jsonb_build_array('respond','call',6, (f->>'click_to_call')::boolean, 'Tap to call on phones', 'Most gym searches happen on a phone. A number you cannot tap is a lost call.', 'Make the phone number a tap to call link in the header.'),
    jsonb_build_array('respond','form',6, (f->>'lead_form')::boolean, 'A contact or trial form', 'Some people will not call or text. A short form catches them.', 'Add a three field form: name, phone, what they want.'),
    jsonb_build_array('found','title_city',5, title_city, 'Your city in the page title', 'Google and AI answers match "gym near me" searches on the page title first.', 'Put the gym type and city in the title, like "CrossFit in Milford, OH".'),
    jsonb_build_array('found','meta',4, case when f ? 'meta_description' then coalesce(f->>'meta_description','') <> '' else null end, 'A search description', 'Without one, Google writes its own snippet, usually a menu or a cookie notice.', 'Write a one line description that says who you are, where, and the free class.'),
    jsonb_build_array('found','ranks',7, (f->>'ranks_local')::boolean, 'Shows up when locals search for a gym', 'If you are not on the first page for your town, new members never see you.', 'Fix your Google profile, add a page per program, and earn local reviews.'),
    jsonb_build_array('found','h1',4, case when f ? 'h1' then coalesce(f->>'h1','') <> '' else null end, 'A clear main headline', 'The headline tells Google and AI tools what the page is about.', 'Use one headline that names what you do and where.'),
    jsonb_build_array('reputation','rating',10, case when rating is null then null else rating >= 4.7 end, 'Google rating of 4.7 or higher', 'People pick the gym with the better stars between two choices.', 'Ask happy members for a review right after a PR or a good class.'),
    jsonb_build_array('reputation','reviews',10, case when reviews is null then null else reviews >= 100 end, '100 or more Google reviews', 'Review count is one of the biggest factors in who shows up on the map.', 'Run a steady review ask: two to three new reviews a week.'),
    jsonb_build_array('modern','https',4, (f->>'https')::boolean, 'Secure site (https)', 'Browsers warn visitors away from sites that are not secure.', 'Turn on https. It is free with most hosts.'),
    jsonb_build_array('modern','mobile',4, (f->>'viewport')::boolean, 'Built for phones', 'Most visitors are on a phone. A desktop only page is hard to use and ranks lower.', 'Use a layout that fits phones first.'),
    jsonb_build_array('modern','schedule',4, (f->>'schedule_on_site')::boolean, 'Class schedule on the site', 'The schedule is the most visited page on a gym site.', 'Show this week''s classes, with a book button on each.'),
    jsonb_build_array('modern','sells',4, (f->>'sells_more')::boolean, 'Sells more to members', 'Events, personal training and gear are the easiest new revenue a gym has.', 'Add personal training, events and a small store to the site.'),
    jsonb_build_array('modern','fresh',4, case when yr is null then null else yr >= extract(year from now())::int - 1 end, 'Looks current', 'An old copyright year or stale news tells visitors the gym may not be active.', 'Keep the year, schedule and events current. Dandy does this automatically.')
  );
  for c in select * from jsonb_array_elements(checks) loop
    pts := (c->>2)::numeric;
    pass := case when c->>3 is null then null else (c->>3)::boolean end;
    if pass is null then continue; end if;
    earned := case when pass then pts
                   when c->>1 = 'rating' and rating >= 4.3 then round(pts * 0.6)
                   when c->>1 = 'reviews' and reviews >= 40 then round(pts * 0.6)
                   when c->>1 = 'reviews' and reviews >= 10 then round(pts * 0.3)
                   else 0 end;
    got := got + earned; possible := possible + pts;
    areas := jsonb_set(areas, array[c->>0], jsonb_build_object(
      'got', coalesce((areas->(c->>0)->>'got')::numeric, 0) + earned,
      'of', coalesce((areas->(c->>0)->>'of')::numeric, 0) + pts));
    if earned < pts then
      fixes := fixes || jsonb_build_object('area', c->>0, 'key', c->>1, 'points', pts - earned, 'check', c->>4, 'why', c->>5, 'fix', c->>6);
    else
      wins := wins || jsonb_build_object('area', c->>0, 'key', c->>1, 'check', c->>4);
    end if;
  end loop;
  if possible = 0 then return null; end if;
  s := round(got / possible * 100);
  g := case when s >= 85 then 'A' when s >= 70 then 'B' when s >= 55 then 'C' when s >= 40 then 'D' else 'F' end;
  select coalesce(jsonb_agg(x order by (x->>'points')::numeric desc), '[]'::jsonb) into fixes from jsonb_array_elements(fixes) x;
  return jsonb_build_object('score', s, 'grade', g, 'areas', areas, 'fixes', fixes, 'wins', wins,
    'checked', possible, 'google_rating', rating, 'google_reviews', reviews);
end $$;

create or replace function public.prospects_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' and coalesce(new.slug,'') = '' then new.slug := public.growth_slug(new.gym_name, new.city); end if;
  if new.facts is distinct from '{}'::jsonb and (tg_op = 'INSERT' or new.facts is distinct from old.facts or new.city is distinct from old.city) then
    new.audit := public.growth_score(new.facts, new.city);
    new.score := (new.audit->>'score')::int;
    new.grade := new.audit->>'grade';
    new.audited_at := now();
    if new.status = 'found' then new.status := 'audited'; end if;
  end if;
  if new.owner_email is not null and exists (select 1 from public.email_optouts o where o.email = lower(new.owner_email)) then
    new.status := 'opted_out';
  end if;
  return new;
end $$;
drop trigger if exists prospects_touch on public.prospects;
create trigger prospects_touch before insert or update on public.prospects for each row execute function public.prospects_touch();

-- Never queue a message to someone who opted out.
create or replace function public.outreach_guard()
returns trigger language plpgsql set search_path = public as $$
declare p public.prospects;
begin
  select * into p from public.prospects where id = new.prospect_id;
  if p.status = 'opted_out' or (p.owner_email is not null and exists (select 1 from public.email_optouts o where o.email = lower(p.owner_email))) then
    if new.status in ('draft','approved') then new.status := 'skipped'; end if;
  end if;
  if new.status = 'sent' and new.sent_at is null then new.sent_at := now(); end if;
  return new;
end $$;
drop trigger if exists outreach_guard on public.outreach_messages;
create trigger outreach_guard before insert or update on public.outreach_messages for each row execute function public.outreach_guard();
revoke execute on function public.prospects_touch() from public, anon, authenticated;
revoke execute on function public.outreach_guard() from public, anon, authenticated;

-- Public: the owner's audit page. Logs a view; first view moves a sent prospect to opened.
create or replace function public.growth_audit(p_slug text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.prospects;
begin
  select * into p from public.prospects where slug = p_slug and status not in ('opted_out','skip') and audit is not null;
  if not found then return null; end if;
  insert into public.prospect_views (prospect_id, page) values (p.id, 'audit');
  if p.status = 'sent' then update public.prospects set status = 'opened' where id = p.id; end if;
  return jsonb_build_object('slug', p.slug, 'gym_name', p.gym_name, 'city', p.city, 'state', p.state, 'website', p.website,
    'gym_type', p.gym_type, 'audit', p.audit, 'brand', p.brand, 'preview', p.site is not null, 'audited_at', p.audited_at,
    'claimed', p.claim is not null);
end $$;

-- Public: the redesign preview.
create or replace function public.growth_preview(p_slug text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.prospects;
begin
  select * into p from public.prospects where slug = p_slug and status not in ('opted_out','skip') and site is not null;
  if not found then return null; end if;
  insert into public.prospect_views (prospect_id, page) values (p.id, 'preview');
  if p.status = 'sent' then update public.prospects set status = 'opened' where id = p.id; end if;
  return jsonb_build_object('slug', p.slug, 'gym_name', p.gym_name, 'brand', p.brand, 'site', p.site, 'score', p.score);
end $$;

-- Public: the owner asks for the new site.
create or replace function public.growth_claim(p_slug text, p_name text, p_email text, p_phone text, p_note text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare p public.prospects;
begin
  if coalesce(trim(p_name),'') = '' or (coalesce(trim(p_email),'') = '' and length(regexp_replace(coalesce(p_phone,''), '\D', '', 'g')) < 10) then
    raise exception 'Add your name and an email or phone number.';
  end if;
  select * into p from public.prospects where slug = p_slug and status not in ('opted_out','skip');
  if not found then return false; end if;
  update public.prospects set status = case when status in ('won','meeting') then status else 'claimed' end,
    claim = jsonb_build_object('name', left(trim(p_name), 120), 'email', left(trim(coalesce(p_email,'')), 200),
      'phone', left(trim(coalesce(p_phone,'')), 40), 'note', left(trim(coalesce(p_note,'')), 1000), 'at', now()),
    next_step_at = now()
  where id = p.id;
  return true;
end $$;

-- Public: the owner opts out. Removes the pages and blocks the address forever.
create or replace function public.growth_opt_out(p_slug text)
returns boolean language plpgsql security definer set search_path = public as $$
declare p public.prospects;
begin
  select * into p from public.prospects where slug = p_slug;
  if not found then return false; end if;
  update public.prospects set status = 'opted_out' where id = p.id;
  if p.owner_email is not null then
    insert into public.email_optouts (email, reason) values (lower(p.owner_email), 'opted out from audit page') on conflict do nothing;
  end if;
  update public.outreach_messages set status = 'skipped' where prospect_id = p.id and status in ('draft','approved');
  return true;
end $$;

revoke execute on function public.growth_audit(text), public.growth_preview(text), public.growth_claim(text,text,text,text,text), public.growth_opt_out(text) from public;
grant execute on function public.growth_audit(text), public.growth_preview(text), public.growth_claim(text,text,text,text,text), public.growth_opt_out(text) to anon, authenticated;
grant execute on function public.growth_score(jsonb, text), public.growth_slug(text, text) to authenticated;
