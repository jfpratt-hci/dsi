// Compete and grow pages for dandystrength.com:
// compete hub, seasons, weekly battles, gym league, benchmark boards, year recap,
// PR detail with share card, set by set logging with a rest timer, plate calculator, invite your crew.
// app.js calls install(ctx) with its helpers before the first route.

export function install(X) {
  const { sb, D, S, VIEWS, $, $$, esc, num, fmt, today, pd, fmtD, addDays, monday, toast, must, paint, needLogin, go,
    loadBoard, loadPeople, nameOf, boardRow, isPro, isStaff, PRO, bindActions, bindVideo, route, videoUrl } = X;

  /* ---------- shared ---------- */
  const MAIN = D.LIFTS.map(l => l.db);
  const keyOf = db => (D.LIFT_BY_DB[db] || {}).k;
  const proWall = (tok, title, sub) => paint(tok, `<section class="sec narrow"><div><div class="kicker">DSI Pro</div><h2>${title}</h2><p class="secSub">${sub}</p></div><div class="row"><a class="btn" href="/pro">See DSI Pro</a></div></section>`);

  // DSI at any date, from a lifter's own entries. Struck lifts never count.
  function dsiAt(entries, prof, date, from) {
    const r = { bw: num(prof.bw ?? prof.bodyweight) || 185, age: num(prof.age) || (prof.birth_year ? new Date().getFullYear() - prof.birth_year : 30), bench: 0, squat: 0, dead: 0, clean: 0 };
    for (const e of entries) {
      if (e.status === 'struck' || !MAIN.includes(e.lift)) continue;
      if (e.performed_on > date || (from && e.performed_on < from)) continue;
      const k = keyOf(e.lift); r[k] = Math.max(r[k], num(e.weight_lb));
    }
    const has = D.LIFTS.some(l => r[l.k]);
    return { score: has ? D.score(r) : 0, total: D.total(r), row: r, has };
  }
  // Points gained in a window: DSI at the end minus DSI the day before it starts.
  // A lifter with nothing logged before the window starts from their first day inside it, so joining is not a gain.
  function gainIn(entries, prof, start, end) {
    const mine = entries.filter(e => e.status !== 'struck' && MAIN.includes(e.lift));
    const before = mine.filter(e => e.performed_on < start);
    let base;
    if (before.length) base = dsiAt(mine, prof, addDays(start, -1));
    else {
      const first = mine.filter(e => e.performed_on >= start && e.performed_on <= end).map(e => e.performed_on).sort()[0];
      if (!first) return { pts: 0, lb: 0, prs: 0 };
      base = dsiAt(mine, prof, first);
    }
    const fin = dsiAt(mine, prof, end);
    const prs = mine.filter(e => e.is_pr && e.prev_best != null && e.performed_on >= start && e.performed_on <= end).length;
    return { pts: Math.max(0, fin.score - base.score), lb: Math.max(0, fin.total - base.total), prs, start: base.score, end: fin.score };
  }
  async function allEntries(from) {
    let q = sb.from('lift_entries').select('id,profile_id,lift,weight_lb,performed_on,status,is_pr,prev_best,created_at').in('lift', MAIN).neq('status', 'struck').order('performed_on');
    const rows = must(await q.limit(5000));
    const by = new Map();
    rows.forEach(r => { if (!by.has(r.profile_id)) by.set(r.profile_id, []); by.get(r.profile_id).push(r); });
    return by;
  }
  const quarter = d => { const t = pd(d), q = Math.floor(t.getMonth() / 3), y = t.getFullYear(); const s = new Date(y, q * 3, 1), e = new Date(y, q * 3 + 3, 0); const f = x => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); return { y, q: q + 1, start: f(s), end: f(e), name: ['Winter', 'Spring', 'Summer', 'Fall'][q] + ' ' + y }; };
  const who = id => { const r = boardRow(id); return `<a href="/u/${id}">${esc(r ? r.name : nameOf(id))}</a>${r && r.pro ? ' <span class="pill acc proTag">Pro</span>' : ''}`; };

  async function inviteCrew() {
    const url = 'https://dandystrength.com/join';
    const text = `${S.me && S.me.display_name ? S.me.display_name + ' wants to know' : 'Find out'} how strong you really are. Enter your four lifts and get your DSI.`;
    if (navigator.share) { try { await navigator.share({ title: 'Dandy Strength Index', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(text + ' ' + url); toast('Invite link copied. Paste it to your crew.'); } catch { prompt('Copy this invite link', url); }
  }
  X.inviteCrew = inviteCrew;
  document.addEventListener('click', e => { if (e.target.closest('[data-invite]')) { e.preventDefault(); inviteCrew(); } });

  /* ---------- compete hub ---------- */
  VIEWS.compete = async (_, tok) => {
    const q = quarter(today()), pro = isPro();
    const tile = (href, t, d, p) => `<a class="tool" href="${p && !pro ? '/pro' : href}"><b>${t}${p ? ' ' + PRO : ''}</b><span>${d}</span></a>`;
    paint(tok, `<section class="sec"><div class="secHead"><div><div class="kicker">Compete and grow</div><h2>Beyond the <span>board</span></h2><p class="secSub">Seasons, battles, your gym, benchmarks and the tools that keep you coming back.</p></div><button class="btn sm" data-invite>Invite your crew</button></div>
      <div class="tools">
        ${tile('/season', 'The ' + esc(q.name) + ' season', 'Most DSI points gained this quarter. Resets ' + fmtD(addDays(q.end, 1)) + '.', 1)}
        ${tile('/battles', 'Weekly battles', 'Call out any lifter for a week. Most DSI gained wins.', 1)}
        ${tile('/gyms', 'Gym league', 'Your gym against every gym, ranked by its top five lifters.')}
        ${tile('/benchmarks', 'Benchmark boards', 'Every time anyone has done Fran, Grace and the rest.')}
        ${tile('/recap/' + new Date().getFullYear(), 'Your year recap', 'PRs, pounds added and your best day of the year.', 1)}
        ${tile('/plates', 'Plate calculator', 'What to load on each side, plus warmups.')}
      </div></section>`);
  };

  /* ---------- seasons ---------- */
  VIEWS.season = async (arg, tok) => {
    const q = /^\d{4}-q[1-4]$/i.test(arg || '') ? quarter(`${arg.slice(0, 4)}-${String((+arg.slice(6) - 1) * 3 + 1).padStart(2, '0')}-01`) : quarter(today());
    const [board, by] = await Promise.all([loadBoard(), allEntries()]);
    const end = q.end < today() ? q.end : today();
    const rows = board.map(r => ({ r, g: gainIn(by.get(r.profile_id) || [], r, q.start, end) })).filter(x => x.g.pts > 0 || x.g.lb > 0)
      .sort((a, b) => b.g.pts - a.g.pts || b.g.lb - a.g.lb);
    const pro = isPro(), shown = pro ? rows : rows.slice(0, 3);
    const prev = quarter(addDays(q.start, -1)), next = quarter(addDays(q.end, 1)), qid = x => x.y + '-q' + x.q;
    const daysLeft = Math.max(0, Math.round((pd(q.end) - pd(today())) / 864e5));
    paint(tok, `<section class="sec"><div class="secHead"><div><div class="kicker">Season ${q.q} · ${fmtD(q.start)} to ${fmtD(q.end)}</div><h2>${esc(q.name.split(' ')[0])} <span>season</span></h2>
      <p class="secSub">Ranked by DSI points gained this season. New lifters start counting from their first day, so joining is not a gain.</p></div>
      <div class="row"><a class="btn ghost sm" href="/season/${qid(prev)}">← ${esc(prev.name)}</a>${q.end < today() ? `<a class="btn ghost sm" href="/season/${qid(next)}">${esc(next.name)} →</a>` : `<span class="pill acc" style="margin:0">${daysLeft} days left</span>`}</div></div>
      <div class="board"><div class="tablewrap"><table class="lb"><thead><tr><th>#</th><th>Lifter</th><th class="r hl">Points</th><th class="r">DSI</th><th class="r">Lb added</th><th class="r">PRs</th></tr></thead><tbody>
      ${shown.map((x, i) => `<tr class="${S.me && S.me.id === x.r.profile_id ? 'me' : ''}"><td class="pos">${i + 1}</td><td><div class="who">${who(x.r.profile_id)}</div><div class="sub">${esc(x.r.division)}</div></td><td class="r n big">+${x.g.pts}</td><td class="r n">${x.g.start} → ${x.g.end}</td><td class="r n">+${fmt(x.g.lb)}</td><td class="r n">${x.g.prs}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nobody has gained yet this season. Hit a PR and take the lead.</td></tr>'}
      </tbody></table></div></div>
      ${!pro && rows.length > 3 ? `<div class="row"><span class="hint">Showing the top 3 of ${rows.length}. The full season board is part of DSI Pro.</span><a class="btn sm" href="/pro">See Pro</a></div>` : ''}</section>`);
  };

  /* ---------- weekly battles ---------- */
  function battleScore(b, by, board) {
    const end = addDays(b.week_start, 6) < today() ? addDays(b.week_start, 6) : today();
    const side = id => { const r = board.find(x => x.profile_id === id) || { bw: 185, age: 30 }; return gainIn(by.get(id) || [], r, b.week_start, end); };
    const a = side(b.challenger), o = side(b.opponent);
    const over = addDays(b.week_start, 6) < today();
    const lead = a.pts !== o.pts ? (a.pts > o.pts ? b.challenger : b.opponent) : a.lb !== o.lb ? (a.lb > o.lb ? b.challenger : b.opponent) : null;
    return { a, o, over, lead, live: b.week_start <= today() && !over };
  }
  VIEWS.battles = async (id, tok) => {
    const [board, bres] = await Promise.all([loadBoard(), sb.from('battles').select('*').order('week_start', { ascending: false }).order('created_at', { ascending: false }).limit(200)]);
    const battles = must(bres);
    if (!S.people.size) await loadPeople();
    const by = await allEntries();
    const thisMon = monday(today());
    const card = b => {
      const s = battleScore(b, by, board), meA = S.me && S.me.id === b.challenger, meO = S.me && S.me.id === b.opponent;
      const st = b.status === 'accepted' ? (s.over ? (s.lead ? `${esc(nameOf(s.lead))} won` : 'Tie') : s.live ? 'Live' : 'Starts ' + fmtD(b.week_start)) : b.status === 'pending' ? 'Waiting on ' + esc(nameOf(b.opponent)) : b.status;
      const side = (pid, g) => `<div class="btSide${b.status === 'accepted' && s.lead === pid ? ' lead' : ''}"><div class="who">${who(pid)}</div><b>+${g.pts}</b><span>${fmt(g.lb)} lb · ${g.prs} PR${g.prs === 1 ? '' : 's'}</span></div>`;
      return `<article class="btCard" id="b-${b.id}"><div class="btTop"><span class="eyebrow">Week of ${fmtD(b.week_start)}</span><span class="pill ${b.status === 'accepted' ? (s.live ? 'up' : 'acc') : 'flat'}">${st}</span></div>
        <div class="btVs">${side(b.challenger, s.a)}<span class="vs">vs</span>${side(b.opponent, s.o)}</div>
        ${b.trash_talk ? `<p class="btTalk">“${esc(b.trash_talk)}”</p>` : ''}
        ${b.status === 'pending' && meO ? `<div class="row"><button class="btn sm" data-bt="accept" data-id="${b.id}">Accept</button><button class="btn ghost sm" data-bt="decline" data-id="${b.id}">Decline</button></div>` : ''}
        ${b.status === 'pending' && meA ? `<div class="row"><button class="btn ghost sm" data-bt="cancel" data-id="${b.id}">Call it off</button></div>` : ''}
        ${b.status === 'accepted' ? `<div class="row"><button class="btn ghost sm" data-thread="battle" data-ref="${b.id}" data-title="${esc(nameOf(b.challenger) + ' vs ' + nameOf(b.opponent))}">Talk</button></div>` : ''}</article>`;
    };
    const mine = S.me ? battles.filter(b => b.challenger === S.me.id || b.opponent === S.me.id) : [];
    const live = battles.filter(b => b.status === 'accepted' && b.week_start >= addDays(thisMon, -7));
    const pro = isPro();
    const others = board.filter(r => !S.me || r.profile_id !== S.me.id).sort((a, b) => a.name.localeCompare(b.name));
    const weeks = [0, 7, 14].map(n => addDays(thisMon, n));
    if (!paint(tok, `<section class="sec"><div class="secHead"><div><div class="kicker">Head to head</div><h2>Weekly <span>battles</span></h2><p class="secSub">Call out any lifter for a Monday to Sunday week. Most DSI points gained wins; pounds added breaks a tie.</p></div></div>
      ${S.me ? (pro ? `<form class="formCard" id="btF"><div class="fields">
        <div class="field w2"><label for="bt-o">Opponent</label><select id="bt-o" required><option value="">Pick a lifter…</option>${others.map(r => `<option value="${r.profile_id}">${esc(r.name)} · DSI ${r.score}</option>`).join('')}</select></div>
        <div class="field"><label for="bt-w">Week</label><select id="bt-w">${weeks.map((w, i) => `<option value="${w}">${i ? 'Week of ' + fmtD(w) : 'This week'}</option>`).join('')}</select></div>
        <div class="field w4"><label for="bt-t">Trash talk (optional)</label><input id="bt-t" maxlength="140" placeholder="Bring your belt."></div></div>
        <div class="row"><button class="btn" type="submit">Send the challenge</button><span class="hint" id="bt-msg">They get it in their battles list and accept or decline.</span></div></form>`
        : `<div class="formCard"><p class="lede" style="margin:0">Starting a battle is part of DSI Pro. Anyone can accept one.</p><div class="row"><a class="btn sm" href="/pro">See Pro</a></div></div>`) : `<p class="lede"><a href="/login">Sign in</a> to start or answer a battle.</p>`}</section>
      ${mine.length ? `<section class="sec"><h2>Your <span>battles</span></h2><div class="btGrid">${mine.map(card).join('')}</div></section>` : ''}
      <section class="sec"><h2>Live <span>now</span></h2><div class="btGrid">${live.filter(b => !mine.includes(b)).map(card).join('') || '<p class="empty">No battles running. Start one.</p>'}</div></section>`)) return;
    bindActions(main());
    $$('[data-bt]').forEach(b => b.onclick = async () => {
      b.disabled = true;
      const { error } = await sb.rpc('respond_battle', { p_id: b.dataset.id, p_action: b.dataset.bt });
      if (error) { toast(error.message); b.disabled = false; return; }
      toast({ accept: 'Game on.', decline: 'Declined.', cancel: 'Called off.' }[b.dataset.bt]); route();
    });
    const f = $('#btF');
    if (f) f.onsubmit = async e => {
      e.preventDefault();
      const m = $('#bt-msg'), btn = f.querySelector('button'); btn.disabled = true; m.textContent = 'Sending…';
      const { error } = await sb.from('battles').insert({ challenger: S.me.id, opponent: $('#bt-o').value, week_start: $('#bt-w').value, trash_talk: $('#bt-t').value.trim() || null });
      btn.disabled = false;
      if (error) { m.textContent = /battles_once/.test(error.message) ? 'You two already have a battle that week.' : error.message; return; }
      toast('Challenge sent to ' + nameOf($('#bt-o').value)); route();
    };
    if (id) { const el = document.getElementById('b-' + id); if (el) { el.classList.add('focus'); el.scrollIntoView({ block: 'center' }); } }
  };
  const main = () => $('#main');

  /* ---------- gym league ---------- */
  VIEWS.gyms = async (id, tok) => {
    const [board, gres, pres] = await Promise.all([loadBoard(), sb.from('gyms').select('*').order('name'), sb.from('profiles').select('id,gym_id').not('gym_id', 'is', null)]);
    const gyms = must(gres), gymOf = new Map(must(pres).map(p => [p.id, p.gym_id]));
    const members = gid => board.filter(r => gymOf.get(r.profile_id) === gid).sort((a, b) => b.score - a.score);
    if (id) {
      const g = gyms.find(x => x.id === id); if (!g) throw new Error('No gym here.');
      const m = members(id);
      paint(tok, `<section class="sec"><div class="secHead"><div><div class="kicker">${esc(g.city || 'Gym')}</div><h2>${esc(g.name)}</h2><p class="secSub">${m.length} lifter${m.length === 1 ? '' : 's'} on the board.</p></div><a class="btn ghost sm" href="/gyms">Gym league</a></div>
        <div class="board"><div class="tablewrap"><table class="lb"><thead><tr><th>#</th><th>Lifter</th><th class="r hl">DSI™</th><th class="r">Total</th></tr></thead><tbody>
        ${m.map((r, i) => `<tr class="${S.me && S.me.id === r.profile_id ? 'me' : ''}"><td class="pos">${i + 1}</td><td><div class="who">${who(r.profile_id)}</div></td><td class="r n big">${r.score}</td><td class="r n">${fmt(r.total)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nobody has claimed this gym yet.</td></tr>'}
        </tbody></table></div></div></section>`);
      return;
    }
    const league = gyms.map(g => { const m = members(g.id), top = m.slice(0, 5); return { g, n: m.length, avg: top.length ? Math.round(top.reduce((s, r) => s + r.score, 0) / top.length) : 0, best: m[0] }; })
      .sort((a, b) => (b.n >= 3) - (a.n >= 3) || b.avg - a.avg || b.n - a.n);
    const myGym = S.me ? S.me.gym_id : null;
    if (!paint(tok, `<section class="sec"><div class="secHead"><div><div class="kicker">Gym league</div><h2>Your gym vs <span>every gym</span></h2><p class="secSub">Ranked by the average DSI of each gym's top five lifters. A gym needs three lifters to rank.</p></div></div>
      <div class="board"><div class="tablewrap"><table class="lb"><thead><tr><th>#</th><th>Gym</th><th class="r hl">Top 5 avg</th><th class="r">Lifters</th><th>Strongest</th></tr></thead><tbody>
      ${league.map((x, i) => `<tr class="${myGym === x.g.id ? 'me' : ''}"><td class="pos">${x.n >= 3 ? i + 1 : '·'}</td><td><div class="who"><a href="/gyms/${x.g.id}">${esc(x.g.name)}</a></div><div class="sub">${esc(x.g.city || '')}</div></td><td class="r n big">${x.n >= 3 ? x.avg : `<span class="sub">needs ${3 - x.n} more</span>`}</td><td class="r n">${x.n}</td><td>${x.best ? who(x.best.profile_id) + ` <span class="sub">${x.best.score}</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No gyms yet. Add yours below.</td></tr>'}
      </tbody></table></div></div></section>
      ${S.me ? `<section class="sec"><form class="formCard" id="gymF"><div class="formH">Your gym<span class="sub">${myGym ? 'You train at ' + esc((gyms.find(g => g.id === myGym) || {}).name || '') + '.' : 'Pick your gym to put it on the league.'}</span></div><div class="fields">
        <div class="field w2"><label for="gy-p">Pick a gym</label><select id="gy-p"><option value="">No gym</option>${gyms.map(g => `<option value="${g.id}"${g.id === myGym ? ' selected' : ''}>${esc(g.name)}${g.city ? ' · ' + esc(g.city) : ''}</option>`).join('')}</select></div>
        <div class="field"><label for="gy-n">Or add a new gym</label><input id="gy-n" maxlength="60" placeholder="Gym name"></div>
        <div class="field"><label for="gy-c">City</label><input id="gy-c" maxlength="60" placeholder="Cincinnati, OH"></div></div>
        <div class="row"><button class="btn" type="submit">Save my gym</button><span class="hint" id="gy-msg"></span></div></form></section>` : ''}`)) return;
    const f = $('#gymF');
    if (f) f.onsubmit = async e => {
      e.preventDefault();
      const m = $('#gy-msg'); let gid = $('#gy-p').value || null; const nm = $('#gy-n').value.trim();
      if (nm) {
        const dup = gyms.find(g => g.name.trim().toLowerCase() === nm.toLowerCase());
        if (dup) gid = dup.id;
        else {
          const { data, error } = await sb.from('gyms').insert({ name: nm, city: $('#gy-c').value.trim() || null, created_by: S.me.id }).select().single();
          if (error) { m.textContent = error.message; return; }
          gid = data.id;
        }
      }
      const { data, error } = await sb.from('profiles').update({ gym_id: gid }).eq('id', S.me.id).select().single();
      if (error) { m.textContent = error.message; return; }
      S.me = data; toast(gid ? 'Gym saved' : 'Gym cleared'); route();
    };
  };

  /* ---------- benchmark boards ---------- */
  const secs = s => { const m = String(s || '').match(/^(\d+):(\d{1,2})$/); return m ? +m[1] * 60 + +m[2] : null; };
  const scoreVal = (s, type) => type === 'time' ? secs(s) : (parseFloat(String(s || '').replace(/[^0-9.]/g, '')) || null);
  VIEWS.benchmarks = async (name, tok) => {
    const ws = must(await sb.from('workouts').select('id,day,title,benchmark,score_type,score_label').not('benchmark', 'is', null).order('day', { ascending: false }));
    const ids = ws.map(w => w.id);
    const logs = ids.length ? must(await sb.from('workout_logs').select('id,workout_id,profile_id,score,status').in('workout_id', ids).neq('status', 'struck')) : [];
    if (!S.people.size) await loadPeople();
    await loadBoard();
    const names = [...new Set(ws.map(w => w.benchmark))];
    if (name) {
      const bw = ws.filter(w => w.benchmark.toLowerCase() === name.toLowerCase());
      if (!bw.length) throw new Error('No benchmark called ' + name + '.');
      const type = bw[0].score_type, best = new Map();
      for (const l of logs.filter(l => bw.some(w => w.id === l.workout_id))) {
        const v = scoreVal(l.score, type); if (v == null) continue;
        const day = bw.find(w => w.id === l.workout_id).day, cur = best.get(l.profile_id);
        if (!cur || (type === 'time' ? v < cur.v : v > cur.v)) best.set(l.profile_id, { v, s: l.score, day });
      }
      const rows = [...best.entries()].sort((a, b) => type === 'time' ? a[1].v - b[1].v : b[1].v - a[1].v);
      paint(tok, `<section class="sec"><div class="secHead"><div><div class="kicker">Benchmark · ${type === 'time' ? 'fastest time wins' : 'most wins'}</div><h2>${esc(bw[0].benchmark)}</h2><p class="secSub">Done ${bw.length} time${bw.length === 1 ? '' : 's'}: ${bw.map(w => fmtD(w.day)).join(', ')}. Each lifter's best counts.</p></div><a class="btn ghost sm" href="/benchmarks">All benchmarks</a></div>
        <div class="board"><div class="tablewrap"><table class="lb"><thead><tr><th>#</th><th>Lifter</th><th class="r hl">${esc(bw[0].score_label || 'Score')}</th><th class="r">Date</th></tr></thead><tbody>
        ${rows.map(([pid, x], i) => `<tr class="${S.me && S.me.id === pid ? 'me' : ''}"><td class="pos">${i + 1}</td><td><div class="who">${who(pid)}</div></td><td class="r n big">${esc(x.s)}</td><td class="r n"><a href="/week/${x.day}">${fmtD(x.day)}</a></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nobody has logged it yet.</td></tr>'}
        </tbody></table></div></div></section>`);
      return;
    }
    paint(tok, `<section class="sec"><div class="secHead"><div><div class="kicker">Benchmarks</div><h2>Benchmark <span>boards</span></h2><p class="secSub">Named workouts that come back. Every time anyone logs one, their best goes on its board.</p></div></div>
      <div class="tools">${names.map(n => { const w = ws.filter(x => x.benchmark === n), c = logs.filter(l => w.some(x => x.id === l.workout_id)).length; return `<a class="tool" href="/benchmarks/${encodeURIComponent(n)}"><b>${esc(n)}</b><span>${w.length} time${w.length === 1 ? '' : 's'} · ${c} log${c === 1 ? '' : 's'} · last ${fmtD(w[0].day)}</span></a>`; }).join('') || `<p class="empty">No benchmarks yet.${isStaff() ? ' Name a workout as a benchmark on the import page.' : ' The Commissioner names them as they come up.'}</p>`}</div></section>`);
  };

  /* ---------- year recap ---------- */
  VIEWS.recap = async (yr, tok) => {
    if (!S.me) return needLogin(tok, 'see your year');
    const y = /^\d{4}$/.test(yr || '') ? +yr : new Date().getFullYear();
    if (!isPro()) return proWall(tok, `Your <span>${y}</span>`, 'Your year in lifting: PRs, pounds added, your best day and where you finished. The year recap is part of DSI Pro.');
    const [board, eres, lres] = await Promise.all([loadBoard(), sb.from('lift_entries').select('*').eq('profile_id', S.me.id).order('performed_on'), sb.from('workout_logs').select('id,created_at,workout:workouts(day)').eq('profile_id', S.me.id)]);
    const ent = must(eres), logs = must(lres).filter(l => l.workout && String(l.workout.day).startsWith(String(y)));
    const start = `${y}-01-01`, end = `${y}-12-31` < today() ? `${y}-12-31` : today();
    const row = boardRow(S.me.id) || { bw: num(S.me.bodyweight), age: S.me.birth_year ? new Date().getFullYear() - S.me.birth_year : 30 };
    const g = gainIn(ent, row, start, end);
    const inYr = ent.filter(e => e.status !== 'struck' && e.performed_on >= start && e.performed_on <= end);
    const prs = inYr.filter(e => e.is_pr && e.prev_best != null);
    const biggest = [...prs].sort((a, b) => (num(b.weight_lb) - num(b.prev_best)) - (num(a.weight_lb) - num(a.prev_best)))[0];
    const months = {}; [...inYr.map(e => e.performed_on), ...logs.map(l => l.workout.day)].forEach(d => { const k = String(d).slice(0, 7); months[k] = (months[k] || 0) + 1; });
    const topM = Object.entries(months).sort((a, b) => b[1] - a[1])[0];
    const perLift = D.LIFTS.map(l => { const a = dsiAt(ent, row, addDays(start, -1)).row[l.k], b = dsiAt(ent, row, end).row[l.k]; return { l, a, b }; });
    const rank = [...board].sort((a, b) => b.score - a.score).findIndex(r => r.profile_id === S.me.id) + 1;
    paint(tok, `<section class="sec recap"><div class="kicker">${esc(S.me.display_name)} · ${y}</div><h2>Your <span>${y}</span></h2>
      <div class="kpi recapK"><div><b>${prs.length}</b><span>PRs</span></div><div><b>+${fmt(g.lb)}</b><span>Lb added to your total</span></div><div><b>${g.start || '·'} → ${g.end || dsiAt(ent, row, end).score}</b><span>DSI</span></div><div><b>${rank ? '#' + rank : '·'}</b><span>On the board today</span></div></div>
      <div class="bars card" style="padding:18px 24px">${perLift.map(x => `<div class="brow" style="--c:${x.l.c}"><span class="ln">${x.l.n}</span><div class="pb"><i style="width:${x.b ? Math.min(100, x.b / Math.max(...perLift.map(p => p.b || 1)) * 100) : 0}%"></i></div><span class="w">${x.b ? fmt(x.b) : 'n/a'}</span><span class="pc">${x.b > x.a && x.a ? '+' + fmt(x.b - x.a) : ''}</span></div>`).join('')}</div>
      <div class="tools">
        <div class="tool"><b>Biggest PR</b><span>${biggest ? `${esc(D.liftName(biggest.lift))} ${fmt(biggest.weight_lb)} lb, up ${fmt(num(biggest.weight_lb) - num(biggest.prev_best))} on ${fmtD(biggest.performed_on)}` : 'No PRs yet this year.'}</span></div>
        <div class="tool"><b>Busiest month</b><span>${topM ? new Date(topM[0] + '-01T12:00').toLocaleDateString('en-US', { month: 'long' }) + `, ${topM[1]} sessions logged` : 'Nothing logged yet.'}</span></div>
        <div class="tool"><b>Workouts logged</b><span>${logs.length} day${logs.length === 1 ? '' : 's'} of programming logged in ${y}.</span></div>
      </div>
      <div class="row"><button class="btn" id="rcShare">Share my year</button><span class="hint">Makes an image you can post.</span></div></section>`);
    $('#rcShare').onclick = () => shareImage({ title: `${S.me.display_name}'s ${y}`, big: `${prs.length} PRs`, line: `+${fmt(g.lb)} lb on my total · DSI ${g.end || dsiAt(ent, row, end).score}`, sub: biggest ? `Biggest: ${D.liftName(biggest.lift)} ${fmt(biggest.weight_lb)} lb` : '', color: '#F2C94C', file: `dsi-${y}.png` });
  };

  /* ---------- share images ---------- */
  async function drawCard({ title, big, line, sub, color }) {
    await document.fonts.ready;
    const c = document.createElement('canvas'); c.width = 1080; c.height = 1350;
    const g = c.getContext('2d');
    g.fillStyle = '#0E1420'; g.fillRect(0, 0, 1080, 1350);
    g.fillStyle = color; g.fillRect(0, 0, 1080, 18); g.fillRect(80, 300, 12, 560);
    g.fillStyle = '#8E9AB0'; g.font = '600 34px "IBM Plex Sans"'; g.fillText('DANDY STRENGTH INDEX', 80, 140);
    g.fillStyle = '#E9EEF6'; g.font = '900 76px "Big Shoulders Display"'; g.fillText(String(title).toUpperCase().slice(0, 26), 80, 240);
    g.fillStyle = color; g.font = '900 230px "Big Shoulders Display"'; g.fillText(String(big).toUpperCase(), 120, 560);
    g.fillStyle = '#E9EEF6'; g.font = '600 52px "IBM Plex Mono"'; wrap(g, line, 120, 680, 860, 64);
    g.fillStyle = '#8E9AB0'; g.font = '500 40px "IBM Plex Sans"'; wrap(g, sub || '', 120, 820, 860, 52);
    g.fillStyle = '#E9EEF6'; g.font = '900 64px "Big Shoulders Display"'; g.fillText('DANDYSTRENGTH.COM', 80, 1250);
    g.fillStyle = '#8E9AB0'; g.font = '500 30px "IBM Plex Sans"'; g.fillText('How strong are you, really?', 80, 1295);
    return c;
  }
  function wrap(g, text, x, y, w, lh) { let line = ''; for (const word of String(text).split(' ')) { const t = line ? line + ' ' + word : word; if (g.measureText(t).width > w && line) { g.fillText(line, x, y); y += lh; line = word; } else line = t; } if (line) g.fillText(line, x, y); }
  async function shareImage(o) {
    const c = await drawCard(o);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const file = new File([blob], o.file, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: o.title }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = o.file; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Image saved. Post it anywhere.');
  }

  /* ---------- PR detail ---------- */
  VIEWS.pr = async (id, tok) => {
    const e = must(await sb.from('lift_entries').select('*').eq('id', id).maybeSingle());
    if (!e) throw new Error('No PR here.');
    const [board, prof, room] = await Promise.all([loadBoard(), sb.from('profiles').select('id,display_name,division,bodyweight,birth_year,tier,role').eq('id', e.profile_id).single().then(must),
      sb.from('chat_rooms').select('id').eq('kind', 'pr').eq('ref_id', id).maybeSingle().then(r => r.data).catch(() => null)]);
    const r = boardRow(e.profile_id), l = D.LIFT_BY_DB[e.lift] || { c: 'var(--muted)', n: D.liftName(e.lift) };
    const gain = e.prev_best ? num(e.weight_lb) - num(e.prev_best) : 0, mine = S.me && S.me.id === e.profile_id;
    const celebrate = new URLSearchParams(location.search).get('celebrate') && mine;
    const msgs = room ? (await sb.from('messages').select('*').eq('room_id', room.id).eq('deleted', false).order('created_at', { ascending: false }).limit(5)).data || [] : [];
    if (!S.people.size) await loadPeople();
    const pro = isPro(), title = `${prof.display_name} ${l.n} ${fmt(e.weight_lb)}`;
    if (!paint(tok, `${celebrate ? `<section class="prBurst" style="--c:${l.c}"><div class="kicker">New PR</div><h2>${esc(l.n)} <span>${fmt(e.weight_lb)}</span></h2><p class="lede">${gain ? `Up ${fmt(gain)} lb from ${fmt(e.prev_best)}. ` : ''}It's on the PR wall now. Go tell everyone.</p></section>` : ''}
      <section class="sec"><article class="prDetail" style="--c:${l.c}" data-host>
        <div class="prTop"><span class="prTag">${e.is_pr ? 'PR' : 'Lift'}</span><span class="prDate">${fmtD(e.performed_on)}${e.source === 'workout' ? ' · from a workout' : ''}</span></div>
        <a class="prName" href="/u/${e.profile_id}">${esc(prof.display_name)}</a>
        <div class="prLift">${esc(l.n)} <b>${fmt(e.weight_lb)} lb</b>${e.status === 'protested' ? '<span class="pill flat">Under protest</span>' : e.status === 'struck' ? '<span class="pill down">Struck</span>' : ''}</div>
        ${gain ? `<div class="prGain">+${fmt(gain)} lb</div><div class="sub">was ${fmt(e.prev_best)}</div>` : ''}
        ${r ? `<div class="kpi" style="margin-top:14px"><div><b>${r.score}${r.g.score > 0 ? `<span class="upArrow">▲${r.g.score}</span>` : ''}</b><span>DSI™ now</span></div><div><b>${fmt(r.total)}</b><span>Total</span></div><div><b>${D.fmtPct(r.p[keyOf(e.lift)] || 0)}%</b><span>${esc(l.n)} percentile</span></div></div>` : ''}
        ${e.note ? `<p class="lede">${esc(e.note)}</p>` : ''}
        ${e.video_path ? `<video class="prVid" src="${esc(videoUrl(e.video_path))}" controls playsinline preload="metadata"></video>` : mine && e.status === 'ok' ? `<div class="row"><button class="btn ghost sm" data-addvid="${e.id}">Add video</button><span class="hint">Proof keeps the board honest.</span></div>` : ''}
        <div class="prAct">
          <button class="btn sm" id="prShare">${pro ? 'Share card' : 'Share link'}</button>
          <button class="btn ghost sm" data-thread="pr" data-ref="${e.id}" data-title="${esc(title)}">Talk</button>
          ${!mine && e.status === 'ok' && S.me ? `<button class="btn ghost sm" data-protest="lift_entry" data-ref="${e.id}" data-title="${esc(title + ' lb')}">Protest</button>` : ''}
          ${!pro ? `<a class="chip" href="/pro">PR share cards ${PRO}</a>` : ''}
        </div>
      </article></section>
      ${msgs.length ? `<section class="sec"><h2>The <span>talk</span></h2><div class="msgs" style="max-height:none">${msgs.reverse().map(m => `<div class="msg"><div class="by"><a href="/u/${m.profile_id}"><b>${esc(nameOf(m.profile_id))}</b></a></div><div class="tx">${esc(m.body)}</div></div>`).join('')}</div></section>` : ''}`)) return;
    bindActions(main(), () => route());
    bindVideo(main(), () => route());
    $('#prShare').onclick = async () => {
      const url = location.origin + '/pr/' + e.id;
      if (pro) return shareImage({ title: prof.display_name, big: fmt(e.weight_lb), line: `${l.n} PR${gain ? ', up ' + fmt(gain) + ' lb' : ''}`, sub: `${fmtD(e.performed_on)}${r ? ' · DSI ' + r.score : ''}`, color: getComputedStyle(document.documentElement).getPropertyValue('--' + (keyOf(e.lift) || 'clean')).trim() || '#F2C94C', file: `dsi-pr-${e.id.slice(0, 8)}.png` });
      if (navigator.share) { try { await navigator.share({ title, url }); return; } catch (x) { if (x.name === 'AbortError') return; } }
      try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { prompt('Copy this link', url); }
    };
  };

  /* ---------- set by set logging ---------- */
  function scheme(sch) {
    const m = /(\d+)\s*[x×]\s*(\d+)/i.exec(sch || ''); if (m) return { n: Math.min(10, +m[1]), r: +m[2] };
    const reps = /(\d+)\s*reps?/i.exec(sch || ''); if (reps) return { n: 1, r: +reps[1] };
    if (/single|1\s*rm|max/i.test(sch || '')) return { n: 1, r: 1 };
    return { n: 3, r: 5 };
  }
  let restT = null;
  VIEWS.lift = async (wid, tok) => {
    const lid = decodeURIComponent(location.pathname.split('/')[3] || '');
    if (!S.me) return needLogin(tok, 'log sets');
    if (!isPro()) return proWall(tok, 'Set by set <span>logging</span>', 'Log every set with weight and reps, with a rest timer between sets. Part of DSI Pro.');
    const [w, board, log] = await Promise.all([sb.from('workouts').select('*').eq('id', wid).single().then(must), loadBoard(), sb.from('workout_logs').select('*').eq('workout_id', wid).eq('profile_id', S.me.id).maybeSingle().then(must)]);
    const L = (w.lifts || []).find(x => x.id === lid); if (!L) throw new Error('That lift is not in this workout.');
    const meRow = boardRow(S.me.id) || { bw: num(S.me.bodyweight), bench: 0, squat: 0, dead: 0, clean: 0 };
    const tgt = D.target(L, meRow);
    const saved = log && log.sets && log.sets[lid];
    let sets = saved && saved.length ? saved.map(x => ({ w: x.w, r: x.r, done: true })) : Array.from({ length: scheme(L.sch).n }, () => ({ w: tgt || '', r: scheme(L.sch).r, done: false }));
    let rest = +(localStorage.getItem('dsi.rest') || 90);
    const draw = () => {
      const doneN = sets.filter(x => x.done).length;
      $('#sets').innerHTML = sets.map((x, i) => `<div class="setRow${x.done ? ' done' : ''}"><span class="n">${i + 1}</span>
        <label class="vh" for="sw${i}">Set ${i + 1} weight</label><input id="sw${i}" class="wkIn" type="number" inputmode="decimal" step="any" min="0" max="1499" value="${esc(x.w)}" data-i="${i}" data-k="w"><span class="u">lb ×</span>
        <label class="vh" for="sr${i}">Set ${i + 1} reps</label><input id="sr${i}" class="wkIn" type="number" inputmode="numeric" min="0" max="200" value="${esc(x.r)}" data-i="${i}" data-k="r"><span class="u">reps</span>
        <button class="btn ${x.done ? '' : 'ghost'} sm" type="button" data-done="${i}" aria-pressed="${x.done}">${x.done ? 'Done ✓' : 'Done'}</button></div>`).join('');
      $('#setN').textContent = doneN + '/' + sets.length;
      $$('#sets input').forEach(inp => inp.oninput = () => { sets[+inp.dataset.i][inp.dataset.k] = inp.value; });
      $$('[data-done]').forEach(b => b.onclick = () => { const i = +b.dataset.done; sets[i].done = !sets[i].done; if (sets[i].done) startRest(); draw(); });
    };
    const startRest = () => {
      clearInterval(restT); let left = rest; const el = $('#restLeft'); if (!el) return;
      const show = () => { el.textContent = left ? Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') : 'Go'; $('#restBox').classList.toggle('on', left > 0); };
      show();
      restT = setInterval(() => { left--; if (!$('#restLeft')) { clearInterval(restT); return; } show(); if (left <= 0) { clearInterval(restT); try { navigator.vibrate && navigator.vibrate(300); const ac = new AudioContext(), o = ac.createOscillator(); o.frequency.value = 880; o.connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.25); } catch {} toast('Rest is up. Next set.'); } }, 1000);
    };
    if (!paint(tok, `<section class="sec"><div class="wkNav"><div><div class="kicker">${esc(fmtD(w.day))} · ${esc(w.title)}</div><h2>${esc(L.n)}</h2><p class="secSub">${esc(L.sch)}${tgt ? ' · target ' + tgt + ' lb' : ''}${L.why ? ' · ' + esc(L.why) : ''}</p></div>
      <div class="kpi"><div><b id="setN">0/0</b><span>Sets done</span></div></div></div>
      <div class="formCard"><div id="sets" class="sets"></div>
        <div class="row"><button class="btn ghost sm" type="button" id="addSet">+ Add set</button><button class="btn ghost sm" type="button" id="rmSet">Remove last</button>${tgt ? `<a class="btn ghost sm" href="/plates/${tgt}">Plates for ${tgt}</a>` : ''}</div>
        <div class="restBox" id="restBox"><div><span class="eyebrow">Rest</span><b id="restLeft">${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, '0')}</b></div><div class="chips">${[60, 90, 120, 180].map(s => `<button class="chip" type="button" data-rest="${s}" aria-pressed="${s === rest}">${s < 120 ? s + 's' : s / 60 + ' min'}</button>`).join('')}<button class="chip" type="button" id="restGo">Start</button></div></div>
        <div class="row"><button class="btn" type="button" id="saveSets">Save sets</button><a class="btn ghost" href="/week/${w.day}">Back to the day</a><span class="hint" id="setMsg">Your top weight becomes this lift's actual on the day board.</span></div></div></section>`)) return;
    draw();
    $('#addSet').onclick = () => { const last = sets[sets.length - 1] || { w: tgt, r: 5 }; sets.push({ w: last.w, r: last.r, done: false }); draw(); };
    $('#rmSet').onclick = () => { if (sets.length > 1) { sets.pop(); draw(); } };
    $$('[data-rest]').forEach(b => b.onclick = () => { rest = +b.dataset.rest; try { localStorage.setItem('dsi.rest', rest); } catch {} $$('[data-rest]').forEach(x => x.setAttribute('aria-pressed', String(+x.dataset.rest === rest))); startRest(); });
    $('#restGo').onclick = startRest;
    $('#saveSets').onclick = async () => {
      const m = $('#setMsg');
      const done = sets.filter(x => x.done && num(x.w) > 0).map(x => ({ w: num(x.w), r: num(x.r) }));
      const top = done.reduce((a, x) => Math.max(a, x.w), 0);
      const cur = must(await sb.from('workout_logs').select('*').eq('workout_id', wid).eq('profile_id', S.me.id).maybeSingle());
      const entries = { ...((cur && cur.entries) || {}) }; if (top) entries[lid] = top; else delete entries[lid];
      const allSets = { ...((cur && cur.sets) || {}), [lid]: done };
      m.textContent = 'Saving…';
      const { error } = await sb.from('workout_logs').upsert({ workout_id: wid, profile_id: S.me.id, entries, sets: allSets, score: cur ? cur.score : null }, { onConflict: 'workout_id,profile_id' });
      if (error) { m.textContent = error.message; return; }
      if (L.max && w.pr_lift && top) {
        const best = meRow[keyOf(w.pr_lift)] || 0;
        if (top > best) {
          const { data } = await sb.from('lift_entries').insert({ profile_id: S.me.id, lift: w.pr_lift, weight_lb: top, performed_on: w.day, source: 'workout' }).select().single();
          if (data && data.is_pr) { go('/pr/' + data.id + '?celebrate=1'); return; }
        }
      }
      m.textContent = `Saved ${done.length} set${done.length === 1 ? '' : 's'}${top ? ', top ' + top + ' lb' : ''}.`; toast('Sets saved');
    };
  };

  /* ---------- plate calculator ---------- */
  const PLATES = [45, 35, 25, 10, 5, 2.5], PCOL = { 45: '#EF4B5C', 35: '#F2C94C', 25: '#3DBA74', 10: '#E9EEF6', 5: '#5B93E8', 2.5: '#8E9AB0' };
  const load = (total, bar) => { let side = Math.max(0, (total - bar) / 2); const out = []; for (const p of PLATES) while (side >= p - 1e-9) { out.push(p); side -= p; } return { plates: out, off: Math.round(side * 20) / 10 }; };
  const r5 = x => Math.round(x / 5) * 5;
  VIEWS.plates = async (w, tok) => {
    let total = /^\d+(\.\d+)?$/.test(w || '') ? +w : 225, bar = 45;
    if (!paint(tok, `<section class="sec narrow"><div><div class="kicker">Free tool</div><h2>Plate <span>calculator</span></h2><p class="secSub">What goes on each side, and how to warm up to it.</p></div>
      <div class="formCard"><div class="fields"><div class="field w2"><label for="pl-w">Weight on the bar (lb)</label><input id="pl-w" type="number" inputmode="decimal" step="any" min="0" max="1499" value="${total}" style="font:600 28px var(--mono)"></div>
      <div class="field w2"><span class="lbl">Bar</span><div class="chips">${[45, 35, 15].map(b => `<button class="chip" type="button" data-bar="${b}" aria-pressed="${b === bar}">${b} lb bar</button>`).join('')}</div></div></div>
      <div id="plOut"></div></div></section>`)) return;
    const draw = () => {
      const { plates, off } = load(total, bar);
      const warm = total > bar ? [[bar, 10], [r5(total * 0.4), 5], [r5(total * 0.6), 3], [r5(total * 0.75), 2], [r5(total * 0.85), 1]].filter(([x]) => x < total && x >= bar) : [];
      $('#plOut').innerHTML = `<div class="plBar" aria-hidden="true"><i class="sleeve"></i>${plates.map(p => `<i style="height:${40 + Math.min(p, 45) * 2.4}px;width:${p >= 25 ? 22 : 14}px;background:${PCOL[p]}"></i>`).join('')}</div>
        <p class="plTxt"><span class="eyebrow">Each side</span><b>${plates.length ? plates.join(' + ') : 'Just the bar'}</b></p>
        ${off ? `<p class="hint">${off} lb can't be loaded with standard plates.</p>` : ''}
        ${warm.length ? `<div class="tablewrap"><table><thead><tr><th>Warmup to ${total}</th><th class="r">Reps</th><th>Each side</th></tr></thead><tbody>${warm.map(([x, r]) => `<tr><td class="n">${x} lb</td><td class="r n">× ${r}</td><td class="sub">${load(x, bar).plates.join(' + ') || 'bar'}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
    };
    draw();
    $('#pl-w').oninput = e => { total = +e.target.value || 0; draw(); };
    $$('[data-bar]').forEach(b => b.onclick = () => { bar = +b.dataset.bar; $$('[data-bar]').forEach(x => x.setAttribute('aria-pressed', String(+x.dataset.bar === bar))); draw(); });
  };
}
