// Gym office, owners only.
//   /website/<gym>  The gym's website: status and address, look, hero, sections, every block of copy, coaches,
//                   who coaches each class, search listing, and (DSI team only) custom code and the drawn map.
//   /sell/<gym>     What the gym sells: membership plans (price, billing, what's included, how it shows on the site)
//                   and services (intro class, drop in, personal training, massage, nutrition, anything booked by time).
// One template draws every gym's site from this data (site/gs). Nothing here is per gym code.

export function install(X) {
  const { sb, S, VIEWS, $, $$, esc, num, toast, must, paint, needLogin, go } = X;
  const isOwner = gid => (S.me && S.me.role === 'admin') || (S.myGyms || []).some(g => g.gym_id === gid && g.role === 'owner');
  const isDsi = () => S.me && S.me.role === 'admin';
  const money = c => '$' + (num(c) / 100).toLocaleString('en-US', { minimumFractionDigits: num(c) % 100 ? 2 : 0, maximumFractionDigits: 2 });
  const cents = v => Math.round(parseFloat(String(v).replace(/[^0-9.]/g, '')) * 100) || 0;
  const bar = (g, k) => X.officeBar ? X.officeBar(g, k) : `<section class="sec"><h2>${esc(g.name)}</h2></section>`;
  const val = (f, k) => { const n = f.querySelector(`[data-k="${k}"]`); return !n ? undefined : n.type === 'checkbox' ? n.checked : n.value.trim(); };
  const lines = t => String(t || '').split('\n').map(s => s.trim()).filter(Boolean);
  const inp = (k, v, attrs = '') => `<input data-k="${k}" value="${esc(v ?? '')}" ${attrs}>`;
  const area = (k, v, rows = 3, attrs = '') => `<textarea data-k="${k}" rows="${rows}" ${attrs}>${esc(v ?? '')}</textarea>`;
  const chk = (k, on, label) => `<label class="check"><input type="checkbox" data-k="${k}"${on ? ' checked' : ''}><span>${label}</span></label>`;
  const fld = (label, html, w = '') => `<div class="field${w ? ' ' + w : ''}"><label>${label}</label>${html}</div>`;
  const siteUrls = (g, s) => [`https://dandystrength.com/site/${g.slug || s.subdomain}`, ...(s.subdomain && s.domain_status === 'live' ? [`https://${s.subdomain}.dandystrength.com`] : []), ...(s.custom_domain ? [`https://${s.custom_domain}`] : [])];

  async function gymFor(gid, tok, what) {
    if (!S.me) { needLogin(tok, what); return null; }
    if (!gid && (S.myGyms || []).length) { go(location.pathname.split('/').slice(0, 2).join('/') + '/' + S.myGyms[0].gym_id, true); return null; }
    if (!isOwner(gid)) { paint(tok, '<section class="prEmpty"><b>Owners only</b><p>Gym owners manage the website and what the gym sells here.</p></section>'); return null; }
    return must(await sb.from('gyms').select('*').eq('id', gid).maybeSingle());
  }

  /* ================= Website ================= */
  const SECTIONS = [['community', 'Community and pillars'], ['social', 'Instagram and Facebook posts'], ['workouts', 'This week\'s workouts tab'], ['plans', 'Plans'], ['book', 'Online booking'], ['coaches', 'Coaches'], ['events', 'Events (published events only)'], ['store', 'Store (visible products only)'], ['faq', 'FAQ'], ['board', 'The DSI board']];
  const HEADS = [['community', 'Community'], ['classes', 'Classes'], ['plans', 'Plans'], ['book', 'Book'], ['coaches', 'Coaches'], ['events', 'Events'], ['store', 'Store'], ['faq', 'FAQ'], ['contact', 'Contact']];
  const LEVEL_COLORS = ['green', 'yellow', 'red', 'blue', 'teal', 'grey', 'dandy'];

  VIEWS.website = async (gid, tok) => {
    const g = await gymFor(gid, tok, 'manage your website'); if (!g) return;
    const [site, code, coaches, classes] = await Promise.all([
      sb.from('gym_sites').select('*').eq('gym_id', g.id).maybeSingle().then(must),
      sb.from('gym_site_code').select('*').eq('gym_id', g.id).maybeSingle().then(r => r.data || null),
      sb.from('site_coaches').select('*').eq('gym_id', g.id).order('sort').order('name').then(must),
      sb.from('classes').select('id,name,weekdays,start_time,site_coach_id,active').eq('gym_id', g.id).order('start_time').then(must),
    ]);
    const s = site || { brand: {}, hero: {}, announcement: {}, sections: {}, seo: {}, links: {}, content: {}, hours: [], social: {} };
    const b = s.brand || {}, h = s.hero || {}, an = s.announcement || {}, sec = s.sections || {}, seo = s.seo || {}, c = s.content || {};
    const heads = c.heads || {};
    const urls = siteUrls(g, s);
    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const t12 = t => { const [hh, mm] = String(t).split(':').map(Number); return `${hh % 12 || 12}:${String(mm).padStart(2, '0')}${hh < 12 ? 'am' : 'pm'}`; };
    const coachOpts = sel => `<option value="">Not shown</option>${coaches.map(x => `<option value="${x.id}"${x.id === sel ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}`;
    const rowList = (id, items, cols, add) => `<div class="wsList" id="${id}">${items.map(it => `<div class="wsRow">${cols(it)}<button type="button" class="btn ghost sm" data-rm>Remove</button></div>`).join('')}</div><button type="button" class="btn ghost sm" data-add="${id}">${add}</button>`;
    const pillarCols = p => `${inp('n', p.n, 'placeholder="9 or Free" maxlength="12" style="max-width:110px"')}${inp('title', p.title, 'placeholder="Title" maxlength="60"')}${inp('text', p.text, 'placeholder="One or two lines" maxlength="240"')}`;
    const progCols = p => `${inp('ages', p.ages, 'placeholder="Adults · All levels" maxlength="60"')}${inp('title', p.title, 'placeholder="Program" maxlength="60"')}${inp('text', p.text, 'placeholder="What it is" maxlength="240"')}`;
    const faqCols = f => `${inp('q', f.q, 'placeholder="Question" maxlength="120"')}${inp('a', f.a, 'placeholder="Answer" maxlength="400"')}`;
    const coachCols = x => `<input type="hidden" data-k="id" value="${x.id || ''}">${inp('name', x.name, 'placeholder="Full name" maxlength="80" required')}${inp('title', x.title, 'placeholder="Owner · Head coach" maxlength="60"')}${inp('bio', x.bio, 'placeholder="Short bio (optional)" maxlength="400"')}${chk('books', x.books !== false, 'Bookable')}${chk('show', x.show !== false, 'Show')}`;

    if (!paint(tok, `${bar(g, 'website')}<section class="sec wsPage">
      <div class="formCard"><div class="formH">Your website<span class="sub">One Dandy template, filled from your gym's data. Classes, plans, services, events and products update the site by themselves.</span></div>
        <div class="row" style="flex-wrap:wrap;gap:8px">${urls.map(u => `<a class="btn sm" href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace('https://', ''))}</a>`).join('')}</div>
        <form id="wsStatus" class="fields">${fld('Status', chk('published', s.published, 'Website is live'), 'w2')}${fld('Search engines', chk('indexed', !seo.noindex, 'Show in Google and Bing'), 'w2')}
          ${fld('Search title', inp('title', seo.title, `maxlength="70" placeholder="${esc(g.name)} | Gym in ${esc(g.city || 'your town')}"`), 'w2')}${fld('Search description', inp('description', seo.description, 'maxlength="160"'), 'w2')}
          <div class="field w4"><span class="hint">Your own domain (like yourgym.com) is connected by the Dandy team. Contact and social links are in <a href="/gym/${g.id}">Settings</a>. Plans and services are in <a href="/sell/${g.id}">Plans and services</a>.</span></div>
          </form><div class="row"><button class="btn sm" form="wsStatus">Save status</button></div></div>

      <form class="formCard" id="wsLook"><div class="formH">Look</div><div class="fields">
        ${fld('Gym name', inp('name', b.name || g.name, 'maxlength="80"'), 'w2')}${fld('Short name', inp('short', b.short, 'maxlength="12" placeholder="CFS"'))}${fld('Tagline', inp('tagline', b.tagline, 'maxlength="80"'))}
        ${fld('Background', `<input type="color" data-k="bg" value="${esc(b.bg || '#0A1430')}">`)}${fld('Main color', `<input type="color" data-k="primary" value="${esc(b.primary || '#2F6BFF')}">`)}${fld('Button color', `<input type="color" data-k="accent" value="${esc(b.accent || '#F7C531')}">`)}
        ${fld('Logo', `<input type="file" data-k="logo" accept="image/png,image/svg+xml,image/jpeg,image/webp">${b.logo_path ? `<span class="hint">Current logo saved. ${chk('logo_clear', false, 'Remove it')}</span>` : '<span class="hint">Optional. Without one the site shows your short name with the Dandy mark.</span>'}`)}
        ${b.vars ? `<div class="field w4"><span class="hint">The Dandy team tuned a full palette for your site. Saving new colors here replaces it with one built from these three.</span>${chk('keep_palette', true, 'Keep the tuned palette')}</div>` : ''}
      </div><div class="row"><button class="btn sm">Save look</button></div></form>

      <form class="formCard" id="wsHero"><div class="formH">Top of the page</div><div class="fields">
        ${fld('Small line above the headline', inp('eyebrow', h.eyebrow, 'maxlength="140"'), 'w4')}
        ${fld('Headline', inp('headline', h.headline, 'maxlength="80"'), 'w2')}<div class="field w2"><span class="hint">Put *stars* around a word to color it, like Milford's best *community* gym.</span></div>
        ${fld('Intro', area('sub', h.sub, 3, 'maxlength="400"'), 'w4')}
        ${fld('Announcement bar', chk('ann_on', an.on, 'Show a bar across the top'))}${fld('Announcement', inp('ann_text', an.text, 'maxlength="140"'), 'w2')}${fld('Link (optional)', inp('ann_link', an.link, 'maxlength="300" placeholder="#book or https://"'))}
        ${fld('Workout levels, one per line: name, color', area('levels', (c.levels || [['Beginner', 'green'], ['Rx', 'red']]).map(l => l.join(', ')).join('\n'), 3), 'w2')}<div class="field w2"><span class="hint">Colors: ${LEVEL_COLORS.join(', ')}. Leave empty to hide the level chips.</span></div>
      </div><div class="row"><button class="btn sm">Save top of page</button></div></form>

      <form class="formCard" id="wsSections"><div class="formH">Sections<span class="sub">Sections with nothing in them hide by themselves.</span></div><div class="fields">
        ${SECTIONS.map(([k, n]) => `<div class="field w2">${chk(k, sec[k] !== false, n)}</div>`).join('')}
      </div><div class="row"><button class="btn sm">Save sections</button></div></form>

      <form class="formCard" id="wsCopy"><div class="formH">Words on the page</div>
        <details><summary>Section headings</summary><div class="fields" style="margin-top:12px">${HEADS.map(([k, n]) => { const x = heads[k] || {}; return `<div class="field w4"><label>${n}</label><div class="wsRow" data-head="${k}">${inp('eyebrow', x.eyebrow, 'placeholder="Small label" maxlength="40"')}${inp('title', x.title, 'placeholder="Heading" maxlength="70"')}${inp('desc', x.desc, 'placeholder="One or two sentences" maxlength="300"')}${inp('chip', x.chip, 'placeholder="Tag (optional)" maxlength="30"')}</div></div>`; }).join('')}</div></details>
        <details><summary>Community pillars</summary><p class="hint">Type auto:classes as the number to show your coached classes a week.</p>${rowList('lsPillars', c.pillars || [], pillarCols, 'Add a pillar')}</details>
        <details><summary>Programs</summary>${rowList('lsProgs', c.programs || [], progCols, 'Add a program')}<div class="field" style="margin-top:12px"><label>Every membership includes, one per line</label>${area('included', (c.included || []).join('\n'), 4)}</div></details>
        <details><summary>FAQ</summary>${rowList('lsFaq', c.faq || [], faqCols, 'Add a question')}</details>
        <details><summary>Contact, footer and text us</summary><div class="fields" style="margin-top:12px">
          ${fld('Directions, bold part', inp('directions_bold', c.directions_bold, 'maxlength="120" placeholder="We are on the Route 131 side of the building."'), 'w2')}${fld('Directions, rest', inp('directions', c.directions, 'maxlength="200"'), 'w2')}
          ${fld('Motto', inp('motto', c.motto, 'maxlength="80"'), 'w2')}${fld('Today card title', inp('today_title', c.today_title, 'maxlength="40" placeholder="Today at the gym"'), 'w2')}
          ${fld('Footer about line', area('about', c.about, 2, 'maxlength="300"'), 'w4')}
          ${fld('Posts heading', inp('social_title', c.social_title, 'maxlength="40"'), 'w2')}${fld('Schedule note', inp('schedule_note', c.schedule_note, 'maxlength="120" placeholder="Ask us for kids class times."'), 'w2')}
          ${fld('Text us quick replies, one per line: button | message', area('text_quick', (c.text_quick || []).map(q => q.join(' | ')).join('\n'), 4), 'w4')}
        </div></details>
        <div class="row"><button class="btn sm">Save words</button></div></form>

      <form class="formCard" id="wsCoaches"><div class="formH">Coaches<span class="sub">Shown on the site and offered for personal training. No Dandy account needed.</span></div>
        ${rowList('lsCoaches', coaches, coachCols, 'Add a coach')}<div class="row"><button class="btn sm">Save coaches</button></div></form>

      <form class="formCard" id="wsClassCoach"><div class="formH">Who coaches each class<span class="sub">The schedule and coach cards on the site use this. Change times in <a href="/club/${g.id}?tab=schedule">Schedule</a>.</span></div>
        <div class="board"><div class="tablewrap"><table><thead><tr><th>Class</th><th>Days</th><th>Time</th><th>Coach on the site</th></tr></thead><tbody>
        ${classes.filter(x => x.active).map(x => `<tr><td><b>${esc(x.name)}</b></td><td>${x.weekdays.slice().sort().map(d => DOW[d]).join(' ')}</td><td>${t12(x.start_time)}</td><td><select data-cls="${x.id}">${coachOpts(x.site_coach_id)}</select></td></tr>`).join('') || '<tr><td colspan="4" class="empty">No weekly classes yet.</td></tr>'}
        </tbody></table></div></div><div class="row"><button class="btn sm">Save class coaches</button><span class="hint">Add coaches above first, then save them, then pick them here.</span></div></form>

      ${isDsi() ? `<form class="formCard" id="wsCode"><div class="formH">Dandy team only<span class="sub">Trusted code. Owners cannot see or change this.</span></div><div class="fields">
        ${fld('Custom CSS', area('css', code && code.custom_css, 6, 'spellcheck="false" style="font-family:monospace"'), 'w4')}
        ${fld('Head code (analytics, verification tags)', area('head', code && code.custom_head, 3, 'spellcheck="false" style="font-family:monospace"'), 'w4')}
        ${fld('Drawn map SVG (classes mbg, mb, mv, mr, ms, mp, ks, kp, mlbl, mpin)', area('map', code && code.map_svg, 4, 'spellcheck="false" style="font-family:monospace"'), 'w4')}
        ${fld('Subdomain', inp('subdomain', s.subdomain, 'maxlength="40" placeholder="cfs"'))}${fld('Custom domain', inp('custom_domain', s.custom_domain, 'maxlength="120" placeholder="crossfitsymmetry.com"'), 'w2')}${fld('Domain status', `<select data-k="domain_status">${['none', 'pending', 'verifying', 'live', 'error'].map(x => `<option${x === s.domain_status ? ' selected' : ''}>${x}</option>`).join('')}</select>`)}
      </div><div class="row"><button class="btn sm">Save code</button></div></form>` : ''}
    </section>`)) return;

    const again = () => VIEWS.website(gid, S.tok);
    const save = async (patch, msg) => {
      const { error } = await sb.from('gym_sites').upsert({ gym_id: g.id, ...patch }, { onConflict: 'gym_id' });
      if (error) { toast(error.message); return false; }
      toast(msg || 'Saved. The site shows it within a minute.'); return true;
    };
    const content = patch => ({ content: { ...(s.content || {}), ...patch } });

    // lists: add and remove rows
    $$('[data-add]').forEach(btn => btn.onclick = () => {
      const host = $('#' + btn.dataset.add);
      const cols = { lsPillars: pillarCols, lsProgs: progCols, lsFaq: faqCols, lsCoaches: coachCols }[btn.dataset.add];
      const row = document.createElement('div'); row.className = 'wsRow'; row.innerHTML = cols({}) + '<button type="button" class="btn ghost sm" data-rm>Remove</button>';
      host.append(row); wireRm(row); const first = row.querySelector('input:not([type=hidden])'); if (first) first.focus();
    });
    const wireRm = root => $$('[data-rm]', root).forEach(b => b.onclick = () => { const r = b.closest('.wsRow'); if (r.querySelector('[data-k="id"]') && r.querySelector('[data-k="id"]').value) { r.hidden = true; r.dataset.gone = '1'; } else r.remove(); });
    wireRm(document);
    const readRows = (id, keys) => $$('#' + id + ' .wsRow').filter(r => !r.dataset.gone).map(r => Object.fromEntries(keys.map(k => [k, val(r, k)]))).filter(o => Object.values(o).some(v => v && v !== true));

    $('#wsStatus').onsubmit = e => { e.preventDefault(); const f = e.target;
      save({ published: val(f, 'published'), seo: { ...seo, noindex: !val(f, 'indexed'), title: val(f, 'title') || null, description: val(f, 'description') || null } }).then(ok => ok && again()); };

    $('#wsLook').onsubmit = async e => { e.preventDefault(); const f = e.target;
      const nb = { ...b, name: val(f, 'name') || g.name, short: val(f, 'short') || null, tagline: val(f, 'tagline') || null };
      const colorsChanged = ['bg', 'primary', 'accent'].some(k => (b[k] || '').toLowerCase() !== val(f, k).toLowerCase());
      ['bg', 'primary', 'accent'].forEach(k => { nb[k] = val(f, k); });
      if (b.vars && colorsChanged && !val(f, 'keep_palette')) { delete nb.vars; delete nb.vars_light; }
      if (val(f, 'logo_clear')) delete nb.logo_path;
      const file = f.querySelector('[data-k="logo"]').files[0];
      if (file) {
        if (file.size > 2 * 1024 * 1024) return toast('Logo must be under 2 MB.');
        const path = `${g.id}/logo-${Date.now()}.${(file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        const { error } = await sb.storage.from('gym-media').upload(path, file, { upsert: true, contentType: file.type });
        if (error) return toast(error.message);
        await sb.from('gym_media').insert({ gym_id: g.id, path, kind: 'logo', created_by: S.me.id });
        nb.logo_path = path;
      }
      if (await save({ brand: nb })) again();
    };

    $('#wsHero').onsubmit = e => { e.preventDefault(); const f = e.target;
      const levels = lines(val(f, 'levels')).map(l => { const [n, col] = l.split(',').map(x => x.trim()); return [n, LEVEL_COLORS.includes((col || '').toLowerCase()) ? col.toLowerCase() : 'blue']; }).filter(l => l[0]);
      save({ hero: { ...h, eyebrow: val(f, 'eyebrow') || null, headline: val(f, 'headline') || null, sub: val(f, 'sub') || null },
        announcement: { on: val(f, 'ann_on'), text: val(f, 'ann_text'), link: val(f, 'ann_link') || null }, ...content({ levels }) }); };

    $('#wsSections').onsubmit = e => { e.preventDefault(); const f = e.target;
      save({ sections: { ...sec, ...Object.fromEntries(SECTIONS.map(([k]) => [k, val(f, k)])) } }); };

    $('#wsCopy').onsubmit = e => { e.preventDefault(); const f = e.target;
      const hd = {}; $$('[data-head]', f).forEach(r => { const o = Object.fromEntries(['eyebrow', 'title', 'desc', 'chip'].map(k => [k, val(r, k)]).filter(([, v]) => v)); if (Object.keys(o).length) hd[r.dataset.head] = o; });
      const tq = lines(val(f, 'text_quick')).map(l => { const i = l.indexOf('|'); return i < 0 ? [l, l] : [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }).filter(q => q[0] && q[1]);
      const pick = k => val(f, k) || null;
      save(content({ heads: hd, pillars: readRows('lsPillars', ['n', 'title', 'text']), programs: readRows('lsProgs', ['ages', 'title', 'text']), faq: readRows('lsFaq', ['q', 'a']).filter(x => x.q && x.a),
        included: lines(val(f, 'included')), directions_bold: pick('directions_bold'), directions: pick('directions'), motto: pick('motto'), today_title: pick('today_title'), about: pick('about'),
        social_title: pick('social_title'), schedule_note: pick('schedule_note'), text_quick: tq })); };

    $('#wsCoaches').onsubmit = async e => { e.preventDefault();
      const rows = $$('#lsCoaches .wsRow');
      for (const [i, r] of rows.entries()) {
        const id = val(r, 'id');
        if (r.dataset.gone) { if (id) { const { error } = await sb.from('site_coaches').delete().eq('id', id); if (error) return toast(error.message); } continue; }
        const row = { gym_id: g.id, name: val(r, 'name'), title: val(r, 'title') || null, bio: val(r, 'bio') || null, books: val(r, 'books'), show: val(r, 'show'), sort: i + 1 };
        if (!row.name) continue;
        const { error } = id ? await sb.from('site_coaches').update(row).eq('id', id) : await sb.from('site_coaches').insert(row);
        if (error) return toast(error.message);
      }
      toast('Coaches saved'); again(); };

    $('#wsClassCoach').onsubmit = async e => { e.preventDefault();
      for (const sel of $$('[data-cls]')) {
        const cur = classes.find(x => x.id === sel.dataset.cls); if ((cur.site_coach_id || '') === sel.value) continue;
        const { error } = await sb.from('classes').update({ site_coach_id: sel.value || null }).eq('id', cur.id); if (error) return toast(error.message);
      }
      toast('Class coaches saved'); again(); };

    if ($('#wsCode')) $('#wsCode').onsubmit = async e => { e.preventDefault(); const f = e.target;
      const { error } = await sb.from('gym_site_code').upsert({ gym_id: g.id, custom_css: val(f, 'css'), custom_head: val(f, 'head'), map_svg: val(f, 'map'), updated_by: S.me.id }, { onConflict: 'gym_id' });
      if (error) return toast(error.message);
      if (await save({ subdomain: val(f, 'subdomain') || null, custom_domain: val(f, 'custom_domain') || null, domain_status: val(f, 'domain_status') })) again(); };
  };

  /* ================= Plans and services ================= */
  const KINDS = [['intro_class', 'First class (books into a class time)'], ['drop_in', 'Drop in (books into a class time)'], ['appointment', 'Booked by the hour (personal training, massage, nutrition)'], ['waitlist', 'Coming soon list (no time picked)']];
  const INTERVALS = [['month', 'Monthly autopay'], ['year', 'Yearly autopay'], ['once', 'One payment (drop in, punch card, package)']];
  const opts = (list, v) => list.map(([k, n]) => `<option value="${k}"${k === v ? ' selected' : ''}>${esc(n)}</option>`).join('');

  VIEWS.sell = async (gid, tok) => {
    const g = await gymFor(gid, tok, 'manage plans and services'); if (!g) return;
    const [plans, services, site, ms] = await Promise.all([
      sb.from('plans').select('*').eq('gym_id', g.id).order('site_sort').order('price_cents').then(must),
      sb.from('services').select('*').eq('gym_id', g.id).order('sort').order('name').then(must),
      sb.from('gym_sites').select('gym_id,content').eq('gym_id', g.id).maybeSingle().then(r => r.data),
      sb.from('memberships').select('plan_id,status').eq('gym_id', g.id).then(r => r.data || []),
    ]);
    const live = id => ms.filter(m => m.plan_id === id && ['active', 'past_due'].includes(m.status)).length;
    const ah = (site && site.content && site.content.appt_hours) || {};
    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const hourOpts = v => Array.from({ length: 25 }, (_, i) => `<option value="${i}"${v !== '' && v !== undefined && +v === i ? ' selected' : ''}>${i === 0 || i === 24 ? '12am' : i < 12 ? i + 'am' : i === 12 ? '12pm' : i - 12 + 'pm'}</option>`).join('');
    const planForm = p => `<form class="formCard" data-plan="${p.id || ''}"><div class="formH">${p.id ? esc(p.name) : 'New plan'}${p.id ? `<span class="sub">${money(p.price_cents)} · ${live(p.id)} member${live(p.id) === 1 ? '' : 's'}${p.active ? '' : ' · not open to join yet'}</span>` : ''}</div><div class="fields">
        ${fld('Name', inp('name', p.name, 'maxlength="60" required placeholder="Unlimited"'), 'w2')}${fld('Price', inp('price', p.id ? (p.price_cents / 100).toFixed(p.price_cents % 100 ? 2 : 0) : '', 'inputmode="decimal" required placeholder="160"'))}${fld('Billing', `<select data-k="interval">${opts(INTERVALS, p.interval || 'month')}</select>`)}
        ${fld('Description', inp('description', p.description, 'maxlength="300"'), 'w2')}${fld('Classes a month', inp('cpm', p.classes_per_month, 'type="number" min="1" max="99" placeholder="Blank for unlimited"'))}${fld('Commitment months', inp('commit', p.commitment_months || 0, 'type="number" min="0" max="36"'))}
        ${fld('What\'s included, one per line', area('features', (p.site_features || []).join('\n'), 3), 'w2')}${fld('Price per class line', inp('per', p.site_per, 'maxlength="80" placeholder="Blank to work it out from classes a month"'))}${fld('Tag', inp('tag', p.site_tag, 'maxlength="30" placeholder="Best value"'))}
        <div class="field w2">${chk('active', p.id ? p.active : true, 'Open to join (members can start it in Dandy)')}${chk('show', p.id ? p.show_on_site : true, 'Show on the website')}</div>
        <div class="field w2">${chk('featured', p.featured, 'Highlight it on the website')}${chk('pro', p.includes_pro, 'Includes DSI Pro (your gym pays $4 a member a month)')}</div>
        ${fld('Order', inp('sort', p.site_sort || 0, 'type="number" min="0" max="99"'))}
      </div><div class="row"><button class="btn sm">${p.id ? 'Save plan' : 'Add plan'}</button><span class="hint">Price changes apply to new members. Existing autopay keeps its price.</span></div></form>`;
    const svcForm = v => `<form class="formCard" data-svc="${v.id || ''}"><div class="formH">${v.id ? esc(v.name) : 'New service'}${v.id ? `<span class="sub">${v.price_cents ? money(v.price_cents) + (v.price_note ? ' ' + esc(v.price_note) : '') : esc(v.price_note || 'Free')}${v.active ? '' : ' · hidden'}</span>` : ''}</div><div class="fields">
        ${fld('Name', inp('name', v.name, 'maxlength="80" required placeholder="Sports massage"'), 'w2')}${fld('How it books', `<select data-k="kind">${opts(KINDS, v.kind || 'appointment')}</select>`, 'w2')}
        ${fld('Price', inp('price', v.id ? (v.price_cents / 100).toFixed(v.price_cents % 100 ? 2 : 0) : '', 'inputmode="decimal" placeholder="0 for free"'))}${fld('Price note', inp('price_note', v.price_note, 'maxlength="60" placeholder="an hour, per session, Coming soon"'))}${fld('Minutes', inp('dur', v.duration_min || 60, 'type="number" min="5" max="600"'))}${fld('Order', inp('sort', v.sort || 0, 'type="number" min="0" max="99"'))}
        ${fld('Description', inp('description', v.description, 'maxlength="200" placeholder="1 on 1 or bring a friend"'), 'w4')}
        <div class="field w4">${chk('active', v.id ? v.active : true, 'Offer it on the website')}${chk('pay', v.require_payment, 'Ask for payment when booking (once card payments are on)')}</div>
      </div><div class="row"><button class="btn sm">${v.id ? 'Save service' : 'Add service'}</button>${v.id ? `<button type="button" class="btn ghost sm" data-del="${v.id}">Delete</button>` : ''}</div></form>`;

    if (!paint(tok, `${bar(g, 'sell')}<section class="sec">
      <div class="secHead"><div><div class="kicker">What ${esc(g.name)} sells</div><h2>Plans and <span>services</span></h2><p class="secSub">Your website, the member app and billing all read from here.</p></div></div>
      <h3 style="margin-top:8px">Membership <span>plans</span></h3>
      <div class="wsStack">${plans.map(planForm).join('')}${planForm({})}</div>
      <h3 style="margin-top:28px">Services <span>to book</span></h3>
      <p class="hint">Intro class and drop in book into your class times. Personal training, massage, nutrition and anything else by the hour book inside the hours below, and never over a class that coach is teaching. Requests land in Follow up and you confirm by text.</p>
      <div class="wsStack">${services.map(svcForm).join('')}${svcForm({})}</div>
      <form class="formCard" id="apptHours" style="margin-top:16px"><div class="formH">Hours for booked services<span class="sub">Blank days use your class times.</span></div><div class="fields">
        ${DOW.map((d, i) => { const v = ah[i] || ah[String(i)] || []; return `<div class="field"><label>${d}</label><div class="row" style="gap:6px"><select data-from="${i}"><option value="">Class times</option><option value="closed"${v.length === 2 && v[0] === v[1] ? ' selected' : ''}>Closed</option>${hourOpts(v.length === 2 && v[0] !== v[1] ? v[0] : '')}</select><select data-to="${i}"><option value="">to</option>${hourOpts(v.length === 2 && v[0] !== v[1] ? v[1] : '')}</select></div></div>`; }).join('')}
      </div><div class="row"><button class="btn sm">Save hours</button></div></form>
    </section>`)) return;

    const again = () => VIEWS.sell(gid, S.tok);
    $$('[data-plan]').forEach(f => f.onsubmit = async e => { e.preventDefault();
      const cpm = parseInt(val(f, 'cpm'), 10);
      const row = { gym_id: g.id, name: val(f, 'name'), price_cents: cents(val(f, 'price')), interval: val(f, 'interval'), description: val(f, 'description') || null,
        commitment_months: +val(f, 'commit') || 0, classes_per_month: cpm > 0 ? cpm : null, site_features: lines(val(f, 'features')), site_per: val(f, 'per') || null, site_tag: val(f, 'tag') || null,
        active: val(f, 'active'), show_on_site: val(f, 'show'), featured: val(f, 'featured'), includes_pro: val(f, 'pro'), site_sort: +val(f, 'sort') || 0 };
      if (!row.name) return toast('Name the plan.');
      const id = f.dataset.plan;
      const { error } = id ? await sb.from('plans').update(row).eq('id', id) : await sb.from('plans').insert(row);
      if (error) return toast(error.message); toast(id ? 'Plan saved' : 'Plan added'); again(); });
    $$('[data-svc]').forEach(f => f.onsubmit = async e => { e.preventDefault();
      const row = { gym_id: g.id, name: val(f, 'name'), kind: val(f, 'kind'), price_cents: cents(val(f, 'price')), price_note: val(f, 'price_note') || null, duration_min: Math.min(600, Math.max(5, +val(f, 'dur') || 60)),
        sort: +val(f, 'sort') || 0, description: val(f, 'description') || null, active: val(f, 'active'), require_payment: val(f, 'pay') };
      if (!row.name || row.name.length < 2) return toast('Name the service.');
      const id = f.dataset.svc;
      const { error } = id ? await sb.from('services').update(row).eq('id', id) : await sb.from('services').insert(row);
      if (error) return toast(error.message); toast(id ? 'Service saved' : 'Service added'); again(); });
    $$('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('Delete this service? Past requests keep their history. To pause it instead, untick Offer it on the website.')) return;
      const { error } = await sb.from('services').delete().eq('id', b.dataset.del);
      if (error) return toast(/foreign key|violates/.test(error.message) ? 'This service has bookings, so it cannot be deleted. Untick Offer it on the website to hide it.' : error.message);
      toast('Service deleted'); again(); });
    $('#apptHours').onsubmit = async e => { e.preventDefault();
      const hrs = {}; for (let i = 0; i < 7; i++) { const a = $(`[data-from="${i}"]`).value, z = $(`[data-to="${i}"]`).value; if (a === 'closed') hrs[i] = [0, 0]; else if (a !== '' && z !== '' && +z > +a) hrs[i] = [+a, +z]; }
      const { data: cur } = await sb.from('gym_sites').select('content').eq('gym_id', g.id).maybeSingle();
      const { error } = await sb.from('gym_sites').upsert({ gym_id: g.id, content: { ...((cur && cur.content) || {}), appt_hours: Object.keys(hrs).length ? hrs : null } }, { onConflict: 'gym_id' });
      if (error) return toast(error.message); toast('Hours saved'); };
  };
}
