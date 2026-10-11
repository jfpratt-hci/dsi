// My gym (web: /mygym and /billing): membership, documents, invoices, attendance and the member's details.
import * as Haptics from 'expo-haptics';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Alert, AppState, Platform, ScrollView, Text, TextInput, View } from 'react-native';

import { Btn, Card, Eyebrow, Loading, Muted, s, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import {
  dayOf, GYM_PICKER, gymById, money, must, openBilling, Pill, StatusPill, todayIn, when,
  type Gym, type GymDoc, type Invoice, type MemberDetails, type Membership, type Plan, type Signature,
} from '@/lib/club';
import { fmtD } from '@/lib/data';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

type Att = { status: string; checked_in_at: string | null; session: { name: string; starts_at: string } | null };
type Doc = Pick<GymDoc, 'id' | 'gym_id' | 'kind' | 'title' | 'version' | 'active'>;
type Sig = Pick<Signature, 'id' | 'doc_id' | 'kind' | 'signed_at' | 'context'>;
type Data = { g: Gym; plans: Plan[]; ms: Membership[]; inv: Invoice[]; docs: Doc[]; sigs: Sig[]; att: Att[]; det: MemberDetails | null };
type Form = { legal_name: string; email: string; phone: string; emergency_name: string; emergency_phone: string };
type Waiting = { kind: 'pay'; id: string } | { kind: 'join' } | null;
const EMPTY: Form = { legal_name: '', email: '', phone: '', emergency_name: '', emergency_phone: '' };

export default function MyGym() {
  const { me, session, ready, reloadMe } = useSession();
  const gid = me?.gym_id ?? null;
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [banner, setBanner] = useState('');
  const [form, setForm] = useState<Form>(EMPTY);
  const [formMsg, setFormMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const formFor = useRef<string | null>(null);
  const waiting = useRef<Waiting>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async () => {
    if (!me || !gid) return;
    try {
      const g = await gymById(gid);
      if (!g) { setErr('No gym here.'); return; }
      const [plans, ms, inv, docs, sigs, att, det] = await Promise.all([
        sb.from('plans').select('*').eq('gym_id', g.id).eq('active', true).order('price_cents').then(must),
        sb.from('memberships').select('*').eq('gym_id', g.id).eq('profile_id', me.id).order('created_at', { ascending: false }).then(must),
        sb.from('invoices').select('*').eq('gym_id', g.id).eq('profile_id', me.id).order('created_at', { ascending: false }).then(must),
        sb.from('gym_docs').select('id,gym_id,kind,title,version,active').eq('gym_id', g.id).eq('active', true).then(must),
        sb.from('doc_signatures').select('id,doc_id,kind,signed_at,context').eq('profile_id', me.id).eq('gym_id', g.id).order('signed_at', { ascending: false }).then(must),
        sb.from('bookings').select('status,checked_in_at,session:sessions(name,starts_at)').eq('profile_id', me.id).eq('gym_id', g.id)
          .in('status', ['attended', 'booked', 'waitlist']).order('created_at', { ascending: false }).limit(60).then(must),
        sb.from('member_details').select('*').eq('profile_id', me.id).maybeSingle().then(r => r.data as MemberDetails | null),
      ]);
      if (!alive.current) return;
      const x: Data = { g, plans, ms, inv, docs, sigs, att: (att as any[]).map(a => ({ ...a, session: Array.isArray(a.session) ? a.session[0] ?? null : a.session })), det };
      setD(x); setErr('');
      // Fill the details form once per gym so a refresh never wipes what the member is typing.
      if (formFor.current !== g.id) {
        formFor.current = g.id;
        setForm({ legal_name: det?.legal_name ?? '', email: det?.email ?? '', phone: det?.phone ?? '', emergency_name: det?.emergency_name ?? '', emergency_phone: det?.emergency_phone ?? '' });
      }
      // Back from Stripe: say so once the payment shows.
      const w = waiting.current;
      if (w?.kind === 'pay' && x.inv.some(i => i.id === w.id && i.status === 'paid')) { waiting.current = null; setBanner('Payment received. Thank you.'); }
      if (w?.kind === 'join' && x.ms.some(m => m.status === 'active')) { waiting.current = null; setBanner('Welcome in. Your membership is active.'); }
    } catch (e: any) {
      if (alive.current) setErr(e?.message ?? 'Could not load your gym.');
    }
  }, [me?.id, gid]);

  // Refresh when the screen comes back into view and when the app comes back from the payment browser.
  useFocusEffect(useCallback(() => { load(); }, [load]));
  // No gym yet: look again when the member comes back from picking one.
  const reload = useRef(reloadMe);
  reload.current = reloadMe;
  useFocusEffect(useCallback(() => { if (me?.id && !gid) reload.current().catch(() => {}); }, [me?.id, gid]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', st => { if (st === 'active') load(); });
    return () => sub.remove();
  }, [load]);

  if (!ready) return <Screen stack><Stack.Screen options={{ title: 'My gym' }} /><Loading /></Screen>;
  if (!session) return (
    <Screen stack>
      <Stack.Screen options={{ title: 'My gym' }} />
      <Title accent="gym">My</Title>
      <Card><Text style={st.h}>Sign in to see your gym</Text><Muted style={{ fontSize: 15, marginTop: 4 }}>Book classes, sign the waiver, and manage your membership and invoices.</Muted></Card>
      <Btn label="Sign in" onPress={() => router.push('/login')} />
    </Screen>
  );
  if (!me) return <Screen stack><Stack.Screen options={{ title: 'My gym' }} /><Loading /></Screen>;
  if (!gid) return (
    <Screen stack>
      <Stack.Screen options={{ title: 'My gym' }} />
      <Title accent="gym">My</Title>
      <Card><Text style={st.h}>Pick your gym first</Text><Muted style={{ fontSize: 15, marginTop: 4 }}>Find your gym on the Gym league page and join it. Then you can book classes and manage your membership here.</Muted></Card>
      <Btn label="Gym league" onPress={() => router.push(GYM_PICKER)} />
    </Screen>
  );
  if (!d) return (
    <Screen stack>
      <Stack.Screen options={{ title: 'My gym' }} />
      {err ? <><Card><Muted style={{ fontSize: 15 }}>{err}</Muted></Card><Btn ghost label="Try again" onPress={load} /></> : <Loading />}
    </Screen>
  );

  const { g, plans, ms, inv, docs, sigs, att } = d;
  const cur = ms.find(m => m.status !== 'canceled');
  const doc = (k: string) => docs.find(x => x.kind === k);
  const sigOn = (k: string) => { const x = doc(k); return x ? sigs.find(y => y.doc_id === x.id) : undefined; };
  const now = Date.now();
  const visits = att.filter(a => a.status === 'attended');
  const upcoming = att.filter(a => a.status !== 'attended' && a.session && Date.parse(a.session.starts_at) > now)
    .sort((a, b) => a.session!.starts_at.localeCompare(b.session!.starts_at));
  const month = todayIn(g.tz).slice(0, 7);
  const thisMonth = visits.filter(a => a.checked_in_at && dayOf(a.checked_in_at, g.tz).slice(0, 7) === month).length;
  const open = inv.filter(i => i.status === 'open');

  async function startPay(key: string, action: 'pay' | 'subscribe' | 'portal', body: Record<string, unknown>, w: Waiting) {
    if (busy) return;
    setBusy(key); setBanner('');
    waiting.current = w;
    try {
      await openBilling(action, body);
    } catch (e: any) {
      waiting.current = null;
      setBusy('');
      Alert.alert('Card payments', e?.message ?? 'Could not open the payment page.');
      return;
    }
    setBusy('');
    load();
    // Stripe tells the gym a moment after the card goes through, so look again shortly.
    setTimeout(() => { if (alive.current) load(); }, 4000);
  }

  async function saveDetails() {
    if (!me) return;
    setSaving(true); setFormMsg('');
    const t = (v: string) => v.trim() || null;
    const { error } = await sb.from('member_details').upsert({
      profile_id: me.id, legal_name: t(form.legal_name), email: t(form.email), phone: t(form.phone),
      emergency_name: t(form.emergency_name), emergency_phone: t(form.emergency_phone), updated_at: new Date().toISOString(),
    });
    setSaving(false);
    setFormMsg(error ? error.message : 'Saved.');
    if (!error) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }

  const signContract = (p: Plan) => router.push({ pathname: '/mygym/sign', params: { kind: 'contract', plan: p.id } });
  const needsContract = (p: Plan) => { const c = sigOn('contract'); return !!doc('contract') && !(c && c.context && c.context.plan_id === p.id); };
  const field = (k: keyof Form, label: string, extra: Partial<ComponentProps<typeof TextInput>> = {}) => (
    <View style={{ marginBottom: 12 }} key={k}>
      <Eyebrow style={{ marginBottom: 6 }}>{label}</Eyebrow>
      <TextInput value={form[k]} onChangeText={v => setForm(f => ({ ...f, [k]: v }))} placeholderTextColor="#5A6478" accessibilityLabel={label}
        style={[s.input, { fontSize: 16 }]} {...extra} />
    </View>
  );

  return (
    <Screen stack scroll={false}>
      <Stack.Screen options={{ title: 'My gym' }} />
      <ScrollView style={{ marginHorizontal: -16, marginTop: -16, marginBottom: -40 }} contentContainerStyle={{ padding: 16, paddingBottom: 56 }}
        keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}>
        <Title eyebrow={g.city || 'Your gym'}>{g.name}</Title>
        <Btn label="Book a class" onPress={() => router.push('/mygym/classes')} style={{ marginBottom: 14 }} />

        {banner ? <Card style={{ borderColor: C.up }}><Text style={{ color: C.ink, fontSize: 15 }}>{banner}</Text></Card> : null}

        {/* Membership */}
        <Card>
          <Head title="Membership" />
          {cur ? (<>
            <View style={st.line}><Text style={st.name}>{cur.plan_name}</Text><StatusPill status={cur.status} style={{ alignSelf: 'center' }} /></View>
            <Muted style={{ marginTop: 4, fontSize: 14 }}>
              {money(cur.price_cents)} {cur.interval === 'once' ? 'one time' : 'per ' + cur.interval}{cur.stripe_subscription ? ' · autopay' : ''} · since {fmtD(cur.start_date)}{cur.end_date ? ' · ends ' + fmtD(cur.end_date) : ''}
            </Muted>
            {cur.stripe_customer ? <Btn ghost label={busy === 'portal' ? 'Opening…' : 'Card and autopay'} disabled={!!busy} style={st.small}
              onPress={() => startPay('portal', 'portal', { gym: g.id }, null)} /> : null}
          </>) : plans.length ? (<>
            <Muted style={{ fontSize: 14, marginBottom: 4 }}>Pick a membership. {g.stripe_ready ? 'Pay by card, with autopay for monthly plans.' : 'Ask the front desk to set it up and pay there.'}</Muted>
            {plans.map((p, i) => {
              const sub = [p.description, p.commitment_months ? `${p.commitment_months} month commitment` : ''].filter(Boolean).join(' · ');
              const key = 'join:' + p.id;
              return (
                <View key={p.id} style={[st.row, i === 0 && { borderTopWidth: 0 }]}>
                  <View style={st.line}>
                    <View style={{ flex: 1 }}>
                      <Text style={st.name}>{p.name}</Text>
                      {sub ? <Muted style={{ marginTop: 2 }}>{sub}</Muted> : null}
                    </View>
                    <Text style={st.price}>{money(p.price_cents)}<Text style={st.per}>{p.interval === 'once' ? '' : '/' + (p.interval === 'month' ? 'mo' : 'yr')}</Text></Text>
                  </View>
                  {g.stripe_ready ? (needsContract(p)
                    ? <Btn label="Sign and join" onPress={() => signContract(p)} style={st.small} />
                    : <Btn label={busy === key ? 'Opening…' : 'Join'} disabled={!!busy} style={st.small}
                        onPress={() => startPay(key, 'subscribe', { plan: p.id }, { kind: 'join' })} />) : null}
                </View>
              );
            })}
          </>) : <Muted style={{ fontSize: 14 }}>Ask the front desk about memberships.</Muted>}
        </Card>

        {/* Documents */}
        <Card>
          <Head title="Documents" />
          {(['waiver', 'contract'] as const).filter(k => doc(k)).map((k, i) => {
            const x = sigOn(k);
            return (
              <View key={k} style={[st.row, i === 0 && { borderTopWidth: 0 }, st.line]}>
                <View style={{ flex: 1 }}>
                  <Text style={st.name}>{doc(k)!.title}</Text>
                  <Muted style={{ marginTop: 2 }}>{x ? 'Signed ' + fmtD(x.signed_at.slice(0, 10)) : k === 'waiver' ? 'Needed before you book a class' : 'Signed when you start a membership'}</Muted>
                </View>
                {x ? <Btn ghost label="View" onPress={() => router.push({ pathname: '/mygym/signed/[id]', params: { id: x.id } })} style={st.side} />
                  : k === 'waiver' ? <Btn label="Sign" onPress={() => router.push({ pathname: '/mygym/sign', params: { kind: 'waiver' } })} style={st.side} /> : null}
              </View>
            );
          })}
          {!docs.some(x => x.kind === 'waiver' || x.kind === 'contract') ? <Muted style={{ fontSize: 14 }}>Nothing to sign.</Muted> : null}
        </Card>

        {/* Invoices */}
        <Card>
          <Head title="Invoices" right={open.length ? <Pill label={`${open.length} open`} tone="down" style={{ alignSelf: 'center' }} /> : null} />
          {inv.slice(0, 12).map((i, k) => {
            const key = 'pay:' + i.id;
            return (
              <View key={i.id} style={[st.row, k === 0 && { borderTopWidth: 0 }]}>
                <View style={st.line}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.name}>{i.description}</Text>
                    <Muted style={{ marginTop: 2 }}>#{i.number} · {i.status === 'paid' ? 'paid ' + fmtD((i.paid_at || i.created_at).slice(0, 10)) : i.status === 'void' ? 'void' : 'due ' + fmtD(i.due_date)}</Muted>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={st.price}>{money(i.amount_cents)}</Text>
                    {i.status === 'paid' ? <Pill label="Paid" tone="up" style={{ alignSelf: 'flex-end' }} /> : i.status === 'open' && !g.stripe_ready ? <Pill label="Pay at desk" tone="down" style={{ alignSelf: 'flex-end' }} /> : null}
                  </View>
                </View>
                {i.status === 'open' && g.stripe_ready ? <Btn label={busy === key ? 'Opening…' : 'Pay'} disabled={!!busy} style={st.small}
                  onPress={() => startPay(key, 'pay', { invoice: i.id }, { kind: 'pay', id: i.id })} /> : null}
              </View>
            );
          })}
          {!inv.length ? <Muted style={{ fontSize: 14 }}>No invoices yet.</Muted> : null}
        </Card>

        {/* Attendance */}
        <Card>
          <Head title="Attendance" right={<Muted>{thisMonth} this month · {visits.length} logged</Muted>} />
          {upcoming.length ? (
            <View style={{ marginBottom: 10 }}>
              <Eyebrow style={{ marginBottom: 4 }}>Coming up</Eyebrow>
              {upcoming.slice(0, 3).map((a, i) => (
                <Text key={i} style={{ color: C.ink, fontSize: 14, marginBottom: 2 }}>
                  {a.session!.name} <Text style={{ color: C.muted }}>{when(a.session!.starts_at, g.tz)}{a.status === 'waitlist' ? ' (waitlist)' : ''}</Text>
                </Text>
              ))}
            </View>
          ) : null}
          {visits.length ? <Eyebrow style={{ marginBottom: 4 }}>Recent visits</Eyebrow> : null}
          {visits.slice(0, 20).map((a, i) => (
            <View key={i} style={[st.visit, i === 0 && { borderTopWidth: 0 }]}>
              <Text style={{ color: C.ink, fontSize: 14, flex: 1 }}>{a.session ? a.session.name : 'Class'}</Text>
              <Muted>{a.session ? when(a.session.starts_at, g.tz) : ''}</Muted>
            </View>
          ))}
          {!visits.length ? <Muted style={{ fontSize: 14 }}>No visits yet. Coaches check you in at class.</Muted> : null}
        </Card>

        {/* Your details */}
        <Card>
          <Head title="Your details" />
          <Muted style={{ marginBottom: 12 }}>Only you and {g.name} staff see these.</Muted>
          {field('legal_name', 'Legal name', { maxLength: 120, autoCapitalize: 'words', autoComplete: 'name', textContentType: 'name' })}
          {field('email', 'Email', { maxLength: 160, keyboardType: 'email-address', autoCapitalize: 'none', autoComplete: 'email', textContentType: 'emailAddress' })}
          {field('phone', 'Phone', { maxLength: 40, keyboardType: 'phone-pad', autoComplete: 'tel', textContentType: 'telephoneNumber' })}
          {field('emergency_name', 'Emergency contact', { maxLength: 120, autoCapitalize: 'words' })}
          {field('emergency_phone', 'Emergency phone', { maxLength: 40, keyboardType: 'phone-pad' })}
          <Btn label={saving ? 'Saving…' : 'Save'} onPress={saveDetails} disabled={saving} />
          {formMsg ? <Muted style={{ marginTop: 8, textAlign: 'center', color: formMsg === 'Saved.' ? C.up : C.down }}>{formMsg}</Muted> : null}
        </Card>
      </ScrollView>
    </Screen>
  );
}

function Head({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
      <Text style={st.head}>{title}</Text>
      {right ?? null}
    </View>
  );
}

const st = {
  h: { color: C.ink, fontSize: 18, fontWeight: '800' as const },
  head: { color: C.ink, fontSize: 18, fontWeight: '900' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  line: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  row: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.line },
  visit: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.line },
  name: { color: C.ink, fontSize: 16, fontWeight: '700' as const, flexShrink: 1 },
  price: { color: C.ink, fontSize: 20, fontWeight: '900' as const },
  per: { color: C.muted, fontSize: 12, fontWeight: '600' as const },
  small: { height: 44, marginTop: 10 },
  side: { height: 44, paddingHorizontal: 16 },
};
