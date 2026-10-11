// /connect          Connected apps (DSI Pro): WHOOP here; Apple Health and Health Connect from the phone app.
// /connect/whoop    where WHOOP sends the member back after they say yes.
// X.wear.card(...)  the readiness card My training shows.

export function install(X) {
  const { sb, S, D, VIEWS, $, $$, esc, fmt, today, fmtD, toast, paint, needLogin, go, isPro } = X;
  const NAMES = { whoop: 'WHOOP', apple: 'Apple Health', health_connect: 'Health Connect' };
  const ago = t => { if (!t) return 'not yet'; const m = Math.round((Date.now() - Date.parse(t)) / 60000); return m < 2 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : fmtD(String(t).slice(0, 10)); };
  const call = async body => {
    const { data, error } = await sb.functions.invoke('whoop', { body });
    if (error) { const j = await error.context?.json?.().catch(() => null); throw new Error((j && j.error) || error.message); }
    if (data && data.error) throw new Error(data.error);
    return data;
  };
  const load = async () => {
    const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
    const [l, d] = await Promise.all([sb.from('wearable_links').select('*').eq('profile_id', S.me.id), sb.from('wearable_days').select('*').eq('profile_id', S.me.id).gte('day', since).order('day', { ascending: false })]);
    const off = e => e && (e.code === '42P01' || e.code === 'PGRST205' || /wearable_/.test(e.message || ''));
    if (off(l.error) || off(d.error)) return { links: [], rows: [], off: true };
    return { links: l.data || [], rows: d.data || [] };
  };

  // Readiness card: today's score and what to do with it, plus the last two weeks.
  function card(r, links) {
    if (!r.today) {
      return `<div class="formCard wrCard"><span class="eyebrow">Readiness</span>
        <p class="wrNone">${links.length ? 'No reading for today yet. It shows up after your watch or strap scores last night.' : 'Connect WHOOP, Apple Health or Health Connect and every morning you get a green, yellow or red day, plus what it means for your lifting.'}</p>
        <a class="btn ghost sm" href="/connect">${links.length ? 'Connected apps' : 'Connect an app'}</a></div>`;
    }
    const t = r.today, bars = r.days.slice(0, 14).reverse();
    const facts = [t.hrv_ms != null && `<div><b>${fmt(Math.round(t.hrv_ms))}</b><span>HRV ms${t.hrvAvg ? ` · avg ${t.hrvAvg}` : ''}</span></div>`, t.rhr != null && `<div><b>${t.rhr}</b><span>Resting HR</span></div>`,
      t.sleep_hours != null && `<div><b>${(+t.sleep_hours).toFixed(1)}</b><span>Hours of sleep</span></div>`, t.strain != null && `<div><b>${(+t.strain).toFixed(1)}</b><span>Strain</span></div>`].filter(Boolean).join('');
    return `<div class="formCard wrCard wr-${t.zone}">
      <div class="wrTop"><div class="wrScore"><b>${t.score}</b><span>${esc(t.label)}</span></div>
        <div><span class="eyebrow">Readiness · ${esc(t.day === today() ? 'today' : fmtD(t.day))}</span><p class="wrAdvice">${esc(t.advice)}</p><p class="hint">${esc(t.how)}${t.src === 'whoop' ? '' : ' · ' + esc(NAMES[t.src] || t.src)}</p></div></div>
      ${facts ? `<div class="wrFacts">${facts}</div>` : ''}
      <div class="wrBars" aria-label="Readiness the last two weeks">${bars.map(d => `<i class="${d.score ? (d.score.v >= 67 ? 'up' : d.score.v >= 34 ? 'flat' : 'down') : ''}" style="height:${d.score ? Math.max(8, d.score.v) : 4}%" title="${esc(fmtD(d.day))}${d.score ? ': ' + d.score.v : ''}"></i>`).join('')}</div>
    </div>`;
  }
  X.wear = { card, load };

  VIEWS.connect = async (sub, tok) => {
    if (!S.me) return needLogin(tok, 'connect your apps');
    const q = new URLSearchParams(location.search);
    if (sub === 'whoop' && (q.get('code') || q.get('error'))) {
      paint(tok, '<section class="prEmpty"><b>Connecting WHOOP…</b><p>Pulling your last month of recovery, sleep and strain.</p></section>');
      try {
        if (q.get('error')) throw new Error(q.get('error') === 'access_denied' ? 'WHOOP was not connected.' : q.get('error_description') || q.get('error'));
        const r = await call({ action: 'finish', code: q.get('code'), state: q.get('state') });
        toast(`WHOOP connected${r.days ? `, ${r.days} days pulled in` : ''}`);
      } catch (e) { toast(e.message); }
      history.replaceState(null, '', '/connect');
      return VIEWS.connect('', tok);
    }
    const pro = isPro();
    const { links, rows, off } = await load();
    const link = p => links.find(l => l.provider === p);
    const r = D.readiness(rows, today());
    const w = link('whoop');
    const tile = (p, body, act) => `<div class="formCard wrApp"><div class="wrAppHead"><b>${esc(NAMES[p] || p)}</b>${link(p) ? `<span class="pill ${link(p).status === 'ok' ? 'up' : 'down'}">${link(p).status === 'ok' ? 'Connected' : 'Reconnect'}</span>` : ''}</div><p>${body}</p>${act ? `<div class="row">${act}</div>` : ''}</div>`;
    if (!paint(tok, `<section class="sec"><div class="secHead"><div><div class="kicker">DSI Pro</div><h2>Connected <span>apps</span></h2>
        <p class="secSub">Bring in your recovery, HRV, resting heart rate and sleep. Every morning you get a readiness call for your lifting. Only you can see this.</p></div></div>
      ${off ? '<p class="hint">Connected apps switch on with today\'s update. Check back shortly.</p>' : ''}
      <div class="wrGrid">
        <div>${card(r, links)}</div>
        <div class="wrApps">
          ${tile('whoop', w ? `Last sync ${esc(ago(w.last_sync))}. New scores come in on their own each morning.` : 'Recovery, HRV, resting heart rate, sleep and strain from your WHOOP strap.',
            !pro ? '<a class="btn sm" href="/pro">Get DSI Pro</a>' : w ? '<button class="btn ghost sm" type="button" id="wSync">Sync now</button><button class="btn ghost sm" type="button" id="wOff">Disconnect</button>' : '<button class="btn sm" type="button" id="wOn">Connect WHOOP</button>')}
          ${tile('apple', link('apple') ? `Last sync ${esc(ago(link('apple').last_sync))} from the iPhone app.` : 'HRV, resting heart rate, sleep and bodyweight from your Apple Watch, Oura, Garmin or anything else that writes to Apple Health. Turn it on in the Dandy iPhone app under Settings, Connected apps. Your DSI sessions show up in Health as strength workouts.')}
          ${tile('health_connect', link('health_connect') ? `Last sync ${esc(ago(link('health_connect').last_sync))} from the Android app.` : 'The same from Android: Samsung Health, Fitbit, Garmin, Oura and the rest through Health Connect. Turn it on in the Dandy Android app under Settings, Connected apps.')}
          <div class="formCard wrApp"><div class="wrAppHead"><b>Google Fit</b></div><p>Google is shutting Google Fit down and moving everything to Health Connect. If you use Google Fit, connect Health Connect in the Android app and your data comes along.</p></div>
        </div>
      </div>
      ${r.days.length ? `<section class="sec"><h3 class="hmH3">The last two weeks</h3><div class="tablewrap"><table class="wrTable"><thead><tr><th>Day</th><th class="r">Readiness</th><th class="r">HRV</th><th class="r">Resting HR</th><th class="r">Sleep</th><th class="r">Strain</th><th>From</th></tr></thead><tbody>
        ${r.days.slice(0, 14).map(d => `<tr><td>${esc(fmtD(d.day))}</td><td class="r n">${d.score ? d.score.v : '·'}</td><td class="r n">${d.hrv_ms != null ? Math.round(d.hrv_ms) : '·'}</td><td class="r n">${d.rhr ?? '·'}</td><td class="r n">${d.sleep_hours != null ? (+d.sleep_hours).toFixed(1) + ' h' : '·'}</td><td class="r n">${d.strain != null ? (+d.strain).toFixed(1) : '·'}</td><td class="sub">${esc(NAMES[d.src] || d.src)}</td></tr>`).join('')}
      </tbody></table></div></section>` : ''}
    </section>`)) return;
    const busy = (b, t) => { b.disabled = true; b.textContent = t; };
    const on = $('#wOn'); if (on) on.onclick = async () => { busy(on, 'Opening WHOOP…'); try { const { url } = await call({ action: 'start' }); location.href = url; } catch (e) { toast(e.message); on.disabled = false; on.textContent = 'Connect WHOOP'; } };
    const sy = $('#wSync'); if (sy) sy.onclick = async () => { busy(sy, 'Syncing…'); try { const x = await call({ action: 'sync' }); toast(`Synced ${x.days} day${x.days === 1 ? '' : 's'}`); } catch (e) { toast(e.message); } VIEWS.connect('', S.tok); };
    const of = $('#wOff'); if (of) of.onclick = async () => {
      if (of.dataset.sure !== '1') { of.dataset.sure = '1'; of.textContent = 'Tap again to disconnect'; return; }
      busy(of, 'Disconnecting…'); try { await call({ action: 'disconnect' }); toast('WHOOP disconnected'); } catch (e) { toast(e.message); } VIEWS.connect('', S.tok);
    };
    // Quietly refresh WHOOP if it has been more than an hour.
    if (pro && w && w.status === 'ok' && (!w.last_sync || Date.now() - Date.parse(w.last_sync) > 3600000)) call({ action: 'sync' }).then(x => { if (x.days && tok === S.tok) VIEWS.connect('', tok); }).catch(() => {});
  };
}
