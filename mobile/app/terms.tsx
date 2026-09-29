import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { Btn, Card, Muted, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { useSession } from '@/lib/session';
import { RULES } from '@/lib/rules';
import { sb } from '@/lib/supabase';


export default function Terms() {
  const { me, reloadMe } = useSession();
  const [busy, setBusy] = useState(false);
  const accepted = !!me?.terms_accepted_at;

  async function accept() {
    if (!me) { router.back(); return; }
    setBusy(true);
    const { error } = await sb.from('profiles').update({ terms_accepted_at: new Date().toISOString() }).eq('id', me.id);
    setBusy(false);
    if (error) return;
    await reloadMe();
    if (router.canGoBack()) router.back(); else router.replace('/');
  }

  return (
    <Screen stack>
      <Title eyebrow="Before you post" accent="rules">Community</Title>
      <Muted style={{ fontSize: 15, marginBottom: 14 }}>DSI has zero tolerance for abusive content or abusive users. By joining you agree to these rules and the terms of use.</Muted>
      {RULES.map(([h, t], i) => (
        <Card key={h} accent={i === 1 ? C.accent : C.line}>
          <Text style={{ color: C.ink, fontWeight: '800', fontSize: 16, textTransform: 'uppercase', marginBottom: 4 }}>{h}</Text>
          <Text style={{ color: C.muted, fontSize: 15, lineHeight: 21 }}>{t}</Text>
        </Card>
      ))}
      <View style={{ flexDirection: 'row', gap: 16, marginVertical: 10 }}>
        <Text style={{ color: C.accent }} onPress={() => Linking.openURL('https://dandystrength.com/#/terms')}>Terms of use</Text>
        <Text style={{ color: C.accent }} onPress={() => Linking.openURL('https://dandystrength.com/#/privacy')}>Privacy policy</Text>
      </View>
      {accepted ? <Muted style={{ textAlign: 'center' }}>You accepted these rules.</Muted>
        : <Btn label="I agree" onPress={accept} disabled={busy} />}
    </Screen>
  );
}
