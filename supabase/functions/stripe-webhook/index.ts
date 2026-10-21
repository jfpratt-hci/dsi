// Stripe tells Dandy when payments happen. One platform account, destination charges, so nearly every event comes
// from the platform account. account.updated (a gym finishing Stripe setup) comes from connected accounts.
// Two webhook endpoints can point here: the platform one (STRIPE_WEBHOOK_SECRET) and the Connect one (STRIPE_CONNECT_WEBHOOK_SECRET).
// Needs STRIPE_SECRET_KEY. Deployed without JWT checks; the Stripe signature is checked instead.
// Every successful gym payment becomes a payments row, so owners see one list of everything paid at their gym.
import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17';

const ok = (b: unknown = { received: true }) => new Response(JSON.stringify(b), { headers: { 'Content-Type': 'application/json' } });

Deno.serve(async req => {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  const secrets = [Deno.env.get('STRIPE_WEBHOOK_SECRET'), Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET')].filter(Boolean) as string[];
  if (!key || !secrets.length) return new Response('not configured', { status: 503 });
  const stripe = new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
  const raw = await req.text(), sig = req.headers.get('stripe-signature') ?? '';
  let ev: Stripe.Event | null = null, lastErr = '';
  for (const s of secrets) {
    try { ev = await stripe.webhooks.constructEventAsync(raw, sig, s, undefined, Stripe.createSubtleCryptoProvider()); break; } catch (e) { lastErr = String((e as Error).message); }
  }
  if (!ev) return new Response('bad signature: ' + lastErr, { status: 400 });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const now = new Date().toISOString();
  const o = ev.data.object as any;
  const pi = (x: any) => (typeof x === 'string' ? x : x?.id) ?? null;

  // Record a gym payment once (keyed by checkout session or Stripe invoice).
  const record = async (row: Record<string, unknown>, key: 'stripe_checkout_session' | 'stripe_invoice') => {
    const { data, error } = await db.from('payments').upsert({ currency: 'usd', status: 'succeeded', method: 'card', ...row }, { onConflict: key }).select('id').single();
    if (error) console.error('payments', error.message);
    return data?.id as string | undefined;
  };

  switch (ev.type) {
    case 'account.updated':
      await db.from('gyms').update({ stripe_ready: !!o.charges_enabled }).eq('stripe_account', o.id);
      break;

    case 'checkout.session.completed': {
      const md = o.metadata ?? {};
      const paid = o.payment_status === 'paid';
      const base = { gym_id: md.gym_id, payer_name: o.customer_details?.name ?? null, payer_email: o.customer_details?.email ?? null, amount_cents: o.amount_total ?? 0, stripe_checkout_session: o.id, stripe_payment_intent: pi(o.payment_intent) };

      // The gym's own Dandy plan (Run, Grow or a founder price).
      if (md.gym_billing) {
        await db.from('gym_billing').update({ stripe_customer: o.customer ?? null, stripe_subscription: o.subscription ?? null, status: 'active', updated_at: now }).eq('gym_id', md.gym_billing);
        if (o.subscription) {
          const sub = await stripe.subscriptions.retrieve(o.subscription);
          if (sub.status === 'trialing') await db.from('gym_billing').update({ status: 'trial' }).eq('gym_id', md.gym_billing);
        }
        break;
      }

      if (md.invoice_id && paid) {
        const { data: inv } = await db.from('invoices').update({ status: 'paid', paid_at: now, method: 'card', stripe_session: o.id }).eq('id', md.invoice_id).eq('status', 'open').select().maybeSingle();
        if (inv) await record({ ...base, profile_id: inv.profile_id, kind: inv.membership_id ? 'membership' : 'invoice', ref_table: 'invoices', ref_id: inv.id, description: inv.description }, 'stripe_checkout_session');
      }

      if (md.membership_id) {
        const { data: m } = await db.from('memberships').select('*').eq('id', md.membership_id).maybeSingle();
        if (!m) break;
        await db.from('memberships').update({ status: 'active', stripe_customer: o.customer ?? null, stripe_subscription: o.subscription ?? null, start_date: now.slice(0, 10), updated_at: now }).eq('id', m.id);
        // A one time plan is paid right here; recurring plans record each payment on invoice.paid.
        if (o.mode === 'payment' && paid) {
          const { data: inv } = await db.from('invoices').insert({ gym_id: m.gym_id, profile_id: m.profile_id, membership_id: m.id, description: m.plan_name, amount_cents: o.amount_total ?? m.price_cents, status: 'paid', paid_at: now, method: 'card', stripe_session: o.id }).select().single();
          await record({ ...base, profile_id: m.profile_id, kind: 'membership', ref_table: 'invoices', ref_id: inv?.id ?? null, description: m.plan_name }, 'stripe_checkout_session');
        }
      }

      // Paid on a gym website: an event registration, a booked service, a store order.
      if (md.kind && md.ref_id && paid) {
        const pid = await record({ ...base, kind: md.kind, ref_table: md.ref_table, ref_id: md.ref_id, description: md.label ?? null }, 'stripe_checkout_session');
        if (md.kind === 'event') await db.from('event_registrations').update({ status: 'confirmed', payment_id: pid ?? null, updated_at: now }).eq('id', md.ref_id).eq('status', 'pending');
        if (md.kind === 'appointment') await db.from('appointments').update({ payment_id: pid ?? null, updated_at: now }).eq('id', md.ref_id);
        if (md.kind === 'order') await db.from('orders').update({ status: 'paid', payment_id: pid ?? null, updated_at: now }).eq('id', md.ref_id).eq('status', 'pending');
      }
      break;
    }

    case 'invoice.paid':
    case 'invoice.payment_failed': {
      // Newer event versions move subscription and payment fields; read the invoice back in the API version this code uses.
      const full: any = await stripe.invoices.retrieve(o.id).catch(() => null);
      if (full) { o.subscription = full.subscription ?? o.subscription; o.payment_intent = full.payment_intent ?? o.payment_intent; }
      const subId = typeof o.subscription === 'string' ? o.subscription : o.subscription?.id ?? o.parent?.subscription_details?.subscription;
      if (!subId) break;
      const paid = ev.type === 'invoice.paid';
      const { data: gb } = await db.from('gym_billing').select('gym_id').eq('stripe_subscription', subId).maybeSingle();
      if (gb) { await db.from('gym_billing').update({ status: paid ? 'active' : 'past_due', updated_at: now }).eq('gym_id', gb.gym_id); break; }
      const { data: m } = await db.from('memberships').select('*').eq('stripe_subscription', subId).maybeSingle();
      if (!m) break;
      const line = o.lines?.data?.[0];
      const period = line?.period ? ` (${new Date(line.period.start * 1000).toISOString().slice(0, 10)} to ${new Date(line.period.end * 1000).toISOString().slice(0, 10)})` : '';
      const desc = (m.plan_name + period).slice(0, 200);
      const { data: inv } = await db.from('invoices').upsert({
        gym_id: m.gym_id, profile_id: m.profile_id, membership_id: m.id, description: desc,
        amount_cents: paid ? o.amount_paid : o.amount_due, status: paid ? 'paid' : 'open', paid_at: paid ? now : null, method: paid ? 'card' : null,
        stripe_invoice: o.id, due_date: new Date((o.due_date ?? o.created) * 1000).toISOString().slice(0, 10),
      }, { onConflict: 'stripe_invoice' }).select().maybeSingle();
      if (paid && o.amount_paid > 0) await record({ gym_id: m.gym_id, profile_id: m.profile_id, kind: 'membership', ref_table: 'invoices', ref_id: inv?.id ?? null, description: desc,
        amount_cents: o.amount_paid, payer_email: o.customer_email ?? null, payer_name: o.customer_name ?? null, stripe_invoice: o.id, stripe_payment_intent: pi(o.payment_intent) }, 'stripe_invoice');
      await db.from('memberships').update({ status: paid ? 'active' : 'past_due', updated_at: now }).eq('id', m.id);
      break;
    }

    case 'customer.subscription.updated': {
      const st = o.status === 'trialing' ? 'trial' : o.status === 'active' ? 'active' : ['past_due', 'unpaid'].includes(o.status) ? 'past_due' : o.status === 'paused' ? 'paused' : o.status === 'canceled' ? 'canceled' : null;
      if (st) await db.from('gym_billing').update({ status: st, updated_at: now }).eq('stripe_subscription', o.id);
      break;
    }

    case 'customer.subscription.deleted':
      await db.from('memberships').update({ status: 'canceled', end_date: now.slice(0, 10), updated_at: now }).eq('stripe_subscription', o.id);
      await db.from('gym_billing').update({ status: 'canceled', updated_at: now }).eq('stripe_subscription', o.id);
      break;

    case 'charge.refunded': {
      const id = pi(o.payment_intent); if (!id) break;
      const { data: p } = await db.from('payments').select('*').eq('stripe_payment_intent', id).maybeSingle();
      if (!p) break;
      const refunded = Math.min(o.amount_refunded ?? 0, p.amount_cents);
      await db.from('payments').update({ refunded_cents: refunded, status: refunded >= p.amount_cents ? 'refunded' : 'partially_refunded', stripe_charge: o.id }).eq('id', p.id);
      if (refunded >= p.amount_cents && p.ref_table === 'orders') await db.from('orders').update({ status: 'refunded', updated_at: now }).eq('id', p.ref_id);
      break;
    }

    case 'charge.dispute.created': {
      const id = pi(o.payment_intent); if (id) await db.from('payments').update({ status: 'disputed' }).eq('stripe_payment_intent', id);
      break;
    }
  }
  return ok();
});
