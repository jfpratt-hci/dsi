import { router, useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import { Alert, Linking, Text, View } from 'react-native';

import { Btn, Card, Eyebrow, Group, Mono, Muted, PctBar, Row, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { colorOf, fmt, LIFTS, loadBoard, verdict, type BoardRow } from '@/lib/data';
import { inviteCrew } from '@/lib/invite';
import { unregisterPush } from '@/lib/notify';
import { myGyms } from '@/lib/office';
import { stopPurchases } from '@/lib/purchases';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

export default function Me() {
  const { me, session, isPro, isStaff } = useSession();
  const [row, setRow] = useState<BoardRow | null>(null);
  const [openReports, setOpenReports] = useState(0);
  const [gymName, setGymName] = useState('');
  const [staffGyms, setStaffGyms] = useState(0);

  useFocusEffect(useCallback(() => {
    if (!me) return;
    loadBoard().then(b => setRow(b.find(x => x.profile_id === me.id) ?? null)).catch(() => {});
    if (isStaff) sb.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open').then(({ count }) => setOpenReports(count ?? 0));
    if (me.gym_id) sb.from('gyms').select('name').eq('id', me.gym_id).maybeSingle().then(({ data }) => setGymName(data?.name ?? ''));
    else setGymName('');
    myGyms(me).then(g => setStaffGyms(g.length)).catch(() => setStaffGyms(0));
  }, [me, isStaff]));
  const year = String(new Date().getFullYear());

  if (!session) return (
    <Screen>
      <Title>Me</Title>
      <Card><Muted style={{ fontSize: 15 }}>New here? Enter your email, then your four lifts, and you are on the board. Already a member? Use the same email you use on dandystrength.com.</Muted></Card>
      <Btn label="Join or sign in" onPress={() => router.push('/login')} />
      <View style={{ height: 18 }} />
      <Group title="About">
        <Row first label="Community rules" onPress={() => router.push('/terms')} />
        <Row label="Privacy policy" onPress={() => Linking.openURL('https://dandystrength.com/privacy')} />
        <Row label="Support" onPress={() => Linking.openURL('https://dandystrength.com/support')} />
      </Group>
    </Screen>
  );

  const v = row ? verdict(row.score) : null;
  const role = me?.role === 'admin' ? 'Founder' : me?.role === 'commissioner' ? 'Commissioner' : isPro ? 'DSI Pro' : 'Member';

  function signOut() {
    Alert.alert('Sign out?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', onPress: async () => { await unregisterPush(); await stopPurchases(); await sb.auth.signOut(); } }]);
  }
  function deleteAccount() {
    Alert.alert('Delete your account?', 'This permanently deletes your profile, every lift, goal, log and message, and your login. It cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete forever', style: 'destructive', onPress: () => Alert.alert('Are you sure?', 'Last chance. Your spot on the board goes too.', [
        { text: 'Keep my account', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          const { error } = await sb.rpc('delete_my_account');
          if (error) { Alert.alert('Could not delete', error.message); return; }
          await sb.auth.signOut();
          Alert.alert('Account deleted', 'Your account and data have been removed.');
        } },
      ]) },
    ]);
  }

  return (
    <Screen>
      <Title eyebrow={`${me?.division ?? ''} · ${role}`}>{me?.display_name ?? 'Set up your profile'}</Title>
      {row ? (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View><Eyebrow>DSI™</Eyebrow><Mono style={{ fontSize: 44 }}>{row.score}</Mono></View>
            <View style={{ alignItems: 'flex-end' }}><Eyebrow>Total</Eyebrow><Mono style={{ fontSize: 44 }}>{fmt(row.total)}</Mono></View>
          </View>
          {v ? <Text style={{ color: C.accent, fontWeight: '900', fontSize: 20, textTransform: 'uppercase', marginTop: 10 }}>{v[1]}</Text> : null}
          {v ? <Text style={{ color: C.ink, marginTop: 4, fontSize: 15 }}>{me?.roast_opt_in ? v[2] : v[3]}</Text> : null}
          <View style={{ gap: 8, marginTop: 12 }}>
            {LIFTS.map(l => (
              <View key={l.k} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ width: 64, color: C.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }}>{l.n}</Text>
                <PctBar pct={row.p[l.k] || 0} color={colorOf(l.db)} />
                <Mono style={{ width: 44, textAlign: 'right', fontSize: 13 }}>{(row as any)[l.k] || '·'}</Mono>
              </View>
            ))}
          </View>
        </Card>
      ) : <Card><Muted style={{ fontSize: 15 }}>Log your four lifts to get your DSI™.</Muted></Card>}

      <Group title="You">
        <Row first label="My card and lift history" onPress={() => me && router.push({ pathname: '/lifter/[id]', params: { id: me.id } })} />
        <Row label="My training" detail="Sessions, sets and reps" onPress={() => router.push('/training' as any)} />
        <Row label="Edit profile" onPress={() => router.push('/profile')} />
        <Row label="Goals" pro onPress={() => router.push(isPro ? '/goals' : '/pro')} />
        <Row label="Settings and notifications" onPress={() => router.push('/settings')} />
      </Group>

      <Group title="My gym">
        <Row first label="My gym" detail={gymName || 'Pick your gym'} onPress={() => router.push(me?.gym_id ? '/mygym' : '/compete/gyms')} />
        {me?.gym_id ? <Row label="Book a class" onPress={() => router.push('/mygym/classes')} /> : null}
        {me?.gym_id ? <Row label="Gym board" onPress={() => router.push({ pathname: '/compete/gym/[id]', params: { id: me.gym_id! } })} /> : null}
        <Row label="Gym league" onPress={() => router.push('/compete/gyms')} />
      </Group>

      {staffGyms ? (
        <Group title="Gym office">
          <Row first label="Check in and gym office" detail={staffGyms > 1 ? `${staffGyms} gyms` : undefined} onPress={() => router.push('/office')} />
          <Row label="Log a class" onPress={() => router.push('/office/class')} />
          <Row label="Enter results" onPress={() => router.push('/office/results')} />
        </Group>
      ) : null}

      <Group title="Compete">
        <Row first label="Compete" detail="Seasons and battles" onPress={() => router.push('/compete')} />
        <Row label="Weekly battles" pro onPress={() => router.push('/compete/battles')} />
        <Row label="This season" onPress={() => router.push('/compete/season')} />
        <Row label="Benchmarks" onPress={() => router.push('/compete/benchmarks')} />
        <Row label="Year recap" pro onPress={() => (isPro ? router.push({ pathname: '/compete/recap', params: { year } }) : router.push('/pro'))} />
        <Row label="PR wall" onPress={() => router.push('/prs')} />
        <Row label="Protests" onPress={() => router.push('/protests')} />
      </Group>

      <Group title="DSI Pro">
        <Row first label="Progress charts" pro onPress={() => router.push(isPro ? '/progress' : '/pro')} />
        <Row label="Goal plans" pro onPress={() => router.push(isPro ? '/plans' : '/pro')} />
        <Row label="Coach" pro onPress={() => router.push(isPro ? '/coach' : '/pro')} />
        <Row label="Import history" pro onPress={() => router.push(isPro ? '/import' : '/pro')} />
        <Row label={isPro ? 'Your Pro membership' : 'See DSI Pro'} detail={isPro ? 'Active' : undefined} onPress={() => router.push('/pro')} />
      </Group>

      <Group title="Community">
        <Row first label="Invite your crew" onPress={() => inviteCrew(me?.display_name)} />
        <Row label="Plate calculator" onPress={() => router.push('/plates')} />
        {isStaff ? <Row label="Reports" detail={openReports ? `${openReports} open` : 'None open'} onPress={() => router.push('/reports')} /> : null}
        {me?.role === 'admin' ? <Row label="Management dashboard" detail="Website" onPress={() => WebBrowser.openBrowserAsync('https://dandystrength.com/admin').catch(() => {})} /> : null}
        <Row label="Blocked lifters" onPress={() => router.push('/blocked')} />
        <Row label="Community rules" onPress={() => router.push('/terms')} />
      </Group>

      <Group title="Account">
        <Row first label="Email" detail={session.user.email ?? ''} onPress={() => {}} />
        <Row label="Privacy policy" onPress={() => Linking.openURL('https://dandystrength.com/privacy')} />
        <Row label="Support" onPress={() => Linking.openURL('https://dandystrength.com/support')} />
        <Row label="Sign out" onPress={signOut} />
        <Row label="Delete account" danger onPress={deleteAccount} />
      </Group>
      <Muted style={{ textAlign: 'center', fontSize: 12 }}>Dandy Strength™ · For bragging rights, not medical or training advice.</Muted>
    </Screen>
  );
}
