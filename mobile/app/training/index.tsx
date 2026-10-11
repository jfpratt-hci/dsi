// My training: every session a member logs on their own (free), plus the Pro insights. Same as site/js/training.js.
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Btn, Card, Eyebrow, Loading, Mono, Muted, ProBadge, s, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { fmt, fmtD, monday, today } from '@/lib/data';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';
import { fmtDW, insights, missing, num, sessionTotal, setText, topSet, type Session } from '@/lib/training';

const PAGE = 30;

export default function Training() {
  const { me, isPro } = useSession();
  const { msg, t } = useLocalSearchParams<{ msg?: string; t?: string }>();
  const [wks, setWks] = useState<Session[] | null>(null);
  const [soon, setSoon] = useState(false);
  const [err, setErr] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [flash, setFlash] = useState('');

  const load = useCallback(async () => {
    if (!me) return;
    const res = await sb.from('personal_workouts').select('*').eq('profile_id', me.id)
      .order('day', { ascending: false }).order('created_at', { ascending: false }).limit(200);
    if (res.error) {
      if (missing(res.error)) { setSoon(true); setWks([]); return; }
      setErr(res.error.message); setWks(w => w ?? []); return;
    }
    setSoon(false); setErr('');
    setWks(((res.data ?? []) as any[]).map(w => ({ ...w, exercises: Array.isArray(w.exercises) ? w.exercises : [] })) as Session[]);
  }, [me]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // A short confirmation after saving or deleting, passed in by the editor.
  useEffect(() => {
    if (!msg) return;
    setFlash(msg);
    const h = setTimeout(() => setFlash(''), 4000);
    return () => clearTimeout(h);
  }, [msg, t]);

  const head = <Stack.Screen options={{ title: 'My training' }} />;

  if (!me) {
    return (
      <Screen stack>
        {head}
        <Title accent="training">My</Title>
        <Card>
          <Text style={{ color: C.ink, fontWeight: '800', fontSize: 16, marginBottom: 4 }}>Sign in to track your training</Text>
          <Muted style={{ fontSize: 15 }}>Members log lifts, chat and file protests. Boards and PRs stay public.</Muted>
        </Card>
        <Btn label="Sign in" onPress={() => router.push('/login')} />
      </Screen>
    );
  }
  if (!wks) return <Screen stack>{head}<Loading /></Screen>;

  if (soon) {
    return (
      <Screen stack>
        {head}
        <Title accent="training">My</Title>
        <Card>
          <Text style={{ color: C.ink, fontWeight: '800', fontSize: 16, marginBottom: 4 }}>My training is switching on</Text>
          <Muted style={{ fontSize: 15 }}>Logging your own sessions goes live as soon as today&apos;s update finishes. Check back shortly.</Muted>
        </Card>
        <Btn ghost label="Log a single lift meanwhile" onPress={() => router.push('/(tabs)/log')} />
      </Screen>
    );
  }

  const thisWeek = wks.filter(w => w.day >= monday(today()));
  const moved = thisWeek.reduce((x, w) => x + sessionTotal(w), 0);
  const logNew = () => router.push('/training/edit');

  return (
    <Screen stack>
      {head}
      <Title accent="training">My</Title>
      <Muted style={{ fontSize: 15, marginTop: -6, marginBottom: 14 }}>
        Log your own sessions: open gym, travel, your own program. Heavy singles on a catalog lift count as PRs{isPro ? '' : ' (the four DSI lifts on free, every lift on Pro)'}.
      </Muted>
      {flash ? (
        <Card accent={C.up} style={{ marginBottom: 12 }}>
          <Text accessibilityLiveRegion="polite" style={{ color: C.ink, fontWeight: '700', fontSize: 15 }}>{flash}</Text>
        </Card>
      ) : null}
      <Btn label="Log a session" onPress={logNew} style={{ marginBottom: 14 }} />

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
        <Stat n={fmt(thisWeek.length)} label={thisWeek.length === 1 ? 'session this week' : 'sessions this week'} />
        <Stat n={fmt(moved)} label="lb moved this week" />
        <Stat n={fmt(wks.length)} label="sessions logged" />
      </View>

      {err ? <Card><Muted style={{ fontSize: 14, color: C.down }}>{err}</Muted></Card> : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14, marginBottom: 8 }}>
        <Eyebrow>Your trend</Eyebrow><ProBadge />
      </View>
      {isPro ? <Insights wks={wks} /> : <Teaser />}

      <Eyebrow style={{ marginTop: 14, marginBottom: 8 }}>Sessions</Eyebrow>
      {wks.length ? (
        <>
          {wks.slice(0, shown).map(w => <SessionCard key={w.id} w={w} />)}
          {wks.length > shown ? <Btn ghost label={`Show more (${wks.length - shown})`} onPress={() => setShown(shown + PAGE)} /> : null}
        </>
      ) : (
        <Card>
          <Text style={{ color: C.ink, fontWeight: '800', fontSize: 16, marginBottom: 4 }}>No sessions yet</Text>
          <Muted style={{ fontSize: 15, marginBottom: 12 }}>Log your first one. It takes about a minute.</Muted>
          <Btn label="Log a session" onPress={logNew} />
        </Card>
      )}
    </Screen>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <Card style={{ flex: 1, paddingHorizontal: 10, marginBottom: 0 }}>
      <Text style={[s.mono, { fontSize: 22 }]} numberOfLines={1} adjustsFontSizeToFit>{n}</Text>
      <Muted style={{ fontSize: 12 }}>{label}</Muted>
    </Card>
  );
}

function SessionCard({ w }: { w: Session }) {
  const exs = w.exercises || [];
  const tops = exs.map(ex => ({ name: ex.name, t: topSet(ex) })).filter(x => x.t);
  const more = tops.length - 3;
  return (
    <Card style={{ padding: 0 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${fmtDW(w.day)}, ${w.title}. Open session`}
        onPress={() => router.push({ pathname: '/training/edit', params: { id: w.id } })}
        style={({ pressed }) => [{ padding: 14, paddingBottom: 10, borderTopLeftRadius: 12, borderTopRightRadius: 12 }, pressed && { backgroundColor: C.panel2 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Eyebrow style={{ flex: 1 }}>{fmtDW(w.day)}</Eyebrow>
          <Text style={[s.mono, { fontSize: 13, color: C.muted }]}>{fmt(sessionTotal(w))} lb</Text>
        </View>
        <Text style={{ color: C.ink, fontWeight: '800', fontSize: 17, marginTop: 4 }} numberOfLines={2}>{w.title}</Text>
        <Muted style={{ fontSize: 14, marginTop: 2 }}>{exs.length === 1 ? '1 exercise' : `${exs.length} exercises`}</Muted>
        {tops.slice(0, 3).map((x, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 4 }}>
            <Text style={{ color: C.ink, fontSize: 14, flex: 1 }} numberOfLines={1}>{x.name}</Text>
            <Text style={[s.mono, { fontSize: 14 }]}>{setText(x.t!)}</Text>
          </View>
        ))}
        {more > 0 ? <Muted style={{ fontSize: 13, marginTop: 4 }}>and {more} more</Muted> : null}
      </Pressable>
      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.line }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Do ${w.title} again`}
          onPress={() => router.push({ pathname: '/training/edit', params: { again: w.id } })}
          style={({ pressed }) => [{ flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderBottomLeftRadius: 12, borderBottomRightRadius: 12 }, pressed && { backgroundColor: C.panel2 }]}>
          <Text style={{ color: C.accent, fontWeight: '700', fontSize: 14, letterSpacing: 1, textTransform: 'uppercase' }}>Do it again</Text>
        </Pressable>
      </View>
    </Card>
  );
}

/* ---------- Pro: weekly volume for 8 weeks and the best estimated max per exercise ---------- */
const CHART_H = 120;
const short = (v: number) => (!v ? '' : v < 1000 ? fmt(Math.round(v)) : fmt(Math.round(v / 1000)) + 'k');

function Insights({ wks }: { wks: Session[] }) {
  const { weeks, vols, counts, top } = insights(wks);
  const [sel, setSel] = useState(weeks.length - 1);
  const max = Math.max(1, ...vols);
  const i = Math.min(sel, weeks.length - 1);
  return (
    <>
      <Card>
        <Muted style={{ fontSize: 13, marginBottom: 10 }}>Pounds moved per week</Muted>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: CHART_H + 18, borderBottomWidth: 1, borderBottomColor: C.line }}
          accessibilityLabel="Pounds moved each week for the last 8 weeks">
          {vols.map((v, j) => {
            const h = v ? Math.max(3, Math.round((v / max) * CHART_H)) : 0;
            const on = j === i;
            return (
              <Pressable key={weeks[j]} onPress={() => setSel(j)} accessibilityRole="button" accessibilityState={{ selected: on }}
                accessibilityLabel={`Week of ${fmtD(weeks[j])}, ${fmt(v)} pounds`}
                style={{ flex: 1, height: '100%', alignItems: 'center', justifyContent: 'flex-end' }}>
                <Text style={{ color: on ? C.ink : C.muted, fontSize: 10, fontWeight: '700', marginBottom: 3 }} numberOfLines={1}>{short(v)}</Text>
                <View style={{ width: '62%', maxWidth: 24, height: h, backgroundColor: C.accent, opacity: on ? 1 : 0.55, borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
              </Pressable>
            );
          })}
        </View>
        {/* Month over day so eight labels fit a small phone. */}
        <View style={{ flexDirection: 'row', marginTop: 4 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {weeks.map((wk, j) => {
            const [m, d] = fmtD(wk).split(' ');
            return (
              <View key={wk} style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ color: C.muted, fontSize: 10 }} numberOfLines={1}>{m}</Text>
                <Text style={{ color: j === i ? C.ink : C.muted, fontSize: 12, fontWeight: '700' }} numberOfLines={1}>{d}</Text>
              </View>
            );
          })}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 10, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10 }}>
          <Text style={{ color: C.muted, fontSize: 14, flex: 1 }}>Week of {fmtD(weeks[i])}</Text>
          <Text style={[s.mono, { fontSize: 15 }]}>{fmt(vols[i])} lb</Text>
          <Text style={{ color: C.muted, fontSize: 14, marginLeft: 10 }}>{counts[i] === 1 ? '1 session' : `${counts[i]} sessions`}</Text>
        </View>
      </Card>
      <Card>
        <Muted style={{ fontSize: 13, marginBottom: 4 }}>Best estimated max by exercise</Muted>
        {top.length ? top.map((b, j) => (
          <View key={b.name} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: j ? 1 : 0, borderTopColor: C.line }}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={{ color: C.ink, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>{b.name}</Text>
              <Muted style={{ fontSize: 12 }}>{fmt(num(b.s.w))}×{num(b.s.r)} on {fmtD(b.day)}</Muted>
            </View>
            <Mono style={{ fontSize: 18 }}>{fmt(b.v)}</Mono>
          </View>
        )) : <Muted style={{ fontSize: 14, paddingVertical: 8 }}>Log a few sessions to see this.</Muted>}
      </Card>
    </>
  );
}

const GHOST = [0.35, 0.55, 0.4, 0.7, 0.6, 0.85, 0.5, 0.95];
function Teaser() {
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push('/pro')}>
      <Card accent={C.accent}>
        <Text style={{ color: C.ink, fontWeight: '800', fontSize: 16 }}>See your training trend with DSI Pro</Text>
        <Muted style={{ fontSize: 14, marginTop: 2 }}>Weekly volume and your best estimated max on every exercise.</Muted>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 70, marginVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {GHOST.map((g, j) => (
            <View key={j} style={{ flex: 1, alignItems: 'center' }}>
              <View style={{ width: '62%', maxWidth: 24, height: Math.round(g * 64), backgroundColor: C.line, borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
            </View>
          ))}
        </View>
        <Text style={{ color: C.accent, fontWeight: '700', fontSize: 14, letterSpacing: 1, textTransform: 'uppercase' }}>See DSI Pro ›</Text>
      </Card>
    </Pressable>
  );
}
