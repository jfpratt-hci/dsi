// WHOOP for Dandy Strength (DSI Pro).
// From the website or app, signed in:  { action: 'start' }  -> { url } to send the member to WHOOP
//                                       { action: 'finish', code, state } after WHOOP sends them back
//                                       { action: 'sync' }  pull the last two weeks of recovery, sleep and strain
//                                       { action: 'disconnect' }
// From WHOOP: webhook POSTs (signed with our client secret) when a recovery, sleep or workout is scored.
// Secrets: WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET. Redirects to register with WHOOP: https://dandystrength.com/connect/whoop and dsi://connect/whoop.
// Deployed with JWT checks off so WHOOP can reach the webhook; every member action checks the session itself.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const AUTH = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const TOKEN = 'https://api.prod.whoop.com/oauth/oauth2/token';
const API = 'https://api.prod.whoop.com/developer';
const SCOPES = 'offline read:recovery read:cycles read:sleep read:workout read:profile read:body_measurement';
const env = (k: string) => Deno.env.get(k) ?? '';
// The website comes back to the Connected apps page; the phone app comes back through its own link (dsi://).
const REDIRECT = (app?: boolean) => (app ? env('WHOOP_REDIRECT_APP') || 'dsi://connect/whoop' : env('WHOOP_REDIRECT') || 'https://dandystrength.com/connect/whoop');
const admin = () => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

type Tok = { access_token: string; refresh_token?: string; expires_in: number; scope?: string };

async function tokenCall(form: Record<string, string>): Promise<Tok> {
  const r = await fetch(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || !out.access_token) throw new Error(out.error_description || out.error || `WHOOP said ${r.status}`);
  return out as Tok;
}
async function saveTok(db: SupabaseClient, pid: string, t: Tok, oldRefresh?: string | null) {
  const { error } = await db.from('wearable_tokens').upsert({ profile_id: pid, provider: 'whoop', access_token: t.access_token, refresh_token: t.refresh_token ?? oldRefresh ?? null,
    expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(), scope: t.scope ?? null, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// A fresh access token for this member. WHOOP replaces the refresh token on every refresh, so save both.
async function accessFor(db: SupabaseClient, pid: string): Promise<string> {
  const { data: t } = await db.from('wearable_tokens').select('*').eq('profile_id', pid).eq('provider', 'whoop').maybeSingle();
  if (!t) throw new Error('WHOOP is not connected.');
  if (new Date(t.expires_at).getTime() > Date.now()) return t.access_token;
  if (!t.refresh_token) throw new Error('Reconnect WHOOP.');
  try {
    const n = await tokenCall({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: env('WHOOP_CLIENT_ID'), client_secret: env('WHOOP_CLIENT_SECRET'), scope: 'offline' });
    await saveTok(db, pid, n, t.refresh_token);
    return n.access_token;
  } catch (e) {
    // Another sync may have just refreshed it: use theirs if so.
    const { data: again } = await db.from('wearable_tokens').select('access_token,expires_at').eq('profile_id', pid).eq('provider', 'whoop').maybeSingle();
    if (again && new Date(again.expires_at).getTime() > Date.now()) return again.access_token;
    await db.from('wearable_links').update({ status: 'reconnect' }).eq('profile_id', pid).eq('provider', 'whoop');
    throw e;
  }
}

async function getAll(token: string, path: string, start: string) {
  const out: any[] = [];
  let next = '';
  for (let i = 0; i < 6; i++) {
    const q = new URLSearchParams({ limit: '25', start, ...(next ? { nextToken: next } : {}) });
    const r = await fetch(`${API}${path}?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 429) break;
    if (!r.ok) throw new Error(`WHOOP ${path} answered ${r.status}`);
    const j = await r.json();
    out.push(...(j.records ?? []));
    next = j.next_token ?? '';
    if (!next) break;
  }
  return out;
}

// WHOOP times are UTC with the member's offset alongside, like "-04:00". The day is the member's local date.
const localDay = (iso: string, off?: string, plusHours = 0) => {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(off || '+00:00');
  const mins = m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0;
  return new Date(new Date(iso).getTime() + (mins + plusHours * 60) * 60000).toISOString().slice(0, 10);
};

async function sync(db: SupabaseClient, pid: string, days = 14) {
  const token = await accessFor(db, pid);
  const start = new Date(Date.now() - days * 86400000).toISOString();
  const [sleeps, recs, cycles] = await Promise.all([getAll(token, '/v2/activity/sleep', start), getAll(token, '/v2/recovery', start), getAll(token, '/v2/cycle', start)]);
  const rows = new Map<string, Record<string, unknown>>();
  const row = (day: string) => { if (!rows.has(day)) rows.set(day, { profile_id: pid, provider: 'whoop', day, updated_at: new Date().toISOString() }); return rows.get(day)!; };
  // Sleep: the night counts toward the day you wake up.
  const sleepDay = new Map<string, string>();
  for (const s of sleeps) {
    if (s.nap || !s.end) continue;
    const day = localDay(s.end, s.timezone_offset);
    sleepDay.set(String(s.id), day);
    if (s.score_state !== 'SCORED' || !s.score) continue;
    const st = s.score.stage_summary ?? {};
    const asleep = (st.total_light_sleep_time_milli ?? 0) + (st.total_slow_wave_sleep_time_milli ?? 0) + (st.total_rem_sleep_time_milli ?? 0);
    const r = row(day);
    r.sleep_hours = Math.round(asleep / 36000) / 100;
    if (s.score.sleep_performance_percentage != null) r.sleep_perf = Math.round(s.score.sleep_performance_percentage);
  }
  // Recovery is scored off that sleep.
  for (const x of recs) {
    if (x.score_state !== 'SCORED' || !x.score) continue;
    const day = sleepDay.get(String(x.sleep_id)) ?? (x.created_at ? x.created_at.slice(0, 10) : null);
    if (!day) continue;
    const r = row(day);
    r.recovery = Math.round(x.score.recovery_score);
    if (x.score.hrv_rmssd_milli != null) r.hrv_ms = Math.round(x.score.hrv_rmssd_milli * 10) / 10;
    if (x.score.resting_heart_rate != null) r.rhr = Math.round(x.score.resting_heart_rate);
  }
  // Day strain: a cycle starts when you fall asleep, so its day is half a day later.
  for (const c of cycles) {
    if (c.score_state !== 'SCORED' || !c.score || !c.start) continue;
    const r = row(localDay(c.start, c.timezone_offset, 12));
    r.strain = Math.round(c.score.strain * 10) / 10;
    if (c.score.kilojoule != null) r.calories = Math.round(c.score.kilojoule / 4.184);
  }
  if (rows.size) { const { error } = await db.from('wearable_days').upsert([...rows.values()]); if (error) throw error; }
  await db.from('wearable_links').update({ last_sync: new Date().toISOString(), status: 'ok' }).eq('profile_id', pid).eq('provider', 'whoop');
  return rows.size;
}

async function verifyWebhook(req: Request, raw: string) {
  const sig = req.headers.get('X-WHOOP-Signature') ?? '', ts = req.headers.get('X-WHOOP-Signature-Timestamp') ?? '';
  if (!sig || !ts || !env('WHOOP_CLIENT_SECRET')) return false;
  if (Math.abs(Date.now() - Number(ts)) > 10 * 60 * 1000) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env('WHOOP_CLIENT_SECRET')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ts + raw)));
  const want = btoa(String.fromCharCode(...mac));
  if (want.length !== sig.length) return false;
  let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return d === 0;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const db = admin();
  try {
    // WHOOP webhook: re-pull that member's last few days.
    if (req.headers.get('X-WHOOP-Signature')) {
      const raw = await req.text();
      if (!(await verifyWebhook(req, raw))) return json({ error: 'bad signature' }, 401);
      const ev = JSON.parse(raw || '{}');
      if (/^(recovery|sleep|workout)\.(updated|deleted)$/.test(ev.type ?? '')) {
        const { data: link } = await db.from('wearable_links').select('profile_id').eq('provider', 'whoop').eq('external_id', String(ev.user_id)).maybeSingle();
        if (link) await sync(db, link.profile_id, 3).catch(e => console.error('webhook sync', e));
      }
      return json({ ok: true });
    }

    // Everything else is a signed in member.
    const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: u } = await sb.auth.getUser();
    if (!u?.user) return json({ error: 'Sign in first.' }, 401);
    const { data: me } = await db.from('profiles').select('id,role,tier').eq('user_id', u.user.id).maybeSingle();
    if (!me) return json({ error: 'Finish joining first.' }, 403);
    const pro = me.tier === 'pro' || ['admin', 'commissioner'].includes(me.role);
    const body = await req.json().catch(() => ({}));
    if (!env('WHOOP_CLIENT_ID') || !env('WHOOP_CLIENT_SECRET')) return json({ error: 'WHOOP is not switched on yet. It goes live as soon as our WHOOP developer app is approved.' }, 503);

    if (body.action === 'start') {
      if (!pro) return json({ error: 'Connecting WHOOP is part of DSI Pro.' }, 403);
      const state = crypto.randomUUID().replace(/-/g, '');
      await db.from('wearable_states').delete().lt('created_at', new Date(Date.now() - 3600000).toISOString());
      const { error } = await db.from('wearable_states').insert({ state, profile_id: me.id, provider: 'whoop' });
      if (error) throw error;
      const q = new URLSearchParams({ client_id: env('WHOOP_CLIENT_ID'), redirect_uri: REDIRECT(!!body.app), response_type: 'code', scope: SCOPES, state });
      return json({ url: `${AUTH}?${q}` });
    }
    if (body.action === 'finish') {
      const { data: st } = await db.from('wearable_states').select('*').eq('state', String(body.state || '')).maybeSingle();
      if (!st || st.profile_id !== me.id || Date.now() - new Date(st.created_at).getTime() > 3600000) return json({ error: 'That WHOOP link expired. Tap Connect again.' }, 400);
      await db.from('wearable_states').delete().eq('state', st.state);
      const t = await tokenCall({ grant_type: 'authorization_code', code: String(body.code || ''), redirect_uri: REDIRECT(!!body.app), client_id: env('WHOOP_CLIENT_ID'), client_secret: env('WHOOP_CLIENT_SECRET') });
      const p = await fetch(`${API}/v2/user/profile/basic`, { headers: { Authorization: `Bearer ${t.access_token}` } }).then(r => (r.ok ? r.json() : {})).catch(() => ({}));
      const { error } = await db.from('wearable_links').upsert({ profile_id: me.id, provider: 'whoop', external_id: p.user_id != null ? String(p.user_id) : null, connected_at: new Date().toISOString(), status: 'ok' });
      if (error) throw error;
      await saveTok(db, me.id, t);
      const n = await sync(db, me.id, 30).catch(e => { console.error(e); return 0; });
      return json({ ok: true, days: n });
    }
    if (body.action === 'sync') {
      if (!pro) return json({ error: 'WHOOP sync is part of DSI Pro.' }, 403);
      return json({ ok: true, days: await sync(db, me.id, 14) });
    }
    if (body.action === 'disconnect') {
      const { data: t } = await db.from('wearable_tokens').select('access_token,expires_at').eq('profile_id', me.id).eq('provider', 'whoop').maybeSingle();
      if (t) await fetch(`${API}/v2/user/access`, { method: 'DELETE', headers: { Authorization: `Bearer ${await accessFor(db, me.id).catch(() => t.access_token)}` } }).catch(() => {});
      await db.from('wearable_links').delete().eq('profile_id', me.id).eq('provider', 'whoop');
      if (body.forget) await db.from('wearable_days').delete().eq('profile_id', me.id).eq('provider', 'whoop');
      return json({ ok: true });
    }
    return json({ error: 'Unknown action.' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
