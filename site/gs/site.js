/* Dandy Strength gym website template. One file serves every gym: the page is drawn from site_public(key),
   the gym's data in Dandy (classes, coaches, plans, services, events, products, hours, contact, website copy).
   No gym content lives in this file. The Worker injects window.__SITE__ (and the brand colors) for speed and SEO;
   without it the page finds its key from the address and fetches the data itself. */
(() => {
  const SB = 'https://fairfhgyrosjqualmhwu.supabase.co', KEY = 'sb_publishable_1qg2GRUgxGxVMhOaoGGGFw_lm0j_j4h';
  const MEDIA = SB + '/storage/v1/object/public/gym-media/';
  const rpc = (fn, args) => fetch(SB + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
    .then(async (r) => { const j = await r.json().catch(() => null); if (!r.ok) throw new Error((j && j.message) || 'That did not go through.'); return j; });
  window.rpc = rpc;

  const siteKey = () => {
    if (window.__SITE_KEY__) return window.__SITE_KEY__;
    const q = new URLSearchParams(location.search).get('site'); if (q) return q;
    const m = location.pathname.match(/^\/site\/([a-z0-9.-]+)/i); if (m) return m[1];
    const h = location.hostname.toLowerCase();
    const sub = h.match(/^([a-z0-9-]+)\.(dandystrength\.com|dandy\.fit)$/);
    if (sub && sub[1] !== 'www') return sub[1];
    return h;
  };

  /* Brand colors: a gym can store a full palette (brand.vars and brand.vars_light) or just bg, primary and accent. */
  function brandCss(brand) {
    const b = brand || {}, ok = (v) => typeof v === 'string' && /^#[0-9a-f]{3,8}$|^rgb|^color-mix/i.test(v.trim());
    const dark = { ...(b.bg ? { '--bg': b.bg, '--panel': `color-mix(in srgb, ${b.bg} 90%, #fff)`, '--panel2': `color-mix(in srgb, ${b.bg} 84%, #fff)`, '--line': `color-mix(in srgb, ${b.bg} 74%, #fff)` } : {}),
      ...(b.accent ? { '--accent': b.accent, '--cta': b.accent } : {}), ...(b.primary ? { '--brand-blue': b.primary } : {}), ...(b.vars || {}) };
    const light = { ...(b.primary ? { '--accent': b.primary, '--brand-blue': b.primary } : {}), ...(b.accent ? { '--cta': b.accent } : {}), ...(b.vars_light || {}) };
    const decl = (o) => Object.entries(o).filter(([k, v]) => /^--[a-z0-9-]+$/.test(k) && ok(String(v))).map(([k, v]) => `${k}:${v}`).join(';');
    const d = decl(dark), l = decl(light);
    return `:root{${d}}` + (l ? `@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){${l}}}:root[data-theme="light"]{${l}}` : '');
  }

  const boot = (D) => {
    if (!D || !D.gym) { document.getElementById('siteMissing').hidden = false; document.querySelector('main').hidden = true; return; }
    if (!document.getElementById('brandVars')) { const st = document.createElement('style'); st.id = 'brandVars'; st.textContent = brandCss(D.site && D.site.brand); document.head.append(st); }
    if (D.code && D.code.css && !document.getElementById('gymCss')) { const st = document.createElement('style'); st.id = 'gymCss'; st.textContent = D.code.css; document.head.append(st); }
    try { render(D); } catch (e) { console.error(e); }
  };
  if (window.__SITE__ !== undefined) boot(window.__SITE__);
  else rpc('site_public', { p_key: siteKey() }).then(boot).catch(() => boot(null));

  function render(D) {
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined && txt !== null) e.textContent = txt; return e; };
  const pillGroup = (host, opts, onPick) => opts.forEach(([v, label]) => { const b = el('button', '', label); b.type = 'button'; b.dataset.v = v; b.addEventListener('click', () => onPick(v)); host.append(b); });
  const pressed = (host, v) => host.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const DAYNAMES = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
  const DOWKEY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayKey = (d) => DOWKEY[d.getDay()];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scrollTo = (id, block) => { const n = document.getElementById(id); if (n) n.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: block || 'start' }); };
  const money = (c) => '$' + (c % 100 ? (c / 100).toFixed(2) : String(c / 100));
  const https = (u) => typeof u === 'string' && /^https:\/\//i.test(u.trim()) ? u.trim() : '';

  const G = D.gym, S = D.site || {}, C = S.content || {}, B = S.brand || {}, H = S.hero || {}, L = S.links || {}, SEC = S.sections || {}, SOC = S.social || {};
  const on = (k, dflt = true) => SEC[k] === undefined ? dflt : !!SEC[k];
  const NAME = B.name || G.name, SHORT = B.short || G.name, CITY = (G.city || '').trim(), TOWN = CITY.split(',')[0];
  const head = (k) => ({ ...(DEFAULT_HEADS[k] || {}), ...((C.heads || {})[k] || {}) });
  const DEFAULT_HEADS = {
    community: { eyebrow: 'Community', title: 'Workouts for every level', desc: 'The workouts change every day. The people cheering you through the last rep do not.' },
    classes: { eyebrow: 'Classes', title: 'Find your class', desc: 'Members reserve in the app. New faces can book a free class right here.' },
    plans: { eyebrow: 'Plans', title: 'Pick how often you train', desc: 'Start with a free class and a coach helps you choose.' },
    book: { eyebrow: 'Book online', title: 'Book your visit', desc: 'Pick what you would like, a time, and add your details. We confirm by text.' },
    coaches: { eyebrow: 'Coaches', title: 'Who is coaching your class', desc: 'Every class is led by a coach. Times come straight from the class schedule.' },
    faq: { eyebrow: 'FAQ', title: 'Frequently asked questions', desc: 'Still wondering about something? Text us and a coach will answer.' },
    contact: { eyebrow: 'Contact', title: 'Talk to a coach', desc: 'Questions about a free class, pricing or personal training? Text or call and we get right back to you.' },
    events: { eyebrow: 'Events', title: 'Mark your calendar', desc: 'Friends and family welcome.' },
    store: { eyebrow: 'Store', title: 'Rep the gym', desc: 'Order online and pick up at the front desk, free.' },
  };
  document.querySelectorAll('[data-head]').forEach((box) => {
    const h = head(box.dataset.head), t = el('div', 't');
    t.append(el('span', 'eyebrow', h.eyebrow || ''), el('h2', '', h.title || ''));
    const d = el('p', 'd', h.desc || ''); if (h.chip) { d.append(' '); d.append(el('span', 'sample', h.chip)); }
    box.replaceChildren(t, d);
  });

  /* Header, hero and footer copy */
  const now = new Date();
  document.title = (S.seo && S.seo.title) || NAME;
  $('#logoLink').setAttribute('aria-label', NAME + ' home');
  if (https(B.logo_url) || B.logo_path) { const im = el('img'); im.src = https(B.logo_url) || MEDIA + B.logo_path; im.alt = ''; im.height = 40; $('#logoMark').replaceChildren(im); }
  $('#logoShort').textContent = SHORT; $('#logoName').textContent = SHORT === NAME ? (B.tagline || CITY) : NAME;
  $('#heroEyebrow').textContent = H.eyebrow || [NAME, CITY, C.motto].filter(Boolean).join(' · ');
  const h1 = $('#heroH1'); String(H.headline || B.tagline || NAME).split(/\*([^*]+)\*/).forEach((part, i) => h1.append(i % 2 ? el('em', '', part) : document.createTextNode(part)));
  $('#heroSub').textContent = H.sub || '';
  const LVC = { green: 'var(--p-green)', yellow: 'var(--p-yellow)', red: 'var(--p-red)', blue: 'var(--p-blue)', teal: 'var(--p-teal)', dandy: 'var(--p-dandy)', grey: 'var(--p-grey)' };
  const LEVELS = Array.isArray(C.levels) && C.levels.length ? C.levels : [['Beginner', 'green'], ['Rx', 'red']];
  if (C.levels && !C.levels.length) $('#levels').hidden = true;
  LEVELS.forEach(([n, c]) => { const s = el('span'); const i = el('i'); i.style.background = LVC[c] || 'var(--p-blue)'; s.append(i, document.createTextNode(n)); $('#levels').append(s); });
  $('#fName').textContent = SHORT !== NAME ? `${NAME} · ${SHORT}` : NAME; $('#fMotto').textContent = C.motto || B.tagline || '';
  $('#fAbout').textContent = C.about || ''; $('#fAbout').hidden = !C.about;
  const fullAddr = (() => { const a = (G.address || '').trim(); if (!a) return CITY; if (/\d{5}/.test(a) || !CITY) return a; return `${a}, ${CITY}${L.zip ? ' ' + L.zip : ''}`; })();
  $('#fFine').textContent = `© ${now.getFullYear()} ${NAME}${fullAddr ? ' · ' + fullAddr : ''}`;
  if (S.announcement && S.announcement.on && S.announcement.text) {
    const a = $('#annBar'); a.hidden = false;
    const t = el(https(S.announcement.link) || /^#/.test(S.announcement.link || '') ? 'a' : 'span', '', S.announcement.text);
    if (t.tagName === 'A') t.href = S.announcement.link; a.append(t);
  }

  /* Classes from Dandy: each weekly class on each of its weekdays */
  const t12 = (t) => { const [h, m] = String(t).split(':').map(Number); return `${(h + 11) % 12 + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`; };
  const mins = (t) => { const [h, m] = t.slice(0, -2).split(':').map(Number); return (h % 12 + (t.endsWith('pm') ? 12 : 0)) * 60 + m; };
  const fmtMin = (m) => { const h = Math.floor(m / 60), mm = m % 60; return `${(h + 11) % 12 + 1}:${String(mm).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`; };
  const isOpen = (n) => /open gym/i.test(n || '');
  const SCHEDULE = Object.fromEntries(DAYS.map((d) => [d, []]));
  (D.classes || []).forEach((c) => (c.weekdays || []).forEach((w) => { const k = DOWKEY[w]; if (k) SCHEDULE[k].push([t12(c.start_time), c.name || 'Class', c.coach || '', c.duration_min || 60]); }));
  DAYS.forEach((d) => SCHEDULE[d].sort((a, b) => mins(a[0]) - mins(b[0])));
  const COACHES = (D.coaches || []).map((c) => [c.name, c.title || 'Coach', c]);
  const coachLabel = (n) => n ? 'Coach ' + n : '';
  const todayKey = dayKey(now), nowMin = now.getHours() * 60 + now.getMinutes();
  const classCount = Object.values(SCHEDULE).flat().filter((c) => !isOpen(c[1])).length;

  /* Services: what someone can book on the site */
  const SERVICES = {};
  (D.services || []).forEach((s) => {
    const kind = s.kind === 'intro_class' || s.kind === 'drop_in' ? 'class' : s.kind === 'waitlist' ? 'waitlist' : 'appt';
    const price = s.price_cents > 0 ? money(s.price_cents) + (s.price_note ? ' ' + s.price_note : '') : kind === 'class' ? 'Free' : (s.price_note || '');
    SERVICES[s.id] = { id: s.id, name: s.name, short: s.name.replace(/^Free /, (m) => kind === 'class' ? '' : m).replace(/^./, (c) => c.toUpperCase()), desc: s.description || '', price, free: s.price_cents === 0 && kind === 'class', len: s.duration_min || 60, kind, raw: s };
  });
  const svcList = Object.values(SERVICES);
  const intro = svcList.find((s) => s.raw.kind === 'intro_class') || svcList.find((s) => s.kind === 'class');
  const ctaLabel = (s) => s.raw.kind === 'intro_class' ? (s.free ? 'Book a free class' : 'Book a class') : s.raw.kind === 'drop_in' ? (s.free ? 'Free drop in' : 'Drop in') : s.name;
  const heroCtas = $('#heroCtas');
  svcList.filter((s) => s.kind !== 'waitlist').slice(0, 3).forEach((s, i) => { const a = el('a', 'btn' + (i === 0 ? ' primary' : ''), ctaLabel(s)); a.href = '#book'; a.dataset.book = s.id; heroCtas.append(a); });
  if (intro) { $('#barCta').dataset.book = intro.id; $('#barCta').textContent = ctaLabel(intro); } else $('#barCta').hidden = true;
  const appts = svcList.filter((s) => s.kind === 'appt');
  if (appts.length) { $('#mbCoach').hidden = false; $('#mbCoach').dataset.book = appts[0].id; }

  /* Navigation from the sections this gym shows */
  const showBoard = on('board'), showEvents = on('events') && (D.events || []).length > 0, showStore = on('store') && (D.products || []).length > 0;
  const showCoaches = on('coaches') && COACHES.length > 0, showPlans = on('plans') && (D.plans || []).length > 0, showBook = on('book') && svcList.length > 0;
  const showFaq = on('faq', true) && Array.isArray(C.faq) && C.faq.length > 0;
  $('#compete').hidden = !showBoard; $('#mbBoard').hidden = !showBoard; $('#prMini').hidden = !showBoard;
  $('#events').hidden = !showEvents; $('#store').hidden = !showStore; $('#coaches').hidden = !showCoaches;
  $('#plans').hidden = !showPlans; $('#book').hidden = !showBook; $('#faq').hidden = !showFaq;
  $('#community').hidden = !on('community');
  const NAV = [['community', 'Community', on('community')], ['classes', 'Classes', true], ['plans', 'Plans', showPlans], ['book', 'Book', showBook], ['events', 'Events', showEvents], ['store', 'Store', showStore], ['contact', 'Contact', true], ['compete', 'The board', showBoard]];
  NAV.filter((n) => n[2]).forEach(([id, n]) => { const a = el('a', '', n); a.href = '#' + id; $('#nav').append(a); });
  (D.pages || []).filter((p) => p.in_nav).forEach((p) => { const a = el('a', '', p.title); a.href = '#page-' + p.slug; $('#nav').append(a); });
  const fT = $('#fTrain'); [['#classes', 'Schedule'], ...(on('workouts') ? [['#classes', 'Workouts', 'workouts']] : []), ...appts.map((s) => ['#book', s.name, null, s.id]), ...(showPlans ? [['#plans', 'Plans']] : []), ...(showFaq ? [['#faq', 'FAQ']] : [])]
    .forEach(([h, n, go, bk]) => { const a = el('a', '', n); a.href = h; if (go) a.dataset.goto = go; if (bk) a.dataset.book = bk; fT.append(a); });
  if (!showBoard) $('#fCompete').hidden = true;

  /* Tabs */
  const openTab = (btn) => btn.parentElement.querySelectorAll('[role=tab]').forEach((b) => { const o = b === btn; b.setAttribute('aria-selected', String(o)); document.getElementById(b.dataset.panel).hidden = !o; });
  document.querySelectorAll('[role=tab]').forEach((b) => b.addEventListener('click', () => openTab(b)));
  const GOTO = { prs: 'tPrs', workouts: 'tWorkouts' };
  document.querySelectorAll('[data-goto]').forEach((a) => a.addEventListener('click', () => { const b = document.querySelector(`[data-panel="${GOTO[a.dataset.goto]}"]`); if (b) openTab(b); }));

  /* Today */
  $('#todayTitle').textContent = C.today_title || 'Today at ' + SHORT;
  $('#todayDate').textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const tl = $('#todayList'), today = SCHEDULE[todayKey];
  const nextIdx = today.findIndex((c) => mins(c[0]) > nowMin);
  today.forEach((c, i) => {
    const s = mins(c[0]), len = c[3] || 60;
    const row = el('div', 'slot' + (s + len <= nowMin ? ' past' : '') + (i === nextIdx ? ' next' : ''));
    const mid = el('div'); const left = s - nowMin;
    mid.append(el('div', 'nm', c[1]), el('div', 'co', [coachLabel(c[2]), i === nextIdx ? `in ${left < 60 ? left + ' min' : Math.floor(left / 60) + 'h ' + (left % 60) + 'm'}` : ''].filter(Boolean).join(' · ')));
    let right;
    if (s > nowMin && !isOpen(c[1]) && intro) { right = el('button', 'bk', intro.free ? 'Book free' : 'Book'); right.type = 'button'; right.addEventListener('click', () => startBooking(intro.id, 0, c[0])); }
    else right = el('span', 'st', s <= nowMin && nowMin < s + len ? 'In class' : s + len <= nowMin ? 'Done' : isOpen(c[1]) ? 'Open gym' : '');
    row.append(el('span', 'tm', c[0]), mid, right); tl.append(row);
  });
  if (!today.length) tl.append(el('p', 'co', 'No classes today. See the week below.'));
  else if (nextIdx === -1 && !today.some((c) => mins(c[0]) <= nowMin && nowMin < mins(c[0]) + (c[3] || 60))) tl.append(el('p', 'co', 'Classes are done for today. Book one for tomorrow below.'));

  /* Community pillars */
  const pillars = Array.isArray(C.pillars) ? C.pillars : [];
  pillars.forEach((p) => { const a = el('article', 'card pillar'); a.append(el('span', 'n', p.n === 'auto:classes' ? String(classCount) : p.n || ''), el('h3', '', p.title || ''), el('p', '', p.text || '')); $('#pillars').append(a); });
  $('#pillars').hidden = !pillars.length;

  /* Social feed: preview posts until the live Instagram feed (social.ig_feed) is connected */
  const igUrl = https(SOC.ig), fbUrl = https(SOC.fb);
  const handle = ((igUrl.match(/instagram\.com\/([^/?#]+)/i) || [])[1] || '').toLowerCase();
  $('#socialHandle').textContent = handle ? '@' + handle : SHORT;
  $('#socialTitle').textContent = C.social_title || 'Life at ' + SHORT;
  document.querySelectorAll('[data-soc]').forEach((a) => { const u = https(SOC[a.dataset.soc]); a.hidden = !u; if (u) a.href = u; });
  const showSocial = on('social') && (igUrl || fbUrl);
  $('#socialBlock').hidden = !showSocial;
  if (showSocial) socialFeed();
  function socialFeed() {
    const IG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>';
    const FB = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M13.5 21v-7h2.5l.5-3h-3V9.5c0-.9.4-1.5 1.6-1.5H16.5V5.3c-.5-.1-1.3-.2-2.3-.2-2.3 0-3.7 1.4-3.7 3.9V11H8v3h2.5v7"/></svg>';
    const pf = (p) => (p === 'ig' && igUrl) || !fbUrl ? 'ig' : 'fb';
    const lv = LEVELS.map((l) => l[0]).join(' · ');
    const POSTS = [
      [pf('ig'), 'New PR', 'Ring the bell', 'var(--p-red)', '#7a1d10', 'The PR bell got a workout this week. Who is next?', 2],
      [pf('fb'), 'Early crew', 'Coffee after', 'var(--p-blue)', '#16306a', 'Shoutout to the early morning crew. Same time tomorrow.', 3],
      [pf('ig'), 'Partner WOD', 'Saturdays', 'var(--p-yellow)', '#7a5a06', 'Bring a friend. Saturday partner workouts are the best hour of the week.', 4],
      [pf('ig'), 'Every level', lv, 'var(--p-green)', '#0f4f2c', 'Same workout, scaled for you. Everyone finishes together.', 5],
      [pf('fb'), intro && intro.free ? 'First class free' : 'Try a class', 'Book online', 'var(--accent)', '#6b1f0d', `New here? ${intro && intro.free ? 'Your first class is on us.' : 'Come try a class.'} Book it on our website.`, 6],
      [pf('fb'), 'The board', 'Who takes the Dandy?', 'var(--p-dandy)', '#5a4612', 'The board is wide open this month. Log your lifts in the app.', 11],
    ];
    const track = $('#track'), feedEl = $('#feed'), dots = $('#feedDots'), playBtn = $('#feedPlay');
    const phead = (p, pic) => {
      const ph = el('div', 'ph'), av = el('span', 'av', pic ? undefined : SHORT.slice(0, 1));
      if (pic) { const im = el('img'); im.src = pic; im.alt = ''; av.append(im); }
      const hd = el('span', 'hd', handle || SHORT); hd.append(el('small', '', CITY));
      const ic = el('span', 'ic'); ic.innerHTML = p === 'ig' ? IG : FB; ph.append(av, hd, ic); return ph;
    };
    const link = (href) => { const a = el('a', 'post'); a.href = href; a.target = '_blank'; a.rel = 'noopener'; return a; };
    const mkPreview = ([p, big, small, c1, c2, cap, ago]) => {
      const a = link(p === 'ig' ? igUrl : fbUrl);
      const vis = el('div', 'vis'); vis.style.background = `linear-gradient(140deg, ${c1}, ${c2})`;
      const t = el('b', '', big); t.append(el('small', '', small)); vis.append(t);
      const cp = el('div', 'cap'); cp.append(el('div', 'txt', cap), el('span', '', `${p === 'ig' ? 'Instagram' : 'Facebook'} · ${ago}d ago`));
      a.append(phead(p), vis, cp); return a;
    };
    const when = (iso) => { const t = Date.parse(iso); if (!t) return ''; const d = Math.floor((Date.now() - t) / 864e5); return d < 1 ? 'Today' : d < 7 ? d + 'd ago' : d < 56 ? Math.round(d / 7) + 'w ago' : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
    const BADGE = { VIDEO: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>', CAROUSEL_ALBUM: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><rect x="7" y="7" width="13" height="13" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/></svg>' };
    const pick = (p) => { const sz = p.sizes || (p.children && p.children[0] && p.children[0].sizes) || {}; return https((sz.medium || sz.large || sz.small || {}).mediaUrl) || https(p.thumbnailUrl) || (p.mediaType === 'VIDEO' ? '' : https(p.mediaUrl)); };
    const mkLive = (p, pic, i) => {
      const src = pick(p); if (!src) return null;
      const a = link(https(p.permalink) || igUrl);
      const vis = el('div', 'vis photo'), rgb = p.colorPalette && p.colorPalette.muted;
      if (/^\d{1,3},\d{1,3},\d{1,3}$/.test(rgb || '')) vis.style.background = `rgb(${rgb})`;
      const cap = String(p.prunedCaption || p.caption || '').trim();
      const im = el('img'); im.src = src; im.alt = p.altText || cap.slice(0, 140) || 'Instagram post from ' + NAME; im.decoding = 'async'; if (i > 3) im.loading = 'lazy'; vis.append(im);
      if (BADGE[p.mediaType]) { const b = el('span', 'badge'); b.innerHTML = BADGE[p.mediaType]; vis.append(b); }
      const cp = el('div', 'cap'); cp.append(el('div', 'txt', cap || 'See the post on Instagram'), el('span', '', 'Instagram · ' + when(p.timestamp)));
      a.append(phead('ig', pic), vis, cp); return a;
    };
    let holdUntil = 0, paused = reduce, onScreen = false, inside = false, raf = 0;
    const gap = () => parseFloat(getComputedStyle(track).columnGap) || 0;
    const step = () => { const c = track.firstElementChild; return c ? c.getBoundingClientRect().width + gap() : 1; };
    const perView = () => Math.max(1, Math.round((track.clientWidth + gap()) / step()));
    const lastIdx = () => Math.max(0, track.children.length - perView());
    const cur = () => Math.min(lastIdx(), Math.round(track.scrollLeft / step()));
    const go = (i) => { const n = lastIdx(); track.scrollTo({ left: (i > n ? 0 : i < 0 ? n : i) * step(), behavior: reduce ? 'auto' : 'smooth' }); };
    const hold = () => { holdUntil = Date.now() + 8000; };
    const paintDots = () => {
      const n = lastIdx() + 1;
      if (dots.children.length !== n) dots.replaceChildren(...Array.from({ length: n }, (_, i) => { const b = el('button', 'dot'); b.type = 'button'; b.setAttribute('aria-label', `Show post ${i + 1} of ${n}`); b.addEventListener('click', () => { hold(); go(i); }); return b; }));
      const k = cur(); [...dots.children].forEach((d, i) => d.setAttribute('aria-current', String(i === k))); dots.hidden = n < 2;
    };
    const setPlay = (p) => { paused = p; playBtn.setAttribute('aria-label', p ? 'Play slideshow' : 'Pause slideshow');
      playBtn.innerHTML = p ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'; };
    const tick = () => { if (!paused && onScreen && !inside && !document.hidden && Date.now() > holdUntil && lastIdx() > 0) go(cur() + 1); };
    const setPosts = (nodes) => { track.replaceChildren(...nodes); track.scrollLeft = 0; paintDots(); };
    setPlay(paused); setInterval(tick, 4000);
    playBtn.addEventListener('click', () => setPlay(!paused));
    $('#feedPrev').addEventListener('click', () => { hold(); go(cur() - 1); });
    $('#feedNext').addEventListener('click', () => { hold(); go(cur() + 1); });
    track.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(paintDots); }, { passive: true });
    ['pointerdown', 'wheel', 'touchstart'].forEach((ev) => track.addEventListener(ev, hold, { passive: true }));
    feedEl.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') inside = true; });
    feedEl.addEventListener('pointerleave', () => { inside = false; });
    feedEl.addEventListener('focusin', () => { inside = true; });
    feedEl.addEventListener('focusout', (e) => { if (!feedEl.contains(e.relatedTarget)) inside = false; });
    addEventListener('resize', paintDots);
    if ('IntersectionObserver' in window) new IntersectionObserver((es) => { onScreen = es[0].isIntersecting; }, { threshold: 0.4 }).observe(feedEl); else onScreen = true;
    setPosts(POSTS.map(mkPreview));
    feedEl.setAttribute('aria-label', 'Recent posts from ' + ($('#socialHandle').textContent));
    if (https(SOC.ig_feed)) fetch(https(SOC.ig_feed)).then((r) => r.ok ? r.json() : null).then((j) => {
      if (!j || !Array.isArray(j.posts)) return;
      const nodes = j.posts.slice(0, 12).map((p, i) => mkLive(p, https(j.profilePictureUrl), i)).filter(Boolean);
      if (nodes.length < 2) return; setPosts(nodes); $('#feedSample').hidden = true;
    }).catch(() => {});
  }

  /* Weekly schedule */
  const names = [...new Set(Object.values(SCHEDULE).flat().map((c) => c[1]))];
  const clsEl = (c, long) => { const d = el('div', 'cls' + (isOpen(c[1]) ? ' og' : '')); d.append(el('div', 'tm', c[0]), el('div', 'co', long ? [c[1], coachLabel(c[2])].filter(Boolean).join(' · ') : (names.length > 1 && !/crossfit/i.test(c[1]) || isOpen(c[1]) ? c[1] + (c[2] ? ' · ' : '') : '') + (c[2] || '').split(' ')[0])); return d; };
  DAYS.forEach((d) => {
    const col = el('div', 'dcol' + (d === todayKey ? ' is-today' : ''));
    const h = el('h4'); h.append(document.createTextNode(d)); if (d === todayKey) h.append(el('span', 'chip', 'Today')); col.append(h);
    SCHEDULE[d].forEach((c) => col.append(clsEl(c)));
    if (!SCHEDULE[d].length) col.append(el('div', 'co muted', 'Closed'));
    $('#weekGrid').append(col);
  });
  const showDay = (d) => { pressed($('#dayBtns'), d); const one = $('#dayOne'); one.replaceChildren(el('h4', '', DAYNAMES[d])); SCHEDULE[d].forEach((c) => one.append(clsEl(c, true))); if (!SCHEDULE[d].length) one.append(el('div', 'co muted', 'No classes')); };
  pillGroup($('#dayBtns'), DAYS.map((d) => [d, d]), showDay); showDay(todayKey);
  const lg = $('#legend');
  names.filter((n) => !isOpen(n)).forEach((n) => { const s = el('span'); const i = el('i'); i.style.background = 'var(--p-blue)'; s.append(i, document.createTextNode(names.filter((x) => !isOpen(x)).length > 1 ? n : n + ' class')); lg.append(s); });
  if (names.some(isOpen)) { const s = el('span'); const i = el('i'); i.style.background = 'var(--p-grey)'; s.append(i, document.createTextNode('Open gym')); lg.append(s); }
  if (C.schedule_note) lg.append(el('span', '', C.schedule_note));

  /* Programs tab */
  const progs = Array.isArray(C.programs) ? C.programs : [];
  progs.forEach((p) => { const a = el('article', 'card prog'); a.append(el('span', 'ages', p.ages || ''), el('h3', '', p.title || ''), el('p', '', p.text || '')); $('#programs').append(a); });
  const incl = Array.isArray(C.included) ? C.included : [];
  incl.forEach((t) => $('#included').append(el('li', '', t)));
  const monthly = (D.plans || []).filter((p) => p.interval === 'month').map((p) => p.price_cents);
  const pf = $('#plansFrom'); if (monthly.length && showPlans) { pf.append(`Plans start at ${money(Math.min(...monthly))} a month. `); const a = el('a', '', 'See the plans'); a.href = '#plans'; pf.append(a); }
  $('#includedCard').hidden = !incl.length;
  if (!progs.length && !incl.length) $('#tabPrograms').hidden = true;
  if (!on('workouts')) $('#tabWorkouts').hidden = true;
  if ($('#tabPrograms').hidden && $('#tabWorkouts').hidden) $('#classTabs').hidden = true;

  /* Plans */
  (D.plans || []).forEach((p) => {
    const a = el('article', 'card plan' + (p.featured ? ' best' : ''));
    a.append(el('span', 'eyebrow', p.name));
    if (p.tag) a.append(el('span', 'chip free tag', p.tag));
    const pp = el('div', 'pp'); pp.append(el('b', '', money(p.price_cents)), el('span', '', p.interval === 'month' ? 'per month' : p.interval === 'year' ? 'per year' : 'one time')); a.append(pp);
    if (p.description) a.append(el('p', 'muted', p.description));
    if ((p.features || []).length) { const ul = el('ul'); p.features.forEach((f) => { const li = el('li'); if (/dandy pro|dsi pro/i.test(f)) li.append(el('b', '', f)); else li.textContent = f; ul.append(li); }); a.append(ul); }
    if (p.includes_pro) a.append(el('p', 'pro-note', 'Dandy Pro gives you your weight for every workout, tracks every lift and shows you getting stronger month by month.'));
    if (p.commitment_months) a.append(el('span', 'per mono', `${p.commitment_months} month commitment`));
    const per = p.per || (p.classes_per_month && p.interval === 'month' ? `About ${money(Math.round(p.price_cents / p.classes_per_month / 100) * 100)} a class` : '');
    if (per) a.append(el('span', 'per mono', per));
    const acts = el('div', 'cc-acts');
    if (intro) { const b = el('a', 'btn' + (p.featured ? ' primary' : ''), intro.free ? 'Start with a free class' : 'Start with a class'); b.href = '#book'; b.dataset.book = intro.id; acts.append(b); }
    if (p.joinable && G.payments_ready) { const j = el('a', 'btn', 'Join online'); j.href = `https://dandystrength.com/mygym?gym=${G.id}&plan=${p.id}`; j.target = '_blank'; j.rel = 'noopener'; acts.append(j); }
    a.append(acts); $('#planGrid').append(a);
  });
  if (appts.length) {
    $('#planAdd').hidden = false;
    if (C.addon_title) $('#addTitle').textContent = C.addon_title; if (C.addon_desc) $('#addDesc').textContent = C.addon_desc;
    appts.forEach((s) => { const b = el('a', 'btn', s.name + (s.price ? ' · ' + s.price : '')); b.href = '#book'; b.dataset.book = s.id; $('#addBtns').append(b); });
  }

  /* Coaches */
  COACHES.forEach(([n, r, c]) => {
    const groups = new Map();
    DAYS.forEach((d) => { const t = SCHEDULE[d].filter((x) => x[2] === n).map((x) => x[0]); if (t.length) { const k = t.join(', '); groups.set(k, [...(groups.get(k) || []), d]); } });
    const when = [...groups].map(([t, ds]) => `${ds.length > 2 && DAYS.indexOf(ds[ds.length - 1]) - DAYS.indexOf(ds[0]) === ds.length - 1 ? ds[0] + ' to ' + ds[ds.length - 1] : ds.join(', ')} ${t}`).join(' · ');
    const card = el('article', 'card coach');
    const av = el('div', 'mono-av', c.photo ? undefined : n.split(' ').map((p) => p[0]).join('').slice(0, 3));
    if (c.photo) { const im = el('img'); im.src = MEDIA + c.photo; im.alt = ''; im.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%'; av.append(im); }
    const info = el('div'); info.append(el('div', 'role', r), el('div', 'name', n), el('div', 'when', when || (c.books ? 'Book for personal training' : 'Ask about times')));
    if (c.bio) info.append(el('p', 'when', c.bio));
    card.append(av, info); $('#coachGrid').append(card);
  });

  /* Sample programming (until the gym's real week is published to the site) */
  const PLATES = [[45, 'var(--p-blue)', 30], [35, 'var(--p-yellow)', 27], [25, 'var(--p-green)', 24], [15, 'var(--p-grey)', 20], [10, 'var(--p-white)', 18], [5, 'var(--p-grey)', 13], [2.5, 'var(--p-grey)', 10]];
  PLATES.slice(0, 5).forEach(([w, c]) => { const r = el('div'); const d = el('span', 'disc'); d.style.borderColor = c; r.append(d, el('span', '', w + ' lb bumper'), el('span')); $('#plateKey').append(r); });
  const perSide = (total, bar) => { let side = Math.max(0, (total - bar) / 2); const out = []; for (const p of PLATES) { while (side >= p[0] - 0.001) { out.push(p); side -= p[0]; } } return out; };
  const loadoutEl = (plates) => { const l = el('div', 'loadout'); l.append(el('span', 'barend'), el('span', 'collar')); plates.forEach(([w, c, h]) => { const p = el('span', 'plate'); p.style.background = c; p.style.height = h + 'px'; p.title = w + ' lb'; l.append(p); }); l.append(el('span', 'txt', plates.length ? plates.map((p) => p[0]).join(' + ') : 'Empty bar')); return l; };
  const round5 = (x) => Math.round(x / 5) * 5;
  const WEEK = {
    Mon: { lift: 'squat', title: 'Back squat', note: 'Heavy triples. Leave one rep in the tank.', sets: [[3, 75], [3, 80], [3, 82.5], [3, 85], [3, 85]], mt: 'AMRAP 12', lv: { rx: '10 wall balls (20/14 lb)\n10 toes to bar\n200 m run', mid: '10 wall balls (14/10 lb)\n10 hanging knee raises\n200 m run', beg: '10 wall balls to a lower target (10/6 lb)\n10 sit ups\n150 m run or 250 m row' } },
    Tue: { lift: 'bench', title: 'Bench press', note: 'Pause the first rep of every set on your chest.', sets: [[5, 70], [5, 72.5], [5, 75], [5, 77.5]], mt: 'For time', lv: { rx: '50 cal row\n40 push ups\n30 kettlebell swings (53/35 lb)\n20 burpees over the bar', mid: '40 cal row\n40 push ups from the knees\n30 kettlebell swings (35/26 lb)\n20 burpees', beg: '30 cal row\n30 incline push ups\n30 kettlebell deadlifts (26/18 lb)\n15 step back burpees' } },
    Wed: { lift: 'dead', title: 'Deadlift', note: 'Build to a heavy single. Reset every rep.', sets: [[5, 70], [3, 80], [3, 85], [1, 90], [1, 92.5]], mt: 'EMOM 10', lv: { rx: 'Odd minutes: 12 cal Echo bike\nEven minutes: 8 alternating dumbbell snatches (50/35 lb)', mid: 'Odd minutes: 10 cal Echo bike\nEven minutes: 8 alternating dumbbell snatches (35/20 lb)', beg: 'Odd minutes: 8 cal Echo bike\nEven minutes: 8 dumbbell hang power cleans (20/10 lb)' } },
    Thu: { lift: 'clean', title: 'Squat clean', note: 'Fast elbows. Every rep from the floor.', sets: [[2, 70], [2, 70], [2, 75], [1, 80], [1, 80], [1, 85]], mt: '3 rounds for time', lv: { rx: '400 m run\n15 power cleans (135/95 lb)\n15 bar facing burpees', mid: '400 m run\n15 power cleans (95/65 lb)\n15 burpees', beg: '300 m run\n15 hang power cleans (45/35 lb)\n10 step back burpees' } },
    Fri: { lift: 'squat', title: 'Front squat', note: 'Percentages are from your back squat max.', sets: [[5, 60], [5, 65], [5, 65]], mt: 'Partner chipper', lv: { rx: '100 cal row\n80 box jumps (24/20 in)\n60 thrusters (95/65 lb)\n40 pull ups\n20 synchro burpees', mid: '80 cal row\n80 box step ups (24/20 in)\n60 thrusters (65/45 lb)\n40 banded pull ups\n20 synchro burpees', beg: '60 cal row\n60 box step ups (20/16 in)\n60 dumbbell thrusters (20/10 lb)\n40 ring rows\n20 burpees' } },
    Sat: { lift: 'dead', title: 'Romanian deadlift', note: 'Slow on the way down. From your deadlift max.', sets: [[8, 50], [8, 55], [8, 55]], mt: 'Team of 3 · 30 min', lv: { rx: 'AMRAP, one person works at a time:\n20 cal ski\n15 kettlebell swings (53/35 lb)\n10 sandbag cleans (100/70 lb)', mid: 'AMRAP, one person works at a time:\n16 cal ski\n15 kettlebell swings (35/26 lb)\n10 sandbag cleans (70/50 lb)', beg: 'AMRAP, one person works at a time:\n12 cal ski\n15 kettlebell deadlifts\n10 sandbag deadlifts' } },
  };
  const WLV = LEVELS.length >= 3 ? [['beg', LEVELS[0][0], LVC[LEVELS[0][1]]], ['mid', LEVELS[1][0], LVC[LEVELS[1][1]]], ['rx', LEVELS[2][0], LVC[LEVELS[2][1]]]] : [['beg', 'Beginner', 'var(--p-green)'], ['mid', 'Intermediate', 'var(--p-yellow)'], ['rx', 'Rx', 'var(--p-red)']];
  let wodDay = todayKey === 'Sun' ? 'Mon' : todayKey, level = 'mid';
  pillGroup($('#wodDays'), Object.keys(WEEK).map((d) => [d, d === todayKey ? d + ' · today' : d]), (d) => { wodDay = d; drawWod(); });
  pillGroup($('#lvlBtns'), WLV.map(([v, n]) => [v, n]), (v) => { level = v; drawWod(); });
  const maxes = () => ({ squat: +$('#mxSquat').value || 0, bench: +$('#mxBench').value || 0, dead: +$('#mxDead').value || 0, clean: +$('#mxClean').value || 0 });
  function drawWod() {
    pressed($('#wodDays'), wodDay); pressed($('#lvlBtns'), level);
    const w = WEEK[wodDay], m = maxes(), bar = +$('#barSel').value;
    $('#sTitle').textContent = w.title; $('#sNote').textContent = w.note; $('#mTitle').textContent = w.mt;
    $('#mBody').textContent = w.lv[level]; $('#mBody').style.setProperty('--lv', WLV.find((l) => l[0] === level)[2]);
    const body = $('#sBody'); body.replaceChildren();
    w.sets.forEach(([reps, pct], i) => { const load = Math.max(bar, round5((m[w.lift] * pct) / 100)); const tr = el('tr'); tr.append(el('td', 'mono', String(i + 1)), el('td', 'mono', String(reps)), el('td', 'mono', pct + '%'), el('td', 'w', load + ' lb')); const td = el('td'); td.append(loadoutEl(perSide(load, bar))); tr.append(td); body.append(tr); });
  }
  ['#mxSquat', '#mxBench', '#mxDead', '#mxClean', '#barSel'].forEach((s) => $(s).addEventListener('input', drawWod));
  drawWod();

  /* DSI board: members who opted in (site_board). Only name, DSI, lifts and a recent PR come back. */
  const TIERS = [[0, 'Green plate', 'var(--p-green)'], [300, 'Yellow plate', 'var(--p-yellow)'], [400, 'Blue plate', 'var(--p-blue)'], [500, 'Red plate', 'var(--p-red)'], [600, 'Dandy', 'var(--p-dandy)']];
  const dsiScore = (a) => { const total = a.squat + a.bench + a.dead + a.clean; if (!a.bw || !total) return 0; let s = (total / a.bw) * 100; if (a.sex === 'F') s *= 1.2; if (a.age >= 35) s *= 1 + (a.age - 35) * 0.012; return Math.round(s); };
  const tierOf = (s) => TIERS.filter((t) => s >= t[0]).pop();
  const nextTier = (s) => TIERS.find((t) => t[0] > s);
  const tierEl = (s) => { const t = tierOf(s); const x = el('span', 'tier'); x.style.color = t[2]; x.append(el('i'), document.createTextNode(t[1])); return x; };
  TIERS.slice().reverse().forEach(([min, nm, c], i, arr) => { const r = el('div'); const d = el('span', 'disc'); d.style.borderColor = c; r.append(d, el('span', '', nm), el('span', 'mono', i === 0 ? min + '+' : min + ' to ' + (arr[i - 1][0] - 1))); $('#tierKey').append(r); });
  const daysAgo = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return d; };
  let A = [];
  const LIFTNAME = { dsi: 'DSI', squat: 'Squat', bench: 'Bench', dead: 'Deadlift', clean: 'Clean' };
  const state = { lift: 'dsi', div: 'all', all: false };
  pillGroup($('#liftSeg'), [['dsi', 'DSI'], ['squat', 'Squat'], ['bench', 'Bench'], ['dead', 'Deadlift'], ['clean', 'Clean']], (v) => { state.lift = v; drawBoard(); });
  pillGroup($('#divSeg'), [['all', 'Everyone'], ['M', 'Men'], ['F', 'Women']], (v) => { state.div = v; drawBoard(); });
  $('#moreBtn').addEventListener('click', () => { state.all = !state.all; drawBoard(); });
  function drawBoard() {
    pressed($('#liftSeg'), state.lift); pressed($('#divSeg'), state.div);
    $('#valHead').textContent = state.lift === 'dsi' ? 'DSI' : LIFTNAME[state.lift] + ' (lb)';
    const rows = A.filter((a) => (state.div === 'all' || a.sex === state.div) && a[state.lift] > 0).sort((x, y) => y[state.lift] - x[state.lift]);
    $('#boardCount').textContent = rows.length ? rows.length + (rows.length === 1 ? ' member' : ' members') : '';
    $('#boardTbl').classList.toggle('all', state.all);
    $('#moreBtn').hidden = rows.length <= 10; $('#moreBtn').textContent = state.all ? 'Show top 10' : 'Show full board';
    const crown = state.lift === 'dsi' && state.div === 'all' && rows.length > 1;
    const body = $('#boardBody'); body.replaceChildren();
    rows.forEach((a, i) => {
      const tr = el('tr', i === 0 && crown ? 'crown' : ''); const who = el('td', 'who'); who.append(el('b', '', a.n));
      if (a.pr && (state.lift === 'dsi' || state.lift === a.pr.lift)) who.append(el('span', 'badge-pr', 'PR'));
      if (i === 0 && crown) { const c = el('span', 'chip', 'Reigning Dandy'); c.style.marginLeft = '6px'; who.append(c); }
      const t = el('td'); t.append(tierEl(a.dsi)); tr.append(el('td', 'rk', String(i + 1)), who, t, el('td', 'score', String(a[state.lift]))); body.append(tr);
    });
    if (!rows.length) { const tr = el('tr'); const td = el('td', 'muted', A.length ? 'Nobody on the board for this lift yet.' : 'No members on the public board yet. Members choose to show up here from their Dandy profile.'); td.colSpan = 4; td.style.padding = '18px 8px'; tr.append(td); body.append(tr); }
  }
  function drawPRs() {
    const wall = $('#prWall'); wall.replaceChildren();
    const prs = A.filter((a) => a.pr).sort((x, y) => x.pr.ago - y.pr.ago);
    $('#prCount').textContent = prs.length; $('#prMini').hidden = !showBoard || !prs.length;
    prs.forEach((a) => { const { lift, w, delta, ago } = a.pr; const c = el('article', 'card pr'); c.style.setProperty('--pc', tierOf(a.dsi)[2]); const big = el('div', 'big', String(w)); big.append(el('small', '', 'lb')); const row = el('div', 'row'); row.append(el('span', 'delta', `+${delta} lb`));
      c.append(el('span', 'date', daysAgo(ago).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })), big, el('div', 'lift', `${a.n} · ${LIFTNAME[lift]}`), row); wall.append(c); });
    if (!prs.length) wall.append(el('p', 'muted', 'No PRs posted on the board this week yet.'));
  }
  const goalsSet = {};
  function drawCalc() {
    const me = { sex: $('#cSex').value, age: +$('#cAge').value || 0, bw: +$('#cBw').value || 0, squat: +$('#cSquat').value || 0, bench: +$('#cBench').value || 0, dead: +$('#cDead').value || 0, clean: +$('#cClean').value || 0 };
    me.dsi = dsiScore(me); const t = tierOf(me.dsi);
    $('#oScore').textContent = me.dsi; const ot = $('#oTier'); ot.replaceChildren(el('i'), document.createTextNode(t[1])); ot.style.color = t[2];
    $('#oMeter').style.width = Math.min(100, (me.dsi / 700) * 100) + '%'; $('#oMeter').style.background = t[2];
    const field = A.filter((a) => a.sex === me.sex), rank = 1 + field.filter((a) => a.dsi > me.dsi).length, nt = nextTier(me.dsi);
    $('#oRank').textContent = (field.length ? `You would rank #${rank} of ${field.length + 1} in the ${me.sex === 'M' ? "men's" : "women's"} division on the ${SHORT} board.` : `Be the first on the ${SHORT} board.`) + (nt ? ` ${nt[0] - me.dsi} points to ${nt[1]}.` : ' You hold the top tier.');
    const gb = $('#goalBody'); gb.replaceChildren(); const goalMe = { ...me };
    const updNote = () => { ['squat', 'bench', 'dead', 'clean'].forEach((k) => { goalMe[k] = +$('#goal_' + k).value || 0; }); const g = dsiScore(goalMe); $('#goalNote').textContent = `Hit these goals and your DSI becomes ${g} (${tierOf(g)[1]}), up ${g - me.dsi} points.`; };
    ['squat', 'bench', 'dead', 'clean'].forEach((k) => { const sug = round5(me[k] * 1.05 + 2.5) || 0; const inp = el('input'); inp.type = 'number'; inp.step = '5'; inp.id = 'goal_' + k; inp.setAttribute('aria-label', LIFTNAME[k] + ' goal'); inp.value = goalsSet[k] ?? sug;
      inp.addEventListener('input', () => { goalsSet[k] = +inp.value; updNote(); }); const td = el('td'); td.append(inp); const tr = el('tr'); tr.append(el('td', '', LIFTNAME[k]), el('td', 'mono', me[k] + ' lb'), el('td', 'mono', sug + ' lb'), td); gb.append(tr); });
    updNote();
  }
  ['#cSex', '#cAge', '#cBw', '#cSquat', '#cBench', '#cDead', '#cClean'].forEach((s) => $(s).addEventListener('input', () => { Object.keys(goalsSet).forEach((k) => delete goalsSet[k]); drawCalc(); }));
  if (showBoard) rpc('site_board', { p_key: G.slug || siteKey() }).then((rows) => {
    if (!Array.isArray(rows)) return;
    A = rows.map((r) => ({ n: String(r.n || 'Member'), sex: r.sex === 'F' ? 'F' : 'M', dsi: +r.dsi || 0, squat: +r.squat || 0, bench: +r.bench || 0, dead: +r.dead || 0, clean: +r.clean || 0, pr: r.pr && r.pr.lift ? { lift: r.pr.lift, w: +r.pr.w, delta: +r.pr.delta, ago: +r.pr.ago } : null }));
    drawBoard(); drawPRs(); drawCalc();
  }).catch(() => {});

  /* Booking: classes from the schedule; appointments by the hour inside the gym's booking hours, never over a class the coach teaches */
  const firstSvc = svcList.find((s) => s.kind !== 'waitlist') || svcList[0];
  const bk = { svc: firstSvc ? firstSvc.id : null, day: 0, time: null, coach: 'any', done: false };
  const dayAt = (off) => { const d = new Date(now); d.setDate(d.getDate() + off); return d; };
  svcList.forEach((s) => {
    const b = el('button', 'svc'); b.type = 'button'; b.dataset.v = s.id;
    b.append(el('b', '', s.short), el('span', 'd', s.desc));
    if (s.price) b.append(s.free ? el('span', 'chip free', 'Free') : el('span', 'chip' + (s.kind === 'waitlist' ? ' soon' : ''), s.price));
    b.addEventListener('click', () => { bk.svc = s.id; bk.time = null; bk.done = false; drawBook(); });
    $('#svcList').append(b);
  });
  const bookable = COACHES.filter(([, , c]) => c.books);
  const cs = $('#coachSel'); cs.append(new Option('Any available coach', 'any')); bookable.forEach(([n]) => cs.append(new Option(n, n)));
  cs.addEventListener('change', () => { bk.coach = cs.value; bk.time = null; drawBook(); });
  const span = (dk) => { const t = SCHEDULE[dk]; if (!t.length) return null; return [Math.floor(Math.min(...t.map((c) => mins(c[0]))) / 60), Math.ceil(Math.max(...t.map((c) => mins(c[0]) + (c[3] || 60))) / 60)]; };
  const apptHours = (dk) => { const ah = C.appt_hours || {}, w = DOWKEY.indexOf(dk), v = ah[w] || ah[String(w)]; if (Array.isArray(v) && v.length === 2) return v[1] > v[0] ? v : null; return span(dk); };
  const coachBusy = (coach, dk, start, len) => SCHEDULE[dk].some((c) => c[2] === coach && mins(c[0]) < start + len && start < mins(c[0]) + (c[3] || 60));
  function slotsFor(off) {
    const d = dayAt(off), dk = dayKey(d), s = SERVICES[bk.svc], out = [];
    if (!s) return out;
    if (s.kind === 'class') SCHEDULE[dk].forEach((c) => { if (!isOpen(c[1]) || s.raw.kind === 'drop_in') out.push({ t: c[0], sub: [c[1], (c[2] || '').split(' ')[0]].filter(Boolean).join(' · '), m: mins(c[0]), coach: c[2], what: c[1] }); });
    else if (s.kind === 'appt') {
      const hrs = apptHours(dk); if (hrs) for (let h = hrs[0]; h < hrs[1]; h++) {
        const m = h * 60, free = (bookable.length ? bookable.map(([n]) => n) : ['']).filter((n) => !n || !coachBusy(n, dk, m, s.len));
        const ok = bk.coach === 'any' ? free.length > 0 : free.includes(bk.coach);
        if (ok) out.push({ t: fmtMin(m), sub: bk.coach === 'any' ? (bookable.length ? `${free.length} coach${free.length === 1 ? '' : 'es'} free` : 'Open') : 'Open', m, coach: bk.coach === 'any' ? (free[0] || '') : bk.coach, what: s.name });
      }
    }
    return out.map((x) => ({ ...x, past: off === 0 && x.m <= nowMin + 30 }));
  }
  $('#smsNote').textContent = `Add your mobile and ${SHORT} can text you a reminder and follow up. Msg and data rates may apply. Reply STOP to opt out.`;
  function drawBook() {
    const s = SERVICES[bk.svc]; if (!s) return;
    pressed($('#svcList'), bk.svc);
    $('#extraRow').hidden = s.kind !== 'class';
    $('#bSubmit').textContent = s.kind === 'waitlist' ? 'Join the list' : s.kind === 'appt' ? `Request this session${s.raw.price_cents ? ' · ' + money(s.raw.price_cents) : ''}` : s.free ? 'Book my free class' : 'Book my class';
    $('#stepWhen').hidden = s.kind === 'waitlist'; $('#youNum').textContent = s.kind === 'waitlist' ? '2' : '3';
    if (s.kind !== 'waitlist') {
      $('#whenTitle').textContent = s.kind === 'appt' ? (bookable.length ? 'Pick a coach, day and time' : 'Pick a day and time') : 'Pick a class';
      $('#coachPick').hidden = !(s.kind === 'appt' && bookable.length);
      const db = $('#dateBtns'); db.replaceChildren();
      for (let off = 0; off < 7; off++) {
        const d = dayAt(off), n = slotsFor(off).filter((x) => !x.past).length;
        const b = el('button', '', off === 0 ? 'Today' : off === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));
        b.type = 'button'; b.dataset.v = String(off); b.disabled = n === 0; b.addEventListener('click', () => { bk.day = off; bk.time = null; drawBook(); }); db.append(b);
      }
      if (db.children[bk.day] && db.children[bk.day].disabled) { const first = [...db.children].findIndex((b) => !b.disabled); bk.day = first < 0 ? 0 : first; }
      pressed(db, String(bk.day));
      const sl = $('#slotList'); sl.replaceChildren();
      slotsFor(bk.day).forEach((x) => { const b = el('button', 'slotbtn'); b.type = 'button'; b.disabled = x.past; b.dataset.v = x.t; b.append(el('b', '', x.t), el('span', '', x.sub)); b.setAttribute('aria-pressed', String(!!bk.time && bk.time.t === x.t)); b.addEventListener('click', () => { bk.time = x; drawBook(); }); sl.append(b); });
      $('#slotNote').textContent = s.kind === 'appt' ? 'Pick a time that works. The coach confirms by text.' : s.raw.kind === 'drop_in' ? 'Drop ins can join any class or open gym.' : 'Arrive 10 minutes early. Your coach will meet you at the door.';
    }
    $('#bookForm').hidden = bk.done; $('#bOk').hidden = !bk.done;
  }
  const startBooking = (svc, day, time) => {
    if (!SERVICES[svc]) svc = bk.svc; bk.svc = svc; bk.day = day || 0; bk.done = false; bk.time = null; drawBook();
    if (time) { const x = slotsFor(bk.day).find((s) => s.t === time); if (x && !x.past) { bk.time = x; drawBook(); } }
    scrollTo('book');
  };
  window.startBooking = startBooking;
  document.querySelectorAll('[data-book]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); startBooking(a.dataset.book); }));
  $('#bookForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const s = SERVICES[bk.svc], name = $('#bName').value.trim(), email = $('#bEmail').value.trim(), phone = $('#bPhone').value.trim(), err = $('#bErr');
    if (s.kind !== 'waitlist' && !bk.time) { err.textContent = 'Pick a time first.'; err.hidden = false; return; }
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Add your name and a valid email so we can confirm.'; err.hidden = false; return; }
    err.hidden = true;
    let at = null; if (bk.time) { at = dayAt(bk.day); at.setHours(0, 0, 0, 0); at.setMinutes(bk.time.m); }
    const note = [s.kind === 'class' ? 'Experience: ' + $('#bExp').value : '', s.kind === 'class' && $('#bHome').value.trim() ? 'Home gym: ' + $('#bHome').value.trim() : '', $('#bNote').value.trim(), bk.time && bk.time.coach ? 'Coach ' + bk.time.coach : ''].filter(Boolean).join('. ');
    const btn = $('#bSubmit'); btn.disabled = true;
    const call = s.kind === 'class'
      ? rpc('site_book_trial', { p_key: G.slug || siteKey(), p_name: name, p_phone: phone || null, p_email: email, p_at: at.toISOString(), p_what: s.name, p_note: note, p_sms_ok: true })
      : rpc('site_request_appointment', { p_service: s.id, p_name: name, p_email: email, p_phone: phone || null, p_starts_at: at ? at.toISOString() : null, p_session: null, p_notes: note || null });
    call.then(() => { btn.disabled = false; booked(); }).catch((x) => { btn.disabled = false; err.textContent = x.message || 'That did not go through. Text or call us instead.'; err.hidden = false; });
  });
  function booked() {
    const s = SERVICES[bk.svc], first = $('#bName').value.trim().split(' ')[0]; bk.done = true;
    const ok = $('#bOk'); ok.replaceChildren();
    const d = bk.time ? dayAt(bk.day).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : '';
    const who = bk.time && bk.time.coach ? ' with Coach ' + bk.time.coach : '';
    ok.append(el('b', '', s.kind === 'class' ? "You're booked" : s.kind === 'waitlist' ? "You're on the list" : 'Session requested'),
      el('p', '', s.kind === 'waitlist' ? `${first}, we will text you as soon as ${s.name.toLowerCase()} opens.` : `${first}, see you ${d} at ${bk.time.t}${who}. ${s.kind === 'class' ? 'We will text you a reminder the night before.' : 'We will text you to confirm.'}`));
    const again = el('button', 'btn', 'Book something else'); again.type = 'button'; again.style.justifySelf = 'start'; again.addEventListener('click', () => { bk.done = false; bk.time = null; drawBook(); }); ok.append(again);
    drawBook();
  }
  drawBook();

  /* Events from Dandy (published events only), with real registration */
  if (showEvents) {
    const tz = G.tz || 'America/New_York';
    const EVENTS = D.events.map((e) => { const d = new Date(e.starts_at); return { id: e.id, d: new Date(d.toLocaleString('en-US', { timeZone: tz })), time: d.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase(), title: e.title, desc: e.description || '', cap: e.capacity, left: e.spots_left, divisions: e.divisions || [], price: e.price_cents, shirt: e.ask_shirt_size }; });
    let calY = now.getFullYear(), calM = now.getMonth(), selEvent = null; const lastEv = EVENTS[EVENTS.length - 1].d;
    const spots = (e) => e.cap == null ? '' : ` · ${e.left} spot${e.left === 1 ? '' : 's'} left`;
    function drawCal() {
      $('#calTitle').textContent = new Date(calY, calM, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      $('#calPrev').disabled = calY === now.getFullYear() && calM === now.getMonth(); $('#calNext').disabled = calY === lastEv.getFullYear() && calM === lastEv.getMonth();
      const g = $('#calGrid'); g.replaceChildren(); ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach((d) => g.append(el('span', 'dow', d)));
      const first = new Date(calY, calM, 1), lead = (first.getDay() + 6) % 7, n = new Date(calY, calM + 1, 0).getDate();
      for (let i = 0; i < lead; i++) g.append(el('span'));
      for (let day = 1; day <= n; day++) {
        const ev = EVENTS.find((e) => e.d.getFullYear() === calY && e.d.getMonth() === calM && e.d.getDate() === day);
        const isT = calY === now.getFullYear() && calM === now.getMonth() && day === now.getDate();
        const b = el(ev ? 'button' : 'span', 'd' + (ev ? ' has' : '') + (isT ? ' today' : ''), String(day));
        if (ev) { b.type = 'button'; b.setAttribute('aria-label', `${ev.title}, ${ev.d.toDateString()}`); b.setAttribute('aria-pressed', String(selEvent === ev.id)); b.addEventListener('click', () => openSignup(ev.id)); }
        g.append(b);
      }
    }
    $('#calPrev').addEventListener('click', () => { calM--; if (calM < 0) { calM = 11; calY--; } drawCal(); });
    $('#calNext').addEventListener('click', () => { calM++; if (calM > 11) { calM = 0; calY++; } drawCal(); });
    function drawEvList() {
      const host = $('#evList'); host.replaceChildren();
      EVENTS.forEach((e) => {
        const c = el('article', 'card ev' + (selEvent === e.id ? ' hl' : ''));
        const dt = el('div', 'date'); dt.append(el('span', '', e.d.toLocaleDateString('en-US', { month: 'short' })), el('b', '', String(e.d.getDate())));
        const mid = el('div'); mid.append(el('h3', '', e.title), el('p', '', e.desc), el('div', 'meta', `${e.d.toLocaleDateString('en-US', { weekday: 'long' })} · ${e.time}${e.price ? ' · ' + money(e.price) : ''}${spots(e)}`));
        const go = el('button', 'btn', e.joined ? "You're in" : 'Sign up'); go.type = 'button'; go.classList.add('go'); go.disabled = !!e.joined; go.addEventListener('click', () => openSignup(e.id, true));
        c.append(dt, mid, go); host.append(c);
      });
    }
    function openSignup(id, scroll) {
      const e = EVENTS.find((x) => x.id === id); selEvent = id; calY = e.d.getFullYear(); calM = e.d.getMonth(); drawCal(); drawEvList();
      $('#evPanel').hidden = false; $('#calToggle').setAttribute('aria-expanded', 'true'); $('#calToggle').textContent = 'Hide calendar';
      const s = $('#signup'); s.replaceChildren(el('span', 'eyebrow', 'Sign up'), el('h3', '', e.title), el('span', 'spots', `${e.d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${e.time}${spots(e)}`));
      if (e.joined) { s.append(el('p', 'muted', "You're signed up. See you there.")); return; }
      const f = el('form', 'form'); f.noValidate = true;
      const field = (label, node) => { const l = el('label', '', label); l.append(node); return l; };
      const inp = (type, auto) => { const i = el('input'); i.type = type; if (auto) i.autocomplete = auto; return i; };
      const nm = inp('text', 'name'), em = inp('email', 'email'), ph = inp('tel', 'tel');
      f.append(field('Name', nm), field('Email', em), field('Mobile phone', ph));
      let dv = null, sh = null;
      if (e.divisions.length) { dv = el('select'); e.divisions.forEach((o) => dv.append(new Option(o))); f.append(field('Division', dv)); }
      if (e.shirt) { sh = el('select'); ['S', 'M', 'L', 'XL', 'XXL'].forEach((o) => sh.append(new Option(o))); f.append(field('Shirt size', sh)); }
      const err = el('p', '', ''); err.style.cssText = 'color:var(--bad);font-size:.88rem'; err.hidden = true;
      const sub = el('button', 'btn primary', 'Save my spot'); sub.type = 'submit'; sub.style.justifySelf = 'start'; f.append(err, sub);
      f.addEventListener('submit', (ev) => {
        ev.preventDefault();
        if (!nm.value.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em.value.trim())) { err.textContent = 'Add your name and a valid email.'; err.hidden = false; return; }
        sub.disabled = true;
        rpc('site_register_event', { p_event: e.id, p_name: nm.value.trim(), p_email: em.value.trim(), p_phone: ph.value.trim() || null, p_division: dv ? dv.value : null, p_shirt_size: sh ? sh.value : null, p_team: null, p_pay_at_gym: true })
          .then((r) => { e.joined = true; if (e.left) e.left--; drawEvList();
            s.replaceChildren(el('span', 'eyebrow', r && r.status === 'waitlist' ? 'Waitlist' : 'Signed up'), el('h3', '', r && r.status === 'waitlist' ? 'You are on the waitlist' : `See you at ${e.title}`), el('p', 'muted', `${nm.value.trim().split(' ')[0]}, you're on the list for ${e.d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at ${e.time}.${e.price ? ' Pay at the gym.' : ''}`)); })
          .catch((x) => { sub.disabled = false; err.textContent = x.message; err.hidden = false; });
      });
      s.append(f); if (scroll) scrollTo('evPanel', 'nearest');
    }
    $('#calToggle').addEventListener('click', () => { const p = $('#evPanel'); p.hidden = !p.hidden; $('#calToggle').setAttribute('aria-expanded', String(!p.hidden)); $('#calToggle').textContent = p.hidden ? 'Calendar view' : 'Hide calendar'; });
    drawCal(); drawEvList();
  }

  /* Store from Dandy (visible products), orders go to the gym for pickup */
  if (showStore) {
    const cart = [];
    D.products.forEach((p) => {
      const c = el('article', 'card prod'), img = el('div', 'img');
      if ((p.images || []).length) { const im = el('img'); im.src = MEDIA + p.images[0]; im.alt = p.name; im.loading = 'lazy'; im.style.cssText = 'width:100%;height:100%;object-fit:cover'; img.append(im); }
      else img.append(el('b', '', SHORT));
      if (p.tag) { const t = el('span', 'chip', p.tag); t.style.cssText = 'position:absolute;top:8px;left:8px;background:var(--panel)'; img.append(t); }
      const row = el('div', 'row'); row.append(el('b', '', p.name), el('span', 'price', money(p.price_cents)));
      const ctl = el('div', 'ctl'), s = el('select'); s.setAttribute('aria-label', p.name + ' option');
      (p.variants || []).forEach((v) => s.append(new Option([v.size, v.color].filter(Boolean).join(' · ') || 'One size', v.id)));
      if (!(p.variants || []).length) s.append(new Option('One size', ''));
      const add = el('button', 'btn add', 'Add'); add.type = 'button';
      add.addEventListener('click', () => { const v = (p.variants || []).find((x) => x.id === s.value); cart.push({ p, v, label: s.options[s.selectedIndex].text, price: v ? v.price_cents : p.price_cents }); add.textContent = 'Added'; setTimeout(() => { add.textContent = 'Add'; }, 1200); drawCart(); });
      ctl.append(s, add); c.append(img, row, ctl); $('#products').append(c);
    });
    function drawCart() {
      $('#cartCount').textContent = cart.length; const lines = $('#cartLines'); lines.replaceChildren();
      if (!cart.length) lines.append(el('p', 'muted', 'Your cart is empty.'));
      cart.forEach((it, i) => { const l = el('div', 'line'); const rm = el('button', '', 'Remove'); rm.type = 'button'; rm.addEventListener('click', () => { cart.splice(i, 1); drawCart(); }); const right = el('span', 'mono', money(it.price)); right.append(rm); l.append(el('span', '', `${it.p.name} · ${it.label}`), right); lines.append(l); });
      $('#cartTotal').textContent = money(cart.reduce((s, it) => s + it.price, 0)); $('#checkout').disabled = !cart.length;
    }
    $('#cartToggle').addEventListener('click', () => { const p = $('#cartPanel'); p.hidden = !p.hidden; $('#cartToggle').setAttribute('aria-expanded', String(!p.hidden)); });
    $('#cartForm').addEventListener('submit', (e) => {
      e.preventDefault(); const m = $('#cartMsg'), nm = $('#oName').value.trim();
      if (!nm || (!$('#oPhone').value.trim() && !$('#oEmail').value.trim())) { m.textContent = 'Add your name and a phone or email.'; m.hidden = false; return; }
      $('#checkout').disabled = true;
      rpc('site_place_order', { p_key: G.slug || siteKey(), p_items: cart.map((it) => it.v ? { variant_id: it.v.id, qty: 1 } : { product_id: it.p.id, qty: 1 }), p_name: nm, p_email: $('#oEmail').value.trim() || null, p_phone: $('#oPhone').value.trim() || null, p_delivery: 'pickup', p_ship_to: null })
        .then(() => { cart.length = 0; drawCart(); m.textContent = `Order placed. ${SHORT} will text you when it is ready for pickup.`; m.hidden = false; })
        .catch((x) => { $('#checkout').disabled = false; m.textContent = x.message; m.hidden = false; });
    });
    drawCart();
  }

  /* FAQ */
  (C.faq || []).forEach((f) => { const c = el('div', 'card faqq'), d = el('details'); d.append(el('summary', '', f.q || ''), el('p', '', f.a || '')); c.append(d); $('#faqGrid').append(c); });

  /* Contact: address, map, phone, hours, social */
  const mapQ = L.map_query || [NAME, fullAddr].filter(Boolean).join(' ');
  const gmaps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(mapQ);
  $('#mapLink').href = gmaps; $('#cDir').href = gmaps;
  if (D.code && D.code.map_svg) { $('#mapBox').innerHTML = D.code.map_svg; $('#mapCredit').textContent = 'Map data © OpenStreetMap contributors.'; }
  else if (mapQ) { const f = el('iframe'); f.src = 'https://www.google.com/maps?output=embed&q=' + encodeURIComponent(mapQ); f.title = 'Map of ' + NAME; f.loading = 'lazy'; f.referrerPolicy = 'no-referrer-when-downgrade'; f.style.cssText = 'display:block;width:100%;aspect-ratio:940/660;border:0'; $('#mapLink').replaceWith(f); }
  $('#cAddr').textContent = fullAddr;
  const dirs = $('#cDirections'); if (C.directions_bold) dirs.append(Object.assign(el('b', '', C.directions_bold), { style: 'color:var(--fg)' })); if (C.directions) dirs.append(' ' + C.directions); dirs.hidden = !C.directions_bold && !C.directions;
  const phoneRaw = (D.text_line && D.text_line.phone) || G.phone || '';
  const digits = String(G.phone || phoneRaw).replace(/\D/g, '').slice(-10), txDigits = String(phoneRaw).replace(/\D/g, '').slice(-10);
  if (digits.length === 10) { $('#cPhone').textContent = digits.replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3'); $('#cCall').href = 'tel:+1' + digits; } else { $('#cPhoneRow').hidden = true; $('#cCall').hidden = true; }
  if (G.email) { $('#cEmail').textContent = G.email; $('#cEmailRow').hidden = false; }
  const hrs = Array.isArray(S.hours) ? S.hours : [];
  hrs.forEach((r, i) => { const d = el('div'); if (i === hrs.length - 1) d.style.borderBottom = '0'; d.append(el('span', '', r.label || ''), el('span', 'mono', r.text || '')); $('#cHours').append(d); });
  if (!hrs.length) $('#cHours').closest('.cc').hidden = true;
  const LBL = [['ig', 'Instagram'], ['fb', 'Facebook'], ['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['x', 'X'], ['google', 'Google reviews'], ['yelp', 'Yelp'], ['crossfit', 'CrossFit.com']];
  const socials = LBL.filter(([k]) => https(SOC[k])).map(([k, n]) => [n, https(SOC[k])]);
  $('#cFollow').textContent = 'Follow ' + SHORT;
  socials.forEach(([n, u]) => { const a = el('a', '', n); a.href = u; a.target = '_blank'; a.rel = 'noopener'; a.prepend(el('i')); $('#cSocial').append(a); const f = el('a', '', n); f.href = u; f.target = '_blank'; f.rel = 'noopener'; $('#fFollow').append(f); });
  const fc = el('a', '', 'Contact'); fc.href = '#contact'; $('#fFollow').append(fc);
  $('#cSocialCard').hidden = !socials.length;

  /* Extra pages the gym published (plain text, paragraphs) */
  (D.pages || []).forEach((p) => {
    const s = el('section'); s.id = 'page-' + p.slug; const w = el('div', 'wrap'), h = el('div', 'sec-head'), t = el('div', 't'); t.append(el('h2', '', p.title)); h.append(t); w.append(h);
    const body = el('div', 'card'); body.style.cssText = 'display:grid;gap:12px;max-width:76ch';
    String(p.body || '').split(/\n\s*\n/).forEach((para) => body.append(el('p', '', para.replace(/^#+\s*/, '')))); w.append(body); s.append(w); $('#pagesHost').append(s);
  });

  /* Member band */
  $('#mbH').textContent = 'Get more out of ' + SHORT;

  /* Copy buttons */
  document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const node = document.getElementById(b.dataset.copy);
    try { await navigator.clipboard.writeText(node.textContent); b.textContent = 'Copied'; } catch { const r = document.createRange(); r.selectNodeContents(node); const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = 'Selected'; }
    setTimeout(() => { b.textContent = 'Copy'; }, 1600);
  }));

  /* Mobile menu */
  const mb = $('#menuBtn'), nav = $('#nav');
  mb.addEventListener('click', () => { const o = nav.classList.toggle('open'); mb.setAttribute('aria-expanded', String(o)); });
  nav.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => { nav.classList.remove('open'); mb.setAttribute('aria-expanded', 'false'); }));

  /* Text us: the lead lands in the gym's Dandy inbox and a coach texts back */
  (() => {
    const fab = $('#txFab'), panel = $('#txPanel'), body = $('#txBody'), form = $('#txForm'), name = $('#txName'), phone = $('#txPhone'), msg = $('#txMsg'), nativeA = $('#txNative');
    if (D.text_line && D.text_line.widget === false) { fab.hidden = true; return; }
    $('#txAv').textContent = SHORT.slice(0, 4); $('#txTitle').textContent = 'Text ' + NAME; panel.setAttribute('aria-label', 'Text ' + NAME);
    $('#txHello').textContent = `Hey! This is ${SHORT}${TOWN ? ' in ' + TOWN : ''}. Ask us anything: ${intro ? (intro.free ? 'free class, ' : 'classes, ') : ''}pricing${appts.length ? ', ' + appts[0].name.toLowerCase() : ''}. What can we help with?`;
    $('#txLegal').textContent = `By sending, you agree ${SHORT} may text you about your question. Msg and data rates may apply. Reply STOP to opt out.`;
    const quick = Array.isArray(C.text_quick) && C.text_quick.length ? C.text_quick : [[intro && intro.free ? 'Free class' : 'Try a class', `Hi! I'd like to try a class. What times work this week?`], ['Pricing', 'Hi! What does membership cost?'], ...appts.slice(0, 1).map((s) => [s.name, `Hi! I'm interested in ${s.name.toLowerCase()}.`])];
    quick.forEach(([label, q]) => { const b = el('button', '', label); b.type = 'button'; b.dataset.q = q; $('#txQuick').append(b); });
    const toggle = (open) => { panel.classList.toggle('open', open); fab.setAttribute('aria-expanded', String(open)); if (open) setTimeout(() => (name.value ? msg : name).focus(), 30); };
    fab.addEventListener('click', () => toggle(!panel.classList.contains('open')));
    $('#txClose').addEventListener('click', () => toggle(false));
    document.querySelectorAll('[data-open-text]').forEach((b) => b.addEventListener('click', () => toggle(true)));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel.classList.contains('open')) { toggle(false); fab.focus(); } });
    const syncNative = () => { nativeA.href = txDigits.length === 10 ? 'sms:+1' + txDigits + '?&body=' + encodeURIComponent(msg.value || 'Hi ' + SHORT + '!') : '#contact'; nativeA.hidden = txDigits.length !== 10; };
    msg.addEventListener('input', syncNative); syncNative();
    $('#txQuick').addEventListener('click', (e) => { const b = e.target.closest('button[data-q]'); if (!b) return; msg.value = b.dataset.q; syncNative(); (name.value ? (phone.value ? msg : phone) : name).focus(); });
    const bubble = (t, who) => { const d = el('div', 'tx-b ' + who, t); body.append(d); body.scrollTop = body.scrollHeight; };
    const meta = (t) => { const d = el('div', 'tx-meta', t); body.append(d); body.scrollTop = body.scrollHeight; };
    form.addEventListener('submit', (e) => {
      e.preventDefault(); const dg = phone.value.replace(/\D/g, '');
      if (!name.value.trim()) { name.focus(); return; }
      if (dg.length < 10) { phone.focus(); phone.setCustomValidity('Enter a 10 digit mobile'); phone.reportValidity(); phone.setCustomValidity(''); return; }
      if (!msg.value.trim()) { msg.focus(); return; }
      const q = $('#txQuick'); if (q) q.remove();
      const first = name.value.trim().split(' ')[0], text = msg.value.trim(); bubble(text, 'me'); msg.value = ''; syncNative();
      rpc('site_text_us', { p_key: G.slug || siteKey(), p_name: name.value.trim(), p_phone: dg.slice(-10), p_message: text })
        .then(() => { meta('Sent · we will text ' + dg.slice(-10).replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3')); setTimeout(() => bubble(`Thanks ${first}! Got it. A coach will text you back at this number shortly.`, 'them'), 500); })
        .catch((x) => meta(x.message || 'That did not send. Try the texting app link below.'));
    });
  })();
  }
})();
