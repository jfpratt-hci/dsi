// RevenueCat webhook: turns DSI Pro on and off. The app logs in to RevenueCat with the DSI profile id.
// Set the RevenueCat webhook Authorization header to the REVENUECAT_WEBHOOK_AUTH secret.
import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const ON = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE', 'NON_RENEWING_PURCHASE', 'SUBSCRIPTION_EXTENDED', 'TEMPORARY_ENTITLEMENT_GRANT']);
const OFF = new Set(['EXPIRATION']);

Deno.serve(async req => {
  const auth = Deno.env.get('REVENUECAT_WEBHOOK_AUTH');
  if (!auth || req.headers.get('Authorization') !== auth) return json({ error: 'forbidden' }, 403);
  const { event } = await req.json();
  if (!event) return json({ error: 'no event' }, 400);
  const id = String(event.app_user_id ?? '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ skipped: 'not a DSI profile id' });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const until = event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null;
  let upd: Record<string, unknown> | null = null;
  if (ON.has(event.type)) upd = { tier: 'pro', pro_until: until, pro_source: 'app_store' };
  else if (OFF.has(event.type)) upd = { tier: 'free', pro_until: until, pro_source: null };
  else if (event.type === 'CANCELLATION') upd = { pro_until: until };
  if (!upd) return json({ ignored: event.type });
  const { data: p } = await sb.from('profiles').select('role, pro_source').eq('id', id).maybeSingle();
  if (!p) return json({ skipped: 'no profile' });
  if (upd.tier === 'free' && p.pro_source !== 'app_store') return json({ skipped: 'Pro was granted by hand' });
  // The service role has no auth.uid(), so the profiles guard lets these fields through.
  const { error } = await sb.from('profiles').update(upd).eq('id', id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
});
