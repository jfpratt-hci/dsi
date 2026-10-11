-- Custom services (website, reviews, SEO, API access) as a fourth option on Bring your gym leads.
alter table public.gym_leads drop constraint if exists gym_leads_tier_check;
alter table public.gym_leads add constraint gym_leads_tier_check check (tier in ('base','build','peak','custom','unsure'));
