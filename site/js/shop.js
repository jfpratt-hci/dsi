// /shop/<gym>  The gym shop: drinks, snacks and gear.
// Members tap what they grabbed and put it on their tab or pay by card (the gym's own Stripe).
// Staff use the same page as a counter: pick who is buying, then tab or cash, and a walk in can pay cash.
// Owners stock it (?tab=stock) and see what sold (?tab=sales). Every member sale is an invoice, so it shows in Billing.

export function install(X) {
  const { sb, S, VIEWS, $, $$, esc, num, toast, must, paint, needLogin, go, route, today, addDays, fmtD } = X;
  const money = c => '$' + (num(c) / 100).toLocaleString('en-US', { minimumFractionDigits: num(c) % 100 ? 2 : 0, maximumFractionDigits: 2 });
  const cents = v => Math.round(parseFloat(String(v).replace(/[^0-9.]/g, '')) * 100);
  const isOwner = gid => (S.me && S.me.role === 'admin') || (S.myGyms || []).some(g => g.gym_id === gid && g.role === 'owner');
  const isStaff = gid => isOwner(gid) || (S.myGyms || []).some(g => g.gym_id === gid);
  const EMOJI = ['🥤', '💧', '⚡', '☕', '🧃', '🥛', '🍫', '🍌', '🥜', '🍪', '🥣', '💊', '👕', '🧢', '🧦', '🧤', '🎽', '🏷️'];
  const CATS = ['Drinks', 'Snacks', 'Supplements', 'Gear'];
  let cart = new Map(), who = '';

  VIEWS.shop = async (gid, tok) => {
    if (!S.me) return needLogin(tok, 'use the gym shop');
    if (!gid) { const g0 = S.me.gym_id || ((S.myGyms || [])[0] || {}).gym_id; if (g0) return go('/shop/' + g0, true); return paint(tok, '<section class="prEmpty"><b>No gym yet</b><p>Join a gym to use its shop.</p></section>'); }
    const staff = isStaff(gid), owner = isOwner(gid), qs = new URLSearchParams(location.search);
    if (!staff && S.me.gym_id !== gid) return paint(tok, '<section class="prEmpty"><b>Members only</b><p>Join this gym to use its shop.</p></section>');
    const tab = owner && ['stock', 'sales'].includes(qs.get('tab')) ? qs.get('tab') : 'buy';
    const { data: g } = await sb.from('gyms').select('id,name,city,slug,tz,stripe_ready').eq('id', gid).maybeSingle();
    if (!g) return paint(tok, '<section class="prEmpty"><b>No gym here</b></section>');
    const res = await sb.from('shop_items').select('*').eq('gym_id', gid).order('sort').order('category').order('name');
    if (res.error) return paint(tok, `<section class="prEmpty"><b>The shop is not open yet</b><p>${esc(/shop_items/.test(res.error.message) ? 'It is being set up. Check back soon.' : res.error.message)}</p></section>`);
    const items = res.data || [];
    const head = (staff ? X.officeBar(g, 'shop') : '') + `<section class="sec shSec"><div class="shTop"><div><div class="kicker">${esc(g.name)}</div><h2>Gym <span>shop</span></h2></div>
      ${owner ? `<nav class="tabs" aria-label="Shop">${[['buy', staff ? 'Ring up' : 'Buy'], ['stock', 'Stock'], ['sales', 'Sales']].map(([k, n]) => `<a class="tab" href="/shop/${gid}${k === 'buy' ? '' : '?tab=' + k}"${k === tab ? ' aria-current="page" aria-selected="true"' : ''}>${n}</a>`).join('')}</nav>` : ''}</div>`;
    if (tab === 'stock') return stock(g, items, tok, head);
    if (tab === 'sales') return sales(g, tok, head);
    return buy(g, items.filter(i => i.active), tok, head, staff);
  };

  /* ---------- buy (member) and ring up (staff) ---------- */
  async function buy(g, items, tok, head, staff) {
    const members = staff ? must(await sb.from('profiles').select('id,display_name').eq('gym_id', g.id).not('display_name', 'is', null).order('display_name')) : [];
    const cats = CATS.filter(c => items.some(i => i.category === c)).concat([...new Set(items.map(i => i.category))].filter(c => !CATS.includes(c)));
    [...cart.keys()].forEach(id => { if (!items.some(i => i.id === id)) cart.delete(id); });
    const left = i => i.stock == null ? Infinity : i.stock;
    const tile = i => `<button type="button" class="shItem" data-add="${i.id}"${left(i) <= 0 ? ' disabled' : ''}><span class="shEmo" aria-hidden="true">${esc(i.emoji)}</span><b>${esc(i.name)}</b><span class="shPrice">${money(i.price_cents)}</span>${i.stock != null ? `<span class="shLeft${i.stock <= 3 ? ' low' : ''}">${i.stock <= 0 ? 'Sold out' : i.stock + ' left'}</span>` : ''}<span class="shQty" data-q="${i.id}" hidden></span></button>`;
    if (!paint(tok, `${head}
      ${items.length ? `<div class="shGrid"><div class="shShelf">${cats.map(c => `<h3 class="shCat">${esc(c)}</h3><div class="shItems">${items.filter(i => i.category === c).map(tile).join('')}</div>`).join('')}</div>
        <aside class="shCart formCard" aria-label="Cart"><div class="formH">${staff ? 'Ring up' : 'Your cart'}</div>
          ${staff ? `<label for="shWho" class="sub">Who is buying</label><input id="shWho" list="shPeople" placeholder="Type a name, or leave blank for a walk in" autocomplete="off" value="${esc(who)}"><datalist id="shPeople">${members.map(m => `<option value="${esc(m.display_name)}">`).join('')}</datalist>` : ''}
          <ul class="shLines" id="shLines"></ul>
          <div class="shTotal"><span>Total</span><b id="shTotal">$0</b></div>
          <div class="shPay" id="shPay"></div>
          <p class="hint" id="shHint"></p></aside></div>`
        : `<div class="prEmpty"><b>Nothing on the shelf yet</b><p>${isOwner(g.id) ? `<a class="btn" href="/shop/${g.id}?tab=stock">Stock the shop</a>` : 'The gym is still stocking it.'}</p></div>`}
    </section>`)) return;
    if (!items.length) return;
    const byId = new Map(items.map(i => [i.id, i]));
    const buyer = () => { if (!staff) return { id: S.me.id, name: 'you' }; const v = ($('#shWho').value || '').trim().toLowerCase(); if (!v) return null; const m = members.find(x => x.display_name.toLowerCase() === v) || members.find(x => x.display_name.toLowerCase().startsWith(v)); return m ? { id: m.id, name: m.display_name } : { bad: true }; };
    const draw = () => {
      const lines = [...cart.entries()].map(([id, q]) => [byId.get(id), q]).filter(([i]) => i);
      const total = lines.reduce((t, [i, q]) => t + i.price_cents * q, 0);
      $('#shLines').innerHTML = lines.map(([i, q]) => `<li><span>${esc(i.emoji)} ${esc(i.name)}</span><span class="shStep"><button type="button" class="btn ghost sm" data-dec="${i.id}" aria-label="One less ${esc(i.name)}">−</button><b>${q}</b><button type="button" class="btn ghost sm" data-inc="${i.id}" aria-label="One more ${esc(i.name)}"${q >= left(i) ? ' disabled' : ''}>+</button></span><span class="n">${money(i.price_cents * q)}</span></li>`).join('') || '<li class="sub">Tap what you grabbed.</li>';
      $('#shTotal').textContent = money(total);
      $$('[data-q]').forEach(s => { const q = cart.get(s.dataset.q) || 0; s.hidden = !q; s.textContent = q; });
      const b = buyer(), empty = !lines.length;
      const btns = staff
        ? (b && !b.bad ? [['tab', `Put on ${b.name.split(' ')[0]}'s tab`], ['cash', 'Paid cash']] : [['cash', b && b.bad ? 'Pick a member' : 'Walk in, paid cash']])
        : [['tab', 'Put it on my tab'], ...(g.stripe_ready ? [['card', 'Pay with card']] : [])];
      $('#shPay').innerHTML = btns.map(([m, n], k) => `<button type="button" class="btn${k ? ' ghost' : ''}" data-pay="${m}"${empty || (b && b.bad) ? ' disabled' : ''}>${esc(n)}</button>`).join('');
      $('#shHint').textContent = staff ? (b && !b.bad ? 'A tab goes on their invoices; they can pay it from Membership and billing.' : b && b.bad ? 'No member by that name. Leave it blank for a walk in.' : 'No name means a walk in paying cash.') : (g.stripe_ready ? 'Your tab shows under Membership and billing. Pay it any time.' : 'Your tab shows under Membership and billing. Pay at the desk.');
      $$('[data-pay]').forEach(x => x.onclick = () => checkout(x, x.dataset.pay, lines));
    };
    const add = (id, d) => { const i = byId.get(id), q = Math.max(0, Math.min(left(i), (cart.get(id) || 0) + d)); q ? cart.set(id, q) : cart.delete(id); draw(); };
    $$('[data-add]').forEach(b => b.onclick = () => add(b.dataset.add, 1));
    $('#shLines').onclick = e => { const t = e.target.closest('[data-inc],[data-dec]'); if (t) add(t.dataset.inc || t.dataset.dec, t.dataset.inc ? 1 : -1); };
    if (staff) $('#shWho').oninput = () => { who = $('#shWho').value; draw(); };
    draw();

    async function checkout(btn, method, lines) {
      const b = buyer();
      btn.disabled = true;
      const { data, error } = await sb.rpc('shop_buy', { p_gym: g.id, p_items: lines.map(([i, q]) => ({ id: i.id, qty: q })), p_profile: b ? b.id : null, p_method: method });
      if (error) { btn.disabled = false; return toast(error.message); }
      cart = new Map(); who = '';
      if (method === 'card') {
        try { const r = await sb.functions.invoke('billing', { body: { action: 'pay', invoice: data.invoice } }); if (r.error || !r.data || !r.data.url) throw new Error('Card checkout did not open. It is on your tab; pay it from Membership and billing.'); location.href = r.data.url; return; }
        catch (e) { toast(e.message); return route(); }
      }
      toast(method === 'cash' ? `Sold, ${money(data.total)} cash` : staff ? `${money(data.total)} on ${b.name}'s tab` : `${money(data.total)} on your tab. Enjoy.`);
      route();
    }
  }

  /* ---------- stock (owner) ---------- */
  function stock(g, items, tok, head) {
    const row = i => `<tr data-row="${i.id}"><td><select data-f="emoji" aria-label="Icon">${EMOJI.concat(EMOJI.includes(i.emoji) ? [] : [i.emoji]).map(e => `<option${e === i.emoji ? ' selected' : ''}>${e}</option>`).join('')}</select></td>
      <td><input data-f="name" value="${esc(i.name)}" maxlength="60" aria-label="Name"></td>
      <td><select data-f="category" aria-label="Category">${CATS.concat(CATS.includes(i.category) ? [] : [i.category]).map(c => `<option${c === i.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></td>
      <td><input data-f="price" inputmode="decimal" value="${(i.price_cents / 100).toFixed(2)}" class="shNum" aria-label="Price"></td>
      <td><input data-f="stock" inputmode="numeric" value="${i.stock ?? ''}" placeholder="no count" class="shNum" aria-label="On hand"></td>
      <td class="c"><input type="checkbox" data-f="active"${i.active ? ' checked' : ''} aria-label="On sale"></td></tr>`;
    if (!paint(tok, `${head}
      <form class="formCard shAdd" id="shAdd"><div class="formH">Add an item</div>
        <select id="saE" aria-label="Icon">${EMOJI.map(e => `<option>${e}</option>`).join('')}</select>
        <input id="saN" placeholder="Name, like Water or Protein bar" maxlength="60" required>
        <select id="saC" aria-label="Category">${CATS.map(c => `<option>${c}</option>`).join('')}</select>
        <input id="saP" inputmode="decimal" placeholder="Price $" class="shNum" required>
        <input id="saS" inputmode="numeric" placeholder="How many" class="shNum">
        <button class="btn">Add</button></form>
      ${items.length ? `<div class="board"><div class="tablewrap"><table class="adT shStock"><thead><tr><th></th><th>Item</th><th>Category</th><th>Price</th><th>On hand</th><th class="c">On sale</th></tr></thead><tbody id="shRows">${items.map(row).join('')}</tbody></table></div></div>
        <p class="hint">Changes save as you leave each box. Leave On hand blank to skip counting. Take something off sale instead of deleting it so past sales keep their name.</p>` : '<p class="hint">Start with what is in the fridge: water, sports drinks, energy drinks, protein shakes and bars.</p>'}
    </section>`)) return;
    $('#saE').onchange = () => { const e = $('#saE').value; $('#saC').value = ['🍫', '🍌', '🥜', '🍪', '🥣'].includes(e) ? 'Snacks' : e === '💊' ? 'Supplements' : ['👕', '🧢', '🧦', '🧤', '🎽', '🏷️'].includes(e) ? 'Gear' : 'Drinks'; };
    $('#shAdd').onsubmit = async e => {
      e.preventDefault();
      const p = cents($('#saP').value), s = $('#saS').value.trim();
      if (!(p >= 0)) return toast('Enter a price, like 2.50');
      const { error } = await sb.from('shop_items').insert({ gym_id: g.id, emoji: $('#saE').value, name: $('#saN').value.trim(), category: $('#saC').value, active: true, price_cents: p, stock: s === '' ? null : Math.max(0, parseInt(s, 10) || 0), sort: items.length });
      if (error) return toast(error.message);
      toast('Added'); route();
    };
    const rows = $('#shRows'); if (!rows) return;
    rows.addEventListener('change', async e => {
      const f = e.target.dataset.f, tr = e.target.closest('tr'); if (!f || !tr) return;
      const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value.trim();
      const patch = f === 'price' ? { price_cents: cents(v) } : f === 'stock' ? { stock: v === '' ? null : Math.max(0, parseInt(v, 10) || 0) } : { [f]: v };
      if (f === 'price' && !(patch.price_cents >= 0)) return toast('Enter a price, like 2.50');
      if (f === 'name' && !v) return toast('Give it a name');
      const { error } = await sb.from('shop_items').update(patch).eq('id', tr.dataset.row);
      toast(error ? error.message : 'Saved');
    });
  }

  /* ---------- sales (owner) ---------- */
  async function sales(g, tok, head) {
    const since = addDays(today(), -29);
    const rows = must(await sb.from('shop_sales').select('item_name,qty,total_cents,paid_with,profile_id,created_at').eq('gym_id', g.id).gte('created_at', since).order('created_at', { ascending: false }).limit(2000));
    const tdy = today(), sum = a => a.reduce((t, r) => t + r.total_cents, 0);
    const day = rows.filter(r => r.created_at.slice(0, 10) === tdy), wk = rows.filter(r => r.created_at.slice(0, 10) >= addDays(tdy, -6));
    const by = new Map(); rows.forEach(r => { const x = by.get(r.item_name) || { q: 0, c: 0 }; x.q += r.qty; x.c += r.total_cents; by.set(r.item_name, x); });
    const top = [...by.entries()].sort((a, b) => b[1].c - a[1].c);
    const how = k => sum(rows.filter(r => r.paid_with === k));
    const ids = [...new Set(rows.slice(0, 40).map(r => r.profile_id).filter(Boolean))];
    const names = ids.length ? new Map(must(await sb.from('profiles').select('id,display_name').in('id', ids)).map(p => [p.id, p.display_name])) : new Map();
    paint(tok, `${head}
      <div class="shKpis">${[['Today', sum(day)], ['Last 7 days', sum(wk)], ['Last 30 days', sum(rows)], ['On tabs, 30 days', how('tab')], ['Cash', how('cash')], ['Card', how('card')]].map(([n, c]) => `<div class="formCard shKpi"><span class="sub">${n}</span><b>${money(c)}</b></div>`).join('')}</div>
      <div class="shGrid2"><div class="formCard"><div class="formH">Best sellers, 30 days</div>${top.length ? `<table class="adT"><tbody>${top.slice(0, 10).map(([n, x]) => `<tr><td>${esc(n)}</td><td class="r n">${x.q} sold</td><td class="r n"><b>${money(x.c)}</b></td></tr>`).join('')}</tbody></table>` : '<p class="hint">No sales yet.</p>'}</div>
        <div class="formCard"><div class="formH">Latest</div>${rows.length ? `<table class="adT"><tbody>${rows.slice(0, 10).map(r => `<tr><td>${esc(fmtD(r.created_at.slice(0, 10)))}</td><td>${r.qty > 1 ? r.qty + ' ' : ''}${esc(r.item_name)}</td><td>${esc(r.profile_id ? names.get(r.profile_id) || 'Member' : 'Walk in')}</td><td><span class="pill${r.paid_with === 'tab' ? ' flat' : ' up'}">${r.paid_with}</span></td><td class="r n">${money(r.total_cents)}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">Nothing sold yet.</p>'}</div></div>
      <p class="hint">Tabs are open invoices. See who owes in Billing.</p></section>`);
  }
}
