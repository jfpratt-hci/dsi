import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, Chip, Eyebrow, Loading, Mono, Muted, s, Title } from '@/components/ui';
import { C, liftColor } from '@/constants/Colors';
import { fmtD, isNew, LIFTS, loadBoard, type BoardRow } from '@/lib/data';
import { useSession } from '@/lib/session';

type Sort = 'score' | 'total' | 'bench' | 'squat' | 'dead' | 'clean';
const SORTS: [Sort, string][] = [['score', 'Overall'], ['total', 'Total'], ['bench', 'Bench'], ['squat', 'Squat'], ['dead', 'Deadlift'], ['clean', 'Clean']];

export default function Board() {
  const { me } = useSession();
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [err, setErr] = useState('');
  const [sort, setSort] = useState<Sort>('score');
  const [div, setDiv] = useState('all');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setRows(await loadBoard()); setErr(''); } catch (e: any) { setErr(e.message ?? String(e)); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const list = useMemo(() => (rows ?? [])
    .filter(r => div === 'all' || r.division === div)
    .filter(r => r[sort])
    .sort((a, b) => b[sort] - a[sort] || b.score - a.score), [rows, sort, div]);

  const newPRs = (rows ?? []).flatMap(r => LIFTS.filter(l => isNew((r as any)[l.k + '_date']) && (r as any)[l.k]).map(l => ({ r, l })));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={s.pad}
        refreshControl={<RefreshControl tintColor={C.accent} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        <Title eyebrow="Dandy Strength Index™" accent="">Board</Title>

        {newPRs.slice(0, 3).map(({ r, l }) => (
          <Card key={r.profile_id + l.k} style={{ backgroundColor: '#221F14', borderColor: C.accent, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ backgroundColor: C.accent, color: '#141414', fontWeight: '800', fontSize: 10, letterSpacing: 1.4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3 }}>NEW PR</Text>
            <Text style={{ color: C.ink, flex: 1, fontSize: 14 }}><Text style={{ fontWeight: '700' }}>{r.name}</Text> {l.n.toLowerCase()} <Mono>{(r as any)[l.k]}</Mono></Text>
            <Muted>{fmtD((r as any)[l.k + '_date'])}</Muted>
          </Card>
        ))}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }}>
          {SORTS.map(([k, label]) => <Chip key={k} label={label} on={sort === k} onPress={() => setSort(k)} />)}
        </ScrollView>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 }}>
          {[['all', 'All'], ['men', 'Men'], ['women', 'Women'], ['open', 'Open']].map(([k, label]) => <Chip key={k} label={label} on={div === k} onPress={() => setDiv(k)} />)}
        </View>

        {err ? <Muted style={{ color: C.down }}>{err}</Muted> : null}
        {!rows ? <Loading /> : list.length === 0 ? (
          <Card><Muted>{div === 'women' ? 'No women on the board yet. The division is open.' : 'Nobody here yet.'}</Muted></Card>
        ) : list.map((r, i) => {
          const val = sort === 'score' ? r.score : r[sort];
          const sub = sort === 'score' ? `${r.total.toLocaleString()} lb total` : sort === 'total' ? `DSI ${r.score}` : isNew((r as any)[sort + '_date']) ? `PR ${fmtD((r as any)[sort + '_date'])}` : `${r.p[sort]}th percentile`;
          const mine = me?.id === r.profile_id;
          return (
            <Pressable key={r.profile_id} accessibilityRole="button"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: mine ? 'rgba(242,201,76,0.08)' : 'transparent' }}>
              <Text style={{ width: 28, fontSize: 24, fontWeight: '900', color: i === 0 ? C.accent : C.muted }}>{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.ink, fontSize: 17, fontWeight: '600' }}>{r.name}{r.roast_opt_in ? '  🔥' : ''}</Text>
                <Muted>{r.age ? `Age ${r.age} · ` : ''}{r.bw ? `${r.bw} lb · ` : ''}{r.division}</Muted>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Mono style={{ fontSize: 22, color: sort in liftColor ? liftColor[sort] : C.ink }}>{val.toLocaleString()}</Mono>
                <Muted style={{ fontSize: 12, color: sub.startsWith('PR') ? C.accent : C.muted }}>{sub}</Muted>
              </View>
            </Pressable>
          );
        })}
        <Eyebrow style={{ marginTop: 16 }}>500 is the median for your age and size</Eyebrow>
      </ScrollView>
    </SafeAreaView>
  );
}
