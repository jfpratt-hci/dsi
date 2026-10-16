// /growth/<gym>  Gym office, owners and Dandy admins only: the growth game.
// Two scores on the DSI scale (500 is par) and a season of quests.
//   Growth Index: members, retention, how many leads join and revenue per member, each measured against par
//     for a gym this size and age. That par is the handicap: a 40 member gym and a 400 member gym play the same game.
//   Reputation Index: Google rating, reviews for the gym's size and how fast new reviews come in.
//   Season points: quests done, plus points for checking in every week and keeping the streak.
// The numbers come from a weekly check in for now (most gyms still run billing elsewhere); Dandy data fills in as it grows.

export function install(X) {
  const { sb, S, VIEWS, $, $$, esc, num, fmt, today, fmtD, addDays, monday, toast, must, paint, needLogin, go } = X;
  const isOwner = gid => (S.me && S.me.role === 'admin') || (S.myGyms || []).some(g => g.gym_id === gid && g.role === 'owner');
  const missing = e => e && (e.code === '42P01' || e.code === 'PGRST205' || /gym_growth/.test(e.message || ''));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const money = c => '$' + fmt(Math.round(c / 100));
  const AREAS = { members: 'New members', retention: 'Keep members', revenue: 'Revenue', reputation: 'Reputation', space: 'The space' };
  const LEVELS = ['Rookie', 'Regular', 'Contender', 'Competitor', 'Elite', 'Legend'];
  const PER_LEVEL = 250;

  // Ideas any gym can start with. Owners add their own too.
  const IDEAS = [
    ['reputation', 'Update the Google profile: address, hours and 10 new photos', 75, 'Most new members find you on Google first. An old address or old photos cost you calls.'],
    ['reputation', 'Reply to every Google review, good and bad', 50, 'Replies show people someone cares, and Google ranks active profiles higher.'],
    ['reputation', 'Ask 10 longtime members for a Google review', 100, 'Your happiest members will say yes. Send them the direct review link.'],
    ['reputation', 'Post 3 times a week on Instagram for a month', 75, 'Consistency beats polish: workouts, PRs and member stories.'],
    ['members', 'Put membership plans and prices on the website', 100, 'People who cannot see a price leave. A clear price gets the call.'],
    ['members', 'Run a bring a friend Saturday', 100, 'Friends of members join at the best rate of any lead.'],
    ['members', 'Host a free community workout this month', 75, 'Open the doors to the neighborhood and collect names to follow up.'],
    ['members', 'Light the sign at night', 75, 'A dark sign is invisible to evening traffic, when most people drive by.'],
    ['members', 'Add a text us number to the website', 50, 'Leads text faster than they call. Answer within 5 minutes.'],
    ['retention', 'Text every member not seen in 14 days', 50, 'A personal text from a coach brings most of them back before they cancel.'],
    ['retention', 'Sit down with 5 members for a goal check in', 75, 'Members with a goal and a coach who knows it stay longer.'],
    ['retention', 'Celebrate every PR this week on the board and social', 25, 'People stay where they are noticed.'],
    ['revenue', 'Rent an empty office to a massage therapist, PT or chiropractor', 200, 'Rent covers bills, and their clients become your leads.'],
    ['revenue', 'Stock the shop with drinks and snacks', 50, 'Easy money from people already in the building.'],
    ['revenue', 'Launch a 6 week challenge as a paid add on', 150, 'A start and an end date sell, and it brings former members back.'],
    ['space', 'Finish the build out punch list', 100, 'Unfinished work tells members the gym is stuck.'],
    ['space', 'Refresh the entrance and lobby', 100, 'The first 10 seconds inside decide how a trial class feels.'],
  ];

  /* ---------- scoring ---------- */
  // Par for a gym this size and age: net member growth a quarter and members lost a month (percent).
  // A starting estimate that tightens as more gyms play.
  const parFor = (members, opened) => {
    const p = members < 75 ? { grow: 6, churn: 6 } : members < 150 ? { grow: 4, churn: 5 } : { grow: 2.5, churn: 4 };
    const age = opened ? new Date().getFullYear() - opened : null;
    if (age != null && age < 2) p.grow += 2;
    return { ...p, size: members < 75 ? 'Small gym' : members < 150 ? 'Mid size gym' : 'Big gym', age };
  };
  const wk = d => Math.round((Date.parse(d + 'T12:00:00') - Date.parse('2020-01-06T12:00:00')) / (7 * 864e5));
  const sum = (rs, k) => rs.reduce((a, r) => a + (num(r[k]) || 0), 0);
  const has = (rs, k) => rs.some(r => r[k] != null);

  function growthIndex(rows, set) {
    const m = rows.filter(r => r.members != null);
    if (!m.length) return { score: null, parts: [], par: null };
    const base = m[0], last = m[m.length - 1], par = parFor(last.members, set.opened_year);
    const weeks = wk(last.week) - wk(base.week), parts = [];
    if (weeks >= 1 && base.members) {
      const g = ((last.members - base.members) / base.members) * 100, parNow = (par.grow * weeks) / 13;
      parts.push(['Member growth', clamp(Math.round((g - parNow) * 12), -250, 250), `${g >= 0 ? '+' : ''}${g.toFixed(1)}% in ${weeks} week${weeks === 1 ? '' : 's'}, par ${parNow.toFixed(1)}%`]);
    }
    const r4 = rows.slice(-4);
    if (has(r4, 'cancels')) {
      const avg = sum(r4.filter(r => r.members != null), 'members') / Math.max(1, r4.filter(r => r.members != null).length);
      const churn = avg ? (sum(r4, 'cancels') / avg) * (4.33 / r4.length) * 100 : 0;
      parts.push(['Keeping members', clamp(Math.round((par.churn - churn) * 20), -150, 150), `${churn.toFixed(1)}% lost a month, par ${par.churn}%`]);
    }
    const nw = sum(r4, 'new_members'), tr = sum(r4, 'trials'), ld = sum(r4, 'leads');
    if (has(r4, 'new_members') && (tr || ld)) {
      const conv = tr ? (nw / tr) * 100 : (nw / ld) * 100, p = tr ? 50 : 25;
      parts.push([tr ? 'Trials that join' : 'Leads that join', clamp(Math.round((conv - p) * 1.5), -75, 75), `${Math.round(conv)}% join, par ${p}%`]);
    }
    const rv = rows.filter(r => r.revenue_cents != null && r.members);
    if (rv.length >= 2) {
      const per = r => r.revenue_cents / r.members, a = per(rv[0]), b = rv.slice(-4).reduce((s, r) => s + per(r), 0) / Math.min(4, rv.length);
      const ch = a ? ((b - a) / a) * 100 : 0;
      parts.push(['Revenue per member', clamp(Math.round(ch * 4), -100, 100), `${money(b)} a week each, ${ch >= 0 ? '+' : ''}${ch.toFixed(0)}% since the start`]);
    }
    return { score: clamp(Math.round(500 + parts.reduce((a, p) => a + p[1], 0)), 0, 1000), parts, par, base, last, weeks };
  }

  function reputationIndex(rows) {
    const rr = rows.filter(r => r.google_rating != null || r.google_reviews != null);
    if (!rr.length) return { score: null, parts: [] };
    const last = rr[rr.length - 1], parts = [];
    const members = (rows.filter(r => r.members != null).slice(-1)[0] || {}).members || 0;
    const rating = [...rr].reverse().find(r => r.google_rating != null), revs = [...rr].reverse().find(r => r.google_reviews != null);
    if (rating) parts.push(['Google rating', clamp(Math.round((num(rating.google_rating) - 4.7) * 500), -300, 150), `${num(rating.google_rating).toFixed(1)} stars, par 4.7`]);
    if (revs) {
      const ratio = revs.google_reviews / Math.max(members, 20);
      parts.push(['Reviews for your size', clamp(Math.round(100 * Math.log2(Math.max(ratio, 0.01) / 0.5)), -150, 150), `${fmt(revs.google_reviews)} reviews, par is 1 for every 2 members`]);
      const older = rr.filter(r => r.google_reviews != null && wk(revs.week) - wk(r.week) >= 4), old = older[older.length - 1];
      if (old) {
        const per = ((revs.google_reviews - old.google_reviews) / (wk(revs.week) - wk(old.week))) * 4.33;
        parts.push(['New reviews', clamp(Math.round((per - 2) * 25), -50, 150), `${per.toFixed(1)} a month, par 2`]);
      }
    }
    return { score: clamp(Math.round(500 + parts.reduce((a, p) => a + p[1], 0)), 0, 1000), parts, last };
  }

  function season(rows, quests) {
    const done = quests.filter(q => q.status === 'done'), qp = done.reduce((a, q) => a + q.points, 0);
    const weeks = new Set(rows.map(r => wk(r.week)));
    let streak = 0; const now = wk(monday(today()));
    for (let w = weeks.has(now) ? now : now - 1; weeks.has(w); w--) streak++;
    const pts = qp + weeks.size * 10 + streak * 5;
    const lv = Math.min(LEVELS.length - 1, Math.floor(pts / PER_LEVEL));
    return { pts, qp, checkins: weeks.size, streak, level: LEVELS[lv], next: lv < LEVELS.length - 1 ? LEVELS[lv + 1] : null, into: pts - lv * PER_LEVEL, thisWeek: weeks.has(now), done: done.length };
  }

  const verdict = s => s == null ? '' : s >= 700 ? 'Crushing it' : s >= 560 ? 'Ahead of par' : s >= 440 ? 'On par' : s >= 300 ? 'Behind par' : 'Needs work';
  const tone = s => s == null ? '' : s >= 560 ? 'up' : s >= 440 ? 'flat' : 'down';

  /* ---------- the page ---------- */
  async function load(gid) {
    const safe = p => p.then(r => { if (r.error) { if (missing(r.error)) return { data: null, off: true }; throw r.error; } return r; });
    const [c, q, s] = await Promise.all([
      safe(sb.from('gym_growth_checkins').select('*').eq('gym_id', gid).order('week')),
      safe(sb.from('gym_growth_quests').select('*').eq('gym_id', gid).order('sort').order('created_at')),
      safe(sb.from('gym_growth_settings').select('*').eq('gym_id', gid).maybeSingle()),
    ]);
    const byWeek = new Map(); (c.data || []).forEach(r => byWeek.set(r.week, r)); // the latest save for a week wins
    return { rows: [...byWeek.values()].sort((a, b) => (a.week < b.week ? -1 : 1)), quests: q.data || [], set: s.data || {}, off: c.off || q.off };
  }

  const scoreTile = (k, label, x, empty) => `<div class="grTile grScore ${tone(x.score)}"><span class="grLbl">${label}</span>
    ${x.score == null ? `<b class="grBig none">·</b><p class="hint">${empty}</p>` : `<b class="grBig">${x.score}</b><span class="pill ${tone(x.score)}">${verdict(x.score)}</span>
    <ul class="grParts">${x.parts.length ? x.parts.map(([n, p, d]) => `<li><span>${esc(n)}<small>${esc(d)}</small></span><em class="${p > 0 ? 'up' : p < 0 ? 'down' : ''}">${p > 0 ? '+' : ''}${p}</em></li>`).join('') : '<li class="hint">Starting line set. Check in next week and the score starts to move.</li>'}</ul>`}</div>`;

  // Members by week, with the season goal as a line.
  const trend = (rows, set) => {
    const m = rows.filter(r => r.members != null).slice(-16);
    if (m.length < 2) return '<p class="hint">Two check ins draw the line.</p>';
    const W = 300, H = 90, goal = num(set.goal_members) || 0;
    const vals = m.map(r => r.members), lo = Math.min(...vals, goal || Infinity) * 0.95, hi = Math.max(...vals, goal) * 1.03 || 1;
    const x = i => (i / (m.length - 1)) * W, y = v => H - ((v - lo) / (hi - lo || 1)) * H;
    return `<svg class="grTrend" viewBox="0 -6 ${W} ${H + 12}" role="img" aria-label="Members by week, ${vals[0]} to ${vals[vals.length - 1]}">
      ${goal ? `<line x1="0" x2="${W}" y1="${y(goal)}" y2="${y(goal)}" class="goal"/><text x="${W}" y="${y(goal) - 4}" text-anchor="end" class="goalT">Goal ${goal}</text>` : ''}
      <polyline points="${m.map((r, i) => `${x(i)},${y(r.members)}`).join(' ')}" class="line"/>${m.map((r, i) => `<circle cx="${x(i)}" cy="${y(r.members)}" r="2.6"/>`).join('')}</svg>`;
  };

  VIEWS.growth = async (gid, tok) => {
    if (!S.me) return needLogin(tok, 'see your gym growth game');
    if (!gid && (S.myGyms || []).length) return go('/growth/' + S.myGyms[0].gym_id, true);
    if (!isOwner(gid)) return paint(tok, '<section class="prEmpty"><b>Owners only</b><p>Gym owners play the growth game here.</p></section>');
    const g = must(await sb.from('gyms').select('*').eq('id', gid).maybeSingle());
    if (!g) return paint(tok, '<section class="prEmpty"><b>No gym here</b></section>');
    const d = await load(gid);
    if (d.off) return paint(tok, `${X.officeBar(g, 'growth')}<section class="prEmpty"><b>Growth switches on with the next update</b><p>The database part goes in next. Check back shortly.</p></section>`);
    const qs = new URLSearchParams(location.search), qtab = qs.get('q') || 'open';
    const G = growthIndex(d.rows, d.set), R = reputationIndex(d.rows), SN = season(d.rows, d.quests);
    const wkNow = monday(today()), cur = d.rows.find(r => r.week === wkNow) || {}, prev = [...d.rows].reverse().find(r => r.week < wkNow) || {};
    const open = d.quests.filter(q => q.status === 'open'), done = d.quests.filter(q => q.status !== 'open').sort((a, b) => (b.done_at || '') > (a.done_at || '') ? 1 : -1);
    const lastM = G.last ? G.last.members : null, goal = num(d.set.goal_members) || 0;
    const toGo = goal && lastM != null ? goal - lastM : null;
    const goalWeeks = d.set.goal_date ? Math.max(0, Math.ceil((Date.parse(d.set.goal_date + 'T12:00:00') - Date.now()) / (7 * 864e5))) : null;
    const f = (k, l, v, ph, step) => `<label class="grF"><span>${l}</span><input name="${k}" type="number" inputmode="decimal" min="0" step="${step || 1}" value="${v ?? ''}" placeholder="${ph ?? ''}"></label>`;
    const qRow = q => `<li class="grQ ${q.status}" data-q="${q.id}"><span class="grArea a-${q.area}">${esc(AREAS[q.area] || q.area)}</span>
      <div class="grQT"><b>${esc(q.title)}</b>${q.why ? `<small>${esc(q.why)}</small>` : ''}</div><em class="grPts">${q.points}</em>
      ${q.status === 'open' ? `<button class="btn sm" data-done>Done</button><button class="btn ghost sm" data-skip title="Skip this one">Skip</button>` : `<span class="hint">${q.status === 'done' ? 'Done ' + fmtD(String(q.done_at || '').slice(0, 10)) : 'Skipped'}</span><button class="btn ghost sm" data-undo>Undo</button>`}</li>`;

    if (!paint(tok, `${X.officeBar(g, 'growth')}<section class="sec grSec">
      <div class="grHead"><div><div class="kicker">Private to owners · Season one</div><h2>Growth <span>game</span></h2></div>
        <p class="hint">500 is par for a gym your size${G.par ? ` (${esc(G.par.size.toLowerCase())}${G.par.age != null ? `, ${G.par.age} year${G.par.age === 1 ? '' : 's'} open` : ''})` : ''}. Beat par and the score climbs.</p></div>
      <div class="grTiles">
        ${scoreTile('g', 'Growth Index', G, 'Enter this week\'s members to set the starting line.')}
        ${scoreTile('r', 'Reputation Index', R, 'Enter the Google rating and review count.')}
        <div class="grTile grSeason"><span class="grLbl">Season points</span><b class="grBig">${fmt(SN.pts)}</b><span class="pill acc">${SN.level}</span>
          <div class="grLvl" role="progressbar" aria-valuemin="0" aria-valuemax="${PER_LEVEL}" aria-valuenow="${SN.into}" aria-label="Progress to the next level"><i style="width:${SN.next ? Math.round((SN.into / PER_LEVEL) * 100) : 100}%"></i></div>
          <p class="hint">${SN.next ? `${PER_LEVEL - SN.into} to ${SN.next}` : 'Top level'} · ${SN.done} quest${SN.done === 1 ? '' : 's'} done · ${SN.checkins} check in${SN.checkins === 1 ? '' : 's'}</p>
          <div class="grStreak"><b>${SN.streak}</b><span>week streak${SN.thisWeek ? '' : '<br><em>Check in this week to keep it</em>'}</span></div></div>
        <div class="grTile grGoal"><span class="grLbl">Season goal</span>
          ${goal ? `<b class="grBig">${goal}</b><span class="hint">members${d.set.goal_date ? ' by ' + fmtD(d.set.goal_date) : ''}</span>
            <p>${toGo == null ? 'Check in to see the gap.' : toGo <= 0 ? '<b class="up">Goal reached.</b> Set the next one.' : `<b>${toGo}</b> to go${goalWeeks ? `, about ${Math.ceil(toGo / Math.max(1, goalWeeks) * 10) / 10} a week for ${goalWeeks} weeks` : ''}.`}</p>` : '<p class="hint">Pick a member count to chase this season.</p>'}
          ${trend(d.rows, d.set)}
          <button class="btn ghost sm" type="button" id="grSetB">${goal ? 'Change goal' : 'Set a goal'}</button></div>
      </div>
      <div class="grMain">
        <div class="formCard grQuests"><div class="grQHead"><h3 class="inH">Quests</h3>
          <nav class="chips"><a class="chip" href="/growth/${gid}" aria-pressed="${qtab === 'open'}">Open ${open.length}</a><a class="chip" href="/growth/${gid}?q=done" aria-pressed="${qtab === 'done'}">Done ${done.length}</a></nav>
          <button class="btn ghost sm" type="button" id="grIdeas">Ideas</button><button class="btn ghost sm" type="button" id="grAdd">Add a quest</button></div>
          <div id="grPanel"></div>
          <ol class="grQs">${(qtab === 'done' ? done : open).map(qRow).join('') || `<li class="hint">${qtab === 'done' ? 'Nothing done yet. Pick the easiest open quest and knock it out this week.' : 'No open quests. Add one from Ideas.'}</li>`}</ol></div>
        <form class="formCard grCheck" id="grCheck"><div class="grQHead"><h3 class="inH">Weekly check in</h3><span class="pill ${SN.thisWeek ? 'up' : 'acc'}">${SN.thisWeek ? 'Done this week' : '+10 points'}</span></div>
          <label class="grF wide"><span>Week of</span><input name="week" type="date" value="${wkNow}" step="7"></label>
          <div class="grFs">${f('members', 'Members', cur.members, prev.members)}${f('new_members', 'New', cur.new_members, 0)}${f('cancels', 'Canceled', cur.cancels, 0)}${f('trials', 'Trials', cur.trials, 0)}${f('leads', 'Leads', cur.leads, 0)}${f('revenue', 'Revenue $', cur.revenue_cents != null ? cur.revenue_cents / 100 : '', prev.revenue_cents != null ? prev.revenue_cents / 100 : '')}${f('google_rating', 'Google ★', cur.google_rating, prev.google_rating, 0.1)}${f('google_reviews', 'Reviews', cur.google_reviews, prev.google_reviews)}</div>
          <label class="grF wide"><span>What happened this week</span><input name="note" maxlength="200" value="${esc(cur.note || '')}" placeholder="Ran a bring a friend day, 6 came"></label>
          <button class="btn">Save check in</button><p class="hint">Members is everyone paying at the end of the week. Leads are calls, texts, forms and walk ins.</p></form>
      </div></section>`)) return;

    const reload = () => VIEWS.growth(gid, S.tok);
    $('#grCheck').onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(e.target), v = k => { const x = String(fd.get(k) ?? '').trim(); return x === '' ? null : num(x); };
      const week = monday(String(fd.get('week') || wkNow));
      const row = { gym_id: gid, week, members: v('members'), new_members: v('new_members'), cancels: v('cancels'), trials: v('trials'), leads: v('leads'),
        revenue_cents: v('revenue') == null ? null : Math.round(v('revenue') * 100), google_rating: v('google_rating') == null ? null : clamp(v('google_rating'), 1, 5),
        google_reviews: v('google_reviews'), note: String(fd.get('note') || '').trim() || null, entered_by: S.me.id, updated_at: new Date().toISOString() };
      const { error } = await sb.from('gym_growth_checkins').upsert(row, { onConflict: 'gym_id,week' });
      if (error) return toast(error.message);
      toast(SN.thisWeek || week !== wkNow ? 'Check in saved' : 'Checked in. +10 points'); reload();
    };
    $$('.grQ').forEach(li => {
      const id = li.dataset.q, set = async ch => { const { error } = await sb.from('gym_growth_quests').update(ch).eq('id', id); if (error) return toast(error.message); reload(); };
      const q = d.quests.find(x => x.id === id);
      const b = (s, fn) => { const x = li.querySelector(s); if (x) x.onclick = fn; };
      b('[data-done]', () => { set({ status: 'done', done_at: new Date().toISOString() }); toast(`+${q.points} points`); });
      b('[data-skip]', () => set({ status: 'skipped', done_at: new Date().toISOString() }));
      b('[data-undo]', () => set({ status: 'open', done_at: null }));
    });
    const panel = html => { $('#grPanel').innerHTML = html; };
    $('#grIdeas').onclick = () => {
      const have = new Set(d.quests.map(q => q.title.toLowerCase()));
      const list = IDEAS.filter(i => !have.has(i[1].toLowerCase()));
      panel(`<div class="grIdeas"><p class="hint">Tap an idea to put it on the board.</p><ul>${list.map((i, k) => `<li><button type="button" class="grIdea" data-i="${IDEAS.indexOf(i)}"><span class="grArea a-${i[0]}">${AREAS[i[0]]}</span><b>${esc(i[1])}</b><em class="grPts">${i[2]}</em></button></li>`).join('') || '<li class="hint">Every idea is on your board.</li>'}</ul></div>`);
      $$('.grIdea').forEach(bt => bt.onclick = async () => {
        const [area, title, points, why] = IDEAS[+bt.dataset.i];
        const { error } = await sb.from('gym_growth_quests').insert({ gym_id: gid, area, title, points, why, sort: d.quests.length, created_by: S.me.id });
        if (error) return toast(error.message); toast('Added'); reload();
      });
    };
    $('#grAdd').onclick = () => {
      panel(`<form class="grAddF" id="grAddF"><input name="title" required minlength="2" maxlength="120" placeholder="Partner with the coffee shop next door" aria-label="Quest">
        <select name="area" aria-label="Area">${Object.entries(AREAS).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select>
        <select name="points" aria-label="Points">${[25, 50, 75, 100, 150, 200].map(p => `<option${p === 50 ? ' selected' : ''}>${p}</option>`).join('')}</select><button class="btn sm">Add</button></form>`);
      $('#grAddF').onsubmit = async e => {
        e.preventDefault(); const fd = new FormData(e.target);
        const { error } = await sb.from('gym_growth_quests').insert({ gym_id: gid, title: String(fd.get('title')).trim(), area: fd.get('area'), points: +fd.get('points'), sort: d.quests.length, created_by: S.me.id });
        if (error) return toast(error.message); toast('Added'); reload();
      };
    };
    $('#grSetB').onclick = () => {
      panel(`<form class="grAddF" id="grSetF"><label class="grF"><span>Goal members</span><input name="goal_members" type="number" min="1" value="${d.set.goal_members ?? ''}" placeholder="${lastM ? Math.ceil(lastM * 1.2) : 100}"></label>
        <label class="grF"><span>By</span><input name="goal_date" type="date" value="${d.set.goal_date || addDays(today(), 90)}"></label>
        <label class="grF"><span>Year the gym opened</span><input name="opened_year" type="number" min="1950" max="2100" value="${d.set.opened_year ?? ''}" placeholder="2015"></label><button class="btn sm">Save</button></form>`);
      $('#grSetF').onsubmit = async e => {
        e.preventDefault(); const fd = new FormData(e.target), v = k => String(fd.get(k) || '').trim() || null;
        const { error } = await sb.from('gym_growth_settings').upsert({ gym_id: gid, goal_members: v('goal_members') && +v('goal_members'), goal_date: v('goal_date'), opened_year: v('opened_year') && +v('opened_year'), updated_at: new Date().toISOString() }, { onConflict: 'gym_id' });
        if (error) return toast(error.message); toast('Goal saved'); reload();
      };
      $('#grPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
  };

  X.growth = { growthIndex, reputationIndex, season, parFor };
}
