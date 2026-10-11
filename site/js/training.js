// /training        My training: every session a member logs on their own, plus Pro insights
// /training/new    log a session (?again=<id> starts from an earlier one)
// /training/<id>   view or edit a session
// Logging is free. Heavy singles on catalog lifts become PRs (the four DSI lifts for everyone, the rest on Pro).

export function install(X) {
  const { sb, S, D, VIEWS, $, $$, esc, num, fmt, today, pd, fmtD, addDays, monday, toast, must, paint, needLogin, go, isPro, loadBoard, boardRow } = X;
  const COMMON = ['Back squat', 'Bench press', 'Deadlift', 'Clean', 'Front squat', 'Overhead squat', 'Strict press', 'Push press', 'Power clean', 'Squat clean', 'Clean and jerk', 'Snatch', 'Power snatch', 'Jerk', 'Sumo deadlift',
    'Romanian deadlift', 'Incline bench press', 'Dumbbell bench press', 'Barbell row', 'Pull up', 'Weighted pull up', 'Dip', 'Lunge', 'Bulgarian split squat', 'Hip thrust', 'Good morning', 'Dumbbell press', 'Curl', 'Tricep extension'];
  const CATALOG = Object.fromEntries(D.ALL_LIFTS.map(([id, n]) => [n.toLowerCase(), id]));
  const liftFor = name => CATALOG[String(name || '').trim().toLowerCase()] || null;
  const e1rm = (w, r) => (r <= 1 ? w : Math.round(w * (1 + r / 30))); // Epley
  const vol = ex => (ex.sets || []).reduce((t, s) => t + num(s.r) * num(s.w), 0);
  const total = wk => (wk.exercises || []).reduce((t, ex) => t + vol(ex), 0);
  const fmtDW = s => pd(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const setLine = ex => (ex.sets || []).map(s => `${num(s.w) ? fmt(num(s.w)) : 'BW'}×${num(s.r)}`).join(', ');
  const missing = e => e && (/personal_workouts/.test(e.message || '') || e.code === '42P01' || e.code === 'PGRST205');
  const soon = tok => paint(tok, `<section class="prEmpty"><b>My training is switching on</b><p>Logging your own sessions goes live as soon as today's update finishes. Check back shortly.</p><p><a class="btn ghost" href="/log">Log a single lift meanwhile</a></p></section>`);

  /* ---------- list + insights ---------- */
  VIEWS.training = async (param, tok) => {
    if (!S.me) return needLogin(tok, 'track your training');
    if (param === 'new' || (param && /^[0-9a-f-]{36}$/i.test(param))) return editor(param, tok);
    const res = await sb.from('personal_workouts').select('*').eq('profile_id', S.me.id).order('day', { ascending: false }).order('created_at', { ascending: false }).limit(200);
    if (res.error) { if (missing(res.error)) return soon(tok); throw res.error; }
    const wks = res.data || [];
    const thisWeek = wks.filter(w => w.day >= monday(today()));
    const pro = isPro();
    if (!paint(tok, `<section class="sec"><div class="secHead"><div><h2>My <span>training</span></h2>
        <p class="secSub">Log your own sessions: open gym, travel, your own program. Heavy singles on a catalog lift count as PRs${pro ? '' : ' (the four DSI lifts on free, every lift on Pro)'}.</p></div>
        <a class="btn" href="/training/new">Log a session</a></div>
        <div class="trStats"><div><b>${thisWeek.length}</b><span>${thisWeek.length === 1 ? "session" : "sessions"} this week</span></div><div><b>${fmt(thisWeek.reduce((t, w) => t + total(w), 0))}</b><span>lb moved this week</span></div><div><b>${wks.length}</b><span>sessions logged</span></div></div>
      </section>
      ${pro ? insights(wks) : `<section class="sec"><div class="formCard trTease"><b>See your training trend with DSI Pro</b><p>Weekly volume, your best estimated max on every exercise, and the AI coach reading your sessions.</p><p><a class="btn sm" href="/pro">See DSI Pro</a></p></div></section>`}
      <section class="sec"><h3 class="hmH3">Sessions</h3>
        ${wks.length ? `<ol class="trList">${wks.map(w => `<li><a href="/training/${w.id}"><span class="trDay">${esc(fmtDW(w.day))}</span><b>${esc(w.title)}</b><span class="trEx">${(w.exercises || []).map(ex => esc(ex.name)).join(', ') || 'No exercises'}</span><span class="trVol">${fmt(total(w))} lb</span></a></li>`).join('')}</ol>`
          : `<div class="prEmpty"><b>No sessions yet</b><p>Log your first one. It takes about a minute.</p><p><a class="btn" href="/training/new">Log a session</a></p></div>`}
      </section>`)) return;
  };

  // Pro: weekly volume for 8 weeks and the best estimated max for each exercise.
  function insights(wks) {
    const start = addDays(monday(today()), -49), weeks = Array.from({ length: 8 }, (_, i) => addDays(start, i * 7));
    const vols = weeks.map(wk => wks.filter(w => w.day >= wk && w.day < addDays(wk, 7)).reduce((t, w) => t + total(w), 0));
    const max = Math.max(1, ...vols);
    const best = new Map();
    wks.forEach(w => (w.exercises || []).forEach(ex => (ex.sets || []).forEach(s => {
      const v = e1rm(num(s.w), num(s.r)); if (!v) return;
      const k = ex.name.trim(), cur = best.get(k);
      if (!cur || v > cur.v) best.set(k, { v, day: w.day, s });
    })));
    const top = [...best.entries()].sort((a, b) => b[1].v - a[1].v).slice(0, 8);
    return `<section class="sec"><h3 class="hmH3">Your trend</h3>
      <div class="trInsight">
        <figure class="trChart" aria-label="Pounds moved each week for the last 8 weeks">
          <figcaption>Pounds moved per week</figcaption>
          <div class="trBars">${vols.map((v, i) => `<div class="trBar"><span class="trBarV">${v ? fmt(Math.round(v / 1000)) + 'k' : ''}</span><i style="height:${Math.round(v / max * 100)}%"></i><span class="trBarL">${esc(fmtD(weeks[i]))}</span></div>`).join('')}</div>
        </figure>
        <div><table class="hmMath trBest"><caption>Best estimated max by exercise</caption><tbody>
          ${top.map(([n, b]) => `<tr><th scope="row">${esc(n)}<div class="sub">${esc(fmt(num(b.s.w)))}×${num(b.s.r)} on ${esc(fmtD(b.day))}</div></th><td>${fmt(b.v)}</td></tr>`).join('') || '<tr><td>Log a few sessions to see this.</td></tr>'}
        </tbody></table></div>
      </div></section>`;
  }

  /* ---------- log or edit a session ---------- */
  async function editor(param, tok) {
    const isNew = param === 'new', again = new URLSearchParams(location.search).get('again');
    let wk = { day: today(), title: '', note: '', exercises: [] };
    const recent = await sb.from('personal_workouts').select('id,day,title,exercises').eq('profile_id', S.me.id).order('day', { ascending: false }).limit(60);
    if (recent.error) { if (missing(recent.error)) return soon(tok); throw recent.error; }
    if (!isNew) {
      const r = await sb.from('personal_workouts').select('*').eq('id', param).maybeSingle();
      if (r.error) throw r.error;
      if (!r.data) return paint(tok, '<section class="prEmpty"><b>That session is gone</b><p><a class="btn ghost" href="/training">My training</a></p></section>');
      wk = r.data;
    } else if (again) {
      const src = (recent.data || []).find(w => w.id === again);
      if (src) wk = { day: today(), title: src.title, note: '', exercises: JSON.parse(JSON.stringify(src.exercises || [])) };
    }
    if (!wk.exercises.length) wk.exercises = [{ name: '', sets: [{ r: '', w: '' }] }];
    await loadBoard();
    const lastOf = name => { const n = String(name || '').trim().toLowerCase(); if (!n) return null;
      for (const w of recent.data || []) { if (w.id === wk.id) continue; const ex = (w.exercises || []).find(e => e.name.trim().toLowerCase() === n); if (ex) return { day: w.day, ex }; } return null; };
    if (!paint(tok, `<section class="sec"><div class="secHead"><div><h2>${isNew ? 'Log a' : 'Your'} <span>session</span></h2>
        <p class="secSub">Add each exercise and its sets. A single (1 rep) heavier than your best on a catalog lift becomes a PR.</p></div>
        <div class="row">${!isNew ? `<a class="btn ghost sm" href="/training/new?again=${wk.id}">Do this again</a>` : ''}<a class="btn ghost sm" href="/training">My training</a></div></div>
      <form class="formCard" id="trF">
        <div class="fields"><div class="field"><label for="tr-d">Date</label><input id="tr-d" type="date" value="${esc(wk.day)}" max="${addDays(today(), 1)}"></div>
          <div class="field w3"><label for="tr-t">Name</label><input id="tr-t" maxlength="80" value="${esc(wk.title)}" placeholder="Lower body, travel day, open gym"></div></div>
        <div id="trEx" class="trExList"></div>
        <div class="row"><button class="btn ghost sm" type="button" id="trAddEx">Add exercise</button></div>
        <div class="field"><label for="tr-n">Notes (optional)</label><textarea id="tr-n" rows="2" maxlength="1000" placeholder="How it felt, what to change next time">${esc(wk.note || '')}</textarea></div>
        <div class="row"><button class="btn" type="submit">${isNew ? 'Save session' : 'Save changes'}</button>${!isNew ? '<button class="btn ghost" type="button" id="trDel">Delete</button>' : ''}<span class="hint" id="tr-msg" role="status"></span></div>
      </form>
      <datalist id="trNames">${COMMON.map(n => `<option value="${esc(n)}">`).join('')}</datalist></section>`)) return;

    const host = $('#trEx');
    const exHtml = (ex, i) => {
      const last = lastOf(ex.name);
      return `<fieldset class="trExBox" data-i="${i}"><legend class="vh">Exercise ${i + 1}</legend>
        <div class="trExHead"><input class="trName" list="trNames" maxlength="60" value="${esc(ex.name)}" placeholder="Exercise, like Back squat" aria-label="Exercise ${i + 1} name"><button type="button" class="btn ghost sm" data-rmex aria-label="Remove exercise ${i + 1}">Remove</button></div>
        ${last ? `<p class="trLast">Last time, ${esc(fmtD(last.day))}: ${esc(setLine(last.ex))}</p>` : ''}
        <ol class="trSets">${(ex.sets || []).map((s, j) => `<li><span class="trSetN">${j + 1}</span><label class="vh" for="r-${i}-${j}">Reps, set ${j + 1}</label><input id="r-${i}-${j}" class="trR" type="number" inputmode="numeric" min="1" max="200" value="${esc(s.r)}" placeholder="reps"><span class="trX">×</span><label class="vh" for="w-${i}-${j}">Weight, set ${j + 1}</label><input id="w-${i}-${j}" class="trW" type="number" inputmode="decimal" min="0" max="1500" step="any" value="${esc(s.w)}" placeholder="lb"><button type="button" class="trRm" data-rmset="${j}" aria-label="Remove set ${j + 1}">×</button></li>`).join('')}</ol>
        <button type="button" class="btn ghost sm" data-addset>Add set</button></fieldset>`;
    };
    const read = () => { wk.exercises = $$('.trExBox', host).map(b => ({ name: $('.trName', b).value, sets: $$('.trSets li', b).map(li => ({ r: $('.trR', li).value, w: $('.trW', li).value })) })); };
    const render = () => { host.innerHTML = wk.exercises.map(exHtml).join(''); };
    render();
    host.addEventListener('click', e => {
      const box = e.target.closest('.trExBox'); if (!box) return; const i = +box.dataset.i;
      if (e.target.matches('[data-addset]')) { read(); const sets = wk.exercises[i].sets, last = sets[sets.length - 1] || { r: '', w: '' }; sets.push({ ...last }); render(); const li = $$('.trExBox', host)[i].querySelectorAll('.trSets li'); $('.trW', li[li.length - 1]).focus(); }
      if (e.target.matches('[data-rmset]')) { read(); wk.exercises[i].sets.splice(+e.target.dataset.rmset, 1); if (!wk.exercises[i].sets.length) wk.exercises[i].sets.push({ r: '', w: '' }); render(); }
      if (e.target.matches('[data-rmex]')) { read(); wk.exercises.splice(i, 1); if (!wk.exercises.length) wk.exercises.push({ name: '', sets: [{ r: '', w: '' }] }); render(); }
    });
    // A new exercise name only refreshes that box's "last time" line, so the next tap still lands.
    host.addEventListener('change', e => {
      if (!e.target.matches('.trName')) return;
      const box = e.target.closest('.trExBox'), last = lastOf(e.target.value), old = $('.trLast', box);
      if (old) old.remove();
      if (last) $('.trExHead', box).insertAdjacentHTML('afterend', `<p class="trLast">Last time, ${esc(fmtD(last.day))}: ${esc(setLine(last.ex))}</p>`);
    });
    $('#trAddEx').onclick = () => { read(); wk.exercises.push({ name: '', sets: [{ r: '', w: '' }] }); render(); $$('.trName', host).pop().focus(); };
    const del = $('#trDel');
    if (del) del.onclick = async () => {
      if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.textContent = 'Tap again to delete'; return; }
      const { error } = await sb.from('personal_workouts').delete().eq('id', wk.id);
      if (error) return toast(error.message);
      toast('Session deleted'); go('/training');
    };

    $('#trF').onsubmit = async e => {
      e.preventDefault(); read();
      const msg = $('#tr-msg'), day = $('#tr-d').value;
      const exercises = wk.exercises.map(ex => ({ name: ex.name.trim().slice(0, 60), lift: liftFor(ex.name),
        sets: ex.sets.filter(s => String(s.r).trim() !== '' || String(s.w).trim() !== '').map(s => ({ r: Math.max(1, Math.min(200, Math.round(num(s.r)) || 1)), w: Math.max(0, Math.min(1500, Math.round(num(s.w) * 2) / 2)) })) }))
        .filter(ex => ex.name && ex.sets.length);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return (msg.textContent = 'Pick a date.');
      if (!exercises.length) return (msg.textContent = 'Add at least one exercise with a set.');
      const row = { profile_id: S.me.id, day, title: $('#tr-t').value.trim() || exercises.map(x => x.name).slice(0, 2).join(' + '), note: $('#tr-n').value.trim() || null, exercises };
      msg.textContent = 'Saving…';
      const res = isNew ? await sb.from('personal_workouts').insert(row).select().single() : await sb.from('personal_workouts').update(row).eq('id', wk.id).select().single();
      if (res.error) { msg.textContent = missing(res.error) ? 'Logging switches on shortly. Try again in a few minutes.' : res.error.message; return; }
      // Heavy singles on catalog lifts become PRs: the four DSI lifts for everyone, every lift on Pro.
      const me = boardRow(S.me.id) || {}, prs = [];
      for (const ex of exercises) {
        if (!ex.lift) continue;
        const L = D.LIFT_BY_DB[ex.lift];
        if (!L && !isPro()) continue;
        const top = Math.max(0, ...ex.sets.filter(s => s.r === 1).map(s => s.w));
        if (!top) continue;
        let best = L ? num(me[L.k]) : 0;
        if (!L) { const q = await sb.from('lift_entries').select('weight_lb').eq('profile_id', S.me.id).eq('lift', ex.lift).neq('status', 'struck').order('weight_lb', { ascending: false }).limit(1); best = num(((q.data || [])[0] || {}).weight_lb); }
        if (top <= best) continue;
        const { data, error } = await sb.from('lift_entries').insert({ profile_id: S.me.id, lift: ex.lift, weight_lb: top, performed_on: day, source: 'workout', note: `From ${row.title}` }).select().single();
        if (!error && data && data.is_pr) prs.push(`${D.liftName(ex.lift)} ${fmt(top)} lb`);
      }
      toast(prs.length ? `Saved. New PR${prs.length > 1 ? 's' : ''}: ${prs.join(', ')}` : 'Session saved');
      go('/training');
    };
  }
}
