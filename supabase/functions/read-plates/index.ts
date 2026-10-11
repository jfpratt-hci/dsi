// Plate tracker: read the weight on the bar (or the dumbbells or kettlebells) from one photo.
// DSI Pro only. The member confirms or fixes the number in the app, so this only has to be close.
// Needs the secret ANTHROPIC_API_KEY.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const MODEL = Deno.env.get('PLATES_MODEL') ?? Deno.env.get('IMPORT_MODEL') ?? 'claude-sonnet-5';
const KG = 2.20462;

const SCHEMA = {
  type: 'object',
  properties: {
    implement: { type: 'string', enum: ['barbell', 'dumbbell', 'kettlebell', 'none'], description: 'What is being lifted. none when no weight is visible.' },
    side: {
      type: 'array',
      description: 'Barbell only. The plates on ONE sleeve, from the inside out. Assume the other side matches.',
      items: { type: 'object', properties: {
        weight: { type: 'number', description: 'The number on the plate, or your best read from size and color' },
        unit: { type: 'string', enum: ['lb', 'kg'] },
        count: { type: 'number' },
      }, required: ['weight', 'unit', 'count'] },
    },
    each: { type: 'number', description: 'Dumbbell or kettlebell only: the weight of one, in the unit given' },
    each_unit: { type: 'string', enum: ['lb', 'kg'] },
    how_many: { type: 'number', description: 'Dumbbell or kettlebell only: 1 or 2 in use' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    note: { type: 'string', description: 'Short, for the lifter: what you could not see, like "Far plates hidden, assumed they match"' },
  },
  required: ['implement', 'confidence'],
};

const RULES = `Read the weight being lifted in this gym photo.
Barbell: list the plates on one sleeve (the clearest one). Read the printed number first. If you cannot read it, use the color and size.
Most US CrossFit gyms use colored lb bumpers: red 55, blue 45, yellow 35, green 25, white or gray 10, small change plates 5 and 2.5. Kilo bumpers use the same colors (red 25 kg, blue 20, yellow 15, green 10, white 5); call them kg only when you can see KG on them.
Full size black bumpers or iron plates with no readable number are usually 45 lb. Ignore collars and clips.
Dumbbells and kettlebells: read the number on the bell, give one bell's weight and how many are in use. A kettlebell marked in pood: 1 pood is 35 lb, 1.5 is 53, 2 is 70.
If no weight is visible, say none. Be honest about confidence.`;

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: u } = await sb.auth.getUser();
    if (!u?.user) return json({ error: 'Sign in first.' }, 401);
    const { data: me } = await sb.from('profiles').select('id,role,tier').eq('user_id', u.user.id).maybeSingle();
    if (!me || !(me.tier === 'pro' || ['admin', 'commissioner'].includes(me.role))) return json({ error: 'Reading the plates is part of DSI Pro.' }, 403);
    const key = Deno.env.get('ANTHROPIC_API_KEY');
    if (!key) return json({ error: 'The plate reader is not switched on yet.' }, 503);

    const { image, bar, lift } = await req.json();
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(image || ''));
    if (!m) return json({ error: 'No photo came through. Try again.' }, 400);
    if (m[2].length > 4_000_000) return json({ error: 'That photo is too big.' }, 413);
    const barLb = [45, 35, 15].includes(+bar) ? +bar : 45;

    const ai = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 800,
        system: 'You read barbell plates, dumbbells and kettlebells from gym photos for a lifting app. You are exact and say when you are unsure.',
        tools: [{ name: 'weight_seen', description: 'Return what is loaded', input_schema: SCHEMA }],
        tool_choice: { type: 'tool', name: 'weight_seen' },
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
          { type: 'text', text: `${RULES}\n${lift ? `The lifter says the movement is: ${String(lift).slice(0, 60)}.` : ''}` },
        ] }],
      }),
    });
    const out = await ai.json();
    if (!ai.ok) return json({ error: out?.error?.message ?? 'The plate reader failed. Try again.' }, 502);
    const t = (out.content ?? []).find((c: { type: string }) => c.type === 'tool_use');
    if (!t) return json({ error: 'Could not read that. Try again closer to the bar.' }, 422);
    const r = t.input as { implement: string; side?: { weight: number; unit: string; count: number }[]; each?: number; each_unit?: string; how_many?: number; confidence: string; note?: string };

    const lb = (w: number, unit?: string) => (unit === 'kg' ? w * KG : w);
    const half = (x: number) => Math.round(x * 2) / 2;
    let total = 0, label = '';
    if (r.implement === 'barbell') {
      const side = (r.side ?? []).filter(p => p.weight > 0 && p.count > 0);
      const perSide = side.reduce((a, p) => a + lb(p.weight, p.unit) * p.count, 0);
      total = half(barLb + 2 * perSide);
      label = side.length ? `Each side: ${side.map(p => (p.count > 1 ? `${p.count} × ` : '') + `${p.weight}${p.unit === 'kg' ? ' kg' : ''}`).join(' + ')}, on a ${barLb} lb bar` : `Empty ${barLb} lb bar`;
    } else if (r.implement === 'dumbbell' || r.implement === 'kettlebell') {
      total = half(lb(r.each ?? 0, r.each_unit));
      const n = r.how_many === 2 ? 2 : 1;
      label = `${n === 2 ? 'Two' : 'One'} ${total} lb ${r.implement}${n === 2 ? 's' : ''}`;
      return json({ implement: r.implement, total, pair: n === 2, label, confidence: r.confidence, note: r.note ?? '' });
    } else label = 'No weight seen';
    return json({ implement: r.implement, total, label, confidence: r.confidence, note: r.note ?? '' });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
