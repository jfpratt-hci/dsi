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

  async function gymData(gid, day) {
    const [g, members, staff, board, ws] = await Promise.all([
      sb.from('gyms').select('*').eq('id', gid).maybeSingle().then(must),
      sb.from('profiles').select('id,display_name,bodyweight,birth_year,tier,role').eq('gym_id', gid).not('display_name', 'is', null).then(must),
      sb.from('gym_staff').select('profile_id,role').eq('gym_id', gid).then(must),
      loadBoard(),
      sb.from('workouts').select('*').eq('day', day).or(`gym_id.is.null,gym_id.eq.${gid}`).then(must),
    ]);
    if (!g) throw new Error('No gym here.');
    const w = ws.find(x => x.gym_id === gid) || ws.find(x => !x.gym_id) || null;
    const logs = w ? must(await sb.from('workout_logs').select('*').eq('workout_id', w.id)) : [];
    const rowOf = m => S.board.find(r => r.profile_id === m.id) || { profile_id: m.id, name: m.display_name, bw: num(m.bodyweight) || 185, age: m.birth_year ? new Date().getFullYear() - m.birth_year : 30, bench: 0, squat: 0, dead: 0, clean: 0, score: 0, total: 0 };
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
    const tvUrl = location.origin + '/tv/' + gid;
    if (!paint(tok, `<section class="sec"><div class="secHead"><div><div class="kicker">${esc(g.city || 'Gym')} · ${members.length} lifters</div><h2>${esc(g.name)}</h2><p class="secSub">Your gym's page. Post the day, enter results, and run the big screen.</p></div><a class="btn ghost sm" href="/gyms/${gid}">Gym board</a></div>
      <div class="tools">
        <a class="tool" href="/program?gym=${gid}"><b>Post the workout</b><span>From your programming page, a whiteboard photo or pasted text. Members get their own target weights.</span></a>
        <a class="tool" href="/results/${gid}"><b>Enter results</b><span>Type in everyone's weights and scores from the floor. They go straight to the day board.</span></a>
        <a class="tool" href="/tv/${gid}" target="_blank"><b>Big screen</b><span>Open this on the gym TV. It updates live all day.</span></a>
        <a class="tool" href="/week"><b>The week</b><span>What your members see on their phones.</span></a>
      </div>
      <div class="formCard"><div class="formH">Big screen link<span class="sub">Open it in the TV's browser, a Fire Stick or a laptop on HDMI, then go full screen. No login needed.</span></div>
        <div class="row"><input id="tvUrl" readonly value="${esc(tvUrl)}" style="max-width:420px"><button class="btn ghost sm" type="button" id="tvCopy">Copy link</button></div></div></section>
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
    $('#tvCopy').onclick = async () => { try { await navigator.clipboard.writeText(tvUrl); toast('Link copied'); } catch { $('#tvUrl').select(); } };
    $$('[data-rmc]').forEach(b => b.onclick = async () => { const { error } = await sb.from('gym_staff').delete().eq('gym_id', gid).eq('profile_id', b.dataset.rmc); if (error) return toast(error.message); toast('Coach removed'); route(); });
    const co = $('#coF');
    if (co) co.onsubmit = async e => { e.preventDefault(); const pid = $('#co-p').value; if (!pid) return; const { error } = await sb.from('gym_staff').insert({ gym_id: gid, profile_id: pid, role: 'coach' }); if (error) return toast(error.message); toast('Coach added'); route(); };
    const gd = $('#gdF');
    if (gd) gd.onsubmit = async e => { e.preventDefault(); const { error } = await sb.from('gyms').update({ name: $('#gd-n').value.trim(), city: $('#gd-c').value.trim() || null }).eq('id', gid); $('#gd-msg').textContent = error ? (/gyms_name_ci/.test(error.message) ? 'Another gym already has that name.' : error.message) : 'Saved.'; };
    $$('[data-cl]').forEach(b => b.onclick = async () => { const { error } = await sb.rpc('decide_gym_claim', { p_id: b.dataset.cl, p_approve: !!b.dataset.ok }); if (error) return toast(error.message); toast(b.dataset.ok ? 'Approved. They run that gym now.' : 'Declined'); route(); });
  };

  /* ---------- coaches enter results ---------- */
  VIEWS.results = async (gid, tok) => {
    if (!S.me) return needLogin(tok, 'enter results');
    if (!runs(gid)) return paint(tok, '<section class="prEmpty"><b>Coaches only</b><p>Gym owners and coaches enter results here.</p></section>');
    const day = new URLSearchParams(location.search).get('day') || today();
    const { g, members, w, logs, rowOf } = await gymData(gid, day);
    const nav = `<div class="row"><a class="btn ghost sm" href="/results/${gid}?day=${addDays(day, -1)}">← Day before</a>${day !== today() ? `<a class="btn ghost sm" href="/results/${gid}">Today</a>` : ''}<a class="btn ghost sm" href="/results/${gid}?day=${addDays(day, 1)}">Next day →</a></div>`;
    if (!w || w.gym_id !== gid) return paint(tok, `<section class="sec"><div class="secHead"><div><div class="kicker">${esc(g.name)} · ${esc(fmtDW(day))}</div><h2>Enter <span>results</span></h2></div>${nav}</div>
      <div class="prEmpty"><b>${esc(g.name)} has no workout posted for this day</b><p>Results go on your own gym's workout. Post it first.</p><p><a class="btn" href="/program?gym=${gid}">Post the workout</a></p></div></section>`);
    const lifts = w.lifts || [], logOf = id => logs.find(l => l.profile_id === id);
    if (!paint(tok, `<section class="sec"><div class="secHead"><div><div class="kicker">${esc(g.name)} · ${esc(fmtDW(day))}</div><h2>${esc(w.title)}</h2><p class="secSub">Type what each member lifted. Blank means they did not do it. Targets show in grey.</p></div>${nav}</div>
      <form id="rsF"><div class="board"><div class="tablewrap"><table class="wkT rsT"><thead><tr><th>Member</th>${lifts.map(l => `<th class="r">${esc(l.n)}<div class="sub">${esc(l.sch)}</div></th>`).join('')}${w.score_label ? `<th class="r">${esc(w.score_label)}</th>` : ''}</tr></thead><tbody>
      ${members.map(m => { const lg = logOf(m.id), ent = (lg && lg.entries) || {}, r = rowOf(m); return `<tr data-pid="${m.id}"><td><b>${esc(m.display_name)}</b>${lg ? ' <span class="pill up">Logged</span>' : ''}</td>
        ${lifts.map(l => { const t = D.target(l, r); return `<td class="r"><input class="wkIn" type="number" inputmode="decimal" step="any" min="0" max="1499" data-l="${esc(l.id)}" value="${esc(ent[l.id] ?? '')}" placeholder="${t || ''}" aria-label="${esc(m.display_name + ' ' + l.n)}"></td>`; }).join('')}
        ${w.score_label ? `<td class="r"><input class="wkIn wkScore" maxlength="40" data-score value="${esc((lg && lg.score) || '')}" placeholder="${w.score_type === 'time' ? '12:34' : ''}" aria-label="${esc(m.display_name + ' ' + w.score_label)}"></td>` : ''}</tr>`; }).join('') || `<tr><td class="empty" colspan="${lifts.length + 2}">No members yet. Members pick ${esc(g.name)} on the Gym league page.</td></tr>`}
      </tbody></table></div></div>
      <div class="row" style="margin-top:14px"><button class="btn" type="submit">Save results</button><a class="btn ghost" href="/tv/${gid}" target="_blank">Big screen</a><span class="hint" id="rs-msg"></span></div></form></section>`)) return;
    $('#rsF').onsubmit = async e => {
      e.preventDefault();
      const msg = $('#rs-msg'), rows = [];
      $$('tr[data-pid]').forEach(tr => {
        const entries = {}; $$('[data-l]', tr).forEach(i => { const v = i.value.trim(); if (v) entries[i.dataset.l] = Math.max(0, Math.min(1499, Math.round(+v * 2) / 2 || 0)); });
        const sc = $('[data-score]', tr), score = sc ? sc.value.trim().slice(0, 40) : '';
        const had = logOf(tr.dataset.pid);
        if (!Object.keys(entries).length && !score && !had) return;
        rows.push({ workout_id: w.id, profile_id: tr.dataset.pid, entries: { ...((had && had.entries) || {}), ...entries }, score: score || null, sets: (had && had.sets) || {} });
      });
      if (!rows.length) { msg.textContent = 'Nothing to save yet.'; return; }
      msg.textContent = 'Saving…';
      const { error } = await sb.from('workout_logs').upsert(rows, { onConflict: 'workout_id,profile_id' });
      if (error) { msg.textContent = error.message; return; }
      toast(`Saved ${rows.length} result${rows.length === 1 ? '' : 's'}`); route();
    };
  };

  /* ---------- the big screen ---------- */
  let tvTimers = [];
  const clearTv = () => { tvTimers.forEach(t => clearInterval(t)); tvTimers = []; };
  VIEWS.tv = async (gid, tok) => {
    clearTv();
    let state = null, page = 0, lastDay = today();
    const load = async () => {
      const d = today();
      const base = await gymData(gid, d);
      const ids = base.members.map(m => m.id);
      const since = addDays(d, -13);
      const [prs, by, bt] = await Promise.all([
        ids.length ? sb.from('lift_entries').select('id,profile_id,lift,weight_lb,prev_best,performed_on,created_at').in('profile_id', ids).eq('is_pr', true).not('prev_best', 'is', null).neq('status', 'struck').gte('performed_on', since).order('created_at', { ascending: false }).limit(12).then(must) : [],
        X.compete.allEntries(),
        sb.from('battles').select('*').eq('status', 'accepted').eq('week_start', monday(d)).then(must),
      ]);
      const q = X.compete.quarter(d);
      const lb = base.members.map(m => { const r = base.rowOf(m); return { m, r, s: X.compete.gainIn(by.get(m.id) || [], r, q.start, d) }; }).filter(x => x.r.score).sort((a, b) => b.r.score - a.r.score);
      state = { ...base, prs, lb, q, battles: bt.filter(b => ids.includes(b.challenger) || ids.includes(b.opponent)), by };
    };
    const nameOf = id => (state.members.find(m => m.id === id) || {}).display_name || S.board.find(r => r.profile_id === id)?.name || 'Someone';
    const draw = () => {
      if (tok !== S.tok || !state) return;
      const { g, w, logs, members, rowOf, lb, prs, q, battles, by } = state;
      const lifts = (w && w.lifts) || [];
      const per = 10, pages = Math.max(1, Math.ceil(members.length / per));
      page = page % pages;
      const shown = members.slice(page * per, page * per + per);
      const logOf = id => logs.find(l => l.profile_id === id);
      const isT = w && w.score_type === 'time';
      const secs = s => { const m = String(s || '').match(/^(\d+):(\d{1,2})$/); return m ? +m[1] * 60 + +m[2] : 1e9; };
      const key = (lifts.find(l => l.max) || lifts[0] || {}).id;
      const day = logs.filter(l => l.status !== 'struck').sort((a, b) => (isT && (a.score || b.score) ? secs(a.score) - secs(b.score) : 0) || num((b.entries || {})[key]) - num((a.entries || {})[key])).slice(0, 8);
      const clock = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      main.innerHTML = `<div class="tvWrap">
        <header class="tvHead"><div class="tvGym"><img src="/assets/mark.svg" alt="DSI" class="tvLogo"><div><b>${esc(g.name)}</b><span>${esc(fmtDW(today()))}</span></div></div><div class="tvClock">${clock}</div></header>
        <section class="tvCard tvWod"><div class="tvK">Today${w && !w.gym_id ? ' · DSI week' : ''}</div><h1>${w ? esc(w.title) : 'No workout posted'}</h1>
          ${w ? `<div class="tvSecs">${(w.sections || []).slice(0, 4).map(s => `<div><b>${esc(s.name)}</b><p>${esc(s.text)}</p></div>`).join('')}</div>` : `<p class="tvEmpty">Coaches post the day at dandystrength.com/gym/${esc(g.id)}</p>`}
          ${lifts.length ? `<table class="tvT"><thead><tr><th>Lifter</th>${lifts.map(l => `<th>${esc(l.n)}<span>${esc(l.sch)}</span></th>`).join('')}</tr></thead><tbody>
          ${shown.map(m => { const r = rowOf(m), ent = ((logOf(m.id) || {}).entries) || {}; return `<tr><td>${esc(m.display_name)}</td>${lifts.map(l => { const t = D.target(l, r), v = num(ent[l.id]); return `<td class="${v ? (t && v >= t ? 'hit' : 'did') : ''}">${v ? v : t ? t : '·'}</td>`; }).join('')}</tr>`; }).join('')}
          </tbody></table>${pages > 1 ? `<div class="tvPage">Page ${page + 1} of ${pages}</div>` : ''}<div class="tvKey"><span class="hit">■</span> hit the target <span class="did">■</span> logged <span>■</span> target</div>` : ''}
        </section>
        <section class="tvCard tvDay"><div class="tvK">Day board</div>
          ${day.length ? `<ol class="tvList">${day.map((l, i) => `<li><span class="p">${i + 1}</span><span class="n">${esc(nameOf(l.profile_id))}</span><span class="v">${esc(l.score || (key && (l.entries || {})[key] ? (l.entries || {})[key] + ' lb' : ''))}</span></li>`).join('')}</ol>` : '<p class="tvEmpty">Nobody has logged yet. Be first.</p>'}
        </section>
        <section class="tvCard tvLb"><div class="tvK">${esc(g.name)} leaderboard · ${esc(q.name)}</div>
          <table class="tvT tvSmall"><thead><tr><th>#</th><th>Lifter</th><th>DSI</th><th>Season</th></tr></thead><tbody>
          ${lb.slice(0, 8).map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.m.display_name)}</td><td>${x.r.score}</td><td>${x.s.pts ? '+' + x.s.pts : '·'}</td></tr>`).join('') || '<tr><td colspan="4">Log your four lifts to get on the board.</td></tr>'}
          </tbody></table>
          ${battles.length ? `<div class="tvK" style="margin-top:14px">Battles this week</div>${battles.slice(0, 3).map(b => { const end = today(), a = X.compete.gainIn(by.get(b.challenger) || [], S.board.find(r => r.profile_id === b.challenger) || {}, b.week_start, end), o = X.compete.gainIn(by.get(b.opponent) || [], S.board.find(r => r.profile_id === b.opponent) || {}, b.week_start, end); return `<div class="tvBt"><span>${esc(nameOf(b.challenger))} <b>+${a.pts}</b></span><i>vs</i><span><b>+${o.pts}</b> ${esc(nameOf(b.opponent))}</span></div>`; }).join('')}` : ''}
        </section>
        <footer class="tvTicker"><b>PRs</b><div class="tvRun">${prs.length ? prs.map(p => `<span>${esc(nameOf(p.profile_id))} · ${esc(D.liftName(p.lift))} ${fmt(p.weight_lb)} lb <em>+${fmt(num(p.weight_lb) - num(p.prev_best))}</em> · ${fmtD(p.performed_on)}</span>`).join('') : '<span>No PRs in the last two weeks. Somebody fix that.</span>'}</div><span class="tvUrl">dandystrength.com</span></footer>
      </div>`;
    };
    const alertPR = async e => {
      if (!state || !state.members.some(m => m.id === e.profile_id) || !e.is_pr || e.prev_best == null) return;
      const box = document.createElement('div'); box.className = 'tvAlert';
      box.innerHTML = `<div><span>New PR</span><b>${esc(nameOf(e.profile_id))}</b><strong>${esc(D.liftName(e.lift))} ${fmt(e.weight_lb)} lb</strong><em>+${fmt(num(e.weight_lb) - num(e.prev_best))} lb</em></div>`;
      document.body.appendChild(box); setTimeout(() => box.remove(), 12000);
    };
    const main = $('#main');
    await load();
    if (tok !== S.tok) return;
    draw();
    try { document.documentElement.requestFullscreen && document.addEventListener('dblclick', () => document.documentElement.requestFullscreen().catch(() => {}), { once: true }); } catch {}
    let busy = false;
    const refresh = async () => { if (busy || tok !== S.tok) return; busy = true; try { await load(); draw(); } catch (e) { console.error(e); } busy = false; };
    const ch = sb.channel('tv-' + gid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workout_logs' }, p => { if (state && state.w && (p.new || {}).workout_id === state.w.id) refresh(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lift_entries' }, p => { alertPR(p.new); refresh(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workouts' }, () => refresh())
      .subscribe();
    S.channels.push(ch);
    tvTimers.push(setInterval(() => { if (tok !== S.tok) return clearTv(); page++; draw(); }, 15000));
    tvTimers.push(setInterval(() => { if (tok !== S.tok) return clearTv(); if (today() !== lastDay) { lastDay = today(); page = 0; } refresh(); }, 5 * 60 * 1000));
    tvTimers.push(setInterval(() => { if (tok !== S.tok) return clearTv(); const c = document.querySelector('.tvClock'); if (c) c.textContent = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }, 20000));
  };
}
