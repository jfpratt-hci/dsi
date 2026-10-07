// Gym payments through Stripe Connect. Each gym connects its own Stripe account; money goes straight to the gym.
// Actions (POST JSON with the member's sign in):
//   connect   {gym}      owner: start or continue Stripe onboarding, returns {url}
//   status    {gym}      owner: refresh whether the gym can take cards, returns {ready}
//   pay       {invoice}  member or owner: Stripe Checkout for one open invoice, returns {url}
//   subscribe {plan}     member: start a membership (monthly or yearly autopay, or one payment), returns {url}
//   portal    {gym}      member: manage card and autopay, returns {url}
//   cancel    {membership} owner or the member: stop autopay at the end of the paid period
// Needs the secret STRIPE_SECRET_KEY (the DSI platform's Stripe key). Without it every action says payments are not on yet.
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

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail('POST only', 405);
  try {
    const key = Deno.env.get('STRIPE_SECRET_KEY');
    if (!key) return fail('Online payments are not switched on yet. The gym can still mark invoices paid at the desk.', 503);
    const stripe = new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
    const auth = req.headers.get('Authorization') ?? '';
    const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: u } = await user.auth.getUser();
    if (!u?.user) return fail('Sign in first.', 401);
    const { data: me } = await admin.from('profiles').select('id,display_name,role,gym_id').eq('user_id', u.user.id).maybeSingle();
    if (!me) return fail('Finish joining first.', 403);
    const body = await req.json();
    const owns = async (gid: string) => me.role === 'admin' || !!(await admin.from('gym_staff').select('role').eq('gym_id', gid).eq('profile_id', me.id).eq('role', 'owner').maybeSingle()).data;
    const gymOf = async (gid: string) => (await admin.from('gyms').select('*').eq('id', gid).maybeSingle()).data;
    const office = (gid: string) => `${SITE}/club/${gid}?tab=billing`;

    if (body.action === 'connect' || body.action === 'status') {
      const g = await gymOf(body.gym);
      if (!g) return fail('No gym here.', 404);
      if (!(await owns(g.id))) return fail('Gym owners only.', 403);
      let acct = g.stripe_account as string | null;
      if (!acct) {
        if (body.action === 'status') return json({ ready: false, connected: false });
        const a = await stripe.accounts.create({ type: 'standard', email: g.email || u.user.email || undefined, business_profile: { name: g.name }, metadata: { gym_id: g.id } });
        acct = a.id;
        await admin.from('gyms').update({ stripe_account: acct }).eq('id', g.id);
      }
      const a = await stripe.accounts.retrieve(acct);
      const ready = !!a.charges_enabled;
      if (ready !== g.stripe_ready) await admin.from('gyms').update({ stripe_ready: ready }).eq('id', g.id);
      if (body.action === 'status') return json({ ready, connected: true, details: !!a.details_submitted });
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
      if (!g?.stripe_account || !g.stripe_ready) return fail(`${g?.name ?? 'This gym'} is not taking cards online yet. Pay at the desk.`, 409);
      const s = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: inv.amount_cents, product_data: { name: `${g.name}: ${inv.description}`, description: `Invoice ${inv.number}` } } }],
        customer_email: inv.profile_id === me.id ? u.user.email : undefined,
        metadata: { invoice_id: inv.id, gym_id: g.id },
        payment_intent_data: { metadata: { invoice_id: inv.id, gym_id: g.id } },
        success_url: `${SITE}/billing?paid=${inv.id}`, cancel_url: `${SITE}/billing`,
      }, { stripeAccount: g.stripe_account });
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
      // The contract signature for this gym's current contract, if the gym has one.
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
      const s = await stripe.checkout.sessions.create({
        mode: recurring ? 'subscription' : 'payment',
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: plan.price_cents, product_data: { name: `${g.name}: ${plan.name}` }, ...(recurring ? { recurring: { interval: plan.interval } } : {}) } }],
        customer_email: u.user.email,
        metadata: { membership_id: m.id, gym_id: g.id },
        ...(recurring ? { subscription_data: { metadata: { membership_id: m.id, gym_id: g.id } } } : { payment_intent_data: { metadata: { membership_id: m.id, gym_id: g.id } } }),
        success_url: `${SITE}/billing?joined=${m.id}`, cancel_url: `${SITE}/billing`,
      }, { stripeAccount: g.stripe_account });
      return json({ url: s.url });
    }

    if (body.action === 'portal') {
      const { data: m } = await admin.from('memberships').select('*').eq('profile_id', me.id).eq('gym_id', body.gym).not('stripe_customer', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!m) return fail('No card on file at this gym yet.');
      const g = await gymOf(m.gym_id);
      const p = await stripe.billingPortal.sessions.create({ customer: m.stripe_customer, return_url: `${SITE}/billing` }, { stripeAccount: g.stripe_account });
      return json({ url: p.url });
    }

    if (body.action === 'cancel') {
      const { data: m } = await admin.from('memberships').select('*').eq('id', body.membership).maybeSingle();
      if (!m) return fail('No membership here.', 404);
      if (m.profile_id !== me.id && !(await owns(m.gym_id))) return fail('Not your membership.', 403);
      if (m.stripe_subscription) {
        const g = await gymOf(m.gym_id);
        const sub = await stripe.subscriptions.update(m.stripe_subscription, { cancel_at_period_end: true }, { stripeAccount: g.stripe_account });
        const end = new Date((sub.cancel_at ?? sub.current_period_end) * 1000).toISOString().slice(0, 10);
        await admin.from('memberships').update({ end_date: end, note: `Autopay stops ${end}`, updated_at: new Date().toISOString() }).eq('id', m.id);
        return json({ ends: end });
      }
      await admin.from('memberships').update({ status: 'canceled', end_date: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() }).eq('id', m.id);
      return json({ ends: 'now' });
    }

    return fail('Unknown action.');
  } catch (e) {
    return fail(String((e as Error).message ?? e), 500);
  }
});
