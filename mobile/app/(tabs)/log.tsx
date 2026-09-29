import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Btn, Card, Chip, Eyebrow, Mono, Muted, ProBadge, s, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { liftName, today } from '@/lib/data';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';
import { addVideo } from '@/lib/video';

const MAIN = ['bench', 'squat', 'deadlift', 'clean'];
const MORE = ['front_squat', 'overhead_squat', 'snatch', 'squat_snatch', 'power_snatch', 'squat_clean', 'power_clean', 'clean_and_jerk', 'jerk', 'strict_press', 'push_press', 'sumo_deadlift'];

export default function Log() {
  const { me, isPro } = useSession();
  const [lift, setLift] = useState('bench');
  const [w, setW] = useState('');
  const [best, setBest] = useState<Record<string, number>>({});
  const [more, setMore] = useState(false);
  const [msg, setMsg] = useState('');
  const [last, setLast] = useState<{ id: string; pr: boolean; video?: string } | null>(null);

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

  async function attach(src: 'camera' | 'library') {
    if (!last || !me) return;
    setMsg('Uploading video…');
    const path = await addVideo(last.id, me.id, src);
    if (path) { setLast({ ...last, video: path }); setMsg(last.pr ? 'Video attached. Your PR has proof now.' : 'Video attached.'); }
    else setMsg('');
  }

  async function save() {
    if (!n) { setMsg('Enter a weight first.'); return; }
    setMsg('Saving…');
    const { data, error } = await sb.from('lift_entries').insert({ profile_id: me!.id, lift, weight_lb: n, performed_on: today(), source: 'manual' }).select().single();
    if (error) { setMsg(error.message); return; }
    setBest({ ...best, [lift]: Math.max(b, n) });
    setLast({ id: data.id, pr: !!data.is_pr });
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
      {last && !last.video ? (
        last.pr || isPro ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Btn ghost label="Record video" onPress={() => attach('camera')} style={{ flex: 1 }} />
            <Btn ghost label="Pick video" onPress={() => attach('library')} style={{ flex: 1 }} />
          </View>
        ) : (
          <Pressable onPress={() => router.push('/pro')} style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', padding: 10 }}>
            <Muted>Add video to any set</Muted><ProBadge />
          </Pressable>
        )
      ) : null}
      {last?.video ? <Btn ghost label="▶ Watch your video" onPress={() => router.push({ pathname: '/video', params: { path: last.video! } })} /> : null}
    </Screen>
  );
}
