// Dandy Strength public pages.
// /         the homepage: the platform for owners and members, with the live DSI board as proof
// /pricing  Base, Build and Peak, plus DSI Pro seats that gyms resell inside their own tiers
// /start    Bring your gym: a short form that lands in the admin Requests tab

export function install(X) {
  const { sb, S, VIEWS, $, esc, fmt, today, monday, must, paint, loadBoard, loadPeople, nameOf } = X;

  const TIERS = [
    { k: 'base', n: 'Base', p: 99, who: 'Up to 75 members', line: 'The boards, the workouts and the TV in the gym.' },
    { k: 'build', n: 'Build', p: 179, who: 'Unlimited members', line: 'Everything a gym runs on: booking, billing, waivers and staff.' },
    { k: 'peak', n: 'Peak', p: 279, who: 'Gyms that want it all', line: 'Unlimited AI programming and the best Pro seat price.' },
  ];
  const SEAT = 4, SEAT_PEAK = 3, PRO_RETAIL = '9.99';
  const OWNER = [
    ['Dandy Office', 'Check in, schedule, members, billing, waivers and contracts, staff and attendance, in one office.'],
    ['Dandy Plan', 'Tell it the goal, like Murph prep or a ten week max out, and it writes the cycle as Parts A to D.'],
    ['Dandy Board', 'The TV in your gym shows the workout and every member\'s own target weight, live.'],
  ];
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
          <a class="btn ghost" href="/pricing">See pricing</a></div>
        <div class="hmSide"><h2 class="hmH2">For members</h2><p class="hmSideSub">A number that proves you are getting stronger.</p>
          <dl class="hmParts">${MEMBER.map(([n, d]) => `<div><dt>${esc(n)}</dt><dd>${esc(d)}</dd></div>`).join('')}</dl>
          <a class="btn ghost" href="${m ? '/boards' : '/join'}">${m ? 'See where you rank' : 'Get your DSI free'}</a></div>
      </section>

      <section class="hmDay">
        <h2 class="hmH2">How a class day runs on Dandy Strength</h2>
        <ol class="hmSteps">${DAY.map(([n, d]) => `<li><b>${esc(n)}</b><p>${esc(d)}</p></li>`).join('')}</ol>
      </section>

      <section class="hmPrice">
        <div class="hmPriceHead"><h2 class="hmH2">Simple pricing, and it can pay for itself</h2>
          <p class="hmSideSub">Card payments run on your own Stripe account at Stripe's rates. We add no markup.</p></div>
        <div class="hmTiers">${TIERS.map(t => `<div class="hmTier"><b>${t.n}</b><span class="hmAmt">$${t.p}<small>/mo</small></span><span class="hmWho2">${esc(t.who)}</span><p>${esc(t.line)}</p></div>`).join('')}</div>
        <p class="hmSeat"><b>DSI Pro seats, $${SEAT} per member a month.</b> Put Pro in a Plus tier at $10 more and each Plus member nets you $${10 - SEAT}. Forty Plus members cover the Build plan with $61 to spare.</p>
        <div class="row"><a class="btn" href="/pricing">Full pricing</a><a class="btn ghost" href="/start">Bring your gym</a></div>
      </section>

      <section class="hmSwitch">
        <div><h2 class="hmH2">Coming from Kilo, Wodify or PushPress?</h2>
        <p class="hmSideSub">We move your members, schedule and plans over for you, and your members keep their history. The difference they notice on day one: a score worth chasing, and their own number on the TV.</p></div>
        <a class="btn" href="/start">Talk to us about switching</a>
      </section>`)) return;
  };

  /* ---------- pricing ---------- */
  VIEWS.pricing = async (_, tok) => {
    const Y = 'Included', N = '';
    const rows = [
      ['Members', 'Up to 75', 'Unlimited', 'Unlimited'],
      ['DSI boards, PR wall and gym league', Y, Y, Y],
      ['Workouts in Parts A to D, results', Y, Y, Y],
      ['Dandy Board for the TV', Y, Y, Y],
      ['Class booking and check in', Y, Y, Y],
      ['Billing, invoices and autopay', N, Y, Y],
      ['Waivers and contracts, signed online', N, Y, Y],
      ['Staff, coach swaps, hours and pay', N, Y, Y],
      ['Attendance history', N, Y, Y],
      ['Dandy Plan AI programming', N, 'Up to 4 weeks a month', 'Unlimited'],
      ['DSI Pro seats', `$${SEAT} a member`, `$${SEAT} a member`, `$${SEAT_PEAK} a member`],
      ['Payroll export, gym website, multiple locations', N, N, 'As they ship in 2027'],
    ];
    if (!paint(tok, `
      <section class="sec"><div class="secHead"><div><h2>Pricing</h2>
        <p class="secSub">Three plans for the gym, billed monthly. Card payments run on your own Stripe account at Stripe's standard rates, and we add no markup.</p></div></div>
        <div class="hmTiers">${TIERS.map(t => `<div class="hmTier"><b>${t.n}</b><span class="hmAmt">$${t.p}<small>/mo</small></span><span class="hmWho2">${esc(t.who)}</span><p>${esc(t.line)}</p><a class="btn sm" href="/start?tier=${t.k}">Start on ${t.n}</a></div>`).join('')}</div>
      </section>
      <section class="sec"><h3 class="hmH3">What each plan includes</h3>
        <div class="tablewrap"><table class="hmCmp"><thead><tr><th></th>${TIERS.map(t => `<th>${t.n}</th>`).join('')}</tr></thead><tbody>
          ${rows.map(r => `<tr><th scope="row">${esc(r[0])}</th>${r.slice(1).map(c => `<td${c ? '' : ' class="no"'}>${c ? esc(c) : '<span class="vh">Not included</span>'}</td>`).join('')}</tr>`).join('')}
        </tbody></table></div>
      </section>
      <section class="sec hmProSec"><div><h3 class="hmH3">DSI Pro pays for itself</h3>
        <p>Your gym buys DSI Pro seats at $${SEAT} a member a month ($${SEAT_PEAK} on Peak), against $${PRO_RETAIL} for a lifter on their own. Add Pro to a Plus membership at $10 more a month, and the members who want it pay for it.</p></div>
        <div class="tablewrap"><table class="hmMath"><caption>A 120 member gym on Build where 40 members choose Plus</caption><tbody>
          <tr><th scope="row">Plus revenue, 40 at $10</th><td>$400</td></tr>
          <tr><th scope="row">DSI Pro seats, 40 at $${SEAT}</th><td>($160)</td></tr>
          <tr><th scope="row">Build plan</th><td>($179)</td></tr>
          <tr class="sum"><th scope="row">Left over each month</th><td>$61</td></tr>
        </tbody></table></div>
      </section>
      <section class="sec"><h3 class="hmH3">Questions owners ask</h3>
        <dl class="hmFaq">
          <div><dt>Is there a contract?</dt><dd>No. Plans are month to month and you can change tiers any time.</dd></div>
          <div><dt>Who handles the switch?</dt><dd>We do. Send us your member list, plans and class schedule, and we set up your office before your first class on Dandy Strength.</dd></div>
          <div><dt>Do members have to pay for the app?</dt><dd>No. The DSI and the app are free for every member. Pro is the upgrade, and your gym decides whether to include it.</dd></div>
        </dl>
        <div class="row"><a class="btn" href="/start">Bring your gym</a></div>
      </section>`)) return;
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
