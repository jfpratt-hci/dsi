import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { Btn, Card, Eyebrow, Mono, Muted, Screen } from '@/components/ui';
import { C } from '@/constants/Colors';
import { useSession } from '@/lib/session';

const PERKS: [string, string, string][] = [
  ['Progress charts', 'Every lift over time, with your goal line and PR markers.', '/progress'],
  ['Goal plans', 'Set a date and get a week by week path to your number.', '/plans'],
  ['Coach', 'Your weak links, your ratios, and what to train next.', '/coach'],
  ['Video on any set', 'Attach video to any lift, not just PRs.', '/progress'],
  ['Pro groups', 'Private rooms for Pro lifters.', '/(tabs)/chat'],
  ['History import', 'Bring years of lifts in from a spreadsheet.', '/import'],
];

export default function Pro() {
  const { me, isPro } = useSession();
  return (
    <Screen stack>
      <Eyebrow style={{ color: C.accent }}>DSI Pro</Eyebrow>
      <Text style={{ color: C.ink, fontSize: 38, fontWeight: '900', textTransform: 'uppercase', marginBottom: 6 }}>Train with a <Text style={{ color: C.accent }}>plan</Text></Text>
      <Muted style={{ fontSize: 15, marginBottom: 14 }}>Everything in Member, plus the tools that turn numbers into progress.</Muted>
      {PERKS.map(([h, t, to]) => (
        <Card key={h} accent={C.accent} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.ink, fontWeight: '800', fontSize: 16 }}>{h}</Text>
            <Muted style={{ fontSize: 14 }}>{t}</Muted>
          </View>
          {isPro ? <Text style={{ color: C.accent, fontSize: 22 }} onPress={() => router.push(to as any)}>›</Text> : null}
        </Card>
      ))}
      {isPro ? (
        <Card style={{ borderColor: C.up }}><Text style={{ color: C.up, fontWeight: '800', fontSize: 16 }}>Pro is active on your account</Text><Muted style={{ fontSize: 14 }}>{me?.role === 'admin' || me?.role === 'commissioner' ? 'Included with your staff role.' : 'Thanks for backing the index.'}</Muted></Card>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginVertical: 10 }}>
            <Mono style={{ fontSize: 34 }}>$9.99</Mono><Muted style={{ fontSize: 15 }}>a month, or $59.99 a year</Muted>
          </View>
          <Btn label="Coming soon" onPress={() => {}} disabled />
          <Muted style={{ textAlign: 'center', marginTop: 10, fontSize: 13 }}>Pro memberships open in an upcoming update.</Muted>
        </>
      )}
    </Screen>
  );
}
