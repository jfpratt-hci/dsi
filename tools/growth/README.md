# Growth engine

Dandy Strength finds independent gyms, audits their website, rebuilds it on the Dandy template, and offers the audit and new site free.

## Pieces

| Piece | Where |
|---|---|
| Pipeline tables and public functions | `supabase/migrations/0030_growth_prospects.sql` (prospects, outreach_messages, prospect_views, email_optouts; growth_audit, growth_preview, growth_claim, growth_opt_out) |
| Audit score | `growth_score(facts, city)` in the migration: five areas, 20 points each. Checks we could not confirm are left out and the score is scaled. |
| Owner audit page | `site/audit.html`, at `dandystrength.com/audit?g=<slug>` |
| Redesign preview | `site/preview.html`, at `dandystrength.com/preview?g=<slug>`, built from the gym template by `mkpreview.py` |
| Staff pipeline | `site/growth.html`, at `dandystrength.com/growth` (platform staff only) |
| How to audit a gym | `AUDIT_SPEC.md` |
| Email drafts | `draft_outreach.sql`: three emails per gym, first one waits for approval |

## Weekly run

1. Find owners in Apollo: titles owner, founder, co owner; keywords crossfit, strength and conditioning, functional fitness; US; 1 to 50 employees; verified email. Skip anyone whose Apollo id is already in `prospects.source_ref`.
2. Enrich with `apollo_people_bulk_match` (1 credit each) to get email, website, phone, address.
3. Audit each site per `AUDIT_SPEC.md` (pace Firecrawl: about 15 requests a minute, at most 2 agents at once).
4. Insert into `prospects` (slug via `growth_slug`, status `found`; the trigger scores it and moves it to `audited`). A closed or dead site goes in as `skip`.
5. Run `draft_outreach.sql`. New gyms land in the pipeline as `drafted` for approval.

## Rules

- Never email an address in `email_optouts`; the trigger skips any draft for an opted out gym.
- Every email carries the audit link, which has a one tap opt out, plus a physical mailing address.
- Only facts observed on the gym's own site or Google go into the audit. Unknown is null, never a guess.
