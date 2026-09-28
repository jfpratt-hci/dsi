import { sb } from './sb.js';
import * as D from './dsi.js';

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
const S = { session: null, me: null, board: [], people: new Map(), channels: [], bf: { sort: 'dsi', div: 'all', age: 'all' }, tok: 0 };
const isStaff = () => S.me && ['admin', 'commissioner'].includes(S.me.role);

async function loadMe() {
  S.me = null;
  if (!S.session) return;
  const { data } = await sb.from('profiles').select('*').eq('user_id', S.session.user.id).maybeSingle();
  S.me = data || null;
}
async function loadBoard() {
  const rows = must(await sb.from('board').select('*'));
  S.board = rows.map(r => {
    const x = { ...r, bw: num(r.bw), age: num(r.age), bench: num(r.bench), squat: num(r.squat), dead: num(r.dead), clean: num(r.clean) };
    x.score = D.score(x); x.total = D.total(x); x.p = D.pcts(x);
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

function updateChrome(r) {
  $$('#nav a').forEach(a => { if (a.dataset.r === r) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const acct = $('#acct');
  if (S.me) { acct.textContent = S.me.display_name || 'Set up'; acct.href = '#/me'; acct.classList.add('in'); }
  else { acct.textContent = 'Sign in'; acct.href = '#/login'; acct.classList.remove('in'); }
}

/* ---------- router ---------- */
const VIEWS = {};
async function route() {
  const h = location.hash;
  if (/^#(access_token|error)/.test(h)) return;
  const parts = h.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  let r = parts[0] || '';
  for (const ch of S.channels) sb.removeChannel(ch);
  S.channels = [];
  if (S.me && !S.me.display_name && !['me', 'login'].includes(r)) { location.hash = '#/me'; return; }
  if (!VIEWS[r]) r = '';
  updateChrome(r === 'u' ? '' : r);
  const tok = ++S.tok;
  main.innerHTML = '<p class="empty">Loading…</p>';
  try {
    await VIEWS[r](parts[1], tok);
  } catch (e) {
    console.error(e);
    if (tok === S.tok) main.innerHTML = `<div class="prEmpty"><b>That didn't load</b><p class="err">${esc(e.message || e)}</p><p><a class="btn ghost sm" href="#/">Back to the boards</a></p></div>`;
  }
  if (tok === S.tok && document.activeElement === document.body) main.focus({ preventScroll: true });
}
const paint = (tok, html) => { if (tok !== S.tok) return false; main.innerHTML = html; window.scrollTo(0, 0); return true; };
function needLogin(tok, what) {
  return paint(tok, `<section class="prEmpty"><b>Sign in to ${esc(what)}</b><p>Members log lifts, chat and file protests. Boards and PRs stay public.</p><p><a class="btn" href="#/login">Sign in</a></p></section>`);
}

/* ---------- shared actions ---------- */
async function openThread(kind, ref, title) {
  if (!S.me) { location.hash = '#/login'; return; }
  const { data, error } = await sb.rpc('room_for', { p_kind: kind, p_ref: ref, p_title: title });
  if (error) { toast(error.message); return; }
  location.hash = '#/chat/' + data;
}
function protestForm(host, type, id, label, done) {
  if (!S.me) { location.hash = '#/login'; return; }
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
  const [board, prs] = await Promise.all([loadBoard(), sb.from('pr_feed').select('*').gte('performed_on', monday(today())).limit(60)]);
  const weekPRs = must(prs);
  const top = [...board].sort((a, b) => b.score - a.score)[0];
  const heavy = [...board].sort((a, b) => b.total - a.total)[0];
  const html = `
  <section class="hero">
    <div>
      <img class="logo" src="/assets/logo.svg" alt="Dandy Strength Index" width="760" height="240">
      <h1 class="vh">Dandy Strength Index™</h1>
      <p class="tag">Your bench, squat, deadlift and clean scored against lifters your age and bodyweight. 500 is the median. Every PR moves the board.</p>
      <div class="cta">${S.me ? '<a class="btn" href="#/log">Log a lift</a><a class="btn ghost" href="#/week">This week</a>' : '<a class="btn" href="#/login">Join the index</a><a class="btn ghost" href="#/week">This week</a>'}</div>
    </div>
    <div class="kpi" aria-label="Index stats">
      <div><b>${board.length}</b><span>Lifters</span></div>
      <div><b>${weekPRs.length}</b><span>PRs this week</span></div>
      <div><b>${top ? top.score : '0'}</b><span>Top DSI™</span></div>
      <div><b>${heavy ? fmt(heavy.total) : 0}</b><span>Top total</span></div>
    </div>
  </section>
  <section class="sec" aria-labelledby="wkprs">
    <div class="secHead"><h2 id="wkprs">PRs this <span>week</span></h2><a class="chip" href="#/prs">Full PR wall</a></div>
    ${weekPRs.length ? `<div class="prGrid">${weekPRs.slice(0, 8).map(prCard).join('')}</div>` : `<div class="prEmpty"><b>No PRs yet this week</b><p>Somebody has to go first. <a href="#/log">Log a lift</a>.</p></div>`}
  </section>
  <section class="sec" aria-labelledby="kings">
    <div class="secHead"><h2 id="kings">Lift <span>kings</span></h2></div>
    <div class="kings">${D.LIFTS.map(l => { const k = [...board].sort((a, b) => b[l.k] - a[l.k])[0]; return k && k[l.k] ? `<button class="king${S.bf.sort === l.k ? ' on' : ''}" style="--c:${l.c}" data-sort="${l.k}"><span class="eyebrow">${l.n}</span><b>${esc(k.name)}</b><span class="kv">${fmt(k[l.k])} lb</span>${isNew(k[l.k + '_date']) ? `<span class="prDateNew">PR ${fmtD(k[l.k + '_date'])}</span>` : ''}</button>` : ''; }).join('')}</div>
  </section>
  <section class="sec" aria-labelledby="lbh"><div class="board" id="lb"></div></section>`;
  if (!paint(tok, html)) return;
  $$('.king').forEach(b => b.onclick = () => { S.bf.sort = b.dataset.sort; renderBoard(); $('#lb').scrollIntoView({ behavior: 'smooth' }); $$('.king').forEach(k => k.classList.toggle('on', k.dataset.sort === S.bf.sort)); });
  bindActions(main);
  renderBoard();
};

function prCard(p) {
  const l = D.LIFT_BY_DB[p.lift] || { c: 'var(--muted)', n: D.liftName(p.lift) };
  const hot = isNew(p.performed_on), gain = p.prev_best ? num(p.weight_lb) - num(p.prev_best) : 0;
  const mine = S.me && S.me.id === p.profile_id;
  return `<article class="prCard${hot ? ' hot' : ''}${p.status === 'protested' ? ' protested' : ''}" style="--c:${l.c}" data-host>
    <div class="prTop"><span class="prTag">${hot ? 'New PR' : 'PR'}</span><span class="prDate">${fmtD(p.performed_on)}</span></div>
    <a class="prName" href="#/u/${p.profile_id}">${esc(p.name)}</a>
    <div class="prLift">${esc(l.n)} <b>${fmt(p.weight_lb)} lb</b>${p.status === 'protested' ? '<span class="pill flat">Under protest</span>' : ''}</div>
    ${gain ? `<div class="prGain">+${fmt(gain)} lb</div><div class="sub">was ${fmt(p.prev_best)}</div>` : ''}
    <div class="prAct"><button class="btn ghost sm" data-thread="pr" data-ref="${p.id}" data-title="${esc(p.name + ' ' + l.n + ' ' + num(p.weight_lb))}">Talk</button>${!mine && p.status === 'ok' ? `<button class="btn ghost sm" data-protest="lift_entry" data-ref="${p.id}" data-title="${esc(p.name + ' ' + l.n + ' ' + num(p.weight_lb) + ' lb')}">Protest</button>` : ''}</div>
  </article>`;
}

function renderBoard() {
  const el = $('#lb'); if (!el) return;
  const f = S.bf;
  const SORTS = [['dsi', 'Overall'], ['total', 'Total'], ...D.LIFTS.map(l => [l.k, l.n])];
  let rows = S.board.filter(r => f.div === 'all' || r.division === f.div)
    .filter(r => f.age === 'all' || (f.age === 'u40' ? r.age && r.age < 40 : f.age === '40s' ? r.age >= 40 && r.age < 50 : r.age >= 50));
  const key = f.sort === 'dsi' ? 'score' : f.sort;
  rows = rows.filter(r => r[key]).sort((a, b) => b[key] - a[key] || b.score - a.score);
  const title = SORTS.find(s => s[0] === f.sort)[1];
  const divName = { all: '', men: "Men's ", women: "Women's ", open: 'Open ' }[f.div];
  const chip = (grp, v, t) => `<button class="chip" data-${grp}="${v}" aria-pressed="${f[grp] === v}">${t}</button>`;
  el.innerHTML = `<div class="boardHead">
      <div class="bhTop"><h3 id="lbh">${esc(divName)}${esc(title)} <span>board</span></h3><p>${rows.length} ranked · 500 is the median for your age and size</p></div>
      <div class="tabs" role="tablist">${SORTS.map(s => `<button class="tab" role="tab" data-sort="${s[0]}" aria-selected="${f.sort === s[0]}">${s[1]}</button>`).join('')}</div>
      <div class="row"><div class="chips" aria-label="Division">${chip('div', 'all', 'All')}${chip('div', 'men', 'Men')}${chip('div', 'women', 'Women')}${chip('div', 'open', 'Open')}</div>
      <div class="chips" aria-label="Age">${chip('age', 'all', 'All ages')}${chip('age', 'u40', 'Under 40')}${chip('age', '40s', '40s')}${chip('age', '50p', '50+')}</div></div>
    </div>
    ${rows.length ? `<div class="tablewrap"><table class="lb"><thead><tr><th>#</th><th>Lifter</th><th class="r${f.sort === 'dsi' ? ' hl' : ''}">DSI™</th><th class="r${f.sort === 'total' ? ' hl' : ''}">Total</th>${D.LIFTS.map(l => `<th class="r c-${l.k}">${l.n}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((r, i) => {
      const club = D.clubOf(r.total);
      return `<tr class="${S.me && S.me.id === r.profile_id ? 'me' : ''}"><td class="pos">${i + 1}</td>
      <td><div class="who"><a href="#/u/${r.profile_id}">${esc(r.name)}</a>${r.roast_opt_in ? '<i class="fire" title="Opted in to roasts">🔥</i>' : ''}${r.has_protest ? '<span class="pill flat">Protest</span>' : ''}</div><div class="sub">${r.age ? 'Age ' + r.age + ' · ' : ''}${r.bw ? r.bw + ' lb · ' : ''}${esc(r.division)}</div></td>
      <td class="r n big">${r.score}</td><td class="r n">${fmt(r.total)}${club ? `<span class="club">${fmt(club)}</span>` : ''}</td>
      ${D.LIFTS.map(l => r[l.k] ? `<td class="r n">${fmt(r[l.k])}<div class="sub">${isNew(r[l.k + '_date']) ? `<span class="prDateNew">PR ${fmtD(r[l.k + '_date'])}</span>` : r.p[l.k] + 'th pct'}</div></td>` : '<td class="r sub">n/a</td>').join('')}
      </tr>`;
    }).join('')}</tbody></table></div>`
      : `<div class="empty">${f.div === 'women' ? 'No women on the board yet. The women\'s division is open, bring your crew.' : 'Nobody matches this filter yet.'}</div>`}`;
  $$('[data-sort]', el).forEach(b => b.onclick = () => { f.sort = b.dataset.sort; renderBoard(); $$('.king').forEach(k => k.classList.toggle('on', k.dataset.sort === f.sort)); });
  $$('[data-div]', el).forEach(b => b.onclick = () => { f.div = b.dataset.div; renderBoard(); });
  $$('[data-age]', el).forEach(b => b.onclick = () => { f.age = b.dataset.age; renderBoard(); });
}

/* ---------- PR wall ---------- */
VIEWS.prs = async (_, tok) => {
  const feed = must(await sb.from('pr_feed').select('*').limit(200));
  const wk = monday(today());
  const thisWeek = feed.filter(p => p.performed_on >= wk), earlier = feed.filter(p => p.performed_on < wk);
  if (!paint(tok, `<section class="sec"><div class="secHead"><div><div class="eyebrow">Every PR, dated</div><h2>PR <span>wall</span></h2></div>${S.me ? '<a class="btn" href="#/log">Log a lift</a>' : ''}</div>
    <p class="lede">A PR counts when it beats your old best. Think one is fishy? Protest it and the Commissioner rules.</p></section>
    <section class="sec"><h2>This <span>week</span></h2>${thisWeek.length ? `<div class="prGrid">${thisWeek.map(prCard).join('')}</div>` : '<div class="prEmpty"><b>Quiet week so far</b><p>First PR of the week gets the spotlight.</p></div>'}</section>
    <section class="sec"><h2>Earlier</h2>${earlier.length ? `<div class="prGrid">${earlier.map(prCard).join('')}</div>` : '<p class="empty">Nothing older yet.</p>'}</section>`)) return;
  bindActions(main, () => route());
};

/* ---------- lifter page ---------- */
VIEWS.u = async (id, tok) => {
  if (!id) { location.hash = '#/'; return; }
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
  const mine = S.me && S.me.id === id, club = D.clubOf(r.total);
  const role = p.role === 'commissioner' ? '<span class="pill acc">Commissioner</span>' : p.role === 'admin' ? '<span class="pill acc">Founder</span>' : '';
  if (!paint(tok, `<article class="card">
    <div class="cardHead"><div><div class="eyebrow">${esc(p.division)} division</div><div class="nm">${esc(p.display_name)}${p.roast_opt_in ? ' <span title="Opted in to roasts">🔥</span>' : ''}</div>
      <div class="meta">${r.age ? 'Age ' + r.age + ' · ' : ''}${r.bw ? r.bw + ' lb · ' : ''}${fmt(r.total)} lb total${club ? ' · ' + fmt(club) + ' club' : ''} ${role}</div></div>
      <div class="dsi"><div class="eyebrow">DSI™</div><b>${r.score}</b></div></div>
    <div class="verdict"><b>${esc(v[1])}</b><p>${esc(p.roast_opt_in ? v[2] : v[3])}</p></div>
    <div class="bars">${D.LIFTS.map(l => `<div class="brow" style="--c:${l.c}"><span class="ln">${l.n}</span><div class="pb" title="${r.p[l.k]}th percentile"><i style="width:${r.p[l.k]}%"></i><s></s></div><span class="w">${r[l.k] ? fmt(r[l.k]) + ' lb' : 'n/a'}</span><span class="pc">${r.p[l.k] || 0}%</span></div>`).join('')}
      <p class="hint">The line is the median for ${r.age ? 'age ' + r.age : 'your age'} at ${r.bw || 185} lb. Percent is where you rank.</p></div>
  </article>
  ${Object.keys(gl).length ? `<section class="sec"><h2>Goals</h2><div class="goalRows">${D.LIFTS.filter(l => gl[l.db]).map(l => { const now = r[l.k] || 0, g = gl[l.db], pctg = Math.min(100, Math.round(now / g * 100)); return `<div class="g" style="--c:${l.c}"><h4>${l.n}</h4><div class="big">${fmt(g)} lb</div><div class="pb"><i style="width:${pctg}%"></i></div><div class="now">${now ? fmt(now) + ' now · ' + (g > now ? fmt(g - now) + ' to go' : 'done') : 'no lift yet'}</div></div>`; }).join('')}</div></section>` : ''}
  <section class="sec"><h2>Lift <span>history</span></h2><div class="board"><div class="tablewrap"><table><thead><tr><th>Date</th><th>Lift</th><th class="r">Weight</th><th>Status</th><th></th></tr></thead><tbody>
  ${must(hist).map(e => `<tr class="${e.status === 'struck' ? 'struck' : ''}"><td class="n">${fmtD(e.performed_on)}</td><td>${esc(D.liftName(e.lift))}${e.note ? `<div class="sub">${esc(e.note)}</div>` : ''}</td><td class="r n big">${fmt(e.weight_lb)}</td>
    <td>${e.is_pr ? '<span class="pill acc">PR</span>' : ''}${e.status === 'protested' ? '<span class="pill flat">Under protest</span>' : e.status === 'struck' ? '<span class="pill down">Struck</span>' : ''}${e.source === 'workout' ? '<span class="sub"> from workout</span>' : ''}</td>
    <td class="r" data-host>${!mine && e.status === 'ok' && S.me ? `<button class="btn ghost sm" data-protest="lift_entry" data-ref="${e.id}" data-title="${esc(p.display_name + ' ' + D.liftName(e.lift) + ' ' + num(e.weight_lb) + ' lb')}">Protest</button>` : ''}${mine && e.status === 'ok' ? `<button class="btn ghost sm" data-del="${e.id}">Delete</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No lifts yet.</td></tr>'}
  </tbody></table></div></div></section>`)) return;
  bindActions(main, () => route());
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
  const opts = [...D.LIFTS.map(l => [l.db, l.n + (r[l.k] ? ` (best ${fmt(r[l.k])})` : '')]), ...Object.entries(D.OTHER_LIFTS)];
  if (!paint(tok, `<section class="sec"><div><div class="eyebrow">New max</div><h2>Log a <span>lift</span></h2></div>
    <p class="lede">Log a heavy single. Beat your old best and it lands on the PR wall with today's date.</p>
    <form class="formCard" id="logF">
      <div class="fields">
        <div class="field w2"><label for="lf-lift">Lift</label><select id="lf-lift" required>${opts.map(o => `<option value="${o[0]}">${esc(o[1])}</option>`).join('')}</select></div>
        <div class="field"><label for="lf-w">Weight (lb)</label><input id="lf-w" type="number" inputmode="decimal" min="1" max="1499" step="0.5" required></div>
        <div class="field"><label for="lf-d">Date</label><input id="lf-d" type="date" value="${today()}" max="${today()}" required></div>
        <div class="field w4"><label for="lf-n">Note (optional)</label><input id="lf-n" type="text" maxlength="280" placeholder="Belt, no belt, witnesses, video link…"></div>
      </div>
      <div class="row"><button class="btn" type="submit">Log it</button><span class="hint" id="lf-msg"></span></div>
    </form></section>`)) return;
  const f = $('#logF');
  f.onsubmit = async e => {
    e.preventDefault();
    const b = f.querySelector('button'), msg = $('#lf-msg'); b.disabled = true; msg.textContent = 'Saving…';
    const { data, error } = await sb.from('lift_entries').insert({ profile_id: S.me.id, lift: $('#lf-lift').value, weight_lb: +$('#lf-w').value, performed_on: $('#lf-d').value, note: $('#lf-n').value.trim() || null, source: 'manual' }).select().single();
    b.disabled = false;
    if (error) { msg.textContent = error.message; return; }
    const name = D.liftName(data.lift);
    if (data.is_pr) {
      msg.innerHTML = `<b style="color:var(--accent)">New ${esc(name)} PR: ${data.prev_best ? fmt(data.prev_best) + ' → ' : ''}${fmt(data.weight_lb)} lb.</b> It's on the <a href="#/prs">PR wall</a>.`;
      toast(`New ${name} PR!`);
    } else msg.textContent = `Logged ${fmt(data.weight_lb)} lb. Your best is still ${fmt(data.prev_best)}.`;
    $('#lf-w').value = ''; $('#lf-n').value = '';
  };
};

/* ---------- week ---------- */
VIEWS.week = async (day, tok) => {
  const sel = /^\d{4}-\d{2}-\d{2}$/.test(day || '') ? day : today();
  const start = monday(sel), end = addDays(start, 6);
  const [board, wres] = await Promise.all([loadBoard(), sb.from('workouts').select('*').gte('day', start).lte('day', end).order('day')]);
  const wks = must(wres);
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
    return `<a class="wd${d === sel ? ' on' : ''}${d === tdy ? ' today' : ''}" href="#/week/${d}" ${d === sel ? 'aria-current="date"' : ''}><span>${pd(d).toLocaleDateString('en-US', { weekday: 'short' })}</span><b>${pd(d).getDate()}</b>${logged ? '<i title="Logged">✓</i>' : ''}</a>`;
  }).join('');
  let body = '';
  if (!w) body = `<div class="prEmpty"><b>No programming for ${esc(fmtDW(sel))}</b><p>${wks.length ? 'Pick another day above.' : 'This week has not been posted yet.'}</p></div>`;
  else {
    const prog = `<div class="wkProg"><div class="eyebrow">${esc(fmtDW(w.day))}${w.day === tdy ? ' · Today' : ''}${w.source ? ' · ' + esc(w.source) : ''}</div><h3>${esc(w.title)}</h3>
      ${w.rest_note ? `<p class="rest">${esc(w.rest_note)}</p>` : ''}
      ${(w.sections || []).map(s => `<div class="wkSec"><b>${esc(s.name)}</b><p>${esc(s.text)}</p></div>`).join('')}
      <div class="row"><button class="btn ghost sm" data-thread="workout" data-ref="${w.id}" data-title="${esc(fmtD(w.day) + ' · ' + w.title)}">Day thread</button></div></div>`;
    let mine = '';
    if (!(w.lifts || []).length && !w.score_label) mine = `<div class="wkMine"><h3>Rest <span>day</span></h3><p class="hint">Nothing to log. Recover like it's your job.</p></div>`;
    else if (!S.me) mine = `<div class="wkMine"><h3>Your <span>numbers</span></h3><p class="hint">Sign in and every weight here is built from your own PRs. Then log what you actually did.</p><a class="btn" href="#/login">Sign in</a></div>`;
    else {
      const ent = (myLog && myLog.entries) || {};
      mine = `<form class="wkMine" id="wkF"><h3>${esc(S.me.display_name)}'s <span>numbers</span></h3>
        <div class="tablewrap"><table class="wkT"><thead><tr><th>Lift</th><th>Scheme</th><th class="r">Target</th><th class="r">Actual</th></tr></thead><tbody>
        ${(w.lifts || []).map(l => { const t = D.target(l, meRow); return `<tr><td><b>${esc(l.n)}</b><div class="sub">${esc(l.why)}</div></td><td class="n">${esc(l.sch)}</td><td class="r tgt">${t ? t + ' lb' : 'n/a'}</td><td class="r"><input class="wkIn" type="number" inputmode="numeric" step="5" min="0" max="1499" data-id="${esc(l.id)}" value="${esc(ent[l.id] ?? '')}" placeholder="${t || 'lb'}" aria-label="${esc(l.n)} actual weight"></td></tr>`; }).join('')}
        ${w.score_label ? `<tr><td><b>${esc(w.score_label)}</b><div class="sub">${w.score_type === 'time' ? 'mm:ss' : 'Your score'}</div></td><td></td><td></td><td class="r"><input class="wkIn wkScore" type="text" maxlength="40" id="wkScore" value="${esc(myLog?.score || '')}" placeholder="${w.score_type === 'time' ? '12:34' : 'score'}" aria-label="${esc(w.score_label)}"></td></tr>` : ''}
        </tbody></table></div>
        <div class="row"><button class="btn" type="submit">${myLog ? 'Update log' : 'Log it'}</button><span class="hint" id="wkMsg">${myLog ? 'Logged. Update any time.' : 'Hit the targets, then log what you actually did.'}</span></div></form>`;
    }
    body = `<div class="wkBody">${prog}${mine}</div>${dayBoard(w, logs.filter(l => l.workout_id === w.id))}`;
  }
  if (!paint(tok, `<section class="sec"><div class="wkNav"><div><div class="eyebrow">Week of ${esc(fmtD(start))}</div><h2>The <span>week</span></h2></div>
    <div class="row"><a class="btn ghost sm" href="#/week/${addDays(start, -7)}">← Last week</a>${start !== monday(tdy) ? `<a class="btn ghost sm" href="#/week/${tdy}">Today</a>` : ''}<a class="btn ghost sm" href="#/week/${addDays(start, 7)}">Next week →</a></div></div>
    <nav class="wkDays" aria-label="Days">${dayBtns}</nav></section>
    <section class="sec">${body}</section>`)) return;
  bindActions(main, () => route());
  const f = $('#wkF');
  if (f) f.onsubmit = async e => {
    e.preventDefault();
    const entries = {};
    $$('.wkIn[data-id]', f).forEach(i => { const v = i.value.trim(); if (v) entries[i.dataset.id] = Math.max(0, Math.min(1499, Math.round(+v) || 0)); });
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
        if (data && data.is_pr) prMsg = `New ${D.liftName(w.pr_lift)} PR: ${best ? fmt(best) + ' → ' : ''}${fmt(data.weight_lb)} lb!`;
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
    return `<tr class="${mine ? 'me' : ''}${x.status === 'struck' ? ' struck' : ''}"><td class="pos">${i + 1}</td><td class="who"><a href="#/u/${x.profile_id}">${esc(nm)}</a>${x.status === 'protested' ? '<span class="pill flat">Protest</span>' : ''}</td>
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
  const back = room && { pr: ['#/prs', 'PR wall'], workout: ['#/week', 'The week'], protest: ['#/protests', 'Protests'] }[room.kind];
  const sideRoom = r => `<a class="room" href="#/chat/${r.id}" ${room && r.id === room.id ? 'aria-current="page"' : ''}><b>${esc(r.title)}</b><span class="sub">${r.kind === 'group' ? esc((gById.get(r.group_id) || {}).kind || '') : esc(r.kind)}</span></a>`;
  if (!paint(tok, `<section class="sec"><div><div class="eyebrow">Talk it out</div><h2>The <span>chat</span></h2></div>
  <div class="chatWrap"><aside class="rooms" aria-label="Rooms">
    <h4>Groups</h4>${groupRooms.map(sideRoom).join('') || '<p class="empty">No groups yet.</p>'}
    ${joinable.map(g => `<div class="room"><b>${esc(g.name)}</b><button class="btn ghost sm" data-join="${g.id}">Join</button></div>`).join('')}
    ${pro.filter(g => !joinable.includes(g)).map(g => `<a class="room" href="#/join"><b>${esc(g.name)}</b><span class="pill acc">Pro</span></a>`).join('')}
    <h4>Threads</h4>${threads.map(sideRoom).join('') || '<p class="empty" style="padding:8px 14px">Hit Talk on any PR, day or protest to start one.</p>'}
    ${S.me.role === 'admin' ? `<h4>New group</h4><form id="ng" class="inlineForm" style="margin:0 10px 10px"><input id="ng-name" maxlength="40" placeholder="Name, like Masters 50+" required><select id="ng-tier"><option value="free">Everyone can join</option><option value="pro">DSI Pro only</option></select><label class="check"><input type="checkbox" id="ng-open" checked><span class="sub">Open to join</span></label><button class="btn sm">Create</button></form>` : ''}
  </aside>
  ${room ? `<div class="thread"><div class="thHead"><h3>${esc(room.title)}</h3>${back ? `<a class="chip" href="${back[0]}">${back[1]}</a>` : ''}</div>
    <div class="msgs" id="msgs" aria-live="polite"><p class="empty">Loading…</p></div>
    <form class="compose" id="cmp"><label class="vh" for="cmp-t">Message</label><textarea id="cmp-t" maxlength="1000" placeholder="${S.me.roast_opt_in ? 'Say something. Roasts welcome.' : 'Say something'}" required></textarea><button class="btn">Send</button></form></div>`
      : '<div class="prEmpty"><b>No rooms yet</b></div>'}
  </div></section>`)) return;

  $$('[data-join]').forEach(b => b.onclick = async () => {
    const { error } = await sb.from('group_members').insert({ group_id: b.dataset.join, profile_id: S.me.id });
    if (error) return toast(error.message); toast('Joined'); route();
  });
  const ng = $('#ng');
  if (ng) ng.onsubmit = async e => {
    e.preventDefault();
    const name = $('#ng-name').value.trim(), slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'group';
    const { error } = await sb.from('groups').insert({ name, slug, kind: 'custom', is_open: $('#ng-open').checked, min_tier: $('#ng-tier').value });
    if (error) return toast(error.message); toast('Group created'); route();
  };
  if (!room) return;

  const box = $('#msgs'), seen = new Set();
  const line = m => {
    const mine = m.profile_id === S.me.id, canDel = !m.deleted && (mine || isStaff());
    return `<div class="msg${mine ? ' mine' : ''}${m.deleted ? ' del' : ''}" data-mid="${m.id}"><div class="by"><b>${esc(nameOf(m.profile_id))}</b> · ${timeAgo(m.created_at)}</div><div class="tx">${m.deleted ? 'Message removed' : esc(m.body)}</div>${canDel ? `<button class="x" data-rm="${m.id}">Remove</button>` : ''}</div>`;
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
    const id = e.target.dataset && e.target.dataset.rm; if (!id) return;
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
      <h3>${who ? `<a href="#/u/${who}" style="text-decoration:none">${esc(what)}</a>` : esc(what)}</h3>
      <p>“${esc(p.reason)}”</p>
      ${p.status !== 'open' ? `<p class="ruling"><b>Ruling by ${esc(nameOf(p.ruled_by))}:</b> ${esc(p.ruling_note || (p.status === 'struck' ? 'Struck from the record.' : 'The lift stands.'))}</p>` : ''}
      <div class="row"><button class="btn ghost sm" data-thread="protest" data-ref="${p.id}" data-title="${esc('Protest: ' + what)}">Discuss</button></div>
      ${staff && p.status === 'open' ? `<form class="inlineForm" data-rule="${p.id}"><label class="eyebrow" for="rn-${p.id}">Commissioner ruling</label><textarea id="rn-${p.id}" maxlength="500" placeholder="Explain the ruling (optional)"></textarea>
        <div class="row"><button class="btn sm" data-d="upheld">Lift stands</button><button class="btn danger sm" data-d="struck">Strike it</button></div></form>` : ''}
    </article>`;
  };
  const open = list.filter(p => p.status === 'open'), done = list.filter(p => p.status !== 'open');
  if (!paint(tok, `<section class="sec"><div><div class="eyebrow">Commissioner's court</div><h2><span>Protests</span></h2></div>
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

/* ---------- me ---------- */
VIEWS.me = async (_, tok) => {
  if (!S.me) return needLogin(tok, 'see your account');
  const [board, goals, tiers] = await Promise.all([loadBoard(), sb.from('goals').select('*').eq('profile_id', S.me.id).then(must), sb.from('tiers').select('*').order('sort').then(must)]);
  const m = S.me, first = !m.display_name, r = boardRow(m.id) || {};
  const gl = Object.fromEntries(goals.map(g => [g.lift, num(g.target_lb)]));
  const tier = tiers.find(t => t.id === m.tier) || { name: m.tier };
  const yr = new Date().getFullYear();
  if (!paint(tok, `<section class="sec"><div><div class="eyebrow">${first ? 'Welcome to the index' : 'Your account'}</div><h2>${first ? 'Set up your <span>profile</span>' : esc(m.display_name)}</h2></div>
    ${first ? '<p class="lede">Pick the name that shows on the boards. Age and bodyweight make the score fair.</p>' : `<div class="row"><span class="pill acc" style="margin:0">${esc(tier.name)}</span>${m.role !== 'member' ? `<span class="pill up">${m.role === 'commissioner' ? 'Commissioner' : 'Founder'}</span>` : ''}<span class="sub">${esc(S.session.user.email)}</span><a class="chip" href="#/u/${m.id}">View my card</a></div>`}
    <form class="formCard" id="pf">
      <div class="fields">
        <div class="field w2"><label for="pf-n">Board name</label><input id="pf-n" maxlength="24" required value="${esc(m.display_name || '')}" autocomplete="nickname"></div>
        <div class="field"><label for="pf-by">Birth year</label><input id="pf-by" type="number" min="${yr - 100}" max="${yr - 12}" value="${esc(m.birth_year || '')}" required></div>
        <div class="field"><label for="pf-bw">Bodyweight (lb)</label><input id="pf-bw" type="number" min="80" max="450" step="0.1" value="${esc(m.bodyweight || '')}" required></div>
        <div class="field"><label for="pf-sex">Sex</label><select id="pf-sex">${[['male', 'Male'], ['female', 'Female'], ['unspecified', 'Prefer not to say']].map(o => `<option value="${o[0]}"${m.sex === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}</select></div>
        <div class="field"><label for="pf-div">Division</label><select id="pf-div">${[['men', 'Men'], ['women', 'Women'], ['open', 'Open']].map(o => `<option value="${o[0]}"${m.division === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}</select></div>
        <div class="field w2"><span class="lbl">Roasts</span><label class="check" style="text-transform:none;letter-spacing:0;font:500 15px var(--sans);color:var(--ink)"><input type="checkbox" id="pf-roast"${m.roast_opt_in ? ' checked' : ''}><span>Roast me. Show the savage verdict on my card and put a 🔥 by my name so people know I can take it.</span></label></div>
      </div>
      <div class="row"><button class="btn" type="submit">${first ? 'Join the board' : 'Save'}</button><span class="hint" id="pf-msg"></span></div>
    </form></section>
    ${first ? '' : `<section class="sec"><h2>Goals</h2><form class="formCard" id="gf"><div class="goalRows">${D.LIFTS.map(l => `<div class="g" style="--c:${l.c}"><h4>${l.n}</h4><input type="number" min="0" max="1499" step="5" data-g="${l.db}" value="${gl[l.db] || ''}" aria-label="${l.n} goal"><div class="now">${r[l.k] ? 'Best ' + fmt(r[l.k]) + ' lb' : 'No lift yet'}</div></div>`).join('')}</div><div class="row"><button class="btn" type="submit">Save goals</button></div></form></section>
    <section class="sec"><h2>Membership</h2><div class="row"><p class="lede">You're on <b>${esc(tier.name)}</b>.</p><a class="btn ghost sm" href="#/join">See levels</a><button class="btn ghost sm" id="so">Sign out</button></div></section>`}`)) return;
  $('#pf').onsubmit = async e => {
    e.preventDefault();
    const msg = $('#pf-msg'), b = e.target.querySelector('button'); b.disabled = true; msg.textContent = 'Saving…';
    const upd = { display_name: $('#pf-n').value.trim(), birth_year: +$('#pf-by').value, bodyweight: +$('#pf-bw').value, sex: $('#pf-sex').value, division: $('#pf-div').value, roast_opt_in: $('#pf-roast').checked };
    const { data, error } = await sb.from('profiles').update(upd).eq('id', m.id).select().single();
    b.disabled = false;
    if (error) { msg.textContent = error.code === '23505' ? 'That name is taken. Try another.' : error.message; return; }
    S.me = data; updateChrome('me'); toast('Saved');
    if (first) location.hash = '#/'; else msg.textContent = 'Saved.';
  };
  const gf = $('#gf');
  if (gf) gf.onsubmit = async e => {
    e.preventDefault();
    const ups = $$('[data-g]', gf).filter(i => +i.value > 0).map(i => ({ profile_id: m.id, lift: i.dataset.g, target_lb: +i.value, updated_at: new Date().toISOString() }));
    if (!ups.length) return toast('Enter a goal first');
    const { error } = await sb.from('goals').upsert(ups, { onConflict: 'profile_id,lift' });
    toast(error ? error.message : 'Goals saved');
  };
  const so = $('#so'); if (so) so.onclick = async () => { await sb.auth.signOut(); location.hash = '#/'; };
};

/* ---------- membership ---------- */
VIEWS.join = async (_, tok) => {
  const tiers = must(await sb.from('tiers').select('*').order('sort'));
  paint(tok, `<section class="sec"><div><div class="eyebrow">Membership</div><h2>Pick your <span>level</span></h2></div><p class="lede">The boards, PR wall, daily workouts and chat are free. DSI Pro adds coaching and deeper tools.</p>
  <div class="tiers">${tiers.map((t, i) => `<div class="tier" style="--c:${i ? 'var(--accent)' : 'var(--line)'}"><h3>${esc(t.name)}</h3><div class="price">${t.price_cents ? '$' + (t.price_cents / 100).toFixed(0) + '<span class="sub">/mo</span>' : 'Free'}</div><ul>${(t.perks || []).map(p => `<li>${esc(p)}</li>`).join('')}</ul>
    ${S.me && S.me.tier === t.id ? '<span class="pill up" style="margin:0;justify-self:start">Your level</span>' : t.price_cents ? '<button class="btn" disabled>Coming soon</button>' : S.me ? '' : '<a class="btn" href="#/login">Join free</a>'}</div>`).join('')}</div></section>`);
};

/* ---------- login ---------- */
VIEWS.login = async (_, tok) => {
  if (S.me) { location.hash = S.me.display_name ? '#/' : '#/me'; return; }
  if (!paint(tok, `<section class="sec" style="max-width:520px"><div><div class="eyebrow">Members</div><h2>Sign <span>in</span></h2></div>
    <p class="lede">No password. We email you a sign in link and a 6 digit code. Already on the board? Use the same email and your numbers come with you.</p>
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

/* ---------- boot ---------- */
async function boot() {
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  if (/^#(access_token|error)/.test(location.hash)) {
    if (/error_description=/.test(location.hash)) toast(decodeURIComponent(location.hash.match(/error_description=([^&]*)/)[1]).replace(/\+/g, ' '));
    history.replaceState(null, '', location.pathname + '#/');
  }
  await loadMe();
  sb.auth.onAuthStateChange((ev, session) => {
    if (ev === 'INITIAL_SESSION' || ev === 'TOKEN_REFRESHED') { S.session = session; return; }
    S.session = session;
    setTimeout(async () => {
      await loadMe();
      if (ev === 'SIGNED_IN') { if (/^#(access_token|\/login)/.test(location.hash) || !location.hash) history.replaceState(null, '', location.pathname + (S.me && !S.me.display_name ? '#/me' : '#/')); toast(S.me && S.me.display_name ? 'Welcome back, ' + S.me.display_name : 'Signed in'); }
      route();
    }, 0);
  });
  window.addEventListener('hashchange', route);
  route();
}
boot();
