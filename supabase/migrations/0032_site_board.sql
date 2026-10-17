-- Public gym website board. Members choose to appear on their gym's public website (off by default).
-- site_board shares only: first name and last initial, men or women, the DSI score (computed here, so age and
-- bodyweight never leave the database), the four best lifts, and a PR from the last 7 days if there is one.
alter table public.profiles add column if not exists site_board boolean not null default false;

create or replace function public.site_board(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  with m as (
    select p.display_name::text as dn, p.sex, b.age, b.bw,
      coalesce(b.squat, 0) as squat, coalesce(b.bench, 0) as bench, coalesce(b.dead, 0) as dead, coalesce(b.clean, 0) as clean,
      (select jsonb_build_object('lift', x.lift, 'w', x.w, 'delta', x.w - x.prev, 'ago', current_date - x.d)
         from (values ('squat', b.squat, b.squat_prev, b.squat_date), ('bench', b.bench, b.bench_prev, b.bench_date),
                      ('dead', b.dead, b.dead_prev, b.dead_date), ('clean', b.clean, b.clean_prev, b.clean_date)) as x(lift, w, prev, d)
         where x.d >= current_date - 7 and x.prev is not null and x.w > x.prev
         order by x.d desc limit 1) as pr
    from public.profiles p join public.board b on b.profile_id = p.id
    where p.gym_id = public.site_gym_id(p_key) and p.site_board
      and coalesce(b.squat, b.bench, b.dead, b.clean) is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'n', initcap(split_part(trim(dn), ' ', 1)) ||
           case when position(' ' in trim(dn)) > 0 then ' ' || upper(left(regexp_replace(trim(dn), '^.*\s', ''), 1)) || '.' else '' end,
      'sex', case when sex = 'female' then 'F' else 'M' end,
      'dsi', case when coalesce(bw, 0) = 0 or squat + bench + dead + clean = 0 then 0 else round(
               (squat + bench + dead + clean) / bw * 100
               * case when sex = 'female' then 1.2 else 1 end
               * case when coalesce(age, 0) >= 35 then 1 + (age - 35) * 0.012 else 1 end) end,
      'squat', squat, 'bench', bench, 'dead', dead, 'clean', clean, 'pr', pr)), '[]'::jsonb)
  from m;
$$;
revoke execute on function public.site_board(text) from public;
grant execute on function public.site_board(text) to anon, authenticated;
