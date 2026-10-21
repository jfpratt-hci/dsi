// Follow up texts for gyms, sent through Twilio from each gym's text line.
// POST JSON with the x-dsi-hook secret (the database calls this every 5 minutes, and right away for a new lead or a coach's reply):
//   queues whatever is due (follow_up_scan), then sends what is due: automatic texts (text_outbox) and coaches' replies (lead_messages).
// POST from Twilio to ?in=1 (signed): a text to a gym's number. STOP and START are honored, replies to a text blast are counted,
// and anything else lands in the gym's inbox.
// Secrets: TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN. Until they are set, texts wait in the queue and nothing is sent.
// Rules kept here: only 9am to 8pm at the gym, never to a number that said STOP, nudges stop once a lead joins.
import { createClient } from 'npm:@supabase/supabase-js@2';

const BASE = 'https://fairfhgyrosjqualmhwu.supabase.co/functions/v1/texts';
const SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
const TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const twiml = () => new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
const STOP = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'REVOKE']);
const START = new Set(['START', 'UNSTOP', 'YES', 'OPTIN']);
const LEAD_ONLY = new Set(['trial_reminder', 'after_trial', 'nudge_3', 'nudge_7', 'nudge_14', 'lead_reply']);
const ten = (p: string) => p.replace(/\D/g, '').slice(-10);
const hourAt = (tz: string) => +new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date());

async function sign(params: Record<string, string>) {
  const data = BASE + '?in=1' + Object.keys(params).sort().map(k => k + params[k]).join('');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(TOKEN), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function twilioSend(line: { phone_e164: string | null; provider_ref: string | null }, to: string, body: string) {
  const f = new URLSearchParams({ To: to, Body: body });
  if (line.provider_ref && line.provider_ref.startsWith('MG')) f.set('MessagingServiceSid', line.provider_ref); else f.set('From', line.phone_e164 ?? '');
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
    method: 'POST', headers: { Authorization: 'Basic ' + btoa(SID + ':' + TOKEN), 'Content-Type': 'application/x-www-form-urlencoded' }, body: f,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j && (j.message || j.code)) ? `${j.code ?? ''} ${j.message ?? ''}`.trim() : 'Twilio ' + r.status);
  return j.sid as string;
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const url = new URL(req.url);

  /* ---------- a text to a gym's number ---------- */
  if (url.searchParams.get('in') === '1') {
    const params: Record<string, string> = {};
    (await req.formData()).forEach((v, k) => { params[k] = String(v); });
    if (!TOKEN || req.headers.get('x-twilio-signature') !== await sign(params)) return json({ error: 'forbidden' }, 403);
    const { data: line } = await sb.from('text_lines').select('gym_id').eq('phone_e164', params.To ?? '').maybeSingle();
    if (!line) return twiml();
    const gid = line.gym_id, ph = ten(params.From ?? ''), body = (params.Body ?? '').trim(), word = body.toUpperCase().replace(/[^A-Z]/g, '');
    if (ph.length !== 10) return twiml();
    if (STOP.has(word)) {
      await sb.from('sms_optouts').upsert({ gym_id: gid, phone: ph });
      await sb.from('leads').update({ opted_out: true }).eq('gym_id', gid).eq('phone', ph);
      await sb.from('text_outbox').update({ status: 'canceled', error: 'Replied STOP' }).eq('gym_id', gid).eq('to_phone', '+1' + ph).eq('status', 'queued');
    } else if (START.has(word)) {
      await sb.from('sms_optouts').delete().eq('gym_id', gid).eq('phone', ph);
      await sb.from('leads').update({ opted_out: false }).eq('gym_id', gid).eq('phone', ph);
    }
    // A reply to a text blast (a survey number, YES to a sign up) is counted on the blast.
    const blast = STOP.has(word) ? null : (await sb.rpc('campaign_reply', { p_gym: gid, p_phone: ph, p_body: body })).data;
    // Into the inbox, as the same person as before when we know the number.
    let { data: lead } = await sb.from('leads').select('id,status').eq('gym_id', gid).eq('phone', ph).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!lead && blast) return twiml(); // a member answering a blast is not a new lead
    if (!lead) {
      const { data: md } = await sb.from('member_details').select('profile_id,legal_name').eq('phone', ph).limit(1).maybeSingle();
      let member = false;
      if (md) { const { count } = await sb.from('memberships').select('id', { count: 'exact', head: true }).eq('gym_id', gid).eq('profile_id', md.profile_id).eq('status', 'active'); member = !!count; }
      const { data: nl } = await sb.from('leads').insert({ gym_id: gid, phone: ph, name: md?.legal_name ?? null, profile_id: md?.profile_id ?? null, source: 'text', sms_ok: !STOP.has(word), opted_out: STOP.has(word), status: member ? 'joined' : 'new', last_message_at: new Date().toISOString() }).select('id,status').single();
      lead = nl;
    } else {
      await sb.from('leads').update({ last_message_at: new Date().toISOString(), sms_ok: !STOP.has(word), ...(lead.status === 'lost' ? { status: 'talking' } : {}) }).eq('id', lead.id);
    }
    if (lead && body) await sb.from('lead_messages').insert({ lead_id: lead.id, gym_id: gid, direction: 'in', channel: 'sms', body: body.slice(0, 2000), provider_ref: params.MessageSid ?? null, status: 'received' });
    return twiml();
  }

  /* ---------- queue what is due, then send it ---------- */
  const { data: sec } = await sb.from('app_secrets').select('v').eq('k', 'texts_hook').maybeSingle();
  if (!sec || req.headers.get('x-dsi-hook') !== sec.v) return json({ error: 'forbidden' }, 403);
  const { gym } = await req.json().catch(() => ({ gym: null }));
  const { data: queued, error: scanErr } = await sb.rpc('follow_up_scan', { p_gym: gym ?? null });
  const ready = !!(SID && TOKEN);
  const now = new Date().toISOString();
  const out = { queued: queued ?? 0, sent: 0, waiting: 0, canceled: 0, failed: 0, scanErr: scanErr?.message };

  const lines = new Map<string, { phone_e164: string | null; provider_ref: string | null; tz: string }>();
  const lineFor = async (gid: string) => {
    if (!lines.has(gid)) {
      const [{ data: l }, { data: g }] = await Promise.all([sb.from('text_lines').select('phone_e164,provider_ref,registration_status').eq('gym_id', gid).maybeSingle(), sb.from('gyms').select('tz').eq('id', gid).maybeSingle()]);
      lines.set(gid, { phone_e164: l?.phone_e164 ?? null, provider_ref: l?.provider_ref ?? null, tz: g?.tz ?? 'America/New_York' });
    }
    return lines.get(gid)!;
  };
  const optedOut = async (gid: string, e164: string) => !!(await sb.from('sms_optouts').select('phone').eq('gym_id', gid).eq('phone', ten(e164)).maybeSingle()).data;

  // Texts nobody could send for 3 days are dropped, so a late text line setup does not fire stale nudges.
  await sb.from('text_outbox').update({ status: 'skipped', error: 'Not sent within 3 days' }).eq('status', 'queued').lt('send_after', new Date(Date.now() - 3 * 864e5).toISOString());

  let q = sb.from('text_outbox').select('*').eq('status', 'queued').lte('send_after', now).order('send_after').limit(100);
  if (gym) q = q.eq('gym_id', gym);
  const { data: due } = await q;
  for (const t of due ?? []) {
    const line = await lineFor(t.gym_id);
    if (!ready || !line.phone_e164) { out.waiting++; if (t.error !== 'Waiting for the text line') await sb.from('text_outbox').update({ error: 'Waiting for the text line' }).eq('id', t.id); continue; }
    const h = hourAt(line.tz); if (h < 9 || h >= 20) { out.waiting++; continue; }
    if (await optedOut(t.gym_id, t.to_phone)) { out.canceled++; await sb.from('text_outbox').update({ status: 'canceled', error: 'Replied STOP' }).eq('id', t.id); continue; }
    if (t.lead_id && LEAD_ONLY.has(t.kind)) {
      const { data: l } = await sb.from('leads').select('status,opted_out').eq('id', t.lead_id).maybeSingle();
      if (!l || l.opted_out || (t.kind !== 'lead_reply' && ['joined', 'lost'].includes(l.status))) { out.canceled++; await sb.from('text_outbox').update({ status: 'canceled', error: l?.opted_out ? 'Opted out' : 'Already ' + (l?.status ?? 'gone') }).eq('id', t.id); continue; }
    }
    // Claim it first so two runs never send the same text.
    const { data: claimed } = await sb.from('text_outbox').update({ status: 'sending' }).eq('id', t.id).eq('status', 'queued').select('id');
    if (!claimed?.length) continue;
    try {
      const ref = await twilioSend(line, t.to_phone, t.body);
      await sb.from('text_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), provider_ref: ref, error: null }).eq('id', t.id);
      if (t.lead_id && t.kind !== 'buddy_heads_up') {
        await sb.from('lead_messages').insert({ lead_id: t.lead_id, gym_id: t.gym_id, direction: 'out', channel: 'sms', body: t.body, provider_ref: ref, status: 'sent' });
        await sb.from('leads').update({ last_message_at: new Date().toISOString() }).eq('id', t.lead_id);
        await sb.from('leads').update({ status: 'talking' }).eq('id', t.lead_id).eq('status', 'new');
      }
      out.sent++;
    } catch (e) {
      out.failed++;
      await sb.from('text_outbox').update({ status: 'failed', error: String((e as Error).message).slice(0, 300) }).eq('id', t.id);
    }
  }

  // A coach's reply typed in the inbox.
  let mq = sb.from('lead_messages').select('id,lead_id,gym_id,body').eq('direction', 'out').eq('channel', 'sms').eq('status', 'queued').order('created_at').limit(50);
  if (gym) mq = mq.eq('gym_id', gym);
  const { data: replies } = await mq;
  for (const m of replies ?? []) {
    const line = await lineFor(m.gym_id);
    if (!ready || !line.phone_e164) { out.waiting++; continue; }
    const { data: l } = await sb.from('leads').select('phone,opted_out').eq('id', m.lead_id).maybeSingle();
    if (!l?.phone || l.opted_out || await optedOut(m.gym_id, '+1' + l.phone)) { await sb.from('lead_messages').update({ status: 'failed' }).eq('id', m.id); out.failed++; continue; }
    const { data: claimed } = await sb.from('lead_messages').update({ status: 'draft' }).eq('id', m.id).eq('status', 'queued').select('id');
    if (!claimed?.length) continue;
    try {
      const ref = await twilioSend(line, '+1' + ten(l.phone), m.body);
      await sb.from('lead_messages').update({ status: 'sent', provider_ref: ref }).eq('id', m.id);
      await sb.from('leads').update({ last_message_at: new Date().toISOString() }).eq('id', m.lead_id);
      out.sent++;
    } catch { await sb.from('lead_messages').update({ status: 'failed' }).eq('id', m.id); out.failed++; }
  }
  return json(out);
});
