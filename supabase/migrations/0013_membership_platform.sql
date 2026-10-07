-- 0013 Membership platform for gyms: class schedule and signups, check in and attendance,
-- coach staffing (availability, swaps, pay), waivers and membership contracts with signatures,
-- membership plans, memberships and invoices (paid online through Stripe or marked paid at the desk).

create extension if not exists pgcrypto with schema extensions;

-- Gym settings used by the office
alter table public.gyms add column if not exists tz text not null default 'America/New_York';
alter table public.gyms add column if not exists address text check (char_length(address) <= 200);
alter table public.gyms add column if not exists phone text check (char_length(phone) <= 40);
alter table public.gyms add column if not exists email text check (char_length(email) <= 120);
alter table public.gyms add column if not exists stripe_account text;
alter table public.gyms add column if not exists stripe_ready boolean not null default false;

-- Coach pay
alter table public.gym_staff add column if not exists pay_type text not null default 'class' check (pay_type in ('class','hour'));
alter table public.gym_staff add column if not exists pay_rate numeric(8,2) check (pay_rate >= 0 and pay_rate < 10000);
drop policy if exists gym_staff_owner_update on public.gym_staff;
create policy gym_staff_owner_update on public.gym_staff for update to authenticated
  using (public.is_gym_owner(gym_id)) with check (public.is_gym_owner(gym_id));

-- Private member details a gym needs (phone, emergency contact). The member and their gym's staff only.
create table if not exists public.member_details (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  legal_name text check (char_length(legal_name) <= 120),
  email text check (char_length(email) <= 160),
  phone text check (char_length(phone) <= 40),
  emergency_name text check (char_length(emergency_name) <= 120),
  emergency_phone text check (char_length(emergency_phone) <= 40),
  updated_at timestamptz not null default now()
);
alter table public.member_details enable row level security;
create policy md_own on public.member_details for all to authenticated
  using (profile_id = public.my_profile_id()) with check (profile_id = public.my_profile_id());
create policy md_staff_read on public.member_details for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = profile_id and p.gym_id is not null and public.is_gym_staff(p.gym_id)));

/* ---------- schedule ---------- */
-- A class is a weekly template; sessions are the dated classes members book.
create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 60),
  weekdays smallint[] not null check (array_length(weekdays, 1) between 1 and 7), -- 0 Sunday .. 6 Saturday
  start_time time not null,
  duration_min smallint not null default 60 check (duration_min between 10 and 300),
  capacity smallint not null default 16 check (capacity between 1 and 500),
  coach_id uuid references public.profiles(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.classes enable row level security;
create policy classes_read on public.classes for select to authenticated using (true);
create policy classes_owner on public.classes for all to authenticated using (public.is_gym_owner(gym_id)) with check (public.is_gym_owner(gym_id));

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  class_id uuid references public.classes(id) on delete set null,
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity smallint not null,
  coach_id uuid references public.profiles(id) on delete set null,
  status text not null default 'scheduled' check (status in ('scheduled','canceled')),
  note text check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  unique (class_id, starts_at)
);
create index if not exists sessions_gym_time on public.sessions (gym_id, starts_at);
alter table public.sessions enable row level security;
create policy sessions_read on public.sessions for select to authenticated using (true);
create policy sessions_staff on public.sessions for all to authenticated using (public.is_gym_staff(gym_id)) with check (public.is_gym_staff(gym_id));

-- Fill in dated sessions from the weekly templates (idempotent). Anyone signed in can ask; it only follows the templates.
create or replace function public.ensure_sessions(p_gym uuid, p_from date, p_to date) returns integer
language plpgsql security definer set search_path = public as $$
declare tz text; n integer := 0; d date; c record;
begin
  if p_to < p_from or p_to - p_from > 62 then raise exception 'Pick up to two months'; end if;
  select g.tz into tz from public.gyms g where g.id = p_gym;
  if tz is null then raise exception 'No gym here'; end if;
  for c in select * from public.classes where gym_id = p_gym and active loop
    d := p_from;
    while d <= p_to loop
      if extract(dow from d)::smallint = any (c.weekdays) then
        insert into public.sessions (gym_id, class_id, name, starts_at, ends_at, capacity, coach_id)
        values (p_gym, c.id, c.name, (d + c.start_time) at time zone tz, (d + c.start_time) at time zone tz + make_interval(mins => c.duration_min), c.capacity, c.coach_id)
        on conflict (class_id, starts_at) do nothing;
        if found then n := n + 1; end if;
      end if;
      d := d + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.ensure_sessions(uuid, date, date) from public, anon;
grant execute on function public.ensure_sessions(uuid, date, date) to authenticated;

-- When a template changes, future sessions nobody has booked are rebuilt from it.
create or replace function public.classes_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.sessions s where s.class_id = old.id and s.starts_at > now()
    and not exists (select 1 from public.bookings b where b.session_id = s.id and b.status <> 'canceled');
  if tg_op = 'UPDATE' then
    update public.sessions s set name = new.name, capacity = new.capacity, coach_id = coalesce(s.coach_id, new.coach_id)
      where s.class_id = new.id and s.starts_at > now();
    return new;
  end if;
  return old;
end $$;

/* ---------- bookings and attendance ---------- */
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  gym_id uuid not null references public.gyms(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'booked' check (status in ('booked','waitlist','canceled','attended','no_show')),
  checked_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, profile_id)
);
create index if not exists bookings_profile on public.bookings (profile_id, created_at desc);
alter table public.bookings enable row level security;
-- Members see who is coming to a class (names only through profiles); staff see everything for their gym.
create policy bookings_read on public.bookings for select to authenticated using (true);
create policy bookings_staff on public.bookings for all to authenticated using (public.is_gym_staff(gym_id)) with check (public.is_gym_staff(gym_id));

drop trigger if exists classes_changed on public.classes;
create trigger classes_changed after update or delete on public.classes for each row execute function public.classes_changed();

/* ---------- waivers and contracts ---------- */
create table if not exists public.gym_docs (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  kind text not null check (kind in ('waiver','contract')),
  title text not null check (char_length(title) between 3 and 120),
  body text not null check (char_length(body) between 50 and 40000),
  version integer not null default 1,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.gym_docs enable row level security;
create policy gym_docs_read on public.gym_docs for select to authenticated using (true);
create policy gym_docs_owner_insert on public.gym_docs for insert to authenticated with check (public.is_gym_owner(gym_id));
-- A new version retires the old one; a signed version's words never change.
create or replace function public.gym_docs_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    select coalesce(max(version), 0) + 1 into new.version from public.gym_docs where gym_id = new.gym_id and kind = new.kind;
    new.created_by := public.my_profile_id();
    update public.gym_docs set active = false where gym_id = new.gym_id and kind = new.kind and active;
    new.active := true;
  end if;
  return new;
end $$;
drop trigger if exists gym_docs_before on public.gym_docs;
create trigger gym_docs_before before insert on public.gym_docs for each row execute function public.gym_docs_before();

create table if not exists public.doc_signatures (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references public.gym_docs(id) on delete restrict,
  gym_id uuid not null references public.gyms(id) on delete cascade,
  kind text not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  signed_name text not null check (char_length(trim(signed_name)) between 3 and 120),
  signature text not null check (char_length(signature) between 100 and 200000), -- drawn signature as a PNG data URL
  agreed boolean not null check (agreed),
  body_sha256 text not null,
  user_agent text check (char_length(user_agent) <= 400),
  context jsonb not null default '{}'::jsonb, -- plan, price and terms shown when a contract was signed
  signed_at timestamptz not null default now(),
  unique (doc_id, profile_id)
);
alter table public.doc_signatures enable row level security;
create policy sigs_read on public.doc_signatures for select to authenticated using (profile_id = public.my_profile_id() or public.is_gym_staff(gym_id));
create policy sigs_insert on public.doc_signatures for insert to authenticated with check (profile_id = public.my_profile_id());
-- Signatures are permanent: no update or delete policies. The server stamps what was signed.
create or replace function public.doc_signatures_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare d public.gym_docs;
begin
  select * into d from public.gym_docs where id = new.doc_id;
  if d.id is null or not d.active then raise exception 'That document is no longer current. Reload and sign the latest one.'; end if;
  new.gym_id := d.gym_id; new.kind := d.kind; new.signed_at := now();
  new.body_sha256 := encode(extensions.digest(d.body, 'sha256'), 'hex');
  return new;
end $$;
drop trigger if exists doc_signatures_before on public.doc_signatures;
create trigger doc_signatures_before before insert on public.doc_signatures for each row execute function public.doc_signatures_before();

-- Has this member signed the gym's current waiver?
create or replace function public.has_signed(p_gym uuid, p_kind text, p_profile uuid default null) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.gym_docs where gym_id = p_gym and kind = p_kind and active)
    or exists (select 1 from public.doc_signatures s join public.gym_docs d on d.id = s.doc_id
      where d.gym_id = p_gym and d.kind = p_kind and d.active and s.profile_id = coalesce(p_profile, public.my_profile_id()));
$$;
revoke all on function public.has_signed(uuid, text, uuid) from public, anon;
grant execute on function public.has_signed(uuid, text, uuid) to authenticated;

/* ---------- booking rules ---------- */
create or replace function public.book_session(p_session uuid) returns text
language plpgsql security definer set search_path = public as $$
declare s public.sessions; me uuid := public.my_profile_id(); taken integer; st text; cur public.bookings;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select * into s from public.sessions where id = p_session for update;
  if s.id is null or s.status <> 'scheduled' then raise exception 'That class is not running'; end if;
  if s.ends_at < now() then raise exception 'That class is over'; end if;
  if not exists (select 1 from public.profiles where id = me and gym_id = s.gym_id) and not public.is_gym_staff(s.gym_id) then
    raise exception 'Join this gym first (Gym league page) to book its classes';
  end if;
  if not public.has_signed(s.gym_id, 'waiver', me) then raise exception 'Sign the waiver first'; end if;
  select * into cur from public.bookings where session_id = s.id and profile_id = me;
  if cur.id is not null and cur.status in ('booked','attended','waitlist') then return cur.status; end if;
  select count(*) into taken from public.bookings where session_id = s.id and status in ('booked','attended');
  st := case when taken < s.capacity then 'booked' else 'waitlist' end;
  insert into public.bookings (session_id, gym_id, profile_id, status) values (s.id, s.gym_id, me, st)
    on conflict (session_id, profile_id) do update set status = excluded.status, created_at = now(), updated_at = now(), checked_in_at = null;
  return st;
end $$;

create or replace function public.cancel_booking(p_session uuid) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_profile_id(); b public.bookings; s public.sessions; nxt uuid;
begin
  select * into b from public.bookings where session_id = p_session and profile_id = me for update;
  if b.id is null or b.status = 'canceled' then return 'canceled'; end if;
  if b.status = 'attended' then raise exception 'You already checked in to that class'; end if;
  update public.bookings set status = 'canceled', updated_at = now() where id = b.id;
  -- The first person on the waitlist gets the spot.
  if b.status = 'booked' then
    select * into s from public.sessions where id = p_session;
    select id into nxt from public.bookings where session_id = p_session and status = 'waitlist' order by created_at limit 1;
    if nxt is not null and s.starts_at > now() then update public.bookings set status = 'booked', updated_at = now() where id = nxt; end if;
  end if;
  return 'canceled';
end $$;

-- Front desk: staff check a member in (or out), walk ins included.
create or replace function public.check_in(p_session uuid, p_profile uuid, p_in boolean) returns text
language plpgsql security definer set search_path = public as $$
declare s public.sessions;
begin
  select * into s from public.sessions where id = p_session;
  if s.id is null or not public.is_gym_staff(s.gym_id) then raise exception 'Coaches only'; end if;
  insert into public.bookings (session_id, gym_id, profile_id, status, checked_in_at)
  values (s.id, s.gym_id, p_profile, case when p_in then 'attended' else 'booked' end, case when p_in then now() end)
  on conflict (session_id, profile_id) do update
    set status = case when p_in then 'attended' else 'booked' end, checked_in_at = case when p_in then now() end, updated_at = now();
  return case when p_in then 'attended' else 'booked' end;
end $$;
revoke all on function public.book_session(uuid) from public, anon;
revoke all on function public.cancel_booking(uuid) from public, anon;
revoke all on function public.check_in(uuid, uuid, boolean) from public, anon;
grant execute on function public.book_session(uuid) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;
grant execute on function public.check_in(uuid, uuid, boolean) to authenticated;

/* ---------- staffing: availability and swaps ---------- */
create table if not exists public.coach_availability (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null check (end_time > start_time),
  created_at timestamptz not null default now()
);
alter table public.coach_availability enable row level security;
create policy avail_read on public.coach_availability for select to authenticated using (public.is_gym_staff(gym_id));
create policy avail_own on public.coach_availability for all to authenticated
  using (profile_id = public.my_profile_id() and public.is_gym_staff(gym_id)) with check (profile_id = public.my_profile_id() and public.is_gym_staff(gym_id));
create policy avail_owner on public.coach_availability for all to authenticated using (public.is_gym_owner(gym_id)) with check (public.is_gym_owner(gym_id));

create table if not exists public.swap_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  gym_id uuid not null references public.gyms(id) on delete cascade,
  from_coach uuid not null references public.profiles(id) on delete cascade,
  to_coach uuid references public.profiles(id) on delete cascade, -- null: any coach can take it
  note text check (char_length(note) <= 200),
  status text not null default 'open' check (status in ('open','taken','canceled')),
  taken_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.swap_requests enable row level security;
create policy swaps_read on public.swap_requests for select to authenticated using (public.is_gym_staff(gym_id));

create or replace function public.request_swap(p_session uuid, p_to uuid, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.sessions; me uuid := public.my_profile_id(); rid uuid;
begin
  select * into s from public.sessions where id = p_session;
  if s.id is null or s.starts_at < now() then raise exception 'That class already happened'; end if;
  if s.coach_id is distinct from me and not public.is_gym_owner(s.gym_id) then raise exception 'Only the coach on that class can ask for a swap'; end if;
  if p_to is not null and not exists (select 1 from public.gym_staff where gym_id = s.gym_id and profile_id = p_to) then raise exception 'Pick a coach at this gym'; end if;
  update public.swap_requests set status = 'canceled' where session_id = s.id and status = 'open';
  insert into public.swap_requests (session_id, gym_id, from_coach, to_coach, note) values (s.id, s.gym_id, coalesce(s.coach_id, me), p_to, left(p_note, 200)) returning id into rid;
  return rid;
end $$;
create or replace function public.take_swap(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare r public.swap_requests; me uuid := public.my_profile_id();
begin
  select * into r from public.swap_requests where id = p_id for update;
  if r.id is null or r.status <> 'open' then raise exception 'That swap is already handled'; end if;
  if not exists (select 1 from public.gym_staff where gym_id = r.gym_id and profile_id = me) then raise exception 'Coaches at this gym only'; end if;
  if r.to_coach is not null and r.to_coach <> me then raise exception 'That swap was sent to another coach'; end if;
  if r.from_coach = me then raise exception 'You cannot take your own class'; end if;
  update public.sessions set coach_id = me where id = r.session_id;
  update public.swap_requests set status = 'taken', taken_by = me where id = p_id;
  return 'taken';
end $$;
create or replace function public.cancel_swap(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare r public.swap_requests;
begin
  select * into r from public.swap_requests where id = p_id;
  if r.id is null then raise exception 'No swap here'; end if;
  if r.from_coach <> public.my_profile_id() and not public.is_gym_owner(r.gym_id) then raise exception 'Not your swap'; end if;
  update public.swap_requests set status = 'canceled' where id = p_id and status = 'open';
  return 'canceled';
end $$;
revoke all on function public.request_swap(uuid, uuid, text) from public, anon;
revoke all on function public.take_swap(uuid) from public, anon;
revoke all on function public.cancel_swap(uuid) from public, anon;
grant execute on function public.request_swap(uuid, uuid, text) to authenticated;
grant execute on function public.take_swap(uuid) to authenticated;
grant execute on function public.cancel_swap(uuid) to authenticated;

/* ---------- plans, memberships, invoices ---------- */
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 60),
  description text check (char_length(description) <= 300),
  price_cents integer not null check (price_cents between 0 and 10000000),
  interval text not null default 'month' check (interval in ('month','year','once')),
  commitment_months smallint not null default 0 check (commitment_months between 0 and 36),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.plans enable row level security;
create policy plans_read on public.plans for select to authenticated using (active or public.is_gym_staff(gym_id));
create policy plans_owner on public.plans for all to authenticated using (public.is_gym_owner(gym_id)) with check (public.is_gym_owner(gym_id));

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid references public.plans(id) on delete set null,
  plan_name text not null,
  price_cents integer not null,
  interval text not null,
  status text not null default 'pending' check (status in ('pending','active','past_due','paused','canceled')),
  start_date date not null default current_date,
  end_date date,
  contract_sig uuid references public.doc_signatures(id),
  stripe_customer text,
  stripe_subscription text,
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists memberships_gym on public.memberships (gym_id, status);
alter table public.memberships enable row level security;
create policy memberships_read on public.memberships for select to authenticated using (profile_id = public.my_profile_id() or public.is_gym_staff(gym_id));
create policy memberships_owner on public.memberships for all to authenticated using (public.is_gym_owner(gym_id)) with check (public.is_gym_owner(gym_id));

create sequence if not exists public.invoice_no start 1001;
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  number bigint not null default nextval('public.invoice_no'),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  membership_id uuid references public.memberships(id) on delete set null,
  description text not null check (char_length(description) between 2 and 200),
  amount_cents integer not null check (amount_cents between 0 and 10000000),
  status text not null default 'open' check (status in ('open','paid','void')),
  due_date date not null default current_date,
  paid_at timestamptz,
  method text check (method in ('card','cash','check','other')),
  stripe_session text,
  stripe_invoice text unique,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists invoices_gym on public.invoices (gym_id, created_at desc);
create index if not exists invoices_profile on public.invoices (profile_id, created_at desc);
alter table public.invoices enable row level security;
create policy invoices_read on public.invoices for select to authenticated using (profile_id = public.my_profile_id() or public.is_gym_owner(gym_id));
create policy invoices_owner_insert on public.invoices for insert to authenticated with check (public.is_gym_owner(gym_id));
create policy invoices_owner_update on public.invoices for update to authenticated using (public.is_gym_owner(gym_id)) with check (public.is_gym_owner(gym_id));
-- Invoices are never deleted; an owner voids one instead.

-- Stripe ids on gyms are written by the billing function only.
create or replace function public.gyms_guard_stripe() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.sys_on() and auth.uid() is not null then
    new.stripe_account := old.stripe_account; new.stripe_ready := old.stripe_ready;
  end if;
  return new;
end $$;
drop trigger if exists gyms_guard_stripe on public.gyms;
create trigger gyms_guard_stripe before update on public.gyms for each row execute function public.gyms_guard_stripe();

revoke all on function public.classes_changed() from public, anon, authenticated;
revoke all on function public.gym_docs_before() from public, anon, authenticated;
revoke all on function public.doc_signatures_before() from public, anon, authenticated;
revoke all on function public.gyms_guard_stripe() from public, anon, authenticated;

alter publication supabase_realtime add table public.bookings;
