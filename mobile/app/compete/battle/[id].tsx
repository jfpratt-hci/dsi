// One battle: both lifters, DSI gained each so far, who is ahead, status, days left and the battle thread.
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Btn, Card, Eyebrow, Loading, Mono, Muted, ProBadge, s } from '@/components/ui';
import { C } from '@/constants/Colors';
import { addDays, fmt, fmtD, loadBoard, type BoardRow } from '@/lib/data';
import { allEntries, battleScore, battleStatus, daysLeft, loadProIds, namer, namesFor, openThread, respondBattle, TONE, UUID, type Battle, type Gain, type LiftRow } from '@/lib/compete';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';
import { CHAT_ON, PROTESTS_ON } from '@/lib/features';

type Data = { b: Battle; board: BoardRow[]; by: Map<string, LiftRow[]>; extra: Record<string, string>; pros: Set<string> };

export default function BattleDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useSession();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    try {
      if (!UUID.test(id ?? '')) { setErr('No battle here.'); return; }
      const [bres, board, by, pros] = await Promise.all([
        sb.from('battles').select('*').eq('id', id).maybeSingle(),
        loadBoard(), allEntries(force), loadProIds(force),
      ]);
      if (bres.error) throw new Error(bres.error.message);
      if (!bres.data) { setErr('No battle here.'); return; }
      const b = bres.data as Battle;
      const extra = await namesFor([b.challenger, b.opponent].filter(x => !board.some(r => r.profile_id === x)));
      setD({ b, board, by, extra, pros }); setErr('');
    } catch (e: any) { setErr(e.message ?? String(e)); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (err) return <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={[]}><Stack.Screen options={{ title: 'Battle' }} /><View style={s.pad}><Card><Muted style={{ fontSize: 15 }}>{err}</Muted></Card><Btn ghost label="All battles" onPress={() => router.replace('/compete/battles')} /></View></SafeAreaView>;
  if (!d) return <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={[]}><Stack.Screen options={{ title: 'Battle' }} /><Loading /></SafeAreaView>;

  const { b } = d;
  const name = namer(d.board, d.extra);
  const sc = battleScore(b, d.by, d.board);
  const st = battleStatus(b, sc, name, fmtD, me?.id);
  const meA = me?.id === b.challenger, meO = me?.id === b.opponent;
  const last = addDays(b.week_start, 6);
  const title = `${name(b.challenger)} vs ${name(b.opponent)}`;
  const left = daysLeft(last);
  const when = b.status !== 'accepted' && b.status !== 'pending' ? `Week of ${fmtD(b.week_start)}`
    : sc.over ? `Ended ${fmtD(last)}` : sc.live ? (left === 0 ? 'Last day. Ends tonight.' : `${left} ${left === 1 ? 'day' : 'days'} left · ends ${fmtD(last)}`)
    : `Starts ${fmtD(b.week_start)} · runs to ${fmtD(last)}`;
  const ahead = b.status !== 'accepted' ? null
    : sc.lead ? `${sc.lead === me?.id ? 'You' : name(sc.lead)} ${sc.over ? 'won' : sc.lead === me?.id ? 'lead' : 'leads'}${sc.a.pts !== sc.o.pts ? ` by ${Math.abs(sc.a.pts - sc.o.pts)} ${Math.abs(sc.a.pts - sc.o.pts) === 1 ? 'point' : 'points'}` : ` on pounds added, ${fmt(Math.abs(sc.a.lb - sc.o.lb))} lb`}.`
    : sc.over ? 'Tie. Nobody gained more.' : sc.live ? 'Dead even. Next PR takes the lead.' : 'Nothing counts until Monday.';

  const side = (pid: string, g: Gain) => {
    const lead = b.status === 'accepted' && sc.lead === pid;
    return (
      <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/lifter/[id]', params: { id: pid } })}
        style={{ flex: 1, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: lead ? C.up : C.line, backgroundColor: lead ? 'rgba(61,186,116,0.08)' : C.panel, alignItems: 'center' }}>
        {lead ? <Text style={{ color: C.up, fontSize: 11, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase' }}>{sc.over ? 'Winner' : 'Ahead'}</Text> : <Text style={{ fontSize: 11 }}> </Text>}
        <Text style={{ color: C.ink, fontWeight: '800', fontSize: 17, textAlign: 'center', marginTop: 4 }} numberOfLines={2}>{name(pid)}{pid === me?.id ? ' (you)' : ''}</Text>
        {d.pros.has(pid) ? <View style={{ marginTop: 4 }}><ProBadge /></View> : null}
        <Mono style={{ fontSize: 44, color: lead ? C.up : C.ink, marginTop: 6 }}>+{g.pts}</Mono>
        <Muted>DSI points</Muted>
        <View style={{ marginTop: 10, alignItems: 'center' }}>
          <Mono style={{ fontSize: 16 }}>+{fmt(g.lb)} lb</Mono>
          <Muted style={{ fontSize: 12 }}>{g.prs} {g.prs === 1 ? 'PR' : 'PRs'}</Muted>
          {g.start != null && g.end != null ? <Muted style={{ fontSize: 12, marginTop: 4 }}>DSI {g.start} → {g.end}</Muted> : null}
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={[]}>
      <Stack.Screen options={{ title: 'Battle' }} />
      <ScrollView contentContainerStyle={s.pad}
        refreshControl={<RefreshControl tintColor={C.accent} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(true); setRefreshing(false); }} />}>
        <Eyebrow>Week of {fmtD(b.week_start)}</Eyebrow>
        <Text style={{ color: C.ink, fontSize: 30, fontWeight: '900', textTransform: 'uppercase', marginTop: 4 }} numberOfLines={3}>{title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 8, marginBottom: 14 }}>
          <Text style={{ color: TONE[st.tone], fontWeight: '800', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', borderWidth: 1, borderColor: TONE[st.tone], borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' }}>{st.label}</Text>
          <Muted style={{ fontSize: 14 }}>{when}</Muted>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {side(b.challenger, sc.a)}
          <Text style={{ color: C.muted, fontWeight: '900', textTransform: 'uppercase' }}>vs</Text>
          {side(b.opponent, sc.o)}
        </View>

        {ahead ? <Text style={{ color: C.ink, fontSize: 18, fontWeight: '700', marginTop: 14, textAlign: 'center' }}>{ahead}</Text> : null}
        {b.trash_talk ? (
          <Card style={{ marginTop: 14 }}>
            <Eyebrow>{name(b.challenger)} said</Eyebrow>
            <Text style={{ color: C.ink, fontStyle: 'italic', fontSize: 17, marginTop: 6 }}>“{b.trash_talk}”</Text>
          </Card>
        ) : null}

        {b.status === 'pending' && meO ? (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
            {sc.over ? null : <Btn label="Accept" onPress={() => respondBattle(b.id, 'accept', load)} style={{ flex: 1 }} />}
            <Btn ghost label="Decline" onPress={() => respondBattle(b.id, 'decline', load)} style={{ flex: 1 }} />
          </View>
        ) : null}
        {b.status === 'pending' && meA ? <Btn ghost label="Call it off" onPress={() => respondBattle(b.id, 'cancel', load)} style={{ marginTop: 14 }} /> : null}
        {CHAT_ON && b.status === 'accepted' ? <Btn label="Talk" onPress={() => openThread('battle', b.id, title, !!me)} style={{ marginTop: 14 }} /> : null}

        <Muted style={{ marginTop: 16, fontSize: 13 }}>Most DSI points gained from Monday to Sunday wins; pounds added breaks a tie. Lifts struck by the Commissioner never count.</Muted>
        <Btn ghost label="All battles" onPress={() => router.push('/compete/battles')} style={{ marginTop: 14 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
