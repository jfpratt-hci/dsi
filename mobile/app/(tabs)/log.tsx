import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { Btn, Card, Chip, Eyebrow, Mono, Muted, s, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { liftName, today } from '@/lib/data';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

const MAIN = ['bench', 'squat', 'deadlift', 'clean'];
const MORE = ['front_squat', 'overhead_squat', 'snatch', 'squat_snatch', 'power_snatch', 'squat_clean', 'power_clean', 'clean_and_jerk', 'jerk', 'strict_press', 'push_press', 'sumo_deadlift'];

export default function Log() {
  const { me } = useSession();
  const [lift, setLift] = useState('bench');
  const [w, setW] = useState('');
  const [best, setBest] = useState<Record<string, number>>({});
  const [more, setMore] = useState(false);
  const [msg, setMsg] = useState('');

  useFocusEffect(useCallback(() => {
    if (!me) return;
    sb.from('lift_bests').select('lift,weight_lb').eq('profile_id', me.id).then(({ data }) => {
      setBest(Object.fromEntries((data ?? []).map((b: any) => [b.lift, Number(b.weight_lb)])));
    });
  }, [me]));

  if (!me) {
    return (
      <Screen>
        <Title accent="lift">Log a</Title>
        <Card><Muted>Sign in to log lifts. Boards stay public.</Muted></Card>
        <Btn label="Sign in" onPress={() => router.push('/login')} />
      </Screen>
    );
  }

  const b = best[lift] || 0, n = Number(w) || 0, pr = n > 0 && n > b;
  const step = (d: number) => setW(String(Math.max(5, (n || b || 135) + d)));

  async function save() {
    if (!n) { setMsg('Enter a weight first.'); return; }
    setMsg('Saving…');
    const { data, error } = await sb.from('lift_entries').insert({ profile_id: me!.id, lift, weight_lb: n, performed_on: today(), source: 'manual' }).select().single();
    if (error) { setMsg(error.message); return; }
    setBest({ ...best, [lift]: Math.max(b, n) });
    setW('');
    setMsg(data.is_pr ? `New ${liftName(lift)} PR: ${data.prev_best ? data.prev_best + ' → ' : ''}${n} lb! It's on the PR wall.` : `Logged ${n} lb. Your best is still ${data.prev_best}.`);
  }

  return (
    <Screen>
      <Title accent="lift">Log a</Title>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {MAIN.map(id => <Chip key={id} label={liftName(id)} on={lift === id} onPress={() => { setLift(id); setW(''); }} />)}
        <Chip label={more ? 'Fewer' : 'More lifts'} on={false} onPress={() => setMore(!more)} />
      </View>
      {more ? <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{MORE.map(id => <Chip key={id} label={liftName(id)} on={lift === id} onPress={() => { setLift(id); setW(''); }} />)}</View> : null}

      <View style={{ alignItems: 'center', marginVertical: 16 }}>
        <Eyebrow>{liftName(lift)} · weight lb</Eyebrow>
        <TextInput value={w} onChangeText={v => setW(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder={b ? String(b + 5) : '135'} placeholderTextColor="#5A6478"
          accessibilityLabel="Weight in pounds" style={{ fontSize: 72, fontWeight: '700', color: pr ? C.accent : C.ink, textAlign: 'center', minWidth: 200 }} />
        <Text style={{ color: pr ? C.up : C.muted, fontWeight: '600' }}>{pr ? `PR! Beats your ${b || 'first'} ${b ? 'by ' + (n - b) : 'lift'}` : b ? `Your best is ${b}` : 'First one sets your baseline'}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
        {[-10, -5, 5, 10].map(d => <Btn key={d} ghost label={(d > 0 ? '+' : '−') + Math.abs(d)} onPress={() => step(d)} style={{ flex: 1 }} />)}
      </View>
      <Btn label={pr ? 'Log the PR' : 'Log it'} onPress={save} />
      {msg ? <Card style={{ marginTop: 14 }}><Mono style={{ color: msg.startsWith('New') ? C.accent : C.ink, fontFamily: undefined }}>{msg}</Mono></Card> : null}
    </Screen>
  );
}
