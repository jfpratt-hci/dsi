// 1.7 Notifications: our own explainer first, then the system prompt only if they say yes.
import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Btn, Card, Muted, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { askPermission, registerPush, scheduleReminders } from '@/lib/notify';
import { useSession } from '@/lib/session';

const WHAT = [
  ['Workout reminders', 'A nudge at the time you pick on days with programming. Skipped once you have logged.'],
  ['New PRs', 'When someone in the index hits a PR. Protest it or top it.'],
  ['New programming', 'When the week goes up with your target weights.'],
];

export default function NotificationsOptIn() {
  const { me } = useSession();
  const [busy, setBusy] = useState(false);
  async function yes() {
    setBusy(true);
    const ok = await askPermission();
    if (ok && me) { await registerPush(me); await scheduleReminders(me); }
    setBusy(false);
    done();
  }
  const done = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <Screen stack>
      <Title eyebrow="Last step" accent="logging">Keep</Title>
      <Muted style={{ fontSize: 15, marginBottom: 14 }}>The lifters who climb are the ones who log every session. DSI can remind you.</Muted>
      {WHAT.map(([h, t]) => (
        <Card key={h} accent={C.accent}>
          <Text style={{ color: C.ink, fontWeight: '800', fontSize: 16, marginBottom: 2 }}>{h}</Text>
          <Muted style={{ fontSize: 14 }}>{t}</Muted>
        </Card>
      ))}
      <Muted style={{ fontSize: 13, marginBottom: 14 }}>Change the reminder time or turn any of these off in Settings.</Muted>
      <View style={{ gap: 10 }}>
        <Btn label="Turn on notifications" onPress={yes} disabled={busy} />
        <Btn ghost label="Not now" onPress={done} />
      </View>
    </Screen>
  );
}
