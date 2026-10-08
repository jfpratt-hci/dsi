// /plan/<gym>  The AI plan builder in the gym office.
// A coach describes the goals for a period (Murph prep, a 10 week max out cycle, an engine block),
// the planner drafts an outline of the cycle to approve or change, then writes the class days
// one week at a time in the Part A to D format. Nothing posts until the coach checks it and posts it.
// The draft is kept in this browser so a refresh does not lose it.

export function install(X) {
  const { sb, S, VIEWS, $, $$, esc, today, pd, fmtD, addDays, monday, toast, must, paint, needLogin, go, isStaff, normDay, liftRule } = X;
  const DOW = [['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat'], ['0', 'Sun']];
  const LENGTHS = [['day', 'One day', 0], ['week', 'A week', 1], ['month', 'A month', 4], ['quarter', 'A quarter', 13], ['custom', 'Pick weeks', 0]];
  const EQUIP = [['Barbells', 1], ['Dumbbells', 1], ['Kettlebells', 1], ['Pull up rig', 1], ['Rowers', 1], ['Bikes', 1], ['Ski ergs', 1], ['Boxes', 1], ['Wall balls', 1], ['Jump ropes', 1], ['Running route', 1], ['Rings', 0], ['GHD', 0], ['Rope climb', 0], ['Sleds', 0], ['Sandbags', 0]];
  const LIFTS = [['squat', 'Squat'], ['bench', 'Bench'], ['dead', 'Deadlift'], ['clean', 'Clean']];
  const IDEAS = [
    ['Murph prep', 'Murph prep for the month before Murph. Build pull up, push up and air squat volume, running engine, and vest work for those who want it, then taper the last week so everyone feels good on the day.'],
    ['Max out cycle', 'A max out cycle for the main lifts: squat, bench, deadlift and clean. Wave the percentages up week to week, deload before the end, and finish with a max out week where we test every lift.'],
    ['Open prep', 'Get the gym ready for the CrossFit Open: gymnastics skills, barbell cycling, and mixed modal conditioning in Open style time domains, with a few retests of past Open workouts.'],
    ['Engine builder', 'Build aerobic capacity: longer intervals on the rower, bike, ski and runs, with strength kept to two days a week to hold onto it.'],
    ['Back on track', 'Get people back into a routine after the holidays: moderate loads, lots of variety, quick wins, and a benchmark at the start and end to show progress.'],
  ];
  const key = gid => 'dsi.plan.' + gid;
  const load = gid => { try { return JSON.parse(localStorage.getItem(key(gid)) || 'null'); } catch { return null; } };
  const save = (gid, v) => { try { v ? localStorage.setItem(key(gid), JSON.stringify(v)) : localStorage.removeItem(key(gid)); } catch {} };
  const nextMonday = () => { const t = today(); return pd(t).getDay() === 1 ? t : addDays(monday(t), 7); };
  const fmtDW = s => pd(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  async function call(plan) {
    const { data, error } = await sb.functions.invoke('import-workout', { body: { plan } });
    let msg = error && error.message;
    if (error && error.context && error.context.json) { try { msg = (await error.context.json()).error || msg; } catch {} }
    if (msg) throw new Error(msg);
    if (!data || data.error) throw new Error((data && data.error) || 'The planner did not answer. Try again.');
    return data;
  }

  // Class dates for each week of the plan. The event day always counts as a class day.
  function weekDates(f) {
    if (f.length === 'day') return [[f.start]];
    const days = new Set(f.days), out = [];
    for (let w = 0; w < f.weeks; w++) {
      const ds = [];
      for (let i = 0; i < 7; i++) { const d = addDays(f.start, w * 7 + i); if (days.has(String(pd(d).getDay())) || d === f.event) ds.push(d); }
      out.push(ds);
    }
    return out;
  }

  VIEWS.plan = async (param, tok) => {
    if (!S.me) return needLogin(tok, 'build a plan');
    let g = null;
    if (param) { const q = /^[0-9a-f-]{36}$/i.test(param) ? sb.from('gyms').select('*').eq('id', param) : sb.from('gyms').select('*').eq('slug', param); g = (await q.maybeSingle()).data; }
    if (!g && (S.myGyms || []).length) return go('/plan/' + S.myGyms[0].gym_id);
    if (!g) return paint(tok, '<section class="prEmpty"><b>No gym here</b><p>The plan builder is part of the gym office.</p></section>');
    const gid = g.id;
    if (!isStaff() && !(S.myGyms || []).some(x => x.gym_id === gid)) return paint(tok, '<section class="prEmpty"><b>Coaches only</b><p>Gym owners and coaches build plans for their gym.</p></section>');

    let st = load(gid) || { step: 'ask', form: null, outline: null, weeks: {} };
    const f0 = st.form || { goals: '', length: 'month', weeks: 4, start: nextMonday(), event: '', eventName: '', days: ['1', '2', '3', '4', '5', '6'], minutes: 60, level: 'Mixed, from beginners to Rx', equipment: EQUIP.filter(e => e[1]).map(e => e[0]), lifts: LIFTS.map(l => l[0]), style: '' };

    if (!paint(tok, `${X.officeBar(g, 'plan')}
      <section class="sec"><div class="secHead"><div><div class="kicker">${esc(g.name)} · Plan builder</div><h2>Build a <span>plan</span></h2>
        <p class="secSub">Tell it what the gym is working toward. It drafts the cycle for you to approve, then writes every class day as Parts A to D with targets from each member's own numbers. Nothing posts until you post it.</p></div>
        <div class="row"><button class="btn ghost sm" type="button" id="pl-new">Start over</button></div></div>
        <ol class="plSteps" aria-label="Steps"><li data-s="ask">Goals</li><li data-s="outline">Outline</li><li data-s="build">Workouts</li></ol>
      </section>
      <section class="sec" id="pl-ask"></section>
      <section class="sec" id="pl-outline" hidden></section>
      <section class="sec" id="pl-build" hidden></section>`)) return;

    const keep = () => save(gid, st);
    const steps = () => $$('.plSteps li').forEach(li => { const order = ['ask', 'outline', 'build']; li.classList.toggle('on', li.dataset.s === st.step); li.classList.toggle('done', order.indexOf(li.dataset.s) < order.indexOf(st.step)); });
    $('#pl-new').onclick = () => { st = { step: 'ask', form: null, outline: null, weeks: {} }; save(gid, null); go('/plan/' + gid); };

    /* ---------- step 1: the goals ---------- */
    function renderAsk() {
      const f = st.form || f0;
      $('#pl-ask').innerHTML = `<form class="formCard" id="pl-form">
        <div class="field"><label for="pl-goals">What are the goals for this period?</label>
          <textarea id="pl-goals" rows="5" maxlength="3000" required placeholder="Like: Murph is May 25. Spend the month before getting everyone ready for it, then taper the last week.">${esc(f.goals)}</textarea>
          <div class="chips" aria-label="Start from an idea">${IDEAS.map(([n], i) => `<button type="button" class="chip" data-idea="${i}">${esc(n)}</button>`).join('')}</div></div>
        <div class="field"><span class="lbl">How long</span><div class="chips plTogs">${LENGTHS.map(([k, n]) => `<label class="tog"><input type="radio" name="pl-len" value="${k}"${f.length === k ? ' checked' : ''}><span>${n}</span></label>`).join('')}
          <span class="plWeeks"${f.length === 'custom' ? '' : ' hidden'}><input id="pl-weeks" type="number" min="1" max="16" value="${f.weeks}" aria-label="Number of weeks"> weeks</span></div></div>
        <div class="fields">
          <div class="field"><label for="pl-start">Starts</label><input id="pl-start" type="date" value="${esc(f.start)}"></div>
          <div class="field"><label for="pl-ename">Event or test day (optional)</label><input id="pl-ename" maxlength="60" value="${esc(f.eventName)}" placeholder="Murph, max out day, Open 26.1"></div>
          <div class="field"><label for="pl-event">Event date</label><input id="pl-event" type="date" value="${esc(f.event)}"></div>
          <div class="field"><label for="pl-min">Class length</label><select id="pl-min">${[45, 60, 75, 90].map(m => `<option value="${m}"${+f.minutes === m ? ' selected' : ''}>${m} minutes</option>`).join('')}</select></div>
        </div>
        <div class="field"><span class="lbl">Class days</span><div class="chips">${DOW.map(([v, n]) => `<label class="tog"><input type="checkbox" name="pl-day" value="${v}"${f.days.includes(v) ? ' checked' : ''}><span>${n}</span></label>`).join('')}</div></div>
        <div class="field"><span class="lbl">Main lifts to push</span><div class="chips">${LIFTS.map(([v, n]) => `<label class="tog"><input type="checkbox" name="pl-lift" value="${v}"${f.lifts.includes(v) ? ' checked' : ''}><span>${n}</span></label>`).join('')}</div></div>
        <div class="field"><span class="lbl">Equipment on hand</span><div class="chips">${EQUIP.map(([n]) => `<label class="tog"><input type="checkbox" name="pl-eq" value="${esc(n)}"${f.equipment.includes(n) ? ' checked' : ''}><span>${esc(n)}</span></label>`).join('')}</div></div>
        <div class="fields">
          <div class="field w2"><label for="pl-level">Members</label><select id="pl-level">${['Mixed, from beginners to Rx', 'Mostly newer members', 'Mostly experienced', 'Competitive athletes'].map(v => `<option${f.level === v ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="field w2"><label for="pl-style">How you write a day (optional)</label><input id="pl-style" maxlength="200" value="${esc(f.style)}" placeholder="A warmup and skill, B strength, C metcon, D core"></div>
        </div>
        <div class="row"><button class="btn" type="submit">${st.outline ? 'Redo the outline' : 'Draft the plan'}</button>${st.outline ? '<button class="btn ghost" type="button" id="pl-back">Back to the outline</button>' : ''}<span class="hint" id="pl-msg"></span></div>
      </form>`;
      const form = $('#pl-form');
      const lenSync = () => { const v = (form.querySelector('[name=pl-len]:checked') || {}).value; $('.plWeeks', form).hidden = v !== 'custom'; };
      $$('[name=pl-len]', form).forEach(r => r.onchange = lenSync);
      $$('[data-idea]', form).forEach(b => b.onclick = () => { const [n, t] = IDEAS[+b.dataset.idea]; $('#pl-goals').value = t; if (n === 'Max out cycle') { form.querySelector('[name=pl-len][value=custom]').checked = true; $('#pl-weeks').value = 10; $('#pl-ename').value = 'Max out week'; } if (n === 'Murph prep') { form.querySelector('[name=pl-len][value=month]').checked = true; $('#pl-ename').value = 'Murph'; } lenSync(); $('#pl-goals').focus(); });
      // An event date sets the length so the plan ends on it.
      $('#pl-event').onchange = e => { const s = $('#pl-start').value, ev = e.target.value; if (s && ev && ev >= s) { let w = Math.ceil((Math.round((pd(ev) - pd(s)) / 864e5) + 1) / 7); if (w > 16) { w = 4; $('#pl-start').value = addDays(monday(ev), -21); $('#pl-msg').textContent = 'The event is far off, so the plan starts four weeks before it. Change the start if you want longer.'; } form.querySelector('[name=pl-len][value=custom]').checked = true; $('#pl-weeks').value = w; lenSync(); } };
      const back = $('#pl-back'); if (back) back.onclick = () => { st.step = 'outline'; keep(); show(); };
      form.onsubmit = async e => {
        e.preventDefault();
        const len = form.querySelector('[name=pl-len]:checked').value, msg = $('#pl-msg');
        const f = { goals: $('#pl-goals').value.trim(), length: len, weeks: len === 'custom' ? Math.max(1, Math.min(16, +$('#pl-weeks').value || 1)) : (LENGTHS.find(l => l[0] === len)[2] || 1), start: $('#pl-start').value, event: $('#pl-event').value, eventName: $('#pl-ename').value.trim(),
          days: $$('[name=pl-day]:checked', form).map(x => x.value), minutes: +$('#pl-min').value, level: $('#pl-level').value, equipment: $$('[name=pl-eq]:checked', form).map(x => x.value), lifts: $$('[name=pl-lift]:checked', form).map(x => x.value), style: $('#pl-style').value.trim() };
        if (!f.goals) return (msg.textContent = 'Tell it what the goals are first.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(f.start)) return (msg.textContent = 'Pick a start date.');
        if (len !== 'day' && !f.days.length) return (msg.textContent = 'Pick at least one class day.');
        if (f.event && f.event < f.start) return (msg.textContent = 'The event date is before the start.');
        st.form = f; st.weeks = {}; st.answers = ''; st.feedback = '';
        if (len === 'day') { st.outline = null; st.step = 'build'; keep(); show(); return build(); }
        await outline(msg, form.querySelector('button[type=submit]'));
      };
    }

    const planBody = extra => ({ ...st.form, gym: g.name, lifts: st.form.lifts.map(l => (LIFTS.find(x => x[0] === l) || [, l])[1]), answers: st.answers || '', feedback: st.feedback || '', ...extra });

    async function outline(msg, btn) {
      if (btn) btn.disabled = true;
      msg.textContent = 'Drafting the cycle… about 20 seconds.';
      try { st.outline = await call(planBody({ step: 'outline' })); st.outline._fb = st.feedback || ''; st.outline._qa = st.answers || ''; st.weeks = {}; st.step = 'outline'; keep(); show(); }
      catch (err) { msg.textContent = err.message; }
      if (btn) btn.disabled = false;
    }

    /* ---------- step 2: the outline ---------- */
    function renderOutline() {
      const o = st.outline, f = st.form, wd = weekDates(f);
      $('#pl-outline').innerHTML = `<div class="secHead"><div><div class="kicker">${f.weeks} week${f.weeks === 1 ? '' : 's'} · ${esc(fmtD(f.start))} to ${esc(fmtD(wd[wd.length - 1].slice(-1)[0] || f.start))}</div><h2>${esc(o.name || 'The plan')}</h2><p class="secSub">${esc(o.summary || '')}</p></div></div>
        ${(o.questions || []).length ? `<div class="formCard plQs"><b>A few questions that would sharpen it</b>${o.questions.slice(0, 3).map((q, i) => `<div class="field"><label for="pl-q${i}">${esc(q)}</label><input id="pl-q${i}" data-q="${esc(q)}" maxlength="300"></div>`).join('')}</div>` : ''}
        ${(o.phases || []).length ? `<div class="plPhases">${o.phases.map(p => `<div class="plPhase"><span>Weeks ${esc(p.weeks)}</span><b>${esc(p.name)}</b><p>${esc(p.focus)}</p></div>`).join('')}</div>` : ''}
        <div class="tablewrap"><table class="wkT plOut"><thead><tr><th>Week</th><th>Theme</th><th>Strength</th><th>Conditioning</th></tr></thead><tbody>
          ${(o.weeks || []).map((w, i) => `<tr><td class="n"><b>${w.n || i + 1}</b><div class="sub">${wd[i] && wd[i].length ? esc(fmtD(wd[i][0])) : ''}</div></td><td><b>${esc(w.theme)}</b>${w.test ? `<div><span class="pill acc">${esc(w.test)}</span></div>` : ''}</td><td>${esc(w.strength)}</td><td>${esc(w.conditioning)}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="formCard"><div class="field"><label for="pl-fb">Want anything changed?</label><textarea id="pl-fb" rows="2" maxlength="1500" placeholder="Like: more running in weeks 2 and 3, no deadlifts on Mondays, test the clean on Saturday">${esc(st.feedback || '')}</textarea></div>
          <div class="row"><button class="btn" type="button" id="pl-go">Write the workouts</button><button class="btn ghost" type="button" id="pl-redo">Update the outline</button><button class="btn ghost" type="button" id="pl-edit">Change the goals</button><span class="hint" id="pl-omsg">${wd.reduce((a, w) => a + w.length, 0)} class days. Each week takes about 40 seconds to write.</span></div></div>`;
      const gather = () => { const qa = $$('[data-q]').filter(i => i.value.trim()).map(i => `${i.dataset.q} ${i.value.trim()}`).join('\n'); if (qa) st.answers = [st.answers, qa].filter(Boolean).join('\n'); st.feedback = $('#pl-fb').value.trim(); };
      $('#pl-redo').onclick = () => { gather(); if (!st.feedback && !st.answers) return ($('#pl-omsg').textContent = 'Say what to change, or answer a question above.'); outline($('#pl-omsg'), $('#pl-redo')); };
      $('#pl-edit').onclick = () => { st.step = 'ask'; keep(); show(); };
      $('#pl-go').onclick = () => { gather(); if ((st.feedback || '') !== (st.outline._fb || '') || (st.answers || '') !== (st.outline._qa || '')) return outline($('#pl-omsg'), $('#pl-go')); st.step = 'build'; keep(); show(); build(); };
    }

    /* ---------- step 3: write the days, a week at a time ---------- */
    let running = false, stopAsk = false, had = {};
    const compact = days => (days || []).map(d => ({ day: d.day, title: d.title, parts: (d.sections || []).map(s => `${s.part} ${s.name}: ${String(s.text).slice(0, 160)}`) }));

    async function build(only) {
      if (running) return;
      running = true; stopAsk = false;
      const wd = weekDates(st.form), total = wd.length;
      renderBuild();
      for (let i = 0; i < total; i++) {
        const n = i + 1;
        if (stopAsk) break;
        if (only ? n !== only : st.weeks[n]) continue;
        if (!wd[i].length) { st.weeks[n] = { days: [] }; continue; }
        setProg(`Writing ${total > 1 ? `week ${n} of ${total}` : 'the workout'}…`, i / total);
        try {
          const prevDays = n > 1 && st.weeks[n - 1] ? compact(st.weeks[n - 1].days) : null;
          const out = await call(planBody({ step: 'week', week: n, dates: wd[i], outline: st.outline ? { name: st.outline.name, summary: st.outline.summary, phases: st.outline.phases, weeks: st.outline.weeks } : null, prev: prevDays, feedback: [st.feedback, (st.notes || {})[n]].filter(Boolean).join('\n') }));
          const days = (out.days || []).map(normDay).filter(d => wd[i].includes(d.day));
          st.weeks[n] = { days, at: Date.now() }; keep(); renderBuild();
        } catch (err) { setProg(`Week ${n}: ${err.message}`, i / total, true); running = false; renderBuild(); return; }
      }
      running = false;
      await markExisting();
      renderBuild();
    }

    function setProg(t, frac, bad) { const p = $('#pl-prog'); if (!p) return; p.hidden = false; $('span', p).textContent = t; $('i', p).style.width = Math.round(Math.max(.04, frac) * 100) + '%'; p.classList.toggle('bad', !!bad); }

    async function markExisting() {
      const all = Object.values(st.weeks).flatMap(w => w.days || []).map(d => d.day);
      if (!all.length) return;
      const rows = must(await sb.from('workouts').select('day,title').eq('gym_id', gid).in('day', all));
      had = Object.fromEntries(rows.map(r => [r.day, r.title]));
    }

    function dayCard(d, n, k) {
      return `<article class="plDay" data-w="${n}" data-k="${k}">
        <div class="plDayH"><label class="check"><input type="checkbox" data-inc checked aria-label="Post ${esc(fmtDW(d.day))}"></label><span class="plDate">${esc(fmtDW(d.day))}</span><input data-title maxlength="80" value="${esc(d.title || '')}" aria-label="Title"></div>
        ${had[d.day] ? `<p class="hint plWarn">Replaces "${esc(had[d.day])}" already posted that day.</p>` : ''}
        <div class="plParts">${(d.sections || []).map((s, j) => { const l = (d.lifts || []).find(x => x.part === s.part); return `<div class="plPart"><div class="plPL"><b>${esc(s.part || '')}</b> ${esc(s.name || '')}${s.time ? ' <span class="pill">Time</span>' : ''}${s.reps ? ' <span class="pill">Reps</span>' : ''}${l ? ` <span class="pill acc">${esc(l.n)} · ${esc(liftRule(l))}${l.max ? ' · Max' : ''}</span>` : ''}</div><textarea data-sec="${j}" rows="${Math.min(6, Math.max(2, Math.ceil(String(s.text).length / 70)))}" aria-label="Part ${esc(s.part || '')} text">${esc(s.text)}</textarea></div>`; }).join('')}</div>
      </article>`;
    }

    function renderBuild() {
      const host = $('#pl-build'), wd = weekDates(st.form), total = wd.length, o = st.outline || { weeks: [] };
      const done = Object.keys(st.weeks).length, count = Object.values(st.weeks).reduce((a, w) => a + (w.days || []).length, 0);
      const open = $$('details.plWeek[open]', host).map(x => x.dataset.w);
      host.innerHTML = `<div class="secHead"><div><div class="kicker">${esc((st.outline && st.outline.name) || st.form.goals.slice(0, 60))}</div><h2>Check and <span>post</span></h2>
          <p class="secSub">Edit any title or part right here, untick a day to skip it, or rewrite a week with a note. Targets come from each member's own PRs.</p></div></div>
        <div class="plProg" id="pl-prog"${running ? '' : ' hidden'}><i></i><span></span>${running ? '<button class="btn ghost sm" type="button" id="pl-stop">Stop</button>' : ''}</div>
        <div class="plWkList">${wd.map((ds, i) => { const n = i + 1, w = st.weeks[n], ow = o.weeks[i] || {};
          return `<details class="plWeek" data-w="${n}"${open.includes(String(n)) || (!open.length && n === 1) ? ' open' : ''}><summary><b>${total > 1 ? `Week ${n}` : 'The day'}</b><span>${esc(ow.theme || '')}</span><span class="sub">${ds.length ? `${esc(fmtD(ds[0]))} to ${esc(fmtD(ds[ds.length - 1]))}` : 'No class days'}</span><span class="pill${w ? ' acc' : ''}">${w ? `${(w.days || []).length} days` : running ? 'Waiting' : 'Not written'}</span></summary>
            ${w ? `<div class="plDays">${(w.days || []).map((d, k) => dayCard(d, n, k)).join('')}</div>
              <div class="row plRe"><input data-note="${n}" maxlength="400" placeholder="Note for a rewrite, like: lighter on the shoulders this week" value="${esc((st.notes || {})[n] || '')}" aria-label="Note for rewriting week ${n}"><button class="btn ghost sm" type="button" data-redo="${n}"${running ? ' disabled' : ''}>Rewrite this ${total > 1 ? 'week' : 'day'}</button></div>` : ''}
          </details>`; }).join('')}</div>
        <div class="row" style="margin-top:16px">${done < total && !running ? `<button class="btn" type="button" id="pl-cont">${done ? 'Keep writing' : 'Write the workouts'}</button>` : ''}<button class="btn${done < total ? ' ghost' : ''}" type="button" id="pl-post"${!count || running ? ' disabled' : ''}>Post ${count} day${count === 1 ? '' : 's'} to ${esc(g.name)}</button>${st.outline ? '<button class="btn ghost" type="button" id="pl-toout">Back to the outline</button>' : ''}<span class="hint" id="pl-pmsg"></span></div>`;
      const stop = $('#pl-stop'); if (stop) stop.onclick = () => { stopAsk = true; stop.disabled = true; stop.textContent = 'Stopping after this week'; };
      const cont = $('#pl-cont'); if (cont) cont.onclick = () => build();
      const to = $('#pl-toout'); if (to) to.onclick = () => { if (running) return; st.step = 'outline'; keep(); show(); };
      $$('[data-note]', host).forEach(i => i.oninput = () => { st.notes = { ...(st.notes || {}), [i.dataset.note]: i.value }; keep(); });
      $$('[data-redo]', host).forEach(b => b.onclick = () => { const n = +b.dataset.redo; delete st.weeks[n]; keep(); build(n); });
      // Keep edits in the saved draft as they are typed.
      $$('.plDay', host).forEach(a => {
        const d = st.weeks[a.dataset.w].days[+a.dataset.k];
        $('[data-title]', a).oninput = e => { d.title = e.target.value; keep(); };
        $$('[data-sec]', a).forEach(t => t.oninput = () => { d.sections[+t.dataset.sec].text = t.value; keep(); });
        $('[data-inc]', a).onchange = e => { d.skip = !e.target.checked; keep(); };
        $('[data-inc]', a).checked = !d.skip;
      });
      $('#pl-post').onclick = post;
    }

    async function post() {
      const pm = $('#pl-pmsg'), name = (st.outline && st.outline.name) || 'Plan builder';
      const rows = Object.entries(st.weeks).flatMap(([n, w]) => (w.days || []).filter(d => !d.skip).map(d => ({
        day: d.day, gym_id: gid, title: (d.title || '').trim() || 'Workout', source: st.outline && weekDates(st.form).length > 1 ? `${name} · Week ${n}` : name,
        sections: (d.sections || []).filter(s => String(s.text || '').trim() || (d.lifts || []).some(l => l.part === s.part)).map(s => ({ ...s, text: String(s.text || '').trim() })),
        lifts: d.lifts || [], score_label: null, score_type: null, rest_note: d.rest_note || null,
        pr_lift: ['bench', 'squat', 'deadlift', 'clean'].includes(d.pr_lift) ? d.pr_lift : null })));
      if (!rows.length) return (pm.textContent = 'Tick at least one day.');
      if (new Set(rows.map(r => r.day)).size !== rows.length) return (pm.textContent = 'Two days share a date.');
      $('#pl-post').disabled = true; pm.textContent = 'Posting…';
      const { error } = await sb.from('workouts').upsert(rows, { onConflict: 'gym_id,day' });
      if (error) { $('#pl-post').disabled = false; pm.textContent = error.message; return; }
      save(gid, null);
      toast(`Posted ${rows.length} day${rows.length === 1 ? '' : 's'} to ${g.name}. Fix any day in Workouts.`);
      go(`/wod/${gid}?day=${rows.map(r => r.day).sort()[0]}`);
    }

    function show() {
      steps();
      $('#pl-ask').hidden = st.step !== 'ask'; $('#pl-outline').hidden = st.step !== 'outline'; $('#pl-build').hidden = st.step !== 'build';
      if (st.step === 'ask') renderAsk();
      if (st.step === 'outline') renderOutline();
      if (st.step === 'build') { renderBuild(); markExisting().then(() => { if (!running) renderBuild(); }); }
    }
    show();
  };
}
