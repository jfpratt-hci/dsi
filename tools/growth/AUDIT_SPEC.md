# Gym website audit spec (Dandy Strength growth engine)

For each gym you are given (name, website, city, state), produce ONE JSON object and write all of them as a JSON array to the output file you were given. Only record what you actually observed. When you cannot confirm something, use null (never guess). Never invent prices, class times, coach names, reviews or events.

## How to gather

1. Scrape the home page with `mcp__Firecrawl__firecrawl_scrape` using `formats: ["markdown", "branding", "links"]` and `onlyMainContent: false`. If the home page has links to a schedule, pricing/membership, or coaches/team page, scrape at most 2 of those too (markdown only).
2. Run ONE local search: `mcp__Firecrawl__firecrawl_search` with query `crossfit gym <city> <state>` (limit 10, sources ["web"]). `ranks_local` = true if the gym's domain is in those 10 results, else false.
3. Run ONE search for Google reviews: query `"<gym name>" <city> google reviews rating` (limit 5). Only fill google_rating / google_reviews if a result clearly states the Google rating and Google review count for THIS gym. Otherwise null.

Keep it to about 5 tool calls per gym.

## Output object

```json
{
  "gym_name": "as given",
  "website": "final URL you landed on",
  "gym_type": "CrossFit | strength and conditioning | functional fitness | ...",
  "facts": {
    "https": true,                     // final URL is https
    "viewport": true,                  // page has a mobile viewport meta (Firecrawl metadata.viewport) ; null if unknown
    "title": "exact <title>",
    "meta_description": "exact meta description or empty string if none",
    "h1": "main headline text or empty string",
    "free_trial_offer": true,          // a free class, free intro, free week or no-sweat intro is offered
    "offer_above_fold": true,          // that offer (or a Book / Try / Free class button) appears near the very top of the page
    "online_booking": true,            // visitor can book a class or intro online (booking widget, Wodify/PushPress/Mindbody/Zen Planner/Calendly link)
    "booking_tool": "PushPress",       // name if visible, else null
    "pricing_listed": false,           // any membership price shown on the site
    "schedule_on_site": true,          // class times listed or embedded
    "click_to_call": true,             // a tel: link exists (check links)
    "text_or_chat": false,             // sms: link, chat widget or "text us"
    "lead_form": true,                 // contact / intro request form
    "sells_more": true,                // personal training, events, nutrition coaching or a store is offered
    "copyright_year": 2025,            // from the footer, else null
    "google_rating": null,
    "google_reviews": null,
    "ranks_local": true
  },
  "brand": {
    "name": "Gym name as they write it",
    "short": "2 to 4 letter abbreviation, e.g. CFUS",
    "tagline": "their tagline if any, else empty",
    "bg": "#0B0F18",                   // page background: use their dark brand color if they have one, else a dark navy #0E1420. Must be a dark color.
    "primary": "#hex",                 // their main brand color from branding
    "accent": "#hex",                  // a second brand color that reads well on the dark bg (bright). If they only have one color, use it for both and pick a bright complementary accent.
    "logo": "logo URL from branding or null"
  },
  "site": {
    "config": {
      "hero": { "headline": "Short, punchy headline true to the gym, max 6 words, ending with a period, e.g. 'Tustin's strength home.'", "sub": "1 to 2 sentences in plain words drawn from their site: who it is for, what makes it different, and that the first class is free if they offer that." },
      "announce": { "on": false, "text": "" },
      "contact": { "phone": "212 989 3338 (no dashes or parentheses)", "email": "public gym email if shown else empty", "address": "street address", "city": "City, ST ZIP", "hours": "one line per day group, joined with \\n, only if listed else empty" },
      "social": { "ig": "instagram url or empty", "fb": "facebook url or empty" },
      "sections": { "schedule": true, "plans": true, "events": true, "book": true, "store": true, "coaches": true }
    },
    "schedule": { "classes": [ { "day": 0, "time": "5:30am", "name": "CrossFit", "coach": "" } ] },
    "services": [
      { "id": "intro", "name": "Free intro class", "kind": "class", "price": 0, "priceNote": "Free", "desc": "one line", "length": "60 min", "order": 1 },
      { "id": "dropin", "name": "Drop in", "kind": "class", "price": 0, "priceNote": "as listed, e.g. $25 or Ask us", "desc": "for visiting athletes", "length": "60 min", "order": 2 },
      { "id": "pt", "name": "Personal training", "kind": "appointment", "price": 0, "priceNote": "as listed or 'Ask us'", "desc": "one line", "length": "60 min", "order": 3 }
    ],
    "plans": [ { "id": "unlimited", "name": "Unlimited", "price": 175, "interval": "month", "visits": "Unlimited classes", "blurb": "", "perks": [], "featured": true, "order": 1 } ],
    "coaches": [ { "name": "First Last", "role": "Owner and head coach", "bio": "one short line from their site or empty", "order": 1 } ],
    "events": [],
    "products": []
  }
}
```

Rules for `site`:
- `schedule.classes`: day 0 = Monday ... 6 = Sunday, times like "5:30am". Only if the times are on their site; otherwise an empty array. Cap at 60 entries.
- `services`: include `intro` only if they offer a free or paid intro (use its real price/note); include `dropin` only if they mention drop ins; include `pt` only if they offer personal training. If they offer none of these, still include `intro` with name "Book an intro" and priceNote "Ask us".
- `plans`: only with real listed prices. No prices listed means an empty array.
- `coaches`: only names shown on their site, max 8.
- `events` and `products`: leave empty arrays.
- Plain words, no hyphens or dashes in any text you write (write "drop in", "one on one").

If a site will not load at all, still output the object with facts all null except `https`, and `site` null, and add `"error": "what happened"`.
