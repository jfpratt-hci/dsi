// Seasons: one per quarter, ranked by DSI points gained. Free members see the top 3; the full board is Pro.
// Same math as dandystrength.com/season: gainIn over every main lift entry (allEntries), cached for the session.
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Btn, Card, Eyebrow, Loading, Mono, Muted, ProBadge, s, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { fmt, fmtD, loadBoard, today } from '@/lib/data';
import { allEntries, daysLeft, fromQid, loadProIds, MINE_BG, nextQuarter, prevQuarter, qid, quarter, seasonRows, type SeasonRow } from '@/lib/compete';
import { useSession } from '@/lib/session';

export default function Season() {
  const params = useLocalSearchParams<{ q?: string }>();
  const { me, isPro } = useSession();
  const [qs, setQs] = useState(params.q && fromQid(params.q) ? params.q : qid(quarter(today())));
  const [rows, setRows] = useState<SeasonRow[] | null>(null);
  const [pros, setPros] = useState<Set<string>>(new Set());
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const q = fromQid(qs) ?? quarter(today());
  const cur = quarter(today());
  const past = q.end < today();
  const first = qid(q) === qid(cur);

  const load = useCallback(async (force = false) => {
    try {
      const qq = fromQid(qs) ?? quarter(today());
      const [board, by, p] = await Promise.all([loadBoard(), allEntries(force), loadProIds(force)]);
      setRows(seasonRows(board, by, qq)); setPros(p); setErr('');
    } catch (e: any) { setErr(e.message ?? String(e)); }
  }, [qs]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const go = (x: string) => { setRows(null); setQs(x); };
  const shown = rows ? (isPro ? rows : rows.slice(0, 3)) : [];
  const myIdx = me && rows ? rows.findIndex(x => x.r.profile_id === me.id) : -1;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={[]}>
      <Stack.Screen options={{ title: 'Season' }} />
      <ScrollView contentContainerStyle={s.pad}
        refreshControl={<RefreshControl tintColor={C.accent} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(true); setRefreshing(false); }} />}>
        <Title eyebrow={`Season ${q.q} · ${fmtD(q.start)} to ${fmtD(q.end)}`} accent="season">{q.name.split(' ')[0]}</Title>
        <Muted style={{ fontSize: 15, marginTop: -6, marginBottom: 12 }}>Ranked by DSI points gained this season. New lifters start counting from their first day, so joining is not a gain.</Muted>

        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          <Btn ghost label={'‹ ' + prevQuarter(q).name} onPress={() => go(qid(prevQuarter(q)))} style={{ flex: 1, paddingHorizontal: 8 }} />
          {past
            ? <Btn ghost label={nextQuarter(q).name + ' ›'} onPress={() => go(qid(nextQuarter(q)))} style={{ flex: 1, paddingHorizontal: 8 }} />
            : <View style={{ flex: 1, height: 52, borderRadius: 12, backgroundColor: 'rgba(242,201,76,0.12)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: C.accent, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', fontSize: 13 }}>{daysLeft(q.end)} days left</Text>
              </View>}
        </View>
        {!first ? <Btn ghost label="Back to this season" onPress={() => go(qid(cur))} style={{ marginBottom: 12 }} /> : null}

        {err ? <Muted style={{ color: C.down, marginBottom: 10 }}>{err}</Muted> : null}
        {!rows ? <><Loading /><Muted style={{ textAlign: 'center', marginTop: 10 }}>Adding up every lift this season.</Muted></> : (<>
          {myIdx >= 0 && (!isPro && myIdx >= 3) ? (
            <Card accent={C.accent}>
              <Eyebrow>Your spot</Eyebrow>
              <Text style={{ color: C.ink, fontSize: 18, fontWeight: '800', marginTop: 4 }}>#{myIdx + 1} with +{rows[myIdx].g.pts} points</Text>
            </Card>
          ) : null}
          <View style={{ flexDirection: 'row', paddingHorizontal: 4, paddingBottom: 6 }}>
            <Eyebrow style={{ width: 34 }}>#</Eyebrow>
            <Eyebrow style={{ flex: 1 }}>Lifter</Eyebrow>
            <Eyebrow style={{ color: C.accent }}>Points</Eyebrow>
          </View>
          {shown.length === 0 ? (
            <Card><Muted style={{ fontSize: 15 }}>{past ? 'Nobody gained that season.' : 'Nobody has gained yet this season. Hit a PR and take the lead.'}</Muted></Card>
          ) : shown.map((x, i) => {
            const mine = me?.id === x.r.profile_id;
            return (
              <Pressable key={x.r.profile_id} accessibilityRole="button" onPress={() => router.push({ pathname: '/lifter/[id]', params: { id: x.r.profile_id } })}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: mine ? MINE_BG : 'transparent', minHeight: 64 }}>
                <Text style={{ width: 26, fontSize: 22, fontWeight: '900', color: i === 0 ? C.accent : C.muted }}>{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ color: C.ink, fontSize: 17, fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>{x.r.name}</Text>
                    {pros.has(x.r.profile_id) ? <ProBadge /> : null}
                  </View>
                  <Muted style={{ fontSize: 12 }}>{x.r.division} · DSI {x.g.start} → {x.g.end} · +{fmt(x.g.lb)} lb · {x.g.prs} {x.g.prs === 1 ? 'PR' : 'PRs'}</Muted>
                </View>
                <Mono style={{ fontSize: 24, color: C.up }}>+{x.g.pts}</Mono>
              </Pressable>
            );
          })}
          {!isPro && rows.length > 3 ? (
            <Card style={{ marginTop: 12 }}>
              <Muted style={{ fontSize: 14 }}>Showing the top 3 of {rows.length}. The full season board is part of DSI Pro.</Muted>
              <Pressable accessibilityRole="button" onPress={() => router.push('/pro')} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, marginTop: 6 }}>
                <Text style={{ color: C.accent, fontWeight: '800', fontSize: 15 }}>See Pro</Text><ProBadge />
              </Pressable>
            </Card>
          ) : null}
        </>)}
      </ScrollView>
    </SafeAreaView>
  );
}
