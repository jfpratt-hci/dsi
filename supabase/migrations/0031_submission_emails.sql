-- Emails for website submissions.
-- Gym website forms (messages, event signups, appointment requests, store orders) email the gym: gyms.notify_email,
-- or the gym's public email when that is blank. Dandy's own forms (For gyms signups, gym owner claims) email
-- leads@dandystrength.com. The database calls the notify edge function after each insert; the function sends through Resend.

alter table public.gyms add column if not exists notify_email text check (notify_email is null or notify_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

create table if not exists public.email_log (
  id bigint generated always as identity primary key,
  kind text not null,
  ref uuid,
  gym_id uuid references public.gyms(id) on delete set null,
  to_email text,
  subject text,
  status text not null,          -- sent, skipped, failed
  error text,
  created_at timestamptz not null default now()
);
alter table public.email_log enable row level security;
drop policy if exists email_log_admin on public.email_log;
create policy email_log_admin on public.email_log for select to authenticated using (public.has_role(array['admin']));
revoke all on public.email_log from anon;

-- The shared secret the edge function checks, made here so nobody has to type one.
insert into public.app_secrets (k, v) values ('notify_hook', encode(extensions.gen_random_bytes(24), 'hex')) on conflict (k) do nothing;

create or replace function public.notify_event() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare sec text;
begin
  if tg_table_name = 'lead_messages' then
    if not (to_jsonb(new)->>'direction' = 'in' and to_jsonb(new)->>'channel' = 'web') then return new; end if;
  end if;
  select v into sec from public.app_secrets where k = 'notify_hook';
  if sec is null then return new; end if;
  perform net.http_post(
    url := 'https://fairfhgyrosjqualmhwu.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dsi-hook', sec),
    body := jsonb_build_object('table', tg_table_name, 'id', new.id));
  return new;
exception when others then
  return new; -- an email problem never blocks a sign up
end $$;
revoke execute on function public.notify_event() from public, anon, authenticated;

drop trigger if exists notify_lead_messages on public.lead_messages;
create trigger notify_lead_messages after insert on public.lead_messages for each row execute function public.notify_event();
drop trigger if exists notify_event_registrations on public.event_registrations;
create trigger notify_event_registrations after insert on public.event_registrations for each row execute function public.notify_event();
drop trigger if exists notify_appointments on public.appointments;
create trigger notify_appointments after insert on public.appointments for each row execute function public.notify_event();
drop trigger if exists notify_orders on public.orders;
create trigger notify_orders after insert on public.orders for each row execute function public.notify_event();
drop trigger if exists notify_gym_leads on public.gym_leads;
create trigger notify_gym_leads after insert on public.gym_leads for each row execute function public.notify_event();
drop trigger if exists notify_gym_claims on public.gym_claims;
create trigger notify_gym_claims after insert on public.gym_claims for each row execute function public.notify_event();
