// Stripe tells DSI when gym payments happen (a Connect webhook: events come from each gym's connected account).
// Needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET. Deployed without JWT checks; the Stripe signature is checked instead.
import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17';

const ok = (b: unknown = { received: true }) => new Response(JSON.stringify(b), { headers: { 'Content-Type': 'application/json' } });

Deno.serve(async req => {
  const key = Deno.env.get('STRIPE_SECRET_KEY'), secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!key || !secret) return new Response('not configured', { status: 503 });
  const stripe = new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
  let ev: Stripe.Event;
  try {
    ev = await stripe.webhooks.constructEventAsync(await req.text(), req.headers.get('stripe-signature') ?? '', secret, undefined, Stripe.createSubtleCryptoProvider());
  } catch (e) {
    return new Response('bad signature: ' + String((e as Error).message), { status: 400 });
  }
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const now = new Date().toISOString();
  const o = ev.data.object as any;

  switch (ev.type) {
    case 'account.updated':
      await db.from('gyms').update({ stripe_ready: !!o.charges_enabled }).eq('stripe_account', o.id);
      break;

    case 'checkout.session.completed': {
      const md = o.metadata ?? {};
      if (md.invoice_id && o.payment_status === 'paid') {
        await db.from('invoices').update({ status: 'paid', paid_at: now, method: 'card', stripe_session: o.id }).eq('id', md.invoice_id).eq('status', 'open');
      }
      if (md.membership_id) {
        const { data: m } = await db.from('memberships').select('*').eq('id', md.membership_id).maybeSingle();
        if (!m) break;
        await db.from('memberships').update({ status: 'active', stripe_customer: o.customer ?? null, stripe_subscription: o.subscription ?? null, start_date: now.slice(0, 10), updated_at: now }).eq('id', m.id);
        // A one time plan is paid right here; recurring plans record each payment on invoice.paid.
        if (o.mode === 'payment' && o.payment_status === 'paid') {
          await db.from('invoices').insert({ gym_id: m.gym_id, profile_id: m.profile_id, membership_id: m.id, description: m.plan_name, amount_cents: o.amount_total ?? m.price_cents, status: 'paid', paid_at: now, method: 'card', stripe_session: o.id });
        }
      }
      break;
    }

    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const subId = typeof o.subscription === 'string' ? o.subscription : o.subscription?.id ?? o.parent?.subscription_details?.subscription;
      if (!subId) break;
      const { data: m } = await db.from('memberships').select('*').eq('stripe_subscription', subId).maybeSingle();
      if (!m) break;
      const paid = ev.type === 'invoice.paid';
      const line = o.lines?.data?.[0];
      const period = line?.period ? ` (${new Date(line.period.start * 1000).toISOString().slice(0, 10)} to ${new Date(line.period.end * 1000).toISOString().slice(0, 10)})` : '';
      await db.from('invoices').upsert({
        gym_id: m.gym_id, profile_id: m.profile_id, membership_id: m.id, description: (m.plan_name + period).slice(0, 200),
        amount_cents: paid ? o.amount_paid : o.amount_due, status: paid ? 'paid' : 'open', paid_at: paid ? now : null, method: paid ? 'card' : null,
        stripe_invoice: o.id, due_date: new Date((o.due_date ?? o.created) * 1000).toISOString().slice(0, 10),
      }, { onConflict: 'stripe_invoice' });
      await db.from('memberships').update({ status: paid ? 'active' : 'past_due', updated_at: now }).eq('id', m.id);
      break;
    }

    case 'customer.subscription.deleted':
      await db.from('memberships').update({ status: 'canceled', end_date: now.slice(0, 10), updated_at: now }).eq('stripe_subscription', o.id);
      break;
  }
  return ok();
});
