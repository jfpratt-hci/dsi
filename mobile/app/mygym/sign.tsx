// Sign a document (web: /sign/<waiver|contract>?plan=): the full text, a typed legal name, a drawn signature, and the agree box.
// The drawing is saved as an SVG data URL (white background, dark strokes) so it shows on the web's signed record page too.
import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, PanResponder, Platform, Pressable, ScrollView, Text, TextInput, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Btn, Card, Eyebrow, Loading, Muted, s, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import {
  dayOf, docVals, GYM_PICKER, fillDoc, gymById, money, must, openBilling, planVals,
  type Gym, type GymDoc, type MemberDetails, type Plan, type Signature,
} from '@/lib/club';
import { fmtD } from '@/lib/data';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

type Kind = 'waiver' | 'contract';
type Data = { g: Gym; doc: GymDoc | null; plan: Plan | null; det: Pick<MemberDetails, 'legal_name'> | null; had: Pick<Signature, 'id' | 'signed_at' | 'context'> | null };

export default function Sign() {
  const p = useLocalSearchParams<{ kind?: string; plan?: string; gym?: string }>();
  const kind: Kind | null = p.kind === 'waiver' || p.kind === 'contract' ? p.kind : null;
  const { me, session, ready } = useSession();
  const gid = p.gym || me?.gym_id || null;
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [paths, setPaths] = useState<string[]>([]);
  const [inked, setInked] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [scrollOn, setScrollOn] = useState(true);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const title = kind === 'contract' ? 'Membership contract' : 'Waiver';

  const load = useCallback(async () => {
    if (!me || !gid || !kind) return;
    try {
      const g = await gymById(gid);
      if (!g) { setErr('No gym here.'); return; }
      const [doc, plan, det] = await Promise.all([
        sb.from('gym_docs').select('*').eq('gym_id', g.id).eq('kind', kind).eq('active', true).maybeSingle().then(must) as Promise<GymDoc | null>,
        p.plan ? sb.from('plans').select('*').eq('id', p.plan).maybeSingle().then(must) as Promise<Plan | null> : Promise.resolve(null),
        sb.from('member_details').select('legal_name').eq('profile_id', me.id).maybeSingle().then(must) as Promise<Pick<MemberDetails, 'legal_name'> | null>,
      ]);
      const had = doc ? must(await sb.from('doc_signatures').select('id,signed_at,context').eq('doc_id', doc.id).eq('profile_id', me.id).maybeSingle()) as Data['had'] : null;
      setD({ g, doc, plan, det, had });
      setName(n => n || det?.legal_name || '');
      setErr('');
    } catch (e: any) {
      setErr(e?.message ?? 'Could not load the document.');
    }
  }, [me?.id, gid, kind, p.plan]);
  useEffect(() => { load(); }, [load]);

  const head = <Stack.Screen options={{ title }} />;
  const done = () => (router.canGoBack() ? router.back() : router.replace('/mygym'));

  if (!kind) return <Screen stack>{head}<Card><Text style={st.h}>Nothing to sign here.</Text></Card><Btn ghost label="My gym" onPress={() => router.replace('/mygym')} /></Screen>;
  if (!ready) return <Screen stack>{head}<Loading /></Screen>;
  if (!session) return (
    <Screen stack>{head}
      <Card><Text style={st.h}>Sign in to sign</Text><Muted style={{ fontSize: 15, marginTop: 4 }}>Your signature is saved to your own account.</Muted></Card>
      <Btn label="Sign in" onPress={() => router.push('/login')} />
    </Screen>
  );
  if (!me) return <Screen stack>{head}<Loading /></Screen>;
  if (!gid) return (
    <Screen stack>{head}
      <Card><Text style={st.h}>Pick your gym first</Text><Muted style={{ fontSize: 15, marginTop: 4 }}>Find your gym on the Gym league page and join it. Then you can book classes and manage your membership here.</Muted></Card>
      <Btn label="Gym league" onPress={() => router.push(GYM_PICKER)} />
    </Screen>
  );
  if (!d) return <Screen stack>{head}{err ? <><Card><Muted style={{ fontSize: 15 }}>{err}</Muted></Card><Btn ghost label="Try again" onPress={load} /></> : <Loading />}</Screen>;

  const { g, doc, plan, det, had } = d;
  if (!doc) return (
    <Screen stack>{head}
      <Card><Text style={st.h}>{g.name} has no {kind} to sign yet</Text></Card>
      <Btn ghost label="My gym" onPress={done} />
    </Screen>
  );
  if (kind === 'contract' && !plan) return (
    <Screen stack>{head}
      <Card><Text style={st.h}>Pick a membership first</Text><Muted style={{ fontSize: 15, marginTop: 4 }}>The contract is signed for a specific plan.</Muted></Card>
      <Btn label="Memberships" onPress={done} />
    </Screen>
  );

  const vals = docVals(g, { member: det?.legal_name || me.display_name || '', ...planVals(plan) });
  const text = fillDoc(doc.body, vals);
  const samePlan = !!(had && plan && had.context?.plan_id === plan.id);

  async function pay() {
    if (!plan) return;
    try { await openBilling('subscribe', { plan: plan.id }); }
    catch (e: any) { Alert.alert('Card payments', e?.message ?? 'Could not open the payment page.'); }
  }

  async function submit() {
    if (busy || !me || !doc) return;
    const n = name.trim();
    if (n.length < 3) { setMsg('Type your full name.'); return; }
    if (!inked) { setMsg('Draw your signature in the box.'); return; }
    if (!agree) { setMsg('Tick the box to agree.'); return; }
    const svg = sigSvg(paths, box.w, box.h);
    const signature = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    if (signature.length > 200000) { setMsg('That signature is too detailed. Clear it and sign again.'); return; }
    setBusy(true); setMsg('Saving your signature…');
    const context = { values: vals, ...(plan ? { plan_id: plan.id, plan: plan.name, price_cents: plan.price_cents, interval: plan.interval, commitment_months: plan.commitment_months } : {}) };
    // A new plan means a new contract signature; the old one stays on record.
    const { error } = await sb.from('doc_signatures').insert({
      doc_id: doc.id, profile_id: me.id, signed_name: n, signature, agreed: true,
      user_agent: `Dandy Strength app ${Platform.OS}`.slice(0, 400), context,
    });
    if (error && !/duplicate|unique/.test(error.message)) { setMsg(error.message); setBusy(false); return; }
    if (error && kind === 'contract') { setMsg('You already signed this version for another plan. Ask the gym to update your membership.'); setBusy(false); return; }
    if (!det?.legal_name) await sb.from('member_details').upsert({ profile_id: me.id, legal_name: n, updated_at: new Date().toISOString() });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setMsg('Signed');
    if (kind === 'contract' && plan) await pay();
    setBusy(false);
    done();
  }

  // Already signed this version: say so instead of asking again.
  if (had && (kind === 'waiver' || samePlan || !plan)) return (
    <Screen stack>{head}
      <Title eyebrow={g.name}>{doc.title}</Title>
      <Card style={{ borderColor: C.up }}>
        <Text style={st.h}>Signed {fmtD(dayOf(had.signed_at, g.tz))}</Text>
        <Muted style={{ fontSize: 15, marginTop: 4 }}>You already signed version {doc.version}{samePlan && plan ? ` for ${plan.name}` : ''}.</Muted>
      </Card>
      {samePlan && plan && g.stripe_ready ? <Btn label="Continue to payment" onPress={async () => { setBusy(true); await pay(); setBusy(false); done(); }} disabled={busy} style={{ marginBottom: 10 }} /> : null}
      <Btn ghost label="View" onPress={() => router.push({ pathname: '/mygym/signed/[id]', params: { id: had.id } })} style={{ marginBottom: 10 }} />
      <Btn ghost label="My gym" onPress={done} />
    </Screen>
  );
  if (had && kind === 'contract') return (
    <Screen stack>{head}
      <Title eyebrow={g.name}>{doc.title}</Title>
      <Card style={{ borderColor: C.flat }}><Text style={{ color: C.ink, fontSize: 15 }}>You already signed this version for another plan. Ask the gym to update your membership.</Text></Card>
      <Btn ghost label="My gym" onPress={done} />
    </Screen>
  );

  return (
    <Screen stack scroll={false}>
      {head}
      <ScrollView style={{ marginHorizontal: -16, marginTop: -16, marginBottom: -40 }} contentContainerStyle={{ padding: 16, paddingBottom: 56 }}
        scrollEnabled={scrollOn} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}>
        <Title eyebrow={g.name}>{doc.title}</Title>
        <Muted style={{ fontSize: 14, marginTop: -6, marginBottom: 12 }}>Version {doc.version}. Read it all, then sign at the bottom.</Muted>
        {plan ? (
          <Card accent={C.accent}>
            <Eyebrow>Membership</Eyebrow>
            <Text style={{ color: C.ink, fontSize: 17, fontWeight: '800', marginTop: 2 }}>{plan.name}</Text>
            <Muted style={{ fontSize: 14 }}>{money(plan.price_cents)} {planVals(plan).interval}{plan.commitment_months ? ` · ${plan.commitment_months} month commitment` : ''}</Muted>
          </Card>
        ) : null}

        <Card><Text style={{ color: C.ink, fontSize: 15, lineHeight: 23 }} selectable>{text}</Text></Card>

        <Eyebrow style={{ marginTop: 8, marginBottom: 6 }}>Type your full legal name</Eyebrow>
        <TextInput value={name} onChangeText={setName} maxLength={120} autoCapitalize="words" autoComplete="name" textContentType="name"
          accessibilityLabel="Type your full legal name" placeholderTextColor="#5A6478" style={[s.input, { marginBottom: 16 }]} />

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <Eyebrow>Sign with your finger</Eyebrow>
          <Pressable onPress={() => { setPaths([]); setInked(false); }} accessibilityRole="button" accessibilityLabel="Clear the signature" hitSlop={10}
            style={{ minHeight: 44, minWidth: 64, alignItems: 'flex-end', justifyContent: 'center' }}>
            <Text style={{ color: C.accent, fontWeight: '700', fontSize: 14, letterSpacing: 1, textTransform: 'uppercase' }}>Clear</Text>
          </Pressable>
        </View>
        <SignaturePad paths={paths} box={box}
          onLayout={e => { const w = Math.round(e.nativeEvent.layout.width); if (w && w !== box.w) { setBox({ w, h: Math.round(Math.min(220, Math.max(140, w * 0.42))) }); setPaths([]); setInked(false); } }}
          onDrawing={on => setScrollOn(!on)}
          onStroke={(d, moved) => { setPaths(x => [...x, d]); if (moved) setInked(true); }} />

        <Pressable onPress={() => setAgree(!agree)} accessibilityRole="checkbox" accessibilityState={{ checked: agree }}
          style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 14, marginTop: 6 }}>
          <View style={{ width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: agree ? C.accent : C.muted, backgroundColor: agree ? C.accent : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
            {agree ? <Text style={{ color: '#141414', fontWeight: '900', fontSize: 16, lineHeight: 18 }}>✓</Text> : null}
          </View>
          <Text style={{ color: C.ink, fontSize: 15, lineHeight: 21, flex: 1 }}>
            I have read this {kind === 'waiver' ? 'waiver and release' : 'membership agreement'}, I agree to it, and I am signing it electronically with the same effect as signing on paper.
          </Text>
        </Pressable>

        <Btn label={busy ? 'Saving…' : kind === 'contract' && plan ? 'Sign and continue to payment' : 'Sign'} onPress={submit} disabled={busy} style={{ marginTop: 4 }} />
        <Muted style={{ marginTop: 10, textAlign: 'center', fontSize: 13, color: msg && msg !== 'Signed' && !busy ? C.down : C.muted }}>
          {msg || 'We save your name, signature, the date and time, and a fingerprint of this exact text.'}
        </Muted>
      </ScrollView>
    </Screen>
  );
}

/* ---------- signature pad ---------- */
const r1 = (v: number) => Math.round(v * 10) / 10;
const STROKE = { stroke: '#111111', strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };

// The saved image: white background, dark strokes, 600 px wide, drawn in the pad's own coordinates.
function sigSvg(paths: string[], w: number, h: number) {
  const W = 600, H = Math.max(1, Math.round((600 * h) / Math.max(1, w)));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${w} ${h}">`
    + `<rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff"/>`
    + `<path d="${paths.join(' ')}" fill="none" stroke="#111111" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function SignaturePad({ paths, box, onLayout, onDrawing, onStroke }: {
  paths: string[]; box: { w: number; h: number };
  onLayout: (e: LayoutChangeEvent) => void; onDrawing: (on: boolean) => void; onStroke: (d: string, moved: boolean) => void;
}) {
  const [live, setLive] = useState('');
  const cur = useRef('');
  const moved = useRef(false);
  const last = useRef<[number, number]>([0, 0]);
  const origin = useRef<[number, number]>([0, 0]);
  const size = useRef(box);
  size.current = box;
  const cb = useRef({ onDrawing, onStroke });
  cb.current = { onDrawing, onStroke };

  // Page coordinates minus where the pad sits, measured when the finger lands. Scrolling is off while drawing.
  const at = (e: GestureResponderEvent): [number, number] => {
    const { w, h } = size.current;
    const x = Math.max(0, Math.min(w, e.nativeEvent.pageX - origin.current[0]));
    const y = Math.max(0, Math.min(h, e.nativeEvent.pageY - origin.current[1]));
    return [x, y];
  };
  const end = () => {
    if (cur.current) {
      const d = moved.current ? cur.current : `${cur.current} l0.1 0`;
      cb.current.onStroke(d, moved.current);
    }
    cur.current = ''; moved.current = false; setLive('');
    cb.current.onDrawing(false);
  };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: e => {
      cb.current.onDrawing(true);
      const { pageX, pageY, locationX, locationY } = e.nativeEvent;
      origin.current = [pageX - locationX, pageY - locationY];
      const [x, y] = at(e);
      last.current = [x, y]; moved.current = false;
      cur.current = `M${r1(x)} ${r1(y)}`;
      setLive(cur.current);
    },
    onPanResponderMove: e => {
      if (!cur.current) return;
      const [x, y] = at(e), [lx, ly] = last.current;
      if (Math.hypot(x - lx, y - ly) < 1.5) return;
      last.current = [x, y]; moved.current = true;
      cur.current += ` L${r1(x)} ${r1(y)}`;
      setLive(cur.current);
    },
    onPanResponderRelease: end,
    onPanResponderTerminate: end,
  })).current;

  const d = [...paths, live].filter(Boolean).join(' ');
  return (
    <View onLayout={onLayout} {...pan.panHandlers} accessibilityLabel="Signature pad" accessibilityHint="Draw your signature with your finger"
      style={{ width: '100%', height: box.h || 160, backgroundColor: '#ffffff', borderRadius: 8, borderWidth: 1, borderColor: C.line, overflow: 'hidden' }}>
      <View pointerEvents="none" style={{ position: 'absolute', left: 16, right: 16, bottom: 28, borderBottomWidth: 1, borderBottomColor: '#C9CED8' }} />
      {!d ? <View pointerEvents="none" style={{ position: 'absolute', left: 16, bottom: 8 }}><Text style={{ color: '#9AA3B2', fontSize: 12 }}>Sign here</Text></View> : null}
      {box.w ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0 }}>
          <Svg width={box.w} height={box.h}>
            {d ? <Path d={d} {...STROKE} /> : null}
          </Svg>
        </View>
      ) : null}
    </View>
  );
}

const st = {
  h: { color: C.ink, fontSize: 18, fontWeight: '800' as const },
};
