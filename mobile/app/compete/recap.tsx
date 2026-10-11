// Year recap (Pro): PRs, pounds added, DSI start to end, each lift, the biggest PR, the busiest month.
// Same math and wording as dandystrength.com/recap/<year>. Share sends the text and the recap link.
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Btn, Card, Eyebrow, Loading, Mono, Muted, ProBadge, s, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { addDays, colorOf, fmt, fmtD, liftName, LIFTS, loadBoard, today, type BoardRow } from '@/lib/data';
import { dsiAt, fetchAll, gainIn, num, type LiftRow, type Prof } from '@/lib/compete';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

type Log = { id: string; created_at: string; workout: { day: string } | { day: string }[] | null };
type Data = { board: BoardRow[]; ent: LiftRow[]; days: string[] };


export default function Recap() {
  const params = useLocalSearchParams<{ year?: string }>();
  const { me, isPro } = useSession();
  const thisYear = new Date().getFullYear();
  const [y, setY] = useState(/^\d{4}$/.test(params.year ?? '') && Number(params.year) <= thisYear ? Number(params.year) : thisYear);
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!me || !isPro) return;
    try {
      const [board, ent, logs] = await Promise.all([
        loadBoard(),
        fetchAll<LiftRow>((a, b) => sb.from('lift_entries').select('*').eq('profile_id', me.id).order('performed_on').order('id').range(a, b)),
        fetchAll<Log>((a, b) => sb.from('workout_logs').select('id,created_at,workout:workouts(day)').eq('profile_id', me.id).order('id').range(a, b)),
      ]);
      const days = logs.map(l => (Array.isArray(l.workout) ? l.workout[0] : l.workout)?.day).filter((x): x is string => !!x);
      setD({ board, ent, days }); setErr('');
    } catch (e: any) { setErr(e.message ?? String(e)); }
  }, [me?.id, isPro]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const head = <Stack.Screen options={{ title: `${y} recap` }} />;
  const wrap = (body: ReactNode) => (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={[]}>{head}
      <ScrollView contentContainerStyle={s.pad}
        refreshControl={me && isPro ? <RefreshControl tintColor={C.accent} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} /> : undefined}>
        {body}
      </ScrollView>
    </SafeAreaView>
  );

  if (!me) return wrap(<>
    <Title accent={String(y)}>Your</Title>
    <Card>
      <Text style={st.h}>Sign in to see your year</Text>
      <Muted style={{ fontSize: 14, marginVertical: 8 }}>Members log lifts, chat and file protests. Boards and PRs stay public.</Muted>
      <Btn label="Sign in" onPress={() => router.push('/login')} />
    </Card>
  </>);

  if (!isPro) return wrap(<>
    <View style={{ flexDirection: 'row', alignItems: 'center' }}><Eyebrow>DSI Pro</Eyebrow><ProBadge /></View>
    <Title accent={String(y)}>Your</Title>
    <Muted style={{ fontSize: 15, marginTop: -6, marginBottom: 14 }}>Your year in lifting: PRs, pounds added, your best day and where you finished. The year recap is part of DSI Pro.</Muted>
    <Btn label="See DSI Pro" onPress={() => router.push('/pro')} />
  </>);

  if (err) return wrap(<Card><Muted style={{ fontSize: 15, color: C.down }}>{err}</Muted></Card>);
  if (!d) return wrap(<Loading />);

  // The same numbers the website shows.
  const start = `${y}-01-01`, end = `${y}-12-31` < today() ? `${y}-12-31` : today();
  const myRow = d.board.find(r => r.profile_id === me.id);
  const row: Prof = myRow ?? { bw: num(me.bodyweight), age: me.birth_year ? thisYear - me.birth_year : 30 };
  const g = gainIn(d.ent, row, start, end);
  const inYr = d.ent.filter(e => e.status !== 'struck' && e.performed_on >= start && e.performed_on <= end);
  const prs = inYr.filter(e => e.is_pr && e.prev_best != null);
  const biggest = [...prs].sort((a, b) => (num(b.weight_lb) - num(b.prev_best)) - (num(a.weight_lb) - num(a.prev_best)))[0];
  const yDays = d.days.filter(x => String(x).startsWith(String(y)));
  const months: Record<string, number> = {};
  [...inYr.map(e => e.performed_on), ...yDays].forEach(x => { const k = String(x).slice(0, 7); months[k] = (months[k] || 0) + 1; });
  const topM = Object.entries(months).sort((a, b) => b[1] - a[1])[0];
  const monthName = (k: string) => new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, 1).toLocaleDateString('en-US', { month: 'long' });
  const before = dsiAt(d.ent, row, addDays(start, -1)), after = dsiAt(d.ent, row, end);
  const perLift = LIFTS.map(l => ({ l, a: before.row[l.k], b: after.row[l.k] }));
  const maxB = Math.max(...perLift.map(p => p.b || 1));
  const rank = [...d.board].sort((a, b) => b.score - a.score).findIndex(r => r.profile_id === me.id) + 1;
  const dsiEnd = g.end || after.score;

  async function share() {
    const who = me?.display_name ? `${me.display_name}'s ${y}` : `My ${y}`;
    const big = biggest ? ` Biggest: ${liftName(biggest.lift)} ${fmt(biggest.weight_lb)} lb.` : '';
    const message = `${who} on the Dandy Strength Index: ${prs.length} ${prs.length === 1 ? 'PR' : 'PRs'}, +${fmt(g.lb)} lb on my total, DSI ${dsiEnd}.${big} See yours: https://dandystrength.com/recap/${y}`;
    await Share.share({ message }).catch(() => {});
  }

  return wrap(<>
    <Eyebrow>{me.display_name ?? 'You'} · {y}</Eyebrow>
    <Title accent={String(y)}>Your</Title>

    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: -4 }}>
      <Kpi big={String(prs.length)} label={prs.length === 1 ? 'PR' : 'PRs'} />
      <Kpi big={`+${fmt(g.lb)}`} label="Lb added to your total" />
      <Kpi big={`${g.start || '·'} → ${dsiEnd}`} label="DSI" />
      <Kpi big={rank ? `#${rank}` : '·'} label="On the board today" />
    </View>

    <Card style={{ marginTop: 12, gap: 12, padding: 16 }}>
      {perLift.map(x => (
        <View key={x.l.k} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ width: 66, color: C.ink, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>{x.l.n}</Text>
          <Bar pct={x.b ? Math.min(100, (x.b / maxB) * 100) : 0} color={colorOf(x.l.db)} />
          <Mono style={{ width: 52, textAlign: 'right', fontSize: 14 }}>{x.b ? fmt(x.b) : 'n/a'}</Mono>
          <Mono style={{ width: 44, textAlign: 'right', fontSize: 12, color: C.up }}>{x.b > x.a && x.a ? '+' + fmt(x.b - x.a) : ''}</Mono>
        </View>
      ))}
    </Card>

    <Card>
      <Eyebrow>Biggest PR</Eyebrow>
      {biggest ? (
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/pr/[id]', params: { id: biggest.id } })} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={st.big}>{liftName(biggest.lift)} {fmt(biggest.weight_lb)} lb</Text>
          <Muted style={{ fontSize: 14 }}>Up {fmt(num(biggest.weight_lb) - num(biggest.prev_best))} on {fmtD(biggest.performed_on)}</Muted>
        </Pressable>
      ) : <Text style={st.line}>No PRs yet this year.</Text>}
    </Card>
    <Card>
      <Eyebrow>Busiest month</Eyebrow>
      <Text style={st.line}>{topM ? `${monthName(topM[0])}, ${topM[1]} sessions logged` : 'Nothing logged yet.'}</Text>
    </Card>
    <Card>
      <Eyebrow>Workouts logged</Eyebrow>
      <Text style={st.line}>{yDays.length} {yDays.length === 1 ? 'day' : 'days'} of programming logged in {y}.</Text>
    </Card>

    <Btn label="Share my year" onPress={share} style={{ marginTop: 6 }} />
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
      <Btn ghost label={String(y - 1)} onPress={() => { setY(y - 1); }} style={{ flex: 1 }} />
      {y < thisYear ? <Btn ghost label={String(y + 1)} onPress={() => { setY(y + 1); }} style={{ flex: 1 }} /> : null}
    </View>
  </>);
}

function Kpi({ big, label }: { big: string; label: string }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: '46%', backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 12, padding: 14 }}>
      <Mono style={{ fontSize: 26, color: C.ink }} >{big}</Mono>
      <Muted style={{ fontSize: 12, marginTop: 2 }}>{label}</Muted>
    </View>
  );
}
// A plain bar (no median tick): each lift against your heaviest.
function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <View style={{ height: 10, backgroundColor: '#0B1019', borderRadius: 5, overflow: 'hidden', flex: 1 }}>
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.max(0, pct)}%`, backgroundColor: color, borderRadius: 5 }} />
    </View>
  );
}

const st = {
  h: { color: C.ink, fontSize: 20, fontWeight: '800' as const },
  big: { color: C.ink, fontSize: 20, fontWeight: '800' as const, marginTop: 4 },
  line: { color: C.ink, fontSize: 16, marginTop: 4 },
};
