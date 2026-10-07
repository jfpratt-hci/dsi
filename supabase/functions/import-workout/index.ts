// Import workouts from a gym web page or screenshots and return DSI week drafts.
// Staff and gym coaches only. Nothing is saved here: the page shows the draft and the admin saves it.
// Needs the secret ANTHROPIC_API_KEY (Supabase dashboard > Edge Functions > Secrets).
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const MODEL = Deno.env.get('IMPORT_MODEL') ?? 'claude-sonnet-5';

const SCHEMA = {
  type: 'object',
  properties: {
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          day: { type: 'string', description: 'YYYY-MM-DD' },
          title: { type: 'string', description: 'Short title, like "Squat hypertrophy + cleans" or "Helen + 2"' },
          parts: {
            type: 'array',
            description: "The day split into Part A, B, C and sometimes D, in the gym's order. Part A is the warmup or skill. If the gym has more than four pieces, put the extras in Part D.",
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Short name like Warmup, Strength, Conditioning, Accessory' },
                text: { type: 'string', description: "The gym's wording for this part, short and clean" },
                time: { type: 'boolean', description: 'Parts B, C and D only. True when members record a time for this part (for time, time cap, race).' },
                track: {
                  type: 'object',
                  description: 'Parts B, C and D only, never Part A. The one loaded movement a member logs a weight for in this part. Omit when the part has no loaded movement.',
                  properties: {
                    n: { type: 'string', description: 'Movement name' },
                    sch: { type: 'string', description: 'Sets x reps, like "5 x 3" or "5 rounds"' },
                    b: { type: 'string', enum: ['bench', 'squat', 'dead', 'clean'], description: 'Which of the four DSI lifts this movement scales from' },
                    f: { type: 'number', description: 'Target as a fraction of b for percentage work, like 0.65. Omit when rx is used.' },
                    rx: { type: 'array', items: { type: 'number' }, description: "Prescribed weights [Rx, Rx+] in lb for the men's standard. Omit when f is used." },
                    rxw: { type: 'array', items: { type: 'number' }, description: "The women's prescribed weights [Rx, Rx+] in lb, like [65, 105] for 95/65 Rx and 155/105 Rx+. Set whenever rx is set and the source gives women's weights." },
                    max: { type: 'boolean', description: 'True only when the part builds to a heavy single or 1RM' },
                    why: { type: 'string', description: 'One short line explaining the target, like "65% of your deadlift"' },
                  },
                  required: ['n', 'sch', 'b', 'why'],
                },
              },
              required: ['name', 'text'],
            },
          },
          rest_note: { type: 'string', description: 'Only for rest days' },
          pr_lift: { type: 'string', enum: ['bench', 'squat', 'deadlift', 'clean', ''], description: 'Set when the day is a max out of one of the four DSI lifts' },
        },
        required: ['day', 'title', 'parts'],
      },
    },
    source: { type: 'string', description: 'Gym or program name if shown' },
    notes: { type: 'string', description: 'Anything you could not read or had to guess' },
  },
  required: ['days'],
};

function pageText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, 60000);
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const auth = req.headers.get('Authorization') ?? '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await sb.auth.getUser();
    if (!u?.user) return json({ error: 'Sign in first.' }, 401);
    const { data: me } = await sb.from('profiles').select('id,role').eq('user_id', u.user.id).maybeSingle();
    let ok = !!me && ['admin', 'commissioner'].includes(me.role);
    if (me && !ok) { const { count } = await sb.from('gym_staff').select('gym_id', { count: 'exact', head: true }).eq('profile_id', me.id); ok = (count ?? 0) > 0; }
    if (!ok) return json({ error: 'Only the Founder, Commissioners and gym coaches can import workouts.' }, 403);

    const key = Deno.env.get('ANTHROPIC_API_KEY');
    if (!key) return json({ error: 'The import reader is not switched on yet. Add the ANTHROPIC_API_KEY secret in Supabase.' }, 503);

    const { url, images, start, text } = await req.json();
    const content: unknown[] = [];
    if (url) {
      if (!/^https?:\/\//i.test(url)) return json({ error: 'That link should start with http or https.' }, 400);
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (DSI workout import)' }, redirect: 'follow' });
      if (!r.ok) return json({ error: `That page answered ${r.status}. Try a screenshot instead.` }, 400);
      const t = pageText(await r.text());
      if (t.length < 80) return json({ error: 'That page had no readable workout text (it may need a login or load by script). Try screenshots instead.' }, 400);
      content.push({ type: 'text', text: `Web page ${url}:\n\n${t}` });
    }
    if (Array.isArray(images)) {
      for (const im of images.slice(0, 10)) {
        const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(String(im));
        if (m) content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
      }
    }
    if (text) content.push({ type: 'text', text: `Pasted text:\n\n${String(text).slice(0, 30000)}` });
    if (!content.length) return json({ error: 'Add a link, a screenshot or some text.' }, 400);

    const today = new Date().toISOString().slice(0, 10);
    content.push({ type: 'text', text: `Today is ${today}. ${start ? `If the workouts do not show dates, the first one is ${start} and each next workout is the next day.` : 'If the workouts do not show dates, start today and go one per day.'}
Convert every workout into a DSI day with the save_days tool.
Rules: split each day into Part A, B, C and sometimes D, keeping the gym's wording short and clean. Part A is never tracked. Members only log a weight (reps are assumed done), so for Parts B, C and D set track to the one main loaded movement, or leave it out, and set time true when the part is done for time. Use lb. For each tracked movement pick the DSI base lift it scales from (squat family to squat, hinges and swings to dead, Olympic lifts to clean, presses to bench). Use f for percentage or hypertrophy work (typical: front squat 0.58, overhead squat 0.37, RDL 0.55, sumo deadlift 0.65, strict press 0.45, push press 0.55). Use rx for the men's prescribed weights and rxw for the women's (a weight written 95/65 is 95 men, 65 women). Set max true and pr_lift only on max out days. Never invent workouts that are not in the source.` });

    const ai = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 8000,
        system: 'You turn gym programming into structured workouts for the Dandy Strength Index. Be exact about reps, weights and movements. If something is unreadable, say so in notes rather than guessing.',
        tools: [{ name: 'save_days', description: 'Return the workouts found', input_schema: SCHEMA }],
        tool_choice: { type: 'tool', name: 'save_days' },
        messages: [{ role: 'user', content }],
      }),
    });
    const out = await ai.json();
    if (!ai.ok) return json({ error: out?.error?.message ?? 'The reader failed. Try again.' }, 502);
    const tool = (out.content ?? []).find((c: { type: string }) => c.type === 'tool_use');
    if (!tool) return json({ error: 'No workouts found in that.' }, 422);
    return json(tool.input);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
