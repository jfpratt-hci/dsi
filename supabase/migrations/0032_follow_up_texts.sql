-- Follow up on autopilot: the texts a gym sends without anyone remembering to.
-- follow_ups     one row per gym and rule: on or off, and the message (blank uses the default)
-- text_outbox    every automatic text, queued, sent, skipped or canceled, one per person per moment (no doubles)
-- sms_optouts    numbers that replied STOP to a gym
-- follow_up_scan finds who is due and queues their text, moved into 9am to 8pm gym time
-- The texts edge function sends what is due through Twilio and records replies. Every 5 minutes, and right away for a new lead.

alter table public.leads
  add column if not exists sms_ok boolean not null default false,
  add column if not exists trial_at timestamptz,
  add column if not exists buddy_profile uuid references public.profiles(id) on delete set null,
  add column if not exists referred_by uuid references public.profiles(id) on delete set null;
alter table public.member_details add column if not exists sms_ok boolean not null default false;

create table if not exists public.sms_optouts (
  gym_id uuid not null references public.gyms(id) on delete cascade,
  phone text not null,
  created_at timestamptz not null default now(),
  primary key (gym_id, phone)
);
alter table public.sms_optouts enable row level security;
drop policy if exists sms_optouts_read on public.sms_optouts;
create policy sms_optouts_read on public.sms_optouts for select to authenticated using (public.can_work_gym(gym_id));

create table if not exists public.follow_ups (
  gym_id uuid not null references public.gyms(id) on delete cascade,
  key text not null check (key in ('lead_reply','trial_reminder','buddy_heads_up','after_trial','nudge_3','nudge_7','nudge_14','member_quiet','new_pr','review_ask','card_failed')),
  enabled boolean not null default true,
  body text check (body is null or char_length(body) between 1 and 480),
  updated_at timestamptz not null default now(),
  primary key (gym_id, key)
);
alter table public.follow_ups enable row level security;
drop policy if exists follow_ups_read on public.follow_ups;
create policy follow_ups_read on public.follow_ups for select to authenticated using (public.can_work_gym(gym_id));
drop policy if exists follow_ups_manage on public.follow_ups;
create policy follow_ups_manage on public.follow_ups for all to authenticated
  using (public.can_manage_site(gym_id)) with check (public.can_manage_site(gym_id));

create table if not exists public.text_outbox (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  kind text not null,
  ref_key text not null,
  lead_id uuid references public.leads(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  to_name text,
  to_phone text not null,
  body text not null check (char_length(body) between 1 and 640),
  send_after timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','skipped','canceled')),
  error text,
  provider_ref text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (gym_id, kind, ref_key)
);
create index if not exists text_outbox_due on public.text_outbox (status, send_after);
create index if not exists text_outbox_gym on public.text_outbox (gym_id, created_at desc);
alter table public.text_outbox enable row level security;
drop policy if exists text_outbox_read on public.text_outbox;
create policy text_outbox_read on public.text_outbox for select to authenticated using (public.can_work_gym(gym_id));
drop policy if exists text_outbox_cancel on public.text_outbox;
create policy text_outbox_cancel on public.text_outbox for update to authenticated
  using (public.can_work_gym(gym_id) and status = 'queued') with check (public.can_work_gym(gym_id) and status in ('queued','canceled'));
revoke all on public.text_outbox, public.follow_ups, public.sms_optouts from anon;
grant select, update on public.text_outbox to authenticated;
grant select, insert, update, delete on public.follow_ups to authenticated;
grant select on public.sms_optouts to authenticated;

-- The default message for each rule. Words in braces fill in per person.
create or replace function public.fu_default(k text) returns text language sql immutable as $$
  select case k
    when 'lead_reply' then 'Hi {first}, thanks for reaching out to {gym}! Your first class is free. Pick a time here: {link} or reply with a day that works.'
    when 'trial_reminder' then 'Hi {first}, see you {when} at {gym}!{buddy_line} {address}. Wear anything you can move in and bring water. Reply here if anything changes.'
    when 'buddy_heads_up' then 'Hey {first}, {lead} is trying {gym} {when}. Can you say hi at the door and show them around? Thank you!'
    when 'after_trial' then '{first}, great to have you at {gym}! How did it feel? When you are ready, memberships start at {from} a month: {link}'
    when 'nudge_3' then 'Hi {first}, it''s {gym}. Still thinking it over? Happy to answer anything, just reply here.'
    when 'nudge_7' then '{first}, your second class is on us. Want to come back this week? Pick a time: {link}'
    when 'nudge_14' then 'Hi {first}, last check in from {gym}. If now is not the right time, no worries. The door is open whenever you are.'
    when 'member_quiet' then 'Hey {first}, we have missed you at {gym}! Everything ok? Your spot in class is waiting: {link}'
    when 'new_pr' then 'Huge {lift} PR today, {first}: {weight} lb! The whole gym saw it on the board. Keep it going.'
    when 'review_ask' then '{first}, if you love training at {gym}, a quick Google review helps more people find us: {review}. Thank you!'
    when 'card_failed' then 'Hi {first}, your {gym} payment did not go through. You can update your card here: https://dandystrength.com/mygym. Thank you!'
  end;
$$;

-- Move a send time into 9am to 8pm at the gym.
create or replace function public.fu_when(ts timestamptz, tz text) returns timestamptz language plpgsql stable as $$
declare l timestamp := ts at time zone coalesce(tz, 'America/New_York');
begin
  if extract(hour from l) < 9 then return (date_trunc('day', l) + interval '9 hours') at time zone coalesce(tz, 'America/New_York'); end if;
  if extract(hour from l) >= 20 then return (date_trunc('day', l) + interval '1 day 9 hours') at time zone coalesce(tz, 'America/New_York'); end if;
  return ts;
end $$;

create or replace function public.fu_fill(body text, v jsonb) returns text language plpgsql immutable as $$
declare k text; r text := body;
begin
  for k in select jsonb_object_keys(v) loop r := replace(r, '{' || k || '}', coalesce(v->>k, '')); end loop;
  return left(regexp_replace(trim(r), '\s+', ' ', 'g'), 640);
end $$;

create or replace function public.fu_first(n text) returns text language sql immutable as $$
  select coalesce(nullif(initcap(split_part(trim(coalesce(n, '')), ' ', 1)), ''), 'there');
$$;

-- Queue whatever is due. Returns how many texts were added. p_gym limits it to one gym.
create or replace function public.follow_up_scan(p_gym uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; c int;
begin
  drop table if exists fu_g;
  create temp table fu_g on commit drop as
  select g.id, g.name, coalesce(g.tz, 'America/New_York') tz, coalesce(g.address, '') address,
    coalesce(case when s.custom_domain is not null then 'https://' || s.custom_domain end, case when s.subdomain is not null then 'https://dandystrength.com/' || s.subdomain end, 'https://dandystrength.com') link,
    coalesce('$' || (select (min(p.price_cents) / 100)::text from public.plans p where p.gym_id = g.id and p.active and p.price_cents > 0), 'a low price') pfrom,
    coalesce(s.social->>'google', '') review
  from public.gyms g left join public.gym_sites s on s.gym_id = g.id
  where (p_gym is null or g.id = p_gym) and exists (select 1 from public.text_lines t where t.gym_id = g.id);

  drop table if exists fu_on;
  create temp table fu_on on commit drop as
  select g.id gym_id, k.key, coalesce(f.enabled, true) enabled, coalesce(f.body, public.fu_default(k.key)) body
  from fu_g g cross join unnest(array['lead_reply','trial_reminder','buddy_heads_up','after_trial','nudge_3','nudge_7','nudge_14','member_quiet','new_pr','review_ask','card_failed']) k(key)
  left join public.follow_ups f on f.gym_id = g.id and f.key = k.key;
  delete from fu_on where not enabled;

  -- Leads who can be texted
  drop table if exists fu_l;
  create temp table fu_l on commit drop as
  select l.*, '+1' || l.phone e164 from public.leads l join fu_g g on g.id = l.gym_id
  where l.phone ~ '^\d{10}$' and l.sms_ok and not l.opted_out
    and not exists (select 1 from public.sms_optouts o where o.gym_id = l.gym_id and o.phone = l.phone);

  -- 1. A new lead gets an answer, unless a coach already replied
  insert into public.text_outbox (gym_id, kind, ref_key, lead_id, to_name, to_phone, body, send_after)
  select l.gym_id, 'lead_reply', l.id::text, l.id, l.name, l.e164,
    public.fu_fill(o.body, jsonb_build_object('first', public.fu_first(l.name), 'gym', g.name, 'link', g.link)), public.fu_when(now(), g.tz)
  from fu_l l join fu_g g on g.id = l.gym_id join fu_on o on o.gym_id = l.gym_id and o.key = 'lead_reply'
  where l.created_at > now() - interval '1 day' and l.status = 'new'
    and not exists (select 1 from public.lead_messages m where m.lead_id = l.id and m.direction = 'out')
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;

  -- 2. The night before the free class (7pm), or now when booked late
  insert into public.text_outbox (gym_id, kind, ref_key, lead_id, to_name, to_phone, body, send_after)
  select l.gym_id, 'trial_reminder', l.id || ':' || extract(epoch from l.trial_at)::bigint, l.id, l.name, l.e164,
    public.fu_fill(o.body, jsonb_build_object('first', public.fu_first(l.name), 'gym', g.name, 'address', g.address,
      'when', to_char(l.trial_at at time zone g.tz, 'FMDay "at" FMHH12:MI am'),
      'buddy_line', coalesce(' ' || (select public.fu_first(coalesce(md.legal_name, p.display_name::text)) from public.profiles p left join public.member_details md on md.profile_id = p.id where p.id = l.buddy_profile) || ' will meet you at the door.', ''))),
    public.fu_when(greatest(now(), ((date_trunc('day', l.trial_at at time zone g.tz) - interval '5 hours') at time zone g.tz)), g.tz)
  from fu_l l join fu_g g on g.id = l.gym_id join fu_on o on o.gym_id = l.gym_id and o.key = 'trial_reminder'
  where l.trial_at between now() + interval '90 minutes' and now() + interval '36 hours' and l.status not in ('joined', 'lost')
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;

  -- 3. The buddy hears who is coming
  insert into public.text_outbox (gym_id, kind, ref_key, lead_id, profile_id, to_name, to_phone, body, send_after)
  select l.gym_id, 'buddy_heads_up', l.id || ':' || l.buddy_profile || ':' || extract(epoch from l.trial_at)::bigint, l.id, l.buddy_profile, coalesce(md.legal_name, p.display_name::text), '+1' || public.site_clean_phone(md.phone),
    public.fu_fill(o.body, jsonb_build_object('first', public.fu_first(coalesce(md.legal_name, p.display_name::text)), 'lead', public.fu_first(l.name), 'gym', g.name, 'when', to_char(l.trial_at at time zone g.tz, 'FMDay "at" FMHH12:MI am'))),
    public.fu_when(greatest(now(), ((date_trunc('day', l.trial_at at time zone g.tz) - interval '5 hours') at time zone g.tz)), g.tz)
  from public.leads l join fu_g g on g.id = l.gym_id join fu_on o on o.gym_id = l.gym_id and o.key = 'buddy_heads_up'
    join public.profiles p on p.id = l.buddy_profile join public.member_details md on md.profile_id = p.id
  where l.trial_at between now() + interval '90 minutes' and now() + interval '36 hours' and l.status not in ('joined', 'lost')
    and md.sms_ok and public.site_clean_phone(md.phone) is not null
    and not exists (select 1 from public.sms_optouts x where x.gym_id = l.gym_id and x.phone = public.site_clean_phone(md.phone))
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;

  -- 4. After the free class
  insert into public.text_outbox (gym_id, kind, ref_key, lead_id, to_name, to_phone, body, send_after)
  select l.gym_id, 'after_trial', l.id || ':' || extract(epoch from l.trial_at)::bigint, l.id, l.name, l.e164,
    public.fu_fill(o.body, jsonb_build_object('first', public.fu_first(l.name), 'gym', g.name, 'link', g.link, 'from', g.pfrom)), public.fu_when(now(), g.tz)
  from fu_l l join fu_g g on g.id = l.gym_id join fu_on o on o.gym_id = l.gym_id and o.key = 'after_trial'
  where l.trial_at between now() - interval '1 day' and now() - interval '90 minutes' and l.status not in ('joined', 'lost')
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;

  -- 5. Nudges on day 3, 7 and 14 for people who have not joined. They stop when the lead is marked joined or lost.
  insert into public.text_outbox (gym_id, kind, ref_key, lead_id, to_name, to_phone, body, send_after)
  select l.gym_id, o.key, l.id::text, l.id, l.name, l.e164,
    public.fu_fill(o.body, jsonb_build_object('first', public.fu_first(l.name), 'gym', g.name, 'link', g.link)), public.fu_when(now(), g.tz)
  from fu_l l join fu_g g on g.id = l.gym_id
    join fu_on o on o.gym_id = l.gym_id and o.key in ('nudge_3', 'nudge_7', 'nudge_14')
  where l.status not in ('joined', 'lost')
    and coalesce(l.trial_at, l.created_at) between now() - (substr(o.key, 7)::int + 2) * interval '1 day' and now() - substr(o.key, 7)::int * interval '1 day'
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;

  -- Members who can be texted
  drop table if exists fu_m;
  create temp table fu_m on commit drop as
  select distinct on (m.gym_id, m.profile_id) m.gym_id, m.profile_id, m.start_date, coalesce(md.legal_name, p.display_name::text) nm, public.site_clean_phone(md.phone) ph
  from public.memberships m join fu_g g on g.id = m.gym_id join public.profiles p on p.id = m.profile_id join public.member_details md on md.profile_id = m.profile_id
  where m.status = 'active' and md.sms_ok and public.site_clean_phone(md.phone) is not null
    and not exists (select 1 from public.sms_optouts x where x.gym_id = m.gym_id and x.phone = public.site_clean_phone(md.phone));

  -- 6. A regular who has not checked in for 10 days, once each time it happens
  insert into public.text_outbox (gym_id, kind, ref_key, profile_id, to_name, to_phone, body, send_after)
  select m.gym_id, 'member_quiet', m.profile_id || ':' || b.last::date, m.profile_id, m.nm, '+1' || m.ph,
    public.fu_fill(o.body, jsonb_build_object('first', public.fu_first(m.nm), 'gym', g.name, 'link', g.link)), public.fu_when(now(), g.tz)
  from fu_m m join fu_g g on g.id = m.gym_id join fu_on o on o.gym_id = m.gym_id and o.key = 'member_quiet'
    join lateral (select max(checked_in_at) last from public.bookings bk where bk.gym_id = m.gym_id and bk.profile_id = m.profile_id and bk.checked_in_at is not null) b on true
  where b.last between now() - interval '60 days' and now() - interval '10 days' and coalesce(m.start_date, current_date) <= current_date - 14
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;

  -- 7. A new PR, one text a day at most
  insert into public.text_outbox (gym_id, kind, ref_key, profile_id, to_name, to_phone, body, send_after)
  select distinct on (m.gym_id, m.profile_id, e.performed_on) m.gym_id, 'new_pr', m.profile_id || ':' || e.performed_on, m.profile_id, m.nm, '+1' || m.ph,
    public.fu_fill(o.body, jsonb_build_object('first', public.fu_first(m.nm), 'gym', g.name, 'lift', lower(coalesce(lf.name, e.lift)), 'weight', rtrim(to_char(e.weight_lb, 'FM9999.#'), '.'))), public.fu_when(now(), g.tz)
  from fu_m m join fu_g g on g.id = m.gym_id join fu_on o on o.gym_id = m.gym_id and o.key = 'new_pr'
    join public.lift_entries e on e.profile_id = m.profile_id left join public.lifts lf on lf.id = e.lift
  where e.is_pr and e.created_at > now() - interval '1 day' and coalesce(e.status, '') not in ('rejected', 'removed')
  order by m.gym_id, m.profile_id, e.performed_on, e.weight_lb desc
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;

  -- 8. The day after a PR, a review ask, at most once every 4 months, only when the gym has a review link
  insert into public.text_outbox (gym_id, kind, ref_key, profile_id, to_name, to_phone, body, send_after)
  select distinct on (m.gym_id, m.profile_id) m.gym_id, 'review_ask', m.profile_id || ':' || to_char(now(), 'YYYY-Q'), m.profile_id, m.nm, '+1' || m.ph,
    public.fu_fill(o.body, jsonb_build_object('first', public.fu_first(m.nm), 'gym', g.name, 'review', g.review)),
    public.fu_when((date_trunc('day', now() at time zone g.tz) + interval '1 day 18 hours') at time zone g.tz, g.tz)
  from fu_m m join fu_g g on g.id = m.gym_id join fu_on o on o.gym_id = m.gym_id and o.key = 'review_ask'
    join public.lift_entries e on e.profile_id = m.profile_id
  where g.review <> '' and e.is_pr and e.created_at > now() - interval '1 day'
    and not exists (select 1 from public.text_outbox t where t.gym_id = m.gym_id and t.profile_id = m.profile_id and t.kind = 'review_ask' and t.created_at > now() - interval '120 days')
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;

  -- 9. A failed card, privately
  insert into public.text_outbox (gym_id, kind, ref_key, profile_id, to_name, to_phone, body, send_after)
  select m.gym_id, 'card_failed', py.id::text, m.profile_id, m.nm, '+1' || m.ph,
    public.fu_fill(o.body, jsonb_build_object('first', public.fu_first(m.nm), 'gym', g.name)), public.fu_when(now(), g.tz)
  from public.payments py join fu_m m on m.gym_id = py.gym_id and m.profile_id = py.profile_id
    join fu_g g on g.id = py.gym_id join fu_on o on o.gym_id = py.gym_id and o.key = 'card_failed'
  where py.status = 'failed' and py.created_at > now() - interval '2 days'
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;

  return n;
end $$;
revoke execute on function public.follow_up_scan(uuid) from public, anon, authenticated;

-- What a coach sees before a text goes out: the message filled in for a made up person.
create or replace function public.follow_up_preview(p_gym uuid, p_key text, p_body text) returns text
language plpgsql stable security definer set search_path = public as $$
declare g record;
begin
  if not public.can_work_gym(p_gym) then raise exception 'Not your gym'; end if;
  select gy.name, coalesce(gy.address, '') address, coalesce(case when s.custom_domain is not null then 'https://' || s.custom_domain end, case when s.subdomain is not null then 'https://dandystrength.com/' || s.subdomain end, 'https://dandystrength.com') link,
    coalesce('$' || (select (min(p.price_cents) / 100)::text from public.plans p where p.gym_id = gy.id and p.active and p.price_cents > 0), 'a low price') pfrom, coalesce(s.social->>'google', 'your Google review link') review
  into g from public.gyms gy left join public.gym_sites s on s.gym_id = gy.id where gy.id = p_gym;
  return public.fu_fill(coalesce(nullif(trim(p_body), ''), public.fu_default(p_key)), jsonb_build_object('first', 'Taylor', 'lead', 'Taylor', 'gym', g.name, 'link', g.link, 'address', g.address,
    'when', 'Saturday at 9:00 am', 'buddy_line', ' Morgan will meet you at the door.', 'from', g.pfrom, 'lift', 'deadlift', 'weight', '315', 'review', g.review));
end $$;
revoke execute on function public.follow_up_preview(uuid, text, text) from public, anon;
grant execute on function public.follow_up_preview(uuid, text, text) to authenticated;
grant execute on function public.fu_default(text) to authenticated;

-- Public: the text us box and the free class booking on a gym website. Both say the gym may text them back.
create or replace function public.site_text_us(p_key text, p_name text, p_phone text, p_message text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g uuid := public.site_gym_id(p_key); lid uuid;
begin
  if g is null then raise exception 'Gym not found'; end if;
  if public.site_clean_phone(p_phone) is null then raise exception 'Add a 10 digit mobile number.'; end if;
  if coalesce(trim(p_message), '') = '' then raise exception 'Type a message.'; end if;
  lid := public.site_touch_lead(g, p_name, p_phone, null, 'website', null, p_message);
  update public.leads set sms_ok = true where id = lid;
  return jsonb_build_object('lead_id', lid);
end $$;
revoke execute on function public.site_text_us(text, text, text, text) from public;
grant execute on function public.site_text_us(text, text, text, text) to anon, authenticated;

create or replace function public.site_book_trial(p_key text, p_name text, p_phone text, p_email text, p_at timestamptz, p_what text, p_note text, p_sms_ok boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g uuid := public.site_gym_id(p_key); lid uuid;
begin
  if g is null then raise exception 'Gym not found'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Add your name.'; end if;
  if p_at is null or p_at < now() - interval '1 hour' or p_at > now() + interval '60 days' then raise exception 'Pick a time in the next few weeks.'; end if;
  lid := public.site_touch_lead(g, p_name, p_phone, p_email, 'website', left(coalesce(p_what, 'Free class'), 120),
    left(coalesce(p_what, 'Free class') || ' booked for ' || to_char(p_at at time zone (select coalesce(tz, 'America/New_York') from public.gyms where id = g), 'FMDay, FMMonth FMDD "at" FMHH12:MI am') || coalesce('. ' || nullif(trim(p_note), ''), ''), 2000));
  update public.leads set trial_at = p_at, status = case when status in ('new', 'talking', 'lost') then 'booked' else status end,
    sms_ok = sms_ok or (coalesce(p_sms_ok, false) and phone is not null) where id = lid;
  return jsonb_build_object('lead_id', lid);
end $$;
revoke execute on function public.site_book_trial(text, text, text, text, timestamptz, text, text, boolean) from public;
grant execute on function public.site_book_trial(text, text, text, text, timestamptz, text, text, boolean) to anon, authenticated;

-- Wake the texts function: right away for a new lead or a coach's reply, and every 5 minutes for everything else.
insert into public.app_secrets (k, v) values ('texts_hook', encode(extensions.gen_random_bytes(24), 'hex')) on conflict (k) do nothing;
create or replace function public.fu_kick(p_gym uuid default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare sec text;
begin
  select v into sec from public.app_secrets where k = 'texts_hook';
  if sec is null then return; end if;
  perform net.http_post(url := 'https://fairfhgyrosjqualmhwu.supabase.co/functions/v1/texts',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dsi-hook', sec),
    body := jsonb_build_object('gym', p_gym));
exception when others then null;
end $$;
revoke execute on function public.fu_kick(uuid) from public, anon, authenticated;

create or replace function public.fu_kick_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new);
begin
  if tg_table_name = 'lead_messages' and not (j->>'direction' = 'out' and j->>'channel' = 'sms' and j->>'status' = 'queued') then return new; end if;
  perform public.fu_kick((j->>'gym_id')::uuid);
  return new;
end $$;
revoke execute on function public.fu_kick_row() from public, anon, authenticated;
drop trigger if exists fu_kick_leads on public.leads;
create trigger fu_kick_leads after insert on public.leads for each row execute function public.fu_kick_row();
drop trigger if exists fu_kick_msgs on public.lead_messages;
create trigger fu_kick_msgs after insert on public.lead_messages for each row execute function public.fu_kick_row();

create extension if not exists pg_cron;
select cron.unschedule('dsi-texts') where exists (select 1 from cron.job where jobname = 'dsi-texts');
select cron.schedule('dsi-texts', '*/5 * * * *', $$select public.fu_kick(null)$$);
