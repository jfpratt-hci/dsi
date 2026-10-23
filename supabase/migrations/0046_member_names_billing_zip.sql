-- First and last name and a full billing address for every member. The billing ZIP goes to Stripe so cards are
-- checked against it (address verification), which gets the gym better card rates.
-- Owners (and Dandy admins) can edit every member field with gym_set_details.
alter table public.member_details
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists bill_line1 text,
  add column if not exists bill_city text,
  add column if not exists bill_state text,
  add column if not exists bill_zip text;
alter table public.member_details drop constraint if exists member_details_bill_zip_check;
alter table public.member_details add constraint member_details_bill_zip_check check (bill_zip is null or bill_zip ~ '^\d{5}(-\d{4})?$');

-- Split the legal name (or board name) people already have into first and last.
update public.member_details d set
  first_name = coalesce(d.first_name, split_part(trim(coalesce(nullif(d.legal_name, ''), p.display_name)), ' ', 1)),
  last_name = coalesce(d.last_name, nullif(trim(substr(trim(coalesce(nullif(d.legal_name, ''), p.display_name)), length(split_part(trim(coalesce(nullif(d.legal_name, ''), p.display_name)), ' ', 1)) + 1)), ''))
from public.profiles p where p.id = d.profile_id and d.first_name is null;

-- Legal name always follows first and last.
create or replace function public.member_details_name() returns trigger language plpgsql as $$
begin
  if coalesce(trim(new.first_name), '') <> '' or coalesce(trim(new.last_name), '') <> '' then
    new.first_name := nullif(trim(new.first_name), ''); new.last_name := nullif(trim(new.last_name), '');
    new.legal_name := trim(concat_ws(' ', new.first_name, new.last_name));
  end if;
  new.bill_zip := nullif(trim(new.bill_zip), '');
  return new;
end $$;
drop trigger if exists member_details_name on public.member_details;
create trigger member_details_name before insert or update on public.member_details for each row execute function public.member_details_name();

-- The owner edits everything about a member: names, contact, emergency contact, billing address, board name, birth year, bodyweight, sex.
drop function if exists public.gym_set_details(uuid, uuid, text, text, text, text, text, text, text);
create or replace function public.gym_set_details(p_gym uuid, p_profile uuid, p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare z text := nullif(trim(coalesce(p->>'bill_zip', '')), ''); dn text := nullif(trim(coalesce(p->>'display_name', '')), ''); yob int; bw numeric; sx text; prev text := coalesce(current_setting('dsi.sys', true), '');
  t text;
begin
  if not (public.is_gym_owner(p_gym) or public.has_role(array['admin'])) then raise exception 'Only the gym owner or a Dandy admin can change this.'; end if;
  if not exists (select 1 from public.profiles where id = p_profile and gym_id = p_gym) then raise exception 'They are not part of this gym.'; end if;
  if z is not null and z !~ '^\d{5}(-\d{4})?$' then raise exception 'Billing ZIP is 5 digits, like 45150, or ZIP+4 like 45150-1234.'; end if;
  t := nullif(trim(coalesce(p->>'email', '')), '');
  if t is not null and t !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email does not look right.'; end if;
  insert into public.member_details (profile_id, first_name, last_name, email, phone, emergency_name, emergency_phone, bill_line1, bill_city, bill_state, bill_zip)
  values (p_profile, nullif(trim(p->>'first_name'), ''), nullif(trim(p->>'last_name'), ''), lower(t), nullif(trim(p->>'phone'), ''), nullif(trim(p->>'emergency_name'), ''), nullif(trim(p->>'emergency_phone'), ''),
    nullif(trim(p->>'bill_line1'), ''), nullif(trim(p->>'bill_city'), ''), nullif(upper(trim(p->>'bill_state')), ''), z)
  on conflict (profile_id) do update set first_name = excluded.first_name, last_name = excluded.last_name, email = excluded.email, phone = excluded.phone,
    emergency_name = excluded.emergency_name, emergency_phone = excluded.emergency_phone,
    bill_line1 = excluded.bill_line1, bill_city = excluded.bill_city, bill_state = excluded.bill_state, bill_zip = excluded.bill_zip, updated_at = now();
  yob := case when (p->>'birth_year') ~ '^\d{4}$' then (p->>'birth_year')::int else null end;
  bw := case when (p->>'bodyweight') ~ '^\d+(\.\d+)?$' then (p->>'bodyweight')::numeric else null end;
  sx := case when p->>'sex' in ('male', 'female', 'unspecified') then p->>'sex' else null end;
  if yob is not null and (yob < 1920 or yob > 2015) then raise exception 'Birth year looks off.'; end if;
  if bw is not null and (bw < 80 or bw > 450) then raise exception 'Bodyweight is between 80 and 450 lb.'; end if;
  if dn is not null and exists (select 1 from public.profiles where lower(display_name) = lower(dn) and id <> p_profile) then raise exception 'That board name is taken. Pick another.'; end if;
  perform set_config('dsi.sys', 'on', true);
  update public.profiles set display_name = coalesce(dn, display_name), birth_year = coalesce(yob, birth_year), bodyweight = coalesce(bw, bodyweight), sex = coalesce(sx, sex) where id = p_profile;
  perform set_config('dsi.sys', prev, true);
  return 'saved';
end $$;
revoke all on function public.gym_set_details(uuid, uuid, jsonb) from public, anon;
grant execute on function public.gym_set_details(uuid, uuid, jsonb) to authenticated;
