-- Applied to the Dandy Strength project on 2026-10-12 as migration 20261012213655 (gym_site_public_api).

-- Everything a gym website needs in one call, plus the public form submissions. Security definer so the
-- site never needs direct table access and existing table policies stay unchanged.

create or replace function public.site_gym_id(p_key text)
returns uuid language sql stable security definer set search_path = public as $$
  select g.id from public.gyms g left join public.gym_sites s on s.gym_id = g.id
  where g.slug = lower(p_key) or s.subdomain = lower(p_key) or s.custom_domain = lower(p_key)
  limit 1;
$$;

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
    'code', (select jsonb_build_object('css', custom_css, 'head', custom_head) from public.gym_site_code where gym_id = g),
    'text_line', (select jsonb_build_object('phone', phone_e164, 'widget', website_widget) from public.text_lines where gym_id = g),
    'classes', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'weekdays', c.weekdays, 'start_time', c.start_time, 'duration_min', c.duration_min, 'capacity', c.capacity, 'coach', p.display_name) order by c.start_time)
      from public.classes c left join public.profiles p on p.id = c.coach_id where c.gym_id = g and c.active), '[]'::jsonb),
    'plans', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'description', description, 'price_cents', price_cents, 'interval', interval, 'commitment_months', commitment_months, 'includes_pro', includes_pro) order by price_cents)
      from public.plans where gym_id = g and active), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'slug', e.slug, 'description', e.description, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'location', e.location,
        'price_cents', e.price_cents, 'member_price_cents', e.member_price_cents, 'capacity', e.capacity, 'divisions', e.divisions, 'ask_shirt_size', e.ask_shirt_size,
        'spots_left', case when e.capacity is null then null else greatest(0, e.capacity - (select count(*) from public.event_registrations r where r.event_id = e.id and r.status in ('pending','confirmed','attended'))) end) order by e.starts_at)
      from public.events e where e.gym_id = g and e.status = 'published' and e.starts_at > now() - interval '1 day'), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'description', description, 'kind', kind, 'duration_min', duration_min, 'price_cents', price_cents, 'price_note', price_note, 'require_payment', require_payment) order by sort, name)
      from public.services where gym_id = g and active), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name, 'description', pr.description, 'price_cents', pr.price_cents, 'tag', pr.tag, 'images', pr.image_paths, 'ship_or_pickup', pr.ship_or_pickup,
        'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'size', v.size, 'color', v.color, 'price_cents', coalesce(v.price_cents, pr.price_cents)) order by v.sort) from public.product_variants v where v.product_id = pr.id and v.active), '[]'::jsonb)) order by pr.sort, pr.name)
      from public.products pr where pr.gym_id = g and pr.visible), '[]'::jsonb),
    'coaches', coalesce((select jsonb_agg(jsonb_build_object('name', p.display_name, 'role', st.role, 'title', st.title, 'bio', st.bio, 'photo', st.photo_path) order by st.site_sort, p.display_name)
      from public.gym_staff st join public.profiles p on p.id = st.profile_id where st.gym_id = g and st.show_on_site), '[]'::jsonb),
    'pages', coalesce((select jsonb_agg(jsonb_build_object('slug', slug, 'title', title, 'body', body, 'in_nav', in_nav) order by sort) from public.site_pages where gym_id = g and published), '[]'::jsonb)
  );
end $$;

-- Light abuse guard for public forms: at most 8 submissions per phone or email per gym per hour.
create or replace function public.site_guard(p_gym uuid, p_phone text, p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from public.leads where gym_id = p_gym and created_at > now() - interval '1 hour'
    and ((p_phone is not null and phone = p_phone) or (p_email is not null and email = p_email));
  if n >= 8 then raise exception 'Too many requests. Text or call the gym instead.'; end if;
end $$;

create or replace function public.site_clean_phone(p text)
returns text language sql immutable set search_path = public as $$
  select case when length(regexp_replace(coalesce(p,''), '\D', '', 'g')) >= 10
    then right(regexp_replace(p, '\D', '', 'g'), 10) else null end;
$$;

-- Upsert a lead for this person and log what they asked for. Every public form calls this, so the owner sees one person, not five records.
create or replace function public.site_touch_lead(p_gym uuid, p_name text, p_phone text, p_email text, p_source text, p_interest text, p_message text)
returns uuid language plpgsql security definer set search_path = public as $$
declare lid uuid; ph text := public.site_clean_phone(p_phone); em text := nullif(lower(trim(coalesce(p_email,''))), '');
begin
  if ph is null and em is null then raise exception 'Add a mobile number or email so the gym can reach you.'; end if;
  perform public.site_guard(p_gym, ph, em);
  select id into lid from public.leads where gym_id = p_gym and ((ph is not null and phone = ph) or (em is not null and email = em)) order by created_at desc limit 1;
  if lid is null then
    insert into public.leads (gym_id, profile_id, name, phone, email, source, interest, last_message_at)
    values (p_gym, public.my_profile_id(), left(trim(p_name), 120), ph, em, coalesce(p_source, 'website'), left(p_interest, 120), now()) returning id into lid;
  else
    update public.leads set last_message_at = now(), interest = coalesce(left(p_interest,120), interest),
      status = case when status = 'lost' then 'new' else status end,
      name = coalesce(nullif(left(trim(p_name),120),''), name) where id = lid;
  end if;
  if p_message is not null and length(trim(p_message)) > 0 then
    insert into public.lead_messages (lead_id, gym_id, direction, channel, body, status) values (lid, p_gym, 'in', 'web', left(trim(p_message), 2000), 'received');
  end if;
  return lid;
end $$;

create or replace function public.site_submit_lead(p_key text, p_name text, p_phone text, p_email text, p_message text, p_interest text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g uuid := public.site_gym_id(p_key); lid uuid;
begin
  if g is null then raise exception 'Gym not found'; end if;
  if coalesce(trim(p_message), '') = '' then raise exception 'Type a message.'; end if;
  lid := public.site_touch_lead(g, p_name, p_phone, p_email, 'website', p_interest, p_message);
  return jsonb_build_object('lead_id', lid);
end $$;

create or replace function public.site_register_event(p_event uuid, p_name text, p_email text, p_phone text,
  p_division text default null, p_shirt_size text default null, p_team text default null, p_pay_at_gym boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e public.events; taken int; st text; rid uuid; price int;
begin
  select * into e from public.events where id = p_event and status = 'published';
  if e.id is null or e.starts_at < now() - interval '1 day' then raise exception 'This event is not open for registration.'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'Add your name.'; end if;
  if e.ask_shirt_size and coalesce(p_shirt_size,'') = '' then raise exception 'Pick a shirt size.'; end if;
  perform public.site_touch_lead(e.gym_id, p_name, p_phone, p_email, 'event', 'Event: ' || e.title, null);
  select count(*) into taken from public.event_registrations where event_id = e.id and status in ('pending','confirmed','attended');
  price := e.price_cents;
  if e.member_price_cents is not null and exists (select 1 from public.memberships m where m.gym_id = e.gym_id and m.profile_id = public.my_profile_id() and m.status = 'active') then price := e.member_price_cents; end if;
  st := case when e.capacity is not null and taken >= e.capacity then 'waitlist' when price = 0 or p_pay_at_gym then 'confirmed' else 'pending' end;
  insert into public.event_registrations (event_id, gym_id, profile_id, name, email, phone, division, team_name, shirt_size, price_cents, pay_at_gym, status)
  values (e.id, e.gym_id, public.my_profile_id(), left(trim(p_name),120), nullif(lower(trim(coalesce(p_email,''))),''), public.site_clean_phone(p_phone),
    left(p_division,60), left(p_team,80), left(p_shirt_size,10), price, coalesce(p_pay_at_gym,false), st)
  returning id into rid;
  return jsonb_build_object('registration_id', rid, 'status', st, 'amount_cents', price, 'needs_payment', st = 'pending');
end $$;

create or replace function public.site_request_appointment(p_service uuid, p_name text, p_email text, p_phone text,
  p_starts_at timestamptz default null, p_session uuid default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare sv public.services; aid uuid; st text;
begin
  select * into sv from public.services where id = p_service and active;
  if sv.id is null then raise exception 'That service is not available.'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'Add your name.'; end if;
  if sv.kind <> 'waitlist' and p_starts_at is null and p_session is null then raise exception 'Pick a time.'; end if;
  if p_starts_at is not null and p_starts_at < now() then raise exception 'Pick a time in the future.'; end if;
  if p_session is not null and not exists (select 1 from public.sessions where id = p_session and gym_id = sv.gym_id and status = 'scheduled') then raise exception 'That class time is not available.'; end if;
  perform public.site_touch_lead(sv.gym_id, p_name, p_phone, p_email, 'website', sv.name, p_notes);
  st := case when sv.kind = 'waitlist' then 'waitlist' else 'requested' end;
  insert into public.appointments (gym_id, service_id, session_id, profile_id, name, email, phone, starts_at, price_cents, status, notes)
  values (sv.gym_id, sv.id, p_session, public.my_profile_id(), left(trim(p_name),120), nullif(lower(trim(coalesce(p_email,''))),''), public.site_clean_phone(p_phone),
    coalesce(p_starts_at, (select starts_at from public.sessions where id = p_session)), sv.price_cents, st, left(p_notes, 1000))
  returning id into aid;
  return jsonb_build_object('appointment_id', aid, 'status', st, 'amount_cents', sv.price_cents, 'needs_payment', sv.require_payment and sv.price_cents > 0);
end $$;

-- p_items: [{"variant_id": "...", "qty": 1}] or [{"product_id": "...", "qty": 1}]. Prices always come from the database.
create or replace function public.site_place_order(p_key text, p_items jsonb, p_name text, p_email text, p_phone text, p_delivery text default 'pickup', p_ship_to jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g uuid := public.site_gym_id(p_key); oid uuid; it jsonb; pr public.products; v public.product_variants; q int; sub int := 0; unit int;
begin
  if g is null then raise exception 'Gym not found'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 20 then raise exception 'Your cart is empty.'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'Add your name.'; end if;
  if p_delivery not in ('pickup','ship') then raise exception 'Pick pickup or shipping.'; end if;
  if p_delivery = 'ship' and p_ship_to is null then raise exception 'Add a shipping address.'; end if;
  perform public.site_touch_lead(g, p_name, p_phone, p_email, 'website', 'Store order', null);
  insert into public.orders (gym_id, profile_id, name, email, phone, delivery, ship_to)
  values (g, public.my_profile_id(), left(trim(p_name),120), nullif(lower(trim(coalesce(p_email,''))),''), public.site_clean_phone(p_phone), p_delivery, p_ship_to)
  returning id into oid;
  for it in select * from jsonb_array_elements(p_items) loop
    q := least(greatest(coalesce((it->>'qty')::int, 1), 1), 50);
    v := null; pr := null;
    if it ? 'variant_id' then
      select * into v from public.product_variants where id = (it->>'variant_id')::uuid and active;
      select * into pr from public.products where id = v.product_id;
    else
      select * into pr from public.products where id = (it->>'product_id')::uuid;
    end if;
    if pr.id is null or pr.gym_id <> g or not pr.visible then raise exception 'An item in your cart is no longer available.'; end if;
    unit := coalesce(v.price_cents, pr.price_cents);
    insert into public.order_items (order_id, product_id, variant_id, name, size, color, qty, unit_cents, cost_cents)
    values (oid, pr.id, v.id, pr.name, v.size, v.color, q, unit, pr.cost_cents);
    sub := sub + unit * q;
  end loop;
  update public.orders set subtotal_cents = sub, total_cents = sub where id = oid;
  return jsonb_build_object('order_id', oid, 'subtotal_cents', sub, 'needs_payment', sub > 0);
end $$;

-- Signed in members join a plan; the membership starts pending until payment or the owner activates it.
create or replace function public.site_join_plan(p_plan uuid, p_start date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pl public.plans; me uuid := public.my_profile_id(); mid uuid;
begin
  if me is null then raise exception 'Sign in with your Dandy Strength account to join.'; end if;
  select * into pl from public.plans where id = p_plan and active;
  if pl.id is null then raise exception 'That plan is not available.'; end if;
  select id into mid from public.memberships where gym_id = pl.gym_id and profile_id = me and status in ('pending','active','past_due','paused') limit 1;
  if mid is not null then return jsonb_build_object('membership_id', mid, 'status', 'existing'); end if;
  insert into public.memberships (gym_id, profile_id, plan_id, plan_name, price_cents, interval, status, start_date)
  values (pl.gym_id, me, pl.id, pl.name, pl.price_cents, pl.interval, 'pending', coalesce(p_start, current_date)) returning id into mid;
  return jsonb_build_object('membership_id', mid, 'status', 'pending', 'amount_cents', pl.price_cents);
end $$;

revoke execute on function public.site_guard(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.site_touch_lead(uuid, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.site_gym_id(text) from public;
grant execute on function public.site_gym_id(text) to anon, authenticated;
grant execute on function public.site_public(text) to anon, authenticated;
grant execute on function public.site_submit_lead(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.site_register_event(uuid, text, text, text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.site_request_appointment(uuid, text, text, text, timestamptz, uuid, text) to anon, authenticated;
grant execute on function public.site_place_order(text, jsonb, text, text, text, text, jsonb) to anon, authenticated;
revoke execute on function public.site_join_plan(uuid, date) from public, anon;
grant execute on function public.site_join_plan(uuid, date) to authenticated;

-- Media bucket: public read, first folder is the gym id, only owners and the DSI team can upload.
insert into storage.buckets (id, name, public) values ('gym-media', 'gym-media', true) on conflict (id) do nothing;

create or replace function public.storage_gym(p_name text)
returns uuid language plpgsql immutable set search_path = public as $$
begin return (split_part(p_name, '/', 1))::uuid; exception when others then return null; end $$;

create policy gym_media_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'gym-media' and public.can_manage_site(public.storage_gym(name)));
create policy gym_media_change on storage.objects for update to authenticated
  using (bucket_id = 'gym-media' and public.can_manage_site(public.storage_gym(name)));
create policy gym_media_remove on storage.objects for delete to authenticated
  using (bucket_id = 'gym-media' and public.can_manage_site(public.storage_gym(name)));
