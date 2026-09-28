-- Import the original four lifters from the HubSpot version (Sep 26 to 27, 2026)
do $$
declare d uuid; p uuid; r uuid; j uuid;
begin
  perform set_config('dsi.sys','on',true);
  insert into public.profiles (display_name, sex, division, birth_year, bodyweight, role) values ('Dandy','male','men',1981,212,'admin') returning id into d;
  insert into public.profiles (display_name, sex, division, birth_year, bodyweight) values ('Peetahs','male','men',1980,228) returning id into p;
  insert into public.profiles (display_name, sex, division, birth_year, bodyweight) values ('Rogle','male','men',1980,208) returning id into r;
  insert into public.profiles (display_name, sex, division, birth_year, bodyweight, role) values ('JB31','male','men',1979,196,'commissioner') returning id into j;
  insert into public.profile_claims values (d,'johnpratt90@gmail.com'),(p,'andrew@silent.partners'),(r,'akb4@me.com'),(j,'jeffbahl31@yahoo.com');
  insert into public.lift_entries (profile_id, lift, weight_lb, performed_on, source) values
    (d,'bench',195,'2026-09-26','import'),(d,'squat',245,'2026-09-26','import'),(d,'deadlift',275,'2026-09-26','import'),(d,'clean',195,'2026-09-26','import'),
    (p,'bench',285,'2026-09-26','import'),(p,'squat',315,'2026-09-26','import'),(p,'deadlift',315,'2026-09-26','import'),(p,'clean',195,'2026-09-26','import'),
    (r,'bench',325,'2026-09-26','import'),(r,'squat',315,'2026-09-26','import'),(r,'deadlift',375,'2026-09-26','import'),(r,'clean',260,'2026-09-26','import'),
    (j,'bench',280,'2026-09-26','import'),(j,'squat',325,'2026-09-26','import'),(j,'deadlift',405,'2026-09-26','import'),(j,'clean',235,'2026-09-26','import');
  insert into public.lift_entries (profile_id, lift, weight_lb, performed_on, source) values (d,'bench',200,'2026-09-27','import');
  insert into public.goals (profile_id, lift, target_lb) values
    (d,'bench',225),(d,'squat',315),(d,'deadlift',315),(d,'clean',225),
    (p,'bench',320),(p,'squat',335),(p,'deadlift',355),(p,'clean',215),
    (r,'bench',330),(r,'squat',335),(r,'deadlift',400),(r,'clean',275),
    (j,'bench',285),(j,'squat',355),(j,'deadlift',445),(j,'clean',260);
end $$;
