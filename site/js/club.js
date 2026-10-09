// Gym membership platform on dandystrength.com.
// Staff:   /club/<gym>?tab=today|schedule|members|billing|docs|staff
// Members: /classes (book), /mygym and /billing (membership, documents, invoices, attendance), /sign/<waiver|contract>?gym=&plan=
// Owners see money and documents; coaches see the schedule, check in, members and their own staffing.

import { STARTERS, fillDoc } from './doc-templates.js';

export function install(X) {
  const { sb, S, VIEWS, $, $$, esc, num, today, pd, fmtD, addDays, toast, must, paint, needLogin, go, route, isStaff } = X;

  /* ---------- helpers ---------- */
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const money = c => '$' + (num(c) / 100).toLocaleString('en-US', { minimumFractionDigits: num(c) % 100 ? 2 : 0, maximumFractionDigits: 2 });
  const cents = v => Math.round(parseFloat(String(v).replace(/[^0-9.]/g, '')) * 100) || 0;
  const tAt = (iso, tz) => new Date(iso).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  const dayOf = (iso, tz) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });
  const dayName = (d, opt) => pd(d).toLocaleDateString('en-US', opt || { weekday: 'long', month: 'short', day: 'numeric' });
  const hm = t => { const [h, m] = String(t).split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ap}`; };
  const isOwner = gid => (S.me && S.me.role === 'admin') || (S.myGyms || []).some(g => g.gym_id === gid && g.role === 'owner');
  const isCoach = gid => isOwner(gid) || (S.myGyms || []).some(g => g.gym_id === gid);
  const rpc = async (fn, args) => { const { data, error } = await sb.rpc(fn, args); if (error) throw new Error(error.message); return data; };
  const call = async (action, body) => {
    const { data, error } = await sb.functions.invoke('billing', { body: { action, ...body } });
    let msg = error && error.message;
    if (error && error.context && error.context.json) { try { msg = (await error.context.json()).error || msg; } catch {} }
    if (msg) throw new Error(msg);
    return data;
  };
  const opt = (list, cur) => list.map(([v, n]) => `<option value="${esc(v)}"${String(cur ?? '') === String(v) ? ' selected' : ''}>${esc(n)}</option>`).join('');
  const statusPill = st => ({ active: '<span class="pill up">Active</span>', past_due: '<span class="pill down">Past due</span>', pending: '<span class="pill flat">Pending</span>', paused: '<span class="pill flat">Paused</span>', canceled: '<span class="pill">Ended</span>' }[st] || '<span class="pill">None</span>');
  const csv = (name, rows) => { const s = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([s], { type: 'text/csv' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  const docVals = (g, extra) => ({ gym: g.name, gym_address: [g.address, g.city].filter(Boolean).join(', ') || g.city || '', date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), ...extra });
  const planVals = p => p ? { plan: p.name, price: money(p.price_cents), interval: { month: 'per month', year: 'per year', once: 'one time' }[p.interval], commitment: p.commitment_months ? `${p.commitment_months} months` : 'None, month to month' } : {};

  // Dated classes for a gym between two days (inclusive), built from the weekly templates.
  async function sessionsFor(g, from, to) {
    try { await sb.rpc('ensure_sessions', { p_gym: g.id, p_from: from, p_to: to }); } catch {}
    const rows = must(await sb.from('sessions').select('*').eq('gym_id', g.id).gte('starts_at', addDays(from, -1) + 'T00:00:00Z').lt('starts_at', addDays(to, 2) + 'T00:00:00Z').order('starts_at'));
    return rows.filter(s => { const d = dayOf(s.starts_at, g.tz); return d >= from && d <= to; });
  }
  const gymById = async gid => must(await sb.from('gyms').select('*').eq('id', gid).maybeSingle());
  const people = async ids => { ids = [...new Set(ids.filter(Boolean))]; return ids.length ? new Map(must(await sb.from('profiles').select('id,display_name').in('id', ids)).map(p => [p.id, p.display_name || 'Member'])) : new Map(); };

  /* ---------- signature pad ---------- */
  function pad(canvas) {
    const ctx = canvas.getContext('2d'); let drawing = false, inked = false, last = null;
    const fit = () => { const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; canvas.width = r.width * dpr; canvas.height = r.height * dpr; ctx.scale(dpr, dpr); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111'; };
    fit();
    const pt = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    canvas.addEventListener('pointerdown', e => { drawing = true; last = pt(e); canvas.setPointerCapture(e.pointerId); e.preventDefault(); });
    canvas.addEventListener('pointermove', e => { if (!drawing) return; const p = pt(e); ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke(); last = p; inked = true; e.preventDefault(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => canvas.addEventListener(t, () => { drawing = false; }));
    return {
      clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); inked = false; },
      get inked() { return inked; },
      png() { // a small white backed PNG for the record
        const o = document.createElement('canvas'); o.width = 600; o.height = 160; const c = o.getContext('2d');
        c.fillStyle = '#fff'; c.fillRect(0, 0, o.width, o.height); c.drawImage(canvas, 0, 0, o.width, o.height); return o.toDataURL('image/png');
      },
    };
  }


  /* ---------- log a class: coaches type each person's weight during class, straight to the board ---------- */
  // /class/<gym>?s=<session>&it=<item key>. One part at a time, one box per person, each box saves on its own.
  let noEnteredBy = false;
  VIEWS.class = async (gid, tok) => {
    if (!S.me) return needLogin(tok, 'log a class');
    if (!gid && (S.myGyms || []).length) return go('/class/' + S.myGyms[0].gym_id, true);
    if (!isCoach(gid)) return paint(tok, '<section class="prEmpty"><b>Coaches only</b><p>Gym owners and coaches log weights for their classes here.</p></section>');
    const D = X.D, P = X.parts, qs = new URLSearchParams(location.search);
    const g = await gymById(gid);
    if (!g) return paint(tok, '<section class="prEmpty"><b>No gym here</b></section>');
    const day = new Date().toLocaleDateString('en-CA', { timeZone: g.tz });
    const [ss, wr, board, members] = await Promise.all([
      sessionsFor(g, day, day),
      sb.from('workouts').select('*').eq('gym_id', gid).eq('day', day).maybeSingle().then(must),
      X.loadBoard(),
      sb.from('profiles').select('id,display_name,sex').eq('gym_id', gid).not('display_name', 'is', null).order('display_name').then(must),
    ]);
    const live = ss.filter(x => x.status !== 'canceled'), now = Date.now();
    const pick = live.find(x => x.id === qs.get('s')) || live.find(x => Date.parse(x.starts_at) <= now && Date.parse(x.ends_at) >= now)
      || live.find(x => Date.parse(x.starts_at) > now) || live[live.length - 1] || null;
    const shell = inner => `${X.officeBar(g, 'class')}<section class="sec clSec">${inner}</section>`;
    if (!wr) return paint(tok, shell(`<div class="prEmpty"><b>No workout posted for today</b><p>Post today's workout first, then log the class against it.</p><p><a class="btn" href="/wod/${gid}?day=${day}">Post the workout</a> <a class="btn ghost" href="/plan/${gid}">Plan builder</a></p></div>`));
    const w = wr, its = P.items(w);
    if (!its.length) return paint(tok, shell(`<div class="prEmpty"><b>Nothing to log today</b><p>Today's workout has no weight, time or reps to record. Turn one on in the workout editor.</p><p><a class="btn" href="/wod/${gid}?day=${day}">Edit the workout</a></p></div>`));
    const it = its.find(i => i.key === qs.get('it')) || its.find(i => i.kind === 'w') || its[0];
    const bk = pick ? must(await sb.from('bookings').select('profile_id,status').eq('session_id', pick.id).in('status', ['booked', 'attended']).order('created_at')) : [];
    const ids = bk.map(b => b.profile_id);
    const memberBy = new Map(members.map(m => [m.id, m]));
    const extra = await people(ids.filter(id => !memberBy.has(id)));
    const nameOf = id => (memberBy.get(id) || {}).display_name || extra.get(id) || 'Member';
    const logs = ids.length ? must(await sb.from('workout_logs').select('profile_id,entries,score,sets').eq('workout_id', w.id).in('profile_id', ids)) : [];
    const logOf = new Map(logs.map(l => [l.profile_id, l]));
    const rowOf = id => board.find(r => r.profile_id === id) || { sex: (memberBy.get(id) || {}).sex };
    const order = [...bk].sort((a, b) => (b.status === 'attended') - (a.status === 'attended') || nameOf(a.profile_id).localeCompare(nameOf(b.profile_id)));
    const isPrDay = it.kind === 'w' && it.lift && it.lift.max && w.pr_lift && D.LIFT_BY_DB[w.pr_lift];
    const val = id => { const v = ((logOf.get(id) || {}).entries || {})[it.key]; return it.kind === 't' ? P.fmtT(v) : (v ?? ''); };
    const tgt = id => it.kind === 'w' && it.lift ? D.target(it.lift, rowOf(id)) : 0;
    const href = (sid, key) => `/class/${gid}?s=${sid || ''}&it=${encodeURIComponent(key)}`;
    const box = id => it.kind === 'r'
      ? `<input class="clIn" type="number" inputmode="numeric" min="0" max="99999" step="1" data-p="${id}" value="${esc(val(id))}" placeholder="reps" aria-label="${esc(nameOf(id))} reps">`
      : it.kind === 't'
      ? `<input class="clIn" inputmode="numeric" maxlength="8" data-p="${id}" value="${esc(val(id))}" placeholder="m:ss" aria-label="${esc(nameOf(id))} time">`
      : `<input class="clIn" type="number" inputmode="decimal" min="0" max="1499" step="any" data-p="${id}" value="${esc(val(id))}" placeholder="${tgt(id) || 'lb'}" aria-label="${esc(nameOf(id))} weight in pounds">`;
    if (!paint(tok, shell(`<div class="secHead"><div><div class="kicker">${pick ? esc(tAt(pick.starts_at, g.tz)) + ' ' + esc(pick.name) : 'Today'} · ${esc(w.title)}</div><h2>Log the <span>class</span></h2>
        <p class="secSub">Type each person's ${it.kind === 't' ? 'time' : it.kind === 'r' ? 'total reps' : 'weight'} as they finish. Every box saves on its own and goes straight to the board and the TV.${isPrDay ? ' Today is a max out day, so a new best counts as a PR.' : ''}</p></div>
        <div class="row"><a class="btn ghost sm" href="/tv/${esc(g.slug || gid)}" target="_blank" rel="noopener">Big screen</a><a class="btn ghost sm" href="/results/${gid}">All of today's results</a></div></div>
      ${live.length > 1 ? `<div class="chips clPick" aria-label="Class">${live.map(x => `<a class="chip" href="${href(x.id, it.key)}" aria-pressed="${pick && x.id === pick.id}">${esc(tAt(x.starts_at, g.tz))} ${esc(x.name)}</a>`).join('')}</div>` : ''}
      <div class="chips clPick" aria-label="Part">${its.map(i => `<a class="chip" href="${href(pick && pick.id, i.key)}" aria-pressed="${i.key === it.key}">${esc(i.label)}</a>`).join('')}</div>
      ${it.lift ? `<p class="clRule"><b>${esc(it.lift.n)}</b> ${esc(it.sch || '')}${X.liftRule(it.lift) !== 'n/a' ? ' · ' + esc(X.liftRule(it.lift)) : ''}. The grey number is each person's target.</p>` : ''}
      ${!pick ? `<div class="prEmpty"><b>No classes today</b><p>Set up the weekly classes on the Schedule tab, or add people below to log them anyway.</p></div>` : ''}
      <ol class="clList" id="clList">${order.map(b => `<li data-row="${b.profile_id}"><span class="clWho"><b>${esc(nameOf(b.profile_id))}</b>${b.status === 'attended' ? '<span class="pill up">Here</span>' : '<span class="pill">Booked</span>'}</span>${box(b.profile_id)}<span class="clSt" data-st aria-live="polite">${val(b.profile_id) !== '' ? '<span class="pill up">Saved</span>' : ''}</span></li>`).join('')}</ol>
      ${pick ? `<div class="row clAdd"><label class="vh" for="clAddSel">Add someone to this class</label><select id="clAddSel" style="max-width:280px"><option value="">Add someone to this class…</option>${members.filter(m => !ids.includes(m.id)).map(m => `<option value="${m.id}">${esc(m.display_name)}</option>`).join('')}</select></div>` : ''}`))) return;

    const parse = raw => {
      const v = String(raw).trim(); if (!v) return { empty: true };
      if (it.kind === 't') { const x = P.parseT(v); return x > 0 ? { x } : { bad: `"${v}" is not a time. Use minutes and seconds, like 8:45.` }; }
      if (it.kind === 'r') return { x: Math.max(0, Math.min(99999, Math.round(+v) || 0)) };
      const x = Math.max(0, Math.min(1499, Math.round(+v * 2) / 2 || 0));
      return x > 0 ? { x } : { bad: `"${v}" is not a weight.` };
    };
    const save = async inp => {
      const pid = inp.dataset.p, st = $('[data-st]', inp.closest('li')), r = parse(inp.value);
      if (r.bad) { st.innerHTML = `<span class="pill down">Check it</span>`; toast(r.bad); return; }
      const had = logOf.get(pid), entries = { ...((had && had.entries) || {}) };
      if (r.empty) { if (!(it.key in entries)) return; delete entries[it.key]; } else { if (entries[it.key] === r.x) return; entries[it.key] = r.x; }
      st.innerHTML = '<span class="pill">Saving</span>';
      const row = { workout_id: w.id, profile_id: pid, entries, score: (had && had.score) || null, sets: (had && had.sets) || {} };
      let { error } = await sb.from('workout_logs').upsert(noEnteredBy ? row : { ...row, entered_by: S.me.id }, { onConflict: 'workout_id,profile_id' });
      if (error && /entered_by/.test(error.message)) { noEnteredBy = true; ({ error } = await sb.from('workout_logs').upsert(row, { onConflict: 'workout_id,profile_id' })); }
      if (error) { st.innerHTML = '<span class="pill down">Not saved</span>'; toast(/row-level security/i.test(error.message) ? `${nameOf(pid)} is not a member of ${g.name} yet, so their result can't be entered here.` : error.message); return; }
      logOf.set(pid, row);
      st.innerHTML = '<span class="pill up">Saved</span>';
      // Max out day: a new best becomes a PR for the DSI and the PR wall.
      if (isPrDay && !r.empty) {
        const L = D.LIFT_BY_DB[w.pr_lift], br = rowOf(pid), best = num(br[L.k]);
        if (r.x > best) {
          const { data, error: e2 } = await sb.from('lift_entries').insert({ profile_id: pid, lift: w.pr_lift, weight_lb: r.x, performed_on: day, source: 'workout', entered_by: S.me.id, note: `Entered by ${S.me.display_name} in class` }).select().single();
          if (!e2 && data && data.is_pr) { br[L.k] = r.x; st.innerHTML = '<span class="pill acc">PR</span>'; toast(`New ${D.liftName(w.pr_lift)} PR for ${nameOf(pid)}: ${r.x} lb`); }
          else if (e2) { console.error(e2); toast(`Saved. ${nameOf(pid)} can confirm the PR from their own log.`); }
        }
      }
    };
    const list = $('#clList');
    list.addEventListener('change', e => { if (e.target.matches('.clIn')) save(e.target); });
    list.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || !e.target.matches('.clIn')) return;
      e.preventDefault();
      const all = $$('.clIn', list), i = all.indexOf(e.target);
      e.target.blur();
      if (all[i + 1]) all[i + 1].focus();
    });
    const add = $('#clAddSel');
    if (add) add.onchange = async () => { const p = add.value; if (!p) return; try { await rpc('check_in', { p_session: pick.id, p_profile: p, p_in: true }); toast('Added and checked in'); route(); } catch (err) { toast(err.message); } };
    const first = $$('.clIn', list).find(i => !i.value); if (first && window.matchMedia('(min-width:861px)').matches) first.focus();
    if (window.matchMedia('(max-width:860px)').matches) { const sec = $('.clSec'); if (sec) window.scrollTo(0, sec.getBoundingClientRect().top + window.scrollY - 60); }
  };

  /* =================================================================
     STAFF: the gym office
     ================================================================= */
  const PRO_SEAT_CENTS = 400;
  const TABS = [['today', 'Check in'], ['schedule', 'Schedule'], ['members', 'Members'], ['billing', 'Billing', 1], ['docs', 'Waivers and contracts', 1], ['staff', 'Staff']];
  // One tab bar across every gym office page: check in, schedule, workouts, results, members, billing, documents, staff, settings.
  function officeBar(g, active) {
    const owner = isOwner(g.id);
    const tabs = X.OFFICE.filter(o => !o[3] || owner);
    return `<section class="sec offHead"><div class="secHead"><div><div class="kicker">${esc(g.city || 'Gym')} · Gym office</div><h2>${esc(g.name)}</h2></div>
        <div class="row"><a class="btn ghost sm" href="/tv/${esc(g.slug || g.id)}" target="_blank">Big screen</a><a class="btn ghost sm" href="/gyms/${g.id}">Gym board</a></div></div>
      <nav class="tabs offTabs" aria-label="Gym office">${tabs.map(([k, n]) => `<a class="tab" href="${X.officeHref(g.id, k)}"${k === active ? ' aria-current="page" aria-selected="true"' : ''}>${esc(n)}</a>`).join('')}</nav></section>`;
  }
  X.officeBar = officeBar;

  VIEWS.club = async (gid, tok) => {
    if (!S.me) return needLogin(tok, 'run your gym');
    if (!isCoach(gid)) return paint(tok, '<section class="prEmpty"><b>Gym staff only</b><p>Owners and coaches run the gym office.</p></section>');
    const g = await gymById(gid);
    if (!g) throw new Error('No gym here.');
    const owner = isOwner(gid);
    const qs = new URLSearchParams(location.search);
    const tabs = TABS.filter(t => !t[2] || owner);
    const tab = tabs.some(t => t[0] === qs.get('tab')) ? qs.get('tab') : 'today';
    const shell = inner => `${officeBar(g, tab)}<section class="sec">${inner}</section>`;
    const view = { today: tabToday, schedule: tabSchedule, members: tabMembers, billing: tabBilling, docs: tabDocs, staff: tabStaff }[tab];
    await view(g, tok, shell, qs, owner);
  };

  /* ----- Check in ----- */
  async function tabToday(g, tok, shell, qs) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(qs.get('day') || '') ? qs.get('day') : new Date().toLocaleDateString('en-CA', { timeZone: g.tz });
    const [ss, members, waiver] = await Promise.all([
      sessionsFor(g, day, day),
      sb.from('profiles').select('id,display_name').eq('gym_id', g.id).not('display_name', 'is', null).order('display_name').then(must),
      sb.from('gym_docs').select('id').eq('gym_id', g.id).eq('kind', 'waiver').eq('active', true).maybeSingle().then(r => r.data),
    ]);
    const ids = ss.map(s => s.id);
    const [bk, sigs, ms] = await Promise.all([
      ids.length ? sb.from('bookings').select('*').in('session_id', ids).neq('status', 'canceled').order('created_at').then(must) : [],
      waiver ? sb.from('doc_signatures').select('profile_id').eq('doc_id', waiver.id).then(must) : [],
      sb.from('memberships').select('profile_id,status').eq('gym_id', g.id).in('status', ['active', 'past_due', 'pending', 'paused']).then(must),
    ]);
    const names = new Map(members.map(m => [m.id, m.display_name])), coachNames = await people(ss.map(s => s.coach_id).concat(bk.map(b => b.profile_id).filter(id => !names.has(id))));
    const nm = id => names.get(id) || coachNames.get(id) || 'Member';
    const signed = new Set(sigs.map(s => s.profile_id)), mem = new Map(ms.map(m => [m.profile_id, m.status]));
    const flags = id => `${waiver && !signed.has(id) ? '<span class="pill down">No waiver</span>' : ''}${!mem.has(id) ? '<span class="pill flat">No membership</span>' : mem.get(id) === 'past_due' ? '<span class="pill down">Past due</span>' : ''}`;
    const card = s => {
      const roster = bk.filter(b => b.session_id === s.id), here = roster.filter(b => b.status === 'attended').length, booked = roster.filter(b => b.status !== 'waitlist').length;
      return `<article class="ckS${s.status === 'canceled' ? ' off' : ''}" data-s="${s.id}">
        <header><div><b>${tAt(s.starts_at, g.tz)}</b> ${esc(s.name)}${s.status === 'canceled' ? ' <span class="pill down">Canceled</span>' : ''}<div class="sub">Coach ${esc(s.coach_id ? nm(s.coach_id) : 'not set')}</div></div><a class="btn sm ckLog" href="/class/${g.id}?s=${s.id}">Log weights</a><div class="ckN"><b>${here}</b>/${booked} here<span class="sub">${s.capacity} spots</span></div></header>
        <div class="ckRoster">${roster.map(b => `<button type="button" class="ckP${b.status === 'attended' ? ' in' : ''}${b.status === 'waitlist' ? ' wl' : ''}" data-p="${b.profile_id}" data-in="${b.status === 'attended' ? 0 : 1}" aria-pressed="${b.status === 'attended'}"><span>${esc(nm(b.profile_id))}</span>${b.status === 'waitlist' ? '<span class="pill flat">Waitlist</span>' : ''}${flags(b.profile_id)}</button>`).join('') || '<p class="hint">Nobody booked yet.</p>'}</div>
        <div class="row"><label class="vh" for="wi-${s.id}">Walk in</label><select id="wi-${s.id}" data-walk style="max-width:240px"><option value="">Check in a walk in…</option>${members.filter(m => !roster.some(b => b.profile_id === m.id)).map(m => `<option value="${m.id}">${esc(m.display_name)}</option>`).join('')}</select></div>
      </article>`;
    };
    if (!paint(tok, shell(`<div class="row ckNav"><a class="btn ghost sm" href="/club/${g.id}?tab=today&day=${addDays(day, -1)}">← Day before</a><input type="date" id="ck-day" value="${day}" style="max-width:170px"><a class="btn ghost sm" href="/club/${g.id}?tab=today&day=${addDays(day, 1)}">Next day →</a><span class="hint">Tap a name to check them in. Tap again to undo.</span></div>
      ${ss.length ? `<div class="ckGrid">${ss.map(card).join('')}</div>` : `<div class="prEmpty"><b>No classes on ${esc(dayName(day))}</b><p>Set up the weekly classes on the Schedule tab.</p><p><a class="btn" href="/club/${g.id}?tab=schedule">Schedule</a></p></div>`}`))) return;
    $('#ck-day').onchange = e => e.target.value && go(`/club/${g.id}?tab=today&day=${e.target.value}`);
    $$('.ckS').forEach(a => {
      $$('.ckP', a).forEach(b => b.onclick = async () => { try { await rpc('check_in', { p_session: a.dataset.s, p_profile: b.dataset.p, p_in: b.dataset.in === '1' }); route(); } catch (e) { toast(e.message); } });
      $('[data-walk]', a).onchange = async e => { const p = e.target.value; if (!p) return; try { await rpc('check_in', { p_session: a.dataset.s, p_profile: p, p_in: true }); toast('Checked in'); route(); } catch (err) { toast(err.message); } };
    });
  }

  /* ----- Schedule ----- */
  async function tabSchedule(g, tok, shell, qs, owner) {
    const base = /^\d{4}-\d{2}-\d{2}$/.test(qs.get('week') || '') ? qs.get('week') : new Date().toLocaleDateString('en-CA', { timeZone: g.tz });
    const start = addDays(base, -((pd(base).getDay() + 6) % 7)), end = addDays(start, 6);
    const [ss, classes, staff] = await Promise.all([
      sessionsFor(g, start, end),
      sb.from('classes').select('*').eq('gym_id', g.id).order('start_time').then(must),
      sb.from('gym_staff').select('profile_id,role').eq('gym_id', g.id).then(must),
    ]);
    const ids = ss.map(s => s.id);
    const bk = ids.length ? must(await sb.from('bookings').select('session_id,status').in('session_id', ids).in('status', ['booked', 'attended', 'waitlist'])) : [];
    const names = await people(staff.map(s => s.profile_id).concat(ss.map(s => s.coach_id), classes.map(c => c.coach_id)));
    const coachOpts = [['', 'No coach'], ...staff.map(s => [s.profile_id, names.get(s.profile_id) || 'Coach'])];
    const days = [...Array(7)].map((_, i) => addDays(start, i));
    const cnt = id => bk.filter(b => b.session_id === id && b.status !== 'waitlist').length;
    const sessBtn = s => `<button type="button" class="scS${s.status === 'canceled' ? ' off' : ''}" data-s="${s.id}"><b>${tAt(s.starts_at, g.tz)}</b><span>${esc(s.name)}</span><small>${esc(s.coach_id ? names.get(s.coach_id) || 'Coach' : 'No coach')} · ${cnt(s.id)}/${s.capacity}</small></button>`;
    const classForm = c => `<form class="formCard scForm" data-c="${c ? c.id : ''}"><div class="formH">${c ? 'Edit class' : 'New weekly class'}</div><div class="fields">
        <div class="field w2"><label>Name</label><input data-k="name" maxlength="60" required value="${esc(c ? c.name : 'CrossFit')}"></div>
        <div class="field"><label>Start</label><input data-k="start_time" type="time" required value="${esc(c ? String(c.start_time).slice(0, 5) : '06:00')}"></div>
        <div class="field"><label>Minutes</label><input data-k="duration_min" type="number" min="10" max="300" value="${c ? c.duration_min : 60}"></div>
        <div class="field w4"><label>Days</label><div class="row">${DOW.map((d, i) => `<label class="tog"><input type="checkbox" data-day="${i}"${c ? (c.weekdays.includes(i) ? ' checked' : '') : (i >= 1 && i <= 5 ? ' checked' : '')}><span>${d}</span></label>`).join('')}</div></div>
        <div class="field"><label>Spots</label><input data-k="capacity" type="number" min="1" max="500" value="${c ? c.capacity : 16}"></div>
        <div class="field"><label>Coach</label><select data-k="coach_id">${opt(coachOpts, c ? c.coach_id || '' : '')}</select></div>
        ${c ? `<div class="field"><label>Running</label><select data-k="active">${opt([['true', 'Yes'], ['false', 'Paused']], String(c.active))}</select></div>` : ''}</div>
        <div class="row"><button class="btn sm">${c ? 'Save class' : 'Add class'}</button><span class="hint" data-msg>${c ? 'Changes rebuild upcoming classes nobody has booked.' : ''}</span></div></form>`;
    if (!paint(tok, shell(`<div class="row ckNav"><a class="btn ghost sm" href="/club/${g.id}?tab=schedule&week=${addDays(start, -7)}">← Last week</a><b>Week of ${esc(dayName(start, { month: 'long', day: 'numeric' }))}</b><a class="btn ghost sm" href="/club/${g.id}?tab=schedule&week=${addDays(start, 7)}">Next week →</a></div>
      <div class="scWeek">${days.map(d => `<div class="scDay"><h4>${esc(dayName(d, { weekday: 'short', day: 'numeric' }))}</h4>${ss.filter(s => dayOf(s.starts_at, g.tz) === d).map(sessBtn).join('') || '<p class="hint">No classes</p>'}</div>`).join('')}</div>
      <div id="scPanel"></div>
      ${owner ? `<h3 style="margin-top:28px">Weekly <span>classes</span></h3>
      <div class="board"><div class="tablewrap"><table><thead><tr><th>Class</th><th>Days</th><th>Time</th><th>Spots</th><th>Coach</th><th></th></tr></thead><tbody>
      ${classes.map(c => `<tr><td><b>${esc(c.name)}</b>${c.active ? '' : ' <span class="pill flat">Paused</span>'}</td><td>${c.weekdays.slice().sort().map(i => DOW[i]).join(' ')}</td><td>${hm(c.start_time)} · ${c.duration_min} min</td><td class="n">${c.capacity}</td><td>${esc(c.coach_id ? names.get(c.coach_id) || 'Coach' : '')}</td><td class="r"><button class="btn ghost sm" data-ec="${c.id}">Edit</button></td></tr><tr data-ecf="${c.id}" hidden><td colspan="6">${classForm(c)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No weekly classes yet. Add your first one below.</td></tr>'}
      </tbody></table></div></div>${classForm(null)}` : ''}`))) return;

    $$('.scS').forEach(b => b.onclick = () => {
      const s = ss.find(x => x.id === b.dataset.s);
      $('#scPanel').innerHTML = `<form class="formCard" id="spF"><div class="formH">${esc(s.name)} <span class="sub">${esc(dayName(dayOf(s.starts_at, g.tz)))} at ${tAt(s.starts_at, g.tz)} · ${cnt(s.id)} of ${s.capacity} booked</span></div><div class="fields">
        <div class="field"><label>Coach</label><select data-k="coach_id">${opt(coachOpts, s.coach_id || '')}</select></div>
        <div class="field"><label>Spots</label><input data-k="capacity" type="number" min="1" max="500" value="${s.capacity}"></div>
        <div class="field w2"><label>Note for members</label><input data-k="note" maxlength="200" value="${esc(s.note || '')}" placeholder="Like: partner workout, bring a jump rope"></div></div>
        <div class="row"><button class="btn sm">Save</button><button type="button" class="btn ghost sm" id="spCancel">${s.status === 'canceled' ? 'Put class back on' : 'Cancel this class'}</button><a class="btn ghost sm" href="/club/${g.id}?tab=today&day=${dayOf(s.starts_at, g.tz)}">Roster and check in</a></div></form>`;
      const f = $('#spF');
      f.onsubmit = async e => { e.preventDefault(); const v = k => $(`[data-k="${k}"]`, f).value; const { error } = await sb.from('sessions').update({ coach_id: v('coach_id') || null, capacity: +v('capacity') || s.capacity, note: v('note').trim() || null }).eq('id', s.id); if (error) return toast(error.message); toast('Class saved'); route(); };
      $('#spCancel').onclick = async () => { const { error } = await sb.from('sessions').update({ status: s.status === 'canceled' ? 'scheduled' : 'canceled' }).eq('id', s.id); if (error) return toast(error.message); toast(s.status === 'canceled' ? 'Class is back on' : 'Class canceled'); route(); };
      f.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    $$('[data-ec]').forEach(b => b.onclick = () => { const r = $(`[data-ecf="${b.dataset.ec}"]`); r.hidden = !r.hidden; });
    $$('.scForm').forEach(f => f.onsubmit = async e => {
      e.preventDefault();
      const v = k => { const el = $(`[data-k="${k}"]`, f); return el ? el.value : null; }, msg = $('[data-msg]', f);
      const weekdays = $$('[data-day]', f).filter(x => x.checked).map(x => +x.dataset.day);
      if (!weekdays.length) { msg.textContent = 'Pick at least one day.'; return; }
      const row = { gym_id: g.id, name: v('name').trim(), start_time: v('start_time'), duration_min: +v('duration_min') || 60, capacity: +v('capacity') || 16, coach_id: v('coach_id') || null, weekdays };
      if (v('active') != null) row.active = v('active') === 'true';
      const { error } = f.dataset.c ? await sb.from('classes').update(row).eq('id', f.dataset.c) : await sb.from('classes').insert(row);
      if (error) { msg.textContent = error.message; return; }
      toast(f.dataset.c ? 'Class saved' : 'Class added to the schedule'); route();
    });
  }

  /* ----- Members ----- */
  async function tabMembers(g, tok, shell, qs, owner) {
    const since = addDays(today(), -30);
    const [members, ms, docs, sigs, att, plans, inv] = await Promise.all([
      sb.from('profiles').select('id,display_name,created_at').eq('gym_id', g.id).not('display_name', 'is', null).order('display_name').then(must),
      sb.from('memberships').select('*').eq('gym_id', g.id).order('created_at', { ascending: false }).then(must),
      sb.from('gym_docs').select('id,kind,version').eq('gym_id', g.id).eq('active', true).then(must),
      sb.from('doc_signatures').select('id,doc_id,profile_id,kind,signed_at,signed_name').eq('gym_id', g.id).then(must),
      sb.from('bookings').select('profile_id,checked_in_at,session_id').eq('gym_id', g.id).eq('status', 'attended').order('checked_in_at', { ascending: false }).limit(2000).then(must),
      owner ? sb.from('plans').select('*').eq('gym_id', g.id).eq('active', true).order('price_cents').then(must) : [],
      owner ? sb.from('invoices').select('profile_id,amount_cents,status').eq('gym_id', g.id).eq('status', 'open').then(must) : [],
    ]);
    const cur = id => ms.find(m => m.profile_id === id && m.status !== 'canceled');
    const docId = k => (docs.find(d => d.kind === k) || {}).id;
    const signedDoc = (id, k) => !docId(k) || sigs.some(s => s.profile_id === id && s.doc_id === docId(k));
    const visits = id => att.filter(a => a.profile_id === id);
    const owed = id => inv.filter(i => i.profile_id === id).reduce((t, i) => t + i.amount_cents, 0);
    const q = (qs.get('q') || '').toLowerCase();
    const list = members.filter(m => !q || m.display_name.toLowerCase().includes(q));
    if (!paint(tok, shell(`<div class="row adSearch"><label class="vh" for="mq">Search members</label><input id="mq" placeholder="Search members" value="${esc(qs.get('q') || '')}" style="max-width:300px"><span class="hint">${list.length} of ${members.length} members. Members join by picking ${esc(g.name)} on the Gym league page.</span></div>
      <div class="board"><div class="tablewrap"><table class="adT"><thead><tr><th>Member</th><th>Membership</th><th>Waiver</th><th>Contract</th><th class="r">Visits 30 days</th><th>Last visit</th>${owner ? '<th class="r">Owes</th>' : ''}<th></th></tr></thead><tbody>
      ${list.map(m => { const c = cur(m.id), v = visits(m.id); return `<tr><td><b><a href="/u/${m.id}">${esc(m.display_name)}</a></b></td><td>${c ? `${esc(c.plan_name)} ${statusPill(c.status)}` : statusPill('')}</td>
        <td>${signedDoc(m.id, 'waiver') ? '<span class="pill up">Signed</span>' : '<span class="pill down">Missing</span>'}</td><td>${!docId('contract') ? '<span class="sub">none</span>' : signedDoc(m.id, 'contract') ? '<span class="pill up">Signed</span>' : '<span class="pill flat">Not yet</span>'}</td>
        <td class="r n">${v.filter(a => (a.checked_in_at || '') >= since).length}</td><td>${v[0] && v[0].checked_in_at ? esc(fmtD(v[0].checked_in_at.slice(0, 10))) : '<span class="sub">never</span>'}</td>
        ${owner ? `<td class="r n">${owed(m.id) ? `<b style="color:var(--down)">${money(owed(m.id))}</b>` : ''}</td>` : ''}<td class="r"><button class="btn ghost sm" data-md="${m.id}">Open</button></td></tr>
        <tr data-mdp="${m.id}" hidden><td colspan="${owner ? 8 : 7}"><div class="mdBox">Loading…</div></td></tr>`; }).join('') || `<tr><td colspan="8" class="empty">No members yet.</td></tr>`}
      </tbody></table></div></div>`))) return;
    $('#mq').onchange = e => go(`/club/${g.id}?tab=members&q=${encodeURIComponent(e.target.value.trim())}`);
    $$('[data-md]').forEach(b => b.onclick = async () => {
      const row = $(`[data-mdp="${b.dataset.md}"]`); row.hidden = !row.hidden; if (row.hidden) return;
      await memberDetail(g, b.dataset.md, $('.mdBox', row), { owner, plans, ms: ms.filter(m => m.profile_id === b.dataset.md), sigs: sigs.filter(s => s.profile_id === b.dataset.md), docs });
    });
  }

  async function memberDetail(g, pid, box, { owner, plans, ms, sigs, docs }) {
    const [det, att, inv] = await Promise.all([
      sb.from('member_details').select('*').eq('profile_id', pid).maybeSingle().then(r => r.data),
      sb.from('bookings').select('checked_in_at,session:sessions(name,starts_at)').eq('gym_id', g.id).eq('profile_id', pid).eq('status', 'attended').order('checked_in_at', { ascending: false }).limit(30).then(must),
      owner ? sb.from('invoices').select('*').eq('gym_id', g.id).eq('profile_id', pid).order('created_at', { ascending: false }).limit(50).then(must) : [],
    ]);
    const cur = ms.find(m => m.status !== 'canceled');
    box.innerHTML = `<div class="mdGrid">
      <div><h4>Contact</h4>${det ? `<p>${esc(det.legal_name || '')}<br>${esc(det.phone || '')}<br>${esc(det.email || '')}</p><p class="sub">Emergency: ${esc(det.emergency_name || 'not given')} ${esc(det.emergency_phone || '')}</p>` : '<p class="hint">They have not added contact details yet.</p>'}
        <h4>Documents</h4>${sigs.map(s => `<p>${s.kind === 'waiver' ? 'Waiver' : 'Contract'} v${(docs.find(d => d.id === s.doc_id) || {}).version || 'old'} · signed ${esc(fmtD(s.signed_at.slice(0, 10)))} as ${esc(s.signed_name)} <a href="/signed/${s.id}">View</a></p>`).join('') || '<p class="hint">Nothing signed yet.</p>'}</div>
      <div><h4>Attendance</h4>${att.length ? `<ol class="mdAtt">${att.map(a => `<li>${esc(a.session ? a.session.name : 'Class')} <span class="sub">${esc(a.session ? new Date(a.session.starts_at).toLocaleString('en-US', { timeZone: g.tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')}</span></li>`).join('')}</ol>` : '<p class="hint">No visits yet.</p>'}</div>
      ${owner ? `<div><h4>Membership</h4>${cur ? `<p><b>${esc(cur.plan_name)}</b> ${statusPill(cur.status)}<br><span class="sub">${money(cur.price_cents)} ${cur.interval === 'once' ? 'one time' : 'per ' + cur.interval}${cur.stripe_subscription ? ' · autopay' : ' · paid at the desk'} · since ${esc(fmtD(cur.start_date))}${cur.end_date ? ' · ends ' + esc(fmtD(cur.end_date)) : ''}</span></p><button class="btn ghost sm" data-endm="${cur.id}">${cur.stripe_subscription ? 'Stop autopay' : 'End membership'}</button>` : '<p class="hint">No membership.</p>'}
        <form class="row" data-addm style="margin-top:8px"><select data-plan style="max-width:220px">${opt([['', 'Add a membership paid at the desk…'], ...plans.map(p => [p.id, `${p.name} · ${money(p.price_cents)}`])], '')}</select><button class="btn sm">Add</button></form>
        <h4>Invoices</h4>${inv.map(i => `<div class="row mdInv"><span>#${i.number} ${esc(i.description)}</span><b>${money(i.amount_cents)}</b>${i.status === 'paid' ? `<span class="pill up">Paid ${i.method || ''}</span>` : i.status === 'void' ? '<span class="pill">Void</span>' : `<span class="pill down">Open</span><button class="btn ghost sm" data-paid="${i.id}">Mark paid</button><button class="btn ghost sm" data-void="${i.id}">Void</button>`}</div>`).join('') || '<p class="hint">No invoices.</p>'}
        <form class="row" data-addi style="margin-top:8px"><input data-d maxlength="200" placeholder="What for, like Drop in or T shirt" style="max-width:220px" required><input data-a inputmode="decimal" placeholder="$" style="max-width:90px" required><button class="btn sm">New invoice</button></form></div>` : ''}
    </div>`;
    const again = () => route();
    const am = $('[data-addm]', box);
    if (am) am.onsubmit = async e => { e.preventDefault(); const p = plans.find(x => x.id === $('[data-plan]', am).value); if (!p) return; const { data: m, error } = await sb.from('memberships').insert({ gym_id: g.id, profile_id: pid, plan_id: p.id, plan_name: p.name, price_cents: p.price_cents, interval: p.interval, status: 'active', note: 'Added by the gym, paid at the desk' }).select().single(); if (error) return toast(error.message); await sb.from('invoices').insert({ gym_id: g.id, profile_id: pid, membership_id: m.id, description: p.name, amount_cents: p.price_cents, created_by: S.me.id }); toast('Membership added with its first invoice'); again(); };
    const ai = $('[data-addi]', box);
    if (ai) ai.onsubmit = async e => { e.preventDefault(); const c = cents($('[data-a]', ai).value); if (!c) return toast('Enter an amount'); const { error } = await sb.from('invoices').insert({ gym_id: g.id, profile_id: pid, description: $('[data-d]', ai).value.trim(), amount_cents: c, created_by: S.me.id }); if (error) return toast(error.message); toast('Invoice created. The member can pay it from My gym.'); again(); };
    $$('[data-paid]', box).forEach(b => b.onclick = async () => { const { error } = await sb.from('invoices').update({ status: 'paid', paid_at: new Date().toISOString(), method: 'cash' }).eq('id', b.dataset.paid); if (error) return toast(error.message); toast('Marked paid'); again(); });
    $$('[data-void]', box).forEach(b => b.onclick = async () => { const { error } = await sb.from('invoices').update({ status: 'void' }).eq('id', b.dataset.void); if (error) return toast(error.message); toast('Invoice voided'); again(); });
    $$('[data-endm]', box).forEach(b => b.onclick = async () => { try { const r = await call('cancel', { membership: b.dataset.endm }); toast(r.ends === 'now' ? 'Membership ended' : 'Autopay stops ' + r.ends); } catch (e) { if (/not switched on/.test(e.message)) { const { error } = await sb.from('memberships').update({ status: 'canceled', end_date: today() }).eq('id', b.dataset.endm); if (error) return toast(error.message); toast('Membership ended'); } else return toast(e.message); } again(); });
  }

  /* ----- Billing ----- */
  async function tabBilling(g, tok, shell, qs) {
    const month = today().slice(0, 7);
    const [plans, ms, inv] = await Promise.all([
      sb.from('plans').select('*').eq('gym_id', g.id).order('price_cents').then(must),
      sb.from('memberships').select('*').eq('gym_id', g.id).then(must),
      sb.from('invoices').select('*').eq('gym_id', g.id).order('created_at', { ascending: false }).limit(500).then(must),
    ]);
    const names = await people(inv.map(i => i.profile_id).concat(ms.map(m => m.profile_id)));
    const live = ms.filter(m => ['active', 'past_due'].includes(m.status));
    const mrr = live.reduce((t, m) => t + (m.interval === 'month' ? m.price_cents : m.interval === 'year' ? Math.round(m.price_cents / 12) : 0), 0);
    const paidMonth = inv.filter(i => i.status === 'paid' && (i.paid_at || '').slice(0, 7) === month).reduce((t, i) => t + i.amount_cents, 0);
    const open = inv.filter(i => i.status === 'open'), openSum = open.reduce((t, i) => t + i.amount_cents, 0);
    const filt = ['open', 'paid', 'all'].includes(qs.get('show')) ? qs.get('show') : 'open';
    const shown = inv.filter(i => filt === 'all' || i.status === filt);
    const desk = live.filter(m => !m.stripe_subscription && m.interval !== 'once' && !inv.some(i => i.membership_id === m.id && i.created_at.slice(0, 7) === month));
    const ret = qs.get('stripe');
    const proReady = plans.length > 0 && 'includes_pro' in plans[0];
    const proPlan = new Set(plans.filter(p => p.includes_pro).map(p => p.id));
    const seats = new Set(ms.filter(m => m.status === 'active' && proPlan.has(m.plan_id)).map(m => m.profile_id)).size;
    if (!paint(tok, shell(`<div class="adStats">
        <div class="adStat"><span>Collected in ${esc(new Date().toLocaleDateString('en-US', { month: 'long' }))}</span><b>${money(paidMonth)}</b><small>paid invoices</small></div>
        <div class="adStat"><span>Owed</span><b>${money(openSum)}</b><small>${open.length} open invoice${open.length === 1 ? '' : 's'}</small></div>
        <div class="adStat"><span>Members</span><b>${live.length}</b><small>${live.filter(m => m.status === 'past_due').length} past due</small></div>
        <div class="adStat"><span>Monthly revenue</span><b>${money(mrr)}</b><small>from memberships</small></div>
        <div class="adStat"><span>DSI Pro seats</span><b>${seats}</b><small>${money(seats * PRO_SEAT_CENTS)} a month at $4 a seat</small></div></div>
      <div class="formCard" style="margin-top:20px"><div class="formH">Card payments <span class="sub">${g.stripe_ready ? 'On. Members pay invoices and start autopay memberships online. Money goes to your Stripe account.' : g.stripe_account ? 'Stripe is connected but not finished. Finish the Stripe setup to take cards.' : 'Connect a Stripe account so members can pay by card and set up autopay.'}</span></div>
        <div class="row"><button class="btn sm" id="stConnect">${g.stripe_ready ? 'Open Stripe setup' : g.stripe_account ? 'Finish Stripe setup' : 'Connect Stripe'}</button>${g.stripe_account ? '<button class="btn ghost sm" id="stCheck">Check status</button>' : ''}<span class="hint" id="stMsg">${ret === 'done' ? 'Back from Stripe. Checking…' : ''}</span></div></div>
      <h3 style="margin-top:28px">Membership <span>plans</span></h3>
      <div class="board"><div class="tablewrap"><table><thead><tr><th>Plan</th><th class="r">Price</th><th>Billing</th><th>Commitment</th><th>DSI Pro</th><th class="r">Members</th><th></th></tr></thead><tbody>
      ${plans.map(p => `<tr><td><b>${esc(p.name)}</b>${p.active ? '' : ' <span class="pill">Hidden</span>'}<div class="sub">${esc(p.description || '')}</div></td><td class="r n">${money(p.price_cents)}</td><td>${{ month: 'Monthly autopay', year: 'Yearly autopay', once: 'One payment' }[p.interval]}</td><td>${p.commitment_months ? p.commitment_months + ' months' : 'None'}</td><td>${p.includes_pro ? '<span class="pill acc">Included</span> ' : ''}${proReady ? '' : '<span class="sub">Coming soon</span>'}<button${proReady ? '' : ' hidden'} class="btn ghost sm" data-pro="${p.id}" data-on="${p.includes_pro ? 0 : 1}">${p.includes_pro ? 'Remove' : 'Include Pro'}</button></td><td class="r n">${live.filter(m => m.plan_id === p.id).length}</td><td class="r"><button class="btn ghost sm" data-hide="${p.id}" data-on="${p.active ? 0 : 1}">${p.active ? 'Hide' : 'Offer again'}</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No plans yet. Add one below, like Unlimited at $175 a month.</td></tr>'}
      </tbody></table></div></div>
      <form class="formCard" id="plF" style="margin-top:12px"><div class="formH">New plan</div><div class="fields">
        <div class="field w2"><label for="pl-n">Name</label><input id="pl-n" maxlength="60" required placeholder="Unlimited"></div>
        <div class="field"><label for="pl-p">Price</label><input id="pl-p" inputmode="decimal" required placeholder="$175"></div>
        <div class="field"><label for="pl-i">Billing</label><select id="pl-i">${opt([['month', 'Monthly autopay'], ['year', 'Yearly autopay'], ['once', 'One payment (drop in, punch card)']], 'month')}</select></div>
        <div class="field"><label for="pl-c">Commitment months</label><input id="pl-c" type="number" min="0" max="36" value="0"></div>
        <div class="field w3"><label for="pl-d">Description</label><input id="pl-d" maxlength="300" placeholder="All classes, open gym, DSI Pro included"></div>
        <div class="field w4"${proReady ? '' : ' hidden'}><label class="check"><input type="checkbox" id="pl-pro"><span>Includes DSI Pro. Members on this plan get Pro while it is active, and your gym pays $4 a member a month.</span></label></div></div>
        <div class="row"><button class="btn sm">Add plan</button><span class="hint">Price changes apply to new members. Existing autopay keeps its price.</span></div></form>
      <div class="secHead" style="margin-top:28px"><h3>Invoices</h3><div class="row">${[['open', 'Open'], ['paid', 'Paid'], ['all', 'All']].map(([k, n]) => `<a class="chip" href="/club/${g.id}?tab=billing&show=${k}" aria-pressed="${filt === k}">${n}</a>`).join('')}<button class="btn ghost sm" id="invCsv">Download CSV</button>${desk.length ? `<button class="btn sm" id="billDesk">Bill ${desk.length} desk membership${desk.length === 1 ? '' : 's'} for ${esc(new Date().toLocaleDateString('en-US', { month: 'long' }))}</button>` : ''}</div></div>
      <div class="board"><div class="tablewrap"><table><thead><tr><th>#</th><th>Member</th><th>For</th><th class="r">Amount</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>
      ${shown.map(i => `<tr><td class="n">${i.number}</td><td>${esc(names.get(i.profile_id) || 'Member')}</td><td>${esc(i.description)}</td><td class="r n">${money(i.amount_cents)}</td><td>${esc(fmtD(i.due_date))}</td><td>${i.status === 'paid' ? `<span class="pill up">Paid</span> <span class="sub">${esc(i.method || '')} ${i.paid_at ? esc(fmtD(i.paid_at.slice(0, 10))) : ''}</span>` : i.status === 'void' ? '<span class="pill">Void</span>' : '<span class="pill down">Open</span>'}</td>
        <td class="r">${i.status === 'open' ? `<button class="btn ghost sm" data-paid="${i.id}">Mark paid</button> <button class="btn ghost sm" data-void="${i.id}">Void</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nothing here.</td></tr>'}
      </tbody></table></div></div>`))) return;
    const stMsg = $('#stMsg');
    const check = async () => { try { const r = await call('status', { gym: g.id }); stMsg.textContent = r.ready ? 'Card payments are on.' : r.connected ? 'Stripe still needs a few details. Click Finish Stripe setup.' : 'Not connected yet.'; if (r.ready !== g.stripe_ready) route(); } catch (e) { stMsg.textContent = e.message; } };
    if (ret === 'done') check();
    $('#stConnect').onclick = async () => { stMsg.textContent = 'Opening Stripe…'; try { const r = await call('connect', { gym: g.id }); location.href = r.url; } catch (e) { stMsg.textContent = e.message; } };
    if ($('#stCheck')) $('#stCheck').onclick = check;
    $('#plF').onsubmit = async e => { e.preventDefault(); const price = cents($('#pl-p').value); const { error } = await sb.from('plans').insert({ gym_id: g.id, name: $('#pl-n').value.trim(), price_cents: price, interval: $('#pl-i').value, commitment_months: +$('#pl-c').value || 0, description: $('#pl-d').value.trim() || null, ...(proReady && $('#pl-pro').checked ? { includes_pro: true } : {}) }); if (error) return toast(error.message); toast('Plan added'); route(); };
    $$('[data-pro]').forEach(b => b.onclick = async () => { const on = b.dataset.on === '1'; const { error } = await sb.from('plans').update({ includes_pro: on }).eq('id', b.dataset.pro); if (error) return toast(error.message); toast(on ? 'DSI Pro is now included. Members on this plan get Pro.' : 'DSI Pro removed from this plan.'); route(); });
    $$('[data-hide]').forEach(b => b.onclick = async () => { const { error } = await sb.from('plans').update({ active: b.dataset.on === '1' }).eq('id', b.dataset.hide); if (error) return toast(error.message); route(); });
    $$('[data-paid]').forEach(b => b.onclick = async () => { const { error } = await sb.from('invoices').update({ status: 'paid', paid_at: new Date().toISOString(), method: 'cash' }).eq('id', b.dataset.paid); if (error) return toast(error.message); toast('Marked paid'); route(); });
    $$('[data-void]').forEach(b => b.onclick = async () => { const { error } = await sb.from('invoices').update({ status: 'void' }).eq('id', b.dataset.void); if (error) return toast(error.message); toast('Invoice voided'); route(); });
    $('#invCsv').onclick = () => csv(`${g.name} invoices.csv`, [['Number', 'Member', 'For', 'Amount', 'Due', 'Status', 'Method', 'Paid'], ...shown.map(i => [i.number, names.get(i.profile_id) || '', i.description, (i.amount_cents / 100).toFixed(2), i.due_date, i.status, i.method || '', i.paid_at ? i.paid_at.slice(0, 10) : ''])]);
    if ($('#billDesk')) $('#billDesk').onclick = async () => {
      const mon = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const { error } = await sb.from('invoices').insert(desk.map(m => ({ gym_id: g.id, profile_id: m.profile_id, membership_id: m.id, description: `${m.plan_name} (${mon})`, amount_cents: m.price_cents, created_by: S.me.id })));
      if (error) return toast(error.message); toast(`${desk.length} invoice${desk.length === 1 ? '' : 's'} created`); route();
    };
  }

  /* ----- Waivers and contracts ----- */
  async function tabDocs(g, tok, shell) {
    const [docs, sigs, members] = await Promise.all([
      sb.from('gym_docs').select('*').eq('gym_id', g.id).order('version', { ascending: false }).then(must),
      sb.from('doc_signatures').select('id,doc_id,profile_id,kind,signed_name,signed_at').eq('gym_id', g.id).order('signed_at', { ascending: false }).then(must),
      sb.from('profiles').select('id').eq('gym_id', g.id).not('display_name', 'is', null).then(must),
    ]);
    const names = await people(sigs.map(s => s.profile_id));
    const box = kind => {
      const curDoc = docs.find(d => d.kind === kind && d.active), all = docs.filter(d => d.kind === kind), st = STARTERS[kind];
      const onCur = curDoc ? sigs.filter(s => s.doc_id === curDoc.id) : [];
      return `<form class="formCard docEd" data-kind="${kind}"><div class="formH">${kind === 'waiver' ? 'Waiver and general release' : 'Membership contract'} <span class="sub">${curDoc ? `Version ${curDoc.version} · ${onCur.length} of ${members.length} members signed` : 'Not set up yet'}</span></div>
        <div class="field"><label>Title</label><input data-t maxlength="120" value="${esc(curDoc ? curDoc.title : st.title)}"></div>
        <div class="field"><label>Text</label><textarea data-b rows="16" maxlength="40000">${esc(curDoc ? curDoc.body : st.body)}</textarea></div>
        <p class="hint">${curDoc ? '' : 'This is the DSI starter. '}Have your lawyer review it before members sign. Saving creates a new version; members sign the newest one${kind === 'waiver' ? ' before they can book classes' : ' when they start a membership'}. These fill in when a member signs: {{gym}} {{gym_address}} {{member}} {{date}}${kind === 'contract' ? ' {{plan}} {{price}} {{interval}} {{commitment}}' : ''}.</p>
        <div class="row"><button class="btn sm">${curDoc ? 'Save as a new version' : 'Start using it'}</button>${curDoc ? '<button type="button" class="btn ghost sm" data-starter>Load the DSI starter</button>' : ''}<a class="btn ghost sm" href="/sign/${kind}?gym=${g.id}&preview=1" target="_blank">Preview as a member</a><span class="hint" data-msg></span></div>
        ${all.length > 1 ? `<p class="sub">Older versions: ${all.filter(d => !d.active).map(d => `v${d.version} (${sigs.filter(s => s.doc_id === d.id).length} signed)`).join(', ')}</p>` : ''}
        <details><summary>Signatures (${sigs.filter(s => s.kind === kind).length})</summary><table class="adT"><tbody>${sigs.filter(s => s.kind === kind).map(s => `<tr><td>${esc(names.get(s.profile_id) || 'Member')}</td><td>${esc(s.signed_name)}</td><td>v${(docs.find(d => d.id === s.doc_id) || {}).version}</td><td>${esc(fmtD(s.signed_at.slice(0, 10)))}</td><td class="r"><a class="btn ghost sm" href="/signed/${s.id}">View</a></td></tr>`).join('') || '<tr><td class="empty">Nobody yet.</td></tr>'}</tbody></table></details></form>`;
    };
    if (!paint(tok, shell(`<div class="docGrid">${box('waiver')}${box('contract')}</div>`))) return;
    $$('.docEd').forEach(f => {
      const kind = f.dataset.kind;
      const st = $('[data-starter]', f); if (st) st.onclick = () => { $('[data-t]', f).value = STARTERS[kind].title; $('[data-b]', f).value = STARTERS[kind].body; };
      f.onsubmit = async e => { e.preventDefault(); const msg = $('[data-msg]', f); const { error } = await sb.from('gym_docs').insert({ gym_id: g.id, kind, title: $('[data-t]', f).value.trim(), body: $('[data-b]', f).value.trim() }); if (error) { msg.textContent = error.message; return; } toast('Saved. Members sign this version from now on.'); route(); };
    });
  }

  /* ----- Staff: pay, availability, swaps, hours ----- */
  async function tabStaff(g, tok, shell, qs, owner) {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(qs.get('from') || '') ? qs.get('from') : today().slice(0, 8) + '01';
    const to = /^\d{4}-\d{2}-\d{2}$/.test(qs.get('to') || '') ? qs.get('to') : today();
    const [staff, avail, swaps, mine, coached] = await Promise.all([
      sb.from('gym_staff').select('*').eq('gym_id', g.id).then(must),
      sb.from('coach_availability').select('*').eq('gym_id', g.id).order('weekday').order('start_time').then(must),
      sb.from('swap_requests').select('*,session:sessions(name,starts_at)').eq('gym_id', g.id).eq('status', 'open').order('created_at').then(must),
      sb.from('sessions').select('*').eq('gym_id', g.id).eq('coach_id', S.me.id).eq('status', 'scheduled').gte('starts_at', new Date().toISOString()).order('starts_at').limit(14).then(must),
      sb.from('sessions').select('coach_id,starts_at,ends_at').eq('gym_id', g.id).eq('status', 'scheduled').gte('starts_at', from + 'T00:00:00Z').lt('starts_at', addDays(to, 1) + 'T06:00:00Z').lt('starts_at', new Date().toISOString()).then(must),
    ]);
    const names = await people(staff.map(s => s.profile_id).concat(swaps.map(s => s.from_coach)));
    const nm = id => names.get(id) || 'Coach';
    const pay = staff.map(s => { const c = coached.filter(x => x.coach_id === s.profile_id && dayOf(x.starts_at, g.tz) >= from && dayOf(x.starts_at, g.tz) <= to); const hrs = c.reduce((t, x) => t + (Date.parse(x.ends_at) - Date.parse(x.starts_at)) / 36e5, 0); return { s, classes: c.length, hrs, owed: num(s.pay_rate) * (s.pay_type === 'hour' ? hrs : c.length) }; });
    const fmtHrs = h => (Math.round(h * 100) / 100).toString();
    const sw = swaps.map(r => `<div class="row swRow"><span><b>${esc(r.session ? r.session.name : 'Class')}</b> ${esc(r.session ? new Date(r.session.starts_at).toLocaleString('en-US', { timeZone: g.tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')} · from ${esc(nm(r.from_coach))}${r.to_coach ? ' to ' + esc(nm(r.to_coach)) : ' to anyone'}${r.note ? ` <span class="sub">"${esc(r.note)}"</span>` : ''}</span>
      ${r.from_coach !== S.me.id && (!r.to_coach || r.to_coach === S.me.id) ? `<button class="btn sm" data-take="${r.id}">Take it</button>` : ''}${r.from_coach === S.me.id || owner ? `<button class="btn ghost sm" data-csw="${r.id}">Cancel</button>` : ''}</div>`).join('');
    if (!paint(tok, shell(`<div class="stGrid">
      <div><h3>Swaps</h3>${sw || '<p class="hint">No open swaps.</p>'}
        <h3 style="margin-top:20px">Your next <span>classes</span></h3>${mine.map(s => `<form class="row swRow" data-sw="${s.id}"><span><b>${esc(s.name)}</b> ${esc(new Date(s.starts_at).toLocaleString('en-US', { timeZone: g.tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</span><select data-to style="max-width:160px">${opt([['', 'Any coach'], ...staff.filter(x => x.profile_id !== S.me.id).map(x => [x.profile_id, nm(x.profile_id)])], '')}</select><input data-note maxlength="200" placeholder="Note" style="max-width:150px"><button class="btn ghost sm">Ask for a swap</button></form>`).join('') || '<p class="hint">You are not on any upcoming classes.</p>'}
        <h3 style="margin-top:20px">When you can <span>coach</span></h3>
        ${avail.filter(a => a.profile_id === S.me.id).map(a => `<div class="row swRow"><span>${DOW[a.weekday]} ${hm(a.start_time)} to ${hm(a.end_time)}</span><button class="btn ghost sm" data-rma="${a.id}">Remove</button></div>`).join('') || '<p class="hint">Add the times you are free to coach.</p>'}
        <form class="row" id="avF"><select id="av-d" style="max-width:110px">${opt(DOW.map((d, i) => [i, d]), 1)}</select><input id="av-s" type="time" value="05:00" style="max-width:130px"><input id="av-e" type="time" value="09:00" style="max-width:130px"><button class="btn sm">Add</button></form></div>
      <div><h3>Coaches</h3><div class="board"><div class="tablewrap"><table><thead><tr><th>Coach</th><th>Available</th>${owner ? '<th>Pay</th>' : ''}</tr></thead><tbody>
        ${staff.map(s => `<tr><td><b>${esc(nm(s.profile_id))}</b>${s.role === 'owner' ? ' <span class="pill acc">Owner</span>' : ''}</td><td class="sub">${avail.filter(a => a.profile_id === s.profile_id).map(a => `${DOW[a.weekday]} ${hm(a.start_time)}–${hm(a.end_time)}`).join(', ') || 'not set'}</td>
        ${owner ? `<td><form class="row" data-pay="${s.profile_id}"><input data-rate inputmode="decimal" value="${s.pay_rate != null ? num(s.pay_rate) : ''}" placeholder="$" style="max-width:80px"><select data-type style="max-width:120px">${opt([['class', 'per class'], ['hour', 'per hour']], s.pay_type)}</select><button class="btn ghost sm">Save</button></form></td>` : ''}</tr>`).join('')}
        </tbody></table></div></div><p class="hint">Owners add coaches on the <a href="/gym/${g.id}">gym page</a>.</p>
        ${owner ? `<h3 style="margin-top:20px">Hours and <span>pay</span></h3><form class="row" id="hpF"><input type="date" id="hp-f" value="${from}" style="max-width:170px"><span>to</span><input type="date" id="hp-t" value="${to}" style="max-width:170px"><button class="btn ghost sm">Show</button><button type="button" class="btn ghost sm" id="hpCsv">Download CSV</button></form>
        <div class="board"><div class="tablewrap"><table><thead><tr><th>Coach</th><th class="r">Classes</th><th class="r">Hours</th><th class="r">Rate</th><th class="r">Pay</th></tr></thead><tbody>
        ${pay.map(p => `<tr><td>${esc(nm(p.s.profile_id))}</td><td class="r n">${p.classes}</td><td class="r n">${fmtHrs(p.hrs)}</td><td class="r n">${p.s.pay_rate != null ? '$' + num(p.s.pay_rate) + ' per ' + p.s.pay_type : '<span class="sub">not set</span>'}</td><td class="r n"><b>$${p.owed.toFixed(2)}</b></td></tr>`).join('')}
        <tr><td><b>Total</b></td><td class="r n">${pay.reduce((t, p) => t + p.classes, 0)}</td><td class="r n">${fmtHrs(pay.reduce((t, p) => t + p.hrs, 0))}</td><td></td><td class="r n"><b>$${pay.reduce((t, p) => t + p.owed, 0).toFixed(2)}</b></td></tr></tbody></table></div></div>
        <p class="hint">Counts classes that already happened, were not canceled, and had the coach on them.</p>` : ''}</div></div>`))) return;
    $$('[data-take]').forEach(b => b.onclick = async () => { try { await rpc('take_swap', { p_id: b.dataset.take }); toast('The class is yours'); route(); } catch (e) { toast(e.message); } });
    $$('[data-csw]').forEach(b => b.onclick = async () => { try { await rpc('cancel_swap', { p_id: b.dataset.csw }); route(); } catch (e) { toast(e.message); } });
    $$('[data-sw]').forEach(f => f.onsubmit = async e => { e.preventDefault(); try { await rpc('request_swap', { p_session: f.dataset.sw, p_to: $('[data-to]', f).value || null, p_note: $('[data-note]', f).value.trim() || null }); toast('Swap request sent'); route(); } catch (err) { toast(err.message); } });
    $$('[data-rma]').forEach(b => b.onclick = async () => { const { error } = await sb.from('coach_availability').delete().eq('id', b.dataset.rma); if (error) return toast(error.message); route(); });
    $('#avF').onsubmit = async e => { e.preventDefault(); const { error } = await sb.from('coach_availability').insert({ gym_id: g.id, profile_id: S.me.id, weekday: +$('#av-d').value, start_time: $('#av-s').value, end_time: $('#av-e').value }); if (error) return toast(/end_time/.test(error.message) ? 'End after the start time.' : error.message); route(); };
    $$('[data-pay]').forEach(f => f.onsubmit = async e => { e.preventDefault(); const r = $('[data-rate]', f).value.trim(); const { error } = await sb.from('gym_staff').update({ pay_rate: r ? parseFloat(r.replace(/[^0-9.]/g, '')) : null, pay_type: $('[data-type]', f).value }).eq('gym_id', g.id).eq('profile_id', f.dataset.pay); if (error) return toast(error.message); toast('Pay saved'); route(); });
    const hp = $('#hpF');
    if (hp) {
      hp.onsubmit = e => { e.preventDefault(); go(`/club/${g.id}?tab=staff&from=${$('#hp-f').value}&to=${$('#hp-t').value}`); };
      $('#hpCsv').onclick = () => csv(`${g.name} coach pay ${from} to ${to}.csv`, [['Coach', 'Classes', 'Hours', 'Rate', 'Per', 'Pay'], ...pay.map(p => [nm(p.s.profile_id), p.classes, fmtHrs(p.hrs), p.s.pay_rate ?? '', p.s.pay_type, p.owed.toFixed(2)])]);
    }
  }

  /* =================================================================
     MEMBERS
     ================================================================= */
  const myGymOr = async tok => {
    if (!S.me) { needLogin(tok, 'see your gym'); return null; }
    if (!S.me.gym_id) { paint(tok, '<section class="prEmpty"><b>Pick your gym first</b><p>Find your gym on the Gym league page and join it. Then you can book classes and manage your membership here.</p><p><a class="btn" href="/gyms">Gym league</a></p></section>'); return null; }
    return gymById(S.me.gym_id);
  };

  VIEWS.classes = async (_, tok) => {
    const g = await myGymOr(tok); if (!g) return;
    const from = new Date().toLocaleDateString('en-CA', { timeZone: g.tz }), to = addDays(from, 6);
    const [ss, signed] = await Promise.all([sessionsFor(g, from, to), rpc('has_signed', { p_gym: g.id, p_kind: 'waiver' }).catch(() => true)]);
    const ids = ss.map(s => s.id);
    const bk = ids.length ? must(await sb.from('bookings').select('session_id,profile_id,status').in('session_id', ids).neq('status', 'canceled')) : [];
    const coach = await people(ss.map(s => s.coach_id));
    const sel = new URLSearchParams(location.search).get('day') || from;
    const days = [...Array(7)].map((_, i) => addDays(from, i));
    const list = ss.filter(s => dayOf(s.starts_at, g.tz) === sel && s.ends_at > new Date().toISOString());
    const mineOn = id => (bk.find(b => b.session_id === id && b.profile_id === S.me.id) || {}).status;
    if (!paint(tok, `<section class="sec"><div class="secHead"><div><div class="kicker">${esc(g.name)}</div><h2>Book a <span>class</span></h2></div><a class="btn ghost sm" href="/mygym">My gym</a></div>
      ${signed ? '' : `<div class="formCard warnCard"><b>Sign the waiver to book classes.</b> <a class="btn sm" href="/sign/waiver?gym=${g.id}&next=/classes">Sign the waiver</a></div>`}
      <nav class="wkDays" aria-label="Days">${days.map(d => `<a class="wd${d === sel ? ' on' : ''}" href="/classes?day=${d}"${d === sel ? ' aria-current="date"' : ''}><span>${pd(d).toLocaleDateString('en-US', { weekday: 'short' })}</span><b>${pd(d).getDate()}</b>${ss.some(s => dayOf(s.starts_at, g.tz) === d && mineOn(s.id) && mineOn(s.id) !== 'canceled') ? '<i title="Booked">✓</i>' : ''}</a>`).join('')}</nav></section>
      <section class="sec"><div class="clList">${list.map(s => {
        const n = bk.filter(b => b.session_id === s.id && b.status !== 'waitlist').length, wl = bk.filter(b => b.session_id === s.id && b.status === 'waitlist').length, mine = mineOn(s.id), left = s.capacity - n;
        return `<article class="clRow${s.status === 'canceled' ? ' off' : ''}"><div class="clT"><b>${tAt(s.starts_at, g.tz)}</b><span>${Math.round((Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 6e4)} min</span></div>
          <div class="clI"><b>${esc(s.name)}</b><span>${esc(s.coach_id ? 'Coach ' + (coach.get(s.coach_id) || '') : '')}${s.note ? ' · ' + esc(s.note) : ''}</span></div>
          <div class="clS">${s.status === 'canceled' ? '<span class="pill down">Canceled</span>' : left > 0 ? `<span>${left} spot${left === 1 ? '' : 's'} left</span>` : `<span>Full${wl ? ` · ${wl} waiting` : ''}</span>`}</div>
          <div class="clA">${s.status === 'canceled' ? '' : mine === 'booked' ? '<span class="pill up">Booked</span><button class="btn ghost sm" data-cx="' + s.id + '">Cancel</button>' : mine === 'waitlist' ? '<span class="pill flat">Waitlist</span><button class="btn ghost sm" data-cx="' + s.id + '">Leave</button>' : mine === 'attended' ? '<span class="pill up">Checked in</span>' : `<button class="btn sm" data-bk="${s.id}"${signed ? '' : ' disabled'}>${left > 0 ? 'Book' : 'Join waitlist'}</button>`}</div></article>`;
      }).join('') || `<div class="prEmpty"><b>No classes ${sel === from ? 'left today' : 'this day'}</b><p>Pick another day above.</p></div>`}</div></section>`)) return;
    $$('[data-bk]').forEach(b => b.onclick = async () => { b.disabled = true; try { const st = await rpc('book_session', { p_session: b.dataset.bk }); toast(st === 'waitlist' ? 'You are on the waitlist. We move you in if a spot opens.' : 'Booked. See you there.'); route(); } catch (e) { toast(e.message); b.disabled = false; } });
    $$('[data-cx]').forEach(b => b.onclick = async () => { try { await rpc('cancel_booking', { p_session: b.dataset.cx }); toast('Canceled'); route(); } catch (e) { toast(e.message); } });
  };

  VIEWS.mygym = async (_, tok) => {
    const g = await myGymOr(tok); if (!g) return;
    const qs = new URLSearchParams(location.search);
    const [plans, ms, inv, docs, sigs, att, det] = await Promise.all([
      sb.from('plans').select('*').eq('gym_id', g.id).eq('active', true).order('price_cents').then(must),
      sb.from('memberships').select('*').eq('gym_id', g.id).eq('profile_id', S.me.id).order('created_at', { ascending: false }).then(must),
      sb.from('invoices').select('*').eq('gym_id', g.id).eq('profile_id', S.me.id).order('created_at', { ascending: false }).then(must),
      sb.from('gym_docs').select('id,kind,title,version').eq('gym_id', g.id).eq('active', true).then(must),
      sb.from('doc_signatures').select('id,doc_id,kind,signed_at,context').eq('profile_id', S.me.id).eq('gym_id', g.id).order('signed_at', { ascending: false }).then(must),
      sb.from('bookings').select('status,checked_in_at,session:sessions(name,starts_at)').eq('profile_id', S.me.id).eq('gym_id', g.id).in('status', ['attended', 'booked', 'waitlist']).order('created_at', { ascending: false }).limit(60).then(must),
      sb.from('member_details').select('*').eq('profile_id', S.me.id).maybeSingle().then(r => r.data),
    ]);
    const cur = ms.find(m => m.status !== 'canceled');
    const doc = k => docs.find(d => d.kind === k), sigOn = k => doc(k) && sigs.find(s => s.doc_id === doc(k).id);
    const visits = att.filter(a => a.status === 'attended'), upcoming = att.filter(a => a.status !== 'attended' && a.session && a.session.starts_at > new Date().toISOString());
    const monthKey = new Date().toISOString().slice(0, 7);
    const open = inv.filter(i => i.status === 'open');
    const when = iso => new Date(iso).toLocaleString('en-US', { timeZone: g.tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const joinBtn = p => (doc('contract') && !(sigOn('contract') && sigOn('contract').context && sigOn('contract').context.plan_id === p.id)) ? `<a class="btn sm" href="/sign/contract?gym=${g.id}&plan=${p.id}">Sign and join</a>` : `<button class="btn sm" data-join="${p.id}">Join</button>`;
    if (!paint(tok, `<section class="sec"><div class="secHead"><div><div class="kicker">${esc(g.city || '')}</div><h2>${esc(g.name)}</h2></div><div class="row"><a class="btn sm" href="/classes">Book a class</a></div></div>
      ${qs.get('paid') ? '<div class="formCard okCard"><b>Payment received.</b> Thank you. It shows here once the card clears.</div>' : ''}${qs.get('joined') ? '<div class="formCard okCard"><b>Welcome in.</b> Your membership starts as soon as Stripe confirms the payment.</div>' : ''}
      <div class="myGrid">
        <div class="formCard"><div class="formH">Membership</div>
          ${cur ? `<p><b>${esc(cur.plan_name)}</b> ${statusPill(cur.status)}<br><span class="sub">${money(cur.price_cents)} ${cur.interval === 'once' ? 'one time' : 'per ' + cur.interval}${cur.stripe_subscription ? ' · autopay' : ''} · since ${esc(fmtD(cur.start_date))}${cur.end_date ? ' · ends ' + esc(fmtD(cur.end_date)) : ''}</span></p>
            ${cur.stripe_customer ? '<div class="row"><button class="btn ghost sm" id="portal">Card and autopay</button></div>' : ''}`
            : plans.length ? `<p class="hint">Pick a membership. ${g.stripe_ready ? 'Pay by card, with autopay for monthly plans.' : 'Ask the front desk to set it up and pay there.'}</p>${plans.map(p => `<div class="plRow"><div><b>${esc(p.name)}</b>${p.includes_pro ? ' <span class="pill acc">DSI Pro included</span>' : ''}<span class="sub">${esc(p.description || '')}${p.commitment_months ? ` · ${p.commitment_months} month commitment` : ''}</span></div><b>${money(p.price_cents)}<small>${p.interval === 'once' ? '' : '/' + (p.interval === 'month' ? 'mo' : 'yr')}</small></b>${g.stripe_ready ? joinBtn(p) : ''}</div>`).join('')}` : '<p class="hint">Ask the front desk about memberships.</p>'}
        </div>
        <div class="formCard"><div class="formH">Documents</div>
          ${['waiver', 'contract'].filter(k => doc(k)).map(k => { const s = sigOn(k); return `<div class="plRow"><div><b>${esc(doc(k).title)}</b><span class="sub">${s ? 'Signed ' + esc(fmtD(s.signed_at.slice(0, 10))) : k === 'waiver' ? 'Needed before you book a class' : 'Signed when you start a membership'}</span></div>${s ? `<a class="btn ghost sm" href="/signed/${s.id}">View</a>` : k === 'waiver' ? `<a class="btn sm" href="/sign/waiver?gym=${g.id}">Sign</a>` : ''}</div>`; }).join('') || '<p class="hint">Nothing to sign.</p>'}
        </div>
        <div class="formCard"><div class="formH">Invoices ${open.length ? `<span class="pill down">${open.length} open</span>` : ''}</div>
          ${inv.slice(0, 12).map(i => `<div class="plRow"><div><b>${esc(i.description)}</b><span class="sub">#${i.number} · ${i.status === 'paid' ? 'paid ' + esc(fmtD((i.paid_at || i.created_at).slice(0, 10))) : i.status === 'void' ? 'void' : 'due ' + esc(fmtD(i.due_date))}</span></div><b>${money(i.amount_cents)}</b>${i.status === 'open' ? (g.stripe_ready ? `<button class="btn sm" data-pay="${i.id}">Pay</button>` : '<span class="pill down">Pay at desk</span>') : i.status === 'paid' ? '<span class="pill up">Paid</span>' : ''}</div>`).join('') || '<p class="hint">No invoices yet.</p>'}
        </div>
        <div class="formCard" id="attendance"><div class="formH">Attendance <span class="sub">${visits.filter(a => (a.checked_in_at || '').slice(0, 7) === monthKey).length} this month · ${visits.length} logged</span></div>
          ${upcoming.length ? `<p class="sub">Coming up: ${upcoming.slice(0, 3).map(a => `${esc(a.session.name)} ${esc(when(a.session.starts_at))}${a.status === 'waitlist' ? ' (waitlist)' : ''}`).join(' · ')}</p>` : ''}
          <ol class="mdAtt">${visits.slice(0, 20).map(a => `<li>${esc(a.session ? a.session.name : 'Class')} <span class="sub">${a.session ? esc(when(a.session.starts_at)) : ''}</span></li>`).join('') || '<li class="hint">No visits yet. Coaches check you in at class.</li>'}</ol>
        </div>
        <form class="formCard" id="mdF"><div class="formH">Your details <span class="sub">Only you and ${esc(g.name)} staff see these.</span></div><div class="fields">
          <div class="field w2"><label for="md-n">Legal name</label><input id="md-n" maxlength="120" value="${esc(det ? det.legal_name || '' : '')}"></div>
          <div class="field w2"><label for="md-e">Email</label><input id="md-e" type="email" maxlength="160" value="${esc(det ? det.email || '' : '')}"></div>
          <div class="field w2"><label for="md-p">Phone</label><input id="md-p" type="tel" maxlength="40" value="${esc(det ? det.phone || '' : '')}"></div>
          <div class="field w2"><label for="md-en">Emergency contact</label><input id="md-en" maxlength="120" value="${esc(det ? det.emergency_name || '' : '')}"></div>
          <div class="field w2"><label for="md-ep">Emergency phone</label><input id="md-ep" type="tel" maxlength="40" value="${esc(det ? det.emergency_phone || '' : '')}"></div></div>
          <div class="row"><button class="btn sm">Save</button><span class="hint" id="md-msg"></span></div></form>
      </div></section>`)) return;
    const busy = async (b, fn) => { const t = b.textContent; b.disabled = true; b.textContent = 'Opening…'; try { await fn(); } catch (e) { toast(e.message); b.disabled = false; b.textContent = t; } };
    $$('[data-pay]').forEach(b => b.onclick = () => busy(b, async () => { location.href = (await call('pay', { invoice: b.dataset.pay })).url; }));
    $$('[data-join]').forEach(b => b.onclick = () => busy(b, async () => { location.href = (await call('subscribe', { plan: b.dataset.join })).url; }));
    if ($('#portal')) $('#portal').onclick = e => busy(e.target, async () => { location.href = (await call('portal', { gym: g.id })).url; });
    $('#mdF').onsubmit = async e => { e.preventDefault(); const { error } = await sb.from('member_details').upsert({ profile_id: S.me.id, legal_name: $('#md-n').value.trim() || null, email: $('#md-e').value.trim() || null, phone: $('#md-p').value.trim() || null, emergency_name: $('#md-en').value.trim() || null, emergency_phone: $('#md-ep').value.trim() || null, updated_at: new Date().toISOString() }); $('#md-msg').textContent = error ? error.message : 'Saved.'; };
  };
  VIEWS.billing = VIEWS.mygym;

  /* ----- Sign a document ----- */
  VIEWS.sign = async (kind, tok) => {
    if (!['waiver', 'contract'].includes(kind)) throw new Error('Nothing to sign here.');
    if (!S.me) return needLogin(tok, 'sign');
    const qs = new URLSearchParams(location.search), gid = qs.get('gym') || S.me.gym_id, preview = qs.get('preview') === '1';
    const g = gid && await gymById(gid);
    if (!g) throw new Error('No gym here.');
    const doc = must(await sb.from('gym_docs').select('*').eq('gym_id', g.id).eq('kind', kind).eq('active', true).maybeSingle());
    const plan = qs.get('plan') ? must(await sb.from('plans').select('*').eq('id', qs.get('plan')).maybeSingle()) : null;
    if (!doc) return paint(tok, `<section class="prEmpty"><b>${esc(g.name)} has no ${kind} to sign yet</b><p><a class="btn ghost sm" href="/mygym">My gym</a></p></section>`);
    if (kind === 'contract' && !plan && !preview) return paint(tok, `<section class="prEmpty"><b>Pick a membership first</b><p>The contract is signed for a specific plan.</p><p><a class="btn" href="/mygym">Memberships</a></p></section>`);
    const det = must(await sb.from('member_details').select('legal_name').eq('profile_id', S.me.id).maybeSingle());
    const vals = docVals(g, { member: (det && det.legal_name) || S.me.display_name, ...planVals(plan || (preview ? { name: 'Unlimited', price_cents: 17500, interval: 'month', commitment_months: 0 } : null)) });
    const text = fillDoc(doc.body, vals);
    if (!paint(tok, `<section class="sec narrow"><div><div class="kicker">${esc(g.name)}${preview ? ' · Preview' : ''}</div><h2>${esc(doc.title)}</h2><p class="secSub">Version ${doc.version}. Read it all, then sign at the bottom.</p></div>
      <div class="docText" tabindex="0">${esc(text)}</div>
      <form class="formCard" id="sgF"><div class="fields">
        <div class="field w4"><label for="sg-n">Type your full legal name</label><input id="sg-n" maxlength="120" required autocomplete="name" value="${esc((det && det.legal_name) || '')}"></div>
        <div class="field w4"><label>Sign with your finger or mouse</label><canvas class="sigPad" id="sg-c" aria-label="Signature pad"></canvas><div class="row"><button type="button" class="btn ghost sm" id="sg-clear">Clear</button></div></div>
        <label class="check field w4"><input type="checkbox" id="sg-ok" required><span>I have read this ${kind === 'waiver' ? 'waiver and release' : 'membership agreement'}, I agree to it, and I am signing it electronically with the same effect as signing on paper.</span></label></div>
        <div class="row"><button class="btn"${preview ? ' disabled' : ''}>${kind === 'contract' && plan ? 'Sign and continue to payment' : 'Sign'}</button><span class="hint" id="sg-msg">${preview ? 'Preview only. Members sign from their own account.' : 'We save your name, signature, the date and time, and a fingerprint of this exact text.'}</span></div></form></section>`)) return;
    const p = pad($('#sg-c'));
    $('#sg-clear').onclick = () => p.clear();
    $('#sgF').onsubmit = async e => {
      e.preventDefault(); if (preview) return;
      const msg = $('#sg-msg'), name = $('#sg-n').value.trim();
      if (name.length < 3) { msg.textContent = 'Type your full name.'; return; }
      if (!p.inked) { msg.textContent = 'Draw your signature in the box.'; return; }
      if (!$('#sg-ok').checked) { msg.textContent = 'Tick the box to agree.'; return; }
      const b = e.target.querySelector('button:not([type])'); b.disabled = true; msg.textContent = 'Saving your signature…';
      const context = { values: vals, ...(plan ? { plan_id: plan.id, plan: plan.name, price_cents: plan.price_cents, interval: plan.interval, commitment_months: plan.commitment_months } : {}) };
      // A new plan means a new contract signature; the old one stays on record.
      const { error } = await sb.from('doc_signatures').insert({ doc_id: doc.id, profile_id: S.me.id, signed_name: name, signature: p.png(), agreed: true, user_agent: navigator.userAgent.slice(0, 400), context });
      if (error && !/duplicate|unique/.test(error.message)) { msg.textContent = error.message; b.disabled = false; return; }
      if (error && kind === 'contract') { msg.textContent = 'You already signed this version for another plan. Ask the gym to update your membership.'; b.disabled = false; return; }
      if (!(det && det.legal_name)) await sb.from('member_details').upsert({ profile_id: S.me.id, legal_name: name, updated_at: new Date().toISOString() });
      toast('Signed');
      if (kind === 'contract' && plan) { try { location.href = (await call('subscribe', { plan: plan.id })).url; return; } catch (err) { toast(err.message); } }
      go(qs.get('next') && qs.get('next').startsWith('/') ? qs.get('next') : '/mygym');
    };
  };

  /* ----- View a signed document ----- */
  VIEWS.signed = async (id, tok) => {
    if (!S.me) return needLogin(tok, 'see this');
    const s = must(await sb.from('doc_signatures').select('*').eq('id', id).maybeSingle());
    if (!s) throw new Error('No signature here, or it is not yours to see.');
    const [doc, g, who] = await Promise.all([sb.from('gym_docs').select('*').eq('id', s.doc_id).maybeSingle().then(must), gymById(s.gym_id), people([s.profile_id])]);
    const vals = (s.context && s.context.values) || docVals(g, { member: s.signed_name });
    paint(tok, `<section class="sec narrow"><div><div class="kicker">${esc(g.name)} · signed record</div><h2>${esc(doc.title)}</h2><p class="secSub">Version ${doc.version} · signed by ${esc(s.signed_name)} (${esc(who.get(s.profile_id) || '')}) on ${esc(new Date(s.signed_at).toLocaleString('en-US', { timeZone: g.tz, dateStyle: 'long', timeStyle: 'short' }))}</p></div>
      <div class="docText">${esc(fillDoc(doc.body, vals))}</div>
      <div class="formCard"><img class="sigImg" src="${esc(s.signature)}" alt="Signature of ${esc(s.signed_name)}"><p class="sub">Signed name: ${esc(s.signed_name)}${s.context && s.context.plan ? ` · Plan: ${esc(s.context.plan)} ${money(s.context.price_cents)}` : ''}<br>Text fingerprint (SHA 256): <code>${esc(s.body_sha256)}</code><br>Device: ${esc(s.user_agent || '')}</p>
      <div class="row"><button class="btn ghost sm" onclick="window.print()">Print or save as PDF</button></div></div></section>`);
  };
}
