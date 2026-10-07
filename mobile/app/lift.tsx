// 3.2 Lift focus: log a programmed lift set by set, with a rest timer. Pro.
import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Btn, Card, Chip, Eyebrow, Loading, Mono, Muted, s, Screen, Title } from '@/components/ui';
import { C, liftColor } from '@/constants/Colors';
import { loadBoard, target } from '@/lib/data';
import { scheduleReminders } from '@/lib/notify';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

type Set_ = { w: string; r: string; done: boolean };
const RESTS = [60, 90, 120, 180];

// "4 x 8" -> 4 sets of 8. "30 reps" -> 1 set of 30. Anything else -> 3 sets.
function scheme(sch: string): { n: number; r: number } {
  const m = /(\d+)\s*[x×]\s*(\d+)/i.exec(sch || '');
  if (m) return { n: Math.min(10, Number(m[1])), r: Number(m[2]) };
  const reps = /(\d+)\s*reps?/i.exec(sch || '');
  if (reps) return { n: 1, r: Number(reps[1]) };
  if (/single|1\s*rm|max/i.test(sch || '')) return { n: 1, r: 1 };
  return { n: 3, r: 5 };
}

export default function LiftFocus() {
  const { wid, lid } = useLocalSearchParams<{ wid: string; lid: string }>();
  const { me, isPro } = useSession();
  const [lift, setLift] = useState<any>(null);
  const [title, setTitle] = useState('');
  const [tgt, setTgt] = useState(0);
  const [sets, setSets] = useState<Set_[] | null>(null);
  const [log, setLog] = useState<any>(null);
  const [rest, setRest] = useState(90);
  const [left, setLeft] = useState(0);
  const [msg, setMsg] = useState('');
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!me || !wid) return;
    (async () => {
      const [{ data: w }, board, { data: l }] = await Promise.all([
        sb.from('workouts').select('*').eq('id', wid).single(),
        loadBoard(),
        sb.from('workout_logs').select('*').eq('workout_id', wid).eq('profile_id', me.id).maybeSingle(),
      ]);
      const L = (w?.lifts ?? []).find((x: any) => x.id === lid);
      const mine = board.find(b => b.profile_id === me.id) ?? { bw: Number(me.bodyweight) || 200, bench: 0, squat: 0, dead: 0, clean: 0 };
      const t = L ? target(L, mine) : 0;
      setLift(L); setTitle(w?.title ?? ''); setTgt(t); setLog(l);
      const saved = l?.sets?.[lid as string];
      if (saved?.length) setSets(saved.map((x: any) => ({ w: String(x.w), r: String(x.r), done: true })));
      else { const { n, r } = scheme(L?.sch ?? ''); setSets(Array.from({ length: n }, () => ({ w: t ? String(t) : '', r: String(r), done: false }))); }
    })();
  }, [me?.id, wid, lid]);

  useEffect(() => () => { if (tick.current) clearInterval(tick.current); }, []);

  function startRest() {
    if (tick.current) clearInterval(tick.current);
    setLeft(rest);
    tick.current = setInterval(() => setLeft(v => {
      if (v <= 1) { if (tick.current) clearInterval(tick.current); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); return 0; }
      return v - 1;
    }), 1000);
  }

  function toggle(i: number) {
    if (!sets) return;
    const next = sets.map((x, k) => (k === i ? { ...x, done: !x.done } : x));
    setSets(next);
    if (!sets[i].done) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); startRest(); }
  }
  const upd = (i: number, k: 'w' | 'r', v: string) => sets && setSets(sets.map((x, j) => (j === i ? { ...x, [k]: v.replace(/[^0-9.]/g, '') } : x)));

  async function save() {
    if (!me || !sets) return;
    if (!isPro) { router.push('/pro'); return; }
    const done = sets.filter(x => x.done && Number(x.w) > 0).map(x => ({ w: Number(x.w), r: Number(x.r) || 0 }));
    const top = done.reduce((m, x) => Math.max(m, x.w), 0);
    const entries = { ...(log?.entries ?? {}) }; if (top) entries[lid as string] = top; else delete entries[lid as string];
    const allSets = { ...(log?.sets ?? {}), [lid as string]: done };
    setMsg('Saving…');
    const { data, error } = await sb.from('workout_logs').upsert({ workout_id: wid, profile_id: me.id, entries, sets: allSets, score: log?.score ?? null }, { onConflict: 'workout_id,profile_id' }).select().single();
    if (error) { setMsg(error.message); return; }
    setLog(data); scheduleReminders(me).catch(() => {});
    router.back();
  }

  if (!sets || !lift) return <Screen stack><Loading /></Screen>;
  const col = liftColor[lift.b] ?? C.accent;
  const doneN = sets.filter(x => x.done).length;
  return (
    <Screen stack>
      <Stack.Screen options={{ title: lift.n }} />
      <Title eyebrow={title} accent={lift.sch}>{lift.n}</Title>
      <Card accent={col} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <View><Eyebrow>Target</Eyebrow><Mono style={{ fontSize: 30, color: C.accent }}>{tgt || 'n/a'}</Mono></View>
        <View style={{ alignItems: 'flex-end' }}><Eyebrow>Sets done</Eyebrow><Mono style={{ fontSize: 30 }}>{doneN}/{sets.length}</Mono></View>
      </Card>
      <Muted style={{ marginBottom: 10 }}>{lift.why}</Muted>

      {sets.map((x, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Text style={{ width: 22, color: C.muted, fontWeight: '700' }}>{i + 1}</Text>
          <TextInput value={x.w} onChangeText={v => upd(i, 'w', v)} keyboardType="decimal-pad" placeholder="lb" placeholderTextColor="#5A6478" accessibilityLabel={`Set ${i + 1} weight`} style={[s.input, { flex: 1, textAlign: 'center' }]} />
          <Text style={{ color: C.muted }}>×</Text>
          <TextInput value={x.r} onChangeText={v => upd(i, 'r', v)} keyboardType="number-pad" placeholder="reps" placeholderTextColor="#5A6478" accessibilityLabel={`Set ${i + 1} reps`} style={[s.input, { width: 70, textAlign: 'center' }]} />
          <Pressable onPress={() => toggle(i)} accessibilityRole="checkbox" accessibilityState={{ checked: x.done }} accessibilityLabel={`Set ${i + 1} done`}
            style={{ width: 52, height: 52, borderRadius: 10, borderWidth: 1, borderColor: x.done ? C.up : C.line, backgroundColor: x.done ? C.up : C.panel, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: x.done ? C.bg : C.muted, fontSize: 22, fontWeight: '900' }}>✓</Text>
          </Pressable>
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
        <Chip label="+ Add set" on={false} onPress={() => setSets([...sets, { ...(sets[sets.length - 1] ?? { w: String(tgt), r: '5' }), done: false }])} />
        {sets.length > 1 ? <Chip label="Remove last" on={false} onPress={() => setSets(sets.slice(0, -1))} /> : null}
      </View>

      <Card style={{ alignItems: 'center' }}>
        <Eyebrow>Rest timer</Eyebrow>
        <Mono style={{ fontSize: 56, color: left ? C.accent : C.ink, marginVertical: 4 }}>{Math.floor((left || rest) / 60)}:{String((left || rest) % 60).padStart(2, '0')}</Mono>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' }}>
          {RESTS.map(r => <Chip key={r} label={`${r / 60 >= 1 ? r / 60 + ' min' : r + 's'}`} on={rest === r} onPress={() => setRest(r)} />)}
        </View>
        <Btn ghost label={left ? 'Restart' : 'Start rest'} onPress={startRest} style={{ marginTop: 8, alignSelf: 'stretch' }} />
        <Muted style={{ marginTop: 6, fontSize: 12 }}>Checking off a set starts the timer.</Muted>
      </Card>

      <Btn label="Save sets" onPress={save} style={{ marginTop: 8 }} />
      {msg ? <Muted style={{ marginTop: 10, textAlign: 'center' }}>{msg}</Muted> : null}
    </Screen>
  );
}
