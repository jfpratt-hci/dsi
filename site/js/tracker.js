// /tracker   Plate tracker (DSI Pro): the phone camera counts your reps and reads the plates.
// /tracker?w=<workout id>&l=<lift id> tracks a lift from today's workout and saves to that workout.
// Reps are counted on the phone with body tracking (MediaPipe pose); the video never leaves the phone.
// One still photo goes to the read-plates function to read the weight, and the lifter confirms it.
import { tracker as repTracker } from './reps.js';

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];

export function install(X) {
  const { sb, S, D, VIEWS, $, $$, esc, num, fmt, today, toast, paint, needLogin, go, isPro, must, loadBoard, boardRow, fmtD } = X;
  const CATALOG = Object.fromEntries(D.ALL_LIFTS.map(([id, n]) => [n.toLowerCase(), id]));
  const liftFor = name => CATALOG[String(name || '').trim().toLowerCase()] || null;
  const NAMES = [...new Set([...D.ALL_LIFTS.map(x => x[1]), 'Front squat', 'Thruster', 'Dumbbell snatch', 'Kettlebell swing', 'Goblet squat', 'Barbell row', 'Curl', 'Pull up', 'Lunge'])];
  let poseP = null; // the pose model loads once per visit

  const loadPose = () => poseP || (poseP = (async () => {
    const v = await import(/* @vite-ignore */ MP + '/vision_bundle.mjs');
    const files = await v.FilesetResolver.forVisionTasks(MP + '/wasm');
    const opts = d => ({ baseOptions: { modelAssetPath: MODEL, delegate: d }, runningMode: 'VIDEO', numPoses: 2, minPoseDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    let cpu = false; try { cpu = localStorage.getItem('dsi.pose') === 'cpu'; } catch {}
    if (!cpu) try { return await v.PoseLandmarker.createFromOptions(files, opts('GPU')); } catch {}
    return v.PoseLandmarker.createFromOptions(files, opts('CPU'));
  })().catch(e => { poseP = null; throw e; }));

  VIEWS.tracker = async (_, tok) => {
    if (!S.me) return needLogin(tok, 'use the Plate tracker');
    if (!isPro()) return paint(tok, `<section class="sec narrow"><div><div class="kicker">DSI Pro</div><h2>Plate <span>tracker</span></h2>
      <p class="secSub">Prop your phone up, hit start and lift. The camera counts every rep, reads the plates on the bar, times each rep and saves the set to your log. Part of DSI Pro.</p></div>
      <ul class="tkPitch"><li><b>Counts your reps</b>Squats, presses, pulls, cleans, curls. It calls the count out loud.</li><li><b>Reads the weight</b>Point it at the bar and it reads the plates. You confirm with one tap.</li><li><b>Times every rep</b>See when the bar slows down so you know when to stop.</li><li><b>Saves the set</b>Straight to your log, and heavy singles go to the PR wall with the clip.</li></ul>
      <div class="row"><a class="btn" href="/pro">See DSI Pro</a><a class="btn ghost" href="/plates">Plate calculator</a></div></section>`);

    // Tracking a lift from a workout?
    const q = new URLSearchParams(location.search), wid = q.get('w'), lid = q.get('l');
    let W = null, L = null, tgt = 0, meRow = null;
    if (wid && lid) {
      const [w] = await Promise.all([sb.from('workouts').select('*').eq('id', wid).maybeSingle().then(must), loadBoard()]);
      W = w; L = w && (w.lifts || []).find(x => x.id === lid);
      meRow = boardRow(S.me.id) || { bw: num(S.me.bodyweight), sex: S.me.sex, bench: 0, squat: 0, dead: 0, clean: 0 };
      if (L) tgt = D.target(L, meRow) || 0;
    }
    let bar = 45; try { bar = +(localStorage.getItem('dsi.bar') || 45); } catch {}
    let say = true; try { say = localStorage.getItem('dsi.say') !== '0'; } catch {}

    if (!paint(tok, `<section class="sec tk"><div class="secHead"><div><div class="kicker">${L ? esc(fmtD(W.day)) + ' · ' + esc(W.title) : 'DSI Pro'}</div><h2>Plate <span>tracker</span></h2>
        <p class="secSub">${L ? esc(L.n) + ' · ' + esc(L.sch) + (tgt ? ` · target ${tgt} ${esc(D.unit(L))}` : '') : 'Prop your phone up with your whole body in the shot, from the side, about 10 feet back. Start the set and lift.'}</p></div>
        <a class="btn ghost sm" href="${L ? '/week/' + W.day : '/training'}">${L ? 'Back to the day' : 'My training'}</a></div>
      <div class="tkGrid">
        <div class="tkCam" id="tkCam">
          <video id="tkV" playsinline muted></video><canvas id="tkC" aria-hidden="true"></canvas>
          <div class="tkHud"><div class="tkN"><b id="tkN">0</b><span>reps</span></div><div class="tkWt"><b id="tkWv">${tgt || '·'}</b><span>lb</span></div></div>
          <p class="tkMsg" id="tkMsg" role="status">Tap Start camera</p>
        </div>
        <div class="tkSide">
          <div class="formCard tkCtl">
            <div class="fields">
              ${L ? '' : `<div class="field w2"><label for="tkLift">Lift</label><input id="tkLift" list="tkNames" maxlength="60" placeholder="Back squat" value="${esc(q.get('n') || '')}"></div>`}
              <div class="field w2"><label for="tkW">Weight (lb)</label><div class="tkStep"><button class="btn ghost sm" type="button" data-dw="-5" aria-label="5 pounds less">−5</button><input id="tkW" type="number" inputmode="decimal" min="0" max="1500" step="any" value="${tgt || ''}" placeholder="lb"><button class="btn ghost sm" type="button" data-dw="5" aria-label="5 pounds more">+5</button></div></div>
              <div class="field w2"><span class="lbl">Bar</span><div class="chips">${[45, 35, 15].map(b => `<button class="chip" type="button" data-bar="${b}" aria-pressed="${b === bar}">${b} lb</button>`).join('')}</div></div>
              <div class="field w2"><span class="lbl">Count out loud</span><label class="tog"><input type="checkbox" id="tkSay"${say ? ' checked' : ''}><span>Say each rep</span></label></div>
            </div>
            <p class="hint" id="tkRead" role="status"></p>
            <div class="tkBtns"><button class="btn" type="button" id="tkOn">Start camera</button><button class="btn ghost" type="button" id="tkPl" disabled>Read the plates</button><button class="btn" type="button" id="tkGo" disabled>Start set</button><button class="btn ghost sm" type="button" id="tkFlip" hidden>Flip camera</button></div>
          </div>
          <div class="formCard tkRev" id="tkRev" hidden>
            <span class="eyebrow">Set done</span>
            <div class="tkRevRow"><label class="vh" for="tkRr">Reps</label><input id="tkRr" type="number" inputmode="numeric" min="0" max="200"><span>reps ×</span><label class="vh" for="tkRw">Weight</label><input id="tkRw" type="number" inputmode="decimal" min="0" max="1500" step="any"><span>lb</span></div>
            <p class="hint" id="tkRt"></p>
            <div class="row"><button class="btn" type="button" id="tkKeep">Keep set</button><button class="btn ghost" type="button" id="tkToss">Toss it</button></div>
          </div>
          <div class="formCard"><div class="tkSetsHead"><span class="eyebrow">This session</span><span class="hint" id="tkTot"></span></div>
            <ol class="tkSets" id="tkSets"><li class="hint">Sets you keep show up here.</li></ol>
            <div class="row"><button class="btn" type="button" id="tkSave" disabled>${L ? 'Save to the workout' : 'Save to My training'}</button><span class="hint" id="tkSm" role="status"></span></div>
          </div>
        </div>
      </div>
      <datalist id="tkNames">${NAMES.map(n => `<option value="${esc(n)}">`).join('')}</datalist></section>`)) return;

    const V = $('#tkV'), C = $('#tkC'), ctx = C.getContext('2d'), msg = $('#tkMsg'), nEl = $('#tkN');
    const wIn = $('#tkW'), goB = $('#tkGo'), plB = $('#tkPl');
    const say1 = t => { if (!$('#tkSay').checked) return; try { speechSynthesis.cancel(); speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(t), { rate: 1.15 })); } catch {} };
    let ac = null;
    const beep = (f = 880, d = 0.12) => { try { ac = ac || new AudioContext(); const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f; g.gain.value = 0.15; o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + d); } catch {} };
    const showW = () => { $('#tkWv').textContent = num(wIn.value) ? fmt(num(wIn.value)) : '·'; };
    wIn.oninput = showW;
    $$('[data-dw]').forEach(b => b.onclick = () => { wIn.value = Math.max(0, num(wIn.value) + +b.dataset.dw); showW(); });
    $$('[data-bar]').forEach(b => b.onclick = () => { bar = +b.dataset.bar; try { localStorage.setItem('dsi.bar', bar); } catch {} $$('[data-bar]').forEach(x => x.setAttribute('aria-pressed', String(+x.dataset.bar === bar))); });
    $('#tkSay').onchange = e => { try { localStorage.setItem('dsi.say', e.target.checked ? '1' : '0'); } catch {} };
    const liftName = () => (L ? L.n : ($('#tkLift').value || '').trim());

    let stream = null, facing = 'environment', pose = null, raf = 0, lastT = -1, wake = null, nextAt = 0;
    let phase = 'off', tk = null, rec = null, chunks = [], lastRepAt = 0, setStart = 0, pending = null;
    const sets = [];
    const alive = () => tok === S.tok && document.body.contains(V);
    const stopAll = () => {
      cancelAnimationFrame(raf); raf = 0;
      try { rec && rec.state !== 'inactive' && rec.stop(); } catch {}
      if (stream) stream.getTracks().forEach(t => t.stop()); stream = null;
      try { wake && wake.release(); } catch {} wake = null;
      try { speechSynthesis.cancel(); } catch {}
    };

    const startCam = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msg.textContent = 'This browser cannot use the camera. Open dandystrength.com in Safari or Chrome.'; return; }
      $('#tkOn').disabled = true; msg.textContent = 'Starting the camera…';
      try {
        if (stream) stream.getTracks().forEach(t => t.stop());
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch (e) {
        $('#tkOn').disabled = false;
        msg.textContent = /denied|allowed|permission/i.test(e.message || e.name) ? 'Camera blocked. Allow the camera for dandystrength.com in your browser settings, then try again.' : 'No camera found.';
        return;
      }
      if (!alive()) return stopAll();
      V.srcObject = stream; await V.play().catch(() => {});
      $('#tkCam').classList.toggle('mirror', facing === 'user');
      $('#tkOn').hidden = true; $('#tkFlip').hidden = false; plB.disabled = false;
      try { wake = await navigator.wakeLock.request('screen'); } catch {}
      msg.textContent = 'Loading the rep counter…';
      try { pose = await loadPose(); } catch (e) { console.error(e); msg.textContent = 'The rep counter did not load. Check your connection and reload.'; return; }
      if (!alive()) return stopAll();
      goB.disabled = false; phase = 'ready';
      msg.textContent = 'Step into the shot, then tap Start set';
      if (!raf) loop();
    };
    $('#tkOn').onclick = startCam;
    $('#tkFlip').onclick = () => { facing = facing === 'user' ? 'environment' : 'user'; startCam(); };

    // One frame: find the lifter (the biggest person in the shot), draw them, feed the counter.
    const vis = p => p && (p.visibility == null || p.visibility > 0.5);
    const mid = (a, b) => (vis(a) && vis(b) ? (a.y + b.y) / 2 : vis(a) ? a.y : vis(b) ? b.y : null);
    function loop() {
      raf = requestAnimationFrame(loop);
      if (!alive()) return stopAll();
      if (!pose || V.readyState < 2 || V.currentTime === lastT) return;
      const now = performance.now();
      if (now < nextAt) return; // slower phones: leave time between frames so the page stays responsive
      lastT = V.currentTime;
      let res; try { res = pose.detectForVideo(V, now); } catch { return; }
      nextAt = now + Math.max(0, (performance.now() - now) * 1.5);
      const vw = V.videoWidth, vh = V.videoHeight;
      if (C.width !== vw) { C.width = vw; C.height = vh; }
      ctx.clearRect(0, 0, vw, vh);
      const ar = vw / vh;
      const torsoOf = lm => { const sx = (lm[11].x + lm[12].x) / 2, sy = (lm[11].y + lm[12].y) / 2, hx = (lm[23].x + lm[24].x) / 2, hy = (lm[23].y + lm[24].y) / 2; return Math.hypot((sx - hx) * ar, sy - hy); };
      const lm = (res.landmarks || []).reduce((a, x) => (!a || torsoOf(x) > torsoOf(a) ? x : a), null);
      if (!lm) { if (phase === 'ready') msg.textContent = 'Step into the shot, whole body, from the side'; return; }
      ctx.lineWidth = Math.max(3, vh / 180); ctx.strokeStyle = 'rgba(242,201,76,.9)'; ctx.fillStyle = '#F2C94C';
      for (const [a, b] of BONES) if (vis(lm[a]) && vis(lm[b])) { ctx.beginPath(); ctx.moveTo(lm[a].x * vw, lm[a].y * vh); ctx.lineTo(lm[b].x * vw, lm[b].y * vh); ctx.stroke(); }
      for (const i of [15, 16]) if (vis(lm[i])) { ctx.beginPath(); ctx.arc(lm[i].x * vw, lm[i].y * vh, vh / 70, 0, 7); ctx.fill(); }
      if (phase === 'ready') msg.textContent = 'You are in. Tap Start set when ready';
      if (phase !== 'arming' && phase !== 'counting') return;
      const f = { wrist: mid(lm[15], lm[16]), shoulder: mid(lm[11], lm[12]), hip: mid(lm[23], lm[24]), torso: torsoOf(lm) };
      const wasArmed = tk.armed;
      const r = tk.push(f, now);
      if (!wasArmed && tk.armed) { phase = 'counting'; lastRepAt = now; msg.textContent = 'Go'; beep(660, 0.2); }
      if (r.rep) { nEl.textContent = r.count; lastRepAt = now; say1(String(r.count)); nEl.parentElement.classList.remove('pop'); void nEl.offsetWidth; nEl.parentElement.classList.add('pop'); }
      // Rack it and rest: after 10 quiet seconds the set ends on its own.
      if (phase === 'counting' && r.count > 0 && now - lastRepAt > 10000) endSet();
    }

    const startSet = () => {
      tk = repTracker(); phase = 'arming'; nEl.textContent = '0'; setStart = performance.now();
      $('#tkRev').hidden = true; goB.textContent = 'End set'; goB.classList.add('danger');
      msg.textContent = 'Get set and hold still…'; beep(520, 0.1); say1('Get set');
      chunks = []; rec = null;
      try {
        const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
        if (type) { rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 2500000 }); rec.ondataavailable = e => e.data.size && chunks.push(e.data); rec.start(1000); }
      } catch { rec = null; }
    };
    const endSet = () => {
      if (phase !== 'arming' && phase !== 'counting') return;
      const res = tk.result(); phase = 'review';
      goB.textContent = 'Start set'; goB.classList.remove('danger');
      msg.textContent = 'Set done'; beep(440, 0.25);
      const done = new Promise(ok => { if (rec && rec.state !== 'inactive') { rec.onstop = () => ok(new Blob(chunks, { type: rec.mimeType.split(';')[0] })); rec.stop(); } else ok(null); });
      pending = { r: res.reps, times: res.times, clip: done, secs: Math.round((performance.now() - setStart) / 1000) };
      $('#tkRr').value = res.reps; $('#tkRw').value = num(wIn.value) || '';
      $('#tkRt').textContent = res.times.length ? `Lift time per rep: ${res.times.map(x => x + 's').join(', ')}${slow(res.times)}` : 'No reps counted. Type the reps if it missed them.';
      $('#tkRev').hidden = false; $('#tkRr').focus({ preventScroll: true });
      if (res.reps) say1(`${res.reps} reps`);
    };
    const slow = t => { if (t.length < 3) return ''; const a = (t[0] + t[1]) / 2, z = t[t.length - 1]; const p = Math.round((z / a - 1) * 100); return p >= 10 ? `. Last rep ${p}% slower than your first.` : ''; };
    goB.onclick = () => (phase === 'arming' || phase === 'counting' ? endSet() : startSet());

    const drawSets = () => {
      $('#tkSets').innerHTML = sets.length ? sets.map((s, i) => `<li><span class="tkSn">${i + 1}</span><b>${esc(s.name || 'Set')}</b><span class="tkSv">${s.w ? fmt(s.w) : 'BW'} × ${s.r}</span>${s.times.length ? `<span class="hint">${s.times.map(x => x + 's').join(' ')}</span>` : '<span></span>'}<span class="row">${s.url ? `<a class="btn ghost sm" href="${s.url}" download="dsi-set-${i + 1}.${s.ext}">Clip</a>` : ''}<button class="trRm" type="button" data-rm="${i}" aria-label="Remove set ${i + 1}">×</button></span></li>`).join('') : '<li class="hint">Sets you keep show up here.</li>';
      const vol = sets.reduce((a, s) => a + s.r * s.w, 0);
      $('#tkTot').textContent = sets.length ? `${sets.length} set${sets.length === 1 ? '' : 's'} · ${fmt(vol)} lb moved` : '';
      $('#tkSave').disabled = !sets.length;
      $$('[data-rm]').forEach(b => b.onclick = () => { const s = sets.splice(+b.dataset.rm, 1)[0]; if (s && s.url) URL.revokeObjectURL(s.url); drawSets(); });
    };
    $('#tkKeep').onclick = async () => {
      const r = Math.max(0, Math.round(num($('#tkRr').value))), w = Math.max(0, Math.round(num($('#tkRw').value) * 2) / 2);
      if (!r) { $('#tkRt').textContent = 'Enter how many reps.'; return; }
      if (!L && !liftName()) { $('#tkRt').textContent = 'Name the lift up top first.'; $('#tkLift').focus(); return; }
      const p = pending; pending = null; $('#tkRev').hidden = true; phase = 'ready'; msg.textContent = 'Rest up. Tap Start set for the next one';
      const clip = p && await p.clip;
      const ext = clip ? (/mp4/.test(clip.type) ? 'mp4' : 'webm') : '';
      sets.push({ name: liftName(), r, w, times: (p && p.times) || [], clip, ext, url: clip ? URL.createObjectURL(clip) : '' });
      if (w) { wIn.value = w; showW(); }
      drawSets();
    };
    $('#tkToss').onclick = () => { pending = null; $('#tkRev').hidden = true; phase = 'ready'; msg.textContent = 'Tossed. Tap Start set when ready'; };

    // Read the plates: one still frame to the plate reader, then the lifter checks it.
    plB.onclick = async () => {
      const out = $('#tkRead');
      if (!V.videoWidth) return;
      plB.disabled = true; out.textContent = 'Reading the plates…';
      const k = Math.min(1, 1280 / Math.max(V.videoWidth, V.videoHeight)), cv = document.createElement('canvas');
      cv.width = Math.round(V.videoWidth * k); cv.height = Math.round(V.videoHeight * k);
      cv.getContext('2d').drawImage(V, 0, 0, cv.width, cv.height);
      const image = cv.toDataURL('image/jpeg', 0.85);
      const { data, error } = await sb.functions.invoke('read-plates', { body: { image, bar, lift: liftName() } });
      plB.disabled = false;
      const err = error ? ((await error.context?.json?.().catch(() => null)) || {}).error || error.message : data && data.error;
      if (err) { out.textContent = err; return; }
      if (!data.total) { out.textContent = `${data.label || 'No weight seen'}. Get closer so the plates fill the picture, or type it in.`; return; }
      wIn.value = data.total; showW();
      out.innerHTML = `<b>${fmt(data.total)} lb</b> · ${esc(data.label)}${data.confidence !== 'high' ? ' · <b>check this</b>' : ''}${data.note ? ' · ' + esc(data.note) : ''}`;
      say1(`${fmt(data.total)} pounds`);
    };

    // Save: to the workout this came from, or to today's Plate tracker session in My training.
    $('#tkSave').onclick = async () => {
      const sm = $('#tkSm'), btn = $('#tkSave'); btn.disabled = true; sm.textContent = 'Saving…';
      try {
        const prs = L ? await saveWorkout() : await saveTraining();
        sets.forEach(s => s.url && URL.revokeObjectURL(s.url)); sets.length = 0; drawSets();
        if (prs.length === 1 && prs[0].id) { toast(`New PR: ${prs[0].label}`); go('/pr/' + prs[0].id + '?celebrate=1'); return stopAll(); }
        sm.textContent = prs.length ? `Saved. New PRs: ${prs.map(p => p.label).join(', ')}` : 'Saved.';
        toast(L ? 'Sets saved to the workout' : 'Saved to My training');
      } catch (e) { sm.textContent = e.message || String(e); btn.disabled = false; }
    };
    const putClip = async (entryId, s) => {
      if (!s || !s.clip) return;
      const path = `${S.me.id}/${entryId}.${s.ext}`;
      const up = await sb.storage.from('lift-videos').upload(path, s.clip, { contentType: s.clip.type, upsert: true });
      if (!up.error) await sb.from('lift_entries').update({ video_path: path }).eq('id', entryId);
    };
    const prIfBest = async (lift, s, day, note) => {
      const Lk = D.LIFT_BY_DB[lift]; await loadBoard();
      let best = Lk ? num((boardRow(S.me.id) || {})[Lk.k]) : 0;
      if (!Lk) { const q2 = await sb.from('lift_entries').select('weight_lb').eq('profile_id', S.me.id).eq('lift', lift).neq('status', 'struck').order('weight_lb', { ascending: false }).limit(1); best = num(((q2.data || [])[0] || {}).weight_lb); }
      if (s.w <= best) return null;
      const { data, error } = await sb.from('lift_entries').insert({ profile_id: S.me.id, lift, weight_lb: s.w, performed_on: day, source: 'workout', note }).select().single();
      if (error || !data || !data.is_pr) return null;
      await putClip(data.id, s);
      return { id: data.id, label: `${D.liftName(lift)} ${fmt(s.w)} lb` };
    };
    async function saveTraining() {
      const day = today();
      const ex = [];
      for (const s of sets) { let e = ex.find(x => x.name.toLowerCase() === s.name.toLowerCase()); if (!e) ex.push(e = { name: s.name.slice(0, 60), lift: liftFor(s.name), sets: [] }); e.sets.push({ r: Math.min(200, s.r), w: s.w }); }
      const cur = must(await sb.from('personal_workouts').select('*').eq('profile_id', S.me.id).eq('day', day).eq('title', 'Plate tracker').limit(1).maybeSingle());
      if (cur) {
        const all = cur.exercises || [];
        for (const e of ex) { const m = all.find(x => x.name.toLowerCase() === e.name.toLowerCase()); if (m) m.sets = [...(m.sets || []), ...e.sets]; else all.push(e); }
        must(await sb.from('personal_workouts').update({ exercises: all.slice(0, 40) }).eq('id', cur.id).select().single());
      } else must(await sb.from('personal_workouts').insert({ profile_id: S.me.id, day, title: 'Plate tracker', exercises: ex }).select().single());
      // Heavy singles on a catalog lift become PRs, with the clip as proof.
      const prs = [];
      for (const e of ex) {
        if (!e.lift) continue;
        const top = sets.filter(s => s.r === 1 && s.name.toLowerCase() === e.name.toLowerCase()).sort((a, b) => b.w - a.w)[0];
        if (top) { const p = await prIfBest(e.lift, top, day, 'Plate tracker'); if (p) prs.push(p); }
      }
      return prs;
    }
    async function saveWorkout() {
      const cur = must(await sb.from('workout_logs').select('*').eq('workout_id', W.id).eq('profile_id', S.me.id).maybeSingle());
      const prev = ((cur && cur.sets) || {})[L.id] || [];
      const done = [...prev, ...sets.map(s => ({ w: s.w, r: s.r }))];
      const top = done.reduce((a, x) => Math.max(a, num(x.w)), 0);
      const entries = { ...((cur && cur.entries) || {}) }; if (top) entries[L.id] = top;
      const { error } = await sb.from('workout_logs').upsert({ workout_id: W.id, profile_id: S.me.id, entries, sets: { ...((cur && cur.sets) || {}), [L.id]: done }, score: cur ? cur.score : null }, { onConflict: 'workout_id,profile_id' });
      if (error) throw error;
      if (L.max && W.pr_lift) { const s = [...sets].sort((a, b) => b.w - a.w)[0]; const p = s && await prIfBest(W.pr_lift, s, W.day, `${W.title}, Plate tracker`); return p ? [p] : []; }
      return [];
    }
  };
}
