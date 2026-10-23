// Gym side of dandystrength.com.
// /gym/<id>      run a gym: post the day, enter results, coaches, gym details; or ask to run it
// /results/<id>  coaches enter members' results for the gym's workout of the day
// /tv/<id>       the big screen: today's workout with every member's targets, live day board, leaderboard, PR alerts
// app.js calls install(ctx) after extra.js so ctx.compete is available.

export function install(X) {
  const { sb, D, S, VIEWS, $, $$, esc, num, fmt, today, pd, fmtD, addDays, monday, toast, must, paint, needLogin, go, loadBoard, isStaff, route } = X;
  const fmtDW = s => pd(s).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const runs = gid => isStaff() || (S.myGyms || []).some(x => x.gym_id === gid);
  const owns = gid => (S.me && S.me.role === 'admin') || (S.myGyms || []).some(x => x.gym_id === gid && x.role === 'owner');

  /* ---------- parts: a day is Part A, B, C and sometimes D ---------- */
  // Part A is never logged. B, C and D can each log one weight (reps are assumed done).
  // Stored on the workout row: sections [{ part, name, text }] and lifts [{ id: 'b', part: 'B', n, sch, b, f | rx, why }].
  const LET = ['A', 'B', 'C', 'D'];
  const PH = { A: 'Warmup', B: 'Strength', C: 'Conditioning', D: 'Accessory' };
  const isParts = w => !!w && ((w.sections || []).some(s => s.part) || (w.lifts || []).some(l => l.part));
  function partsOf(w, withD) {
    const secs = (w && w.sections) || [], lifts = (w && w.lifts) || [], np = isParts(w);
    return LET.map((L, i) => { const s = (np ? secs.find(x => x.part === L) : secs[i]) || {}; return { L, name: s.name || '', text: s.text || '', levels: s.levels || null, clock: s.clock || null, gap: s.gap ?? null, time: !!s.time, reps: !!s.reps, lift: lifts.find(l => l.part === L) || null }; })
      .filter(p => p.L !== 'D' || withD || p.text || p.lift || p.time || p.reps);
  }
  // What a screen shows: the parts with something in them. Older days keep every section they had.
  const shownParts = w => isParts(w) ? partsOf(w).filter(p => p.text || p.lift || p.time || p.reps) : ((w && w.sections) || []).map((s, i) => ({ L: String.fromCharCode(65 + i), name: s.name, text: s.text, lift: null, time: false, reps: false }));
  // The clock a part needs, read from its own words: EMOM 15, a 10 minute cap (counts up), an AMRAP or a
  // "(15 min)" block (counts down). Anything else is a stopwatch. The workout editor saves the coach's pick on the part.
  const suggestClock = text => {
    const t = String(text || ''); let m;
    if (/EMOM|E\.?M\.?O\.?M|every minute/i.test(t) && ((m = /EMOM[^\n]*?(\d+)\s*min/i.exec(t)) || (m = /(\d+)\s*min(?:ute)?s?\s*EMOM/i.exec(t)) || (m = /\((\d+)\s*min/i.exec(t)))) return { mode: 'emom', min: +m[1] };
    if ((m = /(\d+)\s*min(?:ute)?s?\s*(?:time\s*)?cap/i.exec(t)) || (m = /cap[:\s]*(\d+)\s*min/i.exec(t))) return { mode: 'up', min: +m[1] };
    if ((m = /AMRAP\s*(?:in\s*)?(\d+)/i.exec(t)) || (m = /(\d+)\s*min(?:ute)?s?\s*AMRAP/i.exec(t))) return { mode: 'down', min: +m[1] };
    if ((m = /\((\d+)\s*min/i.exec(t)) || (m = /\b(\d+)\s*min(?:ute)?s?\b/i.exec(t))) return { mode: 'down', min: +m[1] };
    return { mode: 'up', min: 0 };
  };
  const clockOf = p => (p && p.clock && p.clock.mode ? p.clock : suggestClock(p && p.text));
  const GAP = 3;
  const liftLabel = l => l.part ? `${l.part} · ${l.n}` : l.n;
  // Everything a member logs for a day, in part order. Weights are kept under the lift id ('b'),
  // times in seconds under '<part>_t' ('b_t'). Older days log their lift list.
  function items(w) {
    if (!w) return [];
    if (!isParts(w)) return (w.lifts || []).map(l => ({ key: l.id, kind: 'w', label: l.n, sch: l.sch, lift: l, L: '' }));
    const out = [];
    for (const p of partsOf(w)) {
      if (p.lift) out.push({ key: p.lift.id, kind: 'w', label: `${p.L} · ${p.lift.n}`, sch: p.lift.sch, lift: p.lift, L: p.L });
      if (p.time) out.push({ key: p.L.toLowerCase() + '_t', kind: 't', label: `${p.L} · ${p.name || 'Part ' + p.L} time`, sch: '', lift: null, L: p.L });
      if (p.reps) out.push({ key: p.L.toLowerCase() + '_r', kind: 'r', label: `${p.L} · ${p.name || 'Part ' + p.L} reps`, sch: 'total reps', lift: null, L: p.L });
    }
    return out;
  }
  const fmtT = s => { s = Math.round(num(s)); if (!s) return ''; const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
  // "8:45" or "1:02:30"; a plain number is minutes.
  const parseT = v => { v = String(v || '').trim(); if (!v) return 0; if (/^\d+(\.\d+)?$/.test(v)) return Math.round(+v * 60); const m = v.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/); return m ? (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3] : NaN; };
  const cell = (it, v) => (it.kind === 't' ? fmtT(v) : num(v) ? fmt(num(v)) : '');
  // What a member logs, in words: "Back squat weight and time".
  const logWords = p => [p.lift ? esc(p.lift.n) + ' weight' : '', p.time ? 'time' : '', p.reps ? 'total reps' : ''].filter(Boolean).join(' and ');
  // The board ranks by the first thing logged: fastest time, or heaviest weight.
  const rankKey = w => { const its = items(w), it = its.find(i => i.lift && i.lift.max) || its[0]; return it || null; };
  // Part D only shows on a board once somebody logged it.
  const boardItems = (w, logs) => items(w).filter(it => it.L !== 'D' || logs.some(x => num((x.entries || {})[it.key])));
  // Beginner, Rx and Comp: the same part three ways. Shown wherever the part is, only the levels the coach wrote.
  const LEVELS = [['beg', 'Beginner'], ['rx', 'Rx'], ['comp', 'Comp']];
  const levelsHtml = (p, cls = '', mine = '') => { const v = p && p.levels; if (!v || !LEVELS.some(([k]) => v[k])) return '';
    const key = { beginner: 'beg', rx: 'rx', comp: 'comp' }[mine] || '';
    return `<div class="lvRow ${cls}">${LEVELS.filter(([k]) => v[k]).map(([k, n]) => `<span class="lv lv-${k}${k === key ? ' mine' : ''}"><b>${n}${k === key ? ' · You' : ''}</b>${esc(v[k])}</span>`).join('')}</div>`; };
  // A member's level and how close they are to the next one. g is what level_progress returns.
  const LVN = { beginner: 'Beginner', rx: 'Rx', comp: 'Comp' };
  const levelCard = (g, recent) => { if (!g) return '';
    const lv = g.level || 'beginner', bar = (n, of) => `<span class="lvBar"><i style="width:${Math.min(100, Math.round(n / of * 100))}%"></i></span>`;
    const next = lv === 'beginner' ? `<div class="lvPath"><div><b>${Math.min(3, g.rx_logs)} of 3</b> logs at the Rx weight ${bar(g.rx_logs, 3)}</div><div class="lvOr">or</div><div><b>${Math.min(8, g.weighted_logs)} of 8</b> weighted logs and <b>${Math.min(2, g.prs)} of 2</b> PRs ${bar(Math.min(8, g.weighted_logs) / 8 + Math.min(2, g.prs) / 2, 2)}</div></div><p class="hint">Either one graduates you to Rx. Counts the last 120 days.</p>`
      : lv === 'rx' ? `<div class="lvPath"><div><b>${Math.min(3, g.comp_logs)} of 3</b> logs at the Comp weight ${bar(g.comp_logs, 3)}</div></div><p class="hint">Three Comp weight days in 120 days moves you up to Comp.</p>`
      : '<p class="hint">Top of the ladder. DI is impressed, and it does not impress easily.</p>';
    return `<div class="lvCard lv-${lv}">${recent && recent.to_level === lv ? `<div class="lvYay">You graduated to ${LVN[recent.to_level]}! <span>${esc(recent.reason || '')}</span></div>` : ''}
      <div class="lvHead"><span class="grLbl">Your level</span><div class="lvSteps">${['beginner', 'rx', 'comp'].map(k => `<span class="${k === lv ? 'on' : ['beginner', 'rx', 'comp'].indexOf(k) < ['beginner', 'rx', 'comp'].indexOf(lv) ? 'done' : ''}">${LVN[k]}</span>`).join('<i></i>')}</div></div>
      ${next}${g.level_by === 'coach' ? '<p class="hint">Set by your coach.</p>' : ''}</div>`; };
  X.levelCard = levelCard; X.LVN = LVN;
  X.parts = { levelsHtml, levelCard, LEVELS, isParts, partsOf, shownParts, liftLabel, items, fmtT, parseT, cell, rankKey, boardItems, logWords };

  // A gym can be reached by its id or its short big screen name (gyms.slug).
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  async function gymIdOf(key) {
    if (UUID.test(key || '')) return key;
    const g = must(await sb.from('gyms').select('id').eq('slug', String(key || '').toLowerCase()).maybeSingle());
    if (!g) throw new Error('No gym here.');
    return g.id;
  }
  const SLUG = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/;
  // Social links a gym website can show, in footer order.
  const SITE_SOC = [['ig', 'Instagram'], ['fb', 'Facebook'], ['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['x', 'X'], ['google', 'Google reviews'], ['yelp', 'Yelp'], ['crossfit', 'CrossFit.com']];

  async function gymData(gid, day) {
    const [g, members, staff, board, ws] = await Promise.all([
      sb.from('gyms').select('*').eq('id', gid).maybeSingle().then(must),
      sb.from('profiles').select('id,display_name,bodyweight,birth_year,sex,tier,role,level').eq('gym_id', gid).not('display_name', 'is', null).then(must),
      sb.from('gym_staff').select('profile_id,role').eq('gym_id', gid).then(must),
      loadBoard(),
      sb.from('workouts').select('*').eq('day', day).or(`gym_id.is.null,gym_id.eq.${gid}`).then(must),
    ]);
    if (!g) throw new Error('No gym here.');
    const w = ws.find(x => x.gym_id === gid) || ws.find(x => !x.gym_id) || null;
    const logs = w ? must(await sb.from('workout_logs').select('*').eq('workout_id', w.id)) : [];
    // Snatch, push press, squat snatch and squat clean bests, so a part can be a percent of those too.
    const ids = members.map(m => m.id), xb = {};
    if (ids.length) ((await sb.from('lift_bests').select('profile_id,lift,weight_lb').in('profile_id', ids).in('lift', D.EXTRA_LIFTS.map(x => x[0]))).data || []).forEach(r => { (xb[r.profile_id] = xb[r.profile_id] || {})[r.lift] = +r.weight_lb; });
    const rowOf0 = m => S.board.find(r => r.profile_id === m.id) || { profile_id: m.id, name: m.display_name, sex: m.sex, bw: num(m.bodyweight) || 185, age: m.birth_year ? new Date().getFullYear() - m.birth_year : 30, bench: 0, squat: 0, dead: 0, clean: 0, score: 0, total: 0 };
    const rowOf = m => ({ ...rowOf0(m), ...(xb[m.id] || {}) });
    return { g, members: members.sort((a, b) => a.display_name.localeCompare(b.display_name)), staff, w, logs, rowOf };
  }

  /* ---------- run a gym ---------- */
  VIEWS.gym = async (gid, tok) => {
    if (!S.me) return needLogin(tok, 'run a gym');
    const { g, members, staff } = await gymData(gid, today());
    if (!runs(gid)) {
      const mine = must(await sb.from('gym_claims').select('*').eq('gym_id', gid).eq('profile_id', S.me.id).order('created_at', { ascending: false }).limit(1));
      const pend = mine[0] && mine[0].status === 'pending';
      if (!paint(tok, `<section class="sec narrow"><div><div class="kicker">${esc(g.name)}</div><h2>Run this <span>gym</span></h2>
        <p class="secSub">Gym owners get a free gym page: post the daily workout, enter results for members, and put a live dashboard on Dandy TV. The DSI team confirms every owner.</p></div>
        ${pend ? `<div class="formCard"><p class="lede" style="margin:0">Your request is in. We'll confirm it soon.</p></div>` : `<form class="formCard" id="clF"><div class="fields"><div class="field w4"><label for="cl-n">Your role at ${esc(g.name)}</label><input id="cl-n" maxlength="300" required placeholder="Owner, head coach, gym website or Instagram so we can confirm"></div></div>
        <div class="row"><button class="btn">Ask to run this gym</button><span class="hint" id="cl-msg">Coaches: ask your owner to add you instead.</span></div></form>`}</section>`)) return;
      const f = $('#clF');
      if (f) f.onsubmit = async e => {
        e.preventDefault();
        const { error } = await sb.from('gym_claims').insert({ gym_id: gid, profile_id: S.me.id, note: $('#cl-n').value.trim() });
        if (error) { $('#cl-msg').textContent = error.message; return; }
        toast('Request sent'); route();
      };
      return;
    }
    const people = new Map(members.map(m => [m.id, m]));
    const staffRows = await Promise.all(staff.map(async s => people.get(s.profile_id) ? { ...s, name: people.get(s.profile_id).display_name } : { ...s, name: ((await sb.from('profiles').select('display_name').eq('id', s.profile_id).maybeSingle()).data || {}).display_name || 'Someone' }));
    const claims = S.me.role === 'admin' ? must(await sb.from('gym_claims').select('*').eq('status', 'pending').order('created_at')) : [];
    const claimNames = claims.length ? new Map(must(await sb.from('profiles').select('id,display_name').in('id', claims.map(c => c.profile_id))).map(p => [p.id, p.display_name])) : new Map();
    const claimGyms = claims.length ? new Map(must(await sb.from('gyms').select('id,name').in('id', claims.map(c => c.gym_id))).map(x => [x.id, x.name])) : new Map();
    const tvUrl = location.origin + '/tv/' + (g.slug || gid);
    const site = owns(gid) ? ((await sb.from('gym_sites').select('hours,social').eq('gym_id', gid).maybeSingle()).data || { hours: [], social: {} }) : null;
    const soc = (site && site.social) || {};
    const hrsTxt = ((site && site.hours) || []).map(h => (h.label || '') + ' | ' + (h.text || '')).join('\n');
    if (!paint(tok, `${X.officeBar(g, 'settings')}<section class="sec"><h3>Gym <span>settings</span></h3><p class="secSub">${members.length} lifters. Dandy TV link, coaches and gym details.</p>
      <div class="formCard"><div class="formH">Dandy TV link<span class="sub">Open it in the TV's browser, a Fire Stick or a laptop on HDMI, then go full screen. No login needed.</span></div>
        <div class="row"><input id="tvUrl" readonly value="${esc(tvUrl)}" style="max-width:420px"><button class="btn ghost sm" type="button" id="tvCopy">Copy link</button></div>
        ${owns(gid) ? `<form class="row" id="slF"><label for="sl-v" class="sub">Change it: ${esc(location.host)}/tv/</label><input id="sl-v" maxlength="40" value="${esc(g.slug || '')}" placeholder="yourgym" autocapitalize="none" spellcheck="false" style="max-width:220px"><button class="btn sm">Save link</button><span class="hint" id="sl-msg">Letters, numbers and dashes. The old link stops working.</span></form>` : ''}</div></section>
    <section class="sec"><h2>Coaches</h2>
      <div class="board"><div class="tablewrap"><table><thead><tr><th>Name</th><th>Role</th><th></th></tr></thead><tbody>
      ${staffRows.map(s => `<tr><td><a href="/u/${s.profile_id}">${esc(s.name)}</a></td><td>${s.role === 'owner' ? 'Owner' : 'Coach'}</td><td class="r">${s.role === 'coach' && owns(gid) ? `<button class="btn ghost sm" data-rmc="${s.profile_id}">Remove</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No coaches yet.</td></tr>'}
      </tbody></table></div></div>
      ${owns(gid) ? `<form class="row" id="coF"><label class="vh" for="co-p">Add a coach</label><select id="co-p" style="max-width:280px"><option value="">Add a coach from your members…</option>${members.filter(m => !staff.some(s => s.profile_id === m.id)).map(m => `<option value="${m.id}">${esc(m.display_name)}</option>`).join('')}</select><button class="btn sm">Add coach</button></form><p class="hint">Coaches can post workouts and enter results. Only owners add or remove coaches.</p>` : ''}</section>
    ${owns(gid) ? `<section class="sec"><form class="formCard" id="gdF"><div class="formH">Gym details</div><div class="fields">
      <div class="field w2"><label for="gd-n">Name</label><input id="gd-n" maxlength="60" value="${esc(g.name)}" required></div>
      <div class="field w2"><label for="gd-c">City</label><input id="gd-c" maxlength="60" value="${esc(g.city || '')}"></div></div>
      <div class="row"><button class="btn">Save</button><span class="hint" id="gd-msg"></span></div></form></section>
    <section class="sec"><form class="formCard" id="wcF"><div class="formH">Website contact and social<span class="sub">Shows in your website's Contact section and footer. Leave a link blank to hide it.</span></div><div class="fields">
      <div class="field"><label for="wc-p">Phone</label><input id="wc-p" type="tel" maxlength="40" value="${esc(g.phone || '')}" placeholder="513 555 0100"></div>
      <div class="field"><label for="wc-e">Email</label><input id="wc-e" type="email" maxlength="120" value="${esc(g.email || '')}" placeholder="hello@yourgym.com"></div>
      <div class="field w2"><label for="wc-n">Email website submissions to</label><input id="wc-n" type="email" maxlength="200" value="${esc(g.notify_email || '')}" placeholder="${esc(g.email || 'you@yourgym.com')}"><span class="hint">Messages, event signups, appointment requests and store orders. Blank uses the email above. Not shown on the site.</span></div>
      <div class="field w2"><label for="wc-a">Street address</label><input id="wc-a" maxlength="200" value="${esc(g.address || '')}" placeholder="1005 Lila Ave, Milford, OH 45150"></div>
      <div class="field w4"><label for="wc-h">Hours, one line each: Days | Times</label><textarea id="wc-h" rows="4" maxlength="1000" placeholder="Mon to Thu | 5:30am to 6:30pm">${esc(hrsTxt)}</textarea></div>
      ${SITE_SOC.map(([k, n]) => `<div class="field w2"><label for="wc-${k}">${n}</label><input id="wc-${k}" type="url" maxlength="300" value="${esc(soc[k] || '')}" placeholder="https://"></div>`).join('')}</div>
      <div class="row"><button class="btn">Save</button><span class="hint" id="wc-msg"></span></div></form></section>` : ''}
    ${claims.length ? `<section class="sec"><h2>Gym owner <span>requests</span></h2><div class="board"><div class="tablewrap"><table><thead><tr><th>Lifter</th><th>Gym</th><th>Their note</th><th></th></tr></thead><tbody>
      ${claims.map(c => `<tr><td><a href="/u/${c.profile_id}">${esc(claimNames.get(c.profile_id) || 'Someone')}</a></td><td><a href="/gyms/${c.gym_id}">${esc(claimGyms.get(c.gym_id) || '')}</a></td><td>${esc(c.note || '')}</td><td class="r"><button class="btn sm" data-cl="${c.id}" data-ok="1">Approve</button> <button class="btn ghost sm" data-cl="${c.id}">Decline</button></td></tr>`).join('')}
      </tbody></table></div></div></section>` : ''}`)) return;
    const sl = $('#slF');
    if (sl) sl.onsubmit = async e => {
      e.preventDefault();
      const v = $('#sl-v').value.trim().toLowerCase().replace(/\s+/g, '-'), m = $('#sl-msg');
      if (v && (!SLUG.test(v) || UUID.test(v))) { m.textContent = 'Use 3 to 40 letters, numbers or dashes, starting and ending with a letter or number.'; return; }
      const { error } = await sb.from('gyms').update({ slug: v || null }).eq('id', gid);
      if (error) { m.textContent = /gyms_slug_key|duplicate/.test(error.message) ? 'Another gym already has that link. Try another.' : error.message; return; }
      toast(v ? 'Dandy TV link is now /tv/' + v : 'Dandy TV link reset'); route();
    };
    $('#tvCopy').onclick = async () => { try { await navigator.clipboard.writeText(tvUrl); toast('Link copied'); } catch { $('#tvUrl').select(); } };
    $$('[data-rmc]').forEach(b => b.onclick = async () => { const { error } = await sb.from('gym_staff').delete().eq('gym_id', gid).eq('profile_id', b.dataset.rmc); if (error) return toast(error.message); toast('Coach removed'); route(); });
    const co = $('#coF');
    if (co) co.onsubmit = async e => { e.preventDefault(); const pid = $('#co-p').value; if (!pid) return; const { error } = await sb.from('gym_staff').insert({ gym_id: gid, profile_id: pid, role: 'coach' }); if (error) return toast(error.message); toast('Coach added'); route(); };
    const gd = $('#gdF');
    if (gd) gd.onsubmit = async e => { e.preventDefault(); const { error } = await sb.from('gyms').update({ name: $('#gd-n').value.trim(), city: $('#gd-c').value.trim() || null }).eq('id', gid); $('#gd-msg').textContent = error ? (/gyms_name_ci/.test(error.message) ? 'Another gym already has that name.' : error.message) : 'Saved.'; };
    const wc = $('#wcF');
    if (wc) wc.onsubmit = async e => {
      e.preventDefault();
      // Keep settings this form doesn't show (like the Instagram photo feed link) so saving here never wipes them.
      const m = $('#wc-msg'), social = Object.fromEntries(Object.entries(soc).filter(([k]) => !SITE_SOC.some(([s]) => s === k)));
      for (const [k, n] of SITE_SOC) {
        const v = $('#wc-' + k).value.trim();
        if (!v) continue;
        if (!/^https:\/\/[^\s]+$/i.test(v)) { m.textContent = n + ' needs a full link starting with https://'; return; }
        social[k] = v;
      }
      const hours = $('#wc-h').value.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 12).map(l => { const i = l.indexOf('|'); return i < 0 ? { label: '', text: l } : { label: l.slice(0, i).trim(), text: l.slice(i + 1).trim() }; });
      const r1 = await sb.from('gyms').update({ phone: $('#wc-p').value.trim() || null, email: $('#wc-e').value.trim() || null, address: $('#wc-a').value.trim() || null, ...('notify_email' in g ? { notify_email: $('#wc-n').value.trim() || null } : {}) }).eq('id', gid);
      if (r1.error) { m.textContent = r1.error.message; return; }
      const r2 = await sb.from('gym_sites').upsert({ gym_id: gid, hours, social }, { onConflict: 'gym_id' });
      m.textContent = r2.error ? r2.error.message : 'Saved. Your website shows it on the next visit.';
    };
    $$('[data-cl]').forEach(b => b.onclick = async () => { const { error } = await sb.rpc('decide_gym_claim', { p_id: b.dataset.cl, p_approve: !!b.dataset.ok }); if (error) return toast(error.message); toast(b.dataset.ok ? 'Approved. They run that gym now.' : 'Declined'); route(); });
  };

  /* ---------- edit a day: /wod/<gym id or dsi>?day=YYYY-MM-DD ---------- */
  const BASE_OPTS = [['squat', 'Squat'], ['dead', 'Deadlift'], ['clean', 'Clean'], ['bench', 'Bench'], ['snatch', 'Snatch'], ['push_press', 'Push press'], ['squat_snatch', 'Squat snatch'], ['squat_clean', 'Squat clean']];
  VIEWS.wod = async (gid, tok) => {
    if (!S.me) return needLogin(tok, 'edit workouts');
    const dsi = gid === 'dsi';
    if (dsi ? !isStaff() : !runs(gid)) return paint(tok, '<section class="prEmpty"><b>Coaches only</b><p>Gym owners and coaches edit their gym\'s workouts.</p></section>');
    const q0 = new URLSearchParams(location.search).get('day');
    const day = /^\d{4}-\d{2}-\d{2}$/.test(q0 || '') ? q0 : today();
    let wq = sb.from('workouts').select('*').eq('day', day);
    wq = dsi ? wq.is('gym_id', null) : wq.eq('gym_id', gid);
    const [g, ws] = await Promise.all([dsi ? { name: 'The DSI week' } : sb.from('gyms').select('id,name,city,slug').eq('id', gid).maybeSingle().then(must), wq.then(must), loadBoard()]);
    if (!g) throw new Error('No gym here.');
    const w = ws[0] || null;
    const nLogs = w ? ((await sb.from('workout_logs').select('id', { count: 'exact', head: true }).eq('workout_id', w.id)).count || 0) : 0;
    const old = w && !isParts(w) && (w.lifts || []).length;
    // The usual class length at this gym, for the class plan (60 minutes when no classes are set up).
    const lens = dsi ? [] : ((await sb.from('classes').select('duration_min').eq('gym_id', gid)).data || []).map(c => c.duration_min).filter(Boolean);
    const classLen = lens.length ? +Object.entries(lens.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1])[0][0] : 60;
    const me = X.boardRow(S.me.id) || { sex: S.me.sex };
    const ps = partsOf(w, true);
    const box = p => {
      const l = p.lift || {}, tt = l.rx && l.rx.length ? 'rx' : l.f ? 'f' : '';
      return `<article class="wodPart" data-p="${p.L}" data-orig="${p.L}"${p.L === 'D' && !p.text && !p.lift && !p.time && !p.reps ? ' hidden' : ''}>
        <div class="wodPH"><span class="wodDrag" title="Drag to move this part" aria-hidden="true">⠿</span><i>${p.L}</i><label class="vh" for="wp-${p.L}">Part ${p.L} name</label><input id="wp-${p.L}" data-name maxlength="40" value="${esc(p.name)}" placeholder="${PH[p.L]}">
          <span class="wodMv"><button type="button" class="btn ghost sm" data-mv="-1" aria-label="Move this part earlier">◀</button><button type="button" class="btn ghost sm" data-mv="1" aria-label="Move this part later">▶</button><button type="button" class="btn ghost sm" data-rm aria-label="Remove this part">✕</button></span></div>
        <label class="vh" for="wt-${p.L}">Part ${p.L} workout</label><textarea id="wt-${p.L}" data-text rows="7" maxlength="2000" placeholder="${p.L === 'A' ? 'Warmup, skill or mobility' : 'Sets, reps and movements'}">${esc(p.text)}</textarea>
        ${(() => { const c = p.clock && p.clock.mode ? p.clock : suggestClock(p.text); return `<div class="wodClock" role="group" aria-label="Part ${p.L} clock"${p.clock && p.clock.mode ? '' : ' data-auto'}><span>Clock</span><label class="vh" for="wcm-${p.L}">Part ${p.L} clock type</label><select id="wcm-${p.L}" data-cm>${[['down', 'Count down'], ['up', 'Count up'], ['emom', 'EMOM'], ['none', 'No clock']].map(([v, n]) => `<option value="${v}"${c.mode === v ? ' selected' : ''}>${n}</option>`).join('')}</select><label class="vh" for="wcn-${p.L}">Part ${p.L} minutes</label><input id="wcn-${p.L}" data-cmin type="number" inputmode="numeric" min="0" max="90" value="${c.min || ''}" placeholder="min"${c.mode === 'none' ? ' disabled' : ''}><span>min</span></div>`; })()}
        <div class="wodLv" role="group" aria-label="Part ${p.L} levels"><span>Levels <small>optional</small></span>${[['beg', 'Beginner', 'Ring rows, 45/35 lb'], ['rx', 'Rx', 'As written'], ['comp', 'Comp', 'Chest to bar, 115/80 lb']].map(([k, n, ph]) => `<label class="vh" for="wl${k}-${p.L}">Part ${p.L} ${n}</label><input id="wl${k}-${p.L}" data-lv="${k}" maxlength="160" value="${esc((p.levels && p.levels[k]) || '')}" placeholder="${n}: ${ph}">`).join('')}</div>
        ${`
        <div class="wodTog" role="group" aria-label="What members log for Part ${p.L}"><span>Members log</span>
          <label class="tog"><input type="checkbox" data-trk${p.lift ? ' checked' : ''}><span>Weight</span></label>
          <label class="tog"><input type="checkbox" data-time${p.time ? ' checked' : ''}><span>Time</span></label>
          <label class="tog"><input type="checkbox" data-reps${p.reps ? ' checked' : ''}><span>Reps</span></label></div>
        <div class="wodTrk"${p.lift ? '' : ' hidden'}>
          <div class="field"><label for="wn-${p.L}">Movement</label><input id="wn-${p.L}" data-n maxlength="60" value="${esc(l.n || '')}" placeholder="Front squat"></div>
          <div class="field"><label for="ws-${p.L}">Scheme</label><input id="ws-${p.L}" data-sch maxlength="60" value="${esc(l.sch || '')}" placeholder="5 x 3, build"></div>
          <div class="field"><label for="wi-${p.L}">Equipment</label><select id="wi-${p.L}" data-imp>${[['', 'Barbell'], ['db', 'Dumbbell'], ['kb', 'Kettlebell']].map(([v, n]) => `<option value="${v}"${(l.imp || '') === v ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
          <div class="field" data-imponly><span class="lbl">How many</span><label class="tog"><input type="checkbox" data-pair${l.pair ? ' checked' : ''}><span>A pair</span></label></div>
          <div class="field"><label for="wtt-${p.L}">Target weight</label><select id="wtt-${p.L}" data-tt><option value=""${tt === '' ? ' selected' : ''}>No target</option><option value="f"${tt === 'f' ? ' selected' : ''} data-bar>Percent of a lift</option><option value="rx"${tt === 'rx' ? ' selected' : ''}>Rx and Rx+ weights</option></select></div>
          <div class="field" data-for="f rx"><label for="wb-${p.L}">Based on their</label><select id="wb-${p.L}" data-b>${BASE_OPTS.map(([k, n]) => `<option value="${k}"${(l.b || 'squat') === k ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
          <div class="field" data-for="f"><label for="wf-${p.L}">Percent</label><input id="wf-${p.L}" data-f type="number" inputmode="numeric" min="1" max="150" value="${l.f ? Math.round(l.f * 100) : ''}" placeholder="75"></div>
          ${[['rx0', 'Rx men', l.rx && l.rx[0], '95'], ['rxw0', 'Rx women', l.rxw && l.rxw[0], '65'], ['rx1', 'Rx+ men', l.rx && l.rx[1] !== l.rx[0] && l.rx[1], 'optional'], ['rxw1', 'Rx+ women', l.rxw && l.rxw[1] !== l.rxw[0] && l.rxw[1], 'optional']]
            .map(([k, t, v, ph]) => `<div class="field" data-for="rx"><label for="w${k}-${p.L}">${t} lb</label><input id="w${k}-${p.L}" data-${k} type="number" inputmode="numeric" min="1" max="1499" value="${v || ''}" placeholder="${ph}"></div>`).join('')}
          <p class="hint" data-prev></p>
        </div>`}
      </article>`;
    };
    const dest = dsi ? '/week/' + day + (S.me.gym_id ? '?src=dsi' : '') : '/week/' + day;
    if (!paint(tok, `${dsi ? '' : X.officeBar(g, 'wod')}<section class="sec"><div class="secHead"><div><div class="kicker">${esc(g.name)} · ${esc(fmtDW(day))}</div><h2>${w ? 'Edit the' : 'Post the'} <span>workout</span></h2>
        <p class="secSub">Drag a part by its handle, or use the arrows, to change the order; the letters follow the order. Each part can log a weight, a time, total reps, or any mix. Everyone is assumed to do all the reps.</p></div>
        <div class="row"><a class="btn ghost sm" href="/wod/${gid}?day=${addDays(day, -1)}">← Day before</a><input type="date" id="wd-day" value="${day}" aria-label="Pick a day" style="max-width:170px"><a class="btn ghost sm" href="/wod/${gid}?day=${addDays(day, 1)}">Next day →</a><a class="btn ghost sm" href="/program${dsi ? '' : '?gym=' + gid}">Import a week</a></div></div></section>
      <section class="sec"><form id="wodF" class="wodEd">
        <div class="field"><label for="wd-t">Title</label><input id="wd-t" maxlength="80" value="${esc((w && w.title) || '')}" placeholder="Front squat + Grace"></div>
        ${old ? '<p class="hint" style="color:var(--flat)">This day still has the old lift list. Saving switches it to Parts, so pick the weight each part logs.</p>' : ''}
        <div class="formCard wodPlan" id="wodPlan"><div class="wodPlanH"><b>Class plan</b><label for="wd-gap">Between parts</label><input id="wd-gap" type="number" inputmode="numeric" min="0" max="15" value="${(ps.find(x => x.gap != null) || {}).gap ?? GAP}"><span>min</span><label for="wd-len">Class</label><input id="wd-len" type="number" inputmode="numeric" min="15" max="180" value="${classLen}"><span>min</span></div><div class="wodBar" id="wodBar"></div><p class="hint" id="wodPlanMsg"></p></div>
        <div class="wodGrid">${ps.map(box).join('')}</div>
        <div class="row wodAdd"><button type="button" class="btn ghost sm" id="addFirst">+ Add a part at the start</button><button type="button" class="btn ghost sm" id="addD">+ Add a part at the end</button><span class="hint" id="addMsg"></span></div>
        <div class="row" style="margin-top:16px"><button class="btn" type="submit">${w ? 'Save changes' : 'Post the workout'}</button><a class="btn ghost" href="${dest}">See it on the week</a>${dsi ? '' : `<a class="btn ghost" href="/results/${gid}?day=${day}">Enter results</a><a class="btn ghost" href="/tv/${gid}" target="_blank">Dandy TV</a>`}<span class="hint" id="wd-msg">${nLogs ? `${nLogs} logged already. Their weights stay with each part letter.` : ''}</span></div>
      </form></section>`)) return;
    $('#wd-day').onchange = e => { if (e.target.value) go(`/wod/${gid}?day=${e.target.value}`); };
    const build = a => {
      const L = a.dataset.p, trk = $('[data-trk]', a);
      if (!trk || !trk.checked) return null;
      const n = $('[data-n]', a).value.trim(), imp = $('[data-imp]', a).value, tt = imp && $('[data-tt]', a).value === 'f' ? 'rx' : $('[data-tt]', a).value, b = $('[data-b]', a).value;
      const prev = (ps.find(p => p.L === a.dataset.orig) || {}).lift || {};
      const l = { id: L.toLowerCase(), part: L, n, sch: $('[data-sch]', a).value.trim() };
      const bn = (BASE_OPTS.find(x => x[0] === b) || [, ''])[1].toLowerCase();
      if (tt === 'f') { const f = +$('[data-f]', a).value; if (f > 0) { l.b = b; l.f = Math.round(f) / 100; l.why = `${Math.round(f)}% of your ${bn}`; } }
      if (tt === 'rx') {
        const r0 = +$('[data-rx0]', a).value, r1 = +$('[data-rx1]', a).value, w0 = +$('[data-rxw0]', a).value, w1 = +$('[data-rxw1]', a).value;
        if (r0 > 0) {
          l.b = b; l.rx = [r0, r1 > r0 ? r1 : r0];
          if (w0 > 0) l.rxw = [w0, w1 > w0 ? w1 : w0];
          const pair = (m, w) => (w ? `${m}/${w}` : `${m}`);
          if (imp) {
            l.imp = imp; if ($('[data-pair]', a).checked) l.pair = true;
            const what = `${l.pair ? 'pair of ' : ''}${imp === 'db' ? 'dumbbell' : 'kettlebell'}${l.pair ? 's' : ''}`;
            l.why = `Rx ${pair(r0, w0 || 0)} lb${r1 > r0 ? `, Rx+ ${pair(r1, w1 > w0 ? w1 : 0)} lb` : ''} ${what} (men/women)`;
          } else l.why = `${pair(r0, w0 || 0)} Rx${r1 > r0 ? `, ${pair(r1, w1 > w0 ? w1 : 0)} Rx+ once your ${bn} is strong enough` : ''}`;
        }
      }
      if (!l.why) l.why = 'Log the weight you used';
      if (prev.max) l.max = true;
      return l;
    };
    const preview = a => { const out = $('[data-prev]', a); if (!out) return; const l = build(a); const t = l && D.target(l, me); out.textContent = t ? `Your target: ${t} ${D.unit(l)}` : ''; };
    $$('.wodPart').forEach(a => {
      const trk = $('[data-trk]', a), tk = $('.wodTrk', a);
      const sync = () => {
        if (!tk) return; tk.hidden = !trk.checked;
        const imp = $('[data-imp]', a).value, sel = $('[data-tt]', a);
        // Dumbbells and kettlebells take Rx and Rx+ weights, not a percent of a barbell lift.
        $('[data-bar]', sel).disabled = !!imp; if (imp && sel.value === 'f') sel.value = 'rx';
        const tt = sel.value;
        $$('[data-for]', a).forEach(f => { f.hidden = !tt || !f.dataset.for.split(' ').includes(tt) || (imp && f.querySelector('[data-b]')); });
        $('[data-imponly]', a).hidden = !imp;
        preview(a);
      };
      if (trk) { trk.onchange = sync; a.addEventListener('input', sync); a.addEventListener('change', sync); sync(); }
    });
    /* ---------- order: drag, arrows, add at the start or the end, remove ---------- */
    // Parts are A to D in the order they stand. Moving a part takes everything in it along and the letters follow.
    const grid = $('.wodGrid');
    const clearPart = a => {
      $('[data-text]', a).value = ''; $('[data-name]', a).value = ''; $$('[data-lv]', a).forEach(x => { x.value = ''; });
      ['[data-time]', '[data-reps]'].forEach(q => { const c = $(q, a); if (c) c.checked = false; });
      const t = $('[data-trk]', a); if (t) { t.checked = false; t.dispatchEvent(new Event('change')); }
      const ck = $('.wodClock', a); ck.dataset.auto = ''; $('[data-cm]', a).value = 'up'; $('[data-cmin]', a).value = ''; $('[data-cmin]', a).disabled = false;
    };
    let warned = false;
    const relabel = () => {
      const all = $$('.wodPart', grid), shown = all.filter(a => !a.hidden);
      all.filter(a => a.hidden).forEach(a => grid.appendChild(a));
      $$('.wodPart', grid).forEach((a, i) => {
        const L = LET[i], old = a.dataset.p; if (old === L) return;
        a.dataset.p = L; $('.wodPH i', a).textContent = L;
        $$('[id]', a).forEach(el => { el.id = el.id.replace(new RegExp('-' + old + '$'), '-' + L); });
        $$('label[for]', a).forEach(el => { el.htmlFor = el.htmlFor.replace(new RegExp('-' + old + '$'), '-' + L); });
        $$('[aria-label]', a).forEach(el => { el.setAttribute('aria-label', el.getAttribute('aria-label').replace('Part ' + old, 'Part ' + L)); });
        $$('label.vh', a).forEach(el => { el.textContent = el.textContent.replace('Part ' + old, 'Part ' + L); });
        $('[data-name]', a).placeholder = PH[L];
      });
      shown.forEach((a, i) => { $('[data-mv="-1"]', a).disabled = i === 0; $('[data-mv="1"]', a).disabled = i === shown.length - 1; $('[data-rm]', a).disabled = shown.length < 2; });
      const free = all.some(a => a.hidden);
      $('#addD').disabled = $('#addFirst').disabled = !free;
      $('#addMsg').textContent = free ? '' : 'Four parts is the most a day holds.';
      if (nLogs && !warned && all.some(a => a.dataset.p !== a.dataset.orig)) { warned = true; $('#wd-msg').textContent = `${nLogs} already logged. Results stay with the part letter, so check them after you save.`; }
      drawPlan();
    };
    const moveTo = (a, i) => { const shown = $$('.wodPart', grid).filter(x => !x.hidden && x !== a); grid.insertBefore(a, shown[i] || shown[shown.length - 1].nextSibling); relabel(); };
    const addPart = first => {
      const a = $$('.wodPart', grid).find(x => x.hidden); if (!a) return;
      clearPart(a); a.hidden = false; if (first) grid.insertBefore(a, grid.firstChild);
      relabel(); $('[data-name]', a).focus();
    };
    $('#addFirst').onclick = () => addPart(true);
    $('#addD').onclick = () => addPart(false);
    grid.addEventListener('click', e => {
      const b = e.target.closest('[data-mv],[data-rm]'); if (!b) return;
      const a = b.closest('.wodPart'), shown = $$('.wodPart', grid).filter(x => !x.hidden), i = shown.indexOf(a);
      if (b.dataset.rm !== undefined) { if (shown.length < 2) return; clearPart(a); a.hidden = true; relabel(); return; }
      const j = i + +b.dataset.mv; if (j < 0 || j >= shown.length) return;
      moveTo(a, j); b.focus();
    });
    // Drag by the handle (mouse, trackpad, or a finger on an iPad).
    let dragA = null;
    grid.addEventListener('pointerdown', e => { const h = e.target.closest('.wodDrag'); if (h) { const a = h.closest('.wodPart'); a.draggable = true; } });
    grid.addEventListener('dragstart', e => { dragA = e.target.closest('.wodPart'); if (!dragA) return; dragA.classList.add('dragging'); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragA.dataset.p); } catch {} });
    const marks = () => $$('.wodPart', grid).forEach(x => x.classList.remove('dropB', 'dropA'));
    grid.addEventListener('dragover', e => {
      if (!dragA) return; const a = e.target.closest('.wodPart'); if (!a || a === dragA || a.hidden) return;
      e.preventDefault(); const r = a.getBoundingClientRect(), before = e.clientX < r.left + r.width / 2;
      marks(); a.classList.add(before ? 'dropB' : 'dropA');
    });
    grid.addEventListener('drop', e => {
      if (!dragA) return; e.preventDefault();
      const a = e.target.closest('.wodPart'); marks();
      if (a && a !== dragA && !a.hidden) { const r = a.getBoundingClientRect(); grid.insertBefore(dragA, e.clientX < r.left + r.width / 2 ? a : a.nextSibling); relabel(); }
    });
    grid.addEventListener('dragend', () => { if (dragA) { dragA.classList.remove('dragging'); dragA.draggable = false; } dragA = null; marks(); });
    // Class plan: each part's clock plus the changeover between parts, against the class length.
    const clockIn = a => { const m = $('[data-cm]', a).value, n = Math.max(0, Math.min(90, parseInt($('[data-cmin]', a).value, 10) || 0)); return { mode: m, min: m === 'none' ? 0 : n }; };
    const drawPlan = () => {
      const parts = $$('.wodPart').filter(a => !a.hidden && $('[data-text]', a).value.trim()), gap = Math.max(0, Math.min(15, parseInt($('#wd-gap').value, 10) || 0)), len = Math.max(15, parseInt($('#wd-len').value, 10) || 60);
      const segs = []; parts.forEach((a, i) => { if (i && gap) segs.push({ k: 'gap', m: gap, t: `${gap} min change` }); const c = clockIn(a), nm = $('[data-name]', a).value.trim() || PH[a.dataset.p]; segs.push({ k: c.min ? 'part' : 'open', L: a.dataset.p, m: c.min, t: `${a.dataset.p} · ${nm}` }); });
      const used = segs.reduce((t, x) => t + x.m, 0), left = len - used, untimed = segs.filter(x => x.k === 'open');
      const all = left > 0 ? segs.concat([{ k: 'left', m: left, t: `${left} min open` }]) : segs, tot = Math.max(len, used) || 1;
      $('#wodBar').innerHTML = all.map(x => `<div class="wb ${x.k}" style="flex:${Math.max(x.m, x.k === 'open' ? 3 : 0.0001)} 1 0" title="${esc(x.t)}">${x.L ? `<i>${x.L}</i>` : ''}<span>${x.k === 'part' ? x.m + ' min' : x.k === 'gap' ? x.m + '′' : x.k === 'open' ? 'no time' : x.m + ' min open'}</span></div>`).join('') || '<p class="hint">Write a part to plan the class.</p>';
      $('#wodPlanMsg').textContent = !parts.length ? '' : `${used} of ${len} minutes planned${left > 0 ? `, ${left} left for the intro, setup and cooldown` : left < 0 ? `. That runs ${-left} min over the class` : ', no time to spare'}${untimed.length ? `. Part ${untimed.map(x => x.L).join(' and ')} has no time yet` : ''}. The TV runs these clocks and a ${gap} min changeover between parts.`;
      $('#wodPlanMsg').style.color = left < 0 ? 'var(--down)' : '';
    };
    $$('.wodPart').forEach(a => {
      const box = $('.wodClock', a), cm = $('[data-cm]', a), cn = $('[data-cmin]', a), tx = $('[data-text]', a);
      cm.onchange = () => { delete box.dataset.auto; cn.disabled = cm.value === 'none'; drawPlan(); };
      cn.oninput = () => { delete box.dataset.auto; drawPlan(); };
      tx.addEventListener('input', () => { if (box.dataset.auto !== undefined) { const c = suggestClock(tx.value); cm.value = c.mode; cn.value = c.min || ''; cn.disabled = false; } drawPlan(); });
      $('[data-name]', a).addEventListener('input', drawPlan);
    });
    ['#wd-gap', '#wd-len'].forEach(id => { $(id).oninput = drawPlan; });
    relabel();
    $('#wodF').onsubmit = async e => {
      e.preventDefault();
      const msg = $('#wd-msg'), sections = [], lifts = [];
      for (const a of $$('.wodPart')) {
        if (a.hidden) continue;
        const L = a.dataset.p, text = $('[data-text]', a).value.trim(), name = $('[data-name]', a).value.trim(), l = build(a);
        if (l && !l.n) { msg.textContent = `Part ${L} logs a weight. Name the movement.`; $('[data-n]', a).focus(); return; }
        const tm = !!($('[data-time]', a) || {}).checked, rp = !!($('[data-reps]', a) || {}).checked;
        const ck = clockIn(a), gp = Math.max(0, Math.min(15, parseInt($('#wd-gap').value, 10) || 0));
        const lv = {}; $$('[data-lv]', a).forEach(x => { const v = x.value.trim(); if (v) lv[x.dataset.lv] = v; });
        if (text || l || tm || rp) sections.push({ part: L, name: name || PH[L], text, clock: ck, ...(Object.keys(lv).length ? { levels: lv } : {}), ...(sections.length ? { gap: gp } : {}), ...(tm ? { time: true } : {}), ...(rp ? { reps: true } : {}) });
        if (l) lifts.push(l);
      }
      if (!sections.length) { msg.textContent = 'Write at least one part.'; return; }
      const title = $('#wd-t').value.trim() || sections.filter(s => s.part !== 'A').map(s => (lifts.find(l => l.part === s.part) || {}).n || s.name).slice(0, 2).join(' + ') || sections[0].name;
      const b = e.target.querySelector('button[type=submit]'); b.disabled = true; msg.textContent = 'Saving…';
      const { error } = await sb.from('workouts').upsert({ day, gym_id: dsi ? null : gid, title, sections, lifts, score_label: null, score_type: null, source: (w && w.source) || (dsi ? null : g.name) }, { onConflict: 'gym_id,day' });
      b.disabled = false;
      if (error) { msg.textContent = error.message; return; }
      toast(w ? 'Workout saved' : 'Workout posted'); route();
    };
  };

  /* ---------- coaches enter results ---------- */
  VIEWS.results = async (gid, tok) => {
    if (!S.me) return needLogin(tok, 'enter results');
    if (!runs(gid)) return paint(tok, '<section class="prEmpty"><b>Coaches only</b><p>Gym owners and coaches enter results here.</p></section>');
    const day = new URLSearchParams(location.search).get('day') || today();
    const { g, members, w, logs, rowOf } = await gymData(gid, day);
    const nav = `<div class="row"><a class="btn ghost sm" href="/results/${gid}?day=${addDays(day, -1)}">← Day before</a>${day !== today() ? `<a class="btn ghost sm" href="/results/${gid}">Today</a>` : ''}<a class="btn ghost sm" href="/results/${gid}?day=${addDays(day, 1)}">Next day →</a></div>`;
    if (!w || w.gym_id !== gid) return paint(tok, `${X.officeBar(g, 'results')}<section class="sec"><div class="secHead"><div><div class="kicker">${esc(g.name)} · ${esc(fmtDW(day))}</div><h2>Enter <span>results</span></h2></div>${nav}</div>
      <div class="prEmpty"><b>${esc(g.name)} has no workout posted for this day</b><p>Results go on your own gym's workout. Post it first.</p><p><a class="btn" href="/wod/${gid}?day=${day}">Post the workout</a></p></div></section>`);
    const its = items(w), logOf = id => logs.find(l => l.profile_id === id);
    const inp = (it, m, ent, r) => it.kind === 'r'
      ? `<input class="wkIn" type="number" inputmode="numeric" step="1" min="0" max="99999" data-l="${esc(it.key)}" data-kind="r" value="${esc(ent[it.key] ?? '')}" placeholder="reps" aria-label="${esc(m.display_name + ' ' + it.label)}">`
      : it.kind === 't'
      ? `<input class="wkIn wkTime" inputmode="numeric" maxlength="8" data-l="${esc(it.key)}" data-kind="t" value="${esc(fmtT(ent[it.key]))}" placeholder="m:ss" aria-label="${esc(m.display_name + ' ' + it.label)}">`
      : `<input class="wkIn" type="number" inputmode="decimal" step="any" min="0" max="1499" data-l="${esc(it.key)}" value="${esc(ent[it.key] ?? '')}" placeholder="${D.target(it.lift, r) || ''}" aria-label="${esc(m.display_name + ' ' + it.label)}">`;
    if (!paint(tok, `${X.officeBar(g, 'results')}<section class="sec"><div class="secHead"><div><div class="kicker">${esc(g.name)} · ${esc(fmtDW(day))}</div><h2>${esc(w.title)}</h2><p class="secSub">Type the weight each member used, their time where a part is timed (like 8:45), and total reps where a part counts reps. Blank means they did not do it. Targets show in grey.</p><p><a class="btn ghost sm" href="/wod/${gid}?day=${day}">Edit this workout</a></p></div>${nav}</div>
      <form id="rsF"><div class="board"><div class="tablewrap"><table class="wkT rsT"><thead><tr><th>Member</th>${its.map(it => `<th class="r">${esc(it.label)}<div class="sub">${esc(it.sch || (it.kind === 't' ? 'm:ss' : ''))}</div></th>`).join('')}${w.score_label ? `<th class="r">${esc(w.score_label)}</th>` : ''}</tr></thead><tbody>
      ${members.map(m => { const lg = logOf(m.id), ent = (lg && lg.entries) || {}, r = rowOf(m); return `<tr data-pid="${m.id}"><td><b>${esc(m.display_name)}</b>${lg ? ' <span class="pill up">Logged</span>' : ''}</td>
        ${its.map(it => `<td class="r">${inp(it, m, ent, r)}</td>`).join('')}
        ${w.score_label ? `<td class="r"><input class="wkIn wkScore" maxlength="40" data-score value="${esc((lg && lg.score) || '')}" placeholder="${w.score_type === 'time' ? '12:34' : ''}" aria-label="${esc(m.display_name + ' ' + w.score_label)}"></td>` : ''}</tr>`; }).join('') || `<tr><td class="empty" colspan="${its.length + 2}">No members yet. Members pick ${esc(g.name)} on the Gym league page.</td></tr>`}
      </tbody></table></div></div>
      <div class="row" style="margin-top:14px"><button class="btn" type="submit">Save results</button><a class="btn ghost" href="/tv/${g.slug || gid}" target="_blank">Dandy TV</a><span class="hint" id="rs-msg"></span></div></form></section>`)) return;
    $('#rsF').onsubmit = async e => {
      e.preventDefault();
      const msg = $('#rs-msg'), rows = [];
      let bad = '';
      $$('tr[data-pid]').forEach(tr => {
        const had = logOf(tr.dataset.pid), entries = { ...((had && had.entries) || {}) };
        let any = false;
        $$('[data-l]', tr).forEach(i => {
          const v = i.value.trim(), k = i.dataset.l;
          if (!v) { delete entries[k]; return; }
          const x = i.dataset.kind === 't' ? parseT(v) : i.dataset.kind === 'r' ? Math.max(0, Math.min(99999, Math.round(+v) || 0)) : Math.max(0, Math.min(1499, Math.round(+v * 2) / 2 || 0));
          if (i.dataset.kind === 't' && !(x > 0)) { bad = bad || `"${v}" is not a time. Use minutes and seconds, like 8:45.`; return; }
          entries[k] = x; any = true;
        });
        const sc = $('[data-score]', tr), score = sc ? sc.value.trim().slice(0, 40) : '';
        if (!any && !score && !had) return;
        rows.push({ workout_id: w.id, profile_id: tr.dataset.pid, entries, score: score || null, sets: (had && had.sets) || {} });
      });
      if (bad) { msg.textContent = bad; return; }
      if (!rows.length) { msg.textContent = 'Nothing to save yet.'; return; }
      msg.textContent = 'Saving…';
      const { error } = await sb.from('workout_logs').upsert(rows, { onConflict: 'workout_id,profile_id' });
      if (error) { msg.textContent = error.message; return; }
      toast(`Saved ${rows.length} result${rows.length === 1 ? '' : 's'}`); route();
    };
  };

  /* ---------- the big screen: a deck of full page screens ---------- */
  // Screens advance on their own every 15 seconds. Scroll, swipe, arrow keys or the dots move by hand;
  // after a minute without input the deck starts moving again.
  let tvTimers = [];
  const clearTv = () => { tvTimers.forEach(t => clearInterval(t)); tvTimers = []; ['tvFocusBox', 'tvPillBox', 'tvWhoBox', 'tvChgBox'].forEach(id => { const f = document.getElementById(id); if (f) f.remove(); }); };
  const SLIDE_MS = 15000, IDLE_MS = 60000, PER_TARGETS = 12;
  const secsOf = s => { const m = String(s || '').match(/^(\d+):(\d{1,2})$/); return m ? +m[1] * 60 + +m[2] : null; };
  // Parts days rank by the first thing logged (fastest time or heaviest weight); older days keep their score rules.
  function ranked(w, logs) {
    const live = logs.filter(l => l.status !== 'struck');
    if (isParts(w)) {
      const it = rankKey(w); if (!it) return live;
      const v = l => num((l.entries || {})[it.key]);
      return live.sort((a, b) => (it.kind === 't' ? (v(a) || 1e9) - (v(b) || 1e9) : v(b) - v(a)));
    }
    const lifts = (w && w.lifts) || [], key = (lifts.find(l => l.max) || lifts[0] || {}).id, isT = w && w.score_type === 'time';
    return live.sort((a, b) => {
      if (isT) { const x = secsOf(a.score), y = secsOf(b.score); if (x != null || y != null) return (x ?? 1e9) - (y ?? 1e9); }
      const sa = parseFloat(String(a.score || '').replace(/[^0-9.]/g, '')), sb2 = parseFloat(String(b.score || '').replace(/[^0-9.]/g, ''));
      if (!isNaN(sa) || !isNaN(sb2)) return (isNaN(sb2) ? -1 : sb2) - (isNaN(sa) ? -1 : sa);
      return num((b.entries || {})[key]) - num((a.entries || {})[key]);
    });
  }
  async function dayOf(gid, day) {
    const ws = must(await sb.from('workouts').select('*').eq('day', day).or(`gym_id.is.null,gym_id.eq.${gid}`));
    const w = ws.find(x => x.gym_id === gid) || ws.find(x => !x.gym_id) || null;
    return { day, w, logs: w ? must(await sb.from('workout_logs').select('*').eq('workout_id', w.id)) : [] };
  }

  VIEWS.tv = async (key, tok) => {
    clearTv();
    // The installed app opens at /tv/ and goes to the gym this screen was set up for.
    if (!key && X.kiosk) { const k = X.kiosk.saved('tv'); if (k) return go('/tv/' + k, true); }
    if (X.kiosk) X.kiosk.start('tv', key);
    const gid = await gymIdOf(key);
    let st = null, cur = 0, lastTouch = 0;
    const load = async () => {
      const d = today();
      const [base, yday] = await Promise.all([gymData(gid, d), dayOf(gid, addDays(d, -1))]);
      const ids = base.members.map(m => m.id);
      const [prs, by, bt] = await Promise.all([
        ids.length ? sb.from('lift_entries').select('id,profile_id,lift,weight_lb,prev_best,performed_on').in('profile_id', ids).eq('is_pr', true).not('prev_best', 'is', null).neq('status', 'struck').gte('performed_on', addDays(d, -29)).order('performed_on', { ascending: false }).limit(10).then(must) : [],
        X.compete.allEntries(),
        sb.from('battles').select('*').eq('status', 'accepted').eq('week_start', monday(d)).then(must),
      ]);
      const q = X.compete.quarter(d);
      const rows = base.members.map(m => ({ m, r: base.rowOf(m) })).filter(x => x.r.score);
      const from30 = addDays(d, -29);
      const lb = rows.map(x => ({ ...x, s: X.compete.gainIn(by.get(x.m.id) || [], x.r, from30, d) })).sort((a, b) => b.r.score - a.r.score);
      // Today's classes and who booked them, so the screens can show just the class on the floor.
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      const sess = await sb.from('sessions').select('id,name,starts_at,ends_at,status').eq('gym_id', gid).gte('starts_at', dayStart.toISOString()).lt('starts_at', new Date(dayStart.getTime() + 864e5).toISOString()).neq('status', 'canceled').order('starts_at');
      let sessions = sess.error ? [] : sess.data || [];
      // No sessions made for today yet: use the weekly class schedule, so the class clock still starts at each class time.
      if (!sessions.length) {
        const wd = dayStart.getDay(), cl = ((await sb.from('classes').select('id,name,weekdays,start_time,duration_min,active').eq('gym_id', gid)).data || [])
          .filter(c => c.active !== false && c.start_time && (c.weekdays || []).map(Number).includes(wd));
        sessions = cl.map(c => { const [h, mi] = c.start_time.split(':').map(Number), a = new Date(dayStart); a.setHours(h, mi, 0, 0);
          return { id: 'c-' + c.id, name: c.name, starts_at: a.toISOString(), ends_at: new Date(a.getTime() + (c.duration_min || 60) * 60000).toISOString(), status: 'scheduled' }; })
          .sort((x, y) => x.starts_at < y.starts_at ? -1 : 1);
      }
      const realIds = sessions.map(x => x.id).filter(x => !String(x).startsWith('c-'));
      const bk = realIds.length ? await sb.from('bookings').select('session_id,profile_id,status').in('session_id', realIds).neq('status', 'canceled') : { data: [] };
      const tv = X.tvConfig ? await X.tvConfig(gid).catch(() => null) : null;
      st = { ...base, tv, yday, prs, lb, q, by, from30, sessions, bookings: bk.error ? [] : bk.data || [], battles: bt.filter(b => ids.includes(b.challenger) || ids.includes(b.opponent)) };
    };
    const nameOf = id => (st.members.find(m => m.id === id) || {}).display_name || (S.board.find(r => r.profile_id === id) || {}).name || 'Someone';
    const clock = () => new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    // Who is in class right now. A class running now (from 15 minutes before it starts to when it ends) uses its
    // bookings. Otherwise the coach can tap Who's here and pick names on this screen; that list lasts 90 minutes.
    const RKEY = 'dsi.tvRoster.' + gid;
    const pickedRoster = () => { try { const r = JSON.parse(localStorage.getItem(RKEY) || 'null'); return r && r.until > Date.now() ? r : null; } catch { return null; } };
    const fmtTime = t => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const classNow = () => {
      const now = Date.now();
      const sNow = (st.sessions || []).find(x => Date.parse(x.starts_at) - 15 * 60000 <= now && now <= Date.parse(x.ends_at));
      const picked = pickedRoster();
      if (picked) return { label: picked.label || "This class", ids: picked.ids, picked: true };
      if (sNow) { const ids = st.bookings.filter(b => b.session_id === sNow.id).map(b => b.profile_id); if (ids.length) return { label: `${fmtTime(sNow.starts_at)} ${sNow.name || 'class'}`, ids }; }
      return null;
    };
    const inClass = () => { const c = classNow(); return c ? st.members.filter(m => c.ids.includes(m.id)) : st.members; };
    const showWho = () => {
      let box = document.getElementById('tvWhoBox');
      if (!box) { box = document.createElement('div'); box.id = 'tvWhoBox'; box.className = 'tvStageBox'; document.body.appendChild(box); }
      const c = classNow(), on = new Set(c ? c.ids : []);
      const ms = [...st.members].sort((a, b) => a.display_name.localeCompare(b.display_name));
      box.innerHTML = `<div class="tvWho" role="dialog" aria-modal="true" aria-label="Who is in this class"><header><b>Who's in this class?</b><span>Tap names. Targets show just these lifters for the next 90 minutes.</span></header>
        <div class="tvWhoGrid">${ms.map(m => `<button type="button" data-who="${m.id}" aria-pressed="${on.has(m.id)}">${esc(m.display_name)}</button>`).join('')}</div>
        <footer><button type="button" class="btn" id="tvWhoDone">Done</button><button type="button" class="btn ghost" id="tvWhoAll">Show everyone</button></footer></div>`;
      box.querySelectorAll('[data-who]').forEach(b => b.onclick = () => b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')));
      $('#tvWhoDone').onclick = () => {
        const ids = [...box.querySelectorAll('[data-who][aria-pressed="true"]')].map(b => b.dataset.who);
        try { if (ids.length) localStorage.setItem(RKEY, JSON.stringify({ ids, until: Date.now() + 90 * 60000, label: `${fmtTime(Date.now())} class` })); else localStorage.removeItem(RKEY); } catch {}
        box.remove(); draw();
      };
      $('#tvWhoAll').onclick = () => { try { localStorage.removeItem(RKEY); } catch {} box.remove(); draw(); };
    };

    const screens = () => {
      const { g, w, logs, rowOf, lb, prs, q, battles, by, yday, from30 } = st;
      const members = inClass(), cls = classNow();
      const out = [], cs = (st.tv && st.tv.class_screens) || {}, on = k => cs[k] !== false;
      const head = (k, t) => `<header class="tvHead"><div class="tvGym"><img src="/assets/mark.svg" alt="Dandy Strength" class="tvLogo"><div><b>${esc(g.name)}</b><span>${esc(k)}</span></div></div><div class="tvTitle">${t}</div><div class="tvNow sm" data-cnow></div></header><div class="tvCBar" data-cbar></div>`;
      // 1. Workout of the day
      // No header here: the workout's name leads the screen; the logo, date and time sit in the footer.
      if (on('wod')) out.push(`<div class="tvBody tvWodS">
        ${w ? `<div class="tvTop"><div class="tvTitleRow"><h1>${esc(w.title)}</h1><div class="tvNow" data-cnow></div></div><div data-cbar data-rule><div class="tvRule"></div></div></div><div class="tvSecsBig${shownParts(w).length > 3 ? ' four' : ''}">${shownParts(w).map(p => `<div class="tvPartBtn" role="button" tabindex="0" data-part="${p.L}" aria-label="Show part ${p.L} full screen"><b><i>${p.L}</i>${esc(p.name)}</b><p>${esc(p.text)}</p>${levelsHtml(p, 'tvLv')}${logWords(p) ? `<span class="tvLog">Log your ${logWords(p)}</span>` : ''}</div>`).join('')}</div>${w.score_label ? `<div class="tvScoreBy">Scored by ${esc(w.score_label)}</div>` : ''}`
        : `<h1>Rest or not posted</h1><p class="tvEmpty">Coaches post the day at dandystrength.com/gym/${esc(g.id)}</p>`}</div>`);
      // 2. Today's targets (one screen per 12 members)
      const lifts = (w && w.lifts) || [];
      if (lifts.length && on('targets')) {
        const pages = Math.max(1, Math.ceil(members.length / PER_TARGETS));
        for (let p = 0; p < pages; p++) {
          const chunk = members.slice(p * PER_TARGETS, p * PER_TARGETS + PER_TARGETS);
          out.push(`${head(cls ? `${cls.label} · ${members.length} lifter${members.length === 1 ? '' : 's'}` : fmtDW(today()), `Today's <em>targets</em>${pages > 1 ? ` <small>${p + 1}/${pages}</small>` : ''}`)}<div class="tvBody"><button type="button" class="tvWhoBtn" data-whobtn>${cls ? 'Change who is here' : "Who's here?"}</button>
            <table class="tvT tvBig"><thead><tr><th>Lifter</th>${lifts.map(l => `<th>${esc(liftLabel(l))}<span>${esc(l.sch)}</span></th>`).join('')}</tr></thead><tbody>
            ${chunk.map(m => { const r = rowOf(m), ent = ((logs.find(l => l.profile_id === m.id) || {}).entries) || {}; return `<tr><td>${esc(m.display_name)}</td>${lifts.map(l => { const t = D.target(l, r), v = num(ent[l.id]); return `<td class="${v ? (t && v >= t ? 'hit' : 'did') : ''}">${v || t || '·'}</td>`; }).join('')}</tr>`; }).join('') || `<tr><td colspan="${lifts.length + 1}">No members yet. Pick ${esc(g.name)} on the Gym league page.</td></tr>`}
            </tbody></table><div class="tvKey"><span class="hit">■</span> hit the target <span class="did">■</span> logged <span>■</span> your target, built from your own PRs</div></div>`);
        }
      }
      // 3. Live day board
      const board = (wk, lg, n) => { const show = boardItems(wk, lg).slice(0, 4), rk = ranked(wk, lg).slice(0, n);
        return rk.length ? `<table class="tvT tvBig tvRank"><thead><tr><th>#</th><th>Lifter</th>${show.map(it => `<th>${esc(it.label)}</th>`).join('')}${wk && wk.score_label ? `<th>${esc(wk.score_label)}</th>` : ''}</tr></thead><tbody>
          ${rk.map((l, i) => `<tr class="${i === 0 ? 'top' : ''}"><td>${i + 1}</td><td>${esc(nameOf(l.profile_id))}</td>${show.map(it => `<td${it.kind === 't' ? ' class="sc"' : ''}>${cell(it, (l.entries || {})[it.key]) || '·'}</td>`).join('')}${wk && wk.score_label ? `<td class="sc">${esc(l.score || '·')}</td>` : ''}</tr>`).join('')}</tbody></table>`
          : '<p class="tvEmpty">Nobody has logged yet. Be first.</p>'; };
      if (on('today')) out.push(`${head(fmtDW(today()), `Today's <em>board</em>`)}<div class="tvBody">${w ? `<div class="tvSub">${esc(w.title)} · ${logs.length} of ${members.length} logged</div>` : ''}${board(w, logs, 12)}</div>`);
      // 4. Yesterday's results
      if (on('yesterday')) out.push(`${head(fmtDW(yday.day), `Yesterday's <em>results</em>`)}<div class="tvBody">${yday.w ? `<div class="tvSub">${esc(yday.w.title)} · ${yday.logs.length} logged</div>${board(yday.w, yday.logs, 12)}` : '<p class="tvEmpty">No workout yesterday.</p>'}</div>`);
      // 5 and 6. Men's and women's leaderboards for the major lifts
      for (const [sex, label] of on('leaders') ? [['male', "Men's"], ['female', "Women's"]] : []) {
        const rs = lb.filter(x => (x.r.sex || '') === sex);
        if (sex === 'female' && !rs.length) continue; // no women's screen until the gym has a woman on the board
        const col = (t, key, unit) => { const top = [...rs].filter(x => num(x.r[key])).sort((a, b) => num(b.r[key]) - num(a.r[key])).slice(0, 8);
          return `<div class="tvCol"><h3>${t}</h3><ol>${top.map((x, i) => `<li class="${i === 0 ? 'top' : ''}"><span>${esc(x.m.display_name)}</span><b>${fmt(x.r[key])}${unit}</b></li>`).join('') || '<li class="none">Nobody yet</li>'}</ol></div>`; };
        out.push(`${head('Best lifts on the board', `${label} <em>leaderboard</em>`)}<div class="tvBody">${rs.length ? `<div class="tvCols">${col('DSI™', 'score', '')}${col('Total', 'total', '')}${D.LIFTS.map(l => col(l.n, l.k, '')).join('')}</div><div class="tvKey">Best lifts in pounds. DSI scores each lifter against people their age and size.</div>`
          : `<p class="tvEmpty">No ${label.toLowerCase().replace("'s", '')} on the ${esc(g.name)} board yet. Get your DSI at dandystrength.com/join</p>`}</div>`);
      }
      // 7. The last 30 days: DSI gained, battles and PRs
      if (on('last30') || !out.length) out.push(`${head(fmtD(from30) + ' to ' + fmtD(today()), `Last 30 <em>days</em>`)}<div class="tvBody tvGrid2">
        <div><h3 class="tvH3">Most DSI gained</h3><table class="tvT tvRank"><thead><tr><th></th><th>Lifter</th><th>Pounds added</th><th>DSI</th></tr></thead><tbody>${[...lb].sort((a, b) => b.s.pts - a.s.pts || b.s.lb - a.s.lb).filter(x => x.s.pts || x.s.lb).slice(0, 8).map((x, i) => `<tr class="${i === 0 ? 'top' : ''}"><td>${i + 1}</td><td>${esc(x.m.display_name)}</td><td>+${fmt(x.s.lb)} lb</td><td class="sc">+${x.s.pts}</td></tr>`).join('') || '<tr><td>Nobody has gained in the last 30 days.</td></tr>'}</tbody></table>
          ${battles.length ? `<h3 class="tvH3">Battles this week</h3>${battles.slice(0, 4).map(b => { const a = X.compete.gainIn(by.get(b.challenger) || [], S.board.find(r => r.profile_id === b.challenger) || {}, b.week_start, today()), o = X.compete.gainIn(by.get(b.opponent) || [], S.board.find(r => r.profile_id === b.opponent) || {}, b.week_start, today()); return `<div class="tvBt"><span>${esc(nameOf(b.challenger))} <b>+${a.pts}</b></span><i>vs</i><span><b>+${o.pts}</b> ${esc(nameOf(b.opponent))}</span></div>`; }).join('')}` : ''}</div>
        <div><h3 class="tvH3">Latest PRs</h3><ol class="tvPRs">${prs.map(p => `<li><b>${esc(nameOf(p.profile_id))}</b><span>${esc(D.liftName(p.lift))} ${fmt(p.weight_lb)} lb</span><em>+${fmt(num(p.weight_lb) - num(p.prev_best))}</em><small>${fmtD(p.performed_on)}</small></li>`).join('') || '<li class="none">No PRs in the last 30 days. Somebody fix that.</li>'}</ol></div></div>`);
      return out;
    };

    // One part, full screen: tap A, B, C or D on the workout screen (or press its letter). Stays up until closed,
    // and the screens stop rolling underneath while it is open.
    /* ---------- part timers ---------- */
    // Read the part's own words for the clock it needs: EMOM 15, a 10 minute cap (counts up), an AMRAP or a
    // "(15 min)" block (counts down). Anything else is a stopwatch. One clock runs at a time and keeps going
    // while the screens roll; a small clock shows in the corner until it is reset.
    const MODES = { down: 'Count down', up: 'Count up', emom: 'EMOM' };
    let tm = null; // { L, mode, min, run, base (ms counted before the last start), at (when started), lead (ms of 10 s lead in left at start) }
    const tmFor = L => { if (tm && tm.L === L) return tm; const p = shownParts(st.w).find(x => x.L === L); const g = clockOf(p), none = g.mode === 'none'; return { L, mode: none ? 'up' : g.mode, min: none ? 0 : g.min, run: false, base: 0, at: 0, lead: 10000, fresh: true }; };
    const elapsed = t => t.base + (t.run ? Date.now() - t.at : 0) - t.lead; // negative while counting in
    const mmss = x => { x = Math.max(0, Math.round(x)); return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`; };
    // What the clock says right now.
    const face = t => {
      const e = elapsed(t), tot = t.min * 60;
      if (e < 0) return { big: String(Math.ceil(-e / 1000)), sub: 'Get ready', lead: true };
      const sec = e / 1000;
      if (t.mode === 'emom') { const r = Math.floor(sec / 60) + 1; if (tot && sec >= tot) return { big: 'Done', sub: `${t.min} rounds`, end: true }; return { big: mmss(60 - (sec % 60)), sub: `Round ${r}${t.min ? ` of ${t.min}` : ''}` }; }
      if (t.mode === 'down') { if (tot && sec >= tot) return { big: 'Time', sub: `${t.min} minute${t.min === 1 ? "" : "s"}`, end: true }; return { big: mmss(tot ? tot - sec : sec), sub: tot ? `${t.min} minute${t.min === 1 ? "" : "s"}` : 'Running' }; }
      if (tot && sec >= tot) return { big: mmss(tot), sub: 'Time cap', end: true };
      return { big: mmss(sec), sub: tot ? `Cap ${t.min}:00` : 'Running' };
    };
    let ac = null, lastBeep = '';
    const beep = (f, d) => { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); const o = ac.createOscillator(), gn = ac.createGain(); o.frequency.value = f; gn.gain.value = 0.25; o.connect(gn).connect(ac.destination); o.start(); o.stop(ac.currentTime + d); } catch {} };
    // 3, 2, 1, go into the start, the top of every EMOM minute, the last three seconds of a count down, and the cap.
    const tick = () => {
      if (!tm || !tm.run) return;
      const e = elapsed(tm), sec = e / 1000, tot = tm.min * 60;
      let key = '', f = 0, d = 0.12;
      if (e < 0) { const n = Math.ceil(-sec); if (n <= 3) { key = 'l' + n; f = 660; } }
      else {
        const s = Math.floor(sec);
        if (s === 0) { key = 'go'; f = 990; d = 0.5; }
        else if (tot && s >= tot) { key = 'end'; f = 990; d = 0.9; }
        else if (tm.mode === 'emom') { const left = 60 - (s % 60); if (s % 60 === 0) { key = 'm' + s; f = 990; d = 0.4; } else if (left <= 3) { key = 'c' + s; f = 660; } }
        else if (tm.mode === 'down' && tot && tot - s <= 3) { key = 'c' + s; f = 660; }
      }
      if (key && key !== lastBeep) { lastBeep = key; beep(f, d); }
      if (tot && sec >= tot + 1 && tm.mode !== 'up') { tm.base = elapsed(tm) + tm.lead; tm.run = false; startChange(tm.L); }
      if (tot && tm.mode === 'up' && sec >= tot + 1) { tm.base = tot * 1000 + tm.lead; tm.run = false; startChange(tm.L); }
    };
    // Changeover: when a part's clock runs out, the next part starts counting in (3 minutes unless the workout
    // editor set another time). The screen shows it in the corner, then opens the next part ready to start.
    let chg = null;
    const startChange = L => {
      if (!st || !st.w) return;
      const ps = shownParts(st.w), i = ps.findIndex(x => x.L === L), nx = ps[i + 1];
      if (!nx) return;
      const gap = nx.gap != null ? nx.gap : GAP;
      if (gap > 0) chg = { L: nx.L, name: nx.name || 'Part ' + nx.L, until: Date.now() + gap * 60000 };
    };
    const changeBox = () => {
      let box = document.getElementById('tvChgBox');
      if (!chg) { if (box) box.remove(); return; }
      const left = chg.until - Date.now();
      if (left <= 0) { const L = chg.L; chg = null; if (box) box.remove(); beep(990, 0.6); tm = null; lastBeep = ''; showFocus(L); return; }
      if (left <= 3000 && lastBeep !== 'g' + Math.ceil(left / 1000)) { lastBeep = 'g' + Math.ceil(left / 1000); beep(660, 0.12); }
      if (!box) { box = document.createElement('div'); box.id = 'tvChgBox'; box.className = 'tvStageBox'; document.body.appendChild(box); }
      box.innerHTML = `<button type="button" class="tvChg" aria-label="Skip the changeover and open part ${chg.L}"><span>Change over</span><b>${mmss(left / 1000)}</b><em>Next: <i>${chg.L}</i> ${esc(chg.name)}</em><small>Tap to start now</small></button>`;
      box.querySelector('button').onclick = () => { chg = { ...chg, until: Date.now() }; };
    };
    const timerCard = p => {
      const t = tmFor(p.L), fc = face(t), other = tm && tm.L !== p.L && tm.run;
      return `<div class="tvTimer${fc.end ? ' end' : ''}${fc.lead ? ' lead' : ''}" data-tl="${p.L}">
        <div class="tvTmFace"><b data-tmbig>${esc(fc.big)}</b><span data-tmsub>${esc(fc.sub)}</span></div>
        ${other ? `<p class="tvTmNote">Part ${tm.L} clock is running</p>` : ''}
        <div class="tvTmModes">${Object.entries(MODES).map(([k, n]) => `<button type="button" data-tmmode="${k}" aria-pressed="${t.mode === k}">${n}</button>`).join('')}
          <span class="tvTmMin"><button type="button" data-tmmin="-1" aria-label="One minute less">−</button><b>${t.min ? t.min + ' min' : 'No limit'}</b><button type="button" data-tmmin="1" aria-label="One minute more">+</button></span></div>
        <div class="tvTmBtns"><button type="button" class="go" data-tmgo>${t.run ? 'Pause' : t.fresh ? 'Start' : 'Resume'}</button><button type="button" data-tmreset>Reset</button></div>
      </div>`;
    };
    const bindTimer = () => {
      const c = document.querySelector('.tvTimer'); if (!c) return;
      const L = c.dataset.tl, set = ch => { const t = tmFor(L); if (tm && tm.L !== L && tm.run) return; Object.assign(t, ch); tm = t; showFocus(L); };
      c.querySelectorAll('[data-tmmode]').forEach(b => b.onclick = () => { const t = tmFor(L); if (t.run) return; set({ mode: b.dataset.tmmode, base: 0, lead: 10000, fresh: true }); });
      c.querySelectorAll('[data-tmmin]').forEach(b => b.onclick = () => { const t = tmFor(L); if (t.run) return; set({ min: Math.max(0, Math.min(90, t.min + +b.dataset.tmmin)), base: 0, lead: 10000, fresh: true }); });
      c.querySelector('[data-tmgo]').onclick = () => toggleTimer(L);
      c.querySelector('[data-tmreset]').onclick = () => { if (tm && tm.L === L) { tm = null; lastBeep = ''; pill(); } chg = null; changeBox(); showFocus(L); };
    };
    const toggleTimer = L => {
      if (tm && tm.L !== L && tm.run) return;
      const t = tmFor(L);
      if (t.run) { t.base += Date.now() - t.at; t.run = false; }
      else { t.at = Date.now(); t.run = true; t.fresh = false; beep(440, 0.05); }
      tm = t; showFocus(L); pill();
    };
    // The small clock over the screens while a part clock is going; tap it to open that part.
    const pill = () => {
      let box = document.getElementById('tvPillBox');
      if (!tm || tm.fresh || focus) { if (box) box.remove(); return; }
      if (!box) { box = document.createElement('div'); box.id = 'tvPillBox'; box.className = 'tvStageBox'; document.body.appendChild(box); }
      const fc = face(tm);
      box.innerHTML = `<button type="button" class="tvPill${fc.end ? ' end' : ''}" aria-label="Open part ${tm.L}"><i>${tm.L}</i><b>${esc(fc.big)}</b><span>${esc(fc.sub)}</span></button>`;
      box.querySelector('button').onclick = () => showFocus(tm.L);
    };
    /* ---------- class timer in the top bar ---------- */
    // The workout's clocks laid end to end with a changeover between parts, against the class on now. It starts by
    // itself at the class's start time from the schedule; with no class on the schedule it shows the plan only. The bar fills as
    // the class runs and the big clock shows the part on now, the changeover, or the time left.
    // The workout name stays on one line: its size shrinks until it fits beside the clock.
    const fitTitle = () => { const h = document.querySelector('.tvWodS .tvTitleRow h1'); if (!h) return; let lo = 2.2, hi = 5.6; h.style.fontSize = hi + 'cqw'; if (h.scrollWidth <= h.clientWidth + 1) return; for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; h.style.fontSize = m + 'cqw'; if (h.scrollWidth > h.clientWidth + 1) hi = m; else lo = m; } h.style.fontSize = lo + 'cqw'; };
    const classPlan = () => {
      const ps = st && st.w ? shownParts(st.w).map(p => ({ p, c: clockOf(p) })).filter(x => x.c.mode !== 'none' && x.c.min > 0) : [];
      const segs = []; let t = 0;
      ps.forEach((x, i) => { if (i) { const gp = x.p.gap != null ? x.p.gap : GAP; if (gp > 0) { segs.push({ k: 'gap', a: t, b: t + gp, next: x.p }); t += gp; } } segs.push({ k: 'part', a: t, b: t + x.c.min, p: x.p, c: x.c }); t += x.c.min; });
      return { segs, used: t };
    };
    const classWin = () => {
      const now = Date.now();
      const ss = (st && st.sessions) || [], len = x => Math.round((Date.parse(x.ends_at) - Date.parse(x.starts_at)) / 60000) || 60;
      const cur = ss.find(x => Date.parse(x.starts_at) <= now && now < Date.parse(x.ends_at));
      if (cur) return { at: Date.parse(cur.starts_at), len: len(cur), label: `${fmtTime(cur.starts_at)} ${cur.name || 'class'}` };
      const nx = ss.find(x => Date.parse(x.starts_at) > now);
      return nx ? { next: true, at: Date.parse(nx.starts_at), len: len(nx), label: `${fmtTime(nx.starts_at)} ${nx.name || 'class'}` } : null;
    };
    let lastSeg = '';
    // The class clock is its own thing: it runs from the scheduled start on every screen, the part view included,
    // and never waits on the part clocks. It shows where the class should be.
    const classBar = () => {
      const boxes = $$('[data-cbar]'), nows = $$('[data-cnow]'), b = document.body;
      if (!boxes.length && !nows.length) return;
      const put = (els, h) => els.forEach(el => { const v = typeof h === 'function' ? h(el) : h; if (el.innerHTML !== v) el.innerHTML = v; });
      let { segs, used } = classPlan();
      const win = classWin(), live = !!(win && !win.next);
      // No part clocks on today's workout: the class still gets its clock, as one block for the whole class.
      if (!segs.length && win && st && st.w) { segs = [{ k: 'part', a: 0, b: win.len, p: { L: '', name: 'Class' }, c: { min: win.len }, whole: true }]; used = win.len; }
      b.classList.toggle('tvPlan', !!segs.length);
      if (!segs.length) { put(boxes, el => el.hasAttribute('data-rule') ? '<div class="tvRule"></div>' : ''); put(nows, ''); b.classList.remove('tvLive'); lastSeg = ''; return; }
      const len = Math.max(live ? win.len : 60, used);
      const all = used < len ? segs.concat([{ k: 'open', a: used, b: len }]) : segs;
      const m = live ? (Date.now() - win.at) / 60000 : -1, seg = live ? all.find(x => m >= x.a && m < x.b) : null;
      const barHtml = `<div class="tvTL">${all.map(x => {
        const f = Math.max(0, Math.min(1, (m - x.a) / (x.b - x.a))), cur = x === seg, done = live && m >= x.b;
        const inner = x.k === 'part' ? `${x.p.L ? `<i>${x.p.L}</i>` : ''}<span>${esc(x.p.name || 'Part ' + x.p.L)} · ${x.c.min} min</span>` : x.k === 'gap' ? `<span>${x.b - x.a}′</span>` : `<span>Open · ${Math.round(x.b - x.a)} min</span>`;
        return `<div class="tvSeg ${x.k}${cur ? ' cur' : ''}${done ? ' done' : ''}" style="flex:${x.b - x.a} 1 0"><b style="width:${f * 100}%"></b>${inner}</div>`;
      }).join('')}${live ? `<em class="tvMark" style="left:${Math.min(100, (m / len) * 100)}%"></em>` : ''}</div>
        ${live ? (() => { const pct = Math.max(0, Math.min(100, (m / len) * 100)); return `<div class="tvEnds"><span${pct < 16 ? ' class="hid"' : ''}>${fmtTime(win.at)} start</span><em class="tvNowT" style="left:${Math.max(3, Math.min(97, pct))}%">${fmtTime(Date.now())}</em><span${pct > 84 ? ' class="hid"' : ''}>${fmtTime(win.at + len * 60000)} end</span></div>`; })() : ''}`;
      const fb = $('#tvFocusBox [data-cbar]'), wasEmpty = fb && !fb.innerHTML;
      put(boxes, barHtml);
      if (wasEmpty && focus) fitText();
      let html = '';
      if (win && win.next) { const sec = (win.at - Date.now()) / 1000; html = `<div class="lbl">Next class</div><b>${sec < 3600 ? mmss(sec) : fmtTime(win.at)}</b>${sec < 3600 ? `<small>Starts ${fmtTime(win.at)}</small>` : ''}`; }
      else if (live) {
        const el = m * 60, leftMin = Math.max(0, Math.ceil(len - m));
        const what = !seg ? '' : seg.k === 'part' ? (seg.whole ? '' : `${seg.p.L} ${esc(seg.p.name || 'Part ' + seg.p.L)} now`) : seg.k === 'gap' ? `Change over, next ${seg.next.L}` : 'Cooldown';
        // Yellow while you should be working, white in a changeover, grey in the open time at the end. Same colors as the class plan in the workout editor.
        const mode = !seg ? 'open' : seg.k === 'part' ? 'work' : seg.k === 'gap' ? 'rest' : 'open';
        html = `<div class="lbl cw-${mode}">${mode === 'work' ? 'Work' : mode === 'rest' ? 'Change over' : 'Class time'}</div><b class="cw-${mode}">${mmss(el)}</b><small>${leftMin} min left${what ? ' · ' + what : ''}</small>`;
        b.dataset.cmode = mode;
      }
      const changed = nows.some(el => el.innerHTML !== html);
      put(nows, html); if (changed) fitTitle();
      if (!live) delete b.dataset.cmode;
      b.classList.toggle('tvLive', !!html);
      // Light up the card and the part tab on now, and beep as each part and changeover begins.
      const onL = seg && seg.k === 'part' ? seg.p.L : '';
      $$('.tvWodS .tvPartBtn').forEach(c => c.classList.toggle('on', c.dataset.part === onL));
      $$('.tvFTabs [data-fpart]').forEach(c => c.classList.toggle('on', c.dataset.fpart === onL));
      const key = seg ? seg.k + seg.a : '';
      if (live && key && lastSeg && key !== lastSeg) beep(990, 0.5);
      lastSeg = key;
    };
    const paintClock = () => {
      tick(); changeBox(); classBar();
      if (!tm) return;
      const fc = face(tm), c = document.querySelector(`.tvTimer[data-tl="${tm.L}"]`);
      if (c) { c.querySelector('[data-tmbig]').textContent = fc.big; c.querySelector('[data-tmsub]').textContent = fc.sub; c.classList.toggle('end', !!fc.end); c.classList.toggle('lead', !!fc.lead); const g = c.querySelector('[data-tmgo]'); if (g) g.textContent = tm.run ? 'Pause' : tm.fresh ? 'Start' : 'Resume'; }
      if (!focus) pill();
    };

    let focus = null;
    /* ---------- goals and results for the part on screen ---------- */
    // Everyone in the class (from the bookings, or the names picked under Who's here) with their goal for this part
    // and a box for what they actually did. Results save straight to the day's log for that member, the same log the
    // app and the results page use, so leaderboards, PRs and levels update from here too. Coaches signed in on the TV
    // can type; anyone else sees the results as they come in.
    const LVC = { beginner: 'B', rx: 'Rx', comp: 'C' };
    const canLog = () => !!(S.me && runs(gid) && st && st.w && st.w.gym_id === gid);
    const logOfM = id => (st.logs || []).find(x => x.profile_id === id);
    const goalsCard = (p, members, cls) => {
      const its = items(st.w).filter(it => it.L === p.L), l = p.lift, ed = canLog();
      const unit = l && D.unit(l) !== 'lb' ? D.unit(l) : (l ? 'lb' : '');
      const head = `<h3><span>Goals and results</span><button type="button" class="tvWhoBtn" data-whobtn>${cls ? esc(cls.label) : "Who's here?"}</button></h3>`;
      if (!its.length) return `<div class="tvFTargets tvGoals">${head}<p class="tvGoalsNone">Nothing to log on this part.</p></div>`;
      const cols = `minmax(0,1fr)${l ? ' 5.4cqw' : ''}${its.map(() => ' 7.2cqw').join('')}`;
      const rows = members.map(m => {
        const lg = logOfM(m.id) || {}, ent = lg.entries || {}, own = l ? num((lg.goals || {})[l.id]) : 0, t = l ? own || D.target(l, st.rowOf(m)) : 0, lv = ((S.people && S.people.get(m.id)) || m).level || null;
        const res = its.map(it => {
          const v = ent[it.key], shown = it.kind === 't' ? fmtT(v) : num(v) ? fmt(num(v)) : '';
          const cls2 = it.kind === 'w' && num(v) ? (t && num(v) >= t ? ' hit' : ' did') : shown ? ' did' : '';
          return ed ? `<input class="tvRes${cls2}" data-rp="${m.id}" data-rk="${esc(it.key)}" data-kind="${it.kind}" value="${esc(shown)}" inputmode="${it.kind === 'w' ? 'decimal' : 'numeric'}" placeholder="${it.kind === 't' ? 'm:ss' : it.kind === 'r' ? 'reps' : '·'}" aria-label="${esc(m.display_name + ' ' + it.label)}" autocomplete="off">`
            : `<b class="tvResV${cls2}">${shown || '·'}</b>`;
        }).join('');
        return `<li style="grid-template-columns:${cols}"><span>${lv ? `<em class="tvLvC lv-${lv}">${LVC[lv]}</em>` : ''}${esc(m.display_name)}</span>${l ? `<b class="tvGoal${own ? ' own' : ''}"${own ? ' title="Their own goal"' : ''}>${t || '·'}</b>` : ''}${res}</li>`;
      }).join('');
      const labs = its.map(it => `<span>${it.kind === 'w' ? `Did${unit ? ' ' + esc(unit) : ''}` : it.kind === 't' ? 'Time' : 'Reps'}</span>`).join('');
      return `<div class="tvFTargets tvGoals">${head}
        <div class="tvGoalsH" style="grid-template-columns:${cols}"><span>${members.length} in class</span>${l ? `<span>DI goal</span>` : ''}${labs}</div>
        ${members.length ? `<ol>${rows}</ol>` : `<p class="tvGoalsNone">No one in this class yet. Tap Who's here.</p>`}
        ${ed ? '' : `<p class="tvGoalsHint">Coaches signed in on this screen can type results here.</p>`}</div>`;
    };
    // Save one box. Weights to the half pound, times as m:ss, reps as a count. Blank clears it.
    let editing = 0, owed = false;
    const saveRes = async inp => {
      const pid = inp.dataset.rp, k = inp.dataset.rk, kind = inp.dataset.kind, v = inp.value.trim();
      const had = logOfM(pid), entries = { ...((had && had.entries) || {}) };
      if (!v) { if (entries[k] == null) return; delete entries[k]; }
      else {
        const x = kind === 't' ? parseT(v) : kind === 'r' ? Math.max(0, Math.min(99999, Math.round(+v) || 0)) : Math.max(0, Math.min(1499, Math.round(+v * 2) / 2 || 0));
        if (kind === 't' && !(x > 0)) { inp.classList.add('bad'); inp.title = 'Use minutes and seconds, like 8:45'; return; }
        if (entries[k] === x) return;
        entries[k] = x;
      }
      inp.classList.remove('bad'); inp.classList.add('saving');
      const row = { workout_id: st.w.id, profile_id: pid, entries, score: (had && had.score) || null, sets: (had && had.sets) || {} };
      const { data, error } = await sb.from('workout_logs').upsert(row, { onConflict: 'workout_id,profile_id' }).select().single();
      inp.classList.remove('saving');
      if (error) { inp.classList.add('bad'); inp.title = error.message; toast(error.message); return; }
      st.logs = (st.logs || []).filter(x => x.profile_id !== pid).concat([data]);
      const t = kind === 'w' && st.w.lifts ? num(((logOfM(pid) || {}).goals || {})[k]) || D.target((st.w.lifts || []).find(x => x.id === k) || null, st.rowOf(st.members.find(m => m.id === pid) || { id: pid })) : 0, x = num(entries[k]);
      inp.classList.toggle('hit', kind === 'w' && !!x && !!t && x >= t); inp.classList.toggle('did', !!v && !(kind === 'w' && t && x >= t));
      if (kind === 't' && x) inp.value = fmtT(x);
      inp.classList.add('saved'); setTimeout(() => inp.classList.remove('saved'), 1200);
    };
    const bindGoals = box => {
      const ins = [...box.querySelectorAll('.tvRes')];
      ins.forEach((inp, i) => {
        inp.onfocus = () => { editing++; lastTouch = Date.now(); };
        inp.onblur = async () => { await saveRes(inp); editing = Math.max(0, editing - 1); setTimeout(() => { if (!editing && owed) { owed = false; refresh(); } }, 300); };
        inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); const nx = ins[i + 1]; if (nx) nx.focus(); else inp.blur(); } if (e.key === 'Escape') inp.blur(); };
      });
    };
    const focusHtml = () => {
      const ps = st && st.w ? shownParts(st.w) : [], p = ps.find(x => x.L === focus);
      if (!p) return '';
      const members = inClass(), cls = classNow(), l = p.lift;
      return `<div class="tvFocus" role="dialog" aria-modal="true" aria-label="Part ${p.L}">
        <header class="tvFHead"><nav class="tvFTabs">${ps.map(x => `<button type="button" data-fpart="${x.L}"${x.L === p.L ? ' aria-current="true"' : ''}><i>${x.L}</i><span>${esc(x.name || 'Part ' + x.L)}</span></button>`).join('')}</nav>
          <div class="tvNow sm" data-cnow></div><div class="tvClock">${clock()}</div><button type="button" class="tvFClose" id="tvFClose" aria-label="Close (Esc)">×</button></header>
        <div class="tvCBar" data-cbar></div>
        <div class="tvFBody">
          <div class="tvFMain">
            <p class="tvFText" id="tvFText">${esc(p.text)}</p>${levelsHtml(p, 'tvLv big')}
            ${l ? `<div class="tvFLift">${esc(l.n)}${l.sch ? ` · ${esc(l.sch)}` : ''}${l.why ? `<span>${esc(l.why)}</span>` : ''}</div>` : ''}
            ${logWords(p) ? `<span class="tvLog">Log your ${logWords(p)}</span>` : ''}</div>
          <div class="tvFSide">${goalsCard(p, members, cls)}</div>
        </div></div>`;
    };
    // Make the part's words as big as the screen allows.
    const fitText = () => {
      const t = $('#tvFText'); if (!t) return;
      let lo = 1.2, hi = 7;
      for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; t.style.fontSize = m + 'cqw'; if (t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1) hi = m; else lo = m; }
      t.style.fontSize = lo + 'cqw';
    };
    const showFocus = L => {
      focus = L;
      let box = document.getElementById('tvFocusBox');
      if (!L) { if (box) box.remove(); pill(); if (deck) deck.focus({ preventScroll: true }); return; }
      if (!box) { box = document.createElement('div'); box.id = 'tvFocusBox'; box.className = 'tvStageBox'; document.body.appendChild(box); }
      box.innerHTML = focusHtml();
      if (!box.innerHTML) { focus = null; box.remove(); return; }
      classBar(); fitText(); // the class bar takes room first, then the words fill what is left
      box.querySelectorAll('[data-fpart]').forEach(b => b.onclick = () => showFocus(b.dataset.fpart));
      box.querySelectorAll('[data-whobtn]').forEach(b => b.onclick = showWho);
      $('#tvFClose').onclick = () => showFocus(null);
      bindGoals(box); pill();
    };
    // The workout screen: one text size for every part, as big as fits. iPads mirrored to a TV are 4:3, so a fixed size runs off.
    const fitCards = () => {
      const ps = $$('.tvWodS .tvSecsBig p'); if (!ps.length) return;
      const over = () => ps.some(p => p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1);
      let lo = 0.7, hi = 5;
      for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; ps.forEach(p => { p.style.fontSize = m + 'cqw'; }); if (over()) hi = m; else lo = m; }
      ps.forEach(p => { p.style.fontSize = lo + 'cqw'; });
    };
    window.addEventListener('resize', () => { if (tok === S.tok) { fitTitle(); fitCards(); } });
    const bindParts = () => { $$('[data-whobtn]').forEach(b => b.onclick = showWho); bindCards(); };
    const bindCards = () => $$('.tvPartBtn').forEach(c => {
      c.onclick = () => showFocus(c.dataset.part);
      c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); showFocus(c.dataset.part); } };
    });
    window.addEventListener('resize', () => { if (focus && tok === S.tok) fitText(); });

    let deck = null, paused = false;
    // Pause stops the auto scroll until it is pressed again; the screens still scroll by hand.
    const pauseBtn = () => `<button type="button" class="tvPause" id="tvPause" aria-pressed="${paused}" aria-label="${paused ? 'Play the screens' : 'Pause the screens'}" title="${paused ? 'Play' : 'Pause'} (P)">${paused ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>'}</button>`;
    const setPaused = v => { paused = v; const b = $('#tvPause'); if (b) b.outerHTML = pauseBtn(); bindPause(); if (!paused) lastTouch = 0; };
    const bindPause = () => { const b = $('#tvPause'); if (b) b.onclick = () => setPaused(!paused); };
    const draw = () => {
      if (tok !== S.tok || !st) return;
      const list = screens();
      main.innerHTML = `<div class="tvDeck" id="tvDeck" tabindex="0">${list.map((h, i) => `<section class="tvS" data-i="${i}">${h}<footer class="tvFoot"><img src="/assets/mark.svg" alt="Dandy Strength" class="tvFootLogo"><span class="tvFootTime"><span class="tvDate">${esc(new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }))}</span><b class="tvClock">${clock()}</b></span></footer></section>`).join('')}</div>
        <div class="tvStageBox tvDotsBox"><nav class="tvDots" aria-label="Screens">${list.map((_, i) => `<button type="button" data-go="${i}" aria-label="Screen ${i + 1}"${i === cur ? ' aria-current="true"' : ''}></button>`).join('')}${pauseBtn()}</nav></div>`;
      deck = $('#tvDeck');
      cur = Math.min(cur, list.length - 1);
      deck.scrollTop = cur * deck.clientHeight;
      deck.addEventListener('scroll', () => { if (moving) return; const i = Math.round(deck.scrollTop / deck.clientHeight); if (i !== cur) { cur = i; dots(); } }, { passive: true });
      ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(ev => deck.addEventListener(ev, () => { lastTouch = Date.now(); }, { passive: true }));
      $$('.tvDots button[data-go]').forEach(b => b.onclick = () => { lastTouch = Date.now(); goTo(+b.dataset.go); });
      bindPause();
      bindParts();
      classBar(); fitTitle(); fitCards();
      // Text sizes change once the display fonts finish loading; fit again then.
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (tok === S.tok) { fitTitle(); fitCards(); if (focus) fitText(); } });
      if (focus) showFocus(focus); else deck.focus({ preventScroll: true });
    };
    let moving = null;
    const dots = () => $$('.tvDots button[data-go]').forEach((b, k) => b.toggleAttribute('aria-current', k === cur));
    const goTo = i => {
      if (!deck) return;
      const n = deck.children.length; cur = (i + n) % n; dots();
      const want = cur; clearTimeout(moving);
      deck.scrollTo({ top: want * deck.clientHeight, behavior: matchMedia('(prefers-reduced-motion:reduce)').matches || document.hidden ? 'auto' : 'smooth' });
      // Ignore in between scroll positions until it lands; settle it if a smooth scroll stalls.
      moving = setTimeout(() => { moving = null; if (deck && cur === want && Math.abs(deck.scrollTop - want * deck.clientHeight) > 2) deck.scrollTop = want * deck.clientHeight; }, 1500);
    };
    // A smooth scroll can stall when the tab is hidden; settle on the nearest screen when it comes back.
    const onVis = () => { if (tok !== S.tok) return document.removeEventListener('visibilitychange', onVis); if (!document.hidden && deck) deck.scrollTop = cur * deck.clientHeight; };
    document.addEventListener('visibilitychange', onVis);
    const onKey = e => {
      if (tok !== S.tok) { document.removeEventListener('keydown', onKey); return showFocus(null); }
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (focus) {
        const ps = shownParts(st.w).map(x => x.L), i = ps.indexOf(focus);
        if (e.key === 'Escape') { e.preventDefault(); return showFocus(null); }
        const step = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, ' ': 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1 }[e.key];
        if (step) { e.preventDefault(); return showFocus(ps[(i + step + ps.length) % ps.length]); }
      }
      const letter = (e.key || '').toUpperCase();
      if (/^[ABCD]$/.test(letter) && st && st.w && shownParts(st.w).some(x => x.L === letter)) { e.preventDefault(); lastTouch = Date.now(); return showFocus(letter); }
      if (focus) return;
      const k = { ArrowDown: 1, ArrowRight: 1, PageDown: 1, ' ': 1, ArrowUp: -1, ArrowLeft: -1, PageUp: -1 }[e.key];
      if (k) { e.preventDefault(); lastTouch = Date.now(); goTo(cur + k); }
      if (e.key === 'p' || e.key === 'P') setPaused(!paused);
      if (e.key === 'f') document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {});
    };
    document.addEventListener('keydown', onKey);

    const alertPR = e => {
      if (!st || !st.members.some(m => m.id === e.profile_id) || !e.is_pr || e.prev_best == null) return;
      const box = document.createElement('div'); box.className = 'tvAlert';
      box.innerHTML = `<div><span>New PR</span><b>${esc(nameOf(e.profile_id))}</b><strong>${esc(D.liftName(e.lift))} ${fmt(e.weight_lb)} lb</strong><em>+${fmt(num(e.weight_lb) - num(e.prev_best))} lb</em></div>`;
      document.body.appendChild(box); setTimeout(() => box.remove(), 12000);
    };
    const main = $('#main');
    await load();
    if (tok !== S.tok) return;
    draw();
    let busy = false, lastDay = today();
    const refresh = async () => { if (busy || tok !== S.tok) return; if (editing) { owed = true; return; } busy = true; try { await load(); draw(); } catch (e) { console.error(e); } busy = false; };
    const ch = sb.channel('tv-' + gid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workout_logs' }, p => { const wid = (p.new || {}).workout_id; if (st && ((st.w && wid === st.w.id) || (st.yday.w && wid === st.yday.w.id))) refresh(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lift_entries' }, p => { alertPR(p.new); refresh(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workouts' }, () => refresh())
      .subscribe();
    S.channels.push(ch);
    // Each screen shows for the time set in Dandy TV setup (15 seconds unless changed).
    let lastAdv = Date.now();
    tvTimers.push(setInterval(async () => { if (tok !== S.tok || !st || !X.tvConfig) return; const c = await X.tvConfig(gid).catch(() => null); if (JSON.stringify(c) !== JSON.stringify(st.tv)) { st.tv = c; cur = 0; draw(); } }, 60000));
    tvTimers.push(setInterval(() => { if (tok !== S.tok) return clearTv(); const ms = ((st && st.tv && st.tv.class_secs) || SLIDE_MS / 1000) * 1000; if (!paused && !focus && Date.now() - lastTouch > IDLE_MS && Date.now() - lastAdv >= ms) { lastAdv = Date.now(); goTo(cur + 1); } }, 1000));
    tvTimers.push(setInterval(() => { if (tok !== S.tok) return clearTv(); if (today() !== lastDay) { lastDay = today(); cur = 0; } refresh(); }, 5 * 60 * 1000));
    tvTimers.push(setInterval(() => { if (tok !== S.tok) return clearTv(); $$('.tvClock').forEach(c => { c.textContent = clock(); }); }, 20000));
    tvTimers.push(setInterval(() => { if (tok !== S.tok) return clearTv(); paintClock(); }, 200));
  };
}
