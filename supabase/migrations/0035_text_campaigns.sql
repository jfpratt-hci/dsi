-- Text blasts: one text to many people. A survey (reply with a number), news with a link (new merch, an event),
-- or a sign up (reply YES). Only people who said yes to news and offers get them, and every one honors STOP.
-- Replies are matched to the newest blast sent to that number in the last 3 days and counted.

alter table public.member_details add column if not exists sms_promo boolean not null default false;
alter table public.leads add column if not exists sms_promo boolean not null default false;

create table if not exists public.text_campaigns (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  kind text not null check (kind in ('survey', 'news', 'signup')),
  title text not null check (char_length(title) between 1 and 80),
  body text not null check (char_length(body) between 1 and 480),
  link text check (link is null or link ~* '^https?://'),
  choices text[] not null default '{}',
  audience text not null default 'members' check (audience in ('members', 'unlimited', 'quiet', 'leads', 'everyone')),
  status text not null default 'draft' check (status in ('draft', 'sent', 'canceled')),
  send_at timestamptz,
  sent_count int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists text_campaigns_gym on public.text_campaigns (gym_id, created_at desc);
alter table public.text_campaigns enable row level security;
drop policy if exists text_campaigns_read on public.text_campaigns;
create policy text_campaigns_read on public.text_campaigns for select to authenticated using (public.can_work_gym(gym_id));
drop policy if exists text_campaigns_write on public.text_campaigns;
create policy text_campaigns_write on public.text_campaigns for all to authenticated
  using (public.can_manage_site(gym_id) and status = 'draft') with check (public.can_manage_site(gym_id) and status in ('draft', 'canceled'));

create table if not exists public.text_campaign_replies (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.text_campaigns(id) on delete cascade,
  gym_id uuid not null references public.gyms(id) on delete cascade,
  phone text not null,
  profile_id uuid references public.profiles(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  name text,
  answer text,
  body text,
  created_at timestamptz not null default now(),
  unique (campaign_id, phone)
);
alter table public.text_campaign_replies enable row level security;
drop policy if exists text_campaign_replies_read on public.text_campaign_replies;
create policy text_campaign_replies_read on public.text_campaign_replies for select to authenticated using (public.can_work_gym(gym_id));

alter table public.text_outbox add column if not exists campaign_id uuid references public.text_campaigns(id) on delete cascade;
revoke all on public.text_campaigns, public.text_campaign_replies from anon;
grant select, insert, update, delete on public.text_campaigns to authenticated;
grant select on public.text_campaign_replies to authenticated;

-- Who a blast would go to, for the count shown before sending.
create or replace function public.campaign_audience(p_gym uuid, p_audience text)
returns table (profile_id uuid, lead_id uuid, name text, phone text)
language sql stable security definer set search_path = public as $$
  with mem as (
    select distinct on (m.profile_id) m.profile_id, null::uuid lead_id, coalesce(md.legal_name, p.display_name::text) name, public.site_clean_phone(md.phone) phone,
      coalesce(m.plan_name, '') plan, (select max(b.checked_in_at) from public.bookings b where b.gym_id = p_gym and b.profile_id = m.profile_id) last_in
    from public.memberships m join public.member_details md on md.profile_id = m.profile_id join public.profiles p on p.id = m.profile_id
    where m.gym_id = p_gym and m.status = 'active' and md.sms_promo and public.site_clean_phone(md.phone) is not null
  ), lds as (
    select null::uuid, l.id, l.name, l.phone from public.leads l
    where l.gym_id = p_gym and l.sms_promo and not l.opted_out and l.phone ~ '^\d{10}$' and l.status not in ('joined', 'lost')
  ), pick as (
    select mem.profile_id, mem.lead_id, mem.name, mem.phone from mem
    where p_audience in ('members', 'everyone')
       or (p_audience = 'unlimited' and mem.plan ilike '%unlimited%')
       or (p_audience = 'quiet' and (mem.last_in is null or mem.last_in < now() - interval '14 days'))
    union all
    select * from lds where p_audience in ('leads', 'everyone')
  )
  select distinct on (pick.phone) pick.* from pick
  where not exists (select 1 from public.sms_optouts o where o.gym_id = p_gym and o.phone = pick.phone);
$$;
revoke execute on function public.campaign_audience(uuid, text) from public, anon, authenticated;

create or replace function public.campaign_count(p_gym uuid, p_audience text) returns int
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_work_gym(p_gym) then raise exception 'Not your gym'; end if;
  return (select count(*) from public.campaign_audience(p_gym, p_audience));
end $$;
revoke execute on function public.campaign_count(uuid, text) from public, anon;
grant execute on function public.campaign_count(uuid, text) to authenticated;

-- Send a draft: one queued text per person, moved into 9am to 8pm. The texts function sends them.
create or replace function public.campaign_send(p_id uuid, p_at timestamptz default null) returns int
language plpgsql security definer set search_path = public as $$
declare c public.text_campaigns; g record; n int; msg text; at timestamptz;
begin
  select * into c from public.text_campaigns where id = p_id;
  if c.id is null or not public.can_manage_site(c.gym_id) then raise exception 'Only the gym owner can send this.'; end if;
  if c.status <> 'draft' then raise exception 'This one was already sent.'; end if;
  select gy.name, coalesce(gy.tz, 'America/New_York') tz into g from public.gyms gy where gy.id = c.gym_id;
  msg := c.body
    || case when c.kind = 'survey' and cardinality(c.choices) > 0 then ' Reply ' || (select string_agg(i || ' ' || c.choices[i], ', ') from generate_subscripts(c.choices, 1) i) || '.' else '' end
    || case when c.kind = 'signup' then ' Reply YES to sign up.' else '' end
    || case when c.link is not null then ' ' || c.link else '' end
    || ' Reply STOP to opt out.';
  at := public.fu_when(greatest(now(), coalesce(p_at, now())), g.tz);
  insert into public.text_outbox (gym_id, kind, ref_key, lead_id, profile_id, to_name, to_phone, body, send_after, campaign_id)
  select c.gym_id, 'campaign', c.id || ':' || a.phone, a.lead_id, a.profile_id, a.name, '+1' || a.phone,
    left(replace(msg, '{first}', public.fu_first(a.name)), 640), at, c.id
  from public.campaign_audience(c.gym_id, c.audience) a
  on conflict do nothing;
  get diagnostics n = row_count;
  update public.text_campaigns set status = 'sent', sent_count = n, sent_at = now(), send_at = at where id = c.id;
  perform public.fu_kick(c.gym_id);
  return n;
end $$;
revoke execute on function public.campaign_send(uuid, timestamptz) from public, anon;
grant execute on function public.campaign_send(uuid, timestamptz) to authenticated;

-- A reply to a blast. Called by the texts function for every text that comes in. Returns the campaign it counted for, or null.
create or replace function public.campaign_reply(p_gym uuid, p_phone text, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t record; c public.text_campaigns; ans text; b text := trim(coalesce(p_body, '')); k int;
begin
  select o.campaign_id, o.profile_id, o.lead_id, o.to_name into t from public.text_outbox o
  where o.gym_id = p_gym and o.to_phone = '+1' || p_phone and o.campaign_id is not null and o.status = 'sent' and o.sent_at > now() - interval '3 days'
  order by o.sent_at desc limit 1;
  if t.campaign_id is null then return null; end if;
  select * into c from public.text_campaigns where id = t.campaign_id;
  if c.kind = 'survey' then
    k := nullif(substring(b from '^\s*(\d{1,2})\y'), '')::int;
    ans := case when k between 1 and cardinality(c.choices) then c.choices[k]
      else (select ch from unnest(c.choices) ch where lower(b) = lower(ch) limit 1) end;
  elsif c.kind = 'signup' then
    ans := case when upper(b) ~ '^(YES|Y|IN|ME|YEP|YEAH|SIGN ME UP)\y' then 'Yes' when upper(b) ~ '^(NO|N|NOPE)\y' then 'No' else null end;
  end if;
  if ans is null and c.kind <> 'news' then return null; end if;
  insert into public.text_campaign_replies (campaign_id, gym_id, phone, profile_id, lead_id, name, answer, body)
  values (c.id, p_gym, p_phone, t.profile_id, t.lead_id, t.to_name, ans, left(b, 500))
  on conflict (campaign_id, phone) do update set answer = coalesce(excluded.answer, text_campaign_replies.answer), body = excluded.body, created_at = now();
  return c.id;
end $$;
revoke execute on function public.campaign_reply(uuid, text, text) from public, anon, authenticated;
