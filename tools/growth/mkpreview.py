import re, sys
T = open(sys.argv[1]).read().split('\n')
L = lambda a, b: '\n'.join(T[a-1:b])  # 1 based inclusive
css_site = L(135, 206)
js_help = L(249, 261)
draw = L(620, 652)
# adapt drawSite
draw = draw.replace("if (!ready()) { W.innerHTML = '<div class=\"s-wrap\" style=\"padding:60px 20px\">Loading…</div>'; return; }\n", "")
draw = draw.replace("S.plans.filter((p) => p.visible)", "S.plans.filter((p) => p.visible !== false)")
draw = draw.replace("S.events.filter((e) => e.visible && ", "S.events.filter((e) => e.visible !== false && ")
draw = draw.replace("S.services.filter((s) => s.visible)", "S.services.filter((s) => s.visible !== false)")
draw = draw.replace("S.products.filter((p) => p.visible)", "S.products.filter((p) => p.visible !== false)")
draw = draw.replace("SCHEMA.events.order", "byDate").replace("SCHEMA.plans.order", "byOrder").replace("SCHEMA.services.order", "byOrder").replace("SCHEMA.products.order", "byOrder").replace("SCHEMA.coaches.order", "byOrder")
assert 'SCHEMA' not in draw and 'ready()' not in draw, draw[:400]
head = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Your new gym website · Dandy Strength</title>
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;800;900&family=Archivo:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap">
<style>
/* Layout: the Dandy gym template website (12 column grid, 1160px), themed only by the gym's brand block, with a slim Dandy preview bar on top. Data comes from the prospect's preview record. */
:root{
  --f-mono:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;
  --b-bg:#0A1430; --b-fg:#EEF2F8; --b-primary:#2F6BFF; --b-accent:#F7C531; --b-accent-fg:#0A1430; --b-primary-fg:#FFFFFF;
  --s-display:"Big Shoulders Display","Arial Narrow",Arial,sans-serif; --s-body:"Archivo",system-ui,sans-serif;
}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--b-bg);overflow-x:clip}
button,input,textarea,select{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--b-accent);outline-offset:2px;border-radius:4px}
h1,h2,h3{margin:0;line-height:1;text-wrap:balance}
p{margin:0}
.pv{background:#0E1420;color:#E9EEF6;font:500 .9rem/1.4 "Archivo",system-ui,sans-serif;border-bottom:1px solid #26324A}
.pv .in{max-width:1160px;margin:0 auto;padding:10px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.pv img{height:22px;width:auto;display:block}
.pv .t{flex:1;min-width:220px}
.pv .t b{color:#F2C94C}
.pv a{display:inline-flex;align-items:center;min-height:36px;padding:6px 14px;border-radius:999px;border:1px solid #26324A;color:#E9EEF6;text-decoration:none;font-weight:700;font-size:.85rem}
.pv a.go{background:#F2C94C;border-color:#F2C94C;color:#141414}
.state{max-width:1160px;margin:0 auto;padding:80px 20px;color:var(--b-fg);font-family:var(--s-body);display:grid;gap:12px}
.state h1{font:900 2.6rem var(--s-display);text-transform:uppercase}
'''
css_tail = '''
@media (max-width:1100px){.s-hero h1,.s-hero .tx{grid-column:1/-1}.s-today{grid-column:1/-1;grid-row:auto}.s-visit>div{grid-column:span 6}}
@media (max-width:760px){.s-sched .r{grid-template-columns:80px minmax(0,1fr) auto}.s-sched .r span:nth-child(3){display:none}.s-visit>div{grid-column:1/-1}.s-nav{display:none}.mdl .row{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="pv" id="pv" hidden><div class="in"><img src="/assets/mark.svg" alt=""><span class="t" id="pvT"></span><a href="#" id="pvAudit">See your audit</a><a class="go" href="#" id="pvGo">Get this site free</a></div></div>
<div class="site" id="site"><div class="state"><p>Loading your new site…</p></div></div>
<div id="ovl" class="ovl" hidden></div>
<script>
(() => {
  const $ = (s, r = document) => r.querySelector(s);
'''
js_main = '''
  const URL_ = 'https://fairfhgyrosjqualmhwu.supabase.co', KEY = 'sb_publishable_1qg2GRUgxGxVMhOaoGGGFw_lm0j_j4h';
  const byOrder = (a, b) => (a.order || 0) - (b.order || 0), byDate = (a, b) => String(a.date).localeCompare(String(b.date));
  const slugQ = new URLSearchParams(location.search).get('g') || '';
  const S = { config: null, schedule: null, plans: [], services: [], coaches: [], events: [], products: [], registrations: [] };
  const cfg = () => S.config || {};
  const brand = () => Object.assign({ name: 'Your gym', short: 'GYM', tagline: '', bg: '#0A1430', primary: '#2F6BFF', accent: '#F7C531' }, cfg().brand || {});
  function applyBrand() {
    const b = brand(), r = document.documentElement.style;
    r.setProperty('--b-bg', b.bg); r.setProperty('--b-fg', onColor(b.bg) === '#FFFFFF' ? '#EEF2F8' : '#10141C');
    r.setProperty('--b-primary', b.primary); r.setProperty('--b-primary-fg', onColor(b.primary));
    r.setProperty('--b-accent', b.accent); r.setProperty('--b-accent-fg', onColor(b.accent));
  }
  let schedTab = null;
''' + draw.replace('  let schedTab = null;\n', '') + '''

  /* preview modal: every button explains what the live site does, nothing is sent */
  const O = $('#ovl');
  const close = () => { O.hidden = true; O.innerHTML = ''; };
  O.addEventListener('click', (e) => { if (e.target === O || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !O.hidden) close(); });
  const claimUrl = () => '/audit?g=' + encodeURIComponent(slugQ) + '#claim';
  function previewModal(title, what) {
    O.innerHTML = '<div class="mdl" role="dialog" aria-modal="true" aria-labelledby="mT"><h3 id="mT">' + esc(title) + '</h3><p>' + what + '</p><p class="fine">This is a preview built from ' + esc(brand().name) + '\\'s current website, so nothing is sent. On the live site it lands in your Dandy office and on your phone.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><a class="s-btn pri" href="' + claimUrl() + '">Get this site free</a><button class="s-btn" type="button" data-close>Keep looking</button></div></div>';
    O.hidden = false; O.querySelector('a,button').focus();
  }
  $('#site').addEventListener('click', (e) => {
    const t = e.target.closest('button,a'); if (!t) return;
    if (t.dataset.sday != null) { schedTab = +t.dataset.sday; drawSite(); return; }
    if (t.dataset.sbook) { const s = S.services.find((x) => x.id === t.dataset.sbook); previewModal(s ? s.name : 'Book a free class', 'A new member picks a day and a class time, adds their name and mobile, and is booked in under a minute. A coach gets a text and confirms.'); return; }
    if (t.dataset.sevent) { const ev = S.events.find((x) => x.id === t.dataset.sevent); previewModal(ev ? ev.title : 'Register', 'Members register and pay by card in one step. Spots count down live, and reminders go out by text.'); return; }
    if (t.dataset.splan) { const p = S.plans.find((x) => x.id === t.dataset.splan); previewModal('Join' + (p ? ' · ' + p.name : ''), 'New members pick a plan, sign the waiver online and start autopay, with no front desk paperwork.'); return; }
    if (t.dataset.sprod) { previewModal('Order', 'Members order gear and drinks from their phone and pick up at the front desk.'); return; }
    if (t.hasAttribute('data-stext')) { previewModal('Text ' + brand().short, 'Visitors text the gym right from the site. Messages reach a coach\\'s phone, so leads get an answer in minutes.'); return; }
    const h = t.getAttribute('href'); if (h && h.startsWith('#s-')) { e.preventDefault(); const n = document.getElementById(h.slice(1)); if (n) n.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
  });

  const fail = (t, b) => { $('#site').innerHTML = '<div class="state"><h1>' + esc(t) + '</h1><p>' + esc(b) + '</p></div>'; };
  if (!slugQ) { fail('Find your preview', 'Use the link from your email to open your new site.'); return; }
  fetch(URL_ + '/rest/v1/rpc/growth_preview', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_slug: slugQ }) })
    .then((r) => r.ok ? r.json() : null)
    .then((d) => {
      if (!d || !d.site) { fail('This preview is not available', 'It may have been removed.'); return; }
      const site = d.site || {};
      S.config = Object.assign({}, site.config || {}, { brand: Object.assign({}, (site.config || {}).brand || {}, d.brand || {}) });
      S.schedule = site.schedule || { classes: [] };
      ['plans', 'services', 'coaches', 'events', 'products'].forEach((k) => { S[k] = Array.isArray(site[k]) ? site[k] : []; });
      document.title = brand().name + ' · new website preview';
      $('#pvT').innerHTML = '<b>Preview:</b> ' + esc(brand().name) + ' on Dandy, rebuilt from your current site.';
      $('#pvAudit').href = '/audit?g=' + encodeURIComponent(slugQ); $('#pvGo').href = claimUrl(); $('#pv').hidden = false;
      applyBrand(); drawSite();
    })
    .catch(() => fail('That did not load', 'Refresh the page to try again.'));
})();
</script>
</body>
</html>
'''
out = head + css_site + css_tail + js_help + '\n' + js_main
open(sys.argv[2], 'w').write(out)
print(len(out))
