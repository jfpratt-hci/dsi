// /insights/<gym>  Gym office, owners only: revenue, members and which classes fill up.
// Attendance comes from two places: classes booked and checked in through Dandy, and history brought in
// from another system (Kilo exports or the like) stored in gym_class_log and gym_visit_log.
// Revenue comes from Dandy billing; until members pay through Dandy, the owner's average dues give an estimate.

export function install(X) {
  const { sb, S, VIEWS, $, $$, esc, num, fmt, today, fmtD, addDays, monday, toast, must, paint, needLogin, go } = X;
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const isOwner = gid => (S.me && S.me.role === 'admin') || (S.myGyms || []).some(g => g.gym_id === gid && g.role === 'owner');
  const dowOf = d => (new Date(d + 'T12:00:00').getDay() + 6) % 7;
  const t12 = t => { const [h, m] = String(t).split(':').map(Number); return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`; };
  const money = c => '$' + fmt(Math.round(c / 100));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const missing = e => e && (e.code === '42P01' || e.code === 'PGRST205' || /gym_(visit|class)_log|gym_insight/.test(e.message || ''));

  // Everything in pages of 1,000 (the API's limit per request).
  async function all(q) {
    const out = [];
    for (let from = 0; from < 50000; from += 1000) {
      const { data, error } = await q().range(from, from + 999);
      if (error) throw error;
      out.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return out;
  }

  async function load(g) {
    const gid = g.id;
    const safe = p => p.catch(e => { if (missing(e)) return null; throw e; });
    const [cls, vis, set, sess, mem, inv] = await Promise.all([
      safe(all(() => sb.from('gym_class_log').select('day,start_time,class_name,coach_name,capacity,attendance_taken').eq('gym_id', gid).order('day'))),
      safe(all(() => sb.from('gym_visit_log').select('day,start_time,class_name,member_name,profile_id,attended').eq('gym_id', gid).order('day'))),
      sb.from('gym_insight_settings').select('*').eq('gym_id', gid).maybeSingle().then(r => (r.error ? null : r.data)),
      all(() => sb.from('sessions').select('id,name,starts_at,capacity,status,coach_id').eq('gym_id', gid).lt('starts_at', new Date().toISOString()).neq('status', 'canceled').order('starts_at')),
      sb.from('memberships').select('profile_id,plan_name,price_cents,interval,status,start_date,end_date').eq('gym_id', gid).then(must),
      sb.from('invoices').select('amount_cents,status,paid_at,due_date').eq('gym_id', gid).then(must),
    ]);
    // Dandy classes: a person counts when checked in, or when booked into a class the coach never checked anyone into.
    const ids = sess.map(s => s.id);
    const bk = [];
    for (let i = 0; i < ids.length; i += 200) bk.push(...must(await sb.from('bookings').select('session_id,profile_id,status').in('session_id', ids.slice(i, i + 200)).in('status', ['booked', 'attended'])));
    const tz = g.tz || 'America/New_York';
    const local = iso => { const d = new Date(iso); return { day: d.toLocaleDateString('en-CA', { timeZone: tz }), time: d.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }) }; };
    const names = new Map((await sb.from('profiles').select('id,display_name').eq('gym_id', gid)).data?.map(p => [p.id, p.display_name]) || []);
    const classes = (cls || []).map(c => ({ day: c.day, time: c.start_time.slice(0, 5), name: c.class_name, coach: c.coach_name || '', cap: c.capacity || 0, taken: c.attendance_taken }));
    const visits = (vis || []).filter(v => v.attended).map(v => ({ day: v.day, time: v.start_time.slice(0, 5), name: v.class_name, who: v.member_name }));
    const coachName = id => names.get(id) || '';
    for (const s of sess) {
      const { day, time } = local(s.starts_at), mine = bk.filter(b => b.session_id === s.id), anyIn = mine.some(b => b.status === 'attended');
      classes.push({ day, time, name: s.name || 'Class', coach: coachName(s.coach_id), cap: s.capacity || 0, taken: anyIn });
      mine.filter(b => b.status === 'attended' || !anyIn).forEach(b => visits.push({ day, time, name: s.name || 'Class', who: names.get(b.profile_id) || 'Member', pid: b.profile_id }));
    }
    const skip = new Set((set?.exclude_names || []).map(n => n.trim().toLowerCase()));
    return { classes, visits: visits.filter(v => !skip.has(v.who.trim().toLowerCase())), set: set || { exclude_names: [], avg_dues_cents: null }, mem, inv, noTables: cls === null };
  }

  // Numbers for one period ending today, plus the period before it to compare.
  function crunch(d, days) {
    const end = today(), from = days ? addDays(end, -days + 1) : (d.classes[0] || d.visits[0] || { day: end }).day;
    const prevFrom = days ? addDays(from, -days) : null;
    const inP = x => x.day >= from && x.day <= end, inPrev = x => prevFrom && x.day >= prevFrom && x.day < from;
    const key = x => `${x.day}|${x.time}|${x.name}`;
    const head = new Map();
    for (const v of d.visits) head.set(key(v), (head.get(key(v)) || 0) + 1);
    const cls = d.classes.filter(inP).map(c => ({ ...c, n: head.get(key(c)) || 0 }));
    const vis = d.visits.filter(inP), prevVis = d.visits.filter(inPrev);
    // Weekly visits
    const weeks = new Map();
    for (const v of vis) { const w = monday(v.day); weeks.set(w, (weeks.get(w) || 0) + 1); }
    // Slots: a weekday and time of a class name, averaged over every time it ran
    const slots = new Map();
    for (const c of cls) { const k = `${dowOf(c.day)}|${c.time}|${c.name}`; const s = slots.get(k) || { dow: dowOf(c.day), time: c.time, name: c.name, runs: 0, sum: 0, cap: 0, coaches: new Map() }; s.runs++; s.sum += c.n; s.cap += c.cap; if (c.coach) s.coaches.set(c.coach, (s.coaches.get(c.coach) || 0) + 1); slots.set(k, s); }
    const slotList = [...slots.values()].map(s => ({ ...s, avg: s.sum / s.runs, fill: s.cap ? s.sum / s.cap : 0, coach: [...s.coaches.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '' }));
    // Heat map: weekday by time
    const times = [...new Set(cls.map(c => c.time))].sort();
    const heat = times.map(t => DOW.map((_, i) => { const xs = cls.filter(c => c.time === t && dowOf(c.day) === i); return xs.length ? xs.reduce((a, c) => a + c.n, 0) / xs.length : null; }));
    // Coaches
    const coaches = new Map();
    for (const c of cls) { if (!c.coach) continue; const x = coaches.get(c.coach) || { runs: 0, sum: 0 }; x.runs++; x.sum += c.n; coaches.set(c.coach, x); }
    // Members: first and last visit across all time, visits in the period
    const people = new Map();
    for (const v of d.visits) { const p = people.get(v.who) || { who: v.who, first: v.day, last: v.day, all: 0, inP: 0, last28: 0 }; p.first = v.day < p.first ? v.day : p.first; p.last = v.day > p.last ? v.day : p.last; p.all++; if (inP(v)) p.inP++; if (v.day > addDays(end, -28)) p.last28++; people.set(v.who, p); }
    const ppl = [...people.values()];
    const gap = p => Math.round((Date.parse(end) - Date.parse(p.last)) / 864e5);
    const active = ppl.filter(p => gap(p) <= 30);
    const atRisk = ppl.filter(p => gap(p) >= 14 && gap(p) <= 45 && p.all >= 4).sort((a, b) => gap(a) - gap(b));
    // New and lost by month. The first month of data is skipped for new: everyone looks new there.
    const start = (d.visits[0] || { day: end }).day.slice(0, 7);
    const months = [...new Set(d.visits.map(v => v.day.slice(0, 7)))].sort();
    const flow = months.map(m => ({ m, gained: m === start ? null : ppl.filter(p => p.first.slice(0, 7) === m).length, lost: ppl.filter(p => gap(p) > 30 && p.last.slice(0, 7) === m).length }));
    const freq = [0, 0, 0, 0]; // under 1, 1 to 2, 2 to 3, 3+ a week over the last 4 weeks
    active.forEach(p => { const w = p.last28 / 4; freq[w < 1 ? 0 : w < 2 ? 1 : w < 3 ? 2 : 3]++; });
    return { from, end, days, cls, vis, prevVis, weeks, slotList, times, heat, coaches, ppl, active, atRisk, flow, freq, gap };
  }

  function revenue(d, activeCount) {
    const monthly = m => { const p = num(m.price_cents); return m.interval === 'year' ? p / 12 : m.interval === 'week' ? p * 52 / 12 : p; };
    const live = d.mem.filter(m => m.status === 'active');
    const mrr = live.reduce((a, m) => a + monthly(m), 0);
    const paid = new Map();
    for (const i of d.inv) if (i.status === 'paid' && i.paid_at) { const k = i.paid_at.slice(0, 7); paid.set(k, (paid.get(k) || 0) + num(i.amount_cents)); }
    const plans = new Map();
    for (const m of live) plans.set(m.plan_name || 'Plan', (plans.get(m.plan_name || 'Plan') || 0) + 1);
    const est = d.set.avg_dues_cents ? d.set.avg_dues_cents * activeCount : 0;
    return { live: live.length, mrr, paid: [...paid.entries()].sort(), plans: [...plans.entries()].sort((a, b) => b[1] - a[1]), est };
  }

  const bars = (rows, label, fmtV = fmt) => {
    const max = Math.max(1, ...rows.map(r => r[1]));
    return `<div class="inBars" role="img" aria-label="${esc(label)}">${rows.map(([k, v, sub]) => `<div class="inBar"><span class="inBarV">${fmtV(v)}</span><i style="height:${Math.round((v / max) * 100)}%"></i><span class="inBarL">${esc(k)}</span>${sub ? `<span class="inBarS">${esc(sub)}</span>` : ''}</div>`).join('')}</div>`;
  };
  const kpi = (v, l, d) => `<div class="inKpi"><b>${v}</b><span>${esc(l)}</span>${d != null ? `<em class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${Math.abs(d)}% vs before</em>` : ''}</div>`;

  VIEWS.insights = async (gid, tok) => {
    if (!S.me) return needLogin(tok, 'see your gym insights');
    if (!gid && (S.myGyms || []).length) return go('/insights/' + S.myGyms[0].gym_id, true);
    if (!isOwner(gid)) return paint(tok, '<section class="prEmpty"><b>Owners only</b><p>Gym owners see revenue and member insights here.</p></section>');
    const g = must(await sb.from('gyms').select('*').eq('id', gid).maybeSingle());
    if (!g) return paint(tok, '<section class="prEmpty"><b>No gym here</b></section>');
    const d = await load(g);
    const q = new URLSearchParams(location.search), days = q.has('all') ? 0 : +(q.get('days') || 30), tab = q.get('tab') || 'overview';
    const c = crunch(d, days);
    const r = revenue(d, c.active.length);
    const link = (o = {}) => { const p = new URLSearchParams({ ...(days ? { days } : { all: 1 }), tab, ...o }); if (o.all === 0) p.delete('all'); return `/insights/${gid}?${p}`; };
    const totalVis = c.vis.length, avgClass = c.cls.length ? totalVis / c.cls.length : 0;
    const capSum = c.cls.reduce((a, x) => a + x.cap, 0);
    const delta = days && c.prevVis.length ? Math.round(((totalVis - c.prevVis.length) / c.prevVis.length) * 100) : null;
    const ranked = [...c.slotList].filter(s => s.runs >= 2).sort((a, b) => b.avg - a.avg);
    const slotRow = s => `<tr><td>${DOW[s.dow]} ${t12(s.time)}</td><td>${esc(s.name)}</td><td class="sub">${esc(s.coach)}</td><td class="r n">${s.avg.toFixed(1)}</td><td class="r n">${s.cap ? Math.round(s.fill * 100) + '%' : '·'}</td><td class="r n sub">${s.runs}</td></tr>`;
    const slotHead = '<thead><tr><th>Class</th><th>Type</th><th>Usual coach</th><th class="r">Avg</th><th class="r">Full</th><th class="r">Ran</th></tr></thead>';
    const heatMax = Math.max(1, ...c.heat.flat().filter(x => x != null));
    const empty = !d.classes.length && !d.visits.length;

    const panes = {
      overview: `<div class="inKpis">${kpi(fmt(c.active.length), 'Active members (last 30 days)')}${kpi(fmt(totalVis), 'Visits', delta)}${kpi(avgClass.toFixed(1), 'Average per class')}${kpi(capSum ? pct(totalVis, capSum) + '%' : '·', 'Class spots filled')}${kpi(r.mrr ? money(r.mrr) : r.est ? '~' + money(r.est) : '·', r.mrr ? 'Monthly dues (MRR)' : r.est ? 'Monthly dues, estimated' : 'Monthly dues')}</div>
        <div class="inGrid2"><div class="formCard"><h3 class="inH">Visits per week</h3>${bars([...c.weeks.entries()].sort().slice(-16).map(([w, v]) => [fmtD(w), v]), 'Visits per week')}</div>
          <div class="formCard"><h3 class="inH">Busiest and quietest classes</h3><table class="inT"><tbody>${ranked.slice(0, 4).map(s => `<tr><td><span class="pill up">Top</span> ${DOW[s.dow]} ${t12(s.time)} ${esc(s.name)}</td><td class="r n">${s.avg.toFixed(1)}</td></tr>`).join('')}${ranked.slice(-4).reverse().map(s => `<tr><td><span class="pill down">Low</span> ${DOW[s.dow]} ${t12(s.time)} ${esc(s.name)}</td><td class="r n">${s.avg.toFixed(1)}</td></tr>`).join('')}</tbody></table>
          <p class="hint">Average people per class. <a href="${link({ tab: 'classes' })}">Every class</a></p></div></div>
        <div class="inGrid2"><div class="formCard"><h3 class="inH">Members gained and lost</h3>${c.flow.length ? `<table class="inT"><thead><tr><th>Month</th><th class="r">New</th><th class="r">Stopped coming</th><th class="r">Net</th></tr></thead><tbody>${c.flow.map(f => `<tr><td>${f.m}</td><td class="r n">${f.gained ?? '·'}</td><td class="r n">${f.lost}</td><td class="r n">${f.gained == null ? '·' : (f.gained - f.lost > 0 ? '+' : '') + (f.gained - f.lost)}</td></tr>`).join('')}</tbody></table><p class="hint">New is someone's first class. Stopped coming is no class in 30 days, counted in the month of their last one.</p>` : '<p class="hint">No attendance yet.</p>'}</div>
          <div class="formCard"><h3 class="inH">Slipping away <small class="hint">spotted by DI</small></h3>${c.atRisk.length ? `<table class="inT"><tbody>${c.atRisk.slice(0, 8).map(p => `<tr><td>${esc(p.who)}</td><td class="r sub">last in ${c.gap(p)} days ago</td></tr>`).join('')}</tbody></table><p class="hint">Regulars with no class in 2 to 6 weeks. A text from the coach brings most of them back.</p>` : '<p class="hint">Nobody is slipping. Nice.</p>'}</div></div>`,
      classes: `<div class="formCard"><h3 class="inH">When people come <small>average per class</small></h3>
          <div class="inHeat" style="grid-template-columns:5em repeat(7,1fr)"><span></span>${DOW.map(x => `<b>${x}</b>`).join('')}${c.times.map((t, i) => `<b>${t12(t)}</b>${c.heat[i].map(v => v == null ? '<i class="none"></i>' : `<i style="--a:${(0.15 + 0.85 * v / heatMax).toFixed(2)}" title="${v.toFixed(1)}">${v.toFixed(1)}</i>`).join('')}`).join('')}</div></div>
        <div class="inGrid2"><div class="formCard"><h3 class="inH">Most popular</h3><table class="inT">${slotHead}<tbody>${ranked.slice(0, 10).map(slotRow).join('')}</tbody></table></div>
          <div class="formCard"><h3 class="inH">Least popular</h3><table class="inT">${slotHead}<tbody>${ranked.slice(-10).reverse().map(slotRow).join('')}</tbody></table><p class="hint">Classes that ran at least twice in this period.</p></div></div>
        <div class="formCard"><h3 class="inH">By coach</h3><table class="inT"><thead><tr><th>Coach</th><th class="r">Classes</th><th class="r">Avg per class</th></tr></thead><tbody>${[...c.coaches.entries()].sort((a, b) => b[1].runs - a[1].runs).map(([n, x]) => `<tr><td>${esc(n)}</td><td class="r n">${x.runs}</td><td class="r n">${(x.sum / x.runs).toFixed(1)}</td></tr>`).join('')}</tbody></table></div>`,
      members: `<div class="inKpis">${kpi(fmt(c.active.length), 'Active (last 30 days)')}${['Under 1 a week', '1 to 2 a week', '2 to 3 a week', '3+ a week'].map((l, i) => kpi(fmt(c.freq[i]), l)).join('')}</div>
        <div class="inGrid2"><div class="formCard"><h3 class="inH">Most visits this period</h3><table class="inT"><tbody>${[...c.ppl].filter(p => p.inP).sort((a, b) => b.inP - a.inP).slice(0, 15).map((p, i) => `<tr><td class="n sub">${i + 1}</td><td>${esc(p.who)}</td><td class="r n">${p.inP}</td></tr>`).join('')}</tbody></table></div>
          <div class="formCard"><h3 class="inH">Not seen in 14+ days</h3><table class="inT"><tbody>${[...c.ppl].filter(p => c.gap(p) >= 14).sort((a, b) => c.gap(a) - c.gap(b)).slice(0, 15).map(p => `<tr><td>${esc(p.who)}</td><td class="r sub">${c.gap(p)} days · ${p.all} visits total</td></tr>`).join('')}</tbody></table></div></div>`,
      revenue: `<div class="inKpis">${kpi(r.mrr ? money(r.mrr) : '·', 'Monthly dues billed through Dandy')}${kpi(fmt(r.live), 'Active memberships')}${kpi(r.est ? '~' + money(r.est) : '·', 'Estimate: active members × average dues')}${kpi(r.mrr && r.live ? money(r.mrr / r.live) : d.set.avg_dues_cents ? money(d.set.avg_dues_cents) : '·', 'Average dues')}</div>
        <div class="inGrid2"><div class="formCard"><h3 class="inH">Paid through Dandy, by month</h3>${r.paid.length ? bars(r.paid.map(([m, v]) => [m, v]), 'Paid by month', money) : '<p class="hint">Nothing paid through Dandy yet. Once members pay their dues here, every month shows up on its own.</p>'}</div>
          <div class="formCard"><h3 class="inH">Plans</h3>${r.plans.length ? `<table class="inT"><tbody>${r.plans.map(([n, k]) => `<tr><td>${esc(n)}</td><td class="r n">${k}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">No memberships in Dandy yet.</p>'}
          <form id="inDues" class="row" style="margin-top:12px"><label for="inDuesV" class="lbl">Average monthly dues for the estimate</label><input id="inDuesV" type="number" inputmode="decimal" min="0" step="1" value="${d.set.avg_dues_cents ? d.set.avg_dues_cents / 100 : ''}" placeholder="160" style="max-width:8em"><button class="btn sm">Save</button></form></div></div>`,
    };

    if (!paint(tok, `${X.officeBar(g, 'insights')}<section class="sec inSec">
      <div class="inTop"><nav class="tabs" aria-label="Insights">${[['overview', 'Overview'], ['classes', 'Classes'], ['members', 'Members'], ['revenue', 'Revenue']].map(([k, n]) => `<a class="tab" href="${link({ tab: k })}"${k === tab ? ' aria-current="page"' : ''}>${n}</a>`).join('')}</nav>
        <div class="chips">${[[30, '30 days'], [90, '90 days'], [365, 'Year']].map(([n, l]) => `<a class="chip" href="${link({ days: n, all: 0 })}" aria-pressed="${days === n}">${l}</a>`).join('')}<a class="chip" href="/insights/${gid}?all=1&tab=${tab}" aria-pressed="${!days}">All</a>
          <button class="btn ghost sm" type="button" id="inImp">Import history</button><button class="btn ghost sm" type="button" id="inSet">Settings</button></div></div>
      <p class="hint">${fmtD(c.from)} to ${fmtD(c.end)} · ${fmt(c.cls.length)} classes · ${fmt(totalVis)} visits${d.noTables ? ' · History import switches on with the next update.' : ''}</p>
      ${empty ? `<div class="prEmpty"><b>No attendance yet</b><p>Insights fill in as members book and check in through Dandy. Coming from Kilo or another system? Import your class history and see it all today.</p><p><button class="btn" type="button" id="inImp2">Import history</button></p></div>` : panes[tab] || panes.overview}
      <div id="inPanel"></div></section>`)) return;

    const dues = $('#inDues'); if (dues) dues.onsubmit = async e => { e.preventDefault(); const v = Math.round(num($('#inDuesV').value) * 100) || null; const { error } = await sb.from('gym_insight_settings').upsert({ gym_id: gid, avg_dues_cents: v, exclude_names: d.set.exclude_names || [], updated_at: new Date().toISOString() }); if (error) return toast(error.message); toast('Saved'); VIEWS.insights(gid, S.tok); };
    const setB = $('#inSet'); if (setB) setB.onclick = () => {
      $('#inPanel').innerHTML = `<form class="formCard" id="inSetF"><h3 class="inH">Leave these people out of member counts</h3><p class="hint">Coaches and kids class. One name per line, as it appears in your attendance.</p>
        <textarea id="inEx" rows="6">${esc((d.set.exclude_names || []).join('\n'))}</textarea><div class="row"><button class="btn sm">Save</button></div></form>`;
      $('#inSetF').onsubmit = async e => { e.preventDefault(); const ex = $('#inEx').value.split('\n').map(s => s.trim()).filter(Boolean); const { error } = await sb.from('gym_insight_settings').upsert({ gym_id: gid, exclude_names: ex, avg_dues_cents: d.set.avg_dues_cents, updated_at: new Date().toISOString() }); if (error) return toast(error.message); toast('Saved'); VIEWS.insights(gid, S.tok); };
      $('#inPanel').scrollIntoView({ behavior: 'smooth' });
    };
    const imp = () => importPanel(g, () => VIEWS.insights(gid, S.tok));
    [$('#inImp'), $('#inImp2')].forEach(b => b && (b.onclick = imp));
  };

  /* ---------- import history from a CSV ---------- */
  // Two shapes: one row per person per class (date, time, class, member, and optionally coach, status, attended),
  // or one row per class held (date, time, class, coach, capacity). Kilo exports and the CFS files fit both.
  function parseCSV(txt) {
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < txt.length; i++) {
      const ch = txt[i];
      if (q) { if (ch === '"') { if (txt[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
      if (ch === '"') q = true; else if (ch === ',') { row.push(f); f = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && txt[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; } else f += ch;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    const head = (rows.shift() || []).map(h => h.trim().toLowerCase());
    return rows.filter(r => r.some(x => x.trim())).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
  }
  const pick = (r, ...ks) => { for (const k of ks) if (r[k] != null && r[k] !== '') return r[k]; return ''; };
  const time24 = s => { const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/i.exec(String(s).trim()); if (!m) return null; let h = +m[1]; const ap = (m[3] || '').toLowerCase()[0]; if (ap === 'p' && h < 12) h += 12; if (ap === 'a' && h === 12) h = 0; return `${String(h).padStart(2, '0')}:${m[2] || '00'}`; };
  const dateIso = s => { s = String(s).trim(); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s); if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; return null; };
  const yes = s => /^(yes|true|1|y|checked in)/i.test(String(s).trim());

  function importPanel(g, done) {
    const box = $('#inPanel');
    box.innerHTML = `<div class="formCard"><h3 class="inH">Import class history</h3>
      <p class="hint">Upload a CSV from Kilo or any gym software. Either one row per person per class (date, time, class, member, plus coach, status or attended if you have them), or one row per class held (date, time, class, coach, capacity). Bring in both for the full picture. Re-importing the same rows does not double count.</p>
      <div class="row"><input type="file" id="inFile" accept=".csv,text/csv"><span class="hint" id="inMsg" role="status"></span></div></div>`;
    box.scrollIntoView({ behavior: 'smooth' });
    $('#inFile').onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      const msg = $('#inMsg'); msg.textContent = 'Reading…';
      const rows = parseCSV(await file.text());
      if (!rows.length) { msg.textContent = 'That file has no rows.'; return; }
      const isVisits = rows.some(r => pick(r, 'member', 'athlete', 'name', 'member name', 'full name'));
      const out = [], bad = [];
      for (const r of rows) {
        const day = dateIso(pick(r, 'date', 'day', 'class date')), time = time24(pick(r, 'time', 'start', 'start time', 'class time')), cls = pick(r, 'class', 'class name', 'program') || 'Class';
        if (!day || !time) { bad.push(r); continue; }
        if (isVisits) {
          const who = pick(r, 'member', 'athlete', 'name', 'member name', 'full name'); if (!who) { bad.push(r); continue; }
          const st = pick(r, 'status'), att = pick(r, 'attended');
          out.push({ gym_id: g.id, day, start_time: time, class_name: cls, member_name: who, status: st || null, attended: att ? yes(att) : st ? /checked in|attended|reserved, attendance not taken/i.test(st) : true, source: 'import' });
        } else {
          const cap = parseInt(pick(r, 'capacity', 'cap', 'max'), 10);
          out.push({ gym_id: g.id, day, start_time: time, class_name: cls, coach_name: pick(r, 'coach', 'instructor') || null, capacity: Number.isFinite(cap) ? cap : null, attendance_taken: pick(r, 'attendance_taken', 'attendance taken') ? yes(pick(r, 'attendance_taken', 'attendance taken')) : true, source: 'import' });
        }
      }
      // Classes held are implied by visits too, so a visits only file still fills the class views.
      if (isVisits) {
        const seen = new Map();
        for (const v of out) { const k = `${v.day}|${v.start_time}|${v.class_name}`; if (!seen.has(k)) seen.set(k, { gym_id: g.id, day: v.day, start_time: v.start_time, class_name: v.class_name, coach_name: pick(rows[0], 'coach') ? null : null, source: 'import' }); }
        for (const r of rows) { const k = `${dateIso(pick(r, 'date', 'day'))}|${time24(pick(r, 'time', 'start'))}|${pick(r, 'class', 'class name') || 'Class'}`; const c = seen.get(k); if (c && !c.coach_name && pick(r, 'coach')) c.coach_name = pick(r, 'coach'); }
        const ins = [...seen.values()];
        for (let i = 0; i < ins.length; i += 500) { const { error } = await sb.from('gym_class_log').upsert(ins.slice(i, i + 500), { onConflict: 'gym_id,day,start_time,class_name', ignoreDuplicates: true }); if (error) { msg.textContent = error.message; return; } }
      }
      const table = isVisits ? 'gym_visit_log' : 'gym_class_log', conflict = isVisits ? 'gym_id,day,start_time,class_name,member_name' : 'gym_id,day,start_time,class_name';
      for (let i = 0; i < out.length; i += 500) {
        msg.textContent = `Saving ${Math.min(i + 500, out.length)} of ${out.length}…`;
        const { error } = await sb.from(table).upsert(out.slice(i, i + 500), { onConflict: conflict });
        if (error) { msg.textContent = missing(error) ? 'History import switches on with the next update.' : error.message; return; }
      }
      toast(`Imported ${fmt(out.length)} ${isVisits ? 'visits' : 'classes'}${bad.length ? `, skipped ${bad.length} rows without a date or time` : ''}`);
      done();
    };
  }
}
