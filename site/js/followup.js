// /follow/<gym>  Gym office: follow up on autopilot.
//   Inbox      every lead and every text, reply from the gym's number, set the free class time and a buddy
//   Automatic  each rule on or off, with its message (blank uses the default), and a live preview
//   Sent       what went out, what is waiting and why
// Texts go out from the gym's text line through the texts edge function, only 9am to 8pm, never after STOP.

export function install(X) {
  const { sb, S, VIEWS, $, $$, esc, toast, must, paint, needLogin, go } = X;
  const works = gid => (S.me && S.me.role === 'admin') || (S.myGyms || []).some(g => g.gym_id === gid);
  const owner = gid => (S.me && S.me.role === 'admin') || (S.myGyms || []).some(g => g.gym_id === gid && g.role === 'owner');
  const RULES = [
    ['lead_reply', 'New lead', 'Within 2 minutes', 'Someone fills in the website or texts the gym. Skipped when a coach already replied.', 'lead'],
    ['trial_reminder', 'Free class reminder', 'Night before, 7pm', 'Sent when a free class time is set on the lead.', 'lead'],
    ['buddy_heads_up', 'Buddy heads up', 'Night before, 7pm', 'Tells the member you picked as buddy who is coming and when.', 'crew'],
    ['after_trial', 'After the free class', '90 minutes after', 'How was it, and the membership link.', 'lead'],
    ['nudge_3', 'Nudge, day 3', '3 days after', 'Stops once you mark them joined or lost.', 'lead'],
    ['nudge_7', 'Second free class, day 7', '7 days after', 'Stops once you mark them joined or lost.', 'lead'],
    ['nudge_14', 'Last check in, day 14', '14 days after', 'The last automatic text a lead gets.', 'lead'],
    ['member_quiet', 'Member slipping', 'No class in 10 days', 'Once each time a regular goes quiet. Members only, after their first 2 weeks.', 'member'],
    ['new_pr', 'New PR', 'Same day', 'One text a day at most, with the lift and the weight.', 'member'],
    ['review_ask', 'Google review ask', 'Day after a PR', 'At most every 4 months, when the gym has a Google review link.', 'member'],
    ['card_failed', 'Card failed', 'When it happens', 'A private note with the link to update their card.', 'member'],
  ];
  const RN = Object.fromEntries(RULES.map(r => [r[0], r[1]]));
  const VARS = '{first} {gym} {link} {when} {address} {buddy_line} {lead} {from} {lift} {weight} {review}';
  const STATUS = [['new', 'New'], ['talking', 'Talking'], ['booked', 'Booked'], ['joined', 'Joined'], ['lost', 'Lost']];
  const phoneTxt = p => /^\d{10}$/.test(p || '') ? `${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}` : (p || '');
  const tFmt = iso => iso ? new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const ago = iso => { if (!iso) return ''; const m = Math.round((Date.now() - Date.parse(iso)) / 6e4); return m < 1 ? 'now' : m < 60 ? m + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd'; };
  const local = iso => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const missing = e => e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === '42703' || /text_outbox|follow_ups|sms_ok|trial_at/.test(e.message || ''));

  VIEWS.follow = async (gid, tok) => {
    if (!S.me) return needLogin(tok, 'follow up with leads and members');
    if (!gid && (S.myGyms || []).length) return go('/follow/' + S.myGyms[0].gym_id, true);
    if (!works(gid)) return paint(tok, '<section class="prEmpty"><b>Staff only</b><p>Gym owners and coaches follow up here.</p></section>');
    const qs = new URLSearchParams(location.search), tab = qs.get('t') || 'inbox', pick = qs.get('lead');
    const [g, lineR, leadsR, rulesR, outR, memR] = await Promise.all([
      sb.from('gyms').select('*').eq('id', gid).maybeSingle().then(must),
      sb.from('text_lines').select('*').eq('gym_id', gid).maybeSingle(),
      sb.from('leads').select('*').eq('gym_id', gid).order('last_message_at', { ascending: false, nullsFirst: false }).limit(300),
      sb.from('follow_ups').select('*').eq('gym_id', gid),
      sb.from('text_outbox').select('*').eq('gym_id', gid).order('created_at', { ascending: false }).limit(150),
      sb.from('memberships').select('profile_id').eq('gym_id', gid).eq('status', 'active'),
    ]);
    if (!g) return paint(tok, '<section class="prEmpty"><b>No gym here</b></section>');
    const off = [leadsR, rulesR, outR].some(r => missing(r.error));
    if (off) return paint(tok, `${X.officeBar(g, 'follow')}<section class="prEmpty"><b>Follow up switches on with the next database update</b><p>The texting part of the database goes in next. Check back shortly.</p></section>`);
    const line = lineR.data, leads = leadsR.data || [], rules = Object.fromEntries((rulesR.data || []).map(r => [r.key, r])), outbox = outR.data || [];
    const memIds = [...new Set((memR.data || []).map(m => m.profile_id))];
    const people = memIds.length ? ((await sb.from('profiles').select('id,display_name').in('id', memIds)).data || []).sort((a, b) => String(a.display_name).localeCompare(String(b.display_name))) : [];
    const ready = !!(line && line.phone_e164), waiting = outbox.filter(t => t.status === 'queued').length, sent7 = outbox.filter(t => t.status === 'sent' && Date.parse(t.sent_at) > Date.now() - 7 * 864e5).length;
    const fresh = leads.filter(l => l.status === 'new').length, canEdit = owner(gid) || X.isStaff();
    const tabs = [['inbox', `Inbox${fresh ? ` <span class="fuN">${fresh}</span>` : ''}`], ['auto', 'Automatic texts'], ['sent', `Sent and waiting${waiting ? ` <span class="fuN">${waiting}</span>` : ''}`]];
    const head = `${X.officeBar(g, 'follow')}<section class="sec fuTop">
        <div class="fuStat${ready ? ' ok' : ''}"><span class="grLbl">Text line</span><b>${ready ? esc(phoneTxt(line.phone_e164.slice(-10))) : 'Not set up yet'}</b><span class="hint">${ready ? 'Texts send from this number, 9am to 8pm' : 'Texts wait in the queue until Dandy connects your number'}</span></div>
        <div class="fuStat"><span class="grLbl">Leads talking</span><b>${leads.filter(l => ['new', 'talking', 'booked'].includes(l.status)).length}</b><span class="hint">${fresh} new</span></div>
        <div class="fuStat"><span class="grLbl">Sent this week</span><b>${sent7}</b><span class="hint">${waiting} waiting</span></div>
        <div class="fuStat"><span class="grLbl">Joined from leads</span><b>${leads.filter(l => l.status === 'joined').length}</b><span class="hint">of ${leads.length} leads</span></div>
      </section>
      <section class="sec fuBody"><nav class="tabs" aria-label="Follow up">${tabs.map(([k, n]) => `<a class="tab" href="/follow/${gid}?t=${k}"${k === tab ? ' aria-selected="true" aria-current="page"' : ''}>${n}</a>`).join('')}</nav>`;

    /* ---------- inbox ---------- */
    if (tab === 'inbox') {
      const cur = leads.find(l => l.id === pick) || leads[0] || null;
      const msgs = cur ? ((await sb.from('lead_messages').select('*').eq('lead_id', cur.id).order('created_at')).data || []) : [];
      const curOut = cur ? outbox.filter(t => t.lead_id === cur.id && t.status === 'queued') : [];
      const list = leads.length ? leads.map(l => `<a class="fuLead${cur && l.id === cur.id ? ' on' : ''}" href="/follow/${gid}?t=inbox&lead=${l.id}"><b>${esc(l.name || phoneTxt(l.phone) || l.email || 'Someone')}</b><span class="pill ${l.status === 'new' ? 'acc' : l.status === 'joined' ? 'up' : l.status === 'lost' ? 'down' : ''}">${esc((STATUS.find(s => s[0] === l.status) || [, l.status])[1])}</span><small>${esc(l.interest || l.source)}${l.trial_at ? ' · class ' + esc(tFmt(l.trial_at)) : ''}</small><em>${ago(l.last_message_at || l.created_at)}</em></a>`).join('')
        : '<p class="hint" style="padding:16px">No leads yet. They arrive from your website forms, the text us box and texts to your number.</p>';
      const thread = cur ? `<div class="fuHead"><div><b>${esc(cur.name || 'No name yet')}</b><span class="hint">${esc(phoneTxt(cur.phone))}${cur.email ? ' · ' + esc(cur.email) : ''} · from ${esc(cur.source)}</span></div>
          ${cur.opted_out ? '<span class="pill down">Replied STOP</span>' : cur.sms_ok ? '<span class="pill up">OK to text</span>' : '<span class="pill">Not opted in to texts</span>'}</div>
        <ol class="fuThread">${msgs.map(m => `<li class="${m.direction === 'in' ? 'in' : 'out'}${m.channel === 'note' ? ' note' : ''}">${esc(m.body)}<time>${esc(tFmt(m.created_at))}${m.direction === 'out' ? ' · ' + (m.channel === 'note' ? 'note' : m.status === 'queued' || m.status === 'draft' ? 'sending' : m.status) : m.channel === 'web' ? ' · website' : ''}</time></li>`).join('') || '<li class="note">No messages yet.</li>'}
          ${curOut.map(t => `<li class="out wait">${esc(t.body)}<time>${esc(RN[t.kind] || t.kind)} · goes out ${esc(tFmt(t.send_after))}${t.error ? ' · ' + esc(t.error) : ''}</time></li>`).join('')}</ol>
        <form id="fuReply" class="fuReply"><label class="vh" for="fu-msg">Reply</label><textarea id="fu-msg" rows="2" maxlength="600" placeholder="${cur.phone && !cur.opted_out ? 'Text ' + esc((cur.name || '').split(' ')[0] || 'them') + ' from the gym number' : 'Add a note for the team'}"></textarea>
          <div class="row"><button class="btn sm" type="submit"${cur.phone && !cur.opted_out ? '' : ' data-note'}>${cur.phone && !cur.opted_out ? 'Send text' : 'Save note'}</button>${cur.phone && !cur.opted_out ? '<button class="btn ghost sm" type="button" id="fu-note">Save as a note</button>' : ''}<span class="hint" id="fu-rmsg">${ready ? '' : 'Your text line is not connected yet, so texts wait until it is.'}</span></div></form>` : '<p class="hint">Pick a lead.</p>';
      const side = cur ? `<form id="fuLeadF" class="formCard fuSide"><h3 class="inH">This lead</h3>
          <div class="field"><label for="fl-n">Name</label><input id="fl-n" maxlength="120" value="${esc(cur.name || '')}"></div>
          <div class="field"><label for="fl-p">Mobile</label><input id="fl-p" type="tel" value="${esc(phoneTxt(cur.phone))}"></div>
          <div class="field"><label for="fl-s">Status</label><select id="fl-s">${STATUS.map(([k, n]) => `<option value="${k}"${cur.status === k ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
          <div class="field"><label for="fl-t">Free class</label><input id="fl-t" type="datetime-local" value="${local(cur.trial_at)}"></div>
          <div class="field"><label for="fl-b">Buddy at the door</label><select id="fl-b"><option value="">No buddy yet</option>${people.map(p => `<option value="${p.id}"${cur.buddy_profile === p.id ? ' selected' : ''}>${esc(p.display_name)}</option>`).join('')}</select></div>
          <div class="field"><label for="fl-r">Brought by</label><select id="fl-r"><option value="">Nobody</option>${people.map(p => `<option value="${p.id}"${cur.referred_by === p.id ? ' selected' : ''}>${esc(p.display_name)}</option>`).join('')}</select></div>
          <label class="check"><input type="checkbox" id="fl-ok"${cur.sms_ok ? ' checked' : ''}${cur.opted_out ? ' disabled' : ''}><span>They agreed to texts from the gym</span></label>
          <button class="btn sm" type="submit">Save</button><span class="hint" id="fl-msg"></span></form>` : '';
      if (!paint(tok, `${head}<div class="fuInbox"><div class="fuList"><button class="btn ghost sm" id="fuAdd" type="button">+ Add a lead</button>${list}</div><div class="fuMain formCard">${thread}</div>${side}</div>
        <dialog id="fuNew" class="fuDlg"><form method="dialog" id="fuNewF"><h3 class="inH">Add a lead</h3>
          <div class="field"><label for="fn-n">Name</label><input id="fn-n" maxlength="120" required></div>
          <div class="field"><label for="fn-p">Mobile</label><input id="fn-p" type="tel" required></div>
          <div class="field"><label for="fn-s">Where from</label><select id="fn-s">${[['walk_in', 'Walked in'], ['referral', 'A member brought them'], ['instagram', 'Instagram'], ['facebook', 'Facebook'], ['google', 'Google'], ['event', 'An event'], ['other', 'Other']].map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></div>
          <label class="check"><input type="checkbox" id="fn-ok"><span>They said the gym can text them</span></label>
          <div class="row"><button class="btn sm" value="save">Add</button><button class="btn ghost sm" value="cancel" formnovalidate>Cancel</button></div></form></dialog></section>`)) return;
      const reload = id => VIEWS.follow(gid, S.tok).then(() => id && history.replaceState(null, '', `/follow/${gid}?t=inbox&lead=${id}`));
      $('#fuAdd').onclick = () => $('#fuNew').showModal();
      $('#fuNewF').onsubmit = async e => {
        if (e.submitter && e.submitter.value === 'cancel') return;
        e.preventDefault();
        const ph = $('#fn-p').value.replace(/\D/g, '').slice(-10);
        if (ph.length !== 10) return toast('Add a 10 digit mobile number');
        const { data, error } = await sb.from('leads').insert({ gym_id: gid, name: $('#fn-n').value.trim(), phone: ph, source: $('#fn-s').value, sms_ok: $('#fn-ok').checked, last_message_at: new Date().toISOString() }).select('id').single();
        if (error) return toast(error.message);
        $('#fuNew').close(); toast('Lead added'); go(`/follow/${gid}?t=inbox&lead=${data.id}`);
      };
      if (!cur) return;
      const send = async note => {
        const body = $('#fu-msg').value.trim(); if (!body) return;
        const { error } = await sb.from('lead_messages').insert({ lead_id: cur.id, gym_id: gid, direction: 'out', channel: note ? 'note' : 'sms', body, sent_by_profile: S.me.id, status: 'queued' });
        if (error) return toast(error.message);
        await sb.from('leads').update({ last_message_at: new Date().toISOString(), ...(cur.status === 'new' && !note ? { status: 'talking' } : {}) }).eq('id', cur.id);
        toast(note ? 'Note saved' : ready ? 'Sending' : 'Queued until your text line is connected'); reload(cur.id);
      };
      $('#fuReply').onsubmit = e => { e.preventDefault(); send(!!e.submitter && e.submitter.dataset.note !== undefined); };
      const nb = $('#fu-note'); if (nb) nb.onclick = () => send(true);
      $('#fuLeadF').onsubmit = async e => {
        e.preventDefault();
        const ph = $('#fl-p').value.replace(/\D/g, '').slice(-10), t = $('#fl-t').value;
        const row = { name: $('#fl-n').value.trim() || null, phone: ph.length === 10 ? ph : null, status: $('#fl-s').value, trial_at: t ? new Date(t).toISOString() : null,
          buddy_profile: $('#fl-b').value || null, referred_by: $('#fl-r').value || null, sms_ok: $('#fl-ok').checked };
        if (row.trial_at && row.status === 'new') row.status = 'booked';
        if (['joined', 'lost'].includes(row.status)) await sb.from('text_outbox').update({ status: 'canceled', error: 'Marked ' + row.status }).eq('lead_id', cur.id).eq('status', 'queued');
        const { error } = await sb.from('leads').update(row).eq('id', cur.id);
        if (error) return ($('#fl-msg').textContent = error.message);
        toast('Saved'); reload(cur.id);
      };
      const th = $('.fuThread'); if (th) th.scrollTop = th.scrollHeight;
      return;
    }

    /* ---------- automatic texts ---------- */
    if (tab === 'auto') {
      const defs = Object.fromEntries(await Promise.all(RULES.map(async ([k]) => [k, (await sb.rpc('fu_default', { k })).data || ''])));
      const card = ([k, n, when, note, who]) => { const r = rules[k] || {}, on = r.enabled !== false;
        return `<article class="formCard fuRule${on ? '' : ' off'}" data-k="${k}"><div class="fuRH"><span class="dxWhen">${esc(when)}</span><label class="tog"><input type="checkbox" data-on${on ? ' checked' : ''}${canEdit ? '' : ' disabled'}><span>${on ? 'On' : 'Off'}</span></label></div>
          <b>${esc(n)}</b><p class="hint">${esc(note)}</p>
          <label class="vh" for="fr-${k}">${esc(n)} message</label><textarea id="fr-${k}" rows="4" maxlength="480" data-body placeholder="${esc(defs[k])}"${canEdit ? '' : ' disabled'}>${esc(r.body || '')}</textarea>
          <p class="fuPrev" data-prev aria-live="polite"></p>
          <div class="row"><button class="btn sm" type="button" data-save${canEdit ? '' : ' disabled'}>Save</button><button class="btn ghost sm" type="button" data-reset${canEdit && r.body ? '' : ' disabled'}>Use the default</button><span class="hint" data-n></span></div></article>`; };
      if (!paint(tok, `${head}<p class="secSub">Each text fills in the person's first name and your gym's details. Leave a message blank to use the default shown in grey. Words in braces fill in: ${esc(VARS)}.</p>
        <h3 class="fuG">New people</h3><div class="fuRules">${RULES.filter(r => r[4] !== 'member').map(card).join('')}</div>
        <h3 class="fuG">Members</h3><div class="fuRules">${RULES.filter(r => r[4] === 'member').map(card).join('')}</div>
        <p class="hint">People only get texts after they agree to them, and every text honors STOP. Members turn texts on in their membership page.</p></section>`)) return;
      $$('.fuRule').forEach(a => {
        const k = a.dataset.k, ta = $('[data-body]', a), pv = $('[data-prev]', a), cnt = $('[data-n]', a);
        let tm; const prev = () => { clearTimeout(tm); tm = setTimeout(async () => { const { data } = await sb.rpc('follow_up_preview', { p_gym: gid, p_key: k, p_body: ta.value }); pv.textContent = data ? 'Taylor gets: ' + data : ''; cnt.textContent = data ? `${data.length} characters${data.length > 160 ? ', ' + Math.ceil(data.length / 153) + ' texts' : ''}` : ''; }, 250); };
        prev(); ta.oninput = prev;
        const save = async patch => { const { error } = await sb.from('follow_ups').upsert({ gym_id: gid, key: k, enabled: $('[data-on]', a).checked, body: ta.value.trim() || null, updated_at: new Date().toISOString(), ...patch }, { onConflict: 'gym_id,key' }); if (error) return toast(error.message); toast('Saved'); };
        $('[data-on]', a).onchange = e => { a.classList.toggle('off', !e.target.checked); $('[data-on] + span', a).textContent = e.target.checked ? 'On' : 'Off'; save({}); };
        $('[data-save]', a).onclick = () => save({});
        $('[data-reset]', a).onclick = () => { ta.value = ''; prev(); save({ body: null }); $('[data-reset]', a).disabled = true; };
      });
      return;
    }

    /* ---------- sent and waiting ---------- */
    const ST = { queued: ['Waiting', 'acc'], sending: ['Sending', 'acc'], sent: ['Sent', 'up'], failed: ['Failed', 'down'], skipped: ['Skipped', ''], canceled: ['Canceled', ''] };
    if (!paint(tok, `${head}<div class="tablewrap"><table class="inT fuOut"><thead><tr><th>When</th><th>To</th><th>Text</th><th>Message</th><th>Status</th><th></th></tr></thead><tbody>
        ${outbox.map(t => `<tr><td class="n">${esc(tFmt(t.sent_at || t.send_after))}</td><td>${esc(t.to_name || '')}<div class="sub">${esc(phoneTxt(t.to_phone.slice(-10)))}</div></td><td>${esc(RN[t.kind] || t.kind)}</td><td class="fuBodyC">${esc(t.body)}${t.error ? `<div class="sub">${esc(t.error)}</div>` : ''}</td><td><span class="pill ${ST[t.status][1]}">${ST[t.status][0]}</span></td><td>${t.status === 'queued' ? `<button class="btn ghost sm" data-cancel="${t.id}">Cancel</button>` : t.lead_id ? `<a class="btn ghost sm" href="/follow/${gid}?t=inbox&lead=${t.lead_id}">Open</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="hint">Nothing yet. Automatic texts show here as they queue and send.</td></tr>'}
      </tbody></table></div></section>`)) return;
    $$('[data-cancel]').forEach(b => b.onclick = async () => { const { error } = await sb.from('text_outbox').update({ status: 'canceled', error: 'Canceled by ' + (S.me.display_name || 'staff') }).eq('id', b.dataset.cancel); if (error) return toast(error.message); toast('Canceled'); VIEWS.follow(gid, S.tok); });
  };
}
