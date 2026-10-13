// Dandy TV: a gym's two screens and the page that sets them up.
// /tv/<gym>       Class TV (gym.js): the workout, every member's targets, the day board, leaderboards.
// /lobby/<gym>    Lobby TV: slides the gym picks (schedule, PRs, events, offers), each with its own QR code.
// /dandytv/<gym>  Setup, staff only: both links with QR codes, which class screens show, and the lobby slides.
// Settings live in gym_tv; both boards read them every minute, so edits show up on the TVs on their own.
import qrcode from './vendor/qr.js';

export function install(X) {
  const { sb, S, VIEWS, $, $$, esc, num, fmt, toast, must, paint, needLogin, go, route, today, addDays, D } = X;
  const SITE = 'https://dandystrength.com';
  const isStaff = gid => (S.me && S.me.role === 'admin') || (S.myGyms || []).some(g => g.gym_id === gid);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  async function gymOf(key) {
    const q = sb.from('gyms').select('*');
    const g = must(await (UUID.test(key || '') ? q.eq('id', key) : q.eq('slug', String(key || '').toLowerCase())).maybeSingle());
    if (!g) throw new Error('No gym here.');
    return g;
  }
  const keyOf = g => g.slug || g.id;
  const links = g => ({ cls: `${SITE}/tv/${keyOf(g)}`, lobby: `${SITE}/lobby/${keyOf(g)}` });
  async function cfgOf(gid) {
    const r = await sb.from('gym_tv').select('*').eq('gym_id', gid).maybeSingle();
    return r.error ? null : r.data;
  }

  /* ---------- QR codes as crisp SVG ---------- */
  function qrSvg(text, fg = '#0A1430') {
    if (!text) return '';
    try {
      const q = qrcode(0, 'M'); q.addData(String(text)); q.make();
      const n = q.getModuleCount(); let d = '';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" role="img" aria-label="QR code for ${esc(text)}"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="${fg}"/></svg>`;
    } catch { return ''; }
  }
  X.qrSvg = qrSvg;

  /* ---------- class TV screens the gym can switch off ---------- */
  const CLASS_SCREENS = [['wod', 'Workout of the day', 'Parts A to D, tap a part to show it big with its timer'], ['targets', "Today's targets", "Every member's weight, built from their own PRs"], ['today', "Today's board", 'Live results as people log'], ['yesterday', "Yesterday's results", 'How the last class went'], ['leaders', 'Leaderboards', "Men's and women's best lifts and DSI"], ['last30', 'Last 30 days', 'DSI gained, battles and new PRs']];
  X.tvConfig = cfgOf;

  /* ---------- lobby slides ---------- */
  const TYPES = {
    schedule: { n: "Today's classes", d: 'Your class times and coaches, with the next class lit up', live: true },
    prs: { n: 'PRs this week', d: "Your members' new personal records", live: true },
    leaders: { n: 'Gym leaderboard', d: 'Top DSI scores in your gym', live: true },
    shop: { n: 'Gym shop', d: 'What is in the fridge, with a QR to buy', live: true },
    free_class: { n: 'Free class offer', d: 'Bring a friend, first class free' },
    event: { n: 'Event', d: 'A date, a countdown and a QR to sign up' },
    review: { n: 'Review ask', d: 'Five stars and a QR to your Google reviews' },
    text_us: { n: 'Text us', d: 'Your number big, and a QR that opens messages' },
    custom: { n: 'Your own message', d: 'Any headline, words and link' },
  };
  const uid = () => Math.random().toString(36).slice(2, 10);
  function starter(type, g) {
    const k = keyOf(g), base = { id: uid(), type, on: true };
    return {
      schedule: base, prs: base, leaders: base,
      shop: { ...base, title: 'Grab a drink', text: 'Water, protein and snacks in the fridge. Put it on your tab.', url: `${SITE}/shop/${g.id}`, cta: 'Scan to buy' },
      free_class: { ...base, title: 'Bring a friend. First class is free.', text: 'Coached workouts for every level. We scale every movement, every day.', chips: 'Free intro class, Every level, 7 days a week', url: `${SITE}/gyms/${k}`, cta: 'Scan to book' },
      event: { ...base, title: 'Partner WOD', text: 'Teams of two, every level welcome. Bring a friend free.', date: addDays(today(), 14) + 'T09:00', chips: 'Free, Teams of two', url: `${SITE}/gyms/${k}`, cta: 'Scan to sign up' },
      review: { ...base, title: `Love ${g.name}?`, text: 'A quick Google review helps more people find their community gym.', url: '', cta: 'Scan to review' },
      text_us: { ...base, title: 'Questions? Text us.', text: 'A coach answers fast. Class times, pricing, personal training, anything.', phone: g.phone || '', cta: 'Scan to text' },
      custom: { ...base, title: 'Your headline', text: 'A line or two about it.', url: '', cta: 'Scan for more' },
    }[type];
  }
  const defaults = g => ['schedule', 'prs', 'free_class', 'leaders', 'shop', 'text_us'].map(t => starter(t, g)).filter(s => s.type !== 'text_us' || s.phone);
  const qrOf = s => s.type === 'text_us' ? (s.phone ? 'sms:' + String(s.phone).replace(/[^0-9+]/g, '') : '') : (s.url || '');

  async function lobbyData(g) {
    const gid = g.id, now = new Date(), wk = addDays(today(), -6);
    const [members, classes, items] = await Promise.all([
      sb.from('profiles').select('id,display_name').eq('gym_id', gid).not('display_name', 'is', null).then(must),
      sb.from('classes').select('*').eq('gym_id', gid).then(r => (r.error ? [] : (r.data || []).filter(c => c.active !== false))),
      sb.from('shop_items').select('name,emoji,price_cents,stock,active').eq('gym_id', gid).eq('active', true).order('sort').limit(8).then(r => (r.error ? [] : r.data || [])),
    ]);
    const ids = members.map(m => m.id);
    const prs = ids.length ? must(await sb.from('lift_entries').select('profile_id,lift,weight_lb,prev_best,performed_on').in('profile_id', ids).eq('is_pr', true).not('prev_best', 'is', null).neq('status', 'struck').gte('performed_on', wk).order('performed_on', { ascending: false }).limit(9)) : [];
    let board = [];
    try { await X.loadBoard(); board = (S.board || []).filter(r => ids.includes(r.profile_id) && r.score).sort((a, b) => b.score - a.score).slice(0, 6); } catch {}
    const coachIds = [...new Set(classes.map(c => c.coach_id).filter(Boolean))];
    const coaches = coachIds.length ? new Map(must(await sb.from('profiles').select('id,display_name').in('id', coachIds)).map(p => [p.id, p.display_name])) : new Map();
    const nameOf = id => (members.find(m => m.id === id) || {}).display_name || 'Member';
    const dayClasses = d => classes.filter(c => (c.weekdays || []).includes(d.getDay())).sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))
      .map(c => { const [h, m] = String(c.start_time).split(':').map(Number); return { start: h * 60 + m, len: c.duration_min || 60, name: c.name || 'Class', coach: coaches.get(c.coach_id) || '' }; });
    return { members, prs, board, items, nameOf, today: dayClasses(now), tomorrow: dayClasses(new Date(now.getTime() + 864e5)) };
  }

  const LOBBY_CSS = `
  .lbWrap{position:fixed;inset:0;background:#05091A;overflow:hidden;z-index:5}
  .lbStage{--bg:#0A1430;--bg2:#101D3A;--panel:#162647;--line:#243760;--fg:#EEF2F8;--muted:#9AA8C2;--ac:#F7C531;--acf:#0A1430;--ok:#3DBE7A;
    width:1920px;height:1080px;position:absolute;left:50%;top:50%;background:var(--bg);color:var(--fg);overflow:hidden;transform-origin:center center;display:grid;grid-template-rows:120px 1fr 110px;font-family:var(--sans)}
  .lbStage::before{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px) 0 0/160px 160px,linear-gradient(0deg,rgba(255,255,255,.025) 1px,transparent 1px) 0 0/160px 160px;pointer-events:none}
  .lbTop{display:grid;grid-template-columns:repeat(12,1fr);gap:32px;align-items:center;padding:0 80px;border-bottom:2px solid var(--line);position:relative;z-index:2}
  .lbLogo{grid-column:1/span 7;display:flex;align-items:center;gap:22px}.lbLogo img{width:72px;height:72px}
  .lbLogo b{font:900 52px/1 var(--disp);letter-spacing:.03em;text-transform:uppercase}.lbLogo span{font:600 22px var(--mono);letter-spacing:.14em;color:var(--muted);text-transform:uppercase}
  .lbClock{grid-column:8/span 5;justify-self:end;display:flex;align-items:baseline;gap:24px}.lbClock b{font:800 64px/1 var(--disp);font-variant-numeric:tabular-nums}.lbClock span{font:600 24px var(--mono);letter-spacing:.1em;color:var(--muted);text-transform:uppercase}
  .lbSlides{position:relative;z-index:1}
  .lbSlide{position:absolute;inset:0;padding:60px 80px 44px;display:grid;grid-template-columns:repeat(12,1fr);column-gap:32px;align-items:center;opacity:0;transform:translateY(24px);transition:opacity .7s ease,transform .7s ease}
  .lbSlide.on{opacity:1;transform:none}
  @media (prefers-reduced-motion:reduce){.lbSlide{transition:opacity .3s linear;transform:none}}
  .lbMain{grid-column:1/span 7;display:grid;gap:28px;align-content:center}.lbMain.full{grid-column:1/-1}
  .lbSide{grid-column:8/span 5;display:grid;justify-items:center;gap:20px}
  .lbKick{font:600 26px var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--ac);display:flex;gap:16px;align-items:center}.lbKick i{width:44px;height:4px;background:var(--ac)}
  .lbStage h1{font:900 132px/.9 var(--disp);text-transform:uppercase;margin:0;text-wrap:balance}.lbStage h1.m{font-size:104px}.lbStage h1 em{font-style:normal;color:var(--ac)}
  .lbLede{font:500 38px/1.3 var(--sans);color:color-mix(in srgb,var(--fg) 82%,transparent);max-width:30ch;margin:0}
  .lbChips{display:flex;gap:16px;flex-wrap:wrap}.lbChip{font:700 26px var(--sans);padding:12px 24px;border-radius:999px;border:2px solid var(--line);background:var(--panel)}.lbChip.y{background:var(--ac);color:var(--acf);border-color:var(--ac)}
  .lbQr{background:#fff;border-radius:28px;padding:28px;width:430px;display:grid;justify-items:center;box-shadow:0 30px 80px rgba(0,0,0,.45)}.lbQr svg{width:374px;height:374px;display:block}
  .lbScan{font:900 54px/1 var(--disp);text-transform:uppercase;text-align:center}.lbScan small{display:block;font:500 24px var(--sans);text-transform:none;color:var(--muted);margin-top:8px;max-width:420px;overflow-wrap:anywhere}
  .lbCount{display:flex;gap:20px}.lbCount div{background:var(--panel);border:2px solid var(--line);border-radius:20px;padding:18px 26px;min-width:170px;display:grid;gap:4px}.lbCount b{font:900 96px/1 var(--disp);font-variant-numeric:tabular-nums}.lbCount span{font:600 20px var(--mono);letter-spacing:.14em;color:var(--muted);text-transform:uppercase}
  .lbGrid{grid-column:1/-1;display:grid;grid-template-columns:repeat(12,1fr);gap:28px;align-content:center;align-self:stretch}
  .lbGrid .hd{grid-column:1/-1;display:flex;justify-content:space-between;align-items:end}
  .lbRow{grid-column:span 4;background:var(--panel);border:2px solid var(--line);border-radius:22px;padding:24px 30px;display:grid;gap:8px;position:relative}
  .lbRow b{font:900 68px/1 var(--disp);font-variant-numeric:tabular-nums}.lbRow span{font:600 28px var(--sans);color:var(--muted)}
  .lbRow.past{opacity:.38}.lbRow.next{background:var(--ac);color:var(--acf);border-color:var(--ac)}.lbRow.next span{color:var(--acf)}
  .lbRow .tag{position:absolute;top:22px;right:24px;font:700 20px var(--mono);letter-spacing:.1em;text-transform:uppercase}
  .lbPr{grid-column:span 4;background:var(--panel);border:2px solid var(--line);border-radius:22px;padding:24px 28px;display:grid;grid-template-columns:auto 1fr;gap:6px 22px;align-items:center}
  .lbPlate{grid-row:span 3;width:92px;height:92px;border-radius:50%;border:10px solid var(--ac);display:grid;place-items:center;font:900 22px var(--disp);color:var(--ac)}
  .lbPr b{font:800 40px/1 var(--disp);text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lbPr .w{font:900 56px/1 var(--disp);color:var(--ac);font-variant-numeric:tabular-nums}.lbPr .w small{font:600 24px var(--sans);color:var(--muted)}.lbPr span{font:500 24px var(--sans);color:var(--muted)}
  .lbRank{font:900 64px/1 var(--disp);color:var(--ac);grid-row:span 2}
  .lbItems{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}.lbItem{background:var(--panel);border:2px solid var(--line);border-radius:20px;padding:20px;display:grid;justify-items:center;gap:6px;text-align:center}
  .lbItem i{font-style:normal;font-size:64px;line-height:1}.lbItem b{font:700 26px var(--sans)}.lbItem span{font:900 40px/1 var(--disp);color:var(--ac)}
  .lbStars{font-size:110px;letter-spacing:12px;color:var(--ac);line-height:1}.lbPhone{font:900 130px/1 var(--disp);color:var(--ac);font-variant-numeric:tabular-nums}
  .lbEmpty{font:600 36px var(--sans);color:var(--muted)}
  .lbTick{border-top:2px solid var(--line);display:grid;grid-template-columns:repeat(12,1fr);gap:32px;align-items:center;padding:0 80px;position:relative;z-index:2;background:var(--bg2)}
  .lbNext{grid-column:1/span 5;display:flex;align-items:center;gap:20px}.lbNext .dot{width:18px;height:18px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 8px color-mix(in srgb,var(--ok) 25%,transparent)}
  .lbNext b{font:800 40px/1 var(--disp);text-transform:uppercase}.lbNext span{font:600 28px var(--sans);color:var(--muted)}
  .lbDots{grid-column:6/span 3;justify-self:center;display:flex;gap:10px}.lbDots i{width:16px;height:16px;border-radius:50%;background:var(--line);transition:background .3s,width .3s}.lbDots i.on{background:var(--ac);width:44px;border-radius:8px}
  .lbFoot{grid-column:9/span 4;justify-self:end;font:600 26px var(--mono);color:var(--muted);text-align:right}
  .lbProg{position:absolute;left:0;top:-2px;height:4px;background:var(--ac);width:0}
  .lbCtl{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:6;display:flex;gap:8px;padding:8px;border-radius:14px;background:rgba(10,14,28,.92);border:1px solid #2A3550;transition:opacity .3s}
  #lbCtl{padding:8px!important;margin:0!important;width:auto!important;height:auto!important;min-height:0!important;max-width:none!important}.lbCtl.hide{opacity:0;pointer-events:none}.lbCtl button,.lbCtl a{font:600 14px var(--sans);color:#EEF2F8;background:#18233A;border:1px solid #2A3550;border-radius:9px;padding:8px 12px;cursor:pointer;text-decoration:none}`;

  const mmToT = m => { const h = Math.floor(m / 60) % 24, x = m % 60; return `${h % 12 || 12}:${String(x).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`; };
  const dur = m => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`);

  function slideHtml(s, g, dd) {
    const kick = t => `<div class="lbKick"><i></i>${esc(t)}</div>`;
    const chips = s.chips ? `<div class="lbChips">${String(s.chips).split(',').map(x => x.trim()).filter(Boolean).map((t, i) => `<span class="lbChip${i ? '' : ' y'}">${esc(t)}</span>`).join('')}</div>` : '';
    const qr = qrOf(s), qrBox = qr ? `<div class="lbSide"><div class="lbQr">${qrSvg(qr)}</div><div class="lbScan">${esc(s.cta || 'Scan me')}<small>${esc(s.type === 'text_us' ? s.phone : qr.replace(/^https?:\/\//, ''))}</small></div></div>` : '';
    const main = inner => `<div class="lbMain${qr ? '' : ' full'}">${inner}</div>${qrBox}`;
    const h1 = t => `<h1 class="${String(t).length > 22 ? 'm' : ''}">${esc(t)}</h1>`;
    const now = new Date(), nm = now.getHours() * 60 + now.getMinutes();
    if (s.type === 'schedule') {
      const list = dd.today, nx = list.findIndex(c => c.start + c.len > nm);
      return `<div class="lbGrid"><div class="hd">${kick('Today · ' + now.toLocaleDateString('en-US', { weekday: 'long' }))}<span class="lbChip">Every class coached and scaled</span></div>
        ${list.length ? list.slice(0, 9).map((c, i) => { const past = c.start + c.len <= nm, isN = i === nx, live = c.start <= nm && nm < c.start + c.len;
          return `<div class="lbRow${past ? ' past' : ''}${isN ? ' next' : ''}">${isN ? `<span class="tag">${live ? 'On now' : 'In ' + dur(c.start - nm)}</span>` : ''}<b>${mmToT(c.start)}</b><span>${esc(c.name)}${c.coach ? ' · Coach ' + esc(c.coach.split(' ')[0]) : ''}</span></div>`; }).join('') : '<p class="lbEmpty">No classes on the schedule today. Add your weekly classes in the gym office under Schedule.</p>'}</div>`;
    }
    if (s.type === 'prs') return `<div class="lbGrid"><div class="hd">${kick('PRs this week')}<span class="lbChip">${dd.prs.length} new</span></div>${dd.prs.length ? dd.prs.slice(0, 9).map(p => `<div class="lbPr"><div class="lbPlate">DSI</div><b>${esc(dd.nameOf(p.profile_id))}</b><div class="w">${fmt(p.weight_lb)} <small>lb</small></div><span>${esc(D.liftName(p.lift))} · up ${fmt(num(p.weight_lb) - num(p.prev_best))} lb</span></div>`).join('') : '<p class="lbEmpty">No PRs yet this week. Somebody fix that.</p>'}</div>`;
    if (s.type === 'leaders') return `<div class="lbGrid"><div class="hd">${kick(g.name + ' leaderboard')}<span class="lbChip">DSI score</span></div>${dd.board.length ? dd.board.map((r, i) => `<div class="lbPr"><div class="lbRank">${i + 1}</div><b>${esc(r.name)}</b><div class="w">${fmt(r.score)} <small>DSI</small></div></div>`).join('') : '<p class="lbEmpty">Nobody on the board yet. Get your DSI at dandystrength.com</p>'}</div>`;
    if (s.type === 'shop') return main(`${kick('Gym shop')}${h1(s.title || 'Grab a drink')}${dd.items.length ? `<div class="lbItems">${dd.items.slice(0, 8).map(i => `<div class="lbItem"><i>${esc(i.emoji)}</i><b>${esc(i.name)}</b><span>$${(i.price_cents / 100).toFixed(i.price_cents % 100 ? 2 : 0)}</span></div>`).join('')}</div>` : `<p class="lbLede">${esc(s.text || '')}</p>`}`);
    if (s.type === 'event') {
      const when = s.date ? new Date(s.date) : null, ms = when ? when - now : 0;
      const cd = !when ? '' : ms <= 0 ? '<div class="lbCount"><div><b>Today</b><span>Let\'s go</span></div></div>' : `<div class="lbCount"><div><b>${Math.floor(ms / 864e5)}</b><span>Days</span></div><div><b>${Math.floor(ms % 864e5 / 36e5)}</b><span>Hours</span></div><div><b>${Math.floor(ms % 36e5 / 6e4)}</b><span>Minutes</span></div></div>`;
      return main(`${kick('Event' + (when ? ' · ' + when.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) + ' · ' + when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''))}${h1(s.title || 'Event')}<p class="lbLede">${esc(s.text || '')}</p>${cd}${chips}`);
    }
    if (s.type === 'review') return main(`${kick('Love it here?')}<div class="lbStars" aria-label="Five stars">★★★★★</div>${h1(s.title || 'Leave us a review')}<p class="lbLede">${esc(s.text || '')}</p>`);
    if (s.type === 'text_us') return main(`${kick('Questions?')}${h1(s.title || 'Text us.')}${s.phone ? `<div class="lbPhone">${esc(s.phone)}</div>` : ''}<p class="lbLede">${esc(s.text || '')}</p>`);
    if (s.type === 'free_class') return main(`${kick('New here?')}${h1(s.title || 'First class is free')}<p class="lbLede">${esc(s.text || '')}</p>${chips}`);
    return main(`${kick(g.name)}${h1(s.title || '')}<p class="lbLede">${esc(s.text || '')}</p>${chips}`);
  }

  /* ---------- the lobby board ---------- */
  let lbTimers = [];
  const clearLb = () => { lbTimers.forEach(t => { clearInterval(t); cancelAnimationFrame(t); }); lbTimers = []; const st = document.getElementById('lbStyle'); if (st) st.remove(); };
  VIEWS.lobby = async (key, tok) => {
    clearLb();
    const g = await gymOf(key), qs = new URLSearchParams(location.search), preview = qs.has('preview');
    let cfg = await cfgOf(g.id), dd = await lobbyData(g);
    if (tok !== S.tok) return;
    let draft = null;
    const slides = () => { const list = draft || (cfg && cfg.lobby_slides && cfg.lobby_slides.length ? cfg.lobby_slides : defaults(g)); return list.filter(s => s.on !== false && TYPES[s.type]); };
    const secs = () => num((cfg || {}).lobby_secs) || 12;
    const style = document.createElement('style'); style.id = 'lbStyle'; style.textContent = LOBBY_CSS; document.head.appendChild(style);
    $('#main').innerHTML = `<div class="lbWrap"><div class="lbStage" id="lbStage">
      <header class="lbTop"><div class="lbLogo"><img src="/assets/mark.svg" alt=""><div><b>${esc(g.name)}</b><br><span>${esc(g.city || 'Dandy TV')}</span></div></div><div class="lbClock"><span id="lbDate"></span><b id="lbTime"></b></div></header>
      <main class="lbSlides" id="lbSlides" aria-live="polite"></main>
      <footer class="lbTick"><div class="lbProg" id="lbProg"></div><div class="lbNext"><span class="dot"></span><div><b id="lbNextT"></b><br><span id="lbNextS"></span></div></div><div class="lbDots" id="lbDots"></div><div class="lbFoot">${esc([g.address, g.phone].filter(Boolean).join(' · ') || 'dandystrength.com')}</div></footer>
    </div></div>${preview ? '' : `<div class="lbCtl" id="lbCtl"><button type="button" id="lbPrev">Prev</button><button type="button" id="lbPlay">Pause</button><button type="button" id="lbNextB">Next</button><button type="button" id="lbFull">Full screen</button>${isStaff(g.id) ? `<a href="/dandytv/${g.id}">Set up</a>` : ''}</div>`}`;
    const stage = $('#lbStage');
    const fit = () => { const s = Math.min(innerWidth / 1920, innerHeight / 1080); stage.style.transform = `translate(-50%,-50%) scale(${s})`; };
    addEventListener('resize', fit); fit();
    let cur = -1, playing = !qs.has('still'), t0 = performance.now();
    const show = i => {
      const list = slides(); if (!list.length) { $('#lbSlides').innerHTML = '<section class="lbSlide on"><div class="lbMain full"><h1>Dandy <em>TV</em></h1><p class="lbLede">Pick slides at dandystrength.com/dandytv</p></div></section>'; return; }
      cur = ((i % list.length) + list.length) % list.length;
      const old = $('#lbSlides .lbSlide.on'); if (old) { old.classList.remove('on'); setTimeout(() => old.remove(), 800); }
      const el = document.createElement('section'); el.className = 'lbSlide'; el.innerHTML = slideHtml(list[cur], g, dd); $('#lbSlides').appendChild(el);
      requestAnimationFrame(() => el.classList.add('on'));
      $('#lbDots').innerHTML = list.map((_, k) => `<i class="${k === cur ? 'on' : ''}"></i>`).join('');
      t0 = performance.now();
    };
    const tick = () => {
      const d = new Date(); $('#lbTime').textContent = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); $('#lbDate').textContent = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const n = d.getHours() * 60 + d.getMinutes(), list = dd.today, live = list.find(c => c.start <= n && n < c.start + c.len), next = list.find(c => c.start > n);
      const coach = c => (c.coach ? ' with Coach ' + c.coach.split(' ')[0] : '');
      if (live) { $('#lbNextT').textContent = `On now · ${mmToT(live.start)} ${live.name}`; $('#lbNextS').textContent = (live.coach ? 'Coach ' + live.coach.split(' ')[0] : '') + (next ? `${live.coach ? ' · ' : ''}next class ${mmToT(next.start)}` : ''); }
      else if (next) { $('#lbNextT').textContent = `Next class · ${mmToT(next.start)}`; $('#lbNextS').textContent = `${next.name}${coach(next)} · in ${dur(next.start - n)}`; }
      else { $('#lbNextT').textContent = list.length ? 'Done for today' : g.name; $('#lbNextS').textContent = dd.tomorrow.length ? `First class tomorrow ${mmToT(dd.tomorrow[0].start)}` : 'See you soon'; }
    };
    const loop = t => { if (tok !== S.tok) return clearLb(); const p = Math.min(1, (t - t0) / (secs() * 1000)); $('#lbProg').style.width = p * 100 + '%'; if (playing && p >= 1) show(cur + 1); lbTimers.push(requestAnimationFrame(loop)); };
    const only = qs.get('slide'); show(only != null ? +only : 0); tick(); lbTimers.push(requestAnimationFrame(loop));
    lbTimers.push(setInterval(() => { if (tok !== S.tok) return clearLb(); tick(); }, 15000));
    // New settings every minute, fresh PRs and schedule every five.
    lbTimers.push(setInterval(async () => { if (tok !== S.tok || preview) return; const c = await cfgOf(g.id); if (c && JSON.stringify(c) !== JSON.stringify(cfg)) { cfg = c; show(0); } }, 60000));
    lbTimers.push(setInterval(async () => { if (tok !== S.tok) return; try { dd = await lobbyData(g); } catch {} }, 5 * 60000));
    // The setup page shows unsaved slides here as they are typed.
    if (preview) addEventListener('message', e => { if (e.origin !== location.origin || !e.data || e.data.type !== 'dtvDraft') return; draft = e.data.slides; playing = false; show(e.data.at || 0); });
    if (preview) return;
    const ctl = $('#lbCtl'); let hideT; const wake = () => { ctl.classList.remove('hide'); clearTimeout(hideT); hideT = setTimeout(() => ctl.classList.add('hide'), 3500); };
    ['mousemove', 'touchstart', 'keydown'].forEach(ev => addEventListener(ev, () => { if (tok === S.tok) wake(); }, { passive: true })); wake();
    const setPlay = v => { playing = v; $('#lbPlay').textContent = v ? 'Pause' : 'Play'; t0 = performance.now(); };
    $('#lbPlay').onclick = () => setPlay(!playing); $('#lbNextB').onclick = () => show(cur + 1); $('#lbPrev').onclick = () => show(cur - 1);
    $('#lbFull').onclick = () => { const f = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); if (f && f.catch) f.catch(() => {}); };
    const onKey = e => { if (tok !== S.tok) return removeEventListener('keydown', onKey); if (e.key === 'ArrowRight') show(cur + 1); else if (e.key === 'ArrowLeft') show(cur - 1); else if (e.key === ' ') { e.preventDefault(); setPlay(!playing); } else if (e.key === 'f') $('#lbFull').onclick(); };
    addEventListener('keydown', onKey);
  };

  /* ---------- setup page ---------- */
  VIEWS.dandytv = async (gid, tok) => {
    if (!S.me) return needLogin(tok, 'set up Dandy TV');
    if (!gid) { const g0 = ((S.myGyms || [])[0] || {}).gym_id; if (g0) return go('/dandytv/' + g0, true); }
    if (!isStaff(gid)) return paint(tok, '<section class="prEmpty"><b>Gym staff only</b><p>Owners and coaches set up Dandy TV.</p></section>');
    const g = await gymOf(gid), cfg = await cfgOf(g.id), L = links(g);
    if (tok !== S.tok) return;
    const missing = cfg === null && (await sb.from('gym_tv').select('gym_id').limit(1)).error;
    let slides = (cfg && cfg.lobby_slides && cfg.lobby_slides.length ? cfg.lobby_slides : defaults(g)).map(s => ({ ...s, id: s.id || uid() }));
    const screensOn = { ...Object.fromEntries(CLASS_SCREENS.map(([k]) => [k, true])), ...((cfg && cfg.class_screens) || {}) };
    let classSecs = (cfg && cfg.class_secs) || 15, lobbySecs = (cfg && cfg.lobby_secs) || 12, sel = 0, dirty = false;
    const linkCard = (k, name, sub, url) => `<div class="formCard dtvLink"><div class="dtvLinkTop"><div><div class="formH">${name}</div><p class="sub">${sub}</p></div><div class="dtvQrSm" title="Scan to open on the TV's iPad or tablet">${qrSvg(url)}</div></div>
      <div class="dtvUrl"><code>${esc(url.replace(/^https:\/\//, ''))}</code></div>
      <div class="row"><a class="btn sm" href="${esc(url.replace(SITE, ''))}" target="_blank" rel="noopener">Open ${name}</a><button type="button" class="btn ghost sm" data-copy="${esc(url)}">Copy link</button></div></div>`;
    const field = (s, k, label, type = 'text', ph = '') => `<label class="dtvF"><span>${label}</span>${type === 'area' ? `<textarea data-k="${k}" rows="2" maxlength="240" placeholder="${esc(ph)}">${esc(s[k] || '')}</textarea>` : `<input data-k="${k}" type="${type}" value="${esc(s[k] || '')}" placeholder="${esc(ph)}" maxlength="${type === 'url' ? 500 : 120}">`}</label>`;
    const editor = s => {
      const t = TYPES[s.type], qr = qrOf(s);
      if (t.live) return `<p class="hint">${esc(t.d)}. It fills itself from Dandy, nothing to type.</p>${s.type === 'shop' ? field(s, 'title', 'Headline') + field(s, 'url', 'QR link', 'url') + field(s, 'cta', 'Under the QR') : ''}${s.type === 'shop' ? `<div class="dtvQrRow"><div class="dtvQrMd">${qrSvg(qr)}</div><p class="sub">This QR opens ${esc(qr.replace(/^https?:\/\//, ''))}</p></div>` : ''}`;
      return `${field(s, 'title', 'Headline')}${field(s, 'text', 'Words', 'area')}
        ${s.type === 'event' ? field(s, 'date', 'Date and time', 'datetime-local') : ''}
        ${['event', 'free_class', 'custom'].includes(s.type) ? field(s, 'chips', 'Tags, split with commas', 'text', 'Free, Saturday 9am, Teams of two') : ''}
        ${s.type === 'text_us' ? field(s, 'phone', 'Phone number for texts', 'tel', '513 555 0100') : field(s, 'url', s.type === 'review' ? 'Your Google review link' : 'QR link', 'url', 'https://')}
        ${field(s, 'cta', 'Under the QR', 'text', 'Scan to sign up')}
        <div class="dtvQrRow"><div class="dtvQrMd">${qr ? qrSvg(qr) : '<span>No QR</span>'}</div><p class="sub">${qr ? `This QR opens <b>${esc(qr.replace(/^https?:\/\//, ''))}</b>. ${/^https?:/.test(qr) ? `<a href="${esc(qr)}" target="_blank" rel="noopener">Test the link</a>` : ''}` : s.type === 'review' ? 'Paste your Google review link to show a QR. In Google Business Profile, choose Ask for reviews and copy the link.' : 'Add a link to show a QR code, or leave it empty for no QR.'}</p></div>`;
    };
    const draw = () => {
      if (tok !== S.tok) return;
      const s = slides[sel];
      $('#dtvList').innerHTML = slides.map((x, i) => `<li class="${i === sel ? 'on' : ''}${x.on === false ? ' off' : ''}"><button type="button" class="dtvPick" data-sel="${i}"><b>${esc(TYPES[x.type].n)}</b><span>${esc(TYPES[x.type].live ? TYPES[x.type].d : x.title || '')}</span></button>
        <span class="dtvTools"><label class="dtvOn" title="Show this slide"><input type="checkbox" data-on="${i}"${x.on === false ? '' : ' checked'}><span class="vh">Show</span></label><button type="button" class="btn ghost sm" data-up="${i}" aria-label="Move up"${i ? '' : ' disabled'}>↑</button><button type="button" class="btn ghost sm" data-dn="${i}" aria-label="Move down"${i < slides.length - 1 ? '' : ' disabled'}>↓</button><button type="button" class="btn ghost sm" data-del="${i}" aria-label="Remove">×</button></span></li>`).join('');
      $('#dtvEdit').innerHTML = s ? `<div class="formH">${esc(TYPES[s.type].n)}</div>${editor(s)}` : '<p class="hint">Add a slide to start.</p>';
      $('#dtvSave').disabled = !dirty; $('#dtvSave').textContent = dirty ? 'Save changes' : 'Saved';
      push();
    };
    const push = () => { const f = $('#dtvPrev'); if (f && f.contentWindow) f.contentWindow.postMessage({ type: 'dtvDraft', slides: slides.filter(x => x.on !== false), at: Math.max(0, slides.filter(x => x.on !== false).indexOf(slides[sel])) }, location.origin); };
    const touch = () => { dirty = true; $('#dtvSave').disabled = false; $('#dtvSave').textContent = 'Save changes'; };
    if (!paint(tok, `${X.officeBar(g, 'tv')}<section class="sec dtvSec">
      <div class="dtvHead"><div><div class="kicker">${esc(g.name)}</div><h2>Dandy <span>TV</span></h2></div><div class="row"><button class="btn" id="dtvSave" disabled>Saved</button></div></div>
      ${missing ? '<div class="formCard cvNote"><b>Dandy TV settings are being set up.</b> The boards work with their starting slides until then.</div>' : ''}
      <div class="dtvLinks">${linkCard('cls', 'Class TV', 'For the floor. The workout, every member\'s targets, part timers and the day board.', L.cls)}${linkCard('lobby', 'Lobby TV', 'For the front. Your schedule, PRs, events and offers, each with a QR code.', L.lobby)}</div>
      <div class="dtvGrid">
        <div class="formCard dtvSlides"><div class="formH">Lobby slides <span class="sub">Each shows for <select id="dtvLs">${[8, 10, 12, 15, 20, 30].map(n => `<option${n === lobbySecs ? ' selected' : ''}>${n}</option>`).join('')}</select> seconds</span></div>
          <ol class="dtvList" id="dtvList"></ol>
          <div class="row"><select id="dtvAddT">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}">${esc(t.n)}</option>`).join('')}</select><button type="button" class="btn ghost sm" id="dtvAdd">Add slide</button></div></div>
        <div class="formCard dtvEdit" id="dtvEdit"></div>
        <div class="dtvPrevBox"><div class="formH">Preview <span class="sub">What the lobby TV shows</span></div><div class="dtvFrame"><iframe id="dtvPrev" title="Lobby TV preview" src="/lobby/${g.id}?preview=1&still=1" tabindex="-1"></iframe></div>
          <div class="formCard dtvClass"><div class="formH">Class TV screens <span class="sub">each for <select id="dtvCs">${[10, 15, 20, 30, 45, 60].map(n => `<option${n === classSecs ? ' selected' : ''}>${n}</option>`).join('')}</select> seconds</span></div>
            ${CLASS_SCREENS.map(([k, n, d]) => `<label class="dtvChk"><input type="checkbox" data-cs="${k}"${screensOn[k] !== false ? ' checked' : ''}><span><b>${n}</b><small>${d}</small></span></label>`).join('')}</div></div>
      </div></section>`)) return;
    $('#dtvPrev').onload = () => setTimeout(push, 400);
    $$('[data-copy]').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Link copied'); } catch { toast(b.dataset.copy); } });
    $('#dtvList').onclick = e => {
      const t = e.target.closest('[data-sel],[data-up],[data-dn],[data-del]'); if (!t) return;
      if (t.dataset.sel) sel = +t.dataset.sel;
      else if (t.dataset.up) { const i = +t.dataset.up; [slides[i - 1], slides[i]] = [slides[i], slides[i - 1]]; sel = i - 1; touch(); }
      else if (t.dataset.dn) { const i = +t.dataset.dn; [slides[i + 1], slides[i]] = [slides[i], slides[i + 1]]; sel = i + 1; touch(); }
      else if (t.dataset.del) { slides.splice(+t.dataset.del, 1); sel = Math.max(0, Math.min(sel, slides.length - 1)); touch(); }
      draw();
    };
    $('#dtvList').onchange = e => { const i = e.target.dataset.on; if (i == null) return; slides[+i].on = e.target.checked; touch(); draw(); };
    $('#dtvEdit').oninput = e => { const k = e.target.dataset.k; if (!k || !slides[sel]) return; slides[sel][k] = e.target.value; touch(); clearTimeout(VIEWS.dandytv._t); VIEWS.dandytv._t = setTimeout(() => { const f = document.activeElement, pos = f && f.selectionStart; const k2 = f && f.dataset.k; draw(); if (k2) { const n = $(`#dtvEdit [data-k="${k2}"]`); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} } } }, 500); };
    $('#dtvAdd').onclick = () => { slides.push(starter($('#dtvAddT').value, g)); sel = slides.length - 1; touch(); draw(); };
    $('#dtvLs').onchange = e => { lobbySecs = +e.target.value; touch(); };
    $('#dtvCs').onchange = e => { classSecs = +e.target.value; touch(); };
    $$('[data-cs]').forEach(c => c.onchange = () => { screensOn[c.dataset.cs] = c.checked; if (!Object.values(screensOn).some(Boolean)) { c.checked = true; screensOn[c.dataset.cs] = true; return toast('Keep at least one class screen on'); } touch(); });
    $('#dtvSave').onclick = async () => {
      const bad = slides.find(s => s.url && !/^https?:\/\//i.test(s.url));
      if (bad) { sel = slides.indexOf(bad); draw(); return toast('QR links start with https://'); }
      const { error } = await sb.from('gym_tv').upsert({ gym_id: g.id, class_screens: screensOn, class_secs: classSecs, lobby_slides: slides, lobby_secs: lobbySecs, updated_at: new Date().toISOString(), updated_by: S.me.id });
      if (error) return toast(/gym_tv/.test(error.message) ? 'Dandy TV settings are still being set up. Try again soon.' : error.message);
      dirty = false; draw(); toast('Saved. The TVs update within a minute.');
    };
    const leave = e => { if (tok !== S.tok) return removeEventListener('beforeunload', leave); if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    addEventListener('beforeunload', leave);
    draw();
  };
}
