// 5.5 Settings: notifications and reminder time, membership, invite, help, sign out, delete account.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking, ScrollView, Switch, Text, View } from 'react-native';

import { Chip, Group, Muted, Row, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { inviteCrew } from '@/lib/invite';
import { askPermission, permission, registerPush, scheduleReminders, unregisterPush } from '@/lib/notify';
import { manage, restore, SALES_ON, stopPurchases } from '@/lib/purchases';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

const HOURS = [5, 6, 7, 12, 16, 17, 18, 19, 20, 21];
const hl = (h: number) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;

export default function Settings() {
  const { me, session, isPro, reloadMe, setStorePro } = useSession();
  const [perm, setPerm] = useState<string>('undetermined');
  useFocusEffect(useCallback(() => { permission().then(setPerm); }, []));
  if (!me || !session) return <Screen stack><Muted>Sign in first.</Muted></Screen>;

  async function set(patch: Record<string, unknown>) {
    const { error } = await sb.from('profiles').update(patch).eq('id', me!.id);
    if (error) { Alert.alert('Could not save', error.message); return; }
    await reloadMe();
    const { data } = await sb.from('profiles').select('*').eq('id', me!.id).single();
    if (data) scheduleReminders(data as any).catch(() => {});
  }
  async function enable() {
    const ok = await askPermission();
    setPerm(ok ? 'granted' : 'denied');
    if (ok) { await registerPush(me!); await scheduleReminders(me!); }
    else Alert.alert('Notifications are off', 'Turn them on for DSI in your phone Settings.', [{ text: 'Not now', style: 'cancel' }, { text: 'Open Settings', onPress: () => Linking.openSettings() }]);
  }
  async function doRestore() {
    try {
      const ok = await restore();
      setStorePro(ok);
      Alert.alert(ok ? 'Pro restored' : 'Nothing to restore', ok ? 'Your DSI Pro membership is active on this device.' : 'No DSI Pro purchase was found for this Apple or Google account.');
    } catch (e: any) { Alert.alert('Restore failed', e?.message ?? String(e)); }
  }
  function signOut() {
    Alert.alert('Sign out?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', onPress: async () => { await unregisterPush(); await stopPurchases(); await sb.auth.signOut(); router.replace('/'); } }]);
  }

  const toggle = (label: string, key: 'notify_reminders' | 'notify_prs' | 'notify_program', sub: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: key === 'notify_reminders' ? 0 : 1, borderTopColor: C.line }}>
      <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontSize: 16 }}>{label}</Text><Muted style={{ fontSize: 13 }}>{sub}</Muted></View>
      <Switch value={!!me[key]} onValueChange={v => set({ [key]: v })} trackColor={{ true: C.accent, false: C.line }} thumbColor={C.ink} accessibilityLabel={label} />
    </View>
  );

  return (
    <Screen stack>
      <Title accent="settings">Your</Title>
      <Group title="Notifications">
        {perm !== 'granted' ? <Row first label="Turn on notifications" detail={perm === 'denied' ? 'Off in phone settings' : 'Off'} onPress={enable} /> : null}
        {perm === 'granted' ? (<>
          {toggle('Workout reminders', 'notify_reminders', 'Days with programming, until you log')}
          {toggle('New PRs', 'notify_prs', 'When anyone hits a PR')}
          {toggle('New programming', 'notify_program', 'When the week goes up')}
        </>) : null}
      </Group>
      {perm === 'granted' && me.notify_reminders ? (
        <View style={{ marginBottom: 18 }}>
          <Muted style={{ marginBottom: 6 }}>Remind me at</Muted>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {HOURS.map(h => <Chip key={h} label={hl(h)} on={(me.reminder_hour ?? 18) === h} onPress={() => set({ reminder_hour: h })} />)}
          </ScrollView>
        </View>
      ) : null}

      <Group title="Membership">
        <Row first label={isPro ? 'DSI Pro' : 'See DSI Pro'} detail={isPro ? (me.role === 'admin' ? 'Founder' : me.role === 'commissioner' ? 'Commissioner' : 'Active') : undefined} onPress={() => router.push('/pro')} />
        {SALES_ON ? <Row label="Restore purchases" onPress={doRestore} /> : null}
        {SALES_ON && me.pro_source === 'app_store' ? <Row label="Manage subscription" onPress={manage} /> : null}
      </Group>

      <Group title="Crew">
        <Row first label="Invite your crew" onPress={() => inviteCrew(me.display_name)} />
        <Row label="Plate calculator" onPress={() => router.push('/plates')} />
      </Group>

      <Group title="Help">
        <Row first label="Community rules" onPress={() => router.push('/terms')} />
        <Row label="Privacy policy" onPress={() => Linking.openURL('https://dandystrength.com/privacy')} />
        <Row label="Terms of use" onPress={() => Linking.openURL('https://dandystrength.com/terms')} />
        <Row label="Support" onPress={() => Linking.openURL('https://dandystrength.com/support')} />
      </Group>

      <Group title="Account">
        <Row first label="Email" detail={session.user.email ?? ''} onPress={() => {}} />
        <Row label="Sign out" onPress={signOut} />
      </Group>
    </Screen>
  );
}
