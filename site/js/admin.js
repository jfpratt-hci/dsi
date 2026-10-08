// Management dashboard for the Founder: /admin?tab=members|gyms|requests
// Members: find anyone, fix their profile, set their gym, role and plan.
// Gyms: create gyms, edit name, city and big screen link, assign owners and coaches.
// Requests: gym owner requests, plus counts and links for reports and protests.

export function install(X) {
  const { sb, D, S, VIEWS, $, $$, esc, num, fmt, fmtD, today, toast, must, paint, needLogin, loadBoard, route } = X;
  const SLUG = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/;
  const isAdmin = () => !!S.me && S.me.role === 'admin';
  const ageOf = by => (by ? new Date().getFullYear() - by : '');
  const proOn = p => p.tier === 'pro' || (p.pro_until && Date.parse(p.pro_until) > Date.now());
  const day = t => (t ? fmtD(String(t).slice(0, 10)) : '');
  const opts = (list, cur) => list.map(([v, n]) => `<option value="${esc(v)}"${String(cur ?? '') === String(v) ? ' selected' : ''}>${esc(n)}</option>`).join('');

  VIEWS.admin = async (_, tok) => {
    if (!S.me) return needLogin(tok, 'manage DSI');
    if (!isAdmin()) return paint(tok, '<section class="prEmpty"><b>Founder only</b><p>The management dashboard is for the DSI Founder.</p></section>');
    const qs = new URLSearchParams(location.search), tab = ['members', 'gyms', 'requests'].includes(qs.get('tab')) ? qs.get('tab') : 'members';
    const [profiles, gyms, staff, claims, reps, prots, ws, , leadsR] = await Promise.all([
      sb.from('profiles').select('*').order('created_at', { ascending: false }).then(must),
      sb.from('gyms').select('*').order('name').then(must),
      sb.from('gym_staff').select('gym_id,profile_id,role').then(must),
      sb.from('gym_claims').select('*').eq('status', 'pending').order('created_at').then(must),
      sb.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open'),
      sb.from('protests').select('id', { count: 'exact', head: true }).eq('status', 'open'),
      sb.from('workouts').select('gym_id,day').not('gym_id', 'is', null).order('day', { ascending: false }).limit(500).then(must),
      loadBoard(),
      sb.from('gym_leads').select('*').order('created_at', { ascending: false }).limit(200),
    ]);
    const leads = (leadsR && leadsR.data) || [], newLeads = leads.filter(l => l.status === 'new').length;
    const byId = new Map(profiles.map(p => [p.id, p])), gymBy = new Map(gyms.map(g => [g.id, g]));
    const nm = id => (byId.get(id) || {}).display_name || 'Unfinished signup';
    const scoreOf = id => (S.board.find(r => r.profile_id === id) || {}).score || 0;
    const weekAgo = Date.now() - 7 * 864e5;
    const stats = [
      ['Members', profiles.filter(p => p.display_name).length, `${profiles.filter(p => Date.parse(p.created_at) > weekAgo).length} new this week`],
      ['DSI Pro', profiles.filter(proOn).length, 'paid or given'],
      ['Gyms', gyms.length, `${gyms.filter(g => staff.some(s => s.gym_id === g.id && s.role === 'owner')).length} with an owner`],
      ['Gym requests', claims.length + newLeads, claims.length + newLeads ? 'waiting on you' : 'all clear'],
      ['Open reports', reps.count || 0, 'answer within 24 hours'],
      ['Open protests', prots.count || 0, "the Commissioner's court"],
    ];
    const tabs = [['members', 'Members'], ['gyms', 'Gyms'], ['requests', `Requests${claims.length + newLeads ? ' · ' + (claims.length + newLeads) : ''}`]];

    let body = '';
    if (tab === 'members') {
      body = `<div class="row adSearch"><label class="vh" for="ad-q">Search members</label><input id="ad-q" placeholder="Search by name, gym, role or plan" value="${esc(qs.get('q') || '')}" style="max-width:360px"><span class="hint" id="ad-n"></span></div>
        <div class="board"><div class="tablewrap"><table class="adT"><thead><tr><th>Member</th><th>Gym</th><th>Sex</th><th class="r">Age</th><th class="r">BW</th><th class="r">DSI</th><th>Role</th><th>Plan</th><th>Joined</th><th></th></tr></thead><tbody id="ad-rows"></tbody></table></div></div>`;
    } else if (tab === 'gyms') {
      const members = id => profiles.filter(p => p.gym_id === id && p.display_name).length;
      const lastDay = id => (ws.find(w => w.gym_id === id) || {}).day;
      const named = profiles.filter(p => p.display_name).sort((a, b) => a.display_name.localeCompare(b.display_name));
      body = `<div class="board"><div class="tablewrap"><table class="adT"><thead><tr><th>Gym</th><th>City</th><th>Big screen</th><th class="r">Members</th><th>Owners</th><th>Coaches</th><th>Last workout</th><th></th></tr></thead><tbody>
        ${gyms.map(g => { const st = staff.filter(s => s.gym_id === g.id), own = st.filter(s => s.role === 'owner'), co = st.filter(s => s.role === 'coach');
          return `<tr><td><b><a href="/gyms/${g.id}">${esc(g.name)}</a></b></td><td>${esc(g.city || '')}</td><td>${g.slug ? `<a href="/tv/${esc(g.slug)}" target="_blank">/tv/${esc(g.slug)}</a>` : '<span class="sub">not set</span>'}</td><td class="r n">${members(g.id)}</td>
            <td>${own.map(s => esc(nm(s.profile_id))).join(', ') || '<span class="pill flat">None</span>'}</td><td>${co.map(s => esc(nm(s.profile_id))).join(', ') || '<span class="sub">none</span>'}</td><td>${lastDay(g.id) ? esc(fmtD(lastDay(g.id))) : '<span class="sub">never</span>'}</td>
            <td class="r"><a class="btn ghost sm" href="/club/${g.id}">Office</a> <button class="btn ghost sm" data-eg="${g.id}">Edit</button></td></tr>
            <tr class="adEdit" data-egf="${g.id}" hidden><td colspan="8"><form class="adForm" data-gf="${g.id}"><div class="fields">
              <div class="field w2"><label>Name</label><input data-k="name" maxlength="60" required value="${esc(g.name)}"></div>
              <div class="field"><label>City</label><input data-k="city" maxlength="60" value="${esc(g.city || '')}"></div>
              <div class="field"><label>Big screen link /tv/</label><input data-k="slug" maxlength="40" value="${esc(g.slug || '')}" autocapitalize="none" spellcheck="false"></div></div>
              <div class="row"><button class="btn sm">Save gym</button><a class="btn sm" href="/club/${g.id}">Open gym office</a><a class="btn ghost sm" href="/gym/${g.id}">Gym settings</a><a class="btn ghost sm" href="/wod/${g.id}">Edit workouts</a><a class="btn ghost sm" href="/results/${g.id}">Enter results</a><span class="hint" data-msg></span></div></form>
              <div class="adStaff"><div class="formH">Owners and coaches</div>
                ${st.map(s => `<div class="row"><b>${esc(nm(s.profile_id))}</b><span class="pill${s.role === 'owner' ? ' acc' : ''}">${s.role === 'owner' ? 'Owner' : 'Coach'}</span><button class="btn ghost sm" data-rms="${g.id}|${s.profile_id}">Remove</button></div>`).join('') || '<p class="hint">Nobody runs this gym yet.</p>'}
                <form class="row" data-as="${g.id}"><select data-p style="max-width:240px"><option value="">Add anyone on DSI…</option>${named.filter(p => !st.some(s => s.profile_id === p.id)).map(p => `<option value="${p.id}">${esc(p.display_name)}${p.gym_id && p.gym_id !== g.id ? ' (' + esc((gymBy.get(p.gym_id) || {}).name || '') + ')' : ''}</option>`).join('')}</select><select data-r style="max-width:130px"><option value="coach">Coach</option><option value="owner">Owner</option></select><button class="btn sm">Add</button></form></div></td></tr>`; }).join('') || '<tr><td colspan="8" class="empty">No gyms yet.</td></tr>'}
        </tbody></table></div></div>
        <form class="formCard" id="ng" style="margin-top:20px"><div class="formH">New gym</div><div class="fields">
          <div class="field w2"><label for="ng-n">Name</label><input id="ng-n" maxlength="60" minlength="3" required></div>
          <div class="field"><label for="ng-c">City</label><input id="ng-c" maxlength="60" placeholder="Milford, OH"></div>
          <div class="field"><label for="ng-s">Big screen link /tv/</label><input id="ng-s" maxlength="40" autocapitalize="none" spellcheck="false"></div>
          <div class="field w2"><label for="ng-o">Owner (optional)</label><select id="ng-o"><option value="">No owner yet</option>${named.map(p => `<option value="${p.id}">${esc(p.display_name)}</option>`).join('')}</select></div></div>
          <div class="row"><button class="btn">Create gym</button><span class="hint" id="ng-msg"></span></div></form>`;
    } else {
      body = `<h3>New <span>gym leads</span></h3><p class="secSub">Owners who asked to come aboard from the Bring your gym page.</p><div class="board"><div class="tablewrap"><table class="adT"><thead><tr><th>Gym</th><th>Contact</th><th class="r">Members</th><th>Uses now</th><th>Plan</th><th>Note</th><th>Asked</th><th>Status</th></tr></thead><tbody>
        ${leads.map(l => `<tr><td><b>${esc(l.gym_name)}</b><div class="sub">${esc(l.city || '')}</div></td><td>${esc(l.contact_name)}<div class="sub"><a href="mailto:${esc(l.email)}">${esc(l.email)}</a>${l.phone ? ' ' + esc(l.phone) : ''}</div></td><td class="r n">${l.members ?? ''}</td><td>${esc(l.current_software || '')}</td><td>${esc(l.tier || '')}</td><td>${esc(l.note || '')}</td><td>${esc(day(l.created_at))}</td><td><select data-lead="${l.id}" aria-label="Status for ${esc(l.gym_name)}">${['new', 'contacted', 'won', 'lost'].map(v => `<option${v === l.status ? ' selected' : ''}>${v}</option>`).join('')}</select></td></tr>`).join('') || '<tr><td colspan="8" class="empty">No leads yet. They arrive from dandystrength.com/start.</td></tr>'}
        </tbody></table></div></div>
        <h3 style="margin-top:28px">Gym owner <span>requests</span></h3><div class="board"><div class="tablewrap"><table class="adT"><thead><tr><th>Lifter</th><th>Gym</th><th>Their note</th><th>Asked</th><th></th></tr></thead><tbody>
        ${claims.map(c => `<tr><td><a href="/u/${c.profile_id}">${esc(nm(c.profile_id))}</a></td><td><a href="/gyms/${c.gym_id}">${esc((gymBy.get(c.gym_id) || {}).name || '')}</a></td><td>${esc(c.note || '')}</td><td>${esc(day(c.created_at))}</td><td class="r"><button class="btn sm" data-cl="${c.id}" data-ok="1">Approve</button> <button class="btn ghost sm" data-cl="${c.id}">Decline</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No requests waiting.</td></tr>'}
        </tbody></table></div></div>
        <div class="tools" style="margin-top:20px"><a class="tool" href="/reports"><b>Reports · ${reps.count || 0} open</b><span>Chat and profile reports. Answer within 24 hours.</span></a><a class="tool" href="/protests"><b>Protests · ${prots.count || 0} open</b><span>Lifts and logs under protest.</span></a></div>`;
    }

    if (!paint(tok, `<section class="sec"><div class="secHead"><div><div class="kicker">Founder tools</div><h2>Management <span>dashboard</span></h2><p class="secSub">Members, gyms and everything waiting on you.</p></div></div>
      <div class="adStats">${stats.map(([k, v, s]) => `<div class="adStat"><span>${esc(k)}</span><b>${fmt(v)}</b><small>${esc(s)}</small></div>`).join('')}</div>
      <div class="tabs" role="tablist" style="margin-top:20px">${tabs.map(([k, n]) => `<a class="tab" role="tab" href="/admin?tab=${k}" aria-selected="${k === tab}">${esc(n)}</a>`).join('')}</div></section>
      <section class="sec">${body}</section>`)) return;

    if (tab === 'members') {
      const gymOpts = [['', 'No gym'], ...gyms.map(g => [g.id, g.name])];
      const row = p => { const g = gymBy.get(p.gym_id), sc = scoreOf(p.id);
        return `<tr data-row="${p.id}"><td><b>${p.display_name ? `<a href="/u/${p.id}">${esc(p.display_name)}</a>` : '<span class="sub">Unfinished signup</span>'}</b></td><td>${g ? esc(g.name) : '<span class="sub">none</span>'}</td><td>${esc(p.sex === 'male' ? 'M' : p.sex === 'female' ? 'F' : '')}</td><td class="r n">${ageOf(p.birth_year)}</td><td class="r n">${p.bodyweight ? fmt(p.bodyweight) : ''}</td><td class="r n">${sc ? fmt(sc) : ''}</td>
          <td>${p.role === 'admin' ? '<span class="pill acc">Founder</span>' : p.role === 'commissioner' ? '<span class="pill acc">Commissioner</span>' : 'Member'}</td><td>${proOn(p) ? `<span class="pill up">Pro</span>${p.pro_until ? `<div class="sub">to ${esc(day(p.pro_until))}</div>` : ''}` : 'Free'}</td><td>${esc(day(p.created_at))}</td><td class="r"><button class="btn ghost sm" data-ep="${p.id}">Edit</button></td></tr>
          <tr class="adEdit" data-epf="${p.id}" hidden><td colspan="10"><form class="adForm" data-pf="${p.id}"><div class="fields">
            <div class="field"><label>Board name</label><input data-k="display_name" maxlength="24" value="${esc(p.display_name || '')}"></div>
            <div class="field"><label>Sex</label><select data-k="sex">${opts([['male', 'Male'], ['female', 'Female'], ['unspecified', 'Unspecified']], p.sex)}</select></div>
            <div class="field"><label>Birth year</label><input data-k="birth_year" type="number" min="1920" max="2015" value="${esc(p.birth_year || '')}"></div>
            <div class="field"><label>Bodyweight lb</label><input data-k="bodyweight" type="number" min="80" max="450" step="0.1" value="${esc(p.bodyweight || '')}"></div>
            <div class="field"><label>Division</label><select data-k="division">${opts([['men', 'Men'], ['women', 'Women'], ['open', 'Open']], p.division)}</select></div>
            <div class="field"><label>Gym</label><select data-k="gym_id">${opts(gymOpts, p.gym_id || '')}</select></div>
            <div class="field"><label>Role</label><select data-k="role"${p.id === S.me.id ? ' disabled' : ''}>${opts([['member', 'Member'], ['commissioner', 'Commissioner'], ['admin', 'Founder']], p.role)}</select></div>
            <div class="field"><label>Plan</label><select data-k="tier">${opts([['free', 'Free'], ['pro', 'DSI Pro']], p.tier || 'free')}</select></div>
            <div class="field"><label>Pro until (optional)</label><input data-k="pro_until" type="date" value="${esc(p.pro_until ? String(p.pro_until).slice(0, 10) : '')}"></div></div>
            <div class="row"><button class="btn sm">Save member</button>${p.display_name ? `<a class="btn ghost sm" href="/u/${p.id}">Profile and lifts</a>` : ''}<span class="hint" data-msg>${p.pro_source ? 'Pro from ' + esc(p.pro_source) + '. ' : ''}Lifts are fixed from their profile with protests.</span></div></form></td></tr>`; };
      const draw = () => {
        const q = $('#ad-q').value.trim().toLowerCase();
        const hit = p => !q || [p.display_name, (gymBy.get(p.gym_id) || {}).name, p.role, proOn(p) ? 'pro' : 'free', p.sex].some(x => String(x || '').toLowerCase().includes(q));
        const list = profiles.filter(hit);
        $('#ad-rows').innerHTML = list.map(row).join('') || '<tr><td colspan="10" class="empty">Nobody matches.</td></tr>';
        $('#ad-n').textContent = `${list.length} of ${profiles.length}`;
        bindRows();
      };
      const bindRows = () => {
        $$('[data-ep]').forEach(b => b.onclick = () => { const r = $(`[data-epf="${b.dataset.ep}"]`); r.hidden = !r.hidden; });
        $$('[data-pf]').forEach(f => f.onsubmit = async e => {
          e.preventDefault();
          const id = f.dataset.pf, msg = $('[data-msg]', f), v = k => { const el = $(`[data-k="${k}"]`, f); return el ? el.value.trim() : ''; };
          const up = { display_name: v('display_name') || null, sex: v('sex'), division: v('division'), gym_id: v('gym_id') || null, tier: v('tier'),
            birth_year: v('birth_year') ? +v('birth_year') : null, bodyweight: v('bodyweight') ? +v('bodyweight') : null,
            pro_until: v('pro_until') ? new Date(v('pro_until') + 'T23:59:59').toISOString() : null };
          if (id !== S.me.id) up.role = v('role');
          if (up.tier === 'pro' && !up.pro_until && !(byId.get(id) || {}).pro_source) up.pro_source = 'founder';
          msg.textContent = 'Saving…';
          const { data, error } = await sb.from('profiles').update(up).eq('id', id).select().single();
          if (error) { msg.textContent = /display_name|23505/.test(error.message + error.code) ? 'That board name is taken.' : error.message; return; }
          Object.assign(byId.get(id), data); toast('Saved ' + (data.display_name || 'member')); draw();
        });
      };
      $('#ad-q').oninput = draw; draw();
    }

    if (tab === 'gyms') {
      const slugOk = (s, m) => { if (s && !SLUG.test(s)) { m.textContent = 'Link: 3 to 40 letters, numbers or dashes.'; return false; } return true; };
      const errMsg = e => /gyms_slug_key/.test(e.message) ? 'Another gym has that big screen link.' : /gyms_name/.test(e.message) ? 'Another gym has that name.' : e.message;
      $$('[data-eg]').forEach(b => b.onclick = () => { const r = $(`[data-egf="${b.dataset.eg}"]`); r.hidden = !r.hidden; });
      $$('[data-gf]').forEach(f => f.onsubmit = async e => {
        e.preventDefault();
        const m = $('[data-msg]', f), slug = $('[data-k="slug"]', f).value.trim().toLowerCase();
        if (!slugOk(slug, m)) return;
        const { error } = await sb.from('gyms').update({ name: $('[data-k="name"]', f).value.trim(), city: $('[data-k="city"]', f).value.trim() || null, slug: slug || null }).eq('id', f.dataset.gf);
        if (error) { m.textContent = errMsg(error); return; }
        toast('Gym saved'); route();
      });
      $$('[data-as]').forEach(f => f.onsubmit = async e => {
        e.preventDefault();
        const pid = $('[data-p]', f).value; if (!pid) return;
        const { error } = await sb.from('gym_staff').insert({ gym_id: f.dataset.as, profile_id: pid, role: $('[data-r]', f).value });
        if (error) return toast(error.message);
        toast('Added'); route();
      });
      $$('[data-rms]').forEach(b => b.onclick = async () => {
        const [g, p] = b.dataset.rms.split('|');
        const { error } = await sb.from('gym_staff').delete().eq('gym_id', g).eq('profile_id', p);
        if (error) return toast(error.message);
        toast('Removed from the gym staff'); route();
      });
      $('#ng').onsubmit = async e => {
        e.preventDefault();
        const m = $('#ng-msg'), slug = $('#ng-s').value.trim().toLowerCase();
        if (!slugOk(slug, m)) return;
        const { data, error } = await sb.from('gyms').insert({ name: $('#ng-n').value.trim(), city: $('#ng-c').value.trim() || null, slug: slug || null, created_by: S.me.id }).select().single();
        if (error) { m.textContent = errMsg(error); return; }
        const own = $('#ng-o').value;
        if (own) { const r = await sb.from('gym_staff').insert({ gym_id: data.id, profile_id: own, role: 'owner' }); if (r.error) toast(r.error.message); }
        toast('Gym created'); route();
      };
    }

    if (tab === 'requests') {
      $$('[data-lead]').forEach(sel => sel.onchange = async () => { const { error } = await sb.from('gym_leads').update({ status: sel.value }).eq('id', sel.dataset.lead); toast(error ? error.message : 'Lead updated'); });
      $$('[data-cl]').forEach(b => b.onclick = async () => {
        const { error } = await sb.rpc('decide_gym_claim', { p_id: b.dataset.cl, p_approve: !!b.dataset.ok });
        if (error) return toast(error.message);
        toast(b.dataset.ok ? 'Approved. They run that gym now.' : 'Declined'); route();
      });
    }
  };
}
