-- App Store review requirements plus Pro building blocks

-- Terms acceptance (community rules must be accepted before posting)
alter table public.profiles add column if not exists terms_accepted_at timestamptz;

-- Pro check: paid tier or staff
create or replace function public.is_pro() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
    where user_id = auth.uid() and (public.tier_rank(tier) >= 1 or role in ('admin','commissioner')));
$$;
revoke execute on function public.is_pro() from public, anon;
grant execute on function public.is_pro() to authenticated;

-- Reports: anyone signed in can report a message, a lifter, a lift or a log
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('message','profile','lift_entry','workout_log')),
  target_id uuid not null,
  reason text not null check (char_length(reason) between 3 and 500),
  status text not null default 'open' check (status in ('open','actioned','dismissed')),
  handled_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
create index if not exists reports_open on public.reports (status, created_at desc);
alter table public.reports enable row level security;
create policy reports_file on public.reports for insert to authenticated with check (reporter = public.my_profile_id());
create policy reports_read on public.reports for select to authenticated
  using (reporter = public.my_profile_id() or public.has_role(array['admin','commissioner']));
create policy reports_handle on public.reports for update to authenticated
  using (public.has_role(array['admin','commissioner'])) with check (public.has_role(array['admin','commissioner']));

-- Reported messages are hidden from everyone but staff once reported twice
create or replace function public.reports_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.target_type = 'message' and
     (select count(distinct reporter) from public.reports where target_type = 'message' and target_id = new.target_id) >= 2 then
    update public.messages set deleted = true where id = new.target_id;
  end if;
  return new;
end $$;
drop trigger if exists reports_after_insert on public.reports;
create trigger reports_after_insert after insert on public.reports for each row execute function public.reports_after_insert();
revoke execute on function public.reports_after_insert() from public, anon, authenticated;

-- Blocks: private to the blocker
create table if not exists public.blocks (
  blocker uuid not null references public.profiles(id) on delete cascade,
  blocked uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
alter table public.blocks enable row level security;
create policy blocks_own on public.blocks for all to authenticated
  using (blocker = public.my_profile_id()) with check (blocker = public.my_profile_id());

-- Delete my account: removes the profile (and with it lifts, logs, goals, messages) and the login
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid(); pid uuid;
begin
  if uid is null then raise exception 'Sign in first'; end if;
  select id into pid from public.profiles where user_id = uid;
  perform set_config('dsi.sys','on',true);
  if pid is not null then
    update public.protests set ruled_by = null where ruled_by = pid;
    delete from public.profiles where id = pid;
  end if;
  delete from auth.users where id = uid;
end $$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Goals: optional target date for Pro goal plans
alter table public.goals add column if not exists target_date date;

-- Video on lifts (PR videos free, any set Pro; enforced in the app and storage policy)
alter table public.lift_entries add column if not exists video_path text check (char_length(video_path) <= 300);
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lift-videos','lift-videos', true, 104857600, array['video/mp4','video/quicktime','video/x-m4v'])
on conflict (id) do nothing;
create policy lift_videos_read on storage.objects for select using (bucket_id = 'lift-videos');
create policy lift_videos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'lift-videos' and (storage.foldername(name))[1] = public.my_profile_id()::text);
create policy lift_videos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'lift-videos' and (storage.foldername(name))[1] = public.my_profile_id()::text);

-- History import is Pro: only staff or Pro may insert source = 'import'
create or replace function public.lift_import_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'import' and not public.sys_on() and not public.is_pro() then
    raise exception 'History import is a DSI Pro feature';
  end if;
  return new;
end $$;
drop trigger if exists lift_import_guard on public.lift_entries;
create trigger lift_import_guard before insert on public.lift_entries for each row execute function public.lift_import_guard();
revoke execute on function public.lift_import_guard() from public, anon, authenticated;
