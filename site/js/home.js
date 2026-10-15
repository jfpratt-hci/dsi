// Dandy Strength public pages.
// /         the homepage: the platform for owners and members, with the live DSI board as proof
// /pricing  Base, Build and Peak, plus DSI Pro seats that gyms resell inside their own tiers
// /start    Bring your gym: a short form that lands in the admin Requests tab

export function install(X) {
  const { sb, S, VIEWS, $, esc, fmt, today, monday, must, paint, loadBoard, loadPeople, nameOf } = X;

  const TIERS = [
    { k: 'base', n: 'Base', p: 99, who: 'Up to 75 members', line: 'The boards, the workouts and the TV in the gym.' },
    { k: 'build', n: 'Build', p: 199, who: 'Unlimited members', line: 'Everything a gym runs on: booking, billing, waivers and staff.' },
    { k: 'peak', n: 'Peak', p: 299, who: 'Gyms that want it all', line: 'Unlimited AI programming and the best Pro seat price.' },
  ];
  // Custom: services on top of any plan. Quoted per gym; outside costs are passed through at cost plus.
  const ADDONS = [
    ['Website build and management', 'A fast gym site with class times, pricing and sign up wired to Dandy Strength. We host it and keep it current.', 'Quoted monthly'],
    ['Review management', 'Ask members for Google reviews after class, reply to every review, and flag the unhappy ones to you first.', 'Quoted monthly'],
    ['SEO and AI search', 'Get found for "CrossFit near me" on Google and in AI answers, with a monthly report.', 'Quoted monthly'],
    ['API access', 'Connect your own tools and pull your gym data out through our API.', 'Quoted by usage'],
    ['Text messaging', 'Class reminders and win back texts to members.', 'Cost plus: carrier fees plus a service fee'],
    ['Paid ads', 'Local ads that send new members to your free class.', 'Cost plus: ad spend plus a management fee'],
  ];
  const customCard = cta => `<div class="hmTier hmCustom"><b>Custom</b><span class="hmAmt hmQuote">Quoted</span><span class="hmWho2">Any plan, plus services</span><p>Website, reviews, SEO and API access, run for you. Priced per gym.</p>${cta ? '<a class="btn sm" href="/start?tier=custom">Talk to us</a>' : ''}</div>`;
  const SEAT = 4, SEAT_PEAK = 3, PRO_RETAIL = '9.99';
  const OWNER = [
    ['Dandy Office', 'Check in, schedule, members, billing, waivers and contracts, staff and attendance, in one office.'],
    ['Dandy Plan', 'Tell it the goal, like Murph prep or a ten week max out, and it writes the cycle as Parts A to D.'],
    ['Dandy TV', 'Signage you manage for every screen: the class TV shows the workout and every member\'s own target weight, live, and the lobby TV shows your schedule, PRs and news.'],
  ];
  // The two screens, shown on the homepage as mini TVs. Decorative mocks; the real ones run at /tv and on the lobby player.
  const TV_ROWS = [['Sam', 225, 'var(--squat)'], ['Alex', 185, 'var(--bench)'], ['Jordan', 205, 'var(--dead)'], ['Riley', 155, 'var(--clean)']];
  // Decorative QR look for the mock: three finder squares plus a fixed scatter. It is not a real code.
  const fakeQr = () => { const n = 21, fin = (x, y) => [[0,0],[14,0],[0,14]].some(([a, b]) => x >= a && x < a + 7 && y >= b && y < b + 7);
    const on = (x, y) => { for (const [a, b] of [[0,0],[14,0],[0,14]]) if (x >= a && x < a + 7 && y >= b && y < b + 7) { const dx = x - a, dy = y - b; return dx === 0 || dy === 0 || dx === 6 || dy === 6 || (dx > 1 && dx < 5 && dy > 1 && dy < 5); }
      return ((x * 7 + y * 13 + x * y * 3) % 5) < 2; };
    let r = ''; for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (on(x, y) && !(fin(x, y) && !on(x, y))) r += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    return `<svg viewBox="-2 -2 25 25" aria-hidden="true" shape-rendering="crispEdges"><rect x="-2" y="-2" width="25" height="25" fill="#fff"/><g fill="#0E1420">${r}</g></svg>`; };
  const VIEWS_TV = [
    { k: 'gym', n: 'Class TV', h: 'The class runs itself',
      p: 'Today\'s workout in Parts A to D, every member\'s own target weight from their PRs, and the class clock right on the screen.',
      t: ['Every member\'s target, worked out from their PRs', 'Part timers and the class clock run from your schedule', 'Coaches enter weights live from their phone'] },
    { k: 'lobby', n: 'Lobby TV', h: 'The front door sells the gym',
      p: 'Your schedule, this week\'s PRs, events and offers rotate on their own, built from what is already in your office.',
      t: ['A QR code on every slide: book, register or order', 'Pick the slides and the order', 'Set how long each slide stays up'] }
  ];
  const tvMock = k => k === 'gym'
    ? `<div class="hmTv" aria-hidden="true"><div class="hmTvTop"><b>Part B · Back squat</b><span>5 x 3 at 85%</span></div>
        <ol class="hmTvRows">${TV_ROWS.map(([n, w, c]) => `<li><i style="--c:${c}"></i><span>${n}</span><b>${w}</b></li>`).join('')}</ol>
        <div class="hmTvFoot"><span>6:30am class</span><span>Coach Jesse</span></div></div>`
    : `<div class="hmTv hmSign" aria-hidden="true"><div class="hmSignL"><span class="hmSignK">Event · Memorial Day</span><b>Murph</b><span class="hmSignN">46 spots left</span><span class="hmSignBar"><i></i></span></div>
        <div class="hmSignQ">${fakeQr()}<span>Scan to sign up</span></div></div>`;
  const SCREENS = () => `
      <section class="hmScreens" aria-labelledby="hmScreensH">
        <div class="hmScreensHead"><h2 class="hmH2" id="hmScreensH">Dandy TV</h2>
          <p class="hmSideSub">One product for every screen in the gym. Plug in a TV and make it yours. Run the class TV on the floor and the lobby TV at the front door.</p></div>
        <div class="hmTvTabs" role="tablist" aria-label="Dandy TV screens">${VIEWS_TV.map((v, i) => `<button type="button" role="tab" id="tvtab-${v.k}" aria-controls="tvpanel-${v.k}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-tvtab="${v.k}">${v.n}${v.soon ? ' <span class="hmNew">Coming soon</span>' : ''}</button>`).join('')}</div>
        ${VIEWS_TV.map((v, i) => `<div class="hmScreen" role="tabpanel" id="tvpanel-${v.k}" aria-labelledby="tvtab-${v.k}"${i ? ' hidden' : ''}>${tvMock(v.k)}
          <div class="hmScreenTx"><h3 class="hmH3">${v.h}</h3><p>${v.p}</p><ul class="hmTicks">${v.t.map(x => `<li>${x}</li>`).join('')}</ul>
            <p class="hmFine">Both screens run on any smart TV, laptop or iPad on HDMI, and you customize each one from your office.</p></div></div>`).join('')}
      </section>`;
  const wireTvTabs = () => {
    const tabs = [...document.querySelectorAll('[data-tvtab]')]; if (!tabs.length) return;
    const pick = b => tabs.forEach(t => { const on = t === b; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; document.getElementById('tvpanel-' + t.dataset.tvtab).hidden = !on; });
    tabs.forEach((b, i) => { b.addEventListener('click', () => pick(b)); b.addEventListener('keydown', e => { const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return; const n = tabs[(i + d + tabs.length) % tabs.length]; pick(n); n.focus(); }); });
  };
  const MEMBER = [
    ['DSI', 'The Dandy Strength Index scores your bench, squat, deadlift and clean against lifters your age and size.'],
    ['The Dandy app', 'Log your lifts, see your target for today and watch your DSI move. Coming to the App Store.'],
    ['DSI Pro', 'Progress charts, goal plans and an AI coach that knows your numbers. Often included in your gym\'s plan.'],
  ];
  const DAY = [
    ['The coach writes the cycle', 'Dandy Plan drafts weeks of class days from the gym\'s goals. The coach edits and posts.'],
    ['Members book and pay', 'They reserve a spot, sign the waiver once and pay on autopay through the gym\'s own Stripe.'],
    ['The board shows every target', 'Each member walks in to their own weight for today, worked out from their PRs.'],
    ['Scores post and the DSI moves', 'Results go up, PRs hit the wall, and the gym climbs the league.'],
  ];
  const plates = '<span class="hmPlates" aria-hidden="true"><i style="--c:var(--bench)"></i><i style="--c:var(--squat)"></i><i style="--c:var(--dead)"></i><i style="--c:var(--clean)"></i></span>';
  const me = () => S.me && S.me.display_name ? S.me : null;

  /* ---------- homepage ---------- */
  VIEWS[''] = async (_, tok) => {
    const [board, , gres, prs] = await Promise.all([loadBoard(), loadPeople(), sb.from('gyms').select('id,name'), sb.from('pr_feed').select('profile_id').gte('performed_on', monday(today())).limit(500)]);
    const gymName = new Map(((gres && gres.data) || []).map(g => [g.id, g.name]));
    const top = [...board].filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 6);
    const max = top.length ? top[0].score : 1;
    const weekPRs = ((prs && prs.data) || []).length;
    const m = me();
    const office = (S.myGyms || [])[0];
    const ctas = office ? `<a class="btn" href="/club/${office.gym_id}?tab=today">Open your gym office</a><a class="btn ghost" href="/boards">See the boards</a>`
      : m ? `<a class="btn" href="/boards">See the boards</a><a class="btn ghost" href="/start">Bring your gym</a>`
      : `<a class="btn" href="/start">Bring your gym</a><a class="btn ghost" href="/join">Get your DSI free</a>`;
    if (!paint(tok, `
      <section class="hmHero">
        <div class="hmLead">
          <h1 class="hmH">Run the gym.<br>Rank the strength.${plates}</h1>
          <p class="hmSub">Dandy Strength is the gym platform built with AI. Classes, billing, waivers, staff and programming in one place, plus the DSI: a score that ranks every member against lifters their age and size.</p>
          <div class="row hmCta">${ctas}</div>
        </div>
        <aside class="hmBoard" aria-label="Live DSI leaderboard">
          <div class="hmBoardH"><b>Live on the DSI</b><span>${fmt(board.length)} lifters, ${fmt(weekPRs)} PR${weekPRs === 1 ? '' : 's'} this week</span></div>
          <ol class="hmRows">${top.map((r, i) => `<li><span class="hmPos">${i + 1}</span><span class="hmWho"><b>${esc(nameOf(r.profile_id))}</b><small>${esc(gymName.get(r.gym_id) || 'Independent')}</small></span><span class="hmBar"><i style="width:${Math.max(8, Math.round(r.score / max * 100))}%"></i></span><span class="hmScore">${r.score}</span></li>`).join('') || '<li class="hmEmpty">The first lifters are logging now.</li>'}</ol>
          <a class="hmMore" href="/boards">See the full board</a>
        </aside>
      </section>

      <section class="hmSplit">
        <div class="hmSide"><h2 class="hmH2">For gym owners</h2><p class="hmSideSub">Everything the gym runs on, in one office.</p>
          <dl class="hmParts">${OWNER.map(([n, d]) => `<div><dt>${esc(n)}</dt><dd>${esc(d)}</dd></div>`).join('')}</dl>
          <a class="btn ghost" href="/pricing">See plans</a></div>
        <div class="hmSide"><h2 class="hmH2">For members</h2><p class="hmSideSub">A number that proves you are getting stronger.</p>
          <dl class="hmParts">${MEMBER.map(([n, d]) => `<div><dt>${esc(n)}</dt><dd>${esc(d)}</dd></div>`).join('')}</dl>
          <a class="btn ghost" href="${m ? '/boards' : '/join'}">${m ? 'See where you rank' : 'Get your DSI free'}</a></div>
      </section>
${SCREENS()}

      <section class="hmDay">
        <h2 class="hmH2">How a class day runs on Dandy Strength</h2>
        <ol class="hmSteps">${DAY.map(([n, d]) => `<li><b>${esc(n)}</b><p>${esc(d)}</p></li>`).join('')}</ol>
      </section>

      <section class="hmPrice">
        <div class="hmPriceHead"><h2 class="hmH2">Simple pricing, and it can pay for itself</h2>
          <p class="hmSideSub">Card payments run on your own Stripe account at Stripe's rates. We add no markup.</p></div>
        <div class="hmTiers">${TIERS.map(t => `<div class="hmTier"><b>${t.n}</b><span class="hmAmt">$${t.p}<small>/mo</small></span><span class="hmWho2">${esc(t.who)}</span><p>${esc(t.line)}</p></div>`).join('')}${customCard(false)}</div>
        <p class="hmSeat"><b>DSI Pro seats, $${SEAT} per member a month.</b> Put Pro in a Plus tier at $10 more and each Plus member nets you $${10 - SEAT}. Forty Plus members cover the Build plan with $41 to spare.</p>
        <div class="row"><a class="btn" href="/pricing">Compare plans</a><a class="btn ghost" href="/start">Bring your gym</a></div>
      </section>

      <section class="hmSwitch">
        <div><h2 class="hmH2">Coming from Kilo, Wodify or PushPress?</h2>
        <p class="hmSideSub">We move your members, schedule and plans over for you, and your members keep their history. The difference they notice on day one: a score worth chasing, and their own number on the TV.</p></div>
        <a class="btn" href="/start">Talk to us about switching</a>
      </section>`)) return;
    wireTvTabs();
  };

  /* ---------- plans: sells the gym plans and compares every feature ---------- */
  // Each card says what it adds over the one before; the table compares every feature by what owners care about.
  const CARD = {
    base: ['The DSI boards, PR wall and gym league', 'Workouts in Parts A to D, results and Log a class', 'Dandy TV for classes and the lobby', 'Class booking and check in'],
    build: ['Everything in Base, for unlimited members', 'Billing, invoices and autopay on your Stripe', 'Waivers and contracts signed online', 'Staff, coach swaps, hours, attendance', 'Dandy Plan AI programming, 4 weeks a month'],
    peak: ['Everything in Build', 'Unlimited Dandy Plan AI programming', 'DSI Pro seats at $3 instead of $4', 'Payroll export and multiple locations as they ship'],
  };
  const EVERY = ['The DSI score and leaderboards', 'Dandy TV signage for classes and the lobby', 'Workouts in Parts A to D', 'Class booking and check in', 'My training for every member', 'Month to month, no contract'];
  const GROUPS = [
    ['Members and the DSI', [
      ['DSI score, leaderboards, PR wall and gym league', 'y', 'y', 'y'],
      ['Member app and member accounts', 'y', 'y', 'y'],
      ['My training: members log their own sessions', 'y', 'y', 'y'],
      ['DSI Pro seats for your members', `$${SEAT} a member`, `$${SEAT} a member`, `$${SEAT_PEAK} a member`],
    ]],
    ['Running the floor', [
      ['Workouts in Parts A to D with member targets', 'y', 'y', 'y'],
      ['Log a class: coaches type weights live', 'y', 'y', 'y'],
      ['Dandy TV for classes and the lobby', 'y', 'y', 'y'],
      ['Class schedule, booking and check in', 'y', 'y', 'y'],
      ['Attendance history for every member', '', 'y', 'y'],
    ]],
    ['Running the business', [
      ['Members', 'Up to 75', 'Unlimited', 'Unlimited'],
      ['Billing, invoices and autopay through your own Stripe', '', 'y', 'y'],
      ['Waivers and membership contracts, signed online', '', 'y', 'y'],
      ['Staff, coach swaps, hours and pay', '', 'y', 'y'],
      ['Payroll export', '', '', 'As it ships in 2027'],
      ['Multiple locations', '', '', 'As it ships in 2027'],
    ]],
    ['Built with AI', [
      ['Dandy Plan: cycles from a day to a quarter, from your goals', '', '4 weeks a month', 'Unlimited'],
      ['Import workouts from a web page, photo or text', 'y', 'y', 'y'],
      ['AI coach for members', 'With Pro seats', 'With Pro seats', 'With Pro seats'],
    ]],
    ['Custom services', [
      ['Website, review management, SEO, API access', 'Add on', 'Add on', 'Add on'],
      ['Text messaging and paid ads', 'Cost plus', 'Cost plus', 'Cost plus'],
    ]],
  ];
  const cellOf = c => c === 'y' ? '<span class="plY" aria-hidden="true"></span><span class="vh">Included</span>' : c ? esc(c) : '<span class="plN" aria-hidden="true"></span><span class="vh">Not included</span>';

  VIEWS.pricing = async (_, tok) => {
    if (!paint(tok, `
      <section class="plHero">
        <div><h1 class="plH">Plans for gyms that want members to stay</h1>
          <p class="hmSub">Run classes, billing, waivers, staff and programming in one place, and give every member a score worth chasing. Month to month, and we move you over for you.</p>
          <div class="row hmCta"><a class="btn" href="/start">Bring your gym</a><a class="btn ghost" href="#compare">Compare every feature</a></div></div>
        <div class="plEvery"><b>Every plan includes</b><ul>${EVERY.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
      </section>
      <section class="sec">
        <div class="plCards">${TIERS.map(t => `<article class="plCard"><b class="plName">${t.n}</b><span class="hmAmt">$${t.p}<small>/mo</small></span><span class="hmWho2">${esc(t.who)}</span>
            <ul class="plList">${CARD[t.k].map(x => `<li>${esc(x)}</li>`).join('')}</ul><a class="btn" href="/start?tier=${t.k}">Start on ${t.n}</a></article>`).join('')}
          <article class="plCard plCustom"><b class="plName">Custom</b><span class="hmAmt hmQuote">Quoted</span><span class="hmWho2">Any plan, plus services</span>
            <ul class="plList"><li>Website build and management</li><li>Review management</li><li>SEO and AI search</li><li>API access</li><li>Texts and ads at cost plus</li></ul><a class="btn ghost" href="/start?tier=custom">Get a quote</a></article></div>
        <p class="hmSeat">Card payments run on your own Stripe account at Stripe's standard rates. We add no markup.</p>
      </section>
      <section class="sec" id="compare"><h2 class="hmH2">Compare every feature</h2>
        <div class="tablewrap"><table class="hmCmp plCmp"><thead><tr><th><span class="vh">Feature</span></th>${TIERS.map(t => `<th>${t.n}<small>$${t.p}/mo</small></th>`).join('')}</tr></thead>
          ${GROUPS.map(([g, rows]) => `<tbody><tr class="plGrp"><th colspan="4" scope="colgroup">${esc(g)}</th></tr>${rows.map(r => `<tr><th scope="row">${esc(r[0])}</th>${r.slice(1).map(c => `<td>${cellOf(c)}</td>`).join('')}</tr>`).join('')}</tbody>`).join('')}
        </table></div>
      </section>
      <section class="sec"><h2 class="hmH2">Custom services</h2>
        <p class="secSub">Add any of these to Base, Build or Peak. Each gym gets a quote. Where a service runs on someone else's meter, like texts or ad spend, you pay that cost plus our fee.</p>
        <div class="tablewrap"><table class="hmCmp hmAdd"><thead><tr><th>Service</th><th>What we do</th><th>How it's priced</th></tr></thead><tbody>
          ${ADDONS.map(([n, d, pr]) => `<tr><th scope="row"><b>${esc(n)}</b></th><td>${esc(d)}</td><td>${esc(pr)}</td></tr>`).join('')}
        </tbody></table></div>
      </section>
      <section class="sec hmProSec"><div><h2 class="hmH2">DSI Pro pays for itself</h2>
        <p>Your gym buys DSI Pro seats at $${SEAT} a member a month ($${SEAT_PEAK} on Peak), against $${PRO_RETAIL} for a lifter on their own. Put Pro in a Plus membership at $10 more a month, and the members who want it pay for it.</p></div>
        <div class="tablewrap"><table class="hmMath"><caption>A 120 member gym on Build where 40 members choose Plus</caption><tbody>
          <tr><th scope="row">Plus revenue, 40 at $10</th><td>$400</td></tr>
          <tr><th scope="row">DSI Pro seats, 40 at $${SEAT}</th><td>($160)</td></tr>
          <tr><th scope="row">Build plan</th><td>($199)</td></tr>
          <tr class="sum"><th scope="row">Left over each month</th><td>$41</td></tr>
        </tbody></table></div>
      </section>
      <section class="sec"><h2 class="hmH2">Switching takes a week, not a season</h2>
        <ol class="hmSteps plSwitch">
          <li><b>Send us what you have</b><p>Your member list, plans and class schedule, from Kilo, Wodify, PushPress or a spreadsheet.</p></li>
          <li><b>We set up your office</b><p>Plans, classes, waiver and contract ready, with your members and their history moved over.</p></li>
          <li><b>Your members sign in</b><p>They book online, sign the waiver once and see their DSI on day one.</p></li>
          <li><b>The TV goes on</b><p>Dandy TV shows the day's workout and every member's own target in class, and your schedule and PRs in the lobby.</p></li>
        </ol>
      </section>
      <section class="sec"><h2 class="hmH2">Questions owners ask</h2>
        <dl class="hmFaq plFaq">
          <div><dt>Is there a contract?</dt><dd>No. Plans are month to month, and you can move between plans any time.</dd></div>
          <div><dt>Who handles the switch?</dt><dd>We do. Send us your member list, plans and class schedule, and we set up your office before your first class on Dandy Strength.</dd></div>
          <div><dt>Do members pay for the app?</dt><dd>No. The DSI, the app and My training are free for every member. Pro is the upgrade, and your gym decides whether to include it.</dd></div>
          <div><dt>What do card payments cost?</dt><dd>Stripe's standard rates, paid to Stripe. Money goes straight to your own Stripe account, and we add nothing on top.</dd></div>
          <div><dt>What is cost plus?</dt><dd>For services that run on someone else's meter, like text messages or ad spend, you pay that cost plus our fee. Everything else is a fixed monthly price.</dd></div>
          <div><dt>Which plan should I start on?</dt><dd>If you bill members online, start on Build. If you only want the boards, the workouts and the TV, start on Base and move up when you are ready.</dd></div>
        </dl>
      </section>
      <section class="sec plEnd"><div><h2 class="hmH2">Bring your gym to Dandy Strength</h2><p class="hmSideSub">Tell us about your gym and we reply within one business day.</p></div><a class="btn" href="/start">Bring your gym</a></section>`)) return;
  };

  /* ---------- bring your gym ---------- */
  VIEWS.start = async (_, tok) => {
    const want = new URLSearchParams(location.search).get('tier');
    const m = me();
    if (!paint(tok, `
      <section class="hmStart">
        <div class="hmStartL"><h2>Bring your gym to Dandy Strength</h2>
          <p class="secSub">Tell us about your gym. We reply within one business day and set up your office with you.</p>
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
            <div class="field w2"><label for="st-t">Plan you are looking at</label><select id="st-t">${[['unsure', 'Not sure yet'], ...TIERS.map(t => [t.k, `${t.n}, $${t.p}/mo`]), ['custom', 'Custom services']].map(([v, n]) => `<option value="${v}"${v === want ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
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
