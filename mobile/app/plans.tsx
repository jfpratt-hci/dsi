import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { Btn, Card, Eyebrow, Loading, Mono, Muted, PctBar, Screen } from '@/components/ui';
import { C } from '@/constants/Colors';
import { addDays, colorOf, fmt, fmtD, liftName, monday, today } from '@/lib/data';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

const r5 = (x: number) => Math.round(x / 5) * 5;

// Linear path from today's best to the goal, with a deload every fourth week.
function buildPlan(best: number, goal: number, date: string) {
  const start = monday(today());
  const weeks = Math.max(1, Math.round((new Date(date).getTime() - new Date(start).getTime()) / (7 * 864e5)));
  const gain = goal - best, perWeek = gain / weeks;
  const list = Array.from({ length: weeks }, (_, i) => {
    const wk = i + 1, deload = wk % 4 === 0 && wk !== weeks;
    const top = r5(best + perWeek * wk);
    return { wk, from: addDays(start, i * 7), deload, top: deload ? r5(top * 0.9) : top, work: r5((deload ? top * 0.9 : top) * 0.85) };
  });
  return { weeks, perWeek, list };
}

export default function Plans() {
  const { me } = useSession();
  const [goals, setGoals] = useState<any[] | null>(null);
  const [best, setBest] = useState<Record<string, number>>({});
  const [bw, setBw] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!me) return;
    const [{ data: g }, { data: b }] = await Promise.all([
      sb.from('goals').select('*').eq('profile_id', me.id),
      sb.from('lift_bests').select('lift,weight_lb').eq('profile_id', me.id),
    ]);
    setGoals(g ?? []); setBest(Object.fromEntries((b ?? []).map((x: any) => [x.lift, Number(x.weight_lb)])));
    setBw(Number(me.bodyweight) || 200);
  }, [me]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!goals) return <Screen stack><Loading /></Screen>;
  const dated = goals.filter(g => g.target_date && Number(g.target_lb) > (best[g.lift] || 0));
  return (
    <Screen stack>
      <Muted style={{ fontSize: 15, marginBottom: 12 }}>Each week has a heavy single to hit and a working weight for 3 sets of 3. Every fourth week backs off so you recover.</Muted>
      {dated.length === 0 ? (
        <Card><Muted style={{ fontSize: 15, marginBottom: 12 }}>Set a goal above your current best and pick a date, and your plan shows up here.</Muted><Btn label="Set goals" onPress={() => router.push('/goals')} /></Card>
      ) : dated.map(g => {
        const b = best[g.lift] || 0, t = Number(g.target_lb), plan = buildPlan(b || r5(t * 0.8), t, g.target_date);
        const pctBw = (plan.perWeek / bw) * 100, pace = pctBw > 1.25 ? ['Aggressive', C.down] : pctBw > 0.6 ? ['Ambitious', C.flat] : ['On track', C.up];
        const thisWeek = plan.list[0], isOpen = open === g.lift;
        return (
          <Card key={g.lift} accent={colorOf(g.lift)}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Text style={{ color: C.ink, fontSize: 20, fontWeight: '900', textTransform: 'uppercase' }}>{liftName(g.lift)}</Text>
              <Mono style={{ fontSize: 16 }}>{fmt(b)} → {fmt(t)}</Mono>
            </View>
            <View style={{ flexDirection: 'row', marginVertical: 8 }}><PctBar pct={b ? Math.min(100, (b / t) * 100) : 0} color={colorOf(g.lift)} /></View>
            <Muted style={{ fontSize: 14 }}>{plan.weeks} weeks to {fmtD(g.target_date)} · +{plan.perWeek.toFixed(1)} lb a week · <Text style={{ color: pace[1] }}>{pace[0]}</Text></Muted>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <View style={{ flex: 1, backgroundColor: '#0B1019', borderRadius: 10, padding: 10 }}><Eyebrow>This week top single</Eyebrow><Mono style={{ fontSize: 24, color: C.accent }}>{fmt(thisWeek.top)}</Mono></View>
              <View style={{ flex: 1, backgroundColor: '#0B1019', borderRadius: 10, padding: 10 }}><Eyebrow>Work sets 3x3</Eyebrow><Mono style={{ fontSize: 24 }}>{fmt(thisWeek.work)}</Mono></View>
            </View>
            <Text style={{ color: C.accent, marginTop: 10, fontWeight: '700' }} onPress={() => setOpen(isOpen ? null : g.lift)}>{isOpen ? 'Hide weeks' : 'Show every week'}</Text>
            {isOpen ? plan.list.map(w => (
              <View key={w.wk} style={{ flexDirection: 'row', paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.line, opacity: w.deload ? 0.7 : 1 }}>
                <Muted style={{ width: 70 }}>Wk {w.wk}</Muted>
                <Muted style={{ flex: 1 }}>{fmtD(w.from)}{w.deload ? ' · deload' : ''}</Muted>
                <Mono style={{ width: 60, textAlign: 'right' }}>{w.work}</Mono>
                <Mono style={{ width: 60, textAlign: 'right', color: C.accent }}>{w.top}</Mono>
              </View>
            )) : null}
          </Card>
        );
      })}
    </Screen>
  );
}
