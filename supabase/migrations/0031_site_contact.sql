-- Applied to the Dandy Strength project on 2026-10-16 in the SQL editor (site_contact).

-- Public contact basics for a gym website: name, phone, email, address, hours and social links.
-- Works before a site is published, so a hand built page (dandystrength.com/cfs) can read what the owner keeps in Gym settings.
create or replace function public.site_contact(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', g.name, 'address', g.address, 'city', g.city, 'phone', g.phone, 'email', g.email,
    'hours', coalesce(s.hours, '[]'::jsonb), 'social', coalesce(s.social, '{}'::jsonb))
  from public.gyms g join public.gym_sites s on s.gym_id = g.id
  where g.id = public.site_gym_id(p_key);
$$;
revoke execute on function public.site_contact(text) from public;
grant execute on function public.site_contact(text) to anon, authenticated;

-- CFS: add the CrossFit.com listing and Google reviews to its links.
update public.gym_sites set social = coalesce(social, '{}'::jsonb) || jsonb_build_object(
    'crossfit', 'https://www.crossfit.com/gym/7636/crossfit-symmetry',
    'google', 'https://www.google.com/search?q=CrossFit+Symmetry+Milford+OH+reviews')
  where gym_id = (select id from public.gyms where slug = 'cfs');
