// Dandy Strength public pages, written for a gym owner deciding whether to buy.
// /          home: grow your gym, the sample gym's dashboards, two plans
// /grow      how it grows your gym: find, try, join, stay, spend, with example math
// /tour      the sample gym, every dashboard to click through
// /pricing   Run and Grow, compared, with add ons and owner questions
// /switch    moving from Kilo, Wodify or PushPress, plus a what you pay now calculator
// /members   why members love it
// /start     Bring your gym: the form (emails Dandy and thanks the owner)
// Every number on these pages comes from a made up sample gym and is labeled so. Real member data lives behind sign in.

export function install(X) {
  const { sb, S, VIEWS, $, esc, fmt, paint, go } = X;

  const TIERS = [
    { k: 'run', n: 'Run', p: 249, who: 'Everything to run the gym', line: 'Booking, billing on your Stripe, waivers, staff, Dandy TV, AI programming, the DSI and the Growth game.' },
    { k: 'grow', n: 'Grow', p: 499, who: 'Run, plus a website that sells', line: 'A new website built and run by us, lead texting, your store and events online, and DSI Pro for every Unlimited member.' },
  ];
  X.TIERS = TIERS;
  const me = () => S.me && S.me.display_name ? S.me : null;
  const SAMPLE = '<span class="dmTag">Sample gym · made up numbers</span>';
  const plates = '<span class="hmPlates" aria-hidden="true"><i style="--c:var(--bench)"></i><i style="--c:var(--squat)"></i><i style="--c:var(--dead)"></i><i style="--c:var(--clean)"></i></span>';

  /* ---------- the sample gym ---------- */
  // "Your Gym": 98 members 15 weeks ago, 112 today, chasing 120. Believable, not a hockey stick.
  const D_MEMBERS = [98, 98, 99, 100, 101, 101, 102, 104, 105, 106, 107, 108, 109, 110, 111, 112];
  const D_VISITS = [212, 218, 205, 226, 231, 224, 240, 236, 249, 252, 247, 261, 266, 258, 272, 279];
  const spark = (vals, goal, w = 300, h = 90, label = '') => {
    const lo = Math.min(...vals, goal || Infinity) * 0.97, hi = Math.max(...vals, goal || 0) * 1.02;
    const x = i => (i / (vals.length - 1)) * w, y = v => h - ((v - lo) / (hi - lo)) * h;
    return `<svg class="grTrend" viewBox="0 -6 ${w} ${h + 12}" role="img" aria-label="${esc(label)}">${goal ? `<line x1="0" x2="${w}" y1="${y(goal)}" y2="${y(goal)}" class="goal"/><text x="${w}" y="${y(goal) - 4}" text-anchor="end" class="goalT">Goal ${goal}</text>` : ''}<polyline points="${vals.map((v, i) => `${x(i)},${y(v)}`).join(' ')}" class="line"/>${vals.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="2.4"/>`).join('')}</svg>`;
  };
  const part = (n, p, d) => `<li><span>${esc(n)}<small>${esc(d)}</small></span><em class="${p > 0 ? 'up' : 'down'}">${p > 0 ? '+' : ''}${p}</em></li>`;
  const demoGrowth = () => `<div class="dmPanel">${SAMPLE}<div class="grTiles dmTiles">
      <div class="grTile grScore up"><span class="grLbl">Growth Index</span><b class="grBig">674</b><span class="pill up">Ahead of par</span>
        <ul class="grParts">${part('Member growth', 116, '+14.3% in 15 weeks, par 4.6%')}${part('Keeping members', 31, '3.4% lost a month, par 5%')}${part('Trials that join', 18, '62% join, par 50%')}${part('Revenue per member', 9, '+2% since the start')}</ul></div>
      <div class="grTile grScore up"><span class="grLbl">Reputation Index</span><b class="grBig">655</b><span class="pill up">Ahead of par</span>
        <ul class="grParts">${part('Google rating', 100, '4.9 stars, par 4.7')}${part('Reviews for your size', 37, '73 reviews for 112 members')}${part('New reviews', 18, '2.7 a month, par 2')}</ul></div>
      <div class="grTile grSeason"><span class="grLbl">Season points</span><b class="grBig">840</b><span class="pill acc">Competitor</span>
        <div class="grLvl"><i style="width:36%"></i></div><p class="hint">160 to Elite · 9 quests done</p>
        <div class="grStreak"><b>11</b><span>week streak</span></div></div>
      <div class="grTile grGoal"><span class="grLbl">Season goal</span><b class="grBig">120</b><span class="hint">members by March 31</span><p><b>8</b> to go, about 0.4 a week.</p>${spark(D_MEMBERS, 120, 300, 80, 'Members by week, 98 to 112, goal 120')}</div>
    </div>
    <ol class="grQs dmQs">${[['reputation', 'Reply to every Google review, good and bad', 50, 1], ['members', 'Run a bring a friend Saturday', 100, 1], ['retention', 'Text every member not seen in 14 days', 50, 0], ['revenue', 'Launch a 6 week challenge as a paid add on', 150, 0]].map(([a, t, p, d]) => `<li class="grQ${d ? ' done' : ''}"><span class="grArea a-${a}">${{ reputation: 'Reputation', members: 'New members', retention: 'Keep members', revenue: 'Revenue' }[a]}</span><div class="grQT"><b>${t}</b></div><em class="grPts">${p}</em><span class="hint">${d ? 'Done' : 'Open'}</span></li>`).join('')}</ol></div>`;
  const kpi = (v, l, d) => `<div class="inKpi"><b>${v}</b><span>${esc(l)}</span>${d ? `<em class="up">▲ ${d}% vs before</em>` : ''}</div>`;
  const demoInsights = () => {
    const max = Math.max(...D_VISITS);
    return `<div class="dmPanel">${SAMPLE}<div class="inKpis">${kpi('112', 'Active members')}${kpi('1,184', 'Visits, last 30 days', 9)}${kpi('11.4', 'Average per class')}${kpi('71%', 'Class spots filled')}${kpi('$14,896', 'Monthly dues')}</div>
      <div class="dmGrid2"><div class="formCard"><h3 class="inH">Visits per week</h3><div class="inBars" role="img" aria-label="Visits per week, 212 rising to 279">${D_VISITS.map((v, i) => `<div class="inBar"><span class="inBarV">${i % 3 === 0 || i === D_VISITS.length - 1 ? v : ''}</span><i style="height:${Math.round(v / max * 100)}%"></i><span class="inBarL">${i % 4 === 0 ? 'Wk ' + (i + 1) : ''}</span></div>`).join('')}</div></div>
        <div class="formCard"><h3 class="inH">Busiest and quietest classes</h3><table class="inT"><tbody>
          ${[['up', 'Top', 'Sat 9am Partner WOD', '19.4'], ['up', 'Top', 'Mon 5:30pm CrossFit', '17.8'], ['up', 'Top', 'Wed 5:30pm CrossFit', '16.1'], ['down', 'Low', 'Tue 12pm CrossFit', '5.1'], ['down', 'Low', 'Fri 6:30pm Open gym', '4.2']].map(([c, t, n, v]) => `<tr><td><span class="pill ${c}">${t}</span> ${n}</td><td class="r n">${v}</td></tr>`).join('')}</tbody></table>
          <p class="hint">Slipping away: Morgan P., Chris D. and 2 more regulars, no class in 2 to 6 weeks.</p></div></div></div>`;
  };
  const TV_ROWS = [['Sam', 225, 'var(--squat)'], ['Alex', 185, 'var(--bench)'], ['Jordan', 205, 'var(--dead)'], ['Riley', 155, 'var(--clean)']];
  const fakeQr = () => { const n = 21; const on = (x, y) => { for (const [a, b] of [[0, 0], [14, 0], [0, 14]]) if (x >= a && x < a + 7 && y >= b && y < b + 7) { const dx = x - a, dy = y - b; return dx === 0 || dy === 0 || dx === 6 || dy === 6 || (dx > 1 && dx < 5 && dy > 1 && dy < 5); } return ((x * 7 + y * 13 + x * y * 3) % 5) < 2; };
    let r = ''; for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (on(x, y)) r += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    return `<svg viewBox="-2 -2 25 25" aria-hidden="true" shape-rendering="crispEdges"><rect x="-2" y="-2" width="25" height="25" fill="#fff"/><g fill="#0E1420">${r}</g></svg>`; };
  const demoTv = () => `<div class="dmPanel">${SAMPLE}<div class="dmGrid2">
      <figure class="dmFig"><div class="hmTv" aria-hidden="true"><div class="hmTvTop"><b>Part B · Back squat</b><span>5 x 3 at 85%</span></div>
        <ol class="hmTvRows">${TV_ROWS.map(([n, w, c]) => `<li><i style="--c:${c}"></i><span>${n}</span><b>${w}</b></li>`).join('')}</ol>
        <div class="hmTvFoot"><span>6:30am class · 23:40 class time</span><span>Part B now</span></div></div><figcaption><b>Class TV.</b> Every member's own weight for today and the class clock, live from the schedule.</figcaption></figure>
      <figure class="dmFig"><div class="hmTv hmSign" aria-hidden="true"><div class="hmSignL"><span class="hmSignK">Gym gear</span><b>Rep the gym</b><span class="hmSignN">Tees $25 · Hoodies $50</span><span class="hmSignBar"><i></i></span></div>
        <div class="hmSignQ">${fakeQr()}<span>Scan to order</span></div></div><figcaption><b>Lobby TV.</b> Schedule, PRs, events, merch and offers, each with a QR code.</figcaption></figure></div></div>`;
  const demoMember = () => `<div class="dmPanel">${SAMPLE}<div class="dmGrid3">
      <div class="formCard dmCard"><span class="grLbl">Alex R. · DSI</span><b class="grBig">612</b><span class="pill up">Up 64 since May</span><p class="hint">Bench, squat, deadlift and clean, scored against lifters the same age and size. 500 is the median.</p>${spark([548, 556, 561, 575, 590, 597, 612], 0, 300, 70, 'DSI over 6 months, 548 to 612')}</div>
      <div class="formCard dmCard"><span class="grLbl">Today's targets</span><table class="inT"><tbody>${[['Back squat 5 x 3', '225 lb'], ['Strict press 5 x 5', '95 lb'], ['Clean, build to heavy', '205 lb']].map(([a, b]) => `<tr><td>${a}</td><td class="r n"><b>${b}</b></td></tr>`).join('')}</tbody></table><p class="hint">Worked out from Alex's own PRs. The same numbers show on the class TV.</p></div>
      <div class="formCard dmCard"><span class="grLbl">DSI Pro</span><ul class="hmTicks"><li>Progress charts for every lift</li><li>A goal plan to the next number</li><li>An AI coach that knows Alex's numbers</li><li>Readiness from WHOOP or Apple Health</li></ul><p class="hint">Included with Unlimited at gyms on Grow.</p></div></div></div>`;
  const DEMOS = [['growth', 'Growth game', demoGrowth], ['insights', 'Insights', demoInsights], ['tv', 'Dandy TV', demoTv], ['member', 'Member app', demoMember]];
  const demoTabs = (id, only) => { const ds = only ? DEMOS.filter(d => only.includes(d[0])) : DEMOS;
    return `<div class="dmTabs" role="tablist" aria-label="Sample gym dashboards" data-dm="${id}">${ds.map(([k, n], i) => `<button type="button" role="tab" id="${id}-t-${k}" aria-controls="${id}-p-${k}" aria-selected="${i === 0}" tabindex="${i ? -1 : 0}" data-dmtab="${k}">${n}</button>`).join('')}</div>
      ${ds.map(([k, , f], i) => `<div role="tabpanel" id="${id}-p-${k}" aria-labelledby="${id}-t-${k}"${i ? ' hidden' : ''}>${f()}</div>`).join('')}`; };
  const wireDemos = () => document.querySelectorAll('[data-dm]').forEach(list => {
    const id = list.dataset.dm, tabs = [...list.querySelectorAll('[data-dmtab]')];
    const pick = b => tabs.forEach(t => { const on = t === b; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; document.getElementById(`${id}-p-${t.dataset.dmtab}`).hidden = !on; });
    tabs.forEach((b, i) => { b.onclick = () => pick(b); b.onkeydown = e => { const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return; const n = tabs[(i + d + tabs.length) % tabs.length]; pick(n); n.focus(); }; });
  });
  // A made up board for visitors, in place of real names and numbers.
  const SAMPLE_BOARD = [['Jordan K.', 'Your Gym', 742], ['Sam T.', 'Your Gym', 701], ['Riley M.', 'Your Gym', 668], ['Alex R.', 'Your Gym', 612], ['Casey L.', 'Your Gym', 574], ['Drew P.', 'Your Gym', 531]];
  const sampleBoard = () => `<aside class="hmBoard" aria-label="Sample DSI leaderboard"><div class="hmBoardH"><b>The DSI board</b>${SAMPLE}</div>
      <ol class="hmRows">${SAMPLE_BOARD.map(([n, g, s], i) => `<li><span class="hmPos">${i + 1}</span><span class="hmWho"><b>${n}</b><small>${g}</small></span><span class="hmBar"><i style="width:${Math.round(s / 742 * 100)}%"></i></span><span class="hmScore">${s}</span></li>`).join('')}</ol>
      <p class="hint">Members see their own gym's real board once they sign in.</p></aside>`;
  X.demo = { sampleBoard, SAMPLE };

  const planCards = (cta = true) => `<div class="dmPlans">${TIERS.map(t => `<article class="plCard${t.k === 'grow' ? ' dmPick' : ''}">${t.k === 'grow' ? '<span class="dmBadge">Most growth</span>' : ''}<b class="plName">${t.n}</b><span class="hmAmt">$${t.p}<small>/mo</small></span><span class="hmWho2">${esc(t.who)}</span>
      <ul class="plList">${CARD[t.k].map(x => `<li>${esc(x)}</li>`).join('')}</ul>${cta ? `<a class="btn${t.k === 'grow' ? '' : ' ghost'}" href="/start?tier=${t.k}">Book a setup call</a>` : ''}</article>`).join('')}</div>`;
  const CARD = {
    run: ['Class booking, check in and attendance', 'Billing and autopay on your own Stripe', 'Waivers and contracts signed online', 'Staff, coach swaps, hours and pay', 'Dandy TV for the class and the lobby', 'Workouts in Parts A to D with every member\'s target', 'Dandy Plan AI programming', 'The DSI, the member app and the Growth game', 'Month to month'],
    grow: ['Everything in Run', 'A new website, built and run by us, on your domain', 'A text us line and a lead inbox', 'Store, events and appointments on your site', 'Review requests after class', 'DSI Pro for every Unlimited member', 'A growth plan we set with you each season', '2 month minimum, no setup fee'],
  };
  const endCta = (h = 'See what Dandy can do for your gym', p = 'Book a 20 minute setup call. We look at your gym with you and show you the plan.') => `<section class="sec plEnd"><div><h2 class="hmH2">${h}</h2><p class="hmSideSub">${p}</p></div><div class="row"><a class="btn" href="/start">Book a setup call</a><a class="btn ghost" href="/tour">Tour the sample gym</a></div></section>`;

  /* ---------- home ---------- */
  const WAYS = [
    ['Get more members', 'A website built to book, a text us line answered fast, and a free first class that turns visitors into leads.', '/grow#find'],
    ['Keep the ones you have', 'Every member gets a score that proves they are getting stronger, their own weight on the TV, and a coach who notices when they slip.', '/grow#stay'],
    ['Earn more from each one', 'Memberships between $0 and Unlimited, a store, events and merch, all paid through your own Stripe.', '/grow#spend'],
  ];
  VIEWS[''] = async (_, tok) => {
    const m = me(), office = (S.myGyms || [])[0];
    const ctas = office ? `<a class="btn" href="/club/${office.gym_id}?tab=today">Open your gym office</a><a class="btn ghost" href="/growth/${office.gym_id}">Your Growth game</a>`
      : `<a class="btn" href="/start">Book a setup call</a><a class="btn ghost" href="/tour">Tour the sample gym</a>`;
    if (!paint(tok, `
      <section class="hmHero">
        <div class="hmLead">
          <h1 class="hmH">Grow your gym.${plates}</h1>
          <p class="hmSub">Dandy Strength runs your classes, billing and screens, builds the website that brings in members, and keeps score of your growth every week.</p>
          <div class="row hmCta">${ctas}</div>
          ${m && !office ? '<p class="hint">Here for your own numbers? <a href="/boards">See the boards</a>.</p>' : ''}
        </div>
        <div class="dmHeroDash">${demoGrowth()}</div>
      </section>
      <section class="dmWays">${WAYS.map(([h, p, href], i) => `<a class="dmWay" href="${href}"><span class="dmNum">${i + 1}</span><b>${h}</b><p>${p}</p><span class="dmGo">How it works</span></a>`).join('')}</section>
      <section class="sec dmDash"><div class="secHead"><div><div class="kicker">The sample gym</div><h2 class="hmH2">See it run a gym</h2><p class="hmSideSub">Every screen an owner and a member uses, filled with a made up gym so you can look around.</p></div><a class="btn ghost sm" href="/tour">Full tour</a></div>
        ${demoTabs('hm')}</section>
      <section class="hmPrice"><div class="hmPriceHead"><h2 class="hmH2">Two plans</h2><p class="hmSideSub">Card payments run on your own Stripe at Stripe's rates. We add no markup.</p></div>${planCards()}
        <p class="hmSeat">Paying for a website today? On Grow the website comes with everything that runs the gym, for one price.</p></section>
      <section class="hmSwitch"><div><h2 class="hmH2">Coming from Kilo, Wodify or PushPress?</h2><p class="hmSideSub">We move your members, plans, schedule and history for you. Switching usually takes about a week.</p></div><a class="btn" href="/switch">How switching works</a></section>
      ${endCta()}`)) return;
    wireDemos();
  };

  /* ---------- how it grows your gym ---------- */
  const STAGES = [
    ['find', 'Find', 'They find you', 'A fast website on your domain with class times, prices and a free first class, plus Google reviews asked for after class.', 'Leads a week'],
    ['try', 'Try', 'They try a class', 'A text us line on every page that lands in your inbox, and booking straight from the website. A free drop in is one tap.', 'Trials booked'],
    ['join', 'Join', 'They join', 'Memberships for every habit, from once a week to Unlimited, signed and paid online on your Stripe.', 'Trials that join'],
    ['stay', 'Stay', 'They stay', 'The DSI gives every member a number worth chasing, the TV shows their own weight, and Insights flags regulars who stop coming.', 'Members lost a month'],
    ['spend', 'Spend', 'They spend more', 'DSI Pro inside Unlimited, a store at the front desk, events and merch on the lobby TV.', 'Revenue per member'],
  ];
  VIEWS.grow = async (_, tok) => {
    if (!paint(tok, `
      <section class="plHero"><div><div class="kicker">How it grows your gym</div><h1 class="plH">More members, and they stay longer</h1>
        <p class="hmSub">Every gym grows the same way: people find you, try a class, join, stay and spend. Dandy Strength works on each step, and the Growth game scores how you are doing every week.</p>
        <div class="row hmCta"><a class="btn" href="/start">Book a setup call</a><a class="btn ghost" href="/tour">Tour the sample gym</a></div></div>
        <div class="plEvery"><b>The Growth game</b><ul><li>A Growth Index and a Reputation Index, 500 is par</li><li>Par is set for your gym's size and age</li><li>Quests: simple ideas worth points</li><li>A weekly check in that takes a minute</li><li>Private to you</li></ul></div></section>
      <section class="sec"><ol class="dmFunnel">${STAGES.map(([id, k, h, p, metric]) => `<li id="${id}"><span class="dmStage">${k}</span><b>${h}</b><p>${p}</p><span class="dmMetric">We track: ${metric}</span></li>`).join('')}</ol></section>
      <section class="sec"><div class="secHead"><div><div class="kicker">Example</div><h2 class="hmH2">A 90 member gym at $160 a month</h2><p class="hmSideSub">One price and nothing in between loses people who come once or twice a week. An illustration, not a promise.</p></div></div>
        <div class="tablewrap"><table class="hmMath dmMath"><tbody>
          <tr><th scope="row">10 people who would say no at $160 join at $79 or $119</th><td>+$990</td></tr>
          <tr><th scope="row">Website and fast texting turn 2 more trials a month into members at $119</th><td>+$238</td></tr>
          <tr><th scope="row">Drinks, snacks and gear from the front desk store</th><td>+$250</td></tr>
          <tr><th scope="row">Grow plan</th><td>($499)</td></tr>
          <tr class="sum"><th scope="row">More each month, after the first few months</th><td>+$979</td></tr></tbody></table></div></section>
      <section class="sec dmDash"><h2 class="hmH2">The scoreboard for your business</h2>${demoTabs('gr', ['growth', 'insights'])}</section>
      ${endCta()}`)) return;
    wireDemos();
    if (location.hash) { const el = document.getElementById(location.hash.slice(1)); if (el) el.scrollIntoView({ block: 'start' }); }
  };

  /* ---------- tour ---------- */
  VIEWS.tour = async (_, tok) => {
    if (!paint(tok, `
      <section class="plHero"><div><div class="kicker">Tour</div><h1 class="plH">The sample gym</h1>
        <p class="hmSub">"Your Gym" is made up: 112 members, growing toward 120. Click through what the owner, the coaches and the members see. Your own gym's real numbers stay private to you.</p></div>
        <div class="plEvery"><b>On this tour</b><ul><li>Growth game: your scores and quests</li><li>Insights: members, visits and revenue</li><li>Dandy TV: the class and the lobby</li><li>Member app: the DSI and today's targets</li></ul></div></section>
      <section class="sec dmDash">${demoTabs('tr')}</section>
      ${endCta('Want this for your gym?', 'We set up your office, move your members and turn on the TV. Book a call and see your own gym in it.')}`)) return;
    wireDemos();
  };

  /* ---------- pricing ---------- */
  const ROWS = [
    ['Running the gym', [['Class schedule, booking, check in and attendance', 'y', 'y'], ['Billing, invoices and autopay on your own Stripe', 'y', 'y'], ['Waivers and membership contracts signed online', 'y', 'y'], ['Staff, coach swaps, hours and pay', 'y', 'y'], ['Front desk store for drinks, snacks and gear', 'y', 'y']]],
    ['The floor', [['Workouts in Parts A to D with every member\'s target', 'y', 'y'], ['Dandy Plan AI programming', 'y', 'y'], ['Dandy TV for the class and the lobby', 'y', 'y'], ['Log a class: coaches type weights live', 'y', 'y']]],
    ['Members', [['The DSI, boards and the member app', 'y', 'y'], ['DSI Pro', '$4 a member', 'Included for Unlimited members']]],
    ['Growth', [['Growth game and Insights', 'y', 'y'], ['New website, built and run by us', '', 'y'], ['Text us line and lead inbox', '', 'y'], ['Store, events and appointments on your website', '', 'y'], ['Review requests after class', '', 'y'], ['A growth plan we set with you each season', '', 'y']]],
    ['Terms', [['Commitment', 'Month to month', '2 month minimum'], ['Setup fee', 'None', 'None'], ['Moving your members over', 'We do it', 'We do it']]],
  ];
  const ADDONS = [['SEO and AI search', 'Get found for "CrossFit near me" on Google and in AI answers, with a monthly report.'], ['Paid ads', 'Local ads that send people to your free class. Ad spend plus a management fee.'], ['Printed merch', 'Tees, hoodies and hats printed to order and sold on your site and lobby TV.'], ['Extra texting', 'Reminders and win back texts beyond the included line, at carrier cost plus a fee.']];
  const cellOf = c => c === 'y' ? '<span class="plY" aria-hidden="true"></span><span class="vh">Included</span>' : c ? esc(c) : '<span class="plN" aria-hidden="true"></span><span class="vh">Not included</span>';
  const FAQ = [
    ['Is there a contract?', 'Run is month to month. Grow has a 2 month minimum because we build your website up front, then it is month to month too.'],
    ['Is there a setup fee?', 'No. We set up your office, move your members and build the Grow website at no extra charge.'],
    ['Who moves my members?', 'We do. Send your member list, plans and schedule from Kilo, Wodify, PushPress or a spreadsheet, and we set everything up with you.'],
    ['What do card payments cost?', 'Stripe\'s standard rates, paid to Stripe. Money goes straight to your own Stripe account, and we add nothing.'],
    ['Do members pay for the app?', 'No. The DSI and the member app are free. On Grow, every Unlimited member gets DSI Pro included.'],
    ['Who owns the website and the data?', 'You do. Your domain stays yours, and you can export your members and history any time.'],
  ];
  VIEWS.pricing = async (_, tok) => {
    if (!paint(tok, `
      <section class="plHero"><div><div class="kicker">Pricing</div><h1 class="plH">Two plans. Pick how fast you want to grow.</h1>
        <p class="hmSub">Run has everything to run the gym. Grow adds the website and the tools that bring in members. No setup fee, and we move you over.</p></div>
        <div class="plEvery"><b>Both plans include</b><ul><li>Booking, billing and waivers</li><li>Dandy TV for the class and the lobby</li><li>AI programming with member targets</li><li>The DSI and the member app</li><li>The Growth game and Insights</li></ul></div></section>
      <section class="sec">${planCards()}<p class="hmSeat">Card payments run on your own Stripe account at Stripe's standard rates. We add no markup.</p></section>
      <section class="sec" id="compare"><h2 class="hmH2">Compare</h2>
        <div class="tablewrap"><table class="hmCmp plCmp dmCmp"><thead><tr><th><span class="vh">Feature</span></th>${TIERS.map(t => `<th>${t.n}<small>$${t.p}/mo</small></th>`).join('')}</tr></thead>
          ${ROWS.map(([g, rows]) => `<tbody><tr class="plGrp"><th colspan="3" scope="colgroup">${esc(g)}</th></tr>${rows.map(r => `<tr><th scope="row">${esc(r[0])}</th>${r.slice(1).map(c => `<td>${cellOf(c)}</td>`).join('')}</tr>`).join('')}</tbody>`).join('')}</table></div></section>
      <section class="sec"><h2 class="hmH2">Add ons</h2><p class="secSub">Added when you want them. Where a service runs on someone else's meter, you pay that cost plus our fee.</p>
        <div class="dmAdds">${ADDONS.map(([n, d]) => `<div class="formCard"><b>${esc(n)}</b><p class="hint">${esc(d)}</p></div>`).join('')}</div></section>
      <section class="sec"><h2 class="hmH2">Questions owners ask</h2><dl class="hmFaq plFaq">${FAQ.map(([q, a]) => `<div><dt>${esc(q)}</dt><dd>${esc(a)}</dd></div>`).join('')}</dl></section>
      ${endCta()}`)) return;
  };

  /* ---------- switch ---------- */
  VIEWS.switch = async (_, tok) => {
    if (!paint(tok, `
      <section class="plHero"><div><div class="kicker">Switch to Dandy</div><h1 class="plH">Switching takes about a week</h1>
        <p class="hmSub">We move your members, plans, schedule and history from Kilo, Wodify, PushPress, Zen Planner, Mindbody or a spreadsheet. Your members keep their history and see their DSI on day one.</p>
        <div class="row hmCta"><a class="btn" href="/start">Book a setup call</a></div></div>
        <div class="plEvery"><b>What we move</b><ul><li>Members and their contact details</li><li>Membership plans and prices</li><li>Class schedule and coaches</li><li>Attendance history</li><li>Waivers, signed again online once</li></ul></div></section>
      <section class="sec"><ol class="hmSteps plSwitch">
        <li><b>Send us what you have</b><p>Exports from your current system, or a spreadsheet. We tell you exactly what to pull.</p></li>
        <li><b>We set up your office</b><p>Plans, classes, waiver and contract ready, with your members and history in.</p></li>
        <li><b>Members sign in</b><p>They book, sign the waiver once and set up autopay on your Stripe.</p></li>
        <li><b>The TV goes on</b><p>The class TV shows the workout and every member's target; the lobby TV sells.</p></li></ol></section>
      <section class="sec"><div class="secHead"><div><h2 class="hmH2">What you pay now</h2><p class="hmSideSub">Add up what you pay each month, and see it next to Run and Grow.</p></div></div>
        <form class="formCard dmCalc" id="calc"><div class="fields">
          <div class="field"><label for="c-sw">Gym software</label><input id="c-sw" type="number" min="0" inputmode="decimal" placeholder="200"></div>
          <div class="field"><label for="c-web">Website</label><input id="c-web" type="number" min="0" inputmode="decimal" placeholder="300"></div>
          <div class="field"><label for="c-tv">TV or signage</label><input id="c-tv" type="number" min="0" inputmode="decimal" placeholder="0"></div>
          <div class="field"><label for="c-oth">Texting, reviews, other</label><input id="c-oth" type="number" min="0" inputmode="decimal" placeholder="50"></div></div>
          <div class="dmCalcOut" id="calcOut" aria-live="polite"></div></form></section>
      ${endCta('Ready to move?', 'Book a call. We look at what you use now and give you a move date.')}`)) return;
    const out = () => {
      const v = ['c-sw', 'c-web', 'c-tv', 'c-oth'].reduce((a, k) => a + (+$('#' + k).value || 0), 0);
      const row = (n, p, note) => { const d = v - p; return `<div class="dmCalcRow"><b>${n}</b><span>$${fmt(p)} a month</span><em class="${d >= 0 ? 'up' : ''}">${v ? (d >= 0 ? `$${fmt(d)} less than now` : `$${fmt(-d)} more than now`) : note}</em></div>`; };
      $('#calcOut').innerHTML = `<div class="dmCalcRow"><b>You pay now</b><span>$${fmt(v)} a month</span><em>${v ? 'Before card fees' : 'Type your costs above'}</em></div>${row('Run', 249, 'Runs the gym')}${row('Grow', 499, 'Runs the gym and the website')}`;
    };
    $('#calc').oninput = out; $('#calc').onsubmit = e => e.preventDefault(); out();
  };

  /* ---------- for members ---------- */
  VIEWS.members = async (_, tok) => {
    const m = me();
    if (!paint(tok, `
      <section class="plHero"><div><div class="kicker">For members</div><h1 class="plH">A number that proves you are getting stronger</h1>
        <p class="hmSub">The DSI scores your bench, squat, deadlift and clean against lifters your age and size. 500 is the median. Your gym's TV shows your own weight for every workout, worked out from your PRs.</p>
        <div class="row hmCta">${m ? '<a class="btn" href="/boards">See your board</a>' : '<a class="btn" href="/login">Sign in</a><a class="btn ghost" href="/join">Get your DSI free</a>'}</div></div>
        ${sampleBoard()}</section>
      <section class="sec dmDash">${demoTabs('mb', ['member', 'tv'])}</section>
      <section class="sec"><dl class="hmFaq plFaq">
        <div><dt>Is it free?</dt><dd>Yes. The DSI, the boards and the app are free for every member of a Dandy gym.</dd></div>
        <div><dt>What is DSI Pro?</dt><dd>Progress charts, goal plans, an AI coach and readiness from your wearable. It comes with Unlimited at gyms on Grow.</dd></div>
        <div><dt>Who sees my numbers?</dt><dd>Members of your gym. Boards and PRs are behind sign in, not on the open web.</dd></div>
        <div><dt>My gym is not on Dandy yet</dt><dd>Tell your owner about us, or <a href="/start">send us their details</a>.</dd></div></dl></section>`)) return;
    wireDemos();
  };

  /* ---------- members only: what a visitor sees in place of the real boards ---------- */
  X.membersOnly = (tok, what) => paint(tok, `<section class="plHero"><div><div class="kicker">Members only</div><h1 class="plH">${esc(what)} are for members</h1>
      <p class="hmSub">Real names and numbers stay inside each gym. Sign in to see your gym's ${esc(what.toLowerCase())}.</p>
      <div class="row hmCta"><a class="btn" href="/login">Sign in</a><a class="btn ghost" href="/tour">Gym owner? Tour the sample gym</a></div></div>${sampleBoard()}</section>`);

  /* ---------- bring your gym ---------- */
  VIEWS.start = async (_, tok) => {
    const want = new URLSearchParams(location.search).get('tier');
    const m = me();
    if (!paint(tok, `
      <section class="hmStart">
        <div class="hmStartL"><h2>Book your setup call</h2>
          <p class="secSub">Tell us about your gym. We email you within one business day to set a time, then set up your office with you.</p>
          <ol class="hmSteps hmSteps3">
            <li><b>We set up your office</b><p>Your plans, class schedule, waiver and contract, ready to go.</p></li>
            <li><b>We move your members</b><p>From Kilo, Wodify, PushPress or a spreadsheet, with their history.</p></li>
            <li><b>You go live</b><p>Members book online, and the TV shows the day's workout and their targets.</p></li>
          </ol></div>
        <form class="formCard" id="st" novalidate>
          <div class="fields">
            <div class="field w2"><label for="st-g">Gym name</label><input id="st-g" required maxlength="80" autocomplete="organization"></div>
            <div class="field w2"><label for="st-c">City and state</label><input id="st-c" maxlength="80" autocomplete="address-level2"></div>
            <div class="field w2"><label for="st-n">Your name</label><input id="st-n" required maxlength="80" autocomplete="name" value="${m ? esc(m.display_name) : ''}"></div>
            <div class="field w2"><label for="st-e">Email</label><input id="st-e" type="email" required maxlength="160" autocomplete="email"></div>
            <div class="field w2"><label for="st-p">Phone (optional)</label><input id="st-p" type="tel" maxlength="40" autocomplete="tel"></div>
            <div class="field w2"><label for="st-m">Members today</label><input id="st-m" type="number" min="0" max="100000" inputmode="numeric"></div>
            <div class="field w2"><label for="st-s">What you use now</label><select id="st-s"><option value="">Pick one</option>${['Kilo', 'Wodify', 'PushPress', 'Zen Planner', 'Mindbody', 'Spreadsheets and paper', 'Something else'].map(o => `<option>${o}</option>`).join('')}</select></div>
            <div class="field w2"><label for="st-t">Plan you are looking at</label><select id="st-t">${[['unsure', 'Not sure yet'], ...TIERS.map(t => [t.k, `${t.n}, $${t.p}/mo`])].map(([v, n]) => `<option value="${v}"${v === want ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
            <div class="field w4"><label for="st-x">Anything we should know (optional)</label><textarea id="st-x" rows="3" maxlength="1000" placeholder="Like: we want to switch before January, or we run two locations"></textarea></div>
          </div>
          <div class="row"><button class="btn" type="submit">Send</button><span class="hint" id="st-msg" role="status"></span></div>
        </form>
      </section>`)) return;
    $('#st').onsubmit = async e => {
      e.preventDefault();
      const msg = $('#st-msg'), b = e.target.querySelector('button');
      const v = { gym_name: $('#st-g').value.trim(), city: $('#st-c').value.trim() || null, contact_name: $('#st-n').value.trim(), email: $('#st-e').value.trim(), phone: $('#st-p').value.trim() || null,
        members: $('#st-m').value ? Math.max(0, Math.round(+$('#st-m').value)) : null, current_software: $('#st-s').value || null, tier: $('#st-t').value, note: $('#st-x').value.trim() || null };
      if (v.gym_name.length < 2) { msg.textContent = 'Add your gym\'s name.'; $('#st-g').focus(); return; }
      if (v.contact_name.length < 2) { msg.textContent = 'Add your name.'; $('#st-n').focus(); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) { msg.textContent = 'Add an email we can reply to.'; $('#st-e').focus(); return; }
      b.disabled = true; msg.textContent = 'Sending…';
      const { error } = await sb.from('gym_leads').insert(v);
      if (error) {
        console.error(error); b.disabled = false;
        const body = encodeURIComponent(Object.entries(v).filter(([, x]) => x != null && x !== '').map(([k, x]) => `${k.replace(/_/g, ' ')}: ${x}`).join('\n'));
        msg.innerHTML = `That did not send. <a href="mailto:dandy@dandystrength.com?subject=${encodeURIComponent('Bring my gym: ' + v.gym_name)}&body=${body}">Email it to us instead</a>.`;
        return;
      }
      e.target.outerHTML = `<div class="formCard hmSent"><b>Thanks, ${esc(v.contact_name.split(' ')[0])}.</b><p>We have ${esc(v.gym_name)} and will email ${esc(v.email)} within one business day.</p><p><a class="btn ghost" href="/boards">See the boards meanwhile</a></p></div>`;
    };
  };
}
