-- Profile pictures. Square 512 px JPEGs (cropped and shrunk in the browser) in the public avatars bucket,
-- one folder per profile: <profile_id>/<time>.jpg. A member sets their own; the gym owner or a Dandy admin can set anyone's at their gym.
alter table public.profiles add column if not exists photo text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Who may change this profile's picture.
create or replace function public.can_set_photo(p_profile uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_profile = public.my_profile_id()
      or public.has_role(array['admin'])
      or exists (select 1 from public.profiles p where p.id = p_profile and p.gym_id is not null and public.is_gym_owner(p.gym_id));
$$;
revoke all on function public.can_set_photo(uuid) from public, anon;
grant execute on function public.can_set_photo(uuid) to authenticated;

create or replace function public.storage_profile(p_name text) returns uuid
language sql immutable as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(p_name, '/', 1)::uuid end;
$$;

drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select to public using (bucket_id = 'avatars');
drop policy if exists avatars_upload on storage.objects;
create policy avatars_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and public.can_set_photo(public.storage_profile(name)));
drop policy if exists avatars_remove on storage.objects;
create policy avatars_remove on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and public.can_set_photo(public.storage_profile(name)));

-- The picture only changes through set_photo, which checks the path belongs to that profile.
create or replace function public.profiles_photo_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.photo is distinct from old.photo and not (public.sys_on() or auth.uid() is null) then new.photo := old.photo; end if;
  return new;
end $$;
drop trigger if exists profiles_photo_guard on public.profiles;
create trigger profiles_photo_guard before update on public.profiles for each row execute function public.profiles_photo_guard();

create or replace function public.set_photo(p_profile uuid, p_path text) returns text
language plpgsql security definer set search_path = public as $$
declare prev text := coalesce(current_setting('dsi.sys', true), '');
begin
  if not public.can_set_photo(p_profile) then raise exception 'You can only change your own picture, or one at a gym you own.'; end if;
  if p_path is not null and (public.storage_profile(p_path) is distinct from p_profile or p_path !~ '^[0-9a-f-]{36}/[A-Za-z0-9_.-]{1,80}$') then raise exception 'That picture is not in the right place.'; end if;
  perform set_config('dsi.sys', 'on', true);
  update public.profiles set photo = p_path where id = p_profile;
  perform set_config('dsi.sys', prev, true);
  return p_path;
end $$;
revoke all on function public.set_photo(uuid, text) from public, anon;
grant execute on function public.set_photo(uuid, text) to authenticated;
