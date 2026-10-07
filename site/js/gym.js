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
    return LET.map((L, i) => { const s = (np ? secs.find(x => x.part === L) : secs[i]) || {}; return { L, name: s.name || '', text: s.text || '', time: !!s.time, lift: lifts.find(l => l.part === L) || null }; })
      .filter(p => p.L !== 'D' || withD || p.text || p.lift || p.time);
  }
  // What a screen shows: the parts with something in them. Older days keep every section they had.
  const shownParts = w => isParts(w) ? partsOf(w).filter(p => p.text || p.lift || p.time) : ((w && w.sections) || []).map((s, i) => ({ L: String.fromCharCode(65 + i), name: s.name, text: s.text, lift: null, time: false }));
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
    }
    return out;
  }
  const fmtT = s => { s = Math.round(num(s)); if (!s) return ''; const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
  // "8:45" or "1:02:30"; a plain number is minutes.
  const parseT = v => { v = String(v || '').trim(); if (!v) return 0; if (/^\d+(\.\d+)?$/.test(v)) return Math.round(+v * 60); const m = v.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/); return m ? (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3] : NaN; };
  const cell = (it, v) => (it.kind === 't' ? fmtT(v) : num(v) ? fmt(num(v)) : '');
  // The board ranks by the first thing logged: fastest time, or heaviest weight.
  const rankKey = w => { const its = items(w), it = its.find(i => i.lift && i.lift.max) || its[0]; return it || null; };
  // Part D only shows on a board once somebody logged it.
  const boardItems = (w, logs) => items(w).filter(it => it.L !== 'D' || logs.some(x => num((x.entries || {})[it.key])));
  X.parts = { isParts, partsOf, shownParts, liftLabel, items, fmtT, parseT, cell, rankKey, boardItems };

  // A gym can be reached by its id or its short big screen name (gyms.slug).
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  async function gymIdOf(key) {
    if (UUID.test(key || '')) return key;
    const g = must(await sb.from('gyms').select('id').eq('slug', String(key || '').toLowerCase()).maybeSingle());
    if (!g) throw new Error('No gym here.');
    return g.id;
  }
  const SLUG = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/;

  async function gymData(gid, day) {
    const [g, members, staff, board, ws] = await Promise.all([
      sb.from('gyms').select('*').eq('id', gid).maybeSingle().then(must),
      sb.from('profiles').select('id,display_name,bodyweight,birth_year,sex,tier,role').eq('gym_id', gid).not('display_name', 'is', null).then(must),
      sb.from('gym_staff').select('profile_id,role').eq('gym_id', gid).then(must),
      loadBoard(),
      sb.from('workouts').select('*').eq('day', day).or(`gym_id.is.null,gym_id.eq.${gid}`).then(must),
    ]);
    if (!g) throw new Error('No gym here.');
    const w = ws.find(x => x.gym_id === gid) || ws.find(x => !x.gym_id) || null;
    const logs = w ? must(await sb.from('workout_logs').select('*').eq('workout_id', w.id)) : [];
    const rowOf = m => S.board.find(r => r.profile_id === m.id) || { profile_id: m.id, name: m.display_name, sex: m.sex, bw: num(m.bodyweight) || 185, age: m.birth_year ? new Date().getFullYear() - m.birth_year : 30, bench: 0, squat: 0, dead: 0, clean: 0, score: 0, total: 0 };
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
        <p class="secSub">Gym owners get a free gym page: post the daily workout, enter results for members, and put a live dashboard on the big screen. The DSI team confirms every owner.</p></div>
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
    if (!paint(tok, `<section class="sec"><div class="secHead"><div><div class="kicker">${esc(g.city || 'Gym')} · ${members.length} lifters</div><h2>${esc(g.name)}</h2><p class="secSub">Your gym's page. Post the day, enter results, and run the big screen.</p></div><a class="btn ghost sm" href="/gyms/${gid}">Gym board</a></div>
      <div class="tools">
        <a class="tool" href="/wod/${gid}"><b>Edit workouts</b><span>Type or fix the day: Part A, B, C and sometimes D. Pick the weight members log for each part.</span></a>
        <a class="tool" href="/program?gym=${gid}"><b>Import a week</b><span>From your programming page, Kilo, a whiteboard photo or pasted text. Then fix anything in Edit workouts.</span></a>
        <a class="tool" href="/results/${gid}"><b>Enter results</b><span>Type in everyone's weights and scores from the floor. They go straight to the day board.</span></a>
        <a class="tool" href="/tv/${g.slug || gid}" target="_blank"><b>Big screen</b><span>Open this on the gym TV. It updates live all day.</span></a>
        <a class="tool" href="/week"><b>The week</b><span>What your members see on their phones.</span></a>
      </div>
      <div class="formCard"><div class="formH">Big screen link<span class="sub">Open it in the TV's browser, a Fire Stick or a laptop on HDMI, then go full screen. No login needed.</span></div>
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
      <div class="row"><button class="btn">Save</button><span class="hint" id="gd-msg"></span></div></form></section>` : ''}
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
      toast(v ? 'Big screen link is now /tv/' + v : 'Big screen link reset'); route();
    };
    $('#tvCopy').onclick = async () => { try { await navigator.clipboard.writeText(tvUrl); toast('Link copied'); } catch { $('#tvUrl').select(); } };
    $$('[data-rmc]').forEach(b => b.onclick = async () => { const { error } = await sb.from('gym_staff').delete().eq('gym_id', gid).eq('profile_id', b.dataset.rmc); if (error) return toast(error.message); toast('Coach removed'); route(); });
    const co = $('#coF');
    if (co) co.onsubmit = async e => { e.preventDefault(); const pid = $('#co-p').value; if (!pid) return; const { error } = await sb.from('gym_staff').insert({ gym_id: gid, profile_id: pid, role: 'coach' }); if (error) return toast(error.message); toast('Coach added'); route(); };
    const gd = $('#gdF');
    if (gd) gd.onsubmit = async e => { e.preventDefault(); const { error } = await sb.from('gyms').update({ name: $('#gd-n').value.trim(), city: $('#gd-c').value.trim() || null }).eq('id', gid); $('#gd-msg').textContent = error ? (/gyms_name_ci/.test(error.message) ? 'Another gym already has that name.' : error.message) : 'Saved.'; };
    $$('[data-cl]').forEach(b => b.onclick = async () => { const { error } = await sb.rpc('decide_gym_claim', { p_id: b.dataset.cl, p_approve: !!b.dataset.ok }); if (error) return toast(error.message); toast(b.dataset.ok ? 'Approved. They run that gym now.' : 'Declined'); route(); });
  };

  /* ---------- edit a day: /wod/<gym id or dsi>?day=YYYY-MM-DD ---------- */
  const BASE_OPTS = [['squat', 'Squat'], ['dead', 'Deadlift'], ['clean', 'Clean'], ['bench', 'Bench']];
  VIEWS.wod = async (gid, tok) => {
    if (!S.me) return needLogin(tok, 'edit workouts');
    const dsi = gid === 'dsi';
    if (dsi ? !isStaff() : !runs(gid)) return paint(tok, '<section class="prEmpty"><b>Coaches only</b><p>Gym owners and coaches edit their gym\'s workouts.</p></section>');
    const q0 = new URLSearchParams(location.search).get('day');
    const day = /^\d{4}-\d{2}-\d{2}$/.test(q0 || '') ? q0 : today();
    let wq = sb.from('workouts').select('*').eq('day', day);
    wq = dsi ? wq.is('gym_id', null) : wq.eq('gym_id', gid);
    const [g, ws] = await Promise.all([dsi ? { name: 'The DSI week' } : sb.from('gyms').select('id,name').eq('id', gid).maybeSingle().then(must), wq.then(must), loadBoard()]);
    if (!g) throw new Error('No gym here.');
    const w = ws[0] || null;
    const nLogs = w ? ((await sb.from('workout_logs').select('id', { count: 'exact', head: true }).eq('workout_id', w.id)).count || 0) : 0;
    const old = w && !isParts(w) && (w.lifts || []).length;
    const me = X.boardRow(S.me.id) || { sex: S.me.sex };
    const ps = partsOf(w, true);
    const box = p => {
      const l = p.lift || {}, tt = l.rx && l.rx.length ? 'rx' : l.f ? 'f' : '';
      return `<article class="wodPart" data-p="${p.L}"${p.L === 'D' && !p.text && !p.lift && !p.time ? ' hidden' : ''}>
        <div class="wodPH"><i>${p.L}</i><label class="vh" for="wp-${p.L}">Part ${p.L} name</label><input id="wp-${p.L}" data-name maxlength="40" value="${esc(p.name)}" placeholder="${PH[p.L]}">${p.L === 'D' ? '<button type="button" class="btn ghost sm" data-rmd>Remove</button>' : ''}</div>
        <label class="vh" for="wt-${p.L}">Part ${p.L} workout</label><textarea id="wt-${p.L}" data-text rows="7" maxlength="2000" placeholder="${p.L === 'A' ? 'Warmup, skill or mobility' : 'Sets, reps and movements'}">${esc(p.text)}</textarea>
        ${p.L === 'A' ? '<p class="hint">Part A is not logged.</p>' : `
        <div class="wodTog" role="group" aria-label="What members log for Part ${p.L}"><span>Members log</span>
          <label class="tog"><input type="checkbox" data-trk${p.lift ? ' checked' : ''}><span>Weight</span></label>
          <label class="tog"><input type="checkbox" data-time${p.time ? ' checked' : ''}><span>Time</span></label></div>
        <div class="wodTrk"${p.lift ? '' : ' hidden'}>
          <div class="field"><label for="wn-${p.L}">Movement</label><input id="wn-${p.L}" data-n maxlength="60" value="${esc(l.n || '')}" placeholder="Front squat"></div>
          <div class="field"><label for="ws-${p.L}">Scheme</label><input id="ws-${p.L}" data-sch maxlength="60" value="${esc(l.sch || '')}" placeholder="5 x 3, build"></div>
          <div class="field"><label for="wtt-${p.L}">Target weight</label><select id="wtt-${p.L}" data-tt><option value=""${tt === '' ? ' selected' : ''}>No target</option><option value="f"${tt === 'f' ? ' selected' : ''}>Percent of a lift</option><option value="rx"${tt === 'rx' ? ' selected' : ''}>Rx weight</option></select></div>
          <div class="field" data-for="f rx"><label for="wb-${p.L}">Based on their</label><select id="wb-${p.L}" data-b>${BASE_OPTS.map(([k, n]) => `<option value="${k}"${(l.b || 'squat') === k ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
          <div class="field" data-for="f"><label for="wf-${p.L}">Percent</label><input id="wf-${p.L}" data-f type="number" inputmode="numeric" min="1" max="150" value="${l.f ? Math.round(l.f * 100) : ''}" placeholder="75"></div>
          ${[['rx0', 'Rx men', l.rx && l.rx[0], '95'], ['rxw0', 'Rx women', l.rxw && l.rxw[0], '65'], ['rx1', 'Rx+ men', l.rx && l.rx[1] !== l.rx[0] && l.rx[1], 'optional'], ['rxw1', 'Rx+ women', l.rxw && l.rxw[1] !== l.rxw[0] && l.rxw[1], 'optional']]
            .map(([k, t, v, ph]) => `<div class="field" data-for="rx"><label for="w${k}-${p.L}">${t} lb</label><input id="w${k}-${p.L}" data-${k} type="number" inputmode="numeric" min="1" max="1499" value="${v || ''}" placeholder="${ph}"></div>`).join('')}
          <p class="hint" data-prev></p>
        </div>`}
      </article>`;
    };
    const dest = dsi ? '/week/' + day + (S.me.gym_id ? '?src=dsi' : '') : '/week/' + day;
    if (!paint(tok, `<section class="sec"><div class="secHead"><div><div class="kicker">${esc(g.name)} · ${esc(fmtDW(day))}</div><h2>${w ? 'Edit the' : 'Post the'} <span>workout</span></h2>
        <p class="secSub">Part A is the warmup and is never logged. Parts B, C and D can each log a weight, a time, or both. Everyone is assumed to do all the reps.</p></div>
        <div class="row"><a class="btn ghost sm" href="/wod/${gid}?day=${addDays(day, -1)}">← Day before</a><input type="date" id="wd-day" value="${day}" aria-label="Pick a day" style="max-width:170px"><a class="btn ghost sm" href="/wod/${gid}?day=${addDays(day, 1)}">Next day →</a></div></div></section>
      <section class="sec"><form id="wodF" class="wodEd">
        <div class="field"><label for="wd-t">Title</label><input id="wd-t" maxlength="80" value="${esc((w && w.title) || '')}" placeholder="Front squat + Grace"></div>
        ${old ? '<p class="hint" style="color:var(--flat)">This day still has the old lift list. Saving switches it to Parts, so pick the weight each part logs.</p>' : ''}
        <div class="wodGrid">${ps.map(box).join('')}</div>
        <button type="button" class="btn ghost sm" id="addD"${ps[3].text || ps[3].lift || ps[3].time ? ' hidden' : ''}>+ Add Part D</button>
        <div class="row" style="margin-top:16px"><button class="btn" type="submit">${w ? 'Save changes' : 'Post the workout'}</button><a class="btn ghost" href="${dest}">See it on the week</a>${dsi ? '' : `<a class="btn ghost" href="/results/${gid}?day=${day}">Enter results</a><a class="btn ghost" href="/tv/${gid}" target="_blank">Big screen</a>`}<span class="hint" id="wd-msg">${nLogs ? `${nLogs} logged already. Their weights stay with each part letter.` : ''}</span></div>
      </form></section>`)) return;
    $('#wd-day').onchange = e => { if (e.target.value) go(`/wod/${gid}?day=${e.target.value}`); };
    const build = a => {
      const L = a.dataset.p, trk = $('[data-trk]', a);
      if (!trk || !trk.checked) return null;
      const n = $('[data-n]', a).value.trim(), tt = $('[data-tt]', a).value, b = $('[data-b]', a).value;
      const prev = (ps.find(p => p.L === L) || {}).lift || {};
      const l = { id: L.toLowerCase(), part: L, n, sch: $('[data-sch]', a).value.trim() };
      const bn = (BASE_OPTS.find(x => x[0] === b) || [, ''])[1].toLowerCase();
      if (tt === 'f') { const f = +$('[data-f]', a).value; if (f > 0) { l.b = b; l.f = Math.round(f) / 100; l.why = `${Math.round(f)}% of your ${bn}`; } }
      if (tt === 'rx') {
        const r0 = +$('[data-rx0]', a).value, r1 = +$('[data-rx1]', a).value, w0 = +$('[data-rxw0]', a).value, w1 = +$('[data-rxw1]', a).value;
        if (r0 > 0) {
          l.b = b; l.rx = [r0, r1 > r0 ? r1 : r0];
          if (w0 > 0) l.rxw = [w0, w1 > w0 ? w1 : w0];
          const pair = (m, w) => (w ? `${m}/${w}` : `${m}`);
          l.why = `${pair(r0, w0 || 0)} Rx${r1 > r0 ? `, ${pair(r1, w1 > w0 ? w1 : 0)} Rx+ once your ${bn} is strong enough` : ''}`;
        }
      }
      if (!l.why) l.why = 'Log the weight you used';
      if (prev.max) l.max = true;
      return l;
    };
    const preview = a => { const out = $('[data-prev]', a); if (!out) return; const l = build(a); const t = l && D.target(l, me); out.textContent = t ? `Your target: ${t} lb` : ''; };
    $$('.wodPart').forEach(a => {
      const trk = $('[data-trk]', a), tk = $('.wodTrk', a);
      const sync = () => { if (!tk) return; tk.hidden = !trk.checked; const tt = $('[data-tt]', a).value; $$('[data-for]', a).forEach(f => { f.hidden = !tt || !f.dataset.for.split(' ').includes(tt); }); preview(a); };
      if (trk) { trk.onchange = sync; a.addEventListener('input', sync); a.addEventListener('change', sync); sync(); }
    });
    const dBox = $('.wodPart[data-p="D"]');
    $('#addD').onclick = e => { dBox.hidden = false; e.target.hidden = true; $('[data-text]', dBox).focus(); };
    $('[data-rmd]', dBox).onclick = () => { dBox.hidden = true; $('#addD').hidden = false; $('[data-text]', dBox).value = ''; $('[data-name]', dBox).value = ''; $('[data-time]', dBox).checked = false; const t = $('[data-trk]', dBox); t.checked = false; t.dispatchEvent(new Event('change')); };
    $('#wodF').onsubmit = async e => {
      e.preventDefault();
      const msg = $('#wd-msg'), sections = [], lifts = [];
      for (const a of $$('.wodPart')) {
        if (a.hidden) continue;
        const L = a.dataset.p, text = $('[data-text]', a).value.trim(), name = $('[data-name]', a).value.trim(), l = build(a);
        if (l && !l.n) { msg.textContent = `Part ${L} logs a weight. Name the movement.`; $('[data-n]', a).focus(); return; }
        const tm = !!($('[data-time]', a) || {}).checked;
        if (text || l || tm) sections.push(tm ? { part: L, name: name || PH[L], text, time: true } : { part: L, name: name || PH[L], text });
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
    if (!w || w.gym_id !== gid) return paint(tok, `<section class="sec"><div class="secHead"><div><div class="kicker">${esc(g.name)} · ${esc(fmtDW(day))}</div><h2>Enter <span>results</span></h2></div>${nav}</div>
      <div class="prEmpty"><b>${esc(g.name)} has no workout posted for this day</b><p>Results go on your own gym's workout. Post it first.</p><p><a class="btn" href="/wod/${gid}?day=${day}">Post the workout</a></p></div></section>`);
    const its = items(w), logOf = id => logs.find(l => l.profile_id === id);
    const inp = (it, m, ent, r) => it.kind === 't'
      ? `<input class="wkIn wkTime" inputmode="numeric" maxlength="8" data-l="${esc(it.key)}" data-kind="t" value="${esc(fmtT(ent[it.key]))}" placeholder="m:ss" aria-label="${esc(m.display_name + ' ' + it.label)}">`
      : `<input class="wkIn" type="number" inputmode="decimal" step="any" min="0" max="1499" data-l="${esc(it.key)}" value="${esc(ent[it.key] ?? '')}" placeholder="${D.target(it.lift, r) || ''}" aria-label="${esc(m.display_name + ' ' + it.label)}">`;
    if (!paint(tok, `<section class="sec"><div class="secHead"><div><div class="kicker">${esc(g.name)} · ${esc(fmtDW(day))}</div><h2>${esc(w.title)}</h2><p class="secSub">Type the weight each member used and their time where a part is timed (like 8:45). Blank means they did not do it. Targets show in grey.</p><p><a class="btn ghost sm" href="/wod/${gid}?day=${day}">Edit this workout</a></p></div>${nav}</div>
      <form id="rsF"><div class="board"><div class="tablewrap"><table class="wkT rsT"><thead><tr><th>Member</th>${its.map(it => `<th class="r">${esc(it.label)}<div class="sub">${esc(it.sch || (it.kind === 't' ? 'm:ss' : ''))}</div></th>`).join('')}${w.score_label ? `<th class="r">${esc(w.score_label)}</th>` : ''}</tr></thead><tbody>
      ${members.map(m => { const lg = logOf(m.id), ent = (lg && lg.entries) || {}, r = rowOf(m); return `<tr data-pid="${m.id}"><td><b>${esc(m.display_name)}</b>${lg ? ' <span class="pill up">Logged</span>' : ''}</td>
        ${its.map(it => `<td class="r">${inp(it, m, ent, r)}</td>`).join('')}
        ${w.score_label ? `<td class="r"><input class="wkIn wkScore" maxlength="40" data-score value="${esc((lg && lg.score) || '')}" placeholder="${w.score_type === 'time' ? '12:34' : ''}" aria-label="${esc(m.display_name + ' ' + w.score_label)}"></td>` : ''}</tr>`; }).join('') || `<tr><td class="empty" colspan="${its.length + 2}">No members yet. Members pick ${esc(g.name)} on the Gym league page.</td></tr>`}
      </tbody></table></div></div>
      <div class="row" style="margin-top:14px"><button class="btn" type="submit">Save results</button><a class="btn ghost" href="/tv/${g.slug || gid}" target="_blank">Big screen</a><span class="hint" id="rs-msg"></span></div></form></section>`)) return;
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
          const x = i.dataset.kind === 't' ? parseT(v) : Math.max(0, Math.min(1499, Math.round(+v * 2) / 2 || 0));
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
  const clearTv = () => { tvTimers.forEach(t => clearInterval(t)); tvTimers = []; };
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
    const gid = await gymIdOf(key);
    let st = null, cur = 0, lastTouch = 0;
    const load = async () => {
      const d = today();
      const [base, yday] = await Promise.all([gymData(gid, d), dayOf(gid, addDays(d, -1))]);
      const ids = base.members.map(m => m.id);
      const [prs, by, bt] = await Promise.all([
        ids.length ? sb.from('lift_entries').select('id,profile_id,lift,weight_lb,prev_best,performed_on').in('profile_id', ids).eq('is_pr', true).not('prev_best', 'is', null).neq('status', 'struck').gte('performed_on', addDays(d, -13)).order('performed_on', { ascending: false }).limit(10).then(must) : [],
        X.compete.allEntries(),
        sb.from('battles').select('*').eq('status', 'accepted').eq('week_start', monday(d)).then(must),
      ]);
      const q = X.compete.quarter(d);
      const rows = base.members.map(m => ({ m, r: base.rowOf(m) })).filter(x => x.r.score);
      const lb = rows.map(x => ({ ...x, s: X.compete.gainIn(by.get(x.m.id) || [], x.r, q.start, d) })).sort((a, b) => b.r.score - a.r.score);
      st = { ...base, yday, prs, lb, q, by, battles: bt.filter(b => ids.includes(b.challenger) || ids.includes(b.opponent)) };
    };
    const nameOf = id => (st.members.find(m => m.id === id) || {}).display_name || (S.board.find(r => r.profile_id === id) || {}).name || 'Someone';
    const clock = () => new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    const screens = () => {
      const { g, w, logs, members, rowOf, lb, prs, q, battles, by, yday } = st;
      const out = [];
      const head = (k, t) => `<header class="tvHead"><div class="tvGym"><img src="/assets/mark.svg" alt="DSI" class="tvLogo"><div><b>${esc(g.name)}</b><span>${esc(k)}</span></div></div><div class="tvTitle">${t}</div><div class="tvClock">${clock()}</div></header>`;
      // 1. Workout of the day
      out.push(`${head(fmtDW(today()), 'Workout of the <em>day</em>')}<div class="tvBody tvWodS">
        ${w ? `<h1>${esc(w.title)}</h1><div class="tvSecsBig${shownParts(w).length > 3 ? ' four' : ''}">${shownParts(w).map(p => `<div><b><i>${p.L}</i>${esc(p.name)}</b><p>${esc(p.text)}</p>${p.lift || p.time ? `<span class="tvLog">Log your ${[p.lift ? esc(p.lift.n) + ' weight' : '', p.time ? 'time' : ''].filter(Boolean).join(' and ')}</span>` : ''}</div>`).join('')}</div>${w.score_label ? `<div class="tvScoreBy">Scored by ${esc(w.score_label)}</div>` : ''}`
        : `<h1>Rest or not posted</h1><p class="tvEmpty">Coaches post the day at dandystrength.com/gym/${esc(g.id)}</p>`}</div>`);
      // 2. Today's targets (one screen per 12 members)
      const lifts = (w && w.lifts) || [];
      if (lifts.length) {
        const pages = Math.max(1, Math.ceil(members.length / PER_TARGETS));
        for (let p = 0; p < pages; p++) {
          const chunk = members.slice(p * PER_TARGETS, p * PER_TARGETS + PER_TARGETS);
          out.push(`${head(fmtDW(today()), `Today's <em>targets</em>${pages > 1 ? ` <small>${p + 1}/${pages}</small>` : ''}`)}<div class="tvBody">
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
      out.push(`${head(fmtDW(today()), `Today's <em>board</em>`)}<div class="tvBody">${w ? `<div class="tvSub">${esc(w.title)} · ${logs.length} of ${members.length} logged</div>` : ''}${board(w, logs, 12)}</div>`);
      // 4. Yesterday's results
      out.push(`${head(fmtDW(yday.day), `Yesterday's <em>results</em>`)}<div class="tvBody">${yday.w ? `<div class="tvSub">${esc(yday.w.title)} · ${yday.logs.length} logged</div>${board(yday.w, yday.logs, 12)}` : '<p class="tvEmpty">No workout yesterday.</p>'}</div>`);
      // 5 and 6. Men's and women's leaderboards for the major lifts
      for (const [sex, label] of [['male', "Men's"], ['female', "Women's"]]) {
        const rs = lb.filter(x => (x.r.sex || '') === sex);
        const col = (t, key, unit) => { const top = [...rs].filter(x => num(x.r[key])).sort((a, b) => num(b.r[key]) - num(a.r[key])).slice(0, 8);
          return `<div class="tvCol"><h3>${t}</h3><ol>${top.map((x, i) => `<li class="${i === 0 ? 'top' : ''}"><span>${esc(x.m.display_name)}</span><b>${fmt(x.r[key])}${unit}</b></li>`).join('') || '<li class="none">Nobody yet</li>'}</ol></div>`; };
        out.push(`${head('Best lifts on the board', `${label} <em>leaderboard</em>`)}<div class="tvBody">${rs.length ? `<div class="tvCols">${col('DSI™', 'score', '')}${col('Total', 'total', '')}${D.LIFTS.map(l => col(l.n, l.k, '')).join('')}</div><div class="tvKey">Best lifts in pounds. DSI scores each lifter against people their age and size.</div>`
          : `<p class="tvEmpty">No ${label.toLowerCase().replace("'s", '')} on the ${esc(g.name)} board yet. Get your DSI at dandystrength.com/join</p>`}</div>`);
      }
      // 7. Season, battles and PRs
      out.push(`${head('Season ' + q.q + ' · ' + fmtD(q.start) + ' to ' + fmtD(q.end), `${esc(q.name)} <em>standings</em>`)}<div class="tvBody tvGrid2">
        <div><h3 class="tvH3">Most DSI gained this season</h3><table class="tvT tvRank"><tbody>${[...lb].sort((a, b) => b.s.pts - a.s.pts).filter(x => x.s.pts).slice(0, 8).map((x, i) => `<tr class="${i === 0 ? 'top' : ''}"><td>${i + 1}</td><td>${esc(x.m.display_name)}</td><td class="sc">+${x.s.pts}</td></tr>`).join('') || '<tr><td>Nobody has gained yet this season.</td></tr>'}</tbody></table>
          ${battles.length ? `<h3 class="tvH3">Battles this week</h3>${battles.slice(0, 4).map(b => { const a = X.compete.gainIn(by.get(b.challenger) || [], S.board.find(r => r.profile_id === b.challenger) || {}, b.week_start, today()), o = X.compete.gainIn(by.get(b.opponent) || [], S.board.find(r => r.profile_id === b.opponent) || {}, b.week_start, today()); return `<div class="tvBt"><span>${esc(nameOf(b.challenger))} <b>+${a.pts}</b></span><i>vs</i><span><b>+${o.pts}</b> ${esc(nameOf(b.opponent))}</span></div>`; }).join('')}` : ''}</div>
        <div><h3 class="tvH3">Latest PRs</h3><ol class="tvPRs">${prs.map(p => `<li><b>${esc(nameOf(p.profile_id))}</b><span>${esc(D.liftName(p.lift))} ${fmt(p.weight_lb)} lb</span><em>+${fmt(num(p.weight_lb) - num(p.prev_best))}</em><small>${fmtD(p.performed_on)}</small></li>`).join('') || '<li class="none">No PRs in the last two weeks. Somebody fix that.</li>'}</ol></div></div>`);
      return out;
    };

    let deck = null;
    const draw = () => {
      if (tok !== S.tok || !st) return;
      const list = screens();
      main.innerHTML = `<div class="tvDeck" id="tvDeck" tabindex="0">${list.map((h, i) => `<section class="tvS" data-i="${i}">${h}<footer class="tvFoot"><span class="tvUrl">dandystrength.com</span></footer></section>`).join('')}</div>
        <nav class="tvDots" aria-label="Screens">${list.map((_, i) => `<button type="button" data-go="${i}" aria-label="Screen ${i + 1}"${i === cur ? ' aria-current="true"' : ''}></button>`).join('')}</nav>`;
      deck = $('#tvDeck');
      cur = Math.min(cur, list.length - 1);
      deck.scrollTop = cur * deck.clientHeight;
      deck.addEventListener('scroll', () => { if (moving) return; const i = Math.round(deck.scrollTop / deck.clientHeight); if (i !== cur) { cur = i; dots(); } }, { passive: true });
      ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(ev => deck.addEventListener(ev, () => { lastTouch = Date.now(); }, { passive: true }));
      $$('.tvDots button').forEach(b => b.onclick = () => { lastTouch = Date.now(); goTo(+b.dataset.go); });
      deck.focus({ preventScroll: true });
    };
    let moving = null;
    const dots = () => $$('.tvDots button').forEach((b, k) => b.toggleAttribute('aria-current', k === cur));
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
      if (tok !== S.tok) return document.removeEventListener('keydown', onKey);
      const k = { ArrowDown: 1, ArrowRight: 1, PageDown: 1, ' ': 1, ArrowUp: -1, ArrowLeft: -1, PageUp: -1 }[e.key];
      if (k) { e.preventDefault(); lastTouch = Date.now(); goTo(cur + k); }
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
    const refresh = async () => { if (busy || tok !== S.tok) return; busy = true; try { await load(); draw(); } catch (e) { console.error(e); } busy = false; };
    const ch = sb.channel('tv-' + gid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workout_logs' }, p => { const wid = (p.new || {}).workout_id; if (st && ((st.w && wid === st.w.id) || (st.yday.w && wid === st.yday.w.id))) refresh(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lift_entries' }, p => { alertPR(p.new); refresh(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workouts' }, () => refresh())
      .subscribe();
    S.channels.push(ch);
    tvTimers.push(setInterval(() => { if (tok !== S.tok) return clearTv(); if (Date.now() - lastTouch > IDLE_MS) goTo(cur + 1); }, SLIDE_MS));
    tvTimers.push(setInterval(() => { if (tok !== S.tok) return clearTv(); if (today() !== lastDay) { lastDay = today(); cur = 0; } refresh(); }, 5 * 60 * 1000));
    tvTimers.push(setInterval(() => { if (tok !== S.tok) return clearTv(); $$('.tvClock').forEach(c => { c.textContent = clock(); }); }, 20000));
  };
}
