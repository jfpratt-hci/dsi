-- Applied to the Dandy Strength project on 2026-10-12 as migration 20261012213553 (gym_leads_texting_reputation).

-- Text line, leads and message threads, listings, reviews, social posts.

create table public.text_lines (
  gym_id uuid primary key references public.gyms(id) on delete cascade,
  phone_e164 text unique check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  provider text not null default 'twilio',
  provider_ref text,                         -- messaging service id
  registration_status text not null default 'not_started' check (registration_status in ('not_started','pending','approved','rejected')),
  forward_to text check (char_length(forward_to) <= 40),
  missed_call_textback boolean not null default true,
  after_hours_reply text check (char_length(after_hours_reply) <= 320),
  website_widget boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.text_lines enable row level security;
create trigger text_lines_touch before update on public.text_lines for each row execute function public.touch_updated_at();
create policy text_lines_read on public.text_lines for select to authenticated using (public.can_work_gym(gym_id));
create policy text_lines_manage on public.text_lines for all to authenticated
  using (public.can_manage_site(gym_id)) with check (public.can_manage_site(gym_id));
create or replace function public.text_lines_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.sys_on() or auth.uid() is null or public.is_platform_staff(new.gym_id) then return new; end if;
  if tg_op = 'INSERT' then new.phone_e164 := null; new.provider_ref := null; new.registration_status := 'not_started';
  else new.phone_e164 := old.phone_e164; new.provider := old.provider; new.provider_ref := old.provider_ref; new.registration_status := old.registration_status; end if;
  return new;
end $$;
create trigger text_lines_guard before insert or update on public.text_lines for each row execute function public.text_lines_guard();

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  name text check (char_length(name) <= 120),
  phone text check (char_length(phone) <= 40),
  email text check (char_length(email) <= 160),
  source text not null default 'website' check (source in ('website','text','missed_call','google','instagram','facebook','walk_in','referral','event','other')),
  interest text check (char_length(interest) <= 120),
  status text not null default 'new' check (status in ('new','talking','booked','joined','lost')),
  assigned_profile uuid references public.profiles(id) on delete set null,
  assigned_agent uuid references public.ai_agents(id) on delete set null,
  opted_out boolean not null default false,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.leads enable row level security;
create index leads_gym_status on public.leads (gym_id, status, last_message_at desc);
create trigger leads_touch before update on public.leads for each row execute function public.touch_updated_at();
create policy leads_staff on public.leads for all to authenticated
  using (public.can_work_gym(gym_id)) with check (public.can_work_gym(gym_id));

create table public.lead_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  gym_id uuid not null references public.gyms(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  channel text not null default 'sms' check (channel in ('sms','email','web','note')),
  body text not null check (char_length(body) between 1 and 2000),
  sent_by_profile uuid references public.profiles(id) on delete set null,
  sent_by_agent uuid references public.ai_agents(id) on delete set null,
  provider_ref text,
  status text not null default 'queued' check (status in ('draft','queued','sent','delivered','failed','received')),
  created_at timestamptz not null default now()
);
alter table public.lead_messages enable row level security;
create index lead_messages_lead on public.lead_messages (lead_id, created_at);
create policy lead_messages_read on public.lead_messages for select to authenticated using (public.can_work_gym(gym_id));
create policy lead_messages_send on public.lead_messages for insert to authenticated
  with check (public.can_work_gym(gym_id) and direction = 'out' and sent_by_profile = public.my_profile_id() and sent_by_agent is null and status in ('draft','queued'));

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  platform text not null check (platform in ('google','bing','apple','yelp','facebook','instagram','crossfit','website','tiktok','other')),
  url text check (char_length(url) <= 500),
  external_ref text,
  status text not null default 'unchecked' check (status in ('ok','mismatch','outdated','unclaimed','unchecked','update_sent')),
  issues jsonb not null default '[]'::jsonb,
  managed_by text not null default 'manual' check (managed_by in ('api','manual')),
  last_checked_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (gym_id, platform)
);
alter table public.listings enable row level security;
create trigger listings_touch before update on public.listings for each row execute function public.touch_updated_at();
create policy listings_read on public.listings for select to authenticated using (public.can_work_gym(gym_id));
create policy listings_manage on public.listings for all to authenticated
  using (public.can_manage_site(gym_id)) with check (public.can_manage_site(gym_id));

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  platform text not null check (platform in ('google','bing','apple','yelp','facebook','other')),
  external_ref text,
  author text check (char_length(author) <= 120),
  rating smallint check (rating between 1 and 5),
  body text check (char_length(body) <= 10000),
  posted_at timestamptz,
  reply_body text check (char_length(reply_body) <= 4000),
  reply_status text not null default 'none' check (reply_status in ('none','draft','approved','posted','failed')),
  replied_by_profile uuid references public.profiles(id) on delete set null,
  replied_by_agent uuid references public.ai_agents(id) on delete set null,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  unique (gym_id, platform, external_ref)
);
alter table public.reviews enable row level security;
create index reviews_gym_time on public.reviews (gym_id, posted_at desc);
create policy reviews_read on public.reviews for select to authenticated using (public.can_work_gym(gym_id));
create policy reviews_manage on public.reviews for update to authenticated
  using (public.can_manage_site(gym_id)) with check (public.can_manage_site(gym_id));

create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  channels text[] not null default '{instagram,facebook}',
  caption text not null default '' check (char_length(caption) <= 5000),
  media_paths text[] not null default '{}',
  scheduled_for timestamptz,
  status text not null default 'draft' check (status in ('draft','needs_approval','scheduled','posted','failed','canceled')),
  provider_refs jsonb not null default '{}'::jsonb,
  created_by_profile uuid references public.profiles(id) on delete set null,
  created_by_agent uuid references public.ai_agents(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.social_posts enable row level security;
create index social_posts_gym_time on public.social_posts (gym_id, scheduled_for);
create trigger social_posts_touch before update on public.social_posts for each row execute function public.touch_updated_at();
create policy social_posts_read on public.social_posts for select to authenticated using (public.can_work_gym(gym_id));
create policy social_posts_manage on public.social_posts for all to authenticated
  using (public.can_manage_site(gym_id)) with check (public.can_manage_site(gym_id));
