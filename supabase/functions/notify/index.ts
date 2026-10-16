// Emails for website submissions, sent through Resend.
// Called by the database (notify_event trigger) with the shared x-dsi-hook secret, after each new:
//   lead_messages (a message from a gym website), event_registrations, appointments, orders  -> the gym
//   gym_leads (Bring your gym form) -> Dandy, plus a thank you to the person who filled it in
//   gym_claims (someone asking to own a gym page) -> Dandy
// Secrets: RESEND_API_KEY (required to send). Optional: NOTIFY_FROM, NOTIFY_DANDY_TO.
// Without the key it logs "skipped" and returns, so forms keep working.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SITE = 'https://dandystrength.com';
const FROM = Deno.env.get('NOTIFY_FROM') ?? 'noreply@dandystrength.com';
const DANDY_TO = (Deno.env.get('NOTIFY_DANDY_TO') ?? 'leads@dandystrength.com,dandy@dandystrength.com').split(',').map(s => s.trim()).filter(Boolean);
const DANDY_REPLY = 'dandy@dandystrength.com';
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const money = (c: number | null | undefined) => '$' + ((c ?? 0) / 100).toFixed((c ?? 0) % 100 ? 2 : 0);
const when = (iso?: string | null, tz = 'America/New_York') => iso ? new Date(iso).toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const phoneTxt = (p?: string | null) => p && /^\d{10}$/.test(p) ? `${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}` : (p ?? '');

type Mail = { to: string[]; subject: string; intro: string; rows: [string, unknown][]; button?: [string, string]; reply?: string | null; fromName: string; foot?: string };

function render(m: Mail) {
  const rows = m.rows.filter(([, v]) => v != null && v !== '');
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:Helvetica,Arial,sans-serif;color:#0e1420">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px"><div style="background:#0e1420;color:#f2c94c;font:800 15px Helvetica,Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;padding:14px 20px;border-radius:10px 10px 0 0">${esc(m.fromName)}</div>
  <div style="background:#fff;border:1px solid #dfe4ec;border-top:0;border-radius:0 0 10px 10px;padding:22px 20px">
  <p style="font-size:16px;line-height:1.5;margin:0 0 16px">${m.intro}</p>
  ${rows.length ? `<table style="width:100%;border-collapse:collapse;font-size:15px">${rows.map(([k, v]) => `<tr><td style="padding:7px 0;border-top:1px solid #eef1f6;color:#5b6475;width:38%;vertical-align:top">${esc(k)}</td><td style="padding:7px 0;border-top:1px solid #eef1f6;white-space:pre-wrap">${esc(v)}</td></tr>`).join('')}</table>` : ''}
  ${m.button ? `<p style="margin:20px 0 0"><a href="${esc(m.button[1])}" style="display:inline-block;background:#f2c94c;color:#0e1420;font-weight:700;text-decoration:none;padding:11px 18px;border-radius:8px">${esc(m.button[0])}</a></p>` : ''}
  </div><p style="font-size:12px;color:#7a8394;margin:12px 4px">${m.foot ?? 'Sent by Dandy Strength from a form on your website. Reply to this email to answer them directly.'}</p></div></body></html>`;
  const text = `${m.intro.replace(/<[^>]+>/g, '')}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}${m.button ? `\n\n${m.button[0]}: ${m.button[1]}` : ''}`;
  return { html, text };
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: sec } = await sb.from('app_secrets').select('v').eq('k', 'notify_hook').maybeSingle();
  if (!sec || req.headers.get('x-dsi-hook') !== sec.v) return json({ error: 'forbidden' }, 403);
  const { table, id } = await req.json();
  const key = Deno.env.get('RESEND_API_KEY');
  const log = (row: Record<string, unknown>) => sb.from('email_log').insert({ kind: table, ref: id, ...row });

  // Where a gym's submissions go: the submissions email, else the public email, else the owners' sign in emails.
  const gymTo = async (gid: string) => {
    const { data: g } = await sb.from('gyms').select('id,name,email,notify_email,tz').eq('id', gid).maybeSingle();
    if (!g) return { g: null, to: [] as string[] };
    let to = [g.notify_email || g.email].filter(Boolean) as string[];
    if (!to.length) {
      const { data: st } = await sb.from('gym_staff').select('profile_id').eq('gym_id', gid).eq('role', 'owner');
      const { data: ps } = await sb.from('profiles').select('user_id').in('id', (st ?? []).map(s => s.profile_id));
      for (const p of ps ?? []) { const { data: u } = await sb.auth.admin.getUserById(p.user_id); if (u?.user?.email) to.push(u.user.email); }
    }
    return { g, to };
  };

  const mails: Mail[] = [];
  let gymId: string | null = null;

  if (table === 'lead_messages') {
    const { data: m } = await sb.from('lead_messages').select('*').eq('id', id).maybeSingle();
    if (!m || m.direction !== 'in' || m.channel !== 'web') return json({ skipped: 'not a web message' });
    const { data: l } = await sb.from('leads').select('*').eq('id', m.lead_id).maybeSingle();
    const { g, to } = await gymTo(m.gym_id); gymId = m.gym_id;
    if (g) mails.push({ to, fromName: g.name, reply: l?.email, subject: `New message from your website: ${l?.name || 'someone'}`,
      intro: `<b>${esc(l?.name || 'Someone')}</b> sent a message from the ${esc(g.name)} website.`,
      rows: [['Message', m.body], ['Interested in', l?.interest], ['Email', l?.email], ['Phone', phoneTxt(l?.phone)]], button: ['Open the gym office', `${SITE}/club/${g.id}`] });
  } else if (table === 'event_registrations') {
    const { data: r } = await sb.from('event_registrations').select('*').eq('id', id).maybeSingle();
    if (!r) return json({ skipped: 'gone' });
    const { data: e } = await sb.from('events').select('title,starts_at').eq('id', r.event_id).maybeSingle();
    const { g, to } = await gymTo(r.gym_id); gymId = r.gym_id;
    if (g) mails.push({ to, fromName: g.name, reply: r.email, subject: `Event signup: ${r.name} for ${e?.title ?? 'your event'}`,
      intro: `<b>${esc(r.name)}</b> signed up for <b>${esc(e?.title ?? 'an event')}</b>${e?.starts_at ? ' on ' + esc(when(e.starts_at, g.tz || undefined)) : ''}.`,
      rows: [['Status', r.status === 'pending' ? 'Waiting on payment' : r.status === 'waitlist' ? 'Waitlist, the event is full' : 'Confirmed'], ['Price', r.price_cents ? money(r.price_cents) + (r.pay_at_gym ? ', paying at the gym' : '') : 'Free'],
        ['Division', r.division], ['Team', r.team_name], ['Shirt size', r.shirt_size], ['Email', r.email], ['Phone', phoneTxt(r.phone)]], button: ['Open the gym office', `${SITE}/club/${g.id}`] });
  } else if (table === 'appointments') {
    const { data: a } = await sb.from('appointments').select('*').eq('id', id).maybeSingle();
    if (!a) return json({ skipped: 'gone' });
    const { data: sv } = await sb.from('services').select('name').eq('id', a.service_id).maybeSingle();
    const { g, to } = await gymTo(a.gym_id); gymId = a.gym_id;
    if (g) mails.push({ to, fromName: g.name, reply: a.email, subject: `${a.status === 'waitlist' ? 'Waitlist' : 'Appointment request'}: ${sv?.name ?? 'a service'} from ${a.name}`,
      intro: `<b>${esc(a.name)}</b> ${a.status === 'waitlist' ? 'joined the waitlist for' : 'asked to book'} <b>${esc(sv?.name ?? 'a service')}</b>.`,
      rows: [['When', when(a.starts_at, g.tz || undefined) || 'They will pick a time with you'], ['Price', a.price_cents ? money(a.price_cents) : ''], ['Notes', a.notes], ['Email', a.email], ['Phone', phoneTxt(a.phone)]], button: ['Open the gym office', `${SITE}/club/${g.id}`] });
  } else if (table === 'orders') {
    await new Promise(r => setTimeout(r, 1500)); // the order's lines are written right after the order
    const { data: o } = await sb.from('orders').select('*').eq('id', id).maybeSingle();
    if (!o) return json({ skipped: 'gone' });
    const { data: items } = await sb.from('order_items').select('name,size,color,qty,unit_cents').eq('order_id', id);
    const { g, to } = await gymTo(o.gym_id); gymId = o.gym_id;
    const lines = (items ?? []).map(i => `${i.qty} × ${i.name}${[i.size, i.color].filter(Boolean).length ? ' (' + [i.size, i.color].filter(Boolean).join(', ') + ')' : ''}  ${money(i.unit_cents * i.qty)}`).join('\n');
    if (g) mails.push({ to, fromName: g.name, reply: o.email, subject: `New store order${o.number ? ' #' + o.number : ''}: ${money(o.total_cents ?? o.subtotal_cents)} from ${o.name}`,
      intro: `<b>${esc(o.name)}</b> placed an order in the ${esc(g.name)} store.`,
      rows: [['Items', lines], ['Total', money(o.total_cents ?? o.subtotal_cents)], ['Delivery', o.delivery === 'ship' ? 'Ship it' : 'Pick up at the gym'], ['Ship to', o.ship_to ? Object.values(o.ship_to).filter(Boolean).join(', ') : ''], ['Email', o.email], ['Phone', phoneTxt(o.phone)]], button: ['Open the gym office', `${SITE}/club/${g.id}`] });
  } else if (table === 'gym_leads') {
    const { data: l } = await sb.from('gym_leads').select('*').eq('id', id).maybeSingle();
    if (!l) return json({ skipped: 'gone' });
    mails.push({ to: DANDY_TO, fromName: 'Dandy Strength', reply: l.email, subject: `New gym signup: ${l.gym_name}${l.city ? ' (' + l.city + ')' : ''}`,
      intro: `<b>${esc(l.contact_name)}</b> wants to bring <b>${esc(l.gym_name)}</b> to Dandy Strength. Reply within one business day; the form promised it.`,
      rows: [['Gym', l.gym_name], ['City', l.city], ['Contact', l.contact_name], ['Email', l.email], ['Phone', l.phone], ['Members', l.members], ['Uses now', l.current_software], ['Plan', l.tier], ['Note', l.note]],
      button: ['Open gym leads', `${SITE}/admin`], foot: 'Sent by Dandy Strength from the Bring your gym form. Reply to answer them directly.' });
    if (l.email) {
      const first = String(l.contact_name || '').trim().split(/\s+/)[0] || 'there';
      mails.push({ to: [l.email], fromName: 'Dandy Strength', reply: DANDY_REPLY, subject: `Thanks, ${first}. We got ${l.gym_name}.`,
        intro: `Hi ${esc(first)},<br><br>Thanks for telling us about <b>${esc(l.gym_name)}</b>. We will email you within one business day to set up a time to talk.<br><br>Here is how it goes from there:<br>1. We set up your gym office: your plans, class schedule, waiver and contract.<br>2. We move your members over${l.current_software && !/spreadsheet|something/i.test(l.current_software) ? ' from ' + esc(l.current_software) : ''}, with their history.<br>3. You go live. Members book online and Dandy TV shows the day's workout and everyone's targets.<br><br>Questions before then? Just reply to this email.<br><br>The Dandy Strength team`,
        rows: [], button: ['See how it works', `${SITE}/pricing`], foot: 'You are getting this because you filled in the Bring your gym form on dandystrength.com.' });
    }
  } else if (table === 'gym_claims') {
    const { data: c } = await sb.from('gym_claims').select('*').eq('id', id).maybeSingle();
    if (!c) return json({ skipped: 'gone' });
    const [{ data: g }, { data: p }] = await Promise.all([sb.from('gyms').select('name,city').eq('id', c.gym_id).maybeSingle(), sb.from('profiles').select('display_name').eq('id', c.profile_id).maybeSingle()]);
    gymId = c.gym_id;
    mails.push({ to: DANDY_TO, fromName: 'Dandy Strength', subject: `Gym owner request: ${p?.display_name ?? 'someone'} for ${g?.name ?? 'a gym'}`,
      intro: `<b>${esc(p?.display_name ?? 'Someone')}</b> asked to run the <b>${esc(g?.name ?? 'gym')}</b> page.`, rows: [['Gym', g?.name], ['City', g?.city], ['Their note', c.note]],
      button: ['Review requests', `${SITE}/admin?tab=requests`], foot: 'Sent by Dandy Strength.' });
  } else return json({ skipped: 'unknown table' });

  const out = [];
  for (const m of mails) {
    if (!m.to.length) { await log({ gym_id: gymId, subject: m.subject, status: 'skipped', error: 'no email on file' }); continue; }
    if (!key) { await log({ gym_id: gymId, to_email: m.to.join(', '), subject: m.subject, status: 'skipped', error: 'RESEND_API_KEY not set' }); continue; }
    const { html, text } = render(m);
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${m.fromName.replace(/[<>"]/g, '')} <${FROM}>`, to: m.to, subject: m.subject, html, text, ...(m.reply ? { reply_to: m.reply } : {}) }) });
    const body = await r.json().catch(() => ({}));
    await log({ gym_id: gymId, to_email: m.to.join(', '), subject: m.subject, status: r.ok ? 'sent' : 'failed', error: r.ok ? null : JSON.stringify(body).slice(0, 500) });
    out.push({ to: m.to, ok: r.ok });
  }
  return json({ sent: out });
});
