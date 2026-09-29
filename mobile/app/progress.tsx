import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { LineChart } from '@/components/LineChart';
import { Card, Chip, Eyebrow, Loading, Mono, Muted, Screen } from '@/components/ui';
import { C } from '@/constants/Colors';
import { colorOf, fmt, fmtD, liftName, type Entry } from '@/lib/data';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

export default function Progress() {
  const { me } = useSession();
  const [hist, setHist] = useState<Entry[] | null>(null);
  const [goals, setGoals] = useState<Record<string, number>>({});
  const [lift, setLift] = useState('bench');

  const load = useCallback(async () => {
    if (!me) return;
    const [{ data }, { data: g }] = await Promise.all([
      sb.from('lift_entries').select('*').eq('profile_id', me.id).neq('status', 'struck').order('performed_on'),
      sb.from('goals').select('lift,target_lb').eq('profile_id', me.id),
    ]);
    setHist((data as Entry[]) ?? []);
    setGoals(Object.fromEntries((g ?? []).map((x: any) => [x.lift, Number(x.target_lb)])));
  }, [me]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const lifts = useMemo(() => [...new Set((hist ?? []).map(e => e.lift))], [hist]);
  const rows = (hist ?? []).filter(e => e.lift === lift);
  // Best per day, then the running best line
  const byDay = new Map<string, number>();
  rows.forEach(e => byDay.set(e.performed_on, Math.max(byDay.get(e.performed_on) || 0, Number(e.weight_lb))));
  let run = 0;
  const pts = [...byDay.entries()].sort().map(([d, w]) => { run = Math.max(run, w); return { x: new Date(d + 'T12:00:00').getTime(), y: run }; });
  const first = pts[0]?.y ?? 0, best = run, prs = rows.filter(e => e.is_pr);
  const lastPR = prs[prs.length - 1];

  if (!hist) return <Screen stack><Loading /></Screen>;
  return (
    <Screen stack>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
        {(lifts.length ? lifts : ['bench']).map(l => <Chip key={l} label={liftName(l)} on={lift === l} onPress={() => setLift(l)} />)}
      </ScrollView>
      <Card>
        <Eyebrow>{liftName(lift)} · best over time</Eyebrow>
        {pts.length >= 1 ? <LineChart points={pts} color={colorOf(lift)} goal={goals[lift]} /> : <Muted style={{ marginVertical: 40, textAlign: 'center' }}>Log a {liftName(lift).toLowerCase()} to start the chart.</Muted>}
        {goals[lift] ? <Muted style={{ fontSize: 12 }}><Text style={{ color: C.up }}>- - -</Text> goal {fmt(goals[lift])} lb</Muted> : null}
      </Card>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {[['Best', best ? fmt(best) : '·'], ['Gained', best ? `+${fmt(best - first)}` : '·'], ['PRs', String(prs.length)]].map(([k, v]) => (
          <Card key={k} style={{ flex: 1, alignItems: 'center' }}><Eyebrow>{k}</Eyebrow><Mono style={{ fontSize: 24, color: k === 'Gained' ? C.up : C.ink }}>{v}</Mono></Card>
        ))}
      </View>
      {lastPR ? <Card><Muted style={{ fontSize: 14 }}>Last PR {fmtD(lastPR.performed_on)}: {fmt(lastPR.weight_lb)} lb{lastPR.prev_best ? ` (was ${fmt(lastPR.prev_best)})` : ''}</Muted></Card> : null}
      <Eyebrow style={{ marginVertical: 8 }}>Every {liftName(lift).toLowerCase()} logged</Eyebrow>
      {[...rows].reverse().map(e => (
        <View key={e.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.line }}>
          <Muted style={{ fontSize: 14 }}>{fmtD(e.performed_on)}{e.is_pr ? '  · PR' : ''}</Muted><Mono>{fmt(e.weight_lb)}</Mono>
        </View>
      ))}
    </Screen>
  );
}
