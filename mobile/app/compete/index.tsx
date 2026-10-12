// Compete hub: the season, weekly battles, the gym league, benchmarks, the year recap, the PR wall and protests.
// Shows my season so far and answers battle challenges right here. Same wording as dandystrength.com/compete.
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Btn, Card, Eyebrow, Loading, Mono, Muted, ProBadge, s, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { addDays, fmt, fmtD, loadBoard, monday, today, type BoardRow } from '@/lib/data';
import { allEntries, battleScore, daysLeft, gainIn, namer, namesFor, quarter, respondBattle, weekOver, type Battle, type LiftRow } from '@/lib/compete';
import { inviteCrew } from '@/lib/invite';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

type Hub = { board: BoardRow[]; battles: Battle[]; by: Map<string, LiftRow[]>; extra: Record<string, string> };

export default function Compete() {
  const { me, isPro, blocked } = useSession();
  const [hub, setHub] = useState<Hub | null>(null);
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const q = quarter(today()), yr = new Date().getFullYear();

  const load = useCallback(async (force = false) => {
    try {
      if (!me) { setHub({ board: [], battles: [], by: new Map(), extra: {} }); return; }
      const [board, bres, by] = await Promise.all([
        loadBoard(),
        sb.from('battles').select('*').or(`challenger.eq.${me.id},opponent.eq.${me.id}`).in('status', ['pending', 'accepted'])
          .gte('week_start', addDays(monday(today()), -7)).order('week_start').limit(50),
        allEntries(force),
      ]);
      if (bres.error) throw new Error(bres.error.message);
      const battles = ((bres.data ?? []) as Battle[]).filter(b => !weekOver(b));
      const ids = [...new Set(battles.flatMap(b => [b.challenger, b.opponent]))];
      const extra = await namesFor(ids.filter(id => !board.some(r => r.profile_id === id)));
      setHub({ board, battles, by, extra }); setErr('');
    } catch (e: any) { setErr(e.message ?? String(e)); }
  }, [me?.id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const name = hub ? namer(hub.board, hub.extra) : () => 'Someone';
  const myRow = me && hub ? hub.board.find(r => r.profile_id === me.id) : undefined;
  const mine = me && hub && myRow ? gainIn(hub.by.get(me.id) ?? [], myRow, q.start, today()) : null;
  // Challenges from lifters I blocked stay hidden. Anyone can accept a battle; starting one is Pro.
  const challenges = me && hub ? hub.battles.filter(b => b.status === 'pending' && b.opponent === me.id && !blocked.has(b.challenger)) : [];
  const sent = me && hub ? hub.battles.filter(b => b.status === 'pending' && b.challenger === me.id) : [];
  const live = me && hub ? hub.battles.filter(b => b.status === 'accepted') : [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={[]}>
      <Stack.Screen options={{ title: 'Compete' }} />
      <ScrollView contentContainerStyle={s.pad}
        refreshControl={<RefreshControl tintColor={C.accent} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(true); setRefreshing(false); }} />}>
        <Title eyebrow="Compete and grow" accent="board">Beyond the</Title>
        <Muted style={{ fontSize: 15, marginTop: -6, marginBottom: 14 }}>Seasons, battles, your gym, benchmarks and the tools that keep you coming back.</Muted>
        {err ? <Muted style={{ color: C.down, marginBottom: 10 }}>{err}</Muted> : null}

        {!me ? (
          <Card>
            <Text style={st.h}>Sign in to compete</Text>
            <Muted style={{ fontSize: 14, marginVertical: 8 }}>Boards stay public. Sign in to start or answer a battle and track your season.</Muted>
            <Btn label="Sign in" onPress={() => router.push('/login')} />
          </Card>
        ) : !hub ? <Loading /> : (<>
          {challenges.map(b => (
            <Card key={b.id} accent={C.accent} style={{ backgroundColor: '#221F14', borderColor: C.accent }}>
              <Eyebrow style={{ color: C.accent }}>You have been called out</Eyebrow>
              <Text style={[st.h, { marginTop: 4 }]}>{name(b.challenger)} wants a battle</Text>
              <Muted style={{ fontSize: 14, marginTop: 2 }}>{b.week_start === monday(today()) ? 'This week' : 'Week of ' + fmtD(b.week_start)}. Most DSI points gained wins; pounds added breaks a tie.</Muted>
              {b.trash_talk ? <Text style={st.talk}>“{b.trash_talk}”</Text> : null}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <Btn label="Accept" onPress={() => respondBattle(b.id, 'accept', load)} style={{ flex: 1 }} />
                <Btn ghost label="Decline" onPress={() => respondBattle(b.id, 'decline', load)} style={{ flex: 1 }} />
              </View>
            </Card>
          ))}

          {live.map(b => {
            const sc = battleScore(b, hub.by, hub.board), meA = b.challenger === me.id;
            const mineG = meA ? sc.a : sc.o, theirs = meA ? sc.o : sc.a, other = meA ? b.opponent : b.challenger;
            const tag = !sc.live ? 'Starts ' + fmtD(b.week_start) : sc.lead === me.id ? 'You lead' : sc.lead ? 'You trail' : 'Dead even';
            return (
              <Pressable key={b.id} accessibilityRole="button" accessibilityLabel={`Battle with ${name(other)}. ${tag}.`} onPress={() => router.push({ pathname: '/compete/battle/[id]', params: { id: b.id } })}>
                <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Eyebrow style={{ color: sc.live ? C.up : C.accent }}>{sc.live ? 'Live battle' : 'Battle'} · {tag}</Eyebrow>
                    <Text style={[st.h, { fontSize: 17, marginTop: 4 }]} numberOfLines={1}>You vs {name(other)}</Text>
                  </View>
                  <Mono style={{ fontSize: 22, color: sc.lead === me.id ? C.up : C.ink }}>+{mineG.pts}</Mono>
                  <Muted>vs</Muted>
                  <Mono style={{ fontSize: 22, color: sc.lead === other ? C.down : C.ink }}>+{theirs.pts}</Mono>
                  <Text style={s.chev}>›</Text>
                </Card>
              </Pressable>
            );
          })}

          {sent.length ? (
            <Pressable accessibilityRole="button" onPress={() => router.push('/compete/battles')}>
              <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Muted style={{ flex: 1, fontSize: 14 }}>{sent.length === 1 ? `Waiting on ${name(sent[0].opponent)} to answer your challenge.` : `${sent.length} challenges waiting on an answer.`}</Muted>
                <Text style={s.chev}>›</Text>
              </Card>
            </Pressable>
          ) : null}

          <Pressable accessibilityRole="button" onPress={() => router.push('/compete/season')}>
            <Card style={{ padding: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Eyebrow style={{ flex: 1 }}>Your {q.name} season · {daysLeft(q.end)} days left</Eyebrow>
                <Text style={s.chev}>›</Text>
              </View>
              {myRow && mine ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                  <View><Mono style={{ fontSize: 40, color: mine.pts ? C.up : C.ink }}>+{mine.pts}</Mono><Muted>DSI points</Muted></View>
                  <View style={{ alignItems: 'center' }}><Mono style={{ fontSize: 26, marginTop: 8 }}>+{fmt(mine.lb)}</Mono><Muted>Lb added</Muted></View>
                  <View style={{ alignItems: 'flex-end' }}><Mono style={{ fontSize: 26, marginTop: 8 }}>{mine.prs}</Mono><Muted>{mine.prs === 1 ? 'PR' : 'PRs'}</Muted></View>
                </View>
              ) : <Muted style={{ fontSize: 14, marginTop: 8 }}>Log your four lifts to get on the board. Every PR after that counts toward the season.</Muted>}
            </Card>
          </Pressable>
        </>)}

        <Eyebrow style={{ marginTop: 8, marginBottom: 8 }}>Compete</Eyebrow>
        {/* The season and battle pages gate like the web: free members see the season top 3 and can accept any battle; the full board and starting a battle are Pro. */}
        <Tile title={`The ${q.name} season`} sub={`Most DSI points gained this quarter. Resets ${fmtD(addDays(q.end, 1))}.`} pro onPress={() => router.push('/compete/season')} />
        <Tile title="Weekly battles" sub="Call out any lifter for a week. Most DSI gained wins." pro onPress={() => router.push('/compete/battles')} />
        <Tile title="Gym league" sub="Your gym against every gym, ranked by its top five lifters." onPress={() => router.push('/compete/gyms')} />
        <Tile title="Benchmark boards" sub="Every time anyone has done Fran, Grace and the rest." onPress={() => router.push('/compete/benchmarks')} />
        <Tile title="Your year recap" sub="PRs, pounds added and your best day of the year." pro onPress={() => router.push(isPro ? { pathname: '/compete/recap', params: { year: String(yr) } } : '/pro')} />

        <Eyebrow style={{ marginTop: 8, marginBottom: 8 }}>The community</Eyebrow>
        <Tile title="PR wall" sub="The newest personal records. Resets every Monday." onPress={() => router.push('/prs')} />
        <Btn ghost label="Invite your crew" onPress={() => inviteCrew(me?.display_name)} style={{ marginTop: 6 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Tile({ title, sub, pro, onPress }: { title: string; sub: string; pro?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title + (pro ? ', DSI Pro' : '')} onPress={onPress}
      style={({ pressed }) => [st.tile, pressed && { backgroundColor: C.panel2 }]}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
          <Text style={st.tileT}>{title}</Text>{pro ? <ProBadge /> : null}
        </View>
        <Muted style={{ fontSize: 14, marginTop: 4 }}>{sub}</Muted>
      </View>
      <Text style={s.chev}>›</Text>
    </Pressable>
  );
}

const st = {
  h: { color: C.ink, fontSize: 20, fontWeight: '800' as const },
  talk: { color: C.ink, fontStyle: 'italic' as const, fontSize: 15, marginTop: 8 },
  tile: { flexDirection: 'row' as const, alignItems: 'center' as const, minHeight: 76, backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 10 },
  tileT: { color: C.ink, fontSize: 18, fontWeight: '800' as const },
};
