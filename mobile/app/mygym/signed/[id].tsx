// A signed record (web: /signed/<id>): the exact text, who signed, when (gym time zone), the plan, the fingerprint and the drawn signature.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, Share, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { Btn, Card, Eyebrow, Loading, Mono, Muted, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { docVals, fillDoc, gymById, money, must, people, sigImage, type Gym, type GymDoc, type Signature } from '@/lib/club';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

type Data = { s: Signature; doc: GymDoc | null; g: Gym | null; who: string };

export default function Signed() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me, session, ready } = useSession();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [w, setW] = useState(0);

  const load = useCallback(async () => {
    if (!me || !id) return;
    try {
      const s = must(await sb.from('doc_signatures').select('*').eq('id', id).maybeSingle()) as Signature | null;
      if (!s) { setErr('No signature here, or it is not yours to see.'); return; }
      const [doc, g, who] = await Promise.all([
        sb.from('gym_docs').select('*').eq('id', s.doc_id).maybeSingle().then(must) as Promise<GymDoc | null>,
        gymById(s.gym_id),
        people([s.profile_id]),
      ]);
      setD({ s, doc, g, who: who.get(s.profile_id) || '' });
      setErr('');
    } catch (e: any) {
      setErr(e?.message ?? 'Could not load this record.');
    }
  }, [me?.id, id]);
  useEffect(() => { load(); }, [load]);

  const head = <Stack.Screen options={{ title: 'Signed record' }} />;
  if (!ready) return <Screen stack>{head}<Loading /></Screen>;
  if (!session) return (
    <Screen stack>{head}
      <Card><Text style={st.h}>Sign in to see this</Text></Card>
      <Btn label="Sign in" onPress={() => router.push('/login')} />
    </Screen>
  );
  if (!d) return <Screen stack>{head}{err ? <><Card><Muted style={{ fontSize: 15 }}>{err}</Muted></Card><Btn ghost label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/mygym'))} /></> : <Loading />}</Screen>;

  const { s, doc, g, who } = d;
  const tz = g?.tz || 'America/New_York';
  const vals = s.context?.values || (g ? docVals(g, { member: s.signed_name }) : { member: s.signed_name });
  const text = doc ? fillDoc(doc.body, vals) : '';
  let at = s.signed_at;
  try { at = new Date(s.signed_at).toLocaleString('en-US', { timeZone: tz, month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch {}
  const img = sigImage(s.signature);
  const plan = s.context?.plan ? `${s.context.plan} ${money(s.context.price_cents)}` : '';

  async function share() {
    const lines = [
      `${doc?.title ?? 'Signed document'}${g ? ` · ${g.name}` : ''}`,
      `Version ${doc?.version ?? ''} · signed by ${s.signed_name} on ${at}`,
      plan ? `Plan: ${plan}` : '',
      `Text fingerprint (SHA 256): ${s.body_sha256}`,
      '',
      text,
    ].filter((x, i) => x || i === 4);
    await Share.share({ message: lines.join('\n') }).catch(() => {});
  }

  return (
    <Screen stack>
      {head}
      <Title eyebrow={`${g?.name ?? 'Gym'} · signed record`}>{doc?.title ?? 'Signed document'}</Title>
      <Muted style={{ fontSize: 14, marginTop: -6, marginBottom: 12 }}>
        Version {doc?.version ?? ''} · signed by {s.signed_name}{who ? ` (${who})` : ''} on {at}
      </Muted>

      {text ? <Card><Text style={{ color: C.ink, fontSize: 15, lineHeight: 23 }} selectable>{text}</Text></Card> : null}

      <Card>
        <Eyebrow style={{ marginBottom: 8 }}>Signature</Eyebrow>
        <View onLayout={e => setW(Math.round(e.nativeEvent.layout.width))}
          style={{ backgroundColor: '#ffffff', borderRadius: 6, overflow: 'hidden', width: '100%' }}
          accessible accessibilityRole="image" accessibilityLabel={`Signature of ${s.signed_name}`}>
          {!img ? <Text style={{ color: '#444', padding: 16 }}>No drawing on file.</Text>
            : 'svg' in img ? (w ? <SvgXml xml={img.svg} width={w} height={Math.round(w / svgRatio(img.svg))} /> : <View style={{ aspectRatio: 15 / 4 }} />)
            : <Image source={{ uri: img.uri }} style={{ width: '100%', aspectRatio: 600 / 160 }} resizeMode="contain" />}
        </View>
        <View style={{ marginTop: 12, gap: 4 }}>
          <Text style={{ color: C.ink, fontSize: 14 }}>Signed name: {s.signed_name}{plan ? ` · Plan: ${plan}` : ''}</Text>
          <Muted>Text fingerprint (SHA 256):</Muted>
          <Mono style={{ fontSize: 11, color: C.muted }} >{s.body_sha256}</Mono>
          {s.user_agent ? <Muted>Device: {s.user_agent}</Muted> : null}
        </View>
      </Card>
      <Btn ghost label="Share a copy" onPress={share} />
    </Screen>
  );
}

// Width over height from the SVG's viewBox (or width and height), for drawing it at the right shape.
function svgRatio(svg: string) {
  const vb = svg.match(/viewBox="\s*[\d.]+[\s,]+[\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/);
  if (vb && +vb[1] > 0 && +vb[2] > 0) return +vb[1] / +vb[2];
  const w = svg.match(/\bwidth="([\d.]+)"/), h = svg.match(/\bheight="([\d.]+)"/);
  if (w && h && +w[1] > 0 && +h[1] > 0) return +w[1] / +h[1];
  return 15 / 4;
}

const st = {
  h: { color: C.ink, fontSize: 18, fontWeight: '800' as const },
};
