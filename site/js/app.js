import { sb } from './sb.js';
import * as D from './dsi.js';
import { install as installExtra } from './extra.js';
import { install as installGym } from './gym.js';

/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => (v == null || v === '' ? 0 : +v);
const fmt = n => Number(n || 0).toLocaleString('en-US');
const pad = n => String(n).padStart(2, '0');
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => iso(new Date());
const pd = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const fmtD = s => pd(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fmtDW = s => pd(s).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return iso(d); };
const monday = s => { const d = pd(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
const daysAgo = s => Math.round((pd(today()) - pd(s)) / 864e5);
const isNew = s => s && daysAgo(s) <= 6;
const timeAgo = ts => {
  const s = (Date.now() - new Date(ts)) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const main = $('#main');
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3200);
}
function must(res) { if (res.error) throw res.error; return res.data; }

/* ---------- state ---------- */
const S = { session: null, me: null, myGyms: [], blocked: new Set(), board: [], people: new Map(), channels: [], bf: { sort: 'dsi', div: 'all', age: 'all' }, tok: 0 };
const isStaff = () => S.me && ['admin', 'commissioner'].includes(S.me.role);
const isPro = () => !!S.me && (S.me.tier === 'pro' || isStaff());
const PRO = '<span class="pill acc">Pro</span>';

async function loadMe() {
  S.me = null;
  if (!S.session) return;
  const { data } = await sb.from('profiles').select('*').eq('user_id', S.session.user.id).maybeSingle();
  S.me = data || null;
  S.blocked = new Set();
  if (S.me) {
    const [{ data: b }, { data: gs }] = await Promise.all([sb.from('blocks').select('blocked').eq('blocker', S.me.id), sb.from('gym_staff').select('gym_id,role,gym:gyms(id,name)').eq('profile_id', S.me.id)]);
    S.blocked = new Set((b || []).map(x => x.blocked));
    S.myGyms = (gs || []).filter(x => x.gym);
  }
}
async function loadBoard() {
  const [rows, profs] = await Promise.all([sb.from('board').select('*').then(must), sb.from('profiles').select('id,tier,role,gym_id').then(must)]);
  const pmap = new Map(profs.map(p => [p.id, p]));
  S.board = rows.map(r => {
    const pp = pmap.get(r.profile_id) || {};
    const x = { ...r, bw: num(r.bw), age: num(r.age), bench: num(r.bench), squat: num(r.squat), dead: num(r.dead), clean: num(r.clean) };
    x.score = D.score(x); x.total = D.total(x); x.p = D.pcts(x); x.g = D.gains(x); x.pro = pp.tier === 'pro' || ['admin', 'commissioner'].includes(pp.role); x.gym_id = pp.gym_id || null;
    return x;
  });
  return S.board;
}
async function loadPeople() {
  const rows = must(await sb.from('profiles').select('id,display_name,roast_opt_in,role,division'));
  S.people = new Map(rows.map(r => [r.id, r]));
}
const nameOf = id => (S.people.get(id) || {}).display_name || 'Someone';
const boardRow = id => S.board.find(r => r.profile_id === id);

/* mobile menu */
const nav = $('#nav'), menuBtn = $('#menuBtn');
function setMenu(open) {
  nav.classList.toggle('open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
  menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
}
menuBtn.onclick = () => { const open = !nav.classList.contains('open'); setMenu(open); if (open) nav.querySelector('a').focus(); };
nav.addEventListener('click', e => { if (e.target.closest('a')) setMenu(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && nav.classList.contains('open')) { setMenu(false); menuBtn.focus(); } });
document.addEventListener('click', e => { if (nav.classList.contains('open') && !e.target.closest('.bar')) setMenu(false); });
matchMedia('(min-width:861px)').addEventListener('change', e => { if (e.matches) setMenu(false); });

function updateChrome(r) {
  setMenu(false);
  $$('#nav a').forEach(a => { if (a.dataset.r === r) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const acct = $('#acct');
  if (S.me) { acct.textContent = S.me.display_name || 'Finish joining'; acct.href = S.me.display_name ? '/me' : '/join'; acct.classList.add('in'); }
  else { acct.textContent = 'Sign in'; acct.href = '/login'; acct.classList.remove('in'); }
  $('#joinBtn').hidden = !!S.me || r === 'join';
}

/* ---------- router ---------- */
const VIEWS = {};
// Clean URLs: dandystrength.com/prs, /u/<id>, /week/2026-10-02. Same origin links are handled here without a reload.
function go(path, replace) {
  if (path === location.pathname + location.search) { route(); return; }
  history[replace ? 'replaceState' : 'pushState'](null, '', path);
  route();
}
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target || a.hasAttribute('download')) return;
  const href = a.getAttribute('href');
  if (!href.startsWith('/') || href.startsWith('//')) return;
  if (/^\/(assets|js)\//.test(href) || /\.[a-z0-9]+$/i.test(href)) return;
  e.preventDefault();
  go(href);
});
async function route() {
  if (/^#(access_token|error)/.test(location.hash)) return;
  const parts = location.pathname.replace(/^\/+|\/+$/g, '').split('/').map(decodeURIComponent);
  let r = parts[0] || '';
  for (const ch of S.channels) sb.removeChannel(ch);
  S.channels = [];
  if (S.me && !S.me.display_name && !['join', 'login', 'privacy', 'terms', 'support', 'rules'].includes(r)) { go('/join', true); return; }
  if (!VIEWS[r]) r = '';
  document.body.classList.toggle('tvMode', r === 'tv');
  updateChrome(['season', 'battles', 'gyms', 'gym', 'results', 'benchmarks', 'recap', 'plates'].includes(r) ? 'compete' : r === 'pr' ? 'prs' : r === 'lift' ? 'week' : r === 'u' ? '' : r);
  const tok = ++S.tok;
  main.innerHTML = '<p class="empty">Loading…</p>';
  try {
    await VIEWS[r](parts[1], tok);
  } catch (e) {
    console.error(e);
    if (tok === S.tok) main.innerHTML = `<div class="prEmpty"><b>That didn't load</b><p class="err">${esc(e.message || e)}</p><p><a class="btn ghost sm" href="/">Back to the boards</a></p></div>`;
  }
  if (tok === S.tok && document.activeElement === document.body) main.focus({ preventScroll: true });
}
const paint = (tok, html) => { if (tok !== S.tok) return false; main.innerHTML = html; window.scrollTo(0, 0); return true; };
function needLogin(tok, what) {
  return paint(tok, `<section class="prEmpty"><b>Sign in to ${esc(what)}</b><p>Members log lifts, chat and file protests. Boards and PRs stay public.</p><p><a class="btn" href="/login">Sign in</a> <a class="btn ghost" href="/join">Join free</a></p></section>`);
}

/* ---------- shared actions ---------- */
async function openThread(kind, ref, title) {
  if (!S.me) { go('/login'); return; }
  const { data, error } = await sb.rpc('room_for', { p_kind: kind, p_ref: ref, p_title: title });
  if (error) { toast(error.message); return; }
  go('/chat/' + data);
}
function protestForm(host, type, id, label, done) {
  if (!S.me) { go('/login'); return; }
  if (host.querySelector('.inlineForm')) { host.querySelector('.inlineForm').remove(); return; }
  const f = document.createElement('form');
  f.className = 'inlineForm';
  f.innerHTML = `<label class="eyebrow" for="pr-${id}">Protest: ${esc(label)}</label>
    <textarea id="pr-${id}" maxlength="500" required minlength="3" placeholder="What's wrong with it? Depth, no video, typo, pure jealousy…"></textarea>
    <div class="row"><button class="btn sm" type="submit">File protest</button><button class="btn ghost sm" type="button" data-x>Cancel</button><span class="hint">JB31, the Commissioner, rules on every protest.</span></div>`;
  host.appendChild(f);
  f.querySelector('textarea').focus();
  f.querySelector('[data-x]').onclick = () => f.remove();
  f.onsubmit = async e => {
    e.preventDefault();
    const btn = f.querySelector('button'); btn.disabled = true;
    const { error } = await sb.from('protests').insert({ target_type: type, target_id: id, filed_by: S.me.id, reason: f.querySelector('textarea').value.trim() });
    if (error) { toast(error.message); btn.disabled = false; return; }
    f.remove(); toast('Protest filed. The Commissioner has been summoned.');
    done && done();
  };
}
function bindActions(root, reload) {
  $$('[data-thread]', root).forEach(b => b.onclick = () => openThread(b.dataset.thread, b.dataset.ref, b.dataset.title));
  $$('[data-protest]', root).forEach(b => b.onclick = () => protestForm(b.closest('[data-host]') || b.parentElement, b.dataset.protest, b.dataset.ref, b.dataset.title, reload));
}

/* ---------- home: boards ---------- */
VIEWS[''] = async (_, tok) => {
  const [board, prs] = await Promise.all([loadBoard(), sb.from('pr_feed').select('*').gte('performed_on', monday(today())).order('created_at', { ascending: false }).limit(60)]);
  const weekPRs = must(prs);
  const top = [...board].sort((a, b) => b.score - a.score)[0];
  const heavy = [...board].sort((a, b) => b.total - a.total)[0];
  const html = `
  <section class="hero">
    <div>
      <img class="logo" src="/assets/logo.svg" alt="Dandy Strength Index" width="760" height="240">
      <h1 class="vh">Dandy Strength Index™</h1>
      <p class="tag">Your bench, squat, deadlift and clean scored against lifters your age and bodyweight. 500 is the median. Every PR moves the board.</p>
      <div class="cta">${S.me ? '<a class="btn" href="/log">Log a lift</a><a class="btn ghost" href="/week">This week</a>' : '<a class="btn" href="/join">Join the index</a><a class="btn ghost" href="/week">This week</a>'}</div>
    </div>
    <div class="kpi" aria-label="Index stats">
      <div><b>${board.length}</b><span>Lifters</span></div>
      <div><b>${weekPRs.length}</b><span>PRs this week</span></div>
      <div><b>${top ? top.score : '0'}</b><span>Top DSI™</span></div>
      <div><b>${heavy ? fmt(heavy.total) : 0}</b><span>Top total</span></div>
    </div>
  </section>
  ${S.me ? '' : `<section class="sec band" aria-labelledby="how">
    <div class="secHead"><div><div class="kicker">How it works</div><h2 id="how">Three steps to the <span>board</span></h2></div></div>
    <div class="steps">
      <div class="step"><b>Log your lifts</b><p>Bench, squat, deadlift and clean. One heavy single each, with the date you hit it.</p></div>
      <div class="step"><b>Get your DSI™</b><p>Each lift is scored against lifters your age and bodyweight. 500 is the median.</p></div>
      <div class="step"><b>Climb the board</b><p>Every PR moves you up. Follow the daily workout, chase goals, protest the fishy ones.</p></div>
    </div>
  </section>`}
  <section class="sec" aria-labelledby="wkprs">
    <div class="secHead"><div><div class="kicker">This week</div><h2 id="wkprs">Fresh <span>PRs</span></h2><p class="secSub">Every new personal record since Monday.</p></div><a class="btn ghost sm" href="/prs">Full PR wall</a></div>
    ${weekPRs.length ? `<div class="prGrid">${weekPRs.slice(0, 8).map(prCard).join('')}</div>` : `<div class="prEmpty"><b>No PRs yet this week</b><p>Somebody has to go first. <a href="/log">Log a lift</a>.</p></div>`}
  </section>
  <section class="sec band" aria-labelledby="kings">
    <div class="secHead"><div><div class="kicker">Heaviest on the board</div><h2 id="kings">Lift <span>kings</span></h2><p class="secSub">Tap a lift to sort the leaderboard by it${isPro() ? '' : ' with DSI Pro'}.</p></div></div>
    <div class="kings">${D.LIFTS.map(l => { const k = [...board].sort((a, b) => b[l.k] - a[l.k])[0]; return k && k[l.k] ? `<button class="king${S.bf.sort === l.k ? ' on' : ''}" style="--c:${l.c}" data-sort="${l.k}"><span class="eyebrow">${l.n}</span><b>${esc(k.name)}</b><span class="kv">${fmt(k[l.k])} lb</span>${isNew(k[l.k + '_date']) ? `<span class="prDateNew">PR ${fmtD(k[l.k + '_date'])}</span>` : ''}</button>` : ''; }).join('')}</div>
  </section>
  <section class="sec" aria-labelledby="lbh">
    <div class="secHead"><div><div class="kicker">The standings</div><h2>Leader<span>board</span></h2><p class="secSub">Filter by division and age, or sort by any lift.</p></div></div>
    <div class="board" id="lb"></div>
  </section>
  ${S.me ? '' : `<section class="sec band cta2"><div class="secHead"><div><div class="kicker">Free to join</div><h2>Where do <span>you</span> rank?</h2><p class="secSub">Enter your four lifts, see your DSI™, and save your spot on the board in under a minute.</p></div><a class="btn" href="/join">Join the index</a></div></section>`}`;
  if (!paint(tok, html)) return;
  $$('.king').forEach(b => b.onclick = () => { if (!isPro()) return go('/pro'); S.bf.sort = b.dataset.sort; renderBoard(); $('#lb').scrollIntoView({ behavior: 'smooth' }); $$('.king').forEach(k => k.classList.toggle('on', k.dataset.sort === S.bf.sort)); });
  bindActions(main);
  renderBoard();
};

function prCard(p) {
  const l = D.LIFT_BY_DB[p.lift] || { c: 'var(--muted)', n: D.liftName(p.lift) };
  const hot = isNew(p.performed_on), gain = p.prev_best ? num(p.weight_lb) - num(p.prev_best) : 0;
  const mine = S.me && S.me.id === p.profile_id;
  return `<article class="prCard${hot ? ' hot' : ''}${p.status === 'protested' ? ' protested' : ''}" style="--c:${l.c}" data-host>
    <div class="prTop"><span class="prTag">${hot ? 'New PR' : 'PR'}</span><span class="prDate">${fmtD(p.performed_on)}</span></div>
    <a class="prName" href="/u/${p.profile_id}">${esc(p.name)}</a>
    <div class="prLift">${esc(l.n)} <b>${fmt(p.weight_lb)} lb</b>${p.status === 'protested' ? '<span class="pill flat">Under protest</span>' : ''}</div>
    ${gain ? `<div class="prGain">+${fmt(gain)} lb</div><div class="sub">was ${fmt(p.prev_best)}</div>` : ''}
    <div class="prAct"><a class="btn ghost sm" href="/pr/${p.id}">Open</a><button class="btn ghost sm" data-thread="pr" data-ref="${p.id}" data-title="${esc(p.name + ' ' + l.n + ' ' + num(p.weight_lb))}">Talk</button>${!mine && p.status === 'ok' ? `<button class="btn ghost sm" data-protest="lift_entry" data-ref="${p.id}" data-title="${esc(p.name + ' ' + l.n + ' ' + num(p.weight_lb) + ' lb')}">Protest</button>` : ''}</div>
  </article>`;
}

function renderBoard() {
  const el = $('#lb'); if (!el) return;
  const f = S.bf, pro = isPro();
  if (!pro) { f.sort = 'dsi'; f.age = 'all'; }
  const SORTS = [['dsi', 'Overall'], ['total', 'Total'], ...D.LIFTS.map(l => [l.k, l.n])];
  let rows = S.board.filter(r => f.div === 'all' || r.division === f.div)
    .filter(r => f.age === 'all' || (f.age === 'u40' ? r.age && r.age < 40 : f.age === '40s' ? r.age >= 40 && r.age < 50 : r.age >= 50));
  const key = f.sort === 'dsi' ? 'score' : f.sort;
  rows = rows.filter(r => r[key]).sort((a, b) => b[key] - a[key] || b.score - a.score);
  const title = SORTS.find(s => s[0] === f.sort)[1];
  const divName = { all: '', men: "Men's ", women: "Women's ", open: 'Open ' }[f.div];
  const chip = (grp, v, t) => `<button class="chip" data-${grp}="${v}" aria-pressed="${f[grp] === v}">${t}${grp === 'age' && v !== 'all' && !pro ? ' ' + PRO : ''}</button>`;
  el.innerHTML = `<div class="boardHead">
      <div class="bhTop"><h3 id="lbh">${esc(divName)}${esc(title)} <span>board</span></h3><p>${rows.length} ranked · 500 is the median for your age and size</p></div>
      <div class="tabs" role="tablist">${SORTS.map(s => `<button class="tab" role="tab" data-sort="${s[0]}" aria-selected="${f.sort === s[0]}">${s[1]}${s[0] !== 'dsi' && !pro ? ' ' + PRO : ''}</button>`).join('')}</div>
      <div class="row"><div class="chips" aria-label="Division">${chip('div', 'all', 'All')}${chip('div', 'men', 'Men')}${chip('div', 'women', 'Women')}${chip('div', 'open', 'Open')}</div>
      <div class="chips" aria-label="Age">${chip('age', 'all', 'All ages')}${chip('age', 'u40', 'Under 40')}${chip('age', '40s', '40s')}${chip('age', '50p', '50+')}</div></div>
    </div>
    ${rows.length ? `<div class="tablewrap"><table class="lb"><thead><tr><th>#</th><th>Lifter</th><th class="r${f.sort === 'dsi' ? ' hl' : ''}">DSI™</th><th class="r${f.sort === 'total' ? ' hl' : ''}">Total</th>${D.LIFTS.map(l => `<th class="r c-${l.k}">${l.n}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((r, i) => {
      const club = D.clubOf(r.total), up = v => v > 0 ? `<span class="upArrow" title="Up ${fmt(v)} this week">▲${fmt(v)}</span>` : '';
      return `<tr class="${S.me && S.me.id === r.profile_id ? 'me' : ''}"><td class="pos">${i + 1}</td>
      <td><div class="who"><a href="/u/${r.profile_id}">${esc(r.name)}</a>${r.pro ? '<span class="pill acc proTag" title="DSI Pro">Pro</span>' : ''}${r.roast_opt_in ? '<i class="fire" title="Opted in to roasts">🔥</i>' : ''}${r.has_protest ? '<span class="pill flat">Protest</span>' : ''}</div><div class="sub">${r.age ? 'Age ' + r.age + ' · ' : ''}${r.bw ? r.bw + ' lb · ' : ''}${esc(r.division)}</div></td>
      <td class="r n big">${r.score}${up(r.g.score)}</td><td class="r n">${fmt(r.total)}${up(r.g.total)}${club ? `<span class="club">${fmt(club)}</span>` : ''}</td>
      ${D.LIFTS.map(l => r[l.k] ? `<td class="r n">${fmt(r[l.k])}${up(r.g.lift[l.k])}<div class="sub">${isNew(r[l.k + '_date']) ? `<span class="prDateNew">PR ${fmtD(r[l.k + '_date'])}</span>` : D.fmtPct(r.p[l.k]) + ' pct'}</div></td>` : '<td class="r sub">n/a</td>').join('')}
      </tr>`;
    }).join('')}</tbody></table></div>`
      : `<div class="empty">${f.div === 'women' ? 'No women on the board yet. The women\'s division is open, bring your crew.' : 'Nobody matches this filter yet.'}</div>`}`;
  $$('[data-sort]', el).forEach(b => b.onclick = () => { if (!pro && b.dataset.sort !== 'dsi') return go('/pro'); f.sort = b.dataset.sort; renderBoard(); $$('.king').forEach(k => k.classList.toggle('on', k.dataset.sort === f.sort)); });
  $$('[data-div]', el).forEach(b => b.onclick = () => { f.div = b.dataset.div; renderBoard(); });
  $$('[data-age]', el).forEach(b => b.onclick = () => { if (!pro && b.dataset.age !== 'all') return go('/pro'); f.age = b.dataset.age; renderBoard(); });
}

/* ---------- PR wall ---------- */
VIEWS.prs = async (day, tok) => {
  // The wall resets every Monday. Newest PR on top as it comes in. /prs/<date> shows that past week.
  const cur = monday(today()), wk = /^\d{4}-\d{2}-\d{2}$/.test(day || '') ? monday(day) : cur, end = addDays(wk, 7), live = wk === cur;
  const [feed, prev] = await Promise.all([
    sb.from('pr_feed').select('*').gte('performed_on', wk).lt('performed_on', end).order('created_at', { ascending: false }).limit(300).then(must),
    sb.from('pr_feed').select('id', { count: 'exact', head: true }).lt('performed_on', wk),
  ]);
  const hasOlder = (prev.count || 0) > 0;
  if (!paint(tok, `<section class="sec"><div class="secHead"><div><div class="kicker">${live ? 'Resets every Monday' : 'Past week'}</div><h2>PR <span>wall</span></h2>
      <p class="secSub">${live ? `Week of ${fmtD(wk)}. Newest PRs land on top the moment they're logged.` : `Week of ${fmtD(wk)} to ${fmtD(addDays(wk, 6))}.`}</p></div>
      <div class="row">${hasOlder ? `<a class="btn ghost sm" href="/prs/${addDays(wk, -7)}">← Last week</a>` : ''}${live ? '' : `<a class="btn ghost sm" href="/prs">This week</a>`}${S.me && live ? '<a class="btn sm" href="/log">Log a lift</a>' : ''}</div></div>
      <p class="lede">A PR counts when it beats your old best. Think one is fishy? Protest it and the Commissioner rules.</p></section>
    <section class="sec">${feed.length ? `<div class="prGrid" id="prGrid">${feed.map(prCard).join('')}</div>` : `<div class="prEmpty" id="prGrid"><b>${live ? 'Fresh week, empty wall' : 'No PRs that week'}</b><p>${live ? 'First PR of the week gets the top spot.' : ''}</p></div>`}</section>`)) return;
  bindActions(main, () => route());
  if (live) {
    const ch = sb.channel('prwall').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lift_entries' }, p => {
      if (p.new.is_pr && p.new.prev_best && p.new.performed_on >= wk) { toast('New PR just landed'); route(); }
    }).subscribe();
    S.channels.push(ch);
  }
};

/* ---------- lifter page ---------- */
VIEWS.u = async (id, tok) => {
  if (!id) { go('/'); return; }
  const [board, prof, hist, goals] = await Promise.all([
    loadBoard(),
    sb.from('profiles').select('id,display_name,division,sex,birth_year,bodyweight,roast_opt_in,role,tier').eq('id', id).maybeSingle(),
    sb.from('lift_entries').select('*').eq('profile_id', id).order('performed_on', { ascending: false }).order('created_at', { ascending: false }).limit(100),
    sb.from('goals').select('*').eq('profile_id', id),
  ]);
  const p = must(prof); if (!p) throw new Error('No lifter here.');
  const r = board.find(x => x.profile_id === id) || { name: p.display_name, bw: num(p.bodyweight), age: p.birth_year ? new Date().getFullYear() - p.birth_year : 0, bench: 0, squat: 0, dead: 0, clean: 0 };
  if (!r.p) { r.score = D.score(r); r.total = D.total(r); r.p = D.pcts(r); }
  const v = D.verdict(r.score), gl = Object.fromEntries(must(goals).map(g => [g.lift, num(g.target_lb)]));
  const bestOf = {};
  must(hist).filter(e => e.status !== 'struck').forEach(e => { bestOf[e.lift] = Math.max(bestOf[e.lift] || 0, num(e.weight_lb)); });
  const otherBests = Object.entries(bestOf).filter(([id]) => !D.LIFT_BY_DB[id]).map(([lift, w]) => ({ lift, weight_lb: w, performed_on: must(hist).find(e => e.lift === lift && num(e.weight_lb) === w).performed_on }));
  const mine = S.me && S.me.id === id, club = D.clubOf(r.total);
  const role = p.role === 'commissioner' ? '<span class="pill acc">Commissioner</span>' : p.role === 'admin' ? '<span class="pill acc">Founder</span>' : p.tier === 'pro' ? '<span class="pill acc">DSI Pro</span>' : '';
  if (!paint(tok, `<article class="card">
    <div class="cardHead"><div><div class="eyebrow">${esc(p.division)} division</div><div class="nm">${esc(p.display_name)}${p.roast_opt_in ? ' <span title="Opted in to roasts">🔥</span>' : ''}</div>
      <div class="meta">${r.age ? 'Age ' + r.age + ' · ' : ''}${r.bw ? r.bw + ' lb · ' : ''}${fmt(r.total)} lb total${club ? ' · ' + fmt(club) + ' club' : ''} ${role}</div></div>
      <div class="dsi"><div class="eyebrow">DSI™</div><b>${r.score}</b>${S.me && !mine ? `<div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn ghost sm" id="rpU">Report</button><button class="btn ghost sm" id="blU">${S.blocked.has(id) ? 'Unblock' : 'Block'}</button></div>` : ''}</div></div>
    ${S.blocked.has(id) ? '<div class="verdict"><p class="sub">You blocked this lifter. Their messages are hidden from you.</p></div>' : ''}
    <div class="verdict"><b>${esc(v[1])}</b><p>${esc(p.roast_opt_in ? v[2] : v[3])}</p></div>
    <div class="bars">${D.LIFTS.map(l => `<div class="brow" style="--c:${l.c}"><span class="ln">${l.n}</span><div class="pb" title="${D.fmtPct(r.p[l.k])} percentile"><i style="width:${r.p[l.k]}%"></i><s></s></div><span class="w">${r[l.k] ? fmt(r[l.k]) + ' lb' : 'n/a'}</span><span class="pc">${D.fmtPct(r.p[l.k])}%</span></div>`).join('')}
      <p class="hint">The line is the median for ${r.age ? 'age ' + r.age : 'your age'} at ${r.bw || 185} lb. Percent is where you rank.</p></div>
  </article>
  ${Object.keys(gl).length ? `<section class="sec"><h2>Goals</h2><div class="goalRows">${Object.keys(gl).map(id => { const now = bestOf[id] || 0, g = gl[id], pctg = Math.min(100, Math.round(now / g * 100)); return `<div class="g" style="--c:${D.liftColor(id)}"><h4>${esc(D.liftName(id))}</h4><div class="big">${fmt(g)} lb</div><div class="pb"><i style="width:${pctg}%"></i></div><div class="now">${now ? fmt(now) + ' now · ' + (g > now ? fmt(g - now) + ' to go' : 'done') : 'no lift yet'}</div></div>`; }).join('')}</div></section>` : ''}
  ${otherBests.length ? `<section class="sec"><h2>Other <span>lifts</span></h2><div class="goalRows">${otherBests.map(b => `<div class="g" style="--c:var(--muted)"><h4>${esc(D.liftName(b.lift))}</h4><div class="big">${fmt(b.weight_lb)} lb</div><div class="now">${fmtD(b.performed_on)}</div></div>`).join('')}</div></section>` : ''}
  <section class="sec"><h2>Lift <span>history</span></h2><div class="board"><div class="tablewrap"><table><thead><tr><th>Date</th><th>Lift</th><th class="r">Weight</th><th>Status</th><th></th></tr></thead><tbody>
  ${(isPro() ? must(hist) : must(hist).slice(0, 3)).map(e => `<tr class="${e.status === 'struck' ? 'struck' : ''}"><td class="n">${fmtD(e.performed_on)}</td><td>${esc(D.liftName(e.lift))}${e.note ? `<div class="sub">${esc(e.note)}</div>` : ''}</td><td class="r n big">${fmt(e.weight_lb)}${e.video_path ? ` <button class="vidBtn" data-vid="${esc(e.video_path)}" aria-label="Play video">▶</button>` : ''}</td>
    <td>${e.is_pr ? '<span class="pill acc">PR</span>' : ''}${e.status === 'protested' ? '<span class="pill flat">Under protest</span>' : e.status === 'struck' ? '<span class="pill down">Struck</span>' : ''}${e.source === 'workout' ? '<span class="sub"> from workout</span>' : ''}</td>
    <td class="r" data-host>${!mine && e.status === 'ok' && S.me ? `<button class="btn ghost sm" data-protest="lift_entry" data-ref="${e.id}" data-title="${esc(p.display_name + ' ' + D.liftName(e.lift) + ' ' + num(e.weight_lb) + ' lb')}">Protest</button>` : ''}${mine && e.status === 'ok' && !e.video_path && (e.is_pr || isPro()) ? `<button class="btn ghost sm" data-addvid="${e.id}">Add video</button> ` : ''}${mine && e.status === 'ok' ? `<button class="btn ghost sm" data-del="${e.id}">Delete</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No lifts yet.</td></tr>'}
  </tbody></table></div></div>${!isPro() && must(hist).length > 3 ? `<p class="hint">Showing the latest 3 of ${must(hist).length}. <a href="/pro">See every lift with DSI Pro</a></p>` : ''}</section>`)) return;
  bindActions(main, () => route());
  bindVideo(main, () => route());
  if ($('#rpU')) $('#rpU').onclick = () => reportDialog({ type: 'profile', id, name: p.display_name, uid: id });
  if ($('#blU')) $('#blU').onclick = async () => {
    const was = S.blocked.has(id);
    const { error } = was ? await sb.from('blocks').delete().eq('blocker', S.me.id).eq('blocked', id) : await sb.from('blocks').insert({ blocker: S.me.id, blocked: id });
    if (error) return toast(error.message);
    await loadMe(); toast(was ? 'Unblocked' : `Blocked. You will not see messages from ${p.display_name}.`); route();
  };
  $$('[data-del]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    const { error } = await sb.from('lift_entries').delete().eq('id', b.dataset.del);
    if (error) { toast(error.message); b.disabled = false; return; }
    toast('Deleted'); route();
  });
};

/* ---------- log a lift ---------- */
VIEWS.log = async (_, tok) => {
  if (!S.me) return needLogin(tok, 'log lifts');
  await loadBoard();
  const r = boardRow(S.me.id) || {};
  const opts = [...D.LIFTS.map(l => [l.db, D.liftName(l.db) + (r[l.k] ? ` (best ${fmt(r[l.k])})` : '')]), ...Object.entries(D.OTHER_LIFTS)];
  if (!paint(tok, `<section class="sec"><div><div class="kicker">New max</div><h2>Log a <span>lift</span></h2></div>
    <p class="lede">Log a heavy single. Beat your old best and it lands on the PR wall with today's date.${isPro() ? '' : ' Free covers the four DSI lifts. <a href="/pro">DSI Pro</a> adds every other lift.'}</p>
    <form class="formCard" id="logF">
      <div class="fields">
        <div class="field w2"><label for="lf-lift">Lift</label><select id="lf-lift" required>${opts.map((o, i) => `<option value="${o[0]}"${i >= D.LIFTS.length && !isPro() ? ' disabled' : ''}>${esc(o[1])}${i >= D.LIFTS.length && !isPro() ? ' (Pro)' : ''}</option>`).join('')}</select></div>
        <div class="field"><label for="lf-w">Weight (lb)</label><input id="lf-w" type="number" inputmode="decimal" min="1" max="1499" step="0.5" required></div>
        <div class="field"><label for="lf-d">Date</label><input id="lf-d" type="date" value="${today()}" max="${today()}" required></div>
        <div class="field w4"><label for="lf-n">Note (optional)</label><input id="lf-n" type="text" maxlength="280" placeholder="Belt, no belt, witnesses, video link…"></div>
      </div>
      <div class="row"><button class="btn" type="submit">Log it</button><span class="hint" id="lf-msg"></span></div>
      <div class="row" id="lf-vid" hidden></div>
    </form></section>`)) return;
  const f = $('#logF');
  f.onsubmit = async e => {
    e.preventDefault();
    const b = f.querySelector('button'), msg = $('#lf-msg'); b.disabled = true; msg.textContent = 'Saving…';
    const { data, error } = await sb.from('lift_entries').insert({ profile_id: S.me.id, lift: $('#lf-lift').value, weight_lb: +$('#lf-w').value, performed_on: $('#lf-d').value, note: $('#lf-n').value.trim() || null, source: 'manual' }).select().single();
    b.disabled = false;
    if (error) { msg.textContent = error.message; return; }
    const name = D.liftName(data.lift);
    if (data.is_pr && data.prev_best) { go('/pr/' + data.id + '?celebrate=1'); return; }
    if (data.is_pr) {
      msg.innerHTML = `<b style="color:var(--accent)">New ${esc(name)} PR: ${data.prev_best ? fmt(data.prev_best) + ' → ' : ''}${fmt(data.weight_lb)} lb.</b> It's on the <a href="/prs">PR wall</a>.`;
      toast(`New ${name} PR!`);
    } else msg.textContent = `Logged ${fmt(data.weight_lb)} lb. Your best is still ${fmt(data.prev_best)}.`;
    $('#lf-w').value = ''; $('#lf-n').value = '';
    const vb = $('#lf-vid'); vb.hidden = false;
    vb.innerHTML = data.is_pr || isPro()
      ? `<button class="btn ghost sm" type="button" data-addvid="${data.id}">Add a video of this lift</button><span class="hint">${data.is_pr ? 'Proof for your PR. Free on every PR.' : 'Video on any set is a Pro feature.'}</span>`
      : `<a class="chip" href="/pro">Add video to any set ${PRO}</a>`;
    bindVideo(vb, () => { vb.innerHTML = '<span class="hint">Video attached. It plays from your lifter card.</span>'; });
  };
};

/* ---------- week ---------- */
VIEWS.week = async (day, tok) => {
  const sel = /^\d{4}-\d{2}-\d{2}$/.test(day || '') ? day : today();
  const start = monday(sel), end = addDays(start, 6);
  const myGym = S.me && S.me.gym_id;
  let wq = sb.from('workouts').select('*').gte('day', start).lte('day', end).order('day');
  wq = myGym ? wq.or(`gym_id.is.null,gym_id.eq.${myGym}`) : wq.is('gym_id', null);
  const [board, wres, gres] = await Promise.all([loadBoard(), wq, myGym ? sb.from('gyms').select('id,name').eq('id', myGym).maybeSingle() : Promise.resolve({ data: null })]);
  const allW = must(wres), gym = gres.data;
  const hasGym = !!(myGym && allW.some(x => x.gym_id === myGym));
  const src = !hasGym || new URLSearchParams(location.search).get('src') === 'dsi' ? 'dsi' : 'gym';
  const qs = src === 'dsi' && hasGym ? '?src=dsi' : '';
  const wks = allW.filter(x => src === 'gym' ? x.gym_id === myGym : !x.gym_id);
  const ids = wks.map(w => w.id);
  const logs = ids.length ? must(await sb.from('workout_logs').select('*').in('workout_id', ids)) : [];
  if (!S.people.size) await loadPeople();
  const w = wks.find(x => x.day === sel);
  const meRow = S.me ? (boardRow(S.me.id) || { bw: num(S.me.bodyweight), bench: 0, squat: 0, dead: 0, clean: 0 }) : null;
  const myLog = S.me && w ? logs.find(l => l.workout_id === w.id && l.profile_id === S.me.id) : null;
  const tdy = today();
  const days = [...Array(7)].map((_, i) => addDays(start, i));
  const dayBtns = days.map(d => {
    const has = wks.find(x => x.day === d), logged = S.me && has && logs.some(l => l.workout_id === has.id && l.profile_id === S.me.id);
    return `<a class="wd${d === sel ? ' on' : ''}${d === tdy ? ' today' : ''}" href="/week/${d}${qs}" ${d === sel ? 'aria-current="date"' : ''}><span>${pd(d).toLocaleDateString('en-US', { weekday: 'short' })}</span><b>${pd(d).getDate()}</b>${logged ? '<i title="Logged">✓</i>' : ''}</a>`;
  }).join('');
  let body = '';
  if (!w) body = `<div class="prEmpty"><b>No programming for ${esc(fmtDW(sel))}</b><p>${wks.length ? 'Pick another day above.' : 'This week has not been posted yet.'}</p></div>`;
  else {
    const prog = `<div class="wkProg"><div class="eyebrow">${esc(fmtDW(w.day))}${w.day === tdy ? ' · Today' : ''}${w.source ? ' · ' + esc(w.source) : ''}</div><h3>${esc(w.title)}</h3>
      ${w.rest_note ? `<p class="rest">${esc(w.rest_note)}</p>` : ''}
      ${(w.sections || []).map(s => `<div class="wkSec"><b>${esc(s.name)}</b><p>${esc(s.text)}</p></div>`).join('')}
      <div class="row"><button class="btn ghost sm" data-thread="workout" data-ref="${w.id}" data-title="${esc(fmtD(w.day) + ' · ' + w.title)}">Day thread</button>${w.benchmark ? `<a class="chip" href="/benchmarks/${encodeURIComponent(w.benchmark)}">Benchmark: ${esc(w.benchmark)}</a>` : ''}${w.gym_id && S.myGyms.some(g => g.gym_id === w.gym_id) ? `<a class="btn sm" href="/results/${w.gym_id}?day=${w.day}">Enter results</a><a class="btn ghost sm" href="/tv/${w.gym_id}">Big screen</a>` : ''}</div>
      ${isStaff() ? `<form class="row" id="bmF"><label class="vh" for="bm-n">Benchmark name</label><input id="bm-n" maxlength="40" value="${esc(w.benchmark || '')}" placeholder="Name it as a benchmark, like Fran" style="max-width:260px"><button class="btn ghost sm">Save</button></form>` : ''}</div>`;
    let mine = '';
    if (!(w.lifts || []).length && !w.score_label) mine = `<div class="wkMine"><h3>Rest <span>day</span></h3><p class="hint">Nothing to log. Recover like it's your job.</p></div>`;
    else if (!S.me) mine = `<div class="wkMine"><h3>Your <span>numbers</span></h3><p class="hint">Sign in and every weight here is built from your own PRs. Then log what you actually did.</p><a class="btn" href="/login">Sign in</a></div>`;
    else if (!isPro()) mine = `<div class="wkMine"><h3>Your <span>numbers</span> ${PRO}</h3>
        <div class="tablewrap"><table class="wkT"><thead><tr><th>Lift</th><th>Scheme</th></tr></thead><tbody>${(w.lifts || []).map(l => `<tr><td><b>${esc(l.n)}</b><div class="sub">${esc(l.why)}</div></td><td class="n">${esc(l.sch)}</td></tr>`).join('')}</tbody></table></div>
        <p class="hint">DSI Pro turns every lift here into a target weight built from your own PRs, then lets you log what you did and rank on the day board.</p><a class="btn" href="/pro">See DSI Pro</a></div>`;
    else {
      const ent = (myLog && myLog.entries) || {};
      mine = `<form class="wkMine" id="wkF"><h3>${esc(S.me.display_name)}'s <span>numbers</span></h3>
        <div class="tablewrap"><table class="wkT"><thead><tr><th>Lift</th><th>Scheme</th><th class="r">Target</th><th class="r">Actual</th></tr></thead><tbody>
        ${(w.lifts || []).map(l => { const t = D.target(l, meRow); return `<tr><td><b>${esc(l.n)}</b><div class="sub">${esc(l.why)}</div></td><td class="n">${esc(l.sch)}</td><td class="r tgt">${t ? t + ' lb' : 'n/a'}</td><td class="r"><input class="wkIn" type="number" inputmode="numeric" step="any" min="0" max="1499" data-id="${esc(l.id)}" value="${esc(ent[l.id] ?? '')}" placeholder="${t || 'lb'}" aria-label="${esc(l.n)} actual weight"><a class="setsLink" href="/lift/${w.id}/${encodeURIComponent(l.id)}">Sets${(myLog && myLog.sets && myLog.sets[l.id] && myLog.sets[l.id].length) ? ' · ' + myLog.sets[l.id].length : ''}</a></td></tr>`; }).join('')}
        ${w.score_label ? `<tr><td><b>${esc(w.score_label)}</b><div class="sub">${w.score_type === 'time' ? 'mm:ss' : 'Your score'}</div></td><td></td><td></td><td class="r"><input class="wkIn wkScore" type="text" maxlength="40" id="wkScore" value="${esc(myLog?.score || '')}" placeholder="${w.score_type === 'time' ? '12:34' : 'score'}" aria-label="${esc(w.score_label)}"></td></tr>` : ''}
        </tbody></table></div>
        <div class="row"><button class="btn" type="submit">${myLog ? 'Update log' : 'Log it'}</button><span class="hint" id="wkMsg">${myLog ? 'Logged. Update any time.' : 'Hit the targets, then log what you actually did.'}</span></div></form>`;
    }
    body = `<div class="wkBody">${prog}${mine}</div>${dayBoard(w, logs.filter(l => l.workout_id === w.id))}`;
  }
  if (!paint(tok, `<section class="sec"><div class="wkNav"><div><div class="kicker">Week of ${esc(fmtD(start))}</div><h2>The <span>week</span></h2></div>
    <div class="row"><a class="btn ghost sm" href="/week/${addDays(start, -7)}${qs}">← Last week</a>${start !== monday(tdy) ? `<a class="btn ghost sm" href="/week/${tdy}${qs}">Today</a>` : ''}<a class="btn ghost sm" href="/week/${addDays(start, 7)}${qs}">Next week →</a>${isStaff() || S.myGyms.length ? '<a class="btn sm" href="/program">Post workouts</a>' : ''}</div></div>
    ${hasGym ? `<div class="tabs" role="tablist" aria-label="Programming"><a class="tab" role="tab" href="/week/${sel}" aria-selected="${src === 'gym'}">${esc(gym ? gym.name : 'My gym')}</a><a class="tab" role="tab" href="/week/${sel}?src=dsi" aria-selected="${src === 'dsi'}">DSI week</a></div>` : ''}
    <nav class="wkDays" aria-label="Days">${dayBtns}</nav></section>
    <section class="sec">${body}</section>`)) return;
  bindActions(main, () => route());
  const bm = $('#bmF');
  if (bm) bm.onsubmit = async e => {
    e.preventDefault();
    const v = $('#bm-n').value.trim();
    const { error } = await sb.from('workouts').update({ benchmark: v || null }).eq('id', w.id);
    if (error) return toast(error.message);
    toast(v ? 'Saved as the ' + v + ' benchmark' : 'Benchmark removed'); route();
  };
  const f = $('#wkF');
  if (f) f.onsubmit = async e => {
    e.preventDefault();
    const entries = {};
    $$('.wkIn[data-id]', f).forEach(i => { const v = i.value.trim(); if (v) entries[i.dataset.id] = Math.max(0, Math.min(1499, Math.round(+v * 2) / 2 || 0)); });
    const score = $('#wkScore') ? $('#wkScore').value.trim().slice(0, 40) : '';
    const msg = $('#wkMsg'), b = f.querySelector('button');
    if (!Object.keys(entries).length && !score) { msg.textContent = 'Enter at least one number.'; return; }
    b.disabled = true; msg.textContent = 'Saving…';
    const { error } = await sb.from('workout_logs').upsert({ workout_id: w.id, profile_id: S.me.id, entries, score: score || null }, { onConflict: 'workout_id,profile_id' });
    if (error) { b.disabled = false; msg.textContent = error.message; return; }
    let prMsg = '';
    if (w.pr_lift) {
      const maxItem = (w.lifts || []).find(l => l.max && entries[l.id]);
      const L = D.LIFT_BY_DB[w.pr_lift], best = L && meRow ? meRow[L.k] : 0;
      if (maxItem && entries[maxItem.id] > best) {
        const { data } = await sb.from('lift_entries').insert({ profile_id: S.me.id, lift: w.pr_lift, weight_lb: entries[maxItem.id], performed_on: w.day, source: 'workout' }).select().single();
        if (data && data.is_pr && data.prev_best) { go('/pr/' + data.id + '?celebrate=1'); return; }
        if (data && data.is_pr) prMsg = `New ${D.liftName(w.pr_lift)} PR: ${fmt(data.weight_lb)} lb!`;
      }
    }
    toast(prMsg || 'Logged');
    route();
  };
};

function dayBoard(w, logs) {
  const key = ((w.lifts || []).find(l => l.max) || (w.lifts || [])[0] || {}).id;
  const isT = w.score_type === 'time';
  const secs = s => { const m = String(s || '').match(/^(\d+):(\d{1,2})$/); return m ? +m[1] * 60 + +m[2] : 1e9; };
  const rows = logs.filter(l => l.status !== 'struck').concat(logs.filter(l => l.status === 'struck'));
  rows.sort((a, b) => (a.status === 'struck') - (b.status === 'struck') || (isT ? secs(a.score) - secs(b.score) : 0) || (num(b.entries[key]) - num(a.entries[key])));
  const lifts = w.lifts || [];
  return `<div class="board"><div class="boardHead"><div class="bhTop"><h3>${pd(w.day).toLocaleDateString('en-US', { weekday: 'long' })} <span>board</span></h3><p>${rows.length ? rows.length + ' logged' : 'Nobody has logged this day yet'}</p></div></div>
  ${rows.length ? `<div class="tablewrap"><table class="lb"><thead><tr><th>#</th><th>Lifter</th>${lifts.map(l => `<th class="r">${esc(l.n)}</th>`).join('')}${w.score_label ? `<th class="r">${esc(w.score_label)}</th>` : ''}<th></th></tr></thead><tbody>
  ${rows.map((x, i) => {
    const br = boardRow(x.profile_id) || {}, nm = nameOf(x.profile_id), mine = S.me && S.me.id === x.profile_id;
    return `<tr class="${mine ? 'me' : ''}${x.status === 'struck' ? ' struck' : ''}"><td class="pos">${i + 1}</td><td class="who"><a href="/u/${x.profile_id}">${esc(nm)}</a>${x.status === 'protested' ? '<span class="pill flat">Protest</span>' : ''}</td>
    ${lifts.map(l => { const v = num(x.entries[l.id]), t = D.target(l, br); return `<td class="r n">${v ? `<span class="${t && v >= t ? 'hit' : ''}">${v}</span>${t ? `<div class="sub">${Math.round(v / t * 100)}% of target</div>` : ''}` : '<span class="sub">n/a</span>'}</td>`; }).join('')}
    ${w.score_label ? `<td class="r n big">${esc(x.score || '')}</td>` : ''}
    <td class="r" data-host>${S.me && !mine && x.status === 'ok' ? `<button class="btn ghost sm" data-protest="workout_log" data-ref="${x.id}" data-title="${esc(nm + ' · ' + fmtD(w.day) + ' log')}">Protest</button>` : ''}</td></tr>`;
  }).join('')}</tbody></table></div>` : '<div class="empty">Log your lifts and you show up here.</div>'}</div>`;
}

/* ---------- chat ---------- */
VIEWS.chat = async (roomId, tok) => {
  if (!S.me) return needLogin(tok, 'chat');
  const [rooms, groups, gm] = await Promise.all([
    sb.from('chat_rooms').select('*').order('created_at', { ascending: false }).limit(200),
    sb.from('groups').select('*').order('kind').order('name'),
    sb.from('group_members').select('group_id').eq('profile_id', S.me.id),
    loadPeople(),
  ]).then(r => r.slice(0, 3).map(must));
  const myGroups = new Set(gm.map(g => g.group_id));
  const groupRooms = rooms.filter(r => r.kind === 'group');
  const threads = rooms.filter(r => r.kind !== 'group').slice(0, 30);
  const gById = new Map(groups.map(g => [g.id, g]));
  const room = rooms.find(r => r.id === roomId) || groupRooms.find(r => (gById.get(r.group_id) || {}).slug === 'everyone') || groupRooms[0];
  const locked = groups.filter(g => !groupRooms.some(r => r.group_id === g.id));
  const joinable = locked.filter(g => g.is_open && !myGroups.has(g.id) && g.kind === 'custom');
  const pro = locked.filter(g => g.min_tier !== 'free');
  const back = room && { pr: ['/prs', 'PR wall'], workout: ['/week', 'The week'], protest: ['/protests', 'Protests'], battle: ['/battles/' + room.ref_id, 'The battle'] }[room.kind];
  const sideRoom = r => `<a class="room" href="/chat/${r.id}" ${room && r.id === room.id ? 'aria-current="page"' : ''}><b>${esc(r.title)}</b><span class="sub">${r.kind === 'group' ? esc((gById.get(r.group_id) || {}).kind || '') : esc(r.kind)}</span></a>`;
  if (!paint(tok, `<section class="sec"><div><div class="kicker">Talk it out</div><h2>The <span>chat</span></h2></div>
  <div class="chatWrap"><aside class="rooms" aria-label="Rooms">
    <h4>Groups</h4>${groupRooms.map(sideRoom).join('') || '<p class="empty">No groups yet.</p>'}
    ${joinable.map(g => `<div class="room"><b>${esc(g.name)}</b><button class="btn ghost sm" data-join="${g.id}">Join</button></div>`).join('')}
    ${pro.filter(g => !joinable.includes(g)).map(g => `<a class="room" href="/pro"><b>${esc(g.name)}</b><span class="pill acc">Pro</span></a>`).join('')}
    <h4>Threads</h4>${threads.map(sideRoom).join('') || '<p class="empty" style="padding:8px 14px">Hit Talk on any PR, day or protest to start one.</p>'}
    ${isPro() ? `<h4>New group</h4><form id="ng" class="inlineForm" style="margin:0 10px 10px"><input id="ng-name" maxlength="40" minlength="3" placeholder="Name, like Masters 50+" required><select id="ng-tier"><option value="free">Everyone can join</option><option value="pro">DSI Pro only</option></select><label class="check"><input type="checkbox" id="ng-open" checked><span class="sub">Open to join</span></label><button class="btn sm">Create</button></form>` : `<h4>New group</h4><a class="room" href="/pro"><b>Start your own group</b><span class="pill acc">Pro</span></a>`}
  </aside>
  ${room ? `<div class="thread"><div class="thHead"><h3>${esc(room.title)}</h3>${back ? `<a class="chip" href="${back[0]}">${back[1]}</a>` : ''}</div>
    <div class="msgs" id="msgs" aria-live="polite"><p class="empty">Loading…</p></div>
    ${room.kind !== 'group' && !isPro() ? `<div class="rulesGate"><span>Posting in PR, day and protest threads is part of DSI Pro. Your group rooms are free.</span><a class="btn sm" href="/pro">See Pro</a></div>` : S.me.terms_accepted_at ? '' : `<div class="rulesGate"><span>Agree to the <a href="/rules">community rules</a> to post.</span><button class="btn sm" type="button" id="agreeRules">I agree</button></div>`}
    <form class="compose" id="cmp"${S.me.terms_accepted_at && (room.kind === 'group' || isPro()) ? '' : ' hidden'}><label class="vh" for="cmp-t">Message</label><textarea id="cmp-t" maxlength="1000" placeholder="${S.me.roast_opt_in ? 'Say something. Roasts welcome.' : 'Say something'}" required></textarea><button class="btn">Send</button></form></div>`
      : '<div class="prEmpty"><b>No rooms yet</b></div>'}
  </div></section>`)) return;

  $$('[data-join]').forEach(b => b.onclick = async () => {
    const { error } = await sb.from('group_members').insert({ group_id: b.dataset.join, profile_id: S.me.id });
    if (error) return toast(error.message); toast('Joined'); route();
  });
  const ng = $('#ng');
  if (ng) ng.onsubmit = async e => {
    e.preventDefault();
    const name = $('#ng-name').value.trim();
    const { data: gid, error } = await sb.rpc('create_group', { p_name: name, p_open: $('#ng-open').checked, p_pro_only: $('#ng-tier').value === 'pro' });
    if (error) return toast(error.message);
    const { data: r } = await sb.from('chat_rooms').select('id').eq('kind', 'group').eq('group_id', gid).maybeSingle();
    toast('Group created'); r ? go('/chat/' + r.id) : route();
  };
  if (!room) return;

  const box = $('#msgs'), seen = new Set();
  const line = m => {
    const mine = m.profile_id === S.me.id, canDel = !m.deleted && (mine || isStaff());
    if (S.blocked.has(m.profile_id)) return `<div class="msg del" data-mid="${m.id}"><div class="tx">Message from a blocked lifter</div></div>`;
    const acts = [canDel ? `<button class="x" data-rm="${m.id}">Remove</button>` : '', !mine && !m.deleted ? `<button class="x" data-rp="${m.id}" data-uid="${m.profile_id}">Report</button><button class="x" data-bl="${m.profile_id}">Block</button>` : ''].join('');
    return `<div class="msg${mine ? ' mine' : ''}${m.deleted ? ' del' : ''}" data-mid="${m.id}"><div class="by"><a href="/u/${m.profile_id}"><b>${esc(nameOf(m.profile_id))}</b></a> · ${timeAgo(m.created_at)}</div><div class="tx">${m.deleted ? 'Message removed' : esc(m.body)}</div>${acts ? `<div class="acts">${acts}</div>` : ''}</div>`;
  };
  const add = m => {
    if (seen.has(m.id)) return; seen.add(m.id);
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    box.insertAdjacentHTML('beforeend', line(m));
    if (near || m.profile_id === S.me.id) box.scrollTop = box.scrollHeight;
  };
  const msgs = must(await sb.from('messages').select('*').eq('room_id', room.id).order('created_at', { ascending: false }).limit(200)).reverse();
  if (tok !== S.tok) return;
  box.innerHTML = msgs.length ? '' : '<p class="empty" id="noMsg">No messages yet. Start it.</p>';
  msgs.forEach(add);
  box.scrollTop = box.scrollHeight;
  box.onclick = async e => {
    const d = e.target.dataset || {};
    if (d.rp) { reportDialog({ type: 'message', id: d.rp, name: 'Message from ' + nameOf(d.uid), uid: d.uid }); return; }
    if (d.bl) {
      const { error } = await sb.from('blocks').insert({ blocker: S.me.id, blocked: d.bl });
      if (error) return toast(error.message);
      await loadMe(); toast(`Blocked ${nameOf(d.bl)}`); box.innerHTML = ''; seen.clear(); msgs.forEach(add); return;
    }
    const id = d.rm; if (!id) return;
    const { error } = await sb.from('messages').update({ deleted: true }).eq('id', id);
    if (error) toast(error.message);
    else { const el = box.querySelector(`[data-mid="${id}"]`); if (el) el.outerHTML = line({ id, profile_id: S.me.id, deleted: true, created_at: new Date().toISOString(), ...(msgs.find(m => m.id === id) || {}), deleted: true }); }
  };
  const ch = sb.channel('room-' + room.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'room_id=eq.' + room.id }, async p => {
      if (!S.people.has(p.new.profile_id)) await loadPeople();
      const nm = $('#noMsg'); if (nm) nm.remove();
      add(p.new);
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: 'room_id=eq.' + room.id }, p => {
      const el = box.querySelector(`[data-mid="${p.new.id}"]`); if (el) el.outerHTML = line(p.new);
    })
    .subscribe();
  S.channels.push(ch);
  const ag = $('#agreeRules');
  if (ag) ag.onclick = async () => { const ok = await acceptRules(); if (ok) route(); };
  const cmp = $('#cmp'), ta = $('#cmp-t');
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); cmp.requestSubmit(); } };
  cmp.onsubmit = async e => {
    e.preventDefault();
    const body = ta.value.trim(); if (!body) return;
    ta.value = '';
    const { data, error } = await sb.from('messages').insert({ room_id: room.id, profile_id: S.me.id, body }).select().single();
    if (error) { ta.value = body; toast(error.message); return; }
    const nm = $('#noMsg'); if (nm) nm.remove();
    add(data);
  };
};

/* ---------- protests ---------- */
VIEWS.protests = async (_, tok) => {
  const [pres] = await Promise.all([sb.from('protests').select('*').order('created_at', { ascending: false }).limit(100), loadPeople()]);
  const list = must(pres);
  const liftIds = list.filter(p => p.target_type === 'lift_entry').map(p => p.target_id);
  const logIds = list.filter(p => p.target_type === 'workout_log').map(p => p.target_id);
  const [lifts, logs] = await Promise.all([
    liftIds.length ? sb.from('lift_entries').select('*').in('id', liftIds).then(must) : [],
    logIds.length ? sb.from('workout_logs').select('*, workout:workouts(day,title)').in('id', logIds).then(must) : [],
  ]);
  const tgt = new Map([...lifts, ...logs].map(x => [x.id, x]));
  const staff = isStaff();
  const LBL = { open: ['Under review', 'flat'], upheld: ['Lift stands', 'up'], struck: ['Struck', 'down'] };
  const card = p => {
    const t = tgt.get(p.target_id);
    let what = 'A deleted entry', c = 'var(--flat)', who = '';
    if (t && p.target_type === 'lift_entry') { what = `${nameOf(t.profile_id)} · ${D.liftName(t.lift)} ${fmt(t.weight_lb)} lb · ${fmtD(t.performed_on)}`; c = D.liftColor(t.lift); who = t.profile_id; }
    if (t && p.target_type === 'workout_log') { what = `${nameOf(t.profile_id)} · ${t.workout ? esc(fmtD(t.workout.day) + ' ' + t.workout.title) : 'workout'} log`; who = t.profile_id; }
    const st = LBL[p.status];
    return `<article class="pcase" style="--c:${p.status === 'open' ? 'var(--flat)' : p.status === 'struck' ? 'var(--down)' : 'var(--up)'}" data-host>
      <div class="row"><span class="pill ${st[1]}" style="margin:0">${st[0]}</span><span class="sub">Filed ${timeAgo(p.created_at)} by ${esc(nameOf(p.filed_by))}</span></div>
      <h3>${who ? `<a href="/u/${who}" style="text-decoration:none">${esc(what)}</a>` : esc(what)}</h3>
      <p>“${esc(p.reason)}”</p>
      ${p.status !== 'open' ? `<p class="ruling"><b>Ruling by ${esc(nameOf(p.ruled_by))}:</b> ${esc(p.ruling_note || (p.status === 'struck' ? 'Struck from the record.' : 'The lift stands.'))}</p>` : ''}
      <div class="row"><button class="btn ghost sm" data-thread="protest" data-ref="${p.id}" data-title="${esc('Protest: ' + what)}">Discuss</button></div>
      ${staff && p.status === 'open' ? `<form class="inlineForm" data-rule="${p.id}"><label class="eyebrow" for="rn-${p.id}">Commissioner ruling</label><textarea id="rn-${p.id}" maxlength="500" placeholder="Explain the ruling (optional)"></textarea>
        <div class="row"><button class="btn sm" data-d="upheld">Lift stands</button><button class="btn danger sm" data-d="struck">Strike it</button></div></form>` : ''}
    </article>`;
  };
  const open = list.filter(p => p.status === 'open'), done = list.filter(p => p.status !== 'open');
  if (!paint(tok, `<section class="sec"><div><div class="kicker">Commissioner's court</div><h2><span>Protests</span></h2></div>
    <p class="lede">See a suspicious PR or a questionable log? Hit Protest on the PR wall, a lifter page or a day board. The lift is flagged until JB31 rules. Struck lifts come off the boards.</p></section>
    <section class="sec"><h2>Open <span>cases</span></h2>${open.length ? `<div class="plist">${open.map(card).join('')}</div>` : '<div class="prEmpty"><b>No open protests</b><p>Peace in the gym. For now.</p></div>'}</section>
    ${done.length ? `<section class="sec"><h2>Ruled</h2><div class="plist">${done.map(card).join('')}</div></section>` : ''}`)) return;
  bindActions(main, () => route());
  $$('[data-rule]').forEach(f => $$('button[data-d]', f).forEach(b => b.onclick = async e => {
    e.preventDefault();
    b.disabled = true;
    const { error } = await sb.rpc('rule_protest', { p_protest: f.dataset.rule, p_decision: b.dataset.d, p_note: f.querySelector('textarea').value.trim() || null });
    if (error) { b.disabled = false; return toast(error.message); }
    toast(b.dataset.d === 'struck' ? 'Struck from the record' : 'The lift stands'); route();
  }));
};

/* ---------- me: the hub ---------- */
const LIFT_IDS = D.ALL_LIFTS.map(x => x[0]);
VIEWS.me = async (_, tok) => {
  if (!S.me) return needLogin(tok, 'see your account');
  const [board, goals, bests] = await Promise.all([loadBoard(), sb.from('goals').select('*').eq('profile_id', S.me.id).then(must), sb.from('lift_bests').select('lift,weight_lb').eq('profile_id', S.me.id).then(must)]);
  const m = S.me, first = !m.display_name, pro = isPro();
  const gl = Object.fromEntries(goals.map(g => [g.lift, g]));
  const best = Object.fromEntries(bests.map(b => [b.lift, num(b.weight_lb)]));
  const goalIds = [...new Set([...D.LIFTS.map(l => l.db), ...goals.map(g => g.lift)])];
  const WEEKS = [8, 12, 16, 24];
  const goalCard = id => { const g = gl[id] || {}; return `<div class="g" style="--c:${D.liftColor(id)}"><h4>${esc(D.liftName(id))}</h4><input type="number" min="0" max="1499" step="any" data-g="${id}" value="${g.target_lb ? num(g.target_lb) : ''}" aria-label="${esc(D.liftName(id))} goal"><div class="now">${best[id] ? 'Best ' + fmt(best[id]) + ' lb' : 'No lift yet'}</div>
    ${pro ? `<select data-gd="${id}" aria-label="${esc(D.liftName(id))} goal date"><option value="">No date</option>${WEEKS.map(w => { const d = addDays(today(), w * 7); return `<option value="${d}">${w} weeks · ${fmtD(d)}</option>`; }).join('')}${g.target_date ? `<option value="${g.target_date}" selected>By ${fmtD(g.target_date)}</option>` : ''}</select>` : ''}</div>`; };
  const row = boardRow(m.id), v = row ? D.verdict(row.score) : null;
  const yr = new Date().getFullYear();
  const tile = (href, t, d, isProTool) => `<a class="tool" href="${pro || !isProTool ? href : '/pro'}"><b>${t}${isProTool ? ' ' + PRO : ''}</b><span>${d}</span></a>`;
  if (!paint(tok, `<section class="sec"><div class="secHead"><div><div class="kicker">${first ? 'Welcome to the index' : (m.role === 'admin' ? 'Founder' : m.role === 'commissioner' ? 'Commissioner' : pro ? 'DSI Pro' : 'Member')}</div><h2>${first ? 'Set up your <span>profile</span>' : esc(m.display_name)}</h2>
      <p class="secSub">${esc(S.session.user.email)}${first ? '' : ` · <a href="/u/${m.id}">View my card</a>`}</p></div>
      ${row ? `<div class="kpi"><div><b>${row.score}</b><span>DSI™</span></div><div><b>${fmt(row.total)}</b><span>Total</span></div></div>` : ''}</div>
      ${v ? `<p class="lede"><b style="color:var(--accent)">${esc(v[1])}.</b> ${esc(m.roast_opt_in ? v[2] : v[3])}</p>` : ''}</section>
    ${first ? '' : `<section class="sec band"><div class="secHead"><div><div class="kicker">DSI Pro</div><h2>Train with a <span>plan</span></h2></div>${pro ? '<span class="pill up" style="margin:0">Pro active</span>' : '<a class="btn sm" href="/pro">See Pro</a>'}</div>
      <div class="tools">${tile('/progress', 'Progress charts', 'Every lift over time with your goal line.', 1)}${tile('/plans', 'Goal plans', 'A week by week path to your number.', 1)}${tile('/coach', 'Coach', 'Your weak link and what to train next.', 1)}${tile('/import', 'Import history', 'Paste years of lifts from a spreadsheet.', 1)}${tile('/recap/' + new Date().getFullYear(), 'Year recap', 'Your year in PRs and pounds, ready to share.', 1)}${tile('/battles', 'Weekly battles', 'Call out a lifter for a week.', 1)}</div></section>
    <section class="sec"><div class="secHead"><div><div class="kicker">Compete and grow</div><h2>More to <span>do</span></h2></div><button class="btn sm" data-invite>Invite your crew</button></div>
      <div class="tools">${tile('/gyms', 'Your gym', m.gym_id ? 'See your gym in the league.' : 'Pick your gym and put it on the league.')}${tile('/season', 'This season', 'Most DSI points gained this quarter.', 1)}${tile('/benchmarks', 'Benchmarks', 'Named workouts and every score.')}${tile('/plates', 'Plate calculator', 'Plates per side and warmups.')}</div></section>
    <section class="sec"><div><div class="kicker">Reminders</div><h2>Your <span>reminders</span></h2><p class="secSub">These go to your phone through the DSI app. Turn notifications on in the app once and these settings follow you.</p></div>
      <form class="formCard" id="nf"><div class="fields">
        <div class="field w2"><span class="lbl">Send me</span>
          <label class="check"><input type="checkbox" id="nf-r"${m.notify_reminders !== false ? ' checked' : ''}><span>Workout reminders on days with programming, until I log</span></label>
          <label class="check"><input type="checkbox" id="nf-p"${m.notify_prs !== false ? ' checked' : ''}><span>New PRs from anyone on the board</span></label>
          <label class="check"><input type="checkbox" id="nf-g"${m.notify_program !== false ? ' checked' : ''}><span>New programming when the week goes up</span></label></div>
        <div class="field"><label for="nf-h">Remind me at</label><select id="nf-h">${[5, 6, 7, 12, 16, 17, 18, 19, 20, 21].map(h => `<option value="${h}"${(m.reminder_hour ?? 18) === h ? ' selected' : ''}>${h % 12 || 12}${h < 12 ? 'am' : 'pm'}</option>`).join('')}</select></div></div>
        <div class="row"><button class="btn" type="submit">Save</button><span class="hint" id="nf-msg"></span></div></form></section>`}
    <section class="sec"><div><div class="kicker">Profile</div><h2>${first ? 'The <span>basics</span>' : 'Edit <span>profile</span>'}</h2></div>
    <form class="formCard" id="pf">
      <div class="fields">
        <div class="field w2"><label for="pf-n">Board name</label><input id="pf-n" maxlength="24" required value="${esc(m.display_name || '')}" autocomplete="nickname"></div>
        <div class="field"><label for="pf-by">Birth year</label><input id="pf-by" type="number" min="${yr - 100}" max="${yr - 13}" value="${esc(m.birth_year || '')}" required></div>
        <div class="field"><label for="pf-bw">Bodyweight (lb)</label><input id="pf-bw" type="number" min="80" max="450" step="0.1" value="${esc(m.bodyweight || '')}" required></div>
        <div class="field"><label for="pf-sex">Sex</label><select id="pf-sex">${[['male', 'Male'], ['female', 'Female'], ['unspecified', 'Prefer not to say']].map(o => `<option value="${o[0]}"${m.sex === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}</select></div>
        <div class="field"><label for="pf-div">Division</label><select id="pf-div">${[['men', 'Men'], ['women', 'Women'], ['open', 'Open']].map(o => `<option value="${o[0]}"${m.division === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}</select></div>
        <div class="field w2"><span class="lbl">Roasts</span><label class="check" style="text-transform:none;letter-spacing:0;font:500 15px var(--sans);color:var(--ink)"><input type="checkbox" id="pf-roast"${m.roast_opt_in ? ' checked' : ''}${pro ? '' : ' disabled'}><span>Roast me. Show the savage verdict on my card and put a 🔥 by my name.${pro ? '' : ' <a href="/pro">DSI Pro</a>'}</span></label></div>
      </div>
      <div class="row"><button class="btn" type="submit">${first ? 'Join the board' : 'Save'}</button><span class="hint" id="pf-msg"></span></div>
    </form></section>
    ${first ? '' : !pro ? `<section class="sec band"><div class="secHead"><div><div class="kicker">What you're chasing</div><h2>Goals ${PRO}</h2><p class="secSub">Set a number and a date, and get a week by week plan to hit it.</p></div><a class="btn sm" href="/pro">See Pro</a></div></section>
    <section class="sec"><div><div class="kicker">Community</div><h2>Rules and <span>safety</span></h2></div>
      <div class="tools">${tile('/rules', 'Community rules', m.terms_accepted_at ? 'You agreed on ' + fmtD(m.terms_accepted_at) + '.' : 'Agree before posting in chat.')}${tile('/blocked', 'Blocked lifters', S.blocked.size ? S.blocked.size + ' blocked' : 'Nobody blocked.')}${tile('/protests', 'Protests', 'The Commissioner\'s court.')}</div></section>
    <section class="sec"><div><div class="kicker">Account</div><h2>Your <span>account</span></h2></div>
      <div class="row"><span class="pill acc" style="margin:0">Member</span><a class="btn ghost sm" href="/pro">Membership</a><button class="btn ghost sm" id="so">Sign out</button><button class="btn ghost sm dangerText" id="delAcct">Delete account</button></div>
      <p class="hint">Deleting removes your profile, every lift, goal, log, message and video, and your login. It cannot be undone.</p></section>` : `<section class="sec band"><div class="secHead"><div><div class="kicker">What you're chasing</div><h2>Goals</h2>${pro ? '<p class="secSub">Pick a date and your goal plan updates.</p>' : `<p class="secSub">Add a date and get a weekly plan with <a href="/pro">DSI Pro</a>.</p>`}</div></div>
      <form class="formCard" id="gf"><div class="goalRows" id="gRows">${goalIds.map(goalCard).join('')}</div>
      <div class="row"><label class="vh" for="g-add">Add a goal for another lift</label><select id="g-add" style="max-width:280px"><option value="">Add a goal for another lift…</option>${D.ALL_LIFTS.filter(([id]) => !goalIds.includes(id)).map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('')}</select><button class="btn ghost sm" type="button" id="g-addb">Add</button></div>
      <div class="row"><button class="btn" type="submit">Save goals</button><span class="hint">Clear a box to remove that goal.</span></div></form></section>
    <section class="sec"><div><div class="kicker">Community</div><h2>Rules and <span>safety</span></h2></div>
      <div class="tools">${tile('/rules', 'Community rules', m.terms_accepted_at ? 'You agreed on ' + fmtD(m.terms_accepted_at) + '.' : 'Agree before posting in chat.')}${tile('/blocked', 'Blocked lifters', S.blocked.size ? S.blocked.size + ' blocked' : 'Nobody blocked.')}${isStaff() ? tile('/reports', 'Reports', 'Review reports within 24 hours.') + tile('/program', 'Import workouts', 'Post the week from a gym link or screenshots.') : ''}${tile('/protests', 'Protests', 'The Commissioner\'s court.')}</div></section>
    <section class="sec"><div><div class="kicker">Account</div><h2>Your <span>account</span></h2></div>
      <div class="row"><span class="pill acc" style="margin:0">${pro ? 'DSI Pro' : 'Member'}</span><a class="btn ghost sm" href="/pro">Membership</a><button class="btn ghost sm" id="so">Sign out</button><button class="btn ghost sm dangerText" id="delAcct">Delete account</button></div>
      <p class="hint">Deleting removes your profile, every lift, goal, log, message and video, and your login. It cannot be undone.</p></section>`}`)) return;
  const nf = $('#nf');
  if (nf) nf.onsubmit = async e => {
    e.preventDefault();
    const msg = $('#nf-msg'); msg.textContent = 'Saving…';
    const { data, error } = await sb.from('profiles').update({ notify_reminders: $('#nf-r').checked, notify_prs: $('#nf-p').checked, notify_program: $('#nf-g').checked, reminder_hour: +$('#nf-h').value }).eq('id', m.id).select().single();
    if (error) { msg.textContent = error.message; return; }
    S.me = data; msg.textContent = 'Saved. Your phone picks this up next time the app opens.';
  };
  $('#pf').onsubmit = async e => {
    e.preventDefault();
    const msg = $('#pf-msg'), b = e.target.querySelector('button'); b.disabled = true; msg.textContent = 'Saving…';
    const upd = { display_name: $('#pf-n').value.trim(), birth_year: +$('#pf-by').value, bodyweight: +$('#pf-bw').value, sex: $('#pf-sex').value, division: $('#pf-div').value, roast_opt_in: $('#pf-roast').checked };
    const { data, error } = await sb.from('profiles').update(upd).eq('id', m.id).select().single();
    b.disabled = false;
    if (error) { msg.textContent = error.code === '23505' ? 'That name is taken. Try another.' : error.message; return; }
    S.me = data; updateChrome('me'); toast('Saved');
    if (first) go(data.terms_accepted_at ? '/' : '/rules'); else msg.textContent = 'Saved.';
  };
  const gf = $('#gf');
  if (gf) gf.onsubmit = async e => {
    e.preventDefault();
    const inputs = $$('[data-g]', gf);
    const dateOf = id => { const sel = $(`[data-gd="${id}"]`, gf); return sel ? sel.value || null : (gl[id] ? gl[id].target_date : null); };
    const ups = inputs.filter(i => +i.value > 0).map(i => ({ profile_id: m.id, lift: i.dataset.g, target_lb: +i.value, target_date: dateOf(i.dataset.g), updated_at: new Date().toISOString() }));
    const dels = inputs.filter(i => !(+i.value > 0) && gl[i.dataset.g]).map(i => i.dataset.g);
    if (!ups.length && !dels.length) return toast('Enter a goal first');
    const r1 = ups.length ? await sb.from('goals').upsert(ups, { onConflict: 'profile_id,lift' }) : {};
    const r2 = dels.length ? await sb.from('goals').delete().eq('profile_id', m.id).in('lift', dels) : {};
    const err = r1.error || r2.error;
    toast(err ? err.message : 'Goals saved');
    if (!err) route();
  };
  const addb = $('#g-addb');
  if (addb) addb.onclick = () => {
    const sel = $('#g-add'), id = sel.value; if (!id) return;
    $('#gRows').insertAdjacentHTML('beforeend', goalCard(id));
    sel.querySelector(`option[value="${id}"]`).remove(); sel.value = '';
    $(`[data-g="${id}"]`).focus();
  };
  const so = $('#so'); if (so) so.onclick = async () => { await sb.auth.signOut(); go('/'); };
  const del = $('#delAcct'); if (del) del.onclick = () => confirmDialog({
    title: 'Delete your account?', body: 'This permanently deletes your profile, every lift, goal, log, message and video, and your login. Type DELETE to confirm.',
    typed: 'DELETE', okLabel: 'Delete forever', danger: true,
    onOk: async () => {
      const { error } = await sb.rpc('delete_my_account');
      if (error) { toast(error.message); return false; }
      await sb.auth.signOut(); toast('Your account has been deleted.'); go('/'); return true;
    },
  });
};

/* ---------- dialogs: report, confirm, video ---------- */
function dialog(html) {
  const d = document.createElement('dialog');
  d.className = 'dlg'; d.innerHTML = html;
  document.body.appendChild(d);
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', e => { if (e.target === d) d.close(); });
  d.showModal();
  return d;
}
function reportDialog({ type, id, name, uid }) {
  if (!S.me) { go('/login'); return; }
  const REASONS = ['Harassment or hate', 'Sexual or violent content', 'Spam or scam', 'Fake lifts', 'Something else'];
  const canBlock = uid && uid !== S.me.id && !S.blocked.has(uid);
  const d = dialog(`<form method="dialog" class="dlgIn"><div class="kicker">Report</div><h3>${esc(name || 'Report')}</h3>
    <div class="chips" role="radiogroup" aria-label="Reason">${REASONS.map((r, i) => `<label class="chip"><input type="radio" name="rr" value="${esc(r)}"${i ? '' : ' required'}> ${esc(r)}</label>`).join('')}</div>
    <textarea name="detail" maxlength="400" placeholder="Add detail (optional)"></textarea>
    ${canBlock ? '<label class="check"><input type="checkbox" name="blk" checked><span>Also block this person</span></label>' : ''}
    <div class="row"><button class="btn" value="ok">Send report</button><button class="btn ghost" value="cancel" formnovalidate>Cancel</button></div>
    <p class="hint">Reports are private and reviewed within 24 hours.</p></form>`);
  d.querySelector('form').onsubmit = async e => {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault();
    const f = e.target, reason = (f.rr.value || '') + (f.detail.value.trim() ? ': ' + f.detail.value.trim() : '');
    const { error } = await sb.from('reports').insert({ reporter: S.me.id, target_type: type, target_id: id, reason: reason.slice(0, 500) });
    if (error) { toast(error.message); return; }
    if (canBlock && f.blk && f.blk.checked) { await sb.from('blocks').insert({ blocker: S.me.id, blocked: uid }); await loadMe(); }
    d.close(); toast('Thanks. The DSI team reviews every report within 24 hours.');
    if (canBlock && f.blk && f.blk.checked) route();
  };
}
function confirmDialog({ title, body, typed, okLabel, danger, onOk }) {
  const d = dialog(`<form method="dialog" class="dlgIn"><h3>${esc(title)}</h3><p>${esc(body)}</p>
    ${typed ? `<input name="t" autocomplete="off" placeholder="${esc(typed)}" aria-label="Type ${esc(typed)} to confirm">` : ''}
    <div class="row"><button class="btn${danger ? ' danger' : ''}" value="ok">${esc(okLabel)}</button><button class="btn ghost" value="cancel" formnovalidate>Cancel</button></div></form>`);
  d.querySelector('form').onsubmit = async e => {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault();
    if (typed && e.target.t.value.trim().toUpperCase() !== typed) { e.target.t.focus(); return; }
    if (await onOk()) d.close();
  };
}
const videoUrl = path => sb.storage.from('lift-videos').getPublicUrl(path).data.publicUrl;
function bindVideo(root, done) {
  $$('[data-vid]', root).forEach(b => b.onclick = () => { dialog(`<div class="dlgIn vid"><video src="${esc(videoUrl(b.dataset.vid))}" controls autoplay playsinline></video><form method="dialog"><button class="btn ghost sm">Close</button></form></div>`); });
  $$('[data-addvid]', root).forEach(b => b.onclick = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'video/mp4,video/quicktime,video/*';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      if (f.size > 100 * 1024 * 1024) { toast('Keep videos under 100 MB, about a minute.'); return; }
      b.disabled = true; b.textContent = 'Uploading…';
      const ext = (f.name.split('.').pop() || 'mp4').toLowerCase(), path = `${S.me.id}/${b.dataset.addvid}.${ext}`;
      const up = await sb.storage.from('lift-videos').upload(path, f, { contentType: f.type || 'video/mp4', upsert: true });
      if (up.error) { toast(up.error.message); b.disabled = false; b.textContent = 'Add video'; return; }
      const { error } = await sb.from('lift_entries').update({ video_path: path }).eq('id', b.dataset.addvid);
      if (error) { toast(error.message); return; }
      toast('Video attached'); done && done();
    };
    inp.click();
  });
}
async function acceptRules() {
  if (!S.me) { go('/login'); return false; }
  const { data, error } = await sb.from('profiles').update({ terms_accepted_at: new Date().toISOString() }).eq('id', S.me.id).select().single();
  if (error) { toast(error.message); return false; }
  S.me = data; toast('Thanks. Welcome to the crew.'); return true;
}

/* ---------- community rules ---------- */
const RULES = [
  ['Log real lifts', 'Only log weight you actually moved. Fake numbers get struck from the record.'],
  ['Talk trash, not hate', 'Roasts are for people who opt in. No harassment, threats, slurs, or attacks on anyone for who they are.'],
  ['Keep it clean', 'No sexual content, spam, scams, or anything illegal.'],
  ['Protest in good faith', 'Protest lifts you honestly doubt. The Commissioner rules on every one.'],
  ['Report and block', 'Use Report and Block on any message or lifter. Reports are reviewed within 24 hours and offenders are removed.'],
];
VIEWS.rules = async (_, tok) => {
  if (!paint(tok, `<section class="sec narrow"><div><div class="kicker">Before you post</div><h2>Community <span>rules</span></h2><p class="secSub">DSI has zero tolerance for abusive content or abusive users.</p></div></section>
    <section class="sec"><div class="rules">${RULES.map(([h, t], i) => `<div class="rule"><span>0${i + 1}</span><b>${h}</b><p>${t}</p></div>`).join('')}</div>
    <div class="row" style="margin-top:12px">${S.me ? (S.me.terms_accepted_at ? `<span class="pill up" style="margin:0">You agreed on ${fmtD(S.me.terms_accepted_at)}</span>` : '<button class="btn" id="agree">I agree</button>') : '<a class="btn" href="/login">Sign in to join</a>'}<a class="chip" href="/terms">Terms of use</a><a class="chip" href="/privacy">Privacy</a></div></section>`)) return;
  const a = $('#agree'); if (a) a.onclick = async () => { if (await acceptRules()) go('/chat'); };
};

/* ---------- blocked and reports ---------- */
VIEWS.blocked = async (_, tok) => {
  if (!S.me) return needLogin(tok, 'manage blocks');
  const ids = [...S.blocked];
  const people = ids.length ? must(await sb.from('profiles').select('id,display_name').in('id', ids)) : [];
  if (!paint(tok, `<section class="sec narrow"><div><div class="kicker">Safety</div><h2>Blocked <span>lifters</span></h2><p class="secSub">You do not see messages from people you block.</p></div></section>
    <section class="sec">${people.length ? `<div class="board">${people.map(p => `<div class="room"><b>${esc(p.display_name || 'Someone')}</b><button class="btn ghost sm" data-ub="${p.id}">Unblock</button></div>`).join('')}</div>` : '<div class="prEmpty"><b>Nobody blocked</b><p>Use Block on any chat message or lifter card.</p></div>'}</section>`)) return;
  $$('[data-ub]').forEach(b => b.onclick = async () => { await sb.from('blocks').delete().eq('blocker', S.me.id).eq('blocked', b.dataset.ub); await loadMe(); toast('Unblocked'); route(); });
};
VIEWS.reports = async (_, tok) => {
  if (!isStaff()) return paint(tok, '<section class="sec"><div class="prEmpty"><b>Staff only</b></div></section>');
  const [list] = await Promise.all([sb.from('reports').select('*').order('created_at', { ascending: false }).limit(100).then(must), loadPeople()]);
  const msgIds = list.filter(r => r.target_type === 'message').map(r => r.target_id);
  const ctx = new Map(msgIds.length ? must(await sb.from('messages').select('id,body,deleted').in('id', msgIds)).map(m => [m.id, (m.deleted ? '[removed] ' : '') + '“' + m.body + '”']) : []);
  const open = list.filter(r => r.status === 'open'), done = list.filter(r => r.status !== 'open').slice(0, 30);
  const card = r => `<article class="pcase" style="--c:${r.status === 'open' ? 'var(--down)' : 'var(--line)'}">
    <div class="row"><span class="pill ${r.status === 'open' ? 'down' : 'flat'}" style="margin:0">${esc(r.status)}</span><span class="sub">${esc(r.target_type)} · ${timeAgo(r.created_at)} · by ${esc(nameOf(r.reporter))}</span></div>
    <h3>${esc(r.reason)}</h3>${ctx.get(r.target_id) ? `<p>${esc(ctx.get(r.target_id))}</p>` : ''}${r.target_type === 'profile' ? `<p><a href="/u/${r.target_id}">Open ${esc(nameOf(r.target_id))}</a></p>` : ''}
    ${r.status === 'open' ? `<div class="row"><button class="btn danger sm" data-act="${r.id}">${r.target_type === 'message' ? 'Remove it' : r.target_type === 'lift_entry' ? 'Strike it' : 'Actioned'}</button><button class="btn ghost sm" data-dis="${r.id}">Dismiss</button></div>` : ''}</article>`;
  if (!paint(tok, `<section class="sec"><div><div class="kicker">Staff</div><h2><span>Reports</span></h2><p class="secSub">Apple requires a response within 24 hours.</p></div></section>
    <section class="sec"><h2>Open</h2>${open.length ? `<div class="plist">${open.map(card).join('')}</div>` : '<div class="prEmpty"><b>No open reports</b></div>'}</section>
    ${done.length ? `<section class="sec"><h2>Handled</h2><div class="plist">${done.map(card).join('')}</div></section>` : ''}`)) return;
  const handle = async (id, status) => {
    const r = list.find(x => x.id === id);
    if (status === 'actioned' && r.target_type === 'message') await sb.from('messages').update({ deleted: true }).eq('id', r.target_id);
    if (status === 'actioned' && r.target_type === 'lift_entry') await sb.from('lift_entries').update({ status: 'struck' }).eq('id', r.target_id);
    const { error } = await sb.from('reports').update({ status, handled_by: S.me.id, handled_at: new Date().toISOString() }).eq('id', id);
    if (error) toast(error.message); else route();
  };
  $$('[data-act]').forEach(b => b.onclick = () => handle(b.dataset.act, 'actioned'));
  $$('[data-dis]').forEach(b => b.onclick = () => handle(b.dataset.dis, 'dismissed'));
};

/* ---------- Pro ---------- */
const PERKS = [['Your target weights', 'Every workout turned into weights built from your own PRs.', '/week'], ['Workout logging and day boards', 'Log what you did and see how you stack up each day.', '/week'], ['Every board and filter', 'Total and single lift boards, age brackets.', '/'], ['Goals, plans and charts', 'Set a date and get a week by week path to your number.', '/plans'], ['Coach', 'Your weak link, your ratios, and what to train next.', '/coach'], ['Video on any set', 'Proof on every lift, not just PRs.', '/log'], ['Threads, groups and roast mode', 'Post in every thread, start your own groups, opt in to the roast.', '/chat'], ['Full history and imports', 'Every lift you ever logged, plus years more from a spreadsheet.', '/import']];
VIEWS.pro = async (_, tok) => {
  const pro = isPro();
  paint(tok, `<section class="sec"><div class="secHead"><div><div class="kicker">DSI Pro</div><h2>Train with a <span>plan</span></h2><p class="secSub">Everything in Member, plus the tools that turn numbers into progress.</p></div>
    ${pro ? '<span class="pill up" style="margin:0">Pro is active on your account</span>' : '<div class="kpi"><div><b>$9.99</b><span>a month</span></div><div><b>$59.99</b><span>a year</span></div></div>'}</div></section>
    <section class="sec band"><div class="tools">${PERKS.map(([t, d, h]) => `<a class="tool" href="${pro ? h : '/pro'}"><b>${t}</b><span>${d}</span></a>`).join('')}</div>
    ${pro ? '' : '<div class="row" style="margin-top:14px"><button class="btn" disabled>Coming soon</button><span class="hint">Pro memberships open soon in the DSI app.</span></div>'}</section>
    <section class="sec"><div><div class="kicker">Always free</div><h2>Member</h2></div><p class="lede">Your DSI, the overall board, the PR wall, logging your four DSI lifts, video on PRs, the daily workouts, group chat and protests.</p></section>`);
};
function proGate(tok, what) {
  return paint(tok, `<section class="sec narrow"><div><div class="kicker">DSI Pro</div><h2>${what}</h2><p class="secSub">This is part of DSI Pro.</p></div><div class="row"><a class="btn" href="/pro">See DSI Pro</a></div></section>`);
}

// Dependency free SVG line chart
function lineChart(points, color, goal) {
  const W = 680, H = 260, L = 48, R = 14, T = 14, B = 28;
  if (!points.length) return '';
  const xs = points.map(p => p.x), ys = points.map(p => p.y).concat(goal ? [goal] : []);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys); const padY = Math.max(10, (y1 - y0) * 0.15);
  y0 = Math.max(0, Math.floor((y0 - padY) / 5) * 5); y1 = Math.ceil((y1 + padY) / 5) * 5;
  const sx = x => L + (x1 === x0 ? (W - L - R) / 2 : (x - x0) / (x1 - x0) * (W - L - R));
  const sy = y => T + (1 - (y - y0) / ((y1 - y0) || 1)) * (H - T - B);
  const raw = (y1 - y0) / 4, mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1)))), n = raw / mag, step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  const ticks = []; for (let v = Math.ceil(y0 / step) * step; v <= y1; v += step) ticks.push(v);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  const f = t => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Progress chart">
    ${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}" class="gl"/><text x="${L - 8}" y="${sy(v) + 4}" text-anchor="end">${v}</text>`).join('')}
    ${goal ? `<line x1="${L}" x2="${W - R}" y1="${sy(goal)}" y2="${sy(goal)}" class="goal"/><text x="${W - R}" y="${sy(goal) - 6}" text-anchor="end" class="goalT">Goal ${fmt(goal)}</text>` : ''}
    <path d="${d}" style="fill:none;stroke:${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    ${points.map((p, i) => `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="${i === points.length - 1 ? 5.5 : 4}" style="fill:${color};stroke:var(--bg)" stroke-width="2"><title>${fmtD(p.d)}: ${fmt(p.y)} lb</title></circle>`).join('')}
    <text x="${L}" y="${H - 8}">${f(x0)}</text><text x="${W - R}" y="${H - 8}" text-anchor="end">${f(x1)}</text></svg>`;
}

VIEWS.progress = async (lift, tok) => {
  if (!S.me) return needLogin(tok, 'see your progress');
  if (!isPro()) return proGate(tok, 'Progress <span>charts</span>');
  const [hist, goals] = await Promise.all([sb.from('lift_entries').select('*').eq('profile_id', S.me.id).neq('status', 'struck').order('performed_on').then(must), sb.from('goals').select('lift,target_lb').eq('profile_id', S.me.id).then(must)]);
  const lifts = [...new Set(hist.map(e => e.lift))];
  const cur = lift && lifts.includes(lift) ? lift : lifts[0] || 'bench';
  const rows = hist.filter(e => e.lift === cur), goal = num((goals.find(g => g.lift === cur) || {}).target_lb);
  const byDay = new Map(); rows.forEach(e => byDay.set(e.performed_on, Math.max(byDay.get(e.performed_on) || 0, num(e.weight_lb))));
  let run = 0; const pts = [...byDay.entries()].sort().map(([d, w]) => { run = Math.max(run, w); return { x: pd(d).getTime(), y: run, d }; });
  const first = pts[0] ? pts[0].y : 0, prs = rows.filter(e => e.is_pr);
  paint(tok, `<section class="sec"><div><div class="kicker">DSI Pro</div><h2>Progress <span>charts</span></h2></div>
    <div class="chips">${(lifts.length ? lifts : ['bench']).map(l => `<a class="chip" href="/progress/${l}" aria-pressed="${l === cur}">${esc(D.liftName(l))}</a>`).join('')}</div></section>
    <section class="sec"><div class="chartCard"><div class="eyebrow">${esc(D.liftName(cur))} · best over time</div>${pts.length ? lineChart(pts, D.LIFT_BY_DB[cur] ? D.LIFT_BY_DB[cur].c : 'var(--accent)', goal) : `<p class="empty">Log a ${esc(D.liftName(cur).toLowerCase())} to start the chart.</p>`}</div>
    <div class="kpi" style="grid-template-columns:repeat(3,1fr)"><div><b>${run ? fmt(run) : '·'}</b><span>Best</span></div><div><b style="color:var(--up)">${run ? '+' + fmt(run - first) : '·'}</b><span>Gained</span></div><div><b>${prs.length}</b><span>PRs</span></div></div></section>
    <section class="sec"><h2>Every <span>${esc(D.liftName(cur).toLowerCase())}</span></h2><div class="board"><div class="tablewrap"><table><thead><tr><th>Date</th><th class="r">Weight</th><th></th></tr></thead><tbody>${[...rows].reverse().map(e => `<tr><td class="n">${fmtD(e.performed_on)}</td><td class="r n big">${fmt(e.weight_lb)}</td><td>${e.is_pr ? '<span class="pill acc">PR</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Nothing yet.</td></tr>'}</tbody></table></div></div></section>`);
};

const r5 = x => Math.round(x / 5) * 5;
VIEWS.plans = async (_, tok) => {
  if (!S.me) return needLogin(tok, 'see your plans');
  if (!isPro()) return proGate(tok, 'Goal <span>plans</span>');
  const [goals, bests] = await Promise.all([sb.from('goals').select('*').eq('profile_id', S.me.id).then(must), sb.from('lift_bests').select('lift,weight_lb').eq('profile_id', S.me.id).then(must)]);
  const best = Object.fromEntries(bests.map(b => [b.lift, num(b.weight_lb)])), bw = num(S.me.bodyweight) || 200;
  const dated = goals.filter(g => g.target_date && num(g.target_lb) > (best[g.lift] || 0));
  const start = monday(today());
  const plan = g => {
    const b = best[g.lift] || r5(num(g.target_lb) * 0.8), t = num(g.target_lb);
    const weeks = Math.max(1, Math.round((pd(g.target_date) - pd(start)) / (7 * 864e5))), per = (t - b) / weeks;
    const list = Array.from({ length: weeks }, (_, i) => { const wk = i + 1, dl = wk % 4 === 0 && wk !== weeks, top = r5(b + per * wk), use = dl ? r5(top * 0.9) : top; return { wk, from: addDays(start, i * 7), dl, top: use, work: r5(use * 0.85) }; });
    const pace = per / bw * 100 > 1.25 ? ['Aggressive', 'down'] : per / bw * 100 > 0.6 ? ['Ambitious', 'flat'] : ['On track', 'up'];
    return { b, t, weeks, per, list, pace };
  };
  paint(tok, `<section class="sec"><div><div class="kicker">DSI Pro</div><h2>Goal <span>plans</span></h2><p class="secSub">Each week has a heavy single to hit and a working weight for 3 sets of 3. Every fourth week backs off so you recover.</p></div></section>
    <section class="sec">${dated.length ? `<div class="plans">${dated.map(g => { const p = plan(g); return `<article class="planCard" style="--c:${D.liftColor(g.lift)}">
      <div class="bhTop"><h3>${esc(D.liftName(g.lift))}</h3><span class="big">${fmt(p.b)} → ${fmt(p.t)}</span></div>
      <div class="pb"><i style="width:${Math.min(100, p.b / p.t * 100)}%;background:var(--c)"></i></div>
      <p class="sub">${p.weeks} weeks to ${fmtD(g.target_date)} · +${p.per.toFixed(1)} lb a week · <span class="pill ${p.pace[1]}" style="margin:0">${p.pace[0]}</span></p>
      <div class="kpi" style="grid-template-columns:1fr 1fr"><div><b style="color:var(--accent)">${fmt(p.list[0].top)}</b><span>This week top single</span></div><div><b>${fmt(p.list[0].work)}</b><span>Work sets 3x3</span></div></div>
      <details><summary>Every week</summary><table class="wkT"><thead><tr><th>Week</th><th>From</th><th class="r">3x3</th><th class="r">Top</th></tr></thead><tbody>${p.list.map(w => `<tr${w.dl ? ' class="dl"' : ''}><td>${w.wk}${w.dl ? ' · deload' : ''}</td><td>${fmtD(w.from)}</td><td class="r n">${w.work}</td><td class="r n tgt">${w.top}</td></tr>`).join('')}</tbody></table></details></article>`; }).join('')}</div>`
      : '<div class="prEmpty"><b>No dated goals yet</b><p>Set a goal above your best and pick a date on <a href="/me">your account</a>.</p></div>'}</section>`);
};

const RATIOS = [['bench', 'squat', 0.65, 0.8, 'Bench to squat'], ['squat', 'dead', 0.78, 0.9, 'Squat to deadlift'], ['clean', 'squat', 0.62, 0.75, 'Clean to squat']];
VIEWS.coach = async (_, tok) => {
  if (!S.me) return needLogin(tok, 'see your coach');
  if (!isPro()) return proGate(tok, '<span>Coach</span>');
  const [board, last] = await Promise.all([loadBoard(), sb.from('lift_entries').select('performed_on').eq('profile_id', S.me.id).eq('is_pr', true).order('performed_on', { ascending: false }).limit(1).then(must)]);
  const row = board.find(x => x.profile_id === S.me.id);
  if (!row) return paint(tok, '<section class="sec narrow"><div class="prEmpty"><b>Log your four lifts first</b><p>The coach reads your bench, squat, deadlift and clean. <a href="/log">Log a lift</a>.</p></div></section>');
  const have = D.LIFTS.filter(l => row[l.k]), missing = D.LIFTS.filter(l => !row[l.k]);
  const ranked = [...have].sort((a, b) => row.p[a.k] - row.p[b.k]), weak = ranked[0], strong = ranked[ranked.length - 1];
  const days = last[0] ? daysAgo(last[0].performed_on) : null;
  const notes = RATIOS.filter(([a, b]) => row[a] && row[b]).map(([a, b, lo, hi, label]) => {
    const r = row[a] / row[b], na = D.LIFTS.find(l => l.k === a).n, nb = D.LIFTS.find(l => l.k === b).n;
    return { label, r, ok: r >= lo && r <= hi, text: r < lo ? `${na} is lagging your ${nb.toLowerCase()}. Bring it up to about ${fmt(r5(row[b] * lo))} lb.` : r > hi ? `${nb} is lagging your ${na.toLowerCase()}. Push it toward ${fmt(r5(row[a] / hi))} lb.` : 'Balanced. Keep them moving together.' };
  });
  paint(tok, `<section class="sec"><div><div class="kicker">DSI Pro</div><h2><span>Coach</span></h2><p class="secSub">Read from your lifts, your age and your bodyweight.</p></div></section>
    ${weak && strong && weak !== strong ? `<section class="sec band"><div class="focus" style="--c:${weak.c}"><div class="kicker">Your focus</div><h3>${weak.n} is your weak link</h3><p>It sits at the ${D.fmtPct(row.p[weak.k])} percentile for your age and size, while your ${strong.n.toLowerCase()} is at the ${D.fmtPct(row.p[strong.k])}. Raising your weakest lift moves your DSI™ fastest.</p>
      <div class="kpi" style="grid-template-columns:1fr 1fr"><div><b style="color:var(--accent)">${fmt(r5(row[weak.k] * 1.025))}</b><span>Next PR</span></div><div><b>5x3 @ ${fmt(r5(row[weak.k] * 0.8))}</b><span>Train 2x a week</span></div></div></div></section>` : ''}
    ${missing.length ? `<section class="sec"><div class="prEmpty"><b>Missing lifts</b><p>${missing.map(l => l.n).join(', ')} ${missing.length > 1 ? 'are' : 'is'} blank, which scores as zero. <a href="/log">Log ${missing.length > 1 ? 'them' : 'it'}</a> for a true DSI™.</p></div></section>` : ''}
    <section class="sec"><h2>Where you <span>rank</span></h2><div class="bars card" style="padding:18px 24px">${D.LIFTS.map(l => `<div class="brow" style="--c:${l.c}"><span class="ln">${l.n}</span><div class="pb"><i style="width:${row.p[l.k]}%"></i><s></s></div><span class="w">${row[l.k] ? fmt(row[l.k]) + ' lb' : 'n/a'}</span><span class="pc">${D.fmtPct(row.p[l.k])}%</span></div>`).join('')}</div></section>
    ${notes.length ? `<section class="sec"><h2><span>Balance</span></h2><div class="plist">${notes.map(n => `<article class="pcase" style="--c:${n.ok ? 'var(--up)' : 'var(--flat)'}"><div class="bhTop"><h3>${n.label}</h3><span class="big">${n.r.toFixed(2)}</span></div><p>${n.text}</p></article>`).join('')}</div></section>` : ''}
    <section class="sec"><div class="pcase" style="--c:${days !== null && days > 45 ? 'var(--down)' : 'var(--up)'}"><div class="eyebrow">Momentum</div><p>${days === null ? 'No PRs yet. Your first logged lift sets the baseline.' : days > 45 ? `${days} days since your last PR. Drop the weight 10% for two weeks, then build back with triples.` : days === 0 ? 'PR today. Keep the streak going.' : `Last PR ${days} day${days === 1 ? '' : 's'} ago. Keep the streak going.`}</p></div><p class="hint" style="margin-top:10px">For bragging rights, not medical or training advice.</p></section>`);
};

const ALIAS = { 'bench press': 'bench', bp: 'bench', 'back squat': 'squat', dl: 'deadlift', dead: 'deadlift', 'c&j': 'clean_and_jerk', 'clean & jerk': 'clean_and_jerk', ohs: 'overhead_squat', fs: 'front_squat', press: 'strict_press', ohp: 'strict_press' };
const BY_NAME = Object.fromEntries(D.ALL_LIFTS.flatMap(([id, n]) => [[id, id], [n.toLowerCase(), id], [id.replace(/_/g, ' '), id]]));
function parseImport(text) {
  const rows = [], bad = [];
  const pdt = t => { let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`; m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(m[1])}-${pad(m[2])}`; return null; };
  text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(line => {
    const p = line.split(/[,\t;]/).map(x => x.trim());
    if (p.length < 3) { bad.push(line); return; }
    const date = pdt(p[0]), key = p[1].toLowerCase(), lift = BY_NAME[key] || ALIAS[key], w = Number(p[2].replace(/[^0-9.]/g, ''));
    if (!date || !lift || !(w > 0 && w < 1500) || date > today()) { if (!/date/i.test(line)) bad.push(line); return; }
    rows.push({ date, lift, w });
  });
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return { rows, bad };
}
VIEWS.import = async (_, tok) => {
  if (!S.me) return needLogin(tok, 'import history');
  if (!isPro()) return proGate(tok, 'Import <span>history</span>');
  if (!paint(tok, `<section class="sec narrow"><div><div class="kicker">DSI Pro</div><h2>Import <span>history</span></h2><p class="secSub">Paste from a spreadsheet or notes. One lift per line: date, lift, weight.</p></div>
    <pre class="sample">2025-03-14, bench, 225\n3/28/2025, back squat, 315\n2025-04-02, deadlift, 405</pre>
    <textarea id="imp" rows="10" placeholder="Paste here" aria-label="Lifts to import"></textarea><div id="impPrev"></div>
    <div class="row"><button class="btn" id="impGo" disabled>Import</button><span class="hint" id="impMsg"></span></div></section>`)) return;
  const ta = $('#imp'), prev = $('#impPrev'), btn = $('#impGo');
  const refresh = () => { const { rows, bad } = parseImport(ta.value); btn.disabled = !rows.length; btn.textContent = `Import ${rows.length || ''} lifts`;
    prev.innerHTML = ta.value.trim() ? `<p class="sub">${rows.length} ready${bad.length ? ` · ${bad.length} skipped: ${esc(bad.slice(0, 3).join(' | '))}` : ''}</p>${rows.slice(0, 8).map(r => `<div class="impRow"><span>${fmtD(r.date)}</span><b>${esc(D.liftName(r.lift))}</b><span class="n">${fmt(r.w)}</span></div>`).join('')}` : ''; };
  ta.oninput = refresh;
  btn.onclick = async () => {
    const { rows } = parseImport(ta.value); btn.disabled = true; let n = 0;
    for (const r of rows) { const { error } = await sb.from('lift_entries').insert({ profile_id: S.me.id, lift: r.lift, weight_lb: r.w, performed_on: r.date, source: 'import' }); if (error) { $('#impMsg').textContent = `${n} imported. ${error.message}`; return; } n++; $('#impMsg').textContent = `${n} of ${rows.length}…`; }
    ta.value = ''; refresh(); $('#impMsg').textContent = `${n} lifts added to your history.`; toast('Imported');
  };
};

/* ---------- policies: privacy, terms, support ---------- */
const CONTACT = 'dandy@dandystrength.com';
const doc = (kicker, title, updated, body) => `<section class="sec narrow"><div><div class="kicker">${kicker}</div><h2>${title}</h2><p class="secSub">Last updated ${updated}</p></div></section>
  <section class="sec"><div class="doc">${body}</div></section>`;
VIEWS.privacy = async (_, tok) => paint(tok, doc('Your data', 'Privacy <span>policy</span>', 'September 29, 2026', `
  <p>The Dandy Strength Index ("DSI") runs dandystrength.com and the DSI apps for iPhone and Android. This policy explains what we collect and why. Questions: <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>
  <h3>What we collect</h3>
  <ul><li><b>Account:</b> your email address, used only to sign you in.</li>
  <li><b>Profile:</b> board name, birth year, bodyweight, sex and division. These score your lifts fairly against lifters your age and size.</li>
  <li><b>Training:</b> lifts, goals, workout logs, and any videos you choose to attach.</li>
  <li><b>Community:</b> chat messages, protests, reports and blocks.</li></ul>
  <h3>What is public</h3>
  <p>Your board name, age, bodyweight, division, lifts, PRs, goals and lift videos appear on the public leaderboard and your lifter card. Your email is never shown. Chat is visible only to signed in members of that room.</p>
  <h3>What we do not do</h3>
  <p>We do not sell your data, show ads, or use third party tracking or advertising tools.</p>
  <h3>Who processes it</h3>
  <p>Supabase stores the database, logins and videos. Resend sends sign in emails. Cloudflare hosts the website. Apple and Google deliver the apps. Each only handles data needed to provide that service.</p>
  <h3>Your choices</h3>
  <p>Edit your profile any time. Delete your account in the app under Me, Delete account, or email us. Deleting removes your profile, lifts, goals, logs, messages, videos and login. Removal from backups completes within 30 days.</p>
  <h3>Age</h3>
  <p>DSI is for people 13 and older. We do not knowingly collect data from children under 13.</p>
  <h3>Changes</h3>
  <p>If this policy changes we will update the date above and post a note in the app.</p>`));
VIEWS.terms = async (_, tok) => paint(tok, doc('The rules', 'Terms of <span>use</span>', 'September 29, 2026', `
  <p>By using dandystrength.com or the DSI apps you agree to these terms.</p>
  <h3>Community rules</h3>
  <ul><li><b>Log real lifts.</b> Only log weight you actually moved. Fake numbers get struck from the record.</li>
  <li><b>Talk trash, not hate.</b> Roasts are for people who opt in. No harassment, threats, slurs, or attacks on anyone for who they are.</li>
  <li><b>Keep it clean.</b> No sexual content, spam, scams, or anything illegal.</li>
  <li><b>Protest in good faith.</b> The Commissioner rules on every protest.</li>
  <li><b>Report and block.</b> Report content or block anyone from the app. We review reports within 24 hours and remove content and users who break these rules.</li></ul>
  <p>There is zero tolerance for objectionable content or abusive users.</p>
  <h3>Your content</h3>
  <p>You own what you post. You give DSI permission to display it on the boards, your lifter card and in chat so the service works. You can delete it at any time.</p>
  <h3>Not training or medical advice</h3>
  <p>Scores, targets, plans and coach notes are for fun and motivation. They are not medical, health or training advice. Lift safely and within your limits.</p>
  <h3>Accounts</h3>
  <p>We may suspend or remove accounts that break these terms. You can delete your account at any time.</p>
  <h3>DSI Pro</h3>
  <p>Paid features, when offered, are billed through the App Store or Google Play and renew until cancelled in your store account settings.</p>
  <h3>Contact</h3>
  <p><a href="mailto:${CONTACT}">${CONTACT}</a></p>`));
VIEWS.support = async (_, tok) => paint(tok, doc('Help', '<span>Support</span>', 'September 29, 2026', `
  <p>Email <a href="mailto:${CONTACT}">${CONTACT}</a> and we will answer within two business days.</p>
  <h3>Common questions</h3>
  <p><b>How do I sign in?</b> Enter your email and we send a 6 digit code. Use the same email on the website and the apps and your numbers follow you.</p>
  <p><b>My code never arrived.</b> Check spam, wait a minute, then tap Send a new code.</p>
  <p><b>How is my DSI score figured?</b> Each of your bench, squat, deadlift and clean is compared to the median lifter of your age and bodyweight. 500 is the median.</p>
  <p><b>Someone is harassing me.</b> Long press their message to report or block them. Reports are reviewed within 24 hours.</p>
  <p><b>How do I delete my account?</b> In the app go to Me, then Delete account. On the web, email us and we will do it for you.</p>`));

/* ---------- login ---------- */
VIEWS.login = async (_, tok) => {
  if (S.me) { go(S.me.display_name ? '/' : '/join', true); return; }
  if (!paint(tok, `<section class="sec narrow"><div><div class="kicker">Members</div><h2>Sign <span>in</span></h2></div>
    <p class="lede">No password. We email you a sign in link and a 6 digit code. Already on the board? Use the same email and your numbers come with you. New here? <a href="/join">Join with your four lifts</a>.</p>
    <form class="formCard" id="lg"><div class="field"><label for="lg-e">Email</label><input id="lg-e" type="email" autocomplete="email" required></div>
      <div class="row"><button class="btn" type="submit">Email me a link</button><span class="hint" id="lg-msg"></span></div></form>
    <form class="formCard" id="cd" hidden><div class="field"><label for="cd-c">6 digit code</label><input id="cd-c" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" maxlength="10" required></div>
      <div class="row"><button class="btn" type="submit">Sign in</button><span class="hint" id="cd-msg">Or just tap the link in the email.</span></div></form></section>`)) return;
  let email = '';
  $('#lg').onsubmit = async e => {
    e.preventDefault();
    email = $('#lg-e').value.trim().toLowerCase();
    const b = e.target.querySelector('button'), msg = $('#lg-msg'); b.disabled = true; msg.textContent = 'Sending…';
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + '/', shouldCreateUser: true } });
    b.disabled = false;
    if (error) { msg.textContent = error.status === 429 ? 'Too many emails just now. Wait a minute and try again.' : error.message; return; }
    msg.textContent = 'Check your email.';
    $('#cd').hidden = false; $('#cd-c').focus();
  };
  $('#cd').onsubmit = async e => {
    e.preventDefault();
    const msg = $('#cd-msg');
    const { error } = await sb.auth.verifyOtp({ email, token: $('#cd-c').value.trim(), type: 'email' });
    if (error) msg.textContent = error.message;
  };
};



/* ---------- import workouts (staff): gym link, screenshots or text into the week ---------- */
const BASES = [['squat', 'Squat'], ['dead', 'Deadlift'], ['clean', 'Clean'], ['bench', 'Bench']];
const shrink = file => new Promise((res, rej) => {
  const img = new Image(), u = URL.createObjectURL(file);
  img.onload = () => { const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); res(c.toDataURL('image/jpeg', 0.85)); };
  img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Could not read ' + file.name)); };
  img.src = u;
});
const liftRule = l => l.rx && l.rx.length ? `${l.rx[0]}${l.rx[1] && l.rx[1] !== l.rx[0] ? ' / ' + l.rx[1] : ''} lb Rx` : l.f ? `${Math.round(l.f * 100)}% of ${(BASES.find(b => b[0] === l.b) || [, l.b])[1].toLowerCase()}` : 'n/a';
VIEWS.program = async (_, tok) => {
  if (!S.me) return needLogin(tok, 'import workouts');
  if (!isStaff() && !S.myGyms.length) return paint(tok, '<section class="prEmpty"><b>Staff only</b><p>The Founder, Commissioners and gym coaches post workouts.</p><p><a class="btn ghost sm" href="/week">Back to the week</a></p></section>');
  let mode = 'url', shots = [], draft = null;
  const want = new URLSearchParams(location.search).get('gym');
  const targets = [...(isStaff() ? [['', 'The DSI week']] : []), ...S.myGyms.map(g => [g.gym_id, g.gym.name])];
  await loadBoard();
  if (!paint(tok, `<section class="sec"><div class="secHead"><div><div class="kicker">Commissioner tools</div><h2>Import <span>workouts</span></h2>
      <p class="secSub">Point it at your gym's programming page, drop in screenshots of the whiteboard or app, or paste the text. You check the draft, then post it to the week.</p></div><a class="btn ghost sm" href="/week">The week</a></div></section>
    <section class="sec"><div class="tabs" role="tablist">${[['url', 'Link'], ['shots', 'Screenshots'], ['text', 'Paste text']].map(([k, n], i) => `<button class="tab" role="tab" data-mode="${k}" aria-selected="${!i}">${n}</button>`).join('')}</div>
    <form class="formCard" id="pg" style="margin-top:16px">
      <div class="fields">
        <div class="field w2"><label for="pg-to">Post to</label><select id="pg-to">${targets.map(([v, n]) => `<option value="${v}"${v === want ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
        <div class="field w4" data-pane="url"><label for="pg-url">Programming page</label><input id="pg-url" type="url" placeholder="https://yourgym.com/wod" inputmode="url"></div>
        <div class="field w4" data-pane="shots" hidden><label for="pg-img">Screenshots or photos (up to 10)</label><input id="pg-img" type="file" accept="image/*" multiple><div class="shotRow" id="pg-prev"></div></div>
        <div class="field w4" data-pane="text" hidden><label for="pg-txt">Workout text</label><textarea id="pg-txt" rows="8" maxlength="30000" placeholder="Monday&#10;A) Back squat 5x5&#10;B) 3 RFT: 10 cleans 135/95, 15 burpees"></textarea></div>
        <div class="field"><label for="pg-start">First day, if no dates</label><input id="pg-start" type="date" value="${today()}"></div>
      </div>
      <div class="row"><button class="btn" type="submit">Read workouts</button><span class="hint" id="pg-msg">Takes about 20 seconds.</span></div>
    </form></section>
    <section class="sec" id="pg-draft" hidden></section>`)) return;
  const setMode = m => { mode = m; $$('[data-mode]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === m))); $$('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== m); };
  $$('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  $('#pg-img').onchange = async e => {
    const files = [...e.target.files].slice(0, 10), msg = $('#pg-msg');
    msg.textContent = 'Preparing images…';
    try { shots = await Promise.all(files.map(shrink)); msg.textContent = `${shots.length} image${shots.length === 1 ? '' : 's'} ready.`; }
    catch (err) { shots = []; msg.textContent = err.message; }
    $('#pg-prev').innerHTML = shots.map(d => `<img src="${d}" alt="">`).join('');
  };
  $('#pg').onsubmit = async e => {
    e.preventDefault();
    const msg = $('#pg-msg'), b = e.target.querySelector('button[type=submit]'), body = { start: $('#pg-start').value || null };
    if (mode === 'url') { body.url = $('#pg-url').value.trim(); if (!body.url) return (msg.textContent = 'Paste the link first.'); }
    if (mode === 'shots') { body.images = shots; if (!shots.length) return (msg.textContent = 'Add at least one screenshot.'); }
    if (mode === 'text') { body.text = $('#pg-txt').value.trim(); if (!body.text) return (msg.textContent = 'Paste the workout text first.'); }
    b.disabled = true; msg.textContent = 'Reading the workouts…';
    const { data, error } = await sb.functions.invoke('import-workout', { body });
    b.disabled = false;
    let errMsg = error && error.message;
    if (error && error.context && error.context.json) { try { errMsg = (await error.context.json()).error || errMsg; } catch {} }
    if (errMsg || !data || !(data.days || []).length) { msg.textContent = errMsg || 'No workouts found in that.'; return; }
    msg.textContent = `Found ${data.days.length} day${data.days.length === 1 ? '' : 's'}. Check them below.`;
    draft = data; renderDraft();
  };
  async function renderDraft() {
    const days = draft.days.map(d => ({ ...d, lifts: (d.lifts || []).map(l => { const x = { ...l }; if (x.rx && x.rx.length) { if (x.rx.length === 1) x.rx = [x.rx[0], x.rx[0]]; delete x.f; } else delete x.rx; return x; }) }));
    draft.days = days;
    const dates = days.map(d => d.day).filter(Boolean);
    const gymTo = $('#pg-to').value || null;
    let eq = sb.from('workouts').select('day,title').in('day', dates);
    eq = gymTo ? eq.eq('gym_id', gymTo) : eq.is('gym_id', null);
    const existing = dates.length ? must(await eq) : [];
    const had = Object.fromEntries(existing.map(x => [x.day, x.title]));
    const host = $('#pg-draft'); host.hidden = false;
    host.innerHTML = `<div class="secHead"><div><div class="kicker">Draft${draft.source ? ' · ' + esc(draft.source) : ''}</div><h2>Check and <span>post</span></h2>${draft.notes ? `<p class="secSub">${esc(draft.notes)}</p>` : ''}</div></div>
      <div class="plist">${days.map((d, i) => `<article class="pcase impDay" style="--c:var(--accent)" data-i="${i}">
        <div class="impHead"><label class="check"><input type="checkbox" data-inc checked><span class="sub">Post</span></label>
          <input type="date" data-day value="${esc(d.day || '')}" aria-label="Date"><input data-title maxlength="80" value="${esc(d.title || '')}" aria-label="Title"><input data-bench maxlength="40" value="${esc(d.benchmark || '')}" placeholder="Benchmark name (optional)" aria-label="Benchmark name"></div>
        ${had[d.day] ? `<p class="hint" style="color:var(--flat)">Replaces "${esc(had[d.day])}" on ${esc(fmtD(d.day))}.</p>` : ''}
        ${d.rest_note ? `<p class="rest">${esc(d.rest_note)}</p>` : ''}
        ${(d.sections || []).map((s, k) => `<div class="field"><label>${esc(s.name)}</label><textarea rows="${Math.min(6, Math.max(2, Math.ceil(s.text.length / 90)))}" data-sec="${k}">${esc(s.text)}</textarea></div>`).join('')}
        ${d.lifts.length ? `<div class="tablewrap"><table class="wkT"><thead><tr><th>Lift</th><th>Scheme</th><th>Target rule</th><th class="r">Dandy</th></tr></thead><tbody>${d.lifts.map(l => { const t = D.target(l, boardRow(S.me.id) || {}); return `<tr><td><b>${esc(l.n)}</b>${l.max ? ' <span class="pill acc">Max</span>' : ''}<div class="sub">${esc(l.why || '')}</div></td><td class="n">${esc(l.sch)}</td><td class="n">${esc(liftRule(l))}</td><td class="r tgt">${t ? t + ' lb' : 'n/a'}</td></tr>`; }).join('')}</tbody></table></div>` : ''}
        ${d.score_label ? `<p class="sub">Scored by ${esc(d.score_label)}${d.pr_lift ? ' · counts as a ' + esc(D.liftName(d.pr_lift)) + ' PR' : ''}</p>` : ''}
      </article>`).join('')}</div>
      <div class="row" style="margin-top:16px"><button class="btn" id="pg-post">Post to the week</button><span class="hint" id="pg-pmsg">Targets use each lifter's own PRs. The last column shows yours.</span></div>`;
    $('#pg-post').onclick = async () => {
      const rows = $$('.impDay', host).filter(a => $('[data-inc]', a).checked).map(a => {
        const d = days[+a.dataset.i];
        return { day: $('[data-day]', a).value, title: $('[data-title]', a).value.trim() || d.title, source: draft.source || null,
          sections: (d.sections || []).map((s, k) => ({ name: s.name, text: $(`[data-sec="${k}"]`, a).value.trim() })).filter(s => s.text),
          lifts: d.lifts, score_label: d.score_label || null, score_type: ['time', 'text'].includes(d.score_type) ? d.score_type : (d.score_label ? 'text' : null),
          rest_note: d.rest_note || null, pr_lift: ['bench', 'squat', 'deadlift', 'clean'].includes(d.pr_lift) ? d.pr_lift : null,
          benchmark: $('[data-bench]', a).value.trim() || null, gym_id: $('#pg-to').value || null };
      });
      const pm = $('#pg-pmsg');
      if (!rows.length) return (pm.textContent = 'Tick at least one day.');
      if (rows.some(r => !/^\d{4}-\d{2}-\d{2}$/.test(r.day))) return (pm.textContent = 'Every day needs a date.');
      if (new Set(rows.map(r => r.day)).size !== rows.length) return (pm.textContent = 'Two days share a date. Fix one.');
      pm.textContent = 'Posting…';
      const { error } = await sb.from('workouts').upsert(rows, { onConflict: 'gym_id,day' });
      if (error) { pm.textContent = error.message; return; }
      toast(`Posted ${rows.length} day${rows.length === 1 ? '' : 's'}`);
      go('/week/' + rows.map(r => r.day).sort()[0] + (rows[0].gym_id || !(S.me && S.me.gym_id) ? '' : '?src=dsi'));
    };
  }
};

/* ---------- join: four lifts, your DSI, then save it with an email code ---------- */
const JOIN_KEY = 'dsi.join';
const readJoin = () => { try { return JSON.parse(localStorage.getItem(JOIN_KEY) || 'null'); } catch { return null; } };
const saveJoin = v => { try { v ? localStorage.setItem(JOIN_KEY, JSON.stringify(v)) : localStorage.removeItem(JOIN_KEY); } catch {} };
// Applies a pending signup to a brand new profile. Returning members keep their profile and numbers.
async function finishJoin() {
  const j = readJoin();
  if (!j || !S.me) return null;
  if (S.me.display_name) { saveJoin(null); return null; }
  const { data, error } = await sb.from('profiles').update({ display_name: j.name, birth_year: j.by, bodyweight: j.bw, sex: j.sex, division: j.div }).eq('id', S.me.id).select().single();
  if (error) return { ok: false, error: error.code === '23505' ? 'That board name is taken. Pick another to finish joining.' : error.message };
  S.me = data;
  const rows = D.LIFTS.filter(l => +j[l.k] > 0).map(l => ({ profile_id: S.me.id, lift: l.db, weight_lb: +j[l.k], performed_on: today(), source: 'manual', note: 'Signup' }));
  if (rows.length) { const r = await sb.from('lift_entries').insert(rows); if (r.error) console.error(r.error); }
  saveJoin(null);
  return { ok: true };
}
VIEWS.join = async (_, tok) => {
  if (S.me && S.me.display_name) { go('/me', true); return; }
  const yr = new Date().getFullYear(), j = readJoin() || {}, signedIn = !!S.me;
  const v = k => esc(j[k] ?? '');
  const sel = (id, opts, cur) => `<select id="${id}">${opts.map(o => `<option value="${o[0]}"${cur === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}</select>`;
  if (!paint(tok, `<section class="sec"><div class="secHead"><div><div class="kicker">Free to join</div><h2>Where do <span>you</span> rank?</h2>
      <p class="secSub">Your four lifts against lifters your age and size. See your DSI™ now, then save your spot with your email.</p></div></div>
    <div class="joinGrid">
    <form class="formCard" id="jf" novalidate>
      <h3 class="formH">1 · You</h3>
      <div class="fields">
        <div class="field w2"><label for="jf-n">Board name</label><input id="jf-n" maxlength="24" autocomplete="nickname" value="${v('name')}" placeholder="Dandy" required></div>
        <div class="field"><label for="jf-by">Birth year</label><input id="jf-by" type="number" inputmode="numeric" min="${yr - 100}" max="${yr - 13}" value="${v('by')}" placeholder="1985" required></div>
        <div class="field"><label for="jf-bw">Bodyweight (lb)</label><input id="jf-bw" type="number" inputmode="decimal" min="80" max="450" step="0.1" value="${v('bw')}" placeholder="200" required></div>
        <div class="field w2"><label for="jf-sex">Sex</label>${sel('jf-sex', [['male', 'Male'], ['female', 'Female'], ['unspecified', 'Prefer not to say']], j.sex || 'male')}</div>
        <div class="field w2"><label for="jf-div">Division</label>${sel('jf-div', [['men', 'Men'], ['women', 'Women'], ['open', 'Open']], j.div || 'men')}</div>
      </div>
      <h3 class="formH">2 · Your four lifts <span class="sub">heaviest single, in pounds</span></h3>
      <div class="fields">${D.LIFTS.map(l => `<div class="field"><label for="jf-${l.k}" style="color:${l.c}">${l.n}</label><input id="jf-${l.k}" type="number" inputmode="numeric" min="0" max="1499" step="any" value="${v(l.k)}" placeholder="lb"></div>`).join('')}</div>
      <p class="hint">Leave a lift blank if you don't do it. It scores as zero until you log it.</p>
      <p class="joinMini" id="jmini" aria-hidden="true"></p>
      <h3 class="formH">3 · Save your spot</h3>
      ${signedIn ? `<p class="hint">Signed in as ${esc(S.session.user.email)}.</p>
      <div class="row"><button class="btn" type="submit">Join the board</button><span class="hint" id="jf-msg"></span></div>`
      : `<div class="fields"><div class="field w4"><label for="jf-e">Email</label><input id="jf-e" type="email" autocomplete="email" value="${v('email')}" required></div></div>
      <p class="hint">No password. We email you a 6 digit code. By joining you agree to the <a href="/terms">terms</a> and <a href="/rules">community rules</a>.</p>
      <div class="row"><button class="btn" type="submit">Email me my code</button><span class="hint" id="jf-msg"></span></div>`}
    </form>
    <form class="formCard" id="jc" hidden><h3 class="formH">Enter your code</h3><div class="field"><label for="jc-c">6 digit code</label><input id="jc-c" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" maxlength="10" required></div>
      <div class="row"><button class="btn" type="submit">Join the board</button><span class="hint" id="jc-msg">Or tap the link in the email.</span></div></form>
    <aside class="card joinCard" id="jp" aria-live="polite"></aside>
    </div></section>`)) return;
  const f = $('#jf');
  const readForm = () => ({ name: $('#jf-n').value.trim(), by: +$('#jf-by').value || 0, bw: +$('#jf-bw').value || 0, sex: $('#jf-sex').value, div: $('#jf-div').value, email: $('#jf-e') ? $('#jf-e').value.trim().toLowerCase() : '', ...Object.fromEntries(D.LIFTS.map(l => [l.k, +$('#jf-' + l.k).value || 0])) });
  const preview = () => {
    const x = readForm(), age = x.by ? yr - x.by : 0, ready = age >= 13 && age <= 100 && x.bw >= 80 && x.bw <= 450, any = D.LIFTS.some(l => x[l.k] > 0);
    const mini = $('#jmini');
    if (!ready || !any) { mini.hidden = true; $('#jp').innerHTML = `<div class="eyebrow">Your DSI™</div><div class="joinScore">?</div><p class="sub">${ready ? 'Enter at least one lift.' : 'Enter your birth year and bodyweight, then your lifts.'} Your score updates as you type.</p>`; return; }
    const r = { bw: x.bw, age, bench: x.bench, squat: x.squat, dead: x.dead, clean: x.clean }, p = D.pcts(r), sc = D.score(r), vd = D.verdict(sc), t = D.total(r);
    mini.hidden = false; mini.innerHTML = `<b>${sc}</b>Your DSI™ · ${esc(vd[1])}. Full breakdown below.`;
    $('#jp').innerHTML = `<div class="eyebrow">Your DSI™</div><div class="joinScore">${sc}</div><div class="kpi" style="margin:4px 0 10px"><div><b>${fmt(t)}</b><span>Total lb</span></div><div><b>${age}</b><span>Age</span></div><div><b>${fmt(x.bw)}</b><span>Bodyweight</span></div></div>
      <p><b style="color:var(--accent)">${esc(vd[1])}.</b> ${esc(vd[3])}</p>
      <div class="bars">${D.LIFTS.map(l => `<div class="brow" style="--c:${l.c}"><span class="ln">${l.n}</span><div class="pb"><i style="width:${p[l.k]}%"></i><s></s></div><span class="w">${x[l.k] ? fmt(x[l.k]) : 'n/a'}</span><span class="pc">${D.fmtPct(p[l.k])}%</span></div>`).join('')}</div>
      <p class="sub">Percentile against lifters your age and bodyweight. Save it to put it on the board.</p>`;
  };
  $('#jf-sex').onchange = () => { if ($('#jf-sex').value === 'female' && $('#jf-div').value === 'men') $('#jf-div').value = 'women'; preview(); };
  f.addEventListener('input', preview); preview();
  const check = x => {
    const age = yr - x.by;
    if (x.name.length < 2) return ['jf-n', 'Pick a board name, at least 2 characters.'];
    if (!(age >= 13 && age <= 100)) return ['jf-by', 'Enter a real birth year. DSI is for lifters 13 and up.'];
    if (!(x.bw >= 80 && x.bw <= 450)) return ['jf-bw', 'Bodyweight should be between 80 and 450 lb.'];
    if (!D.LIFTS.some(l => x[l.k] > 0)) return ['jf-bench', 'Enter at least one of your four lifts.'];
    if (D.LIFTS.some(l => x[l.k] > 1499)) return ['jf-bench', 'Check your numbers. 1,499 lb is the max.'];
    if (!signedIn && !/^\S+@\S+\.\S+$/.test(x.email)) return ['jf-e', 'Enter your email so we can send your code.'];
    return null;
  };
  f.onsubmit = async e => {
    e.preventDefault();
    const x = readForm(), bad = check(x), msg = $('#jf-msg'), b = f.querySelector('button[type=submit]');
    if (bad) { msg.textContent = bad[1]; $('#' + bad[0]).focus(); return; }
    const { data: taken } = await sb.from('profiles').select('id').ilike('display_name', x.name.replace(/[%_\\]/g, '\\$&')).limit(1);
    if (taken && taken.length) { msg.textContent = 'That board name is taken. Try another.'; $('#jf-n').focus(); return; }
    saveJoin(x);
    b.disabled = true;
    if (signedIn) {
      msg.textContent = 'Saving…';
      const r = await finishJoin(); b.disabled = false;
      if (!r || !r.ok) { msg.textContent = (r && r.error) || 'Could not save. Try again.'; return; }
      updateChrome(''); toast('You\'re on the board, ' + S.me.display_name); go('/u/' + S.me.id); return;
    }
    msg.textContent = 'Sending…';
    const { error } = await sb.auth.signInWithOtp({ email: x.email, options: { emailRedirectTo: location.origin + '/join', shouldCreateUser: true } });
    b.disabled = false;
    if (error) { msg.textContent = error.status === 429 ? 'Too many emails just now. Wait a minute and try again.' : error.message; return; }
    msg.textContent = 'Code sent to ' + x.email + '.';
    $('#jc').hidden = false; $('#jc-c').focus();
  };
  $('#jc').onsubmit = async e => {
    e.preventDefault();
    const x = readJoin() || readForm(), m = $('#jc-msg');
    m.textContent = 'Checking…';
    const { error } = await sb.auth.verifyOtp({ email: x.email, token: $('#jc-c').value.trim(), type: 'email' });
    if (error) m.textContent = 'That code did not work. Check it or send a new one.';
  };
};

/* ---------- compete and grow pages (extra.js) ---------- */
const CTX = { sb, D, S, VIEWS, $, $$, esc, num, fmt, today, pd, fmtD, addDays, monday, toast, must, paint, needLogin, go,
  loadBoard, loadPeople, nameOf, boardRow, isPro, isStaff, PRO, bindActions, bindVideo, route, videoUrl };
installExtra(CTX);
installGym(CTX);

/* ---------- boot ---------- */
async function boot() {
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  if (/^#(access_token|error)/.test(location.hash)) {
    if (/error_description=/.test(location.hash)) toast(decodeURIComponent(location.hash.match(/error_description=([^&]*)/)[1]).replace(/\+/g, ' '));
    history.replaceState(null, '', '/');
  } else if (location.hash.startsWith('#/')) {
    // Old #/ links keep working: dandystrength.com/#/prs becomes dandystrength.com/prs
    history.replaceState(null, '', location.hash.slice(1) || '/');
  }
  await loadMe();
  if (S.me && !S.me.display_name) { const j = await finishJoin(); if (j && j.ok) history.replaceState(null, '', '/u/' + S.me.id); }
  sb.auth.onAuthStateChange((ev, session) => {
    const same = (S.session && S.session.user && S.session.user.id) === (session && session.user && session.user.id);
    // Supabase repeats SIGNED_IN when the tab regains focus. Same user means nothing changed, so keep the page (and any draft) as is.
    if (ev === 'INITIAL_SESSION' || ev === 'TOKEN_REFRESHED' || (same && ev !== 'SIGNED_OUT' && ev !== 'USER_UPDATED')) { S.session = session; return; }
    S.session = session;
    setTimeout(async () => {
      await loadMe();
      if (ev === 'SIGNED_IN') {
        const had = S.me && S.me.display_name, j = await finishJoin();
        if (j && j.ok) { history.replaceState(null, '', '/u/' + S.me.id); toast('You\'re on the board, ' + S.me.display_name); }
        else if (/^#access_token/.test(location.hash) || ['/', '/login', '/join'].includes(location.pathname)) history.replaceState(null, '', S.me && !S.me.display_name ? '/join' : '/');
        if (!j || !j.ok) toast(had ? 'Welcome back, ' + S.me.display_name : (j && j.error) || 'Signed in');
      }
      route();
    }, 0);
  });
  window.addEventListener('popstate', route);
  route();
}
boot();
