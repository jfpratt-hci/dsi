// The board: one page with four views (Lifters, Benchmarks, PRs, Gyms) under one header, and the benchmark
// workouts (Fran and the 2K row) tracked like the four DSI lifts: log a time, the best counts, a faster time is a PR.
// app.js calls install(ctx) after the other views exist and before the members only wrapping.

export function install(X) {
  const { sb, D, S, VIEWS, $, $$, esc, fmtD, addDays, monday, today, toast, must, needLogin, loadBoard, loadPeople, nameOf, boardRow, boardBar } = X;
  const main = () => $('#main');
  const fmtS = s => { s = Math.round(+s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
  const parseS = v => { v = String(v || '').trim(); const m = v.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/); return m ? (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3] : NaN; };
  const daysAgo = d => Math.round((Date.parse(today()) - Date.parse(d)) / 864e5);
  const head = k => `<section class="sec bdHead"><div class="kicker">The board</div><h2>Dandy <span>board</span></h2>${boardBar(k)}</section>`;
  const after = (k, f) => async (a, tok) => { await f(a, tok); if (tok === S.tok && main() && !main().querySelector('.bdHead')) main().insertAdjacentHTML('afterbegin', head(k)); };
  const benchName = (k, rx) => { const b = D.BENCH_BY[k]; return b ? b.n + (b.rx ? (rx ? ' Rx' : ' scaled') : '') : k; };

  /* ---------- benchmark boards ---------- */
  const gymBench = VIEWS.benchmarks; // named workouts from class days (/benchmarks/<name>)
  S.bbf = S.bbf || { std: 'rx', div: 'all' };
  VIEWS.benchmarks = async (name, tok) => {
    if (name && !D.BENCH.some(b => b.k === name.toLowerCase())) return gymBench(name, tok);
    const [rows, , ws] = await Promise.all([
      sb.from('benchmark_entries').select('id,profile_id,bench,seconds,rx,performed_on,is_pr,prev_best,status').neq('status', 'struck').order('performed_on', { ascending: false }).limit(5000).then(must),
      loadBoard(),
      sb.from('workouts').select('day,benchmark').not('benchmark', 'is', null).order('day', { ascending: false }).then(r => r.data || []),
    ]);
    if (!S.people.size) await loadPeople();
    const named = [...new Set(ws.map(w => w.benchmark))];
    if (tok !== S.tok) return;
    main().innerHTML = `<section class="sec"><div class="secHead"><div><div class="kicker">Benchmark workouts</div><h2>Fran and the <span>2K row</span></h2>
        <p class="secSub">Tracked like the four lifts. Log your time, your best counts, and beating it is a PR on the wall.</p></div>
        <div class="row">${S.me ? '<a class="btn sm" href="/train#bench">Log a time</a>' : '<a class="btn sm" href="/join">Join to log</a>'}</div></div>
        <div class="row bbFilt"><div class="chips" aria-label="Division">${[['all', 'All'], ['men', 'Men'], ['women', 'Women']].map(([v, t]) => `<button class="chip" data-bdiv="${v}" aria-pressed="${S.bbf.div === v}">${t}</button>`).join('')}</div></div>
        <div class="bbGrid" id="bbGrid"></div></section>
      ${named.length ? `<section class="sec"><h3>Class <span>benchmarks</span></h3><p class="secSub">Named workouts from gym class days. Every log counts toward its board.</p><div class="tools">${named.map(n => { const w = ws.filter(x => x.benchmark === n); return `<a class="tool" href="/benchmarks/${encodeURIComponent(n)}"><b>${esc(n)}</b><span>${w.length} time${w.length === 1 ? '' : 's'} · last ${fmtD(w[0].day)}</span></a>`; }).join('')}</div></section>` : ''}`;
    const draw = () => {
      const f = S.bbf, divOf = pid => { const r = boardRow(pid); return r ? (r.division === 'women' || r.sex === 'female' ? 'women' : 'men') : 'men'; };
      $('#bbGrid').innerHTML = D.BENCH.map(b => {
        const mine = rows.filter(r => r.bench === b.k && (!b.rx || r.rx === (f.std === 'rx')) && (f.div === 'all' || divOf(r.profile_id) === f.div));
        const best = new Map();
        mine.forEach(r => { const c = best.get(r.profile_id); if (!c || r.seconds < c.seconds) best.set(r.profile_id, r); });
        const list = [...best.values()].sort((a, c) => a.seconds - c.seconds || a.performed_on.localeCompare(c.performed_on));
        const me = S.me && best.get(S.me.id), myPos = me ? list.indexOf(me) + 1 : 0;
        return `<article class="bbCard" style="--c:${b.c}" id="bb-${b.k}"><header><div><h3>${esc(b.n)}</h3><p>${esc(b.d)}</p></div>
            ${b.rx ? `<div class="chips" aria-label="${esc(b.n)} standard">${[['rx', 'Rx'], ['scaled', 'Scaled']].map(([v, t]) => `<button class="chip" data-bstd="${v}" aria-pressed="${f.std === v}">${t}</button>`).join('')}</div>` : ''}</header>
          <p class="bbStd">${esc(b.std)}</p>
          ${me ? `<div class="bbMe"><span>Your best</span><b>${fmtS(me.seconds)}</b><span>#${myPos} of ${list.length} · ${fmtD(me.performed_on)}</span></div>` : ''}
          ${list.length ? `<div class="tablewrap"><table class="lb"><thead><tr><th>#</th><th>Lifter</th><th class="r hl">Time</th><th class="r">Date</th></tr></thead><tbody>
          ${list.map((r, i) => `<tr class="${S.me && S.me.id === r.profile_id ? 'me' : ''}"><td class="pos">${i + 1}</td><td><div class="who"><a href="/u/${r.profile_id}">${esc(nameOf(r.profile_id))}</a></div></td><td class="r n big">${fmtS(r.seconds)}${r.is_pr && r.prev_best && daysAgo(r.performed_on) <= 6 ? `<div class="sub"><span class="prDateNew">PR, was ${fmtS(r.prev_best)}</span></div>` : ''}</td><td class="r n">${fmtD(r.performed_on)}</td></tr>`).join('')}
          </tbody></table></div>` : `<div class="empty">Nobody has logged ${esc(benchName(b.k, f.std === 'rx'))} yet. First time on the board wins.</div>`}
        </article>`;
      }).join('');
      $$('[data-bstd]').forEach(x => x.onclick = () => { S.bbf.std = x.dataset.bstd; draw(); });
    };
    $$('[data-bdiv]').forEach(x => x.onclick = () => { S.bbf.div = x.dataset.bdiv; $$('[data-bdiv]').forEach(y => y.setAttribute('aria-pressed', String(y === x))); draw(); });
    draw();
    if (name) { const el = document.getElementById('bb-' + name.toLowerCase()); if (el) el.scrollIntoView({ block: 'start' }); }
  };

  /* ---------- log a benchmark time (on Train, and under Log a lift) ---------- */
  const benchHtml = () => `<section class="sec" id="benchLog"><div class="secHead"><div><div class="kicker">Benchmark workouts</div><h2>Log a <span>time</span></h2>
      <p class="secSub">Fran and the 2K row are tracked like the lifts. Your fastest time counts on the board, and beating it is a PR.</p></div><a class="btn ghost sm" href="/benchmarks">See the boards</a></div>
      <form class="formCard" id="bnF"><div class="fields">
        <div class="field w2"><label for="bn-b">Workout</label><select id="bn-b">${D.BENCH.map(b => `<option value="${b.k}">${esc(b.n)} · ${esc(b.d)}</option>`).join('')}</select></div>
        <div class="field"><label for="bn-t">Time (m:ss)</label><input id="bn-t" inputmode="numeric" placeholder="4:35" maxlength="8" required autocomplete="off"></div>
        <div class="field"><label for="bn-d">Date</label><input id="bn-d" type="date" value="${today()}" max="${today()}" required></div>
        <div class="field w4" id="bn-rxw"><label class="tog"><input type="checkbox" id="bn-rx" checked><span>Rx</span></label><span class="hint" id="bn-std"></span></div>
        <div class="field w4"><label for="bn-n">Note (optional)</label><input id="bn-n" maxlength="280" placeholder="Scaled to 75 lb, banded pull ups, damper 6…"></div></div>
        <div class="row"><button class="btn" type="submit">Log it</button><span class="hint" id="bn-msg"></span></div></form></section>`;
  const bindBench = mine => {
    const bestOf = (k, rx) => { const v = mine.filter(r => r.bench === k && (!D.BENCH_BY[k].rx || r.rx === rx)).map(r => r.seconds); return v.length ? Math.min(...v) : 0; };
    const sel = $('#bn-b'), sync = () => { const b = D.BENCH_BY[sel.value], rx = $('#bn-rx').checked; $('#bn-rxw').hidden = !b.rx; const best = bestOf(b.k, b.rx ? rx : true); $('#bn-std').textContent = (b.rx ? b.std + ' ' : '') + (best ? `Your best: ${fmtS(best)}.` : 'No time yet.'); };
    sel.onchange = sync; $('#bn-rx').onchange = sync; sync();
    const f = $('#bnF');
    f.onsubmit = async e => {
      e.preventDefault();
      const msg = $('#bn-msg'), secs = parseS($('#bn-t').value), b = D.BENCH_BY[sel.value];
      if (!(secs >= 60)) { msg.textContent = 'Type the time as minutes and seconds, like 4:35.'; return; }
      const btn = f.querySelector('button'); btn.disabled = true; msg.textContent = 'Saving…';
      const { data, error } = await sb.from('benchmark_entries').insert({ profile_id: S.me.id, bench: b.k, seconds: secs, rx: b.rx ? $('#bn-rx').checked : true, performed_on: $('#bn-d').value, note: $('#bn-n').value.trim() || null }).select().single();
      btn.disabled = false;
      if (error) { msg.textContent = error.message; return; }
      mine.push(data);
      const nm = benchName(data.bench, data.rx);
      if (data.is_pr && data.prev_best) { msg.innerHTML = `<b style="color:var(--accent)">New ${esc(nm)} PR: ${fmtS(data.prev_best)} → ${fmtS(data.seconds)}.</b> ${fmtS(data.prev_best - data.seconds)} faster. It's on the <a href="/prs">PR wall</a>.`; toast(`New ${nm} PR!`); }
      else if (data.is_pr || !data.prev_best) msg.innerHTML = `<b style="color:var(--accent)">${esc(nm)}: ${fmtS(data.seconds)} is on the board.</b> <a href="/benchmarks/${data.bench}">See where you rank</a>.`;
      else msg.textContent = `Logged ${fmtS(data.seconds)}. Your best is still ${fmtS(data.prev_best)}.`;
      $('#bn-t').value = ''; $('#bn-n').value = ''; sync();
    };
  };
  const myBench = async () => ((await sb.from('benchmark_entries').select('bench,seconds,rx').eq('profile_id', S.me.id).neq('status', 'struck')).data) || [];
  // Paints just the form, for the Train page.
  X.benchForm = async tok => {
    if (!S.me) return;
    const mine = await myBench();
    if (tok !== S.tok) return;
    main().innerHTML = benchHtml(); bindBench(mine);
  };
  const logLift = VIEWS.log;
  VIEWS.log = async (a, tok) => {
    await logLift(a, tok);
    if (tok !== S.tok || !S.me || !$('#logF')) return;
    const mine = await myBench();
    if (tok !== S.tok) return;
    $('#logF').closest('section').insertAdjacentHTML('afterend', benchHtml()); bindBench(mine);
    if (location.hash === '#bench') $('#benchLog').scrollIntoView({ block: 'start' });
  };

  /* ---------- PR wall: benchmark PRs sit with the lift PRs ---------- */
  const prWall = VIEWS.prs;
  VIEWS.prs = async (day, tok) => {
    await prWall(day, tok);
    if (tok !== S.tok) return;
    const wk = /^\d{4}-\d{2}-\d{2}$/.test(day || '') ? monday(day) : monday(today());
    const feed = ((await sb.from('bench_pr_feed').select('*').gte('performed_on', wk).lt('performed_on', addDays(wk, 7)).order('created_at', { ascending: false }).limit(100)).data) || [];
    if (tok !== S.tok || !feed.length) return;
    const card = p => { const b = D.BENCH_BY[p.bench] || {}; return `<article class="prCard${daysAgo(p.performed_on) <= 6 ? ' hot' : ''}" style="--c:${b.c || 'var(--muted)'}">
      <div class="prTop"><span class="prTag">${daysAgo(p.performed_on) <= 6 ? 'New PR' : 'PR'}</span><span class="prDate">${fmtD(p.performed_on)}</span></div>
      <a class="prName" href="/u/${p.profile_id}">${esc(p.name)}</a>
      <div class="prLift">${esc(benchName(p.bench, p.rx))} <b>${fmtS(p.seconds)}</b></div>
      <div class="prGain">${fmtS(p.prev_best - p.seconds)} faster</div><div class="sub">was ${fmtS(p.prev_best)}</div>
      <div class="prAct"><a class="btn ghost sm" href="/benchmarks/${p.bench}">Board</a></div></article>`; };
    const grid = $('#prGrid');
    const html = `<section class="sec"><h3>Benchmark <span>PRs</span></h3><div class="prGrid">${feed.map(card).join('')}</div></section>`;
    if (grid) grid.closest('section').insertAdjacentHTML('beforebegin', html);
  };

  /* ---------- lifter page: benchmark bests under the DSI card ---------- */
  const lifter = VIEWS.u;
  VIEWS.u = async (id, tok) => {
    await lifter(id, tok);
    if (tok !== S.tok || !id) return;
    const rows = ((await sb.from('benchmark_entries').select('bench,seconds,rx,performed_on').eq('profile_id', id).neq('status', 'struck')).data) || [];
    if (tok !== S.tok || !rows.length) return;
    const best = new Map();
    rows.forEach(r => { const k = r.bench + (D.BENCH_BY[r.bench] && D.BENCH_BY[r.bench].rx ? (r.rx ? ':rx' : ':sc') : ''), c = best.get(k); if (!c || r.seconds < c.seconds) best.set(k, r); });
    const card = $('#main article.card');
    if (card) card.insertAdjacentHTML('afterend', `<section class="sec"><h2>Bench<span>marks</span></h2><div class="goalRows">${[...best.values()].map(r => `<a class="g" href="/benchmarks/${r.bench}" style="--c:${(D.BENCH_BY[r.bench] || {}).c || 'var(--muted)'}"><h4>${esc(benchName(r.bench, r.rx))}</h4><div class="big">${fmtS(r.seconds)}</div><div class="now">${fmtD(r.performed_on)} · ${rows.filter(x => x.bench === r.bench && x.rx === r.rx).length} logged</div></a>`).join('')}</div></section>`);
  };

  /* ---------- one header across the four views ---------- */
  VIEWS.benchmarks = after('bench', VIEWS.benchmarks);
  VIEWS.prs = after('prs', VIEWS.prs);
  VIEWS.gyms = after('gyms', VIEWS.gyms);
}
