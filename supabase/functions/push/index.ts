// Sends Expo push notifications for new PRs and new programming.
// Called by the database (push_event trigger) with the shared x-dsi-hook secret.
import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const NAMES: Record<string, string> = { bench: 'Bench', squat: 'Squat', deadlift: 'Deadlift', clean: 'Clean', front_squat: 'Front squat', overhead_squat: 'Overhead squat', snatch: 'Snatch', squat_snatch: 'Squat snatch', power_snatch: 'Power snatch', squat_clean: 'Squat clean', power_clean: 'Power clean', clean_and_jerk: 'Clean and jerk', jerk: 'Jerk', strict_press: 'Strict press', push_press: 'Push press', sumo_deadlift: 'Sumo deadlift' };

async function send(msgs: { to: string; title: string; body: string; data: Record<string, unknown> }[]) {
  const dead: string[] = [];
  for (let i = 0; i < msgs.length; i += 100) {
    const chunk = msgs.slice(i, i + 100).map(m => ({ ...m, sound: 'default' }));
    const r = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(chunk) });
    const out = await r.json().catch(() => ({}));
    (out.data ?? []).forEach((t: any, k: number) => { if (t?.details?.error === 'DeviceNotRegistered') dead.push(chunk[k].to); });
  }
  return dead;
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: sec } = await sb.from('app_secrets').select('v').eq('k', 'push_hook').maybeSingle();
  if (!sec || req.headers.get('x-dsi-hook') !== sec.v) return json({ error: 'forbidden' }, 403);
  const ev = await req.json();
  let gym: string | null = null, who: string | null = null, title = '', body = '', data: Record<string, unknown> = {}, pref = 'notify_prs';

  if (ev.type === 'pr') {
    const { data: e } = await sb.from('lift_entries').select('id,profile_id,lift,weight_lb,prev_best,is_pr').eq('id', ev.entry_id).maybeSingle();
    if (!e?.is_pr || !e.prev_best) return json({ skipped: 'not a PR' });
    const { data: p } = await sb.from('profiles').select('display_name').eq('id', e.profile_id).maybeSingle();
    who = e.profile_id;
    title = `New PR: ${p?.display_name ?? 'Someone'}`;
    body = `${NAMES[e.lift] ?? e.lift} ${Number(e.weight_lb)} lb, up ${Number(e.weight_lb) - Number(e.prev_best)}. Protest it or top it.`;
    data = { url: '/prs' };
  } else if (ev.type === 'program') {
    gym = ev.gym_id ?? null;
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { count } = await sb.from('push_log').select('id', { count: 'exact', head: true }).eq('kind', 'program').eq('ref', gym ?? 'dsi').gte('created_at', since);
    if ((count ?? 0) > 0) return json({ skipped: 'already sent' });
    pref = 'notify_program';
    if (gym) {
      const { data: g } = await sb.from('gyms').select('name').eq('id', gym).maybeSingle();
      title = `${g?.name ?? 'Your gym'} posted the workout`;
      body = 'Your target weights are ready. Go see what you are lifting.';
    } else {
      title = 'New programming is up';
      body = 'Your target weights for the week are ready. Go see what you are lifting.';
    }
    data = { url: '/week' };
  } else return json({ error: 'unknown type' }, 400);

  const { data: rows } = await sb.from('push_tokens').select('token, profile_id, profiles!inner(' + pref + ')').eq('profiles.' + pref, true);
  let targets = (rows ?? []).filter((r: any) => r.profile_id !== who);
  if (ev.type === 'program') {
    // A gym's workout goes only to that gym's members.
    const { data: members } = gym ? await sb.from('profiles').select('id').eq('gym_id', gym) : { data: null };
    if (gym) { const ids = new Set((members ?? []).map((m: any) => m.id)); targets = targets.filter((r: any) => ids.has(r.profile_id)); }
  }
  if (who) {
    const { data: bl } = await sb.from('blocks').select('blocker,blocked').or(`blocker.eq.${who},blocked.eq.${who}`);
    const hide = new Set((bl ?? []).map((b: any) => (b.blocker === who ? b.blocked : b.blocker)));
    targets = targets.filter((r: any) => !hide.has(r.profile_id));
  }
  const dead = await send(targets.map((r: any) => ({ to: r.token, title, body, data })));
  if (dead.length) await sb.from('push_tokens').delete().in('token', dead);
  await sb.from('push_log').insert({ kind: ev.type, ref: ev.type === 'program' ? (gym ?? 'dsi') : String(ev.entry_id ?? ''), sent: targets.length });
  return json({ sent: targets.length, removed: dead.length });
});
