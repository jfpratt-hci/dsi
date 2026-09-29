import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';

import { Btn, Card, Eyebrow, Loading, Muted, s, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { colorOf, fmt, fmtD, liftName, timeAgo } from '@/lib/data';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

const LBL: Record<string, [string, string]> = { open: ['Under review', C.flat], upheld: ['Lift stands', C.up], struck: ['Struck', C.down] };

export default function Protests() {
  const { isStaff } = useSession();
  const [list, setList] = useState<any[] | null>(null);
  const [tgt, setTgt] = useState<Map<string, any>>(new Map());
  const [names, setNames] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [{ data: ps }, { data: people }] = await Promise.all([
      sb.from('protests').select('*').order('created_at', { ascending: false }).limit(100),
      sb.from('profiles').select('id,display_name'),
    ]);
    const all = ps ?? [];
    const liftIds = all.filter(p => p.target_type === 'lift_entry').map(p => p.target_id);
    const logIds = all.filter(p => p.target_type === 'workout_log').map(p => p.target_id);
    const [l, g] = await Promise.all([
      liftIds.length ? sb.from('lift_entries').select('*').in('id', liftIds) : Promise.resolve({ data: [] as any[] }),
      logIds.length ? sb.from('workout_logs').select('*, workout:workouts(day,title)').in('id', logIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    setTgt(new Map([...(l.data ?? []), ...(g.data ?? [])].map((x: any) => [x.id, x])));
    setNames(Object.fromEntries((people ?? []).map((p: any) => [p.id, p.display_name || 'Someone'])));
    setList(all);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function rule(id: string, decision: 'upheld' | 'struck') {
    const { error } = await sb.rpc('rule_protest', { p_protest: id, p_decision: decision, p_note: notes[id]?.trim() || null });
    if (error) Alert.alert('Could not rule', error.message); else load();
  }

  const card = (p: any) => {
    const t = tgt.get(p.target_id);
    let what = 'A deleted entry', c: string = C.flat, who = '';
    if (t && p.target_type === 'lift_entry') { what = `${names[t.profile_id] ?? ''} · ${liftName(t.lift)} ${fmt(t.weight_lb)} lb · ${fmtD(t.performed_on)}`; c = colorOf(t.lift); who = t.profile_id; }
    if (t && p.target_type === 'workout_log') { what = `${names[t.profile_id] ?? ''} · ${t.workout ? fmtD(t.workout.day) + ' ' + t.workout.title : 'workout'} log`; who = t.profile_id; }
    const [label, col] = LBL[p.status];
    return (
      <Card key={p.id} accent={p.status === 'open' ? C.flat : col}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ color: col, fontWeight: '800', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</Text>
          <Muted style={{ fontSize: 12 }}>Filed {timeAgo(p.created_at)} by {names[p.filed_by] ?? 'someone'}</Muted>
        </View>
        <Pressable disabled={!who} onPress={() => router.push({ pathname: '/lifter/[id]', params: { id: who } })}>
          <Text style={{ color: C.ink, fontSize: 18, fontWeight: '800', textTransform: 'uppercase', marginTop: 6, borderLeftWidth: 0, borderColor: c }}>{what}</Text>
        </Pressable>
        <Text style={{ color: C.ink, marginTop: 6, fontSize: 15 }}>“{p.reason}”</Text>
        {p.status !== 'open' ? <Muted style={{ marginTop: 8, fontSize: 14 }}><Text style={{ fontWeight: '700', color: C.ink }}>Ruling by {names[p.ruled_by] ?? 'the Commissioner'}:</Text> {p.ruling_note || (p.status === 'struck' ? 'Struck from the record.' : 'The lift stands.')}</Muted> : null}
        {isStaff && p.status === 'open' ? (
          <View style={{ marginTop: 10, gap: 8 }}>
            <TextInput value={notes[p.id] ?? ''} onChangeText={v => setNotes({ ...notes, [p.id]: v })} placeholder="Explain the ruling (optional)" placeholderTextColor="#5A6478" style={[s.input, { fontSize: 15 }]} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn label="Lift stands" onPress={() => rule(p.id, 'upheld')} style={{ flex: 1 }} />
              <Btn label="Strike it" onPress={() => rule(p.id, 'struck')} style={{ flex: 1, backgroundColor: C.down }} />
            </View>
          </View>
        ) : null}
      </Card>
    );
  };

  const open = (list ?? []).filter(p => p.status === 'open'), done = (list ?? []).filter(p => p.status !== 'open');
  return (
    <Screen stack>
      <Title eyebrow="Commissioner's court" accent="">Protests</Title>
      <Muted style={{ fontSize: 15, marginBottom: 12 }}>See a suspicious PR or log? Hit Protest. The lift is flagged until the Commissioner rules. Struck lifts come off the boards.</Muted>
      {!list ? <Loading /> : <>
        <Eyebrow style={{ marginBottom: 8, color: C.accent }}>Open cases</Eyebrow>
        {open.length ? open.map(card) : <Card><Muted>No open protests. Peace in the gym. For now.</Muted></Card>}
        {done.length ? <><Eyebrow style={{ marginVertical: 8 }}>Ruled</Eyebrow>{done.map(card)}</> : null}
      </>}
    </Screen>
  );
}
