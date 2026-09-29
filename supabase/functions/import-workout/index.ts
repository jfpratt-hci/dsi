// Import workouts from a gym web page or screenshots and return DSI week drafts.
// Staff only. Nothing is saved here: the page shows the draft and the admin saves it.
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
          sections: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, text: { type: 'string' } }, required: ['name', 'text'] } },
          lifts: {
            type: 'array',
            description: 'Loaded movements a lifter would enter a weight for. Empty on rest days or bodyweight only days.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'short lowercase id, unique within the day, like fs, ohs, rdl, clc' },
                n: { type: 'string', description: 'Movement name' },
                sch: { type: 'string', description: 'Sets x reps or total reps, like "4 x 8" or "30 reps"' },
                b: { type: 'string', enum: ['bench', 'squat', 'dead', 'clean'], description: 'Which of the four DSI lifts this movement scales from' },
                f: { type: 'number', description: 'Target as a fraction of b for percentage work, like 0.65. Omit when rx is used.' },
                rx: { type: 'array', items: { type: 'number' }, description: 'Prescribed weights [Rx, Rx+] in lb for the men\'s standard. Omit when f is used.' },
                max: { type: 'boolean', description: 'True only when the day builds to a heavy single or 1RM of this movement' },
                why: { type: 'string', description: 'One short line explaining the target, like "65% of your deadlift" or "135 Rx. Go 185 once your clean is 265+"' },
              },
              required: ['id', 'n', 'sch', 'b', 'why'],
            },
          },
          score_label: { type: 'string', description: 'What the conditioning is scored by, like Time, Rounds + reps, Load. Empty if not scored.' },
          score_type: { type: 'string', enum: ['time', 'text', ''] },
          rest_note: { type: 'string', description: 'Only for rest days' },
          pr_lift: { type: 'string', enum: ['bench', 'squat', 'deadlift', 'clean', ''], description: 'Set when the day is a max out of one of the four DSI lifts' },
        },
        required: ['day', 'title', 'sections', 'lifts'],
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
    const { data: me } = await sb.from('profiles').select('role').eq('user_id', u.user.id).maybeSingle();
    if (!me || !['admin', 'commissioner'].includes(me.role)) return json({ error: 'Only the Founder and Commissioners can import workouts.' }, 403);

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
Rules: keep the gym's wording in sections (warmup, strength, conditioning), short and clean. Use lb. For each loaded movement pick the DSI base lift it scales from (squat family to squat, hinges and swings to dead, Olympic lifts to clean, presses to bench). Use f for percentage or hypertrophy work (typical: front squat 0.58, overhead squat 0.37, RDL 0.55, sumo deadlift 0.65, strict press 0.45, push press 0.55). Use rx for prescribed WOD weights. Set max true and pr_lift only on max out days. Never invent workouts that are not in the source.` });

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
