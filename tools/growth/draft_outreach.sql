-- Drafts the three touch email sequence for every audited prospect that has no drafts yet.
-- Step 1 goes out on approval; steps 2 and 3 go 4 and 10 days after step 1 if there is no reply.
with p as (
  select id, slug, gym_name, score,
    coalesce(nullif(split_part(owner_name, ' ', 1), ''), 'there') as first,
    regexp_replace(coalesce(website, ''), '^https?://(www\.)?|/.*$', '', 'g') as domain,
    audit->'fixes'->0 as top, facts->>'hook' as hook,
    jsonb_array_length(coalesce(site->'schedule'->'classes', '[]'::jsonb)) > 0 as has_sched,
    jsonb_array_length(coalesce(site->'coaches', '[]'::jsonb)) > 0 as has_coaches,
    site is not null as has_site
  from public.prospects
  where status = 'audited' and owner_email is not null and audit is not null
    and not exists (select 1 from public.outreach_messages m where m.prospect_id = prospects.id)
), ins as (
  insert into public.outreach_messages (prospect_id, step, subject, body)
  select id, 1,
    format('%s website audit: %s of 100', gym_name, score),
    format(E'Hi %s,\n\nI ran a free audit of %s the way a new member and Google see it. It scored %s of 100.\n\n%s\n\n%s\n\nYour audit%s: https://dandystrength.com/audit?g=%s\n\nWorth a look? Reply here and I will set it up. If not, there is a one tap opt out on that page and I will not email again.\n\nJohn Pratt\nDandy Strength\n[mailing address]',
      first, domain, score,
      coalesce(hook, 'The biggest gap: ' || lower(left(top->>'check', 1)) || substr(top->>'check', 2) || '. ' || (top->>'why')),
      case when has_site then 'So you can see the fix instead of reading about it, I rebuilt your site on Dandy Strength with your colors' ||
        case when has_sched and has_coaches then ', schedule and coaches' when has_sched then ' and schedule' when has_coaches then ' and coaches' else '' end ||
        '. The rebuild is free to keep.' else 'Dandy Strength fixes all of it, and the new site is free.' end,
      case when has_site then ' and the new site' else '' end, slug)
  from p
  union all
  select id, 2,
    format('Re: %s website audit: %s of 100', gym_name, score),
    format(E'Hi %s,\n\nQuick follow up. The one change on %s that would bring in the most new members: %s. %s\n\n%s\n\nJohn\n\nNot interested? Opt out here and I will stop: https://dandystrength.com/audit?g=%s',
      first, domain, lower(left(top->>'check', 1)) || substr(top->>'check', 2), 'Fix: ' || (top->>'fix'),
      case when has_site then 'Your new site is already built: https://dandystrength.com/preview?g=' || slug else 'Your audit: https://dandystrength.com/audit?g=' || slug end, slug)
  from p
  union all
  select id, 3,
    format('Re: %s website audit: %s of 100', gym_name, score),
    format(E'Hi %s,\n\nLast note from me. Gyms on Dandy Strength get the website, booking, a text line, review asks and their Google profile handled in one place, so the owner can coach instead of chasing leads. The website itself is free.\n\nIf the timing is wrong, no worries. Your audit is here whenever you want it: https://dandystrength.com/audit?g=%s\n\nJohn',
      first, slug)
  from p
  returning prospect_id
)
update public.prospects set status = 'drafted' where id in (select prospect_id from ins);
