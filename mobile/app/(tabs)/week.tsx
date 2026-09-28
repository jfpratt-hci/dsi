import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Btn, Card, Chip, Eyebrow, Loading, Mono, Muted, s, Screen, Title } from '@/components/ui';
import { C, liftColor } from '@/constants/Colors';
import { addDays, fmtD, loadBoard, monday, target, today, type BoardRow } from '@/lib/data';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

type Workout = { id: string; day: string; title: string; source: string | null; sections: { name: string; text: string }[]; lifts: any[]; score_label: string | null; score_type: string | null; rest_note: string | null; pr_lift: string | null };

export default function Week() {
  const { me } = useSession();
  const [start, setStart] = useState(monday(today()));
  const [day, setDay] = useState(today());
  const [wks, setWks] = useState<Workout[] | null>(null);
  const [mine, setMine] = useState<BoardRow | null>(null);
  const [actual, setActual] = useState<Record<string, string>>({});
  const [score, setScore] = useState('');
  const [msg, setMsg] = useState('');
  const [showProg, setShowProg] = useState(false);

  const load = useCallback(async () => {
    const [{ data }, board] = await Promise.all([
      sb.from('workouts').select('*').gte('day', start).lte('day', addDays(start, 6)).order('day'),
      loadBoard(),
    ]);
    setWks((data as Workout[]) ?? []);
    setMine(me ? board.find(b => b.profile_id === me.id) ?? null : null);
  }, [start, me]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const w = useMemo(() => wks?.find(x => x.day === day), [wks, day]);

  // Load my existing log for the selected day
  useFocusEffect(useCallback(() => {
    setActual({}); setScore(''); setMsg('');
    if (!w || !me) return;
    sb.from('workout_logs').select('*').eq('workout_id', w.id).eq('profile_id', me.id).maybeSingle().then(({ data }) => {
      if (data) { setActual(Object.fromEntries(Object.entries(data.entries ?? {}).map(([k, v]) => [k, String(v)]))); setScore(data.score ?? ''); }
    });
  }, [w?.id, me?.id]));

  const base = mine ?? { bw: Number(me?.bodyweight) || 200, bench: 0, squat: 0, dead: 0, clean: 0 };

  async function save() {
    if (!me || !w) { router.push('/login'); return; }
    const entries: Record<string, number> = {};
    Object.entries(actual).forEach(([k, v]) => { const n = Math.round(Number(v)); if (n > 0) entries[k] = n; });
    setMsg('Saving…');
    const { error } = await sb.from('workout_logs').upsert({ workout_id: w.id, profile_id: me.id, entries, score: score || null }, { onConflict: 'workout_id,profile_id' });
    if (error) { setMsg(error.message); return; }
    if (w.pr_lift) {
      const maxItem = w.lifts.find(l => l.max && entries[l.id]);
      const key = w.pr_lift === 'deadlift' ? 'dead' : w.pr_lift;
      const best = (base as any)[key] || 0;
      if (maxItem && entries[maxItem.id] > best) {
        await sb.from('lift_entries').insert({ profile_id: me.id, lift: w.pr_lift, weight_lb: entries[maxItem.id], performed_on: w.day, source: 'workout' });
        setMsg(`New PR: ${entries[maxItem.id]} lb!`); return;
      }
    }
    setMsg('Logged. It shows on the day board.');
  }

  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <Screen>
      <Title eyebrow={`Week of ${fmtD(start)}`} accent="week">The</Title>
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
        {days.map(d => {
          const on = d === day, dt = new Date(d + 'T12:00:00');
          return (
            <Pressable key={d} onPress={() => { setDay(d); setShowProg(false); }} accessibilityRole="button" accessibilityState={{ selected: on }}
              style={{ flex: 1, height: 56, borderRadius: 10, borderWidth: 1, borderColor: on ? C.ink : d === today() ? C.muted : C.line, backgroundColor: on ? C.ink : C.panel, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 10, fontWeight: '600', color: on ? C.bg : C.muted }}>{dt.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}</Text>
              <Text style={{ fontSize: 20, fontWeight: '900', color: on ? C.bg : C.ink }}>{dt.getDate()}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        <Chip label="← Last week" on={false} onPress={() => { const s2 = addDays(start, -7); setStart(s2); setDay(s2); }} />
        <Chip label="Next week →" on={false} onPress={() => { const s2 = addDays(start, 7); setStart(s2); setDay(s2); }} />
      </View>

      {!wks ? <Loading /> : !w ? (
        <Card><Muted>No programming posted for this day yet.</Muted></Card>
      ) : (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <View style={{ flex: 1 }}>
              <Eyebrow>{w.source ?? 'DSI'}</Eyebrow>
              <Text style={{ color: C.ink, fontSize: 24, fontWeight: '900', textTransform: 'uppercase' }}>{w.title}</Text>
            </View>
            <Chip label={showProg ? 'Hide workout' : 'Full workout'} on={false} onPress={() => setShowProg(!showProg)} />
          </View>
          {w.rest_note ? <Card accent={C.up}><Text style={{ color: C.ink }}>{w.rest_note}</Text></Card> : null}
          {showProg ? <Card>{w.sections.map(x => <View key={x.name} style={{ marginBottom: 8 }}><Text style={{ color: C.ink, fontWeight: '700' }}>{x.name}</Text><Muted>{x.text}</Muted></View>)}</Card> : null}

          {w.lifts.length ? <Eyebrow style={{ color: C.ink, marginVertical: 6 }}>Recommended vs actual</Eyebrow> : null}
          {w.lifts.map(l => {
            const t = target(l, base), a = Number(actual[l.id] || 0), diff = a - t;
            const col = liftColor[l.b] ?? C.muted;
            return (
              <Card key={l.id} accent={col}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                  <Text style={{ color: C.ink, fontWeight: '700', fontSize: 16, flex: 1 }}>{l.n}</Text>
                  <Mono style={{ color: C.muted, fontSize: 13 }}>{l.sch}</Mono>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
                  <View style={{ width: 80 }}><Eyebrow>Target</Eyebrow><Mono style={{ fontSize: 22, color: C.accent }}>{t || 'n/a'}</Mono></View>
                  <TextInput value={actual[l.id] ?? ''} onChangeText={v => setActual({ ...actual, [l.id]: v.replace(/[^0-9]/g, '') })}
                    placeholder={t ? String(t) : 'lb'} placeholderTextColor="#5A6478" keyboardType="number-pad" accessibilityLabel={`${l.n} actual weight`}
                    style={[s.input, { flex: 1, textAlign: 'center' }]} />
                  <Btn ghost label="Hit" onPress={() => setActual({ ...actual, [l.id]: String(t) })} style={{ height: 52, paddingHorizontal: 12 }} />
                </View>
                <Muted style={{ marginTop: 6, color: !a ? C.muted : diff >= 0 ? C.up : C.flat }}>
                  {!a ? l.why : diff === 0 ? 'Hit it' : diff > 0 ? `${diff} over target` : `${-diff} under target`}
                </Muted>
              </Card>
            );
          })}
          {w.score_label ? (
            <Card>
              <Eyebrow>{w.score_label}</Eyebrow>
              <TextInput value={score} onChangeText={setScore} placeholder={w.score_type === 'time' ? '12:34' : 'Your score'} placeholderTextColor="#5A6478" style={[s.input, { marginTop: 6 }]} />
            </Card>
          ) : null}
          {w.lifts.length || w.score_label ? <Btn label={me ? 'Save today' : 'Sign in to log'} onPress={save} style={{ marginTop: 6 }} /> : null}
          {msg ? <Muted style={{ marginTop: 10, textAlign: 'center', color: msg.startsWith('New PR') ? C.accent : C.muted }}>{msg}</Muted> : null}
        </>
      )}
    </Screen>
  );
}
