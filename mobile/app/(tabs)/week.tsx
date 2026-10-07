import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Btn, Card, Chip, Eyebrow, Loading, Mono, Muted, ProBadge, s, Screen, Title } from '@/components/ui';
import { C, liftColor } from '@/constants/Colors';
import { addDays, fmtD, loadBoard, monday, target, today, type BoardRow, pickWorkouts, workoutsQuery } from '@/lib/data';
import { scheduleReminders } from '@/lib/notify';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

export type Workout = { id: string; day: string; title: string; source: string | null; sections: { name: string; text: string }[]; lifts: any[]; score_label: string | null; score_type: string | null; rest_note: string | null; pr_lift: string | null };
type Log = { id: string; profile_id: string; entries: Record<string, number>; score: string | null; sets?: Record<string, { w: number; r: number }[]> };

const secs = (t: string | null) => { if (!t) return Infinity; const p = t.split(':').map(Number); return p.some(isNaN) ? Infinity : p.reduce((a, b) => a * 60 + b, 0); };

export default function Week() {
  const { me, isPro, blocked } = useSession();
  const [start, setStart] = useState(monday(today()));
  const [day, setDay] = useState(today());
  const [wks, setWks] = useState<Workout[] | null>(null);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [actual, setActual] = useState<Record<string, string>>({});
  const [score, setScore] = useState('');
  const [msg, setMsg] = useState('');
  const [showProg, setShowProg] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data }, b] = await Promise.all([
      workoutsQuery(sb.from('workouts').select('*').gte('day', start).lte('day', addDays(start, 6)).order('day'), me?.gym_id),
      loadBoard(),
    ]);
    setWks(pickWorkouts((data as Workout[]) ?? [], me?.gym_id));
    setBoard(b);
    setNames(Object.fromEntries(b.map(r => [r.profile_id, r.name])));
  }, [start, me?.gym_id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const w = useMemo(() => wks?.find(x => x.day === day), [wks, day]);
  const mine = me ? board.find(b => b.profile_id === me.id) ?? null : null;
  const base = mine ?? { bw: Number(me?.bodyweight) || 200, sex: me?.sex, bench: 0, squat: 0, dead: 0, clean: 0 };

  // Everyone's logs for the day (the day board) and my own entries
  const loadLogs = useCallback(async () => {
    setActual({}); setScore(''); setMsg('');
    if (!w) { setLogs([]); return; }
    const { data } = await sb.from('workout_logs').select('id,profile_id,entries,score,sets').eq('workout_id', w.id);
    const list = (data as Log[]) ?? [];
    setLogs(list);
    const my = me ? list.find(l => l.profile_id === me.id) : null;
    if (my) { setActual(Object.fromEntries(Object.entries(my.entries ?? {}).map(([k, v]) => [k, String(v)]))); setScore(my.score ?? ''); }
  }, [w?.id, me?.id]);
  useFocusEffect(useCallback(() => { loadLogs(); }, [loadLogs]));

  async function save() {
    if (!me || !w) { router.push('/login'); return; }
    if (!isPro) { router.push('/pro'); return; }
    const entries: Record<string, number> = {};
    Object.entries(actual).forEach(([k, v]) => { const n = Math.round(Number(v) * 2) / 2; if (n > 0) entries[k] = n; });
    setBusy(true); setMsg('Saving…');
    const { error } = await sb.from('workout_logs').upsert({ workout_id: w.id, profile_id: me.id, entries, score: score || null }, { onConflict: 'workout_id,profile_id' });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    scheduleReminders(me).catch(() => {});
    if (w.pr_lift) {
      const maxItem = w.lifts.find(l => l.max && entries[l.id]);
      const key = w.pr_lift === 'deadlift' ? 'dead' : w.pr_lift;
      const best = (base as any)[key] || 0;
      if (maxItem && entries[maxItem.id] > best) {
        const { data } = await sb.from('lift_entries').insert({ profile_id: me.id, lift: w.pr_lift, weight_lb: entries[maxItem.id], performed_on: w.day, source: 'workout' }).select().single();
        if (data?.is_pr) { router.push({ pathname: '/pr/[id]', params: { id: data.id, celebrate: '1' } }); loadLogs(); return; }
      }
    }
    setMsg('Logged. You are on the day board.');
    loadLogs();
  }

  async function talk() {
    if (!me || !w) { router.push('/login'); return; }
    const t = `${fmtD(w.day)} · ${w.title}`;
    const { data, error } = await sb.rpc('room_for', { p_kind: 'workout', p_ref: w.id, p_title: t });
    if (!error) router.push({ pathname: '/room/[id]', params: { id: data, title: t } });
  }

  // Day board: best score first (time: lowest), then by total weight moved on the listed lifts
  const dayBoard = useMemo(() => {
    if (!w) return [];
    const isT = w.score_type === 'time';
    return logs.filter(l => !blocked.has(l.profile_id)).map(l => ({ ...l, sum: Object.values(l.entries ?? {}).reduce((a, b) => a + Number(b || 0), 0) }))
      .sort((a, b) => (w.score_label ? (isT ? secs(a.score) - secs(b.score) : Number(b.score || 0) - Number(a.score || 0)) : 0) || b.sum - a.sum);
  }, [logs, w, blocked]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const rest = w && !w.lifts.length && !w.score_label;
  return (
    <Screen>
      <Title eyebrow={`Week of ${fmtD(start)}`} accent="week">The</Title>
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
        {days.map(d => {
          const on = d === day, dt = new Date(d + 'T12:00:00'), has = wks?.some(x => x.day === d);
          return (
            <Pressable key={d} onPress={() => setDay(d)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={dt.toDateString()}
              style={{ flex: 1, height: 56, borderRadius: 10, borderWidth: 1, borderColor: on ? C.ink : d === today() ? C.muted : C.line, backgroundColor: on ? C.ink : C.panel, alignItems: 'center', justifyContent: 'center', opacity: has || on ? 1 : 0.55 }}>
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
      ) : rest ? (
        <Card accent={C.up}>
          <Text style={{ color: C.ink, fontSize: 24, fontWeight: '900', textTransform: 'uppercase', marginBottom: 6 }}>Rest <Text style={{ color: C.up }}>day</Text></Text>
          <Muted style={{ fontSize: 15 }}>{w.rest_note || 'Nothing to log. Recover like it is your job.'}</Muted>
        </Card>
      ) : (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 6 }}>
            <View style={{ flex: 1 }}>
              <Eyebrow>{w.source ?? 'DSI'}</Eyebrow>
              <Text style={{ color: C.ink, fontSize: 24, fontWeight: '900', textTransform: 'uppercase' }}>{w.title}</Text>
            </View>
            <Chip label={showProg ? 'Hide' : 'Workout'} on={false} onPress={() => setShowProg(!showProg)} />
            <Chip label="Talk" on={false} onPress={talk} />
          </View>
          {showProg ? <Card>{w.sections.map(x => <View key={x.name} style={{ marginBottom: 8 }}><Text style={{ color: C.ink, fontWeight: '700' }}>{x.name}</Text><Muted>{x.text}</Muted></View>)}</Card> : null}

          {!isPro && w.lifts.length ? (
            <Pressable onPress={() => router.push('/pro')} accessibilityRole="button">
              <Card style={{ borderColor: C.accent, backgroundColor: '#221F14' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Text style={{ color: C.ink, fontWeight: '800', fontSize: 16, flex: 1 }}>Your weights for today</Text><ProBadge />
                </View>
                <Muted style={{ fontSize: 14 }}>Pro turns every lift here into a target weight built from your own PRs, then logs what you actually did and puts you on the day board.</Muted>
              </Card>
            </Pressable>
          ) : null}

          {w.lifts.length ? <Eyebrow style={{ color: C.ink, marginVertical: 6 }}>{isPro ? 'Target vs actual' : 'Lifts today'}</Eyebrow> : null}
          {w.lifts.map(l => {
            const t = target(l, base), a = Number(actual[l.id] || 0), diff = a - t;
            const col = liftColor[l.b] ?? C.muted;
            return (
              <Card key={l.id} accent={col}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                  <Text style={{ color: C.ink, fontWeight: '700', fontSize: 16, flex: 1 }}>{l.n}</Text>
                  <Mono style={{ color: C.muted, fontSize: 13 }}>{l.sch}</Mono>
                </View>
                {isPro ? (<>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <View style={{ width: 64, flexShrink: 0 }}><Eyebrow>Target</Eyebrow><Mono style={{ fontSize: 22, color: C.accent }}>{t || 'n/a'}</Mono></View>
                    <TextInput value={actual[l.id] ?? ''} onChangeText={v => setActual({ ...actual, [l.id]: v.replace(/[^0-9.]/g, '') })}
                      placeholder={t ? String(t) : 'lb'} placeholderTextColor="#5A6478" keyboardType="decimal-pad" accessibilityLabel={`${l.n} actual weight`}
                      style={[s.input, { flex: 1, minWidth: 0, textAlign: 'center' }]} />
                    <Btn ghost label="Hit" onPress={() => setActual({ ...actual, [l.id]: String(t) })} style={{ height: 52, width: 54, paddingHorizontal: 0, flexShrink: 0 }} />
                    <Btn ghost label="Sets" onPress={() => router.push({ pathname: '/lift', params: { wid: w.id, lid: l.id } })} style={{ height: 52, width: 58, paddingHorizontal: 0, flexShrink: 0 }} />
                  </View>
                  <Muted style={{ marginTop: 6, color: !a ? C.muted : diff >= 0 ? C.up : C.flat }}>
                    {!a ? l.why : diff === 0 ? 'Hit it' : diff > 0 ? `${diff} over target` : `${-diff} under target`}
                  </Muted>
                </>) : <Muted style={{ marginTop: 4 }}>{l.rx?.length ? `Rx ${l.rx[0]}${l.rx[1] && l.rx[1] !== l.rx[0] ? ' / ' + l.rx[1] : ''} lb` : 'Target from your PRs with Pro'}</Muted>}
              </Card>
            );
          })}
          {isPro && w.score_label ? (
            <Card>
              <Eyebrow>{w.score_label}</Eyebrow>
              <TextInput value={score} onChangeText={setScore} placeholder={w.score_type === 'time' ? '12:34' : 'Your score'} placeholderTextColor="#5A6478" style={[s.input, { marginTop: 6 }]} accessibilityLabel={w.score_label} />
            </Card>
          ) : null}
          {w.lifts.length || w.score_label ? <Btn label={!me ? 'Sign in to log' : isPro ? 'Save today' : 'Log workouts with Pro'} onPress={save} disabled={busy} style={{ marginTop: 6 }} /> : null}
          {msg ? <Muted style={{ marginTop: 10, textAlign: 'center' }}>{msg}</Muted> : null}

          <View style={{ marginTop: 22 }}>
            <Title eyebrow={fmtD(w.day)} accent="board">Day</Title>
            {!dayBoard.length ? <Card><Muted>Nobody has logged this day yet.</Muted></Card> : dayBoard.map((l, i) => (
              <Pressable key={l.id} onPress={() => router.push({ pathname: '/lifter/[id]', params: { id: l.profile_id } })} accessibilityRole="button"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, backgroundColor: me?.id === l.profile_id ? 'rgba(242,201,76,0.08)' : 'transparent' }}>
                <Text style={{ width: 24, fontSize: 20, fontWeight: '900', color: i === 0 ? C.accent : C.muted }}>{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.ink, fontWeight: '600', fontSize: 16 }}>{names[l.profile_id] ?? 'Lifter'}</Text>
                  <Muted style={{ fontSize: 12 }}>{w.lifts.filter(x => l.entries?.[x.id]).map(x => `${x.n} ${l.entries[x.id]}`).join(' · ') || 'Logged'}</Muted>
                </View>
                {l.score ? <Mono style={{ fontSize: 18, color: C.ink }}>{l.score}</Mono> : null}
              </Pressable>
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}
