// Import workouts from a gym web page or screenshots and return DSI week drafts.
// Plan mode ({ plan }) builds new programming from a gym's goals: first an outline of the cycle, then one week at a time.
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
                reps: { type: 'boolean', description: 'Parts B, C and D only. True when the part is scored by total reps (max reps, AMRAP scored in reps).' },
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

const OUTLINE = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Short name for the cycle, like "Murph Prep" or "10 Week Max Out"' },
    summary: { type: 'string', description: 'Two or three sentences a coach would read to the gym about what this cycle does and why' },
    questions: { type: 'array', items: { type: 'string' }, description: 'Up to 3 short questions whose answers would change the plan a lot. Empty when the goals are clear enough.' },
    phases: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, weeks: { type: 'string', description: 'Like "1-3" or "4"' }, focus: { type: 'string', description: 'One line' } }, required: ['name', 'weeks', 'focus'] } },
    weeks: { type: 'array', description: 'One entry per week of the cycle, in order', items: { type: 'object', properties: {
      n: { type: 'number' }, theme: { type: 'string', description: 'A few words' },
      strength: { type: 'string', description: 'The main lift work this week with sets, reps and percentages, like "Back squat 5x5 at 70%, bench 5x5 at 70%"' },
      conditioning: { type: 'string', description: 'The conditioning emphasis this week, one line' },
      test: { type: 'string', description: 'Only if the week has a test, max out or event day, what it is' },
    }, required: ['n', 'theme', 'strength', 'conditioning'] } },
  },
  required: ['name', 'summary', 'phases', 'weeks'],
};

type Plan = { step: string; goals?: string; gym?: string; length?: string; start?: string; weeks?: number; event?: string; eventName?: string;
  days?: string[]; minutes?: number; level?: string; equipment?: string[]; lifts?: string[]; style?: string; answers?: string; feedback?: string;
  outline?: unknown; week?: number; dates?: string[]; prev?: unknown };

function brief(p: Plan) {
  const l = (k: string, v: unknown) => (v == null || v === '' || (Array.isArray(v) && !v.length) ? '' : `${k}: ${Array.isArray(v) ? v.join(', ') : v}\n`);
  return `Gym: ${p.gym || 'a CrossFit style gym'}\n` + l('Goals for this period', p.goals) + l('Length', p.length === 'day' ? 'one day' : `${p.weeks} week${p.weeks === 1 ? '' : 's'}`) +
    l('Starts', p.start) + l('Event or test day', p.event ? `${p.eventName || 'Event'} on ${p.event}` : '') + l('Class days', p.days) + l('Class length in minutes', p.minutes) +
    l('Members', p.level) + l('Equipment on hand', p.equipment) + l('Main lifts to push', p.lifts) + l('How the gym usually writes a day', p.style) +
    l("Coach's answers to your questions", p.answers) + l('Changes the coach wants', p.feedback);
}

const PLAN_RULES = `How DSI programming works: every class day is Part A, B, C and sometimes D. Part A is the warmup and skill, never tracked. Part B is usually strength, Part C conditioning, Part D optional accessory or core.
Members only log a weight for B, C and D (reps are assumed done), so give each of those parts at most one tracked loaded movement. Use lb.
Track strength work as a fraction f of one of the four DSI lifts (bench, squat, dead, clean) so every member gets their own target from their PRs. Common fractions: back squat 1.0 of squat, front squat 0.58, overhead squat 0.37, RDL 0.55, sumo deadlift 0.65, strict press 0.45, push press 0.55, power clean 0.85 of clean.
Conditioning with a barbell or dumbbell uses rx (men's [Rx, Rx+]) and rxw (women's [Rx, Rx+]). Set time true when a part is for time, reps true when it is scored in total reps.
On a max out or test day set max true on that tracked lift and pr_lift to the lift. Progress sensibly week to week, deload before a test, and keep every day doable in the class length with the listed equipment.`;

async function claude(key: string, system: string, prompt: string, tool: string, desc: string, schema: unknown, max: number) {
  const ai = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: max, system, tools: [{ name: tool, description: desc, input_schema: schema }], tool_choice: { type: 'tool', name: tool }, messages: [{ role: 'user', content: prompt }] }),
  });
  const out = await ai.json();
  if (!ai.ok) return { error: out?.error?.message ?? 'The planner failed. Try again.' };
  const t = (out.content ?? []).find((c: { type: string }) => c.type === 'tool_use');
  return t ? { input: t.input } : { error: 'The planner came back empty. Try again.' };
}

async function planStep(key: string, p: Plan) {
  const sys = 'You are an experienced CrossFit head coach and strength coach writing group class programming for a gym on the Dandy Strength Index. Programming is safe, scalable, progressive and fun, written the way a coach writes a whiteboard: short and clear.';
  if (p.step === 'outline') {
    const r = await claude(key, sys, `${brief(p)}\n${PLAN_RULES}\n\nPlan this cycle. Return the outline with the plan_outline tool: a name, a short summary, phases, and exactly ${p.weeks} weeks. ${p.event ? 'Build toward the event day and taper into it.' : ''} Ask questions only if the answer would change the plan a lot.`, 'plan_outline', 'Return the outline of the cycle', OUTLINE, 6000);
    return r.error ? { error: r.error } : r.input;
  }
  if (p.step === 'week') {
    const dates = (p.dates ?? []).slice(0, 7);
    if (!dates.length) return { error: 'No class days in that week.' };
    const r = await claude(key, sys, `${brief(p)}\nThe approved outline:\n${JSON.stringify(p.outline ?? {})}\n\n${p.prev ? `Last week, for progression:\n${JSON.stringify(p.prev)}\n\n` : ''}${PLAN_RULES}\n\nWrite ${p.length === 'day' ? 'the class' : `week ${p.week}`} now: exactly one day for each of these dates, in order: ${dates.join(', ')}. ${p.event && dates.includes(p.event) ? `${p.event} is the event day (${p.eventName || 'event'}): program the event itself that day.` : ''} Vary the movements and time domains across the week. Return them with the save_days tool.`, 'save_days', 'Return the class days', SCHEMA, 12000);
    return r.error ? { error: r.error } : r.input;
  }
  return { error: 'Unknown plan step.' };
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

    const reqBody = await req.json();
    if (reqBody.plan) { const r = await planStep(key, reqBody.plan as Plan); return json(r, (r as { error?: string }).error ? 502 : 200); }
    const { url, images, start, text } = reqBody;
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
Rules: split each day into Part A, B, C and sometimes D, keeping the gym's wording short and clean. Part A is never tracked. Members only log a weight (reps are assumed done), so for Parts B, C and D set track to the one main loaded movement, or leave it out, set time true when the part is done for time, and set reps true when it is scored by total reps. Use lb. For each tracked movement pick the DSI base lift it scales from (squat family to squat, hinges and swings to dead, Olympic lifts to clean, presses to bench). Use f for percentage or hypertrophy work (typical: front squat 0.58, overhead squat 0.37, RDL 0.55, sumo deadlift 0.65, strict press 0.45, push press 0.55). Use rx for the men's prescribed weights and rxw for the women's (a weight written 95/65 is 95 men, 65 women). Set max true and pr_lift only on max out days. Never invent workouts that are not in the source.` });

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
