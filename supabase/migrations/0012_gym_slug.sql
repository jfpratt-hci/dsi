-- A short, editable big screen link per gym: dandystrength.com/tv/<slug>
alter table public.gyms add column if not exists slug text;
alter table public.gyms drop constraint if exists gyms_slug_format;
alter table public.gyms add constraint gyms_slug_format check (slug is null or slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$');
create unique index if not exists gyms_slug_key on public.gyms (slug);
update public.gyms set slug = 'symmetry' where id = 'f41e6f69-f6a4-410b-9344-4b36d5345fa7' and slug is null;
