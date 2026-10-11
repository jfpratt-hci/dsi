// Benchmark boards: named workouts that come back (Fran, Grace and the rest). Same as dandystrength.com/benchmarks.
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, Loading, Muted, s, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { fmtD } from '@/lib/data';
import { loadBenchmarks, type BenchLog, type BenchWorkout } from '@/lib/compete';
import { useSession } from '@/lib/session';

export default function Benchmarks() {
  const { isStaff } = useSession();
  const [d, setD] = useState<{ ws: BenchWorkout[]; logs: BenchLog[] } | null>(null);
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setD(await loadBenchmarks()); setErr(''); } catch (e: any) { setErr(e.message ?? String(e)); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const names = d ? [...new Set(d.ws.map(w => w.benchmark))] : [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={[]}>
      <Stack.Screen options={{ title: 'Benchmarks' }} />
      <ScrollView contentContainerStyle={s.pad}
        refreshControl={<RefreshControl tintColor={C.accent} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        <Title eyebrow="Benchmarks" accent="boards">Benchmark</Title>
        <Muted style={{ fontSize: 15, marginTop: -6, marginBottom: 14 }}>Named workouts that come back. Every time anyone logs one, their best goes on its board.</Muted>
        {err ? <Muted style={{ color: C.down, marginBottom: 10 }}>{err}</Muted> : null}
        {!d ? <Loading /> : names.length === 0 ? (
          <Card><Muted style={{ fontSize: 15 }}>No benchmarks yet.{isStaff ? ' Name a workout as a benchmark on the import page.' : ' The Commissioner names them as they come up.'}</Muted></Card>
        ) : names.map(n => {
          const w = d.ws.filter(x => x.benchmark === n);
          const c = d.logs.filter(l => w.some(x => x.id === l.workout_id)).length;
          return (
            <Pressable key={n} accessibilityRole="button" accessibilityLabel={`${n} board`} onPress={() => router.push({ pathname: '/compete/benchmark/[name]', params: { name: n } })}
              style={({ pressed }) => [st.tile, pressed && { backgroundColor: C.panel2 }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.ink, fontSize: 20, fontWeight: '900', textTransform: 'uppercase' }}>{n}</Text>
                <Muted style={{ fontSize: 14, marginTop: 4 }}>{w.length} {w.length === 1 ? 'time' : 'times'} · {c} {c === 1 ? 'log' : 'logs'} · last {fmtD(w[0].day)}</Muted>
              </View>
              <Text style={s.chev}>›</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const st = {
  tile: { flexDirection: 'row' as const, alignItems: 'center' as const, minHeight: 72, backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 10 },
};
