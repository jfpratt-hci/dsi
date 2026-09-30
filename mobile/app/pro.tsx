import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, Text, View } from 'react-native';

import { Btn, Card, Eyebrow, Mono, Muted, Screen } from '@/components/ui';
import { C } from '@/constants/Colors';
import { buy, loadPlans, manage, restore, SALES_ON, type Plan } from '@/lib/purchases';
import { useSession } from '@/lib/session';

const PERKS: [string, string, string][] = [
  ['Your target weights', 'Every workout turned into weights built from your own PRs.', '/(tabs)/week'],
  ['Workout logging and day boards', 'Log sets, reps and scores. See how you stack up each day.', '/(tabs)/week'],
  ['Every board and filter', 'Total and single lift boards, age brackets.', '/(tabs)'],
  ['Goals, plans and charts', 'Set a date and get a week by week path to your number.', '/plans'],
  ['Coach', 'Your weak links, your ratios, and what to train next.', '/coach'],
  ['Video on any set', 'Proof on every lift, not just PRs.', '/(tabs)/log'],
  ['Threads, groups and roast mode', 'Post in every thread, start your own groups, opt in to the roast.', '/(tabs)/chat'],
  ['Full history and imports', 'Every lift you ever logged, plus years more from a spreadsheet.', '/import'],
];

export default function Pro() {
  const { me, isPro, setStorePro } = useSession();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [pick, setPick] = useState<string>('');
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => {
    if (!SALES_ON || isPro) return;
    loadPlans().then(p => { setPlans(p); setPick(p.find(x => x.per === 'a year')?.id ?? p[0]?.id ?? ''); }).catch(() => setPlans([]));
  }, [isPro]));

  async function purchase() {
    if (!me) { router.push('/login'); return; }
    const plan = plans?.find(p => p.id === pick); if (!plan) return;
    setBusy(true);
    try {
      const ok = await buy(plan);
      if (ok) { setStorePro(true); Alert.alert('Welcome to DSI Pro', 'Everything is unlocked. Go set a goal.'); }
    } catch (e: any) { Alert.alert('Purchase did not go through', e?.message ?? String(e)); }
    setBusy(false);
  }
  async function doRestore() {
    setBusy(true);
    try { const ok = await restore(); setStorePro(ok); Alert.alert(ok ? 'Pro restored' : 'Nothing to restore', ok ? 'DSI Pro is active on this device.' : 'No DSI Pro purchase was found for this account.'); }
    catch (e: any) { Alert.alert('Restore failed', e?.message ?? String(e)); }
    setBusy(false);
  }

  return (
    <Screen stack>
      <Eyebrow style={{ color: C.accent }}>DSI Pro</Eyebrow>
      <Text style={{ color: C.ink, fontSize: 38, fontWeight: '900', textTransform: 'uppercase', marginBottom: 6 }}>Train with a <Text style={{ color: C.accent }}>plan</Text></Text>
      <Muted style={{ fontSize: 15, marginBottom: 14 }}>Free gets you your DSI, the overall board and PR logging. Pro is the daily training loop.</Muted>
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
        <Card style={{ borderColor: C.up }}>
          <Text style={{ color: C.up, fontWeight: '800', fontSize: 16 }}>Pro is active on your account</Text>
          <Muted style={{ fontSize: 14 }}>{me?.role === 'admin' || me?.role === 'commissioner' ? 'Included with your staff role.' : me?.pro_source === 'app_store' ? 'Thanks for backing the index.' : 'Granted by the DSI team.'}</Muted>
          {me?.pro_source === 'app_store' ? <Btn ghost label="Manage subscription" onPress={manage} style={{ marginTop: 10 }} /> : null}
        </Card>
      ) : !SALES_ON ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginVertical: 10 }}>
            <Mono style={{ fontSize: 34 }}>$9.99</Mono><Muted style={{ fontSize: 15 }}>a month, or $59.99 a year</Muted>
          </View>
          <Btn label="Coming soon" onPress={() => {}} disabled />
          <Muted style={{ textAlign: 'center', marginTop: 10, fontSize: 13 }}>Pro memberships open in an upcoming update.</Muted>
        </>
      ) : !plans ? <ActivityIndicator color={C.accent} style={{ marginVertical: 20 }} /> : !plans.length ? (
        <Card><Muted>Pro is not available in your store right now. Try again later.</Muted></Card>
      ) : (
        <>
          <View style={{ gap: 10, marginVertical: 10 }}>
            {plans.map(p => (
              <Pressable key={p.id} onPress={() => setPick(p.id)} accessibilityRole="radio" accessibilityState={{ selected: pick === p.id }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 12, borderWidth: 2, borderColor: pick === p.id ? C.accent : C.line, backgroundColor: C.panel }}>
                <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '800', fontSize: 17 }}>{p.title}</Text>{p.per === 'a year' ? <Muted style={{ fontSize: 13 }}>Best value</Muted> : null}</View>
                <Mono style={{ fontSize: 20 }}>{p.price}</Mono><Muted>{p.per}</Muted>
              </Pressable>
            ))}
          </View>
          <Btn label={busy ? 'Working…' : 'Start DSI Pro'} onPress={purchase} disabled={busy || !pick} />
          <Pressable onPress={doRestore} accessibilityRole="button" style={{ padding: 14, alignItems: 'center' }}><Text style={{ color: C.ink, fontWeight: '600' }}>Restore purchases</Text></Pressable>
          <Muted style={{ fontSize: 12, textAlign: 'center' }}>Renews automatically until you cancel. Cancel any time in your App Store or Google Play account settings at least 24 hours before renewal.</Muted>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 8 }}>
            <Text style={{ color: C.accent }} onPress={() => Linking.openURL('https://dandystrength.com/terms')}>Terms of use</Text>
            <Text style={{ color: C.accent }} onPress={() => Linking.openURL('https://dandystrength.com/privacy')}>Privacy policy</Text>
          </View>
        </>
      )}
    </Screen>
  );
}
