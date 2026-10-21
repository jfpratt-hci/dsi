// One payment platform for Dandy Strength: Stripe Connect with Express accounts and destination charges.
// Every card payment runs through Dandy's Stripe platform account and is paid out to the gym's connected account.
// The gym is the merchant on the card statement (on_behalf_of). Dandy takes no fee on gym payments for now.
// Members have one Stripe customer across Dandy (stripe_customers), so a saved card works at any Dandy gym.
//
// Actions (POST JSON). Signed in:
//   connect    {gym}           owner: start or continue the gym's Stripe setup, returns {url}
//   status     {gym}           owner: refresh whether the gym can take cards, returns {ready, connected, details}
//   dashboard  {gym}           owner: a one time link to the gym's Stripe payouts and bank page, returns {url}
//   pay        {invoice}       member or owner: Stripe Checkout for one open invoice, returns {url}
//   subscribe  {plan}          member: start a membership (monthly or yearly autopay, or one payment), returns {url}
//   portal     {gym?}          member: manage cards and autopay, returns {url}
//   cancel     {membership}    owner or the member: stop autopay at the end of the paid period
//   refund     {payment, amount_cents?}  owner: refund all or part of a payment
//   dandy_plan {gym}           owner: start the gym's Dandy Strength plan (price and trial set by Dandy in gym_billing), returns {url}
// Public (gym website visitors, no sign in):
//   checkout   {kind: event|appointment|order, id, return}  pay for what was just booked on the site, returns {url}
// Needs the secret STRIPE_SECRET_KEY (the Dandy platform key). Without it every action says payments are not on yet.
import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (m: string, s = 400) => json({ error: m }, s);
const SITE = Deno.env.get('SITE_URL') ?? 'https://dandystrength.com';
const TIER: Record<string, string> = { run: 'Run', grow: 'Grow', founder: 'Founder', base: 'Base', build: 'Build', peak: 'Peak', custom: 'Custom' };

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail('POST only', 405);
  try {
    const key = Deno.env.get('STRIPE_SECRET_KEY');
    if (!key) return fail('Online payments are not switched on yet. The gym can still take payment at the desk.', 503);
    const stripe = new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({}));
    const gymOf = async (gid: string) => (await admin.from('gyms').select('*').eq('id', gid).maybeSingle()).data;
    const office = (gid: string) => `${SITE}/club/${gid}?tab=billing`;
    const dest = (acct: string, md: Record<string, string>) => ({ on_behalf_of: acct, transfer_data: { destination: acct }, metadata: md });
    // Stripe Managed Payments (Stripe as merchant of record) is on by default for new accounts; gym payments are the gym's own sales, so it stays off.
    const newSession = (p: Record<string, unknown>) => stripe.checkout.sessions.create({ managed_payments: { enabled: false }, ...p } as any);
    const notReady = (g: any) => `${g?.name ?? 'This gym'} is not taking cards online yet. Pay at the gym.`;
    // Bank debit (ACH) for memberships and anything $50 or more, when the gym's account can take it. Card for the rest.
    const methods = async (acct: string, amount: number, bankOk: boolean) => {
      if (!bankOk || amount < 5000) return ['card'];
      const a: any = await stripe.accounts.retrieve(acct).catch(() => null);
      return a?.capabilities?.us_bank_account_ach_payments === 'active' ? ['card', 'us_bank_account'] : ['card'];
    };

    /* ---------- public: pay for something just booked on a gym website ---------- */
    if (body.action === 'checkout') {
      const kind = String(body.kind ?? ''), id = String(body.id ?? '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) return fail('Nothing to pay for.');
      let gid = '', amount = 0, email: string | null = null, label = '', table = '';
      if (kind === 'event') {
        const { data: r } = await admin.from('event_registrations').select('*').eq('id', id).maybeSingle();
        if (!r || r.status !== 'pending' || r.payment_id || r.pay_at_gym) return fail('This registration does not need a payment.');
        const { data: e } = await admin.from('events').select('title').eq('id', r.event_id).maybeSingle();
        gid = r.gym_id; amount = r.price_cents; email = r.email; label = e?.title ?? 'Event'; table = 'event_registrations';
        if (Date.parse(r.created_at) < Date.now() - 2 * 864e5) return fail('This registration expired. Sign up again.');
      } else if (kind === 'appointment') {
        const { data: a } = await admin.from('appointments').select('*').eq('id', id).maybeSingle();
        if (!a || !['requested', 'confirmed'].includes(a.status) || a.payment_id) return fail('This booking does not need a payment.');
        const { data: s } = await admin.from('services').select('name').eq('id', a.service_id).maybeSingle();
        gid = a.gym_id; amount = a.price_cents; email = a.email; label = s?.name ?? 'Session'; table = 'appointments';
      } else if (kind === 'order') {
        const { data: o } = await admin.from('orders').select('*').eq('id', id).maybeSingle();
        if (!o || o.status !== 'pending' || o.payment_id) return fail('This order does not need a payment.');
        gid = o.gym_id; amount = o.total_cents; email = o.email; label = `Order ${o.number ?? ''}`.trim(); table = 'orders';
      } else return fail('Nothing to pay for.');
      if (amount < 50) return fail('That is too small to pay by card. Pay at the gym.');
      const g = await gymOf(gid);
      if (!g?.stripe_account || !g.stripe_ready) return fail(notReady(g), 409);
      const { data: site } = await admin.from('gym_sites').select('subdomain,custom_domain').eq('gym_id', gid).maybeSingle();
      const allowed = new Set(['dandystrength.com', 'www.dandystrength.com', ...(site?.subdomain ? [`${site.subdomain}.dandystrength.com`] : []), ...(site?.custom_domain ? [site.custom_domain, 'www.' + site.custom_domain] : [])]);
      let ret = `${SITE}/site/${g.slug}`;
      try { const u = new URL(String(body.return ?? '')); if (u.protocol === 'https:' && allowed.has(u.hostname)) { u.search = ''; u.hash = ''; ret = u.toString(); } } catch { /* default */ }
      const md = { kind, ref_table: table, ref_id: id, gym_id: gid, label: label.slice(0, 100) };
      const s = await newSession({
        mode: 'payment', payment_method_types: await methods(g.stripe_account, amount, kind !== 'event') as any,
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: amount, product_data: { name: `${g.name}: ${label}`.slice(0, 250) } } }],
        ...(email ? { customer_email: email } : {}),
        customer_creation: 'if_required',
        metadata: md, payment_intent_data: dest(g.stripe_account, md),
        success_url: `${ret}?paid=${kind}`, cancel_url: ret,
      });
      return json({ url: s.url });
    }

    /* ---------- everything else needs a signed in Dandy account ---------- */
    const auth = req.headers.get('Authorization') ?? '';
    const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await user.auth.getUser();
    if (!u?.user) return fail('Sign in first.', 401);
    const { data: me } = await admin.from('profiles').select('id,display_name,role,gym_id').eq('user_id', u.user.id).maybeSingle();
    if (!me) return fail('Finish joining first.', 403);
    const owns = async (gid: string) => me.role === 'admin' || !!(await admin.from('gym_staff').select('role').eq('gym_id', gid).eq('profile_id', me.id).eq('role', 'owner').maybeSingle()).data;
    // One Stripe customer per Dandy member, shared by every Dandy gym.
    const customerFor = async () => {
      const { data } = await admin.from('stripe_customers').select('customer_id').eq('profile_id', me.id).maybeSingle();
      if (data) return data.customer_id as string;
      const c = await stripe.customers.create({ email: u.user.email ?? undefined, name: me.display_name ?? undefined, metadata: { profile_id: me.id } });
      await admin.from('stripe_customers').insert({ profile_id: me.id, customer_id: c.id });
      return c.id;
    };

    if (body.action === 'connect' || body.action === 'status' || body.action === 'dashboard') {
      const g = await gymOf(body.gym);
      if (!g) return fail('No gym here.', 404);
      if (!(await owns(g.id))) return fail('Gym owners only.', 403);
      let acct = g.stripe_account as string | null;
      if (!acct) {
        if (body.action !== 'connect') return json({ ready: false, connected: false });
        const { data: site } = await admin.from('gym_sites').select('subdomain,custom_domain').eq('gym_id', g.id).maybeSingle();
        const a = await stripe.accounts.create({
          type: 'express', country: 'US', email: g.email || u.user.email || undefined,
          business_profile: { name: g.name, mcc: '7997', url: site?.custom_domain ? `https://${site.custom_domain}` : `${SITE}/site/${g.slug}`, product_description: 'Gym memberships, classes, coaching, events and gear' },
          capabilities: { card_payments: { requested: true }, transfers: { requested: true }, us_bank_account_ach_payments: { requested: true } },
          metadata: { gym_id: g.id },
        });
        acct = a.id;
        await admin.from('gyms').update({ stripe_account: acct }).eq('id', g.id);
      }
      let a: any = await stripe.accounts.retrieve(acct);
      if (!a.capabilities?.us_bank_account_ach_payments) a = await stripe.accounts.update(acct, { capabilities: { us_bank_account_ach_payments: { requested: true } } } as any).catch(() => a);
      const ready = !!a.charges_enabled;
      if (ready !== g.stripe_ready) await admin.from('gyms').update({ stripe_ready: ready }).eq('id', g.id);
      if (body.action === 'status') return json({ ready, connected: true, details: !!a.details_submitted, payouts: !!a.payouts_enabled, bank: a.capabilities?.us_bank_account_ach_payments === 'active' });
      if (body.action === 'dashboard') {
        if (!a.details_submitted) return fail('Finish the Stripe setup first.');
        return json({ url: (await stripe.accounts.createLoginLink(acct)).url });
      }
      const link = await stripe.accountLinks.create({ account: acct, type: 'account_onboarding', refresh_url: office(g.id) + '&stripe=retry', return_url: office(g.id) + '&stripe=done' });
      return json({ url: link.url });
    }

    if (body.action === 'pay') {
      const { data: inv } = await admin.from('invoices').select('*').eq('id', body.invoice).maybeSingle();
      if (!inv) return fail('No invoice here.', 404);
      if (inv.profile_id !== me.id && !(await owns(inv.gym_id))) return fail('That is not your invoice.', 403);
      if (inv.status !== 'open') return fail('That invoice is already ' + inv.status + '.');
      if (inv.amount_cents < 50) return fail('That invoice is too small to pay by card.');
      const g = await gymOf(inv.gym_id);
      if (!g?.stripe_account || !g.stripe_ready) return fail(notReady(g), 409);
      const md = { invoice_id: inv.id, gym_id: g.id };
      const s = await newSession({
        mode: 'payment', payment_method_types: await methods(g.stripe_account, inv.amount_cents, true) as any,
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: inv.amount_cents, product_data: { name: `${g.name}: ${inv.description}`, description: `Invoice ${inv.number}` } } }],
        ...(inv.profile_id === me.id ? { customer: await customerFor() } : {}),
        metadata: md, payment_intent_data: dest(g.stripe_account, md),
        success_url: `${SITE}/billing?paid=${inv.id}`, cancel_url: `${SITE}/billing`,
      });
      await admin.from('invoices').update({ stripe_session: s.id }).eq('id', inv.id);
      return json({ url: s.url });
    }

    if (body.action === 'subscribe') {
      const { data: plan } = await admin.from('plans').select('*').eq('id', body.plan).eq('active', true).maybeSingle();
      if (!plan) return fail('That plan is not offered anymore.', 404);
      const g = await gymOf(plan.gym_id);
      if (!g?.stripe_account || !g.stripe_ready) return fail(`${g?.name ?? 'This gym'} is not taking cards online yet. Ask at the desk.`, 409);
      if (me.gym_id !== g.id) return fail(`Pick ${g.name} as your gym first.`);
      const { data: waiver } = await user.rpc('has_signed', { p_gym: g.id, p_kind: 'waiver' });
      if (!waiver) return fail('Sign the waiver first.');
      const { data: cdoc } = await admin.from('gym_docs').select('id').eq('gym_id', g.id).eq('kind', 'contract').eq('active', true).maybeSingle();
      let sig: string | null = null;
      if (cdoc) {
        const { data: s } = await admin.from('doc_signatures').select('id,context').eq('doc_id', cdoc.id).eq('profile_id', me.id).maybeSingle();
        if (!s || s.context?.plan_id !== plan.id) return fail('Sign the membership contract for this plan first.');
        sig = s.id;
      }
      const { data: live } = await admin.from('memberships').select('id').eq('profile_id', me.id).eq('gym_id', g.id).in('status', ['active', 'past_due']).maybeSingle();
      if (live) return fail('You already have a membership here. Ask the gym to change it.');
      const { data: m, error: me2 } = await admin.from('memberships').insert({ gym_id: g.id, profile_id: me.id, plan_id: plan.id, plan_name: plan.name, price_cents: plan.price_cents, interval: plan.interval, status: 'pending', contract_sig: sig }).select().single();
      if (me2) return fail(me2.message, 500);
      const recurring = plan.interval === 'month' || plan.interval === 'year';
      const md = { membership_id: m.id, gym_id: g.id };
      const s = await newSession({
        mode: recurring ? 'subscription' : 'payment', payment_method_types: await methods(g.stripe_account, recurring ? 99999 : plan.price_cents, true) as any,
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: plan.price_cents, product_data: { name: `${g.name}: ${plan.name}` }, ...(recurring ? { recurring: { interval: plan.interval } } : {}) } }],
        customer: await customerFor(),
        metadata: md,
        ...(recurring ? { subscription_data: dest(g.stripe_account, md) } : { payment_intent_data: dest(g.stripe_account, md) }),
        success_url: `${SITE}/billing?joined=${m.id}`, cancel_url: `${SITE}/billing`,
      });
      return json({ url: s.url });
    }

    if (body.action === 'portal') {
      const { data: c } = await admin.from('stripe_customers').select('customer_id').eq('profile_id', me.id).maybeSingle();
      if (!c) return fail('No card on file yet.');
      const p = await stripe.billingPortal.sessions.create({ customer: c.customer_id, return_url: `${SITE}/billing` });
      return json({ url: p.url });
    }

    if (body.action === 'cancel') {
      const { data: m } = await admin.from('memberships').select('*').eq('id', body.membership).maybeSingle();
      if (!m) return fail('No membership here.', 404);
      if (m.profile_id !== me.id && !(await owns(m.gym_id))) return fail('Not your membership.', 403);
      if (m.stripe_subscription) {
        const sub: any = await stripe.subscriptions.update(m.stripe_subscription, { cancel_at_period_end: true });
        const endTs = sub.cancel_at ?? sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
        const end = endTs ? new Date(endTs * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
        await admin.from('memberships').update({ end_date: end, note: `Autopay stops ${end}`, updated_at: new Date().toISOString() }).eq('id', m.id);
        return json({ ends: end });
      }
      await admin.from('memberships').update({ status: 'canceled', end_date: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() }).eq('id', m.id);
      return json({ ends: 'now' });
    }

    if (body.action === 'refund') {
      const { data: p } = await admin.from('payments').select('*').eq('id', body.payment).maybeSingle();
      if (!p) return fail('No payment here.', 404);
      if (!(await owns(p.gym_id))) return fail('Gym owners only.', 403);
      const left = p.amount_cents - p.refunded_cents;
      const amt = body.amount_cents ? Math.min(Math.round(+body.amount_cents), left) : left;
      if (amt <= 0) return fail('Nothing left to refund.');
      if (!p.stripe_payment_intent) return fail('This payment cannot be refunded from Dandy. Refund it from the Stripe dashboard.');
      // Destination charge: pull the money back from the gym's balance along with the refund.
      await stripe.refunds.create({ payment_intent: p.stripe_payment_intent, amount: amt, reverse_transfer: true, metadata: { payment_id: p.id, by: me.id } });
      const refunded = p.refunded_cents + amt;
      await admin.from('payments').update({ refunded_cents: refunded, status: refunded >= p.amount_cents ? 'refunded' : 'partially_refunded' }).eq('id', p.id);
      return json({ refunded_cents: refunded });
    }

    if (body.action === 'dandy_plan') {
      const g = await gymOf(body.gym);
      if (!g) return fail('No gym here.', 404);
      if (!(await owns(g.id))) return fail('Gym owners only.', 403);
      const { data: b } = await admin.from('gym_billing').select('*').eq('gym_id', g.id).maybeSingle();
      if (!b) return fail('Dandy has not set up your plan yet. We will reach out.');
      if (b.stripe_subscription && b.status !== 'canceled') return fail('Your Dandy plan is already set up.');
      if (b.price_cents < 50) return fail('Your plan is free right now. Nothing to set up.');
      let cust = b.stripe_customer as string | null;
      if (!cust) {
        const c = await stripe.customers.create({ email: g.email || u.user.email || undefined, name: g.name, metadata: { gym_id: g.id, kind: 'gym' } });
        cust = c.id;
        await admin.from('gym_billing').update({ stripe_customer: cust }).eq('gym_id', g.id);
      }
      const trialEnd = b.trial_ends_at ? Math.floor(Date.parse(b.trial_ends_at + 'T12:00:00Z') / 1000) : 0;
      const md = { gym_billing: g.id };
      const s = await newSession({
        mode: 'subscription', customer: cust, payment_method_types: ['card', 'us_bank_account'] as any,
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: b.price_cents, recurring: { interval: 'month' }, product_data: { name: `Dandy Strength ${TIER[b.tier] ?? ''} plan`.replace('  ', ' ') } } }],
        metadata: md,
        subscription_data: { metadata: md, ...(trialEnd > Date.now() / 1000 + 2 * 86400 ? { trial_end: trialEnd } : {}) },
        payment_method_collection: 'always',
        success_url: office(g.id) + '&dandy=done', cancel_url: office(g.id),
      });
      return json({ url: s.url });
    }

    return fail('Unknown action.');
  } catch (e) {
    return fail(String((e as Error).message ?? e), 500);
  }
});
