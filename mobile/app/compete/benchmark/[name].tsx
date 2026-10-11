// One benchmark's board: every log of every workout with that benchmark name, each lifter's best counts.
// Fastest time wins when it is scored by time, otherwise the most wins. Same as dandystrength.com/benchmarks/<name>.
// The Week tab links here with params { name }.
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Btn, Card, Eyebrow, Loading, Mono, Muted, ProBadge, s } from '@/components/ui';
import { C } from '@/constants/Colors';
import { fmtD } from '@/lib/data';
import { benchBoard, loadBenchmarks, loadProIds, MINE_BG, namesFor, type BenchWorkout } from '@/lib/compete';
import { useSession } from '@/lib/session';

type Data = { bw: BenchWorkout[]; rows: [string, { v: number; s: string; day: string }][]; names: Record<string, string>; pros: Set<string> };

export default function BenchmarkBoard() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const { me } = useSession();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const want = String(name ?? '').trim();

  const load = useCallback(async () => {
    try {
      const { ws, logs } = await loadBenchmarks();
      const bw = ws.filter(w => w.benchmark.toLowerCase() === want.toLowerCase());
      if (!bw.length) { setErr(`No benchmark called ${want}.`); return; }
      const rows = benchBoard(bw, logs);
      const [names, pros] = await Promise.all([namesFor(rows.map(r => r[0])), loadProIds()]);
      setD({ bw, rows, names, pros }); setErr('');
    } catch (e: any) { setErr(e.message ?? String(e)); }
  }, [want]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const title = d?.bw[0].benchmark ?? want;
  const head = <Stack.Screen options={{ title: title || 'Benchmark' }} />;
  if (err) return <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={[]}>{head}<View style={s.pad}><Card><Muted style={{ fontSize: 15 }}>{err}</Muted></Card><Btn ghost label="All benchmarks" onPress={() => router.replace('/compete/benchmarks')} /></View></SafeAreaView>;
  if (!d) return <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={[]}>{head}<Loading /></SafeAreaView>;

  const type = d.bw[0].score_type, label = d.bw[0].score_label || 'Score';
  const days = d.bw.map(w => fmtD(w.day)).join(', ');
  const myIdx = me ? d.rows.findIndex(r => r[0] === me.id) : -1;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={[]}>
      {head}
      <ScrollView contentContainerStyle={s.pad}
        refreshControl={<RefreshControl tintColor={C.accent} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        <Eyebrow>Benchmark · {type === 'time' ? 'fastest time wins' : 'most wins'}</Eyebrow>
        <Text style={{ color: C.ink, fontSize: 38, fontWeight: '900', textTransform: 'uppercase', marginTop: 2 }} numberOfLines={2}>{title}</Text>
        <Muted style={{ fontSize: 15, marginBottom: 14 }}>Done {d.bw.length} {d.bw.length === 1 ? 'time' : 'times'}: {days}. Each lifter's best counts.</Muted>

        {myIdx >= 0 ? (
          <Card accent={C.accent}>
            <Eyebrow>Your best</Eyebrow>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4 }}>
              <Mono style={{ fontSize: 30 }}>{d.rows[myIdx][1].s}</Mono>
              <Muted style={{ fontSize: 14 }}>#{myIdx + 1} of {d.rows.length} · {fmtD(d.rows[myIdx][1].day)}</Muted>
            </View>
          </Card>
        ) : null}

        <View style={{ flexDirection: 'row', paddingHorizontal: 4, paddingBottom: 6, marginTop: 6 }}>
          <Eyebrow style={{ width: 34 }}>#</Eyebrow>
          <Eyebrow style={{ flex: 1 }}>Lifter</Eyebrow>
          <Eyebrow style={{ color: C.accent }}>{label}</Eyebrow>
        </View>
        {d.rows.length === 0 ? <Card><Muted style={{ fontSize: 15 }}>Nobody has logged it yet.</Muted></Card> : d.rows.map(([pid, x], i) => {
          const mine = me?.id === pid;
          return (
            <Pressable key={pid} accessibilityRole="button" accessibilityLabel={`${i + 1}. ${d.names[pid] ?? 'Someone'}, ${x.s}`} onPress={() => router.push({ pathname: '/lifter/[id]', params: { id: pid } })}
              style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 60, paddingVertical: 10, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: mine ? MINE_BG : 'transparent' }, pressed && { backgroundColor: C.panel2 }]}>
              <Text style={{ width: 26, fontSize: 22, fontWeight: '900', color: i === 0 ? C.accent : C.muted }}>{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ color: C.ink, fontSize: 17, fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>{d.names[pid] ?? 'Someone'}</Text>
                  {d.pros.has(pid) ? <ProBadge /> : null}
                </View>
                <Muted style={{ fontSize: 12 }}>{fmtD(x.day)}</Muted>
              </View>
              <Mono style={{ fontSize: 22 }}>{x.s}</Mono>
            </Pressable>
          );
        })}
        <Btn ghost label="All benchmarks" onPress={() => router.push('/compete/benchmarks')} style={{ marginTop: 16 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
