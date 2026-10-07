import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Btn, Card, Chip, Eyebrow, Loading, Mono, Muted, ProBadge, s, Title } from '@/components/ui';
import { C, liftColor } from '@/constants/Colors';
import { fmtD, isNew, LIFTS, loadBoard, type BoardRow, fmtPct } from '@/lib/data';
import { useSession } from '@/lib/session';

type Sort = 'score' | 'total' | 'bench' | 'squat' | 'dead' | 'clean';
const AGES: [string, string][] = [['all', 'All ages'], ['u40', 'Under 40'], ['40s', '40s'], ['50p', '50+']];
const SORTS: [Sort, string][] = [['score', 'Overall'], ['total', 'Total'], ['bench', 'Bench'], ['squat', 'Squat'], ['dead', 'Deadlift'], ['clean', 'Clean']];

export default function Board() {
  const { me, isPro } = useSession();
  const [age, setAge] = useState('all');
  const [sheet, setSheet] = useState(false);
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [err, setErr] = useState('');
  const [sort, setSort] = useState<Sort>('score');
  const [div, setDiv] = useState('all');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setRows(await loadBoard()); setErr(''); } catch (e: any) { setErr(e.message ?? String(e)); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // The women's division shows once a woman is on the board.
  const hasWomen = (rows ?? []).some(r => r.division === 'women' || (r as any).sex === 'female');
  const divs = [['all', 'All'], ['men', 'Men'], ...(hasWomen ? [['women', 'Women']] : []), ['open', 'Open']];
  const list = useMemo(() => (rows ?? [])
    .filter(r => div === 'all' || r.division === div)
    .filter(r => age === 'all' || (age === 'u40' ? r.age && r.age < 40 : age === '40s' ? r.age >= 40 && r.age < 50 : r.age >= 50))
    .filter(r => r[sort])
    .sort((a, b) => b[sort] - a[sort] || b.score - a.score), [rows, sort, div, age]);

  const newPRs = (rows ?? []).flatMap(r => LIFTS.filter(l => isNew((r as any)[l.k + '_date']) && (r as any)[l.k]).map(l => ({ r, l }))).sort((a, b) => String((b.r as any)[b.l.k + '_date']).localeCompare(String((a.r as any)[a.l.k + '_date'])));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={s.pad}
        refreshControl={<RefreshControl tintColor={C.accent} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Title eyebrow="Dandy Strength Index™" accent="">Board</Title>
          <Pressable onPress={() => router.push('/prs')} style={{ borderWidth: 1, borderColor: C.line, borderRadius: 18, paddingHorizontal: 14, height: 36, justifyContent: 'center', marginTop: 18 }} accessibilityRole="button">
            <Text style={{ color: C.ink, fontWeight: '700', fontSize: 13 }}>PR wall</Text>
          </Pressable>
        </View>

        {newPRs.slice(0, 3).map(({ r, l }) => (
          <Pressable key={r.profile_id + l.k} onPress={() => router.push('/prs')}><Card style={{ backgroundColor: '#221F14', borderColor: C.accent, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ backgroundColor: C.accent, color: '#141414', fontWeight: '800', fontSize: 10, letterSpacing: 1.4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3 }}>NEW PR</Text>
            <Text style={{ color: C.ink, flex: 1, fontSize: 14 }}><Text style={{ fontWeight: '700' }}>{r.name}</Text> {l.n.toLowerCase()} <Mono>{(r as any)[l.k]}</Mono></Text>
            <Muted>{fmtD((r as any)[l.k + '_date'])}</Muted>
          </Card></Pressable>
        ))}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }}>
          {SORTS.map(([k, label]) => <Chip key={k} label={k === 'score' || isPro ? label : label + ' · Pro'} on={sort === k} onPress={() => (k === 'score' || isPro ? setSort(k) : router.push('/pro'))} />)}
        </ScrollView>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6, alignItems: 'center' }}>
          {divs.map(([k, label]) => <Chip key={k} label={label} on={div === k} onPress={() => setDiv(k)} />)}
          <Chip label={age === 'all' ? 'Filters' : AGES.find(a => a[0] === age)![1]} on={age !== 'all'} onPress={() => setSheet(true)} />
        </View>
        <Modal visible={sheet} transparent animationType="slide" onRequestClose={() => setSheet(false)}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setSheet(false)} accessibilityLabel="Close filters" />
          <View style={{ backgroundColor: C.panel, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40, borderTopWidth: 1, borderColor: C.line }}>
            <Text style={{ color: C.ink, fontSize: 24, fontWeight: '900', textTransform: 'uppercase', marginBottom: 14 }}>Filters</Text>
            <Eyebrow style={{ marginBottom: 6 }}>Division</Eyebrow>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 14 }}>
              {divs.map(([k, label]) => <Chip key={k} label={label} on={div === k} onPress={() => setDiv(k)} />)}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}><Eyebrow>Age</Eyebrow>{isPro ? null : <ProBadge />}</View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 18 }}>
              {AGES.map(([k, label]) => <Chip key={k} label={label} on={age === k} onPress={() => { if (k !== 'all' && !isPro) { setSheet(false); router.push('/pro'); return; } setAge(k); }} />)}
            </View>
            <Btn label="Show lifters" onPress={() => setSheet(false)} />
          </View>
        </Modal>

        {err ? <Muted style={{ color: C.down }}>{err}</Muted> : null}
        {!rows ? <Loading /> : list.length === 0 ? (
          <Card><Muted>{div === 'women' ? 'No women on the board yet. The division is open.' : 'Nobody here yet.'}</Muted></Card>
        ) : list.map((r, i) => {
          const val = sort === 'score' ? r.score : r[sort];
          const gain = sort === 'score' ? r.g.score : sort === 'total' ? r.g.total : r.g.lift[sort] || 0;
          const sub = sort === 'score' ? `${r.total.toLocaleString()} lb total` : sort === 'total' ? `DSI ${r.score}` : isNew((r as any)[sort + '_date']) ? `PR ${fmtD((r as any)[sort + '_date'])}` : `${fmtPct(r.p[sort])} percentile`;
          const mine = me?.id === r.profile_id;
          return (
            <Pressable key={r.profile_id} accessibilityRole="button" onPress={() => router.push({ pathname: '/lifter/[id]', params: { id: r.profile_id } })}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: mine ? 'rgba(242,201,76,0.08)' : 'transparent' }}>
              <Text style={{ width: 28, fontSize: 24, fontWeight: '900', color: i === 0 ? C.accent : C.muted }}>{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.ink, fontSize: 17, fontWeight: '600' }}>{r.name}{r.roast_opt_in ? '  🔥' : ''}</Text>
                <Muted>{r.age ? `Age ${r.age} · ` : ''}{r.bw ? `${r.bw} lb · ` : ''}{r.division}</Muted>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                  {gain > 0 ? <Text style={{ color: C.up, fontSize: 13, fontWeight: '700' }} accessibilityLabel={`up ${gain} this week`}>▲{gain.toLocaleString()}</Text> : null}
                  <Mono style={{ fontSize: 22, color: sort in liftColor ? liftColor[sort] : C.ink }}>{val.toLocaleString()}</Mono>
                </View>
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
