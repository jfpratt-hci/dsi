import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { Btn, Card, Eyebrow, Group, Loading, Mono, Muted, PctBar, Screen } from '@/components/ui';
import { C } from '@/constants/Colors';
import { ageOf, block, clubOf, colorOf, fmt, fmtD, isMain, liftName, LIFTS, loadBoard, pcts, score, total, unblock, verdict, type Entry } from '@/lib/data';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

export default function Lifter() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me, blocked, reloadBlocks } = useSession();
  const [p, setP] = useState<any>(null);
  const [row, setRow] = useState<any>(null);
  const [hist, setHist] = useState<Entry[] | null>(null);
  const [goals, setGoals] = useState<any[]>([]);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const [board, prof, h, g] = await Promise.all([
        loadBoard(),
        sb.from('profiles').select('id,display_name,division,sex,birth_year,bodyweight,roast_opt_in,role,tier').eq('id', id).maybeSingle(),
        sb.from('lift_entries').select('*').eq('profile_id', id).order('performed_on', { ascending: false }).order('created_at', { ascending: false }).limit(200),
        sb.from('goals').select('*').eq('profile_id', id),
      ]);
      if (!prof.data) { setErr('This lifter is not on the board anymore.'); return; }
      setP(prof.data);
      const r = board.find(b => b.profile_id === id) ?? { bw: Number(prof.data.bodyweight) || 185, age: ageOf(prof.data.birth_year), bench: 0, squat: 0, dead: 0, clean: 0 };
      setRow({ ...r, score: score(r), total: total(r), p: pcts(r) });
      setHist((h.data as Entry[]) ?? []);
      setGoals(g.data ?? []);
    } catch (e: any) { setErr(e.message); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (err) return <Screen stack><Card><Muted>{err}</Muted></Card></Screen>;
  if (!p || !row || !hist) return <Screen stack><Loading /></Screen>;

  const mine = me?.id === id, isBlocked = blocked.has(id);
  const v = verdict(row.score), club = clubOf(row.total);
  const bestOf: Record<string, number> = {};
  hist.filter(e => e.status !== 'struck').forEach(e => { bestOf[e.lift] = Math.max(bestOf[e.lift] || 0, Number(e.weight_lb)); });
  const others = Object.entries(bestOf).filter(([l]) => !isMain(l));

  function more() {
    if (!me) { router.push('/login'); return; }
    Alert.alert(p.display_name, undefined, [
      { text: 'Report this lifter', onPress: () => router.push({ pathname: '/report', params: { type: 'profile', id, name: p.display_name, uid: id } }) },
      isBlocked
        ? { text: 'Unblock', onPress: async () => { await unblock(me.id, id); await reloadBlocks(); } }
        : { text: 'Block', style: 'destructive', onPress: async () => { await block(me.id, id); await reloadBlocks(); Alert.alert('Blocked', `You will not see messages from ${p.display_name}.`); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function delEntry(e: Entry) {
    Alert.alert('Delete this lift?', `${liftName(e.lift)} ${fmt(e.weight_lb)} lb on ${fmtD(e.performed_on)}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { const { error } = await sb.from('lift_entries').delete().eq('id', e.id); if (error) Alert.alert('Could not delete', error.message); else load(); } },
    ]);
  }

  return (
    <Screen stack>
      <Stack.Screen options={{ title: p.display_name, headerRight: mine ? undefined : () => <Pressable onPress={more} hitSlop={12} accessibilityLabel="More options"><Text style={{ color: C.accent, fontSize: 24 }}>•••</Text></Pressable> }} />
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <View style={{ backgroundColor: C.panel2, padding: 16, flexDirection: 'row', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Eyebrow>{p.division} division{p.role === 'admin' ? ' · Founder' : p.role === 'commissioner' ? ' · Commissioner' : ''}</Eyebrow>
            <Text style={{ color: C.ink, fontSize: 34, fontWeight: '900', textTransform: 'uppercase' }} numberOfLines={1} adjustsFontSizeToFit>{p.display_name}{p.roast_opt_in ? ' 🔥' : ''}</Text>
            <Muted style={{ fontSize: 13 }}>{row.age ? `Age ${row.age} · ` : ''}{row.bw ? `${row.bw} lb · ` : ''}{fmt(row.total)} lb total{club ? ` · ${fmt(club)} club` : ''}</Muted>
          </View>
          <View style={{ alignItems: 'flex-end' }}><Eyebrow>DSI™</Eyebrow><Mono style={{ fontSize: 44 }}>{row.score}</Mono></View>
        </View>
        {v ? <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: C.line }}>
          <Text style={{ color: C.accent, fontSize: 20, fontWeight: '900', textTransform: 'uppercase' }}>{v[1]}</Text>
          <Text style={{ color: C.ink, marginTop: 4, fontSize: 15 }}>{p.roast_opt_in ? v[2] : v[3]}</Text>
        </View> : null}
        <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: C.line, gap: 12 }}>
          {LIFTS.map(l => (
            <View key={l.k} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ width: 70, color: C.ink, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>{l.n}</Text>
              <PctBar pct={row.p[l.k] || 0} color={colorOf(l.db)} />
              <Mono style={{ width: 62, textAlign: 'right', fontSize: 14 }}>{row[l.k] ? fmt(row[l.k]) : 'n/a'}</Mono>
              <Mono style={{ width: 36, textAlign: 'right', fontSize: 12, color: C.muted }}>{row.p[l.k] || 0}%</Mono>
            </View>
          ))}
          <Muted style={{ fontSize: 12 }}>The line is the median for {row.age ? `age ${row.age}` : 'their age'} at {row.bw || 185} lb.</Muted>
        </View>
      </Card>

      {isBlocked ? <Card accent={C.down}><Muted style={{ fontSize: 14 }}>You blocked this lifter. Their messages are hidden from you.</Muted></Card> : null}

      {goals.length ? <>
        <Eyebrow style={{ marginTop: 10, marginBottom: 8 }}>Goals</Eyebrow>
        {goals.map(g => {
          const now = bestOf[g.lift] || 0, t = Number(g.target_lb), pc = Math.min(100, Math.round((now / t) * 100));
          return (
            <Card key={g.lift} accent={colorOf(g.lift)}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: C.ink, fontWeight: '700', fontSize: 16 }}>{liftName(g.lift)}</Text>
                <Mono style={{ fontSize: 16 }}>{fmt(t)} lb</Mono>
              </View>
              <View style={{ flexDirection: 'row', marginVertical: 8 }}><PctBar pct={pc} color={colorOf(g.lift)} /></View>
              <Muted>{now ? `${fmt(now)} now · ${t > now ? fmt(t - now) + ' to go' : 'done'}` : 'No lift yet'}{g.target_date ? ` · by ${fmtD(g.target_date)}` : ''}</Muted>
            </Card>
          );
        })}
      </> : null}

      {others.length ? <>
        <Eyebrow style={{ marginTop: 10, marginBottom: 8 }}>Other lifts</Eyebrow>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
          {others.map(([l, w]) => (
            <View key={l} style={{ backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10, minWidth: '47%', flexGrow: 1 }}>
              <Muted style={{ fontSize: 12 }}>{liftName(l)}</Muted><Mono style={{ fontSize: 20 }}>{fmt(w)} lb</Mono>
            </View>
          ))}
        </View>
      </> : null}

      <Eyebrow style={{ marginTop: 10, marginBottom: 8 }}>Lift history</Eyebrow>
      {hist.length === 0 ? <Card><Muted>No lifts yet.</Muted></Card> : (
        <Group>
          {hist.map((e, i) => (
            <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, opacity: e.status === 'struck' ? 0.45 : 1 }}>
              <View style={{ width: 4, alignSelf: 'stretch', backgroundColor: colorOf(e.lift), borderRadius: 2, marginRight: 10 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.ink, fontWeight: '600', fontSize: 15 }}>{liftName(e.lift)}{e.is_pr ? <Text style={{ color: C.accent, fontSize: 12 }}>  PR</Text> : null}{e.status === 'protested' ? <Text style={{ color: C.flat, fontSize: 12 }}>  Under protest</Text> : e.status === 'struck' ? <Text style={{ color: C.down, fontSize: 12 }}>  Struck</Text> : null}</Text>
                <Muted style={{ fontSize: 12 }}>{fmtD(e.performed_on)}{e.source === 'workout' ? ' · from workout' : e.source === 'import' ? ' · imported' : ''}{e.note ? ` · ${e.note}` : ''}</Muted>
              </View>
              {e.video_path ? <Pressable onPress={() => router.push({ pathname: '/video', params: { path: e.video_path! } })} hitSlop={8} accessibilityLabel="Play video" style={{ marginRight: 12 }}><Text style={{ color: C.accent, fontSize: 20 }}>▶</Text></Pressable> : null}
              <Mono style={{ fontSize: 18 }}>{fmt(e.weight_lb)}</Mono>
              {mine && e.status === 'ok' ? <Pressable onPress={() => delEntry(e)} hitSlop={8} accessibilityLabel="Delete lift" style={{ marginLeft: 12 }}><Text style={{ color: C.muted, fontSize: 18 }}>✕</Text></Pressable> : null}
              {!mine && me && e.status === 'ok' ? <Pressable onPress={() => protest(e)} hitSlop={8} accessibilityLabel="Protest lift" style={{ marginLeft: 12 }}><Text style={{ color: C.flat, fontSize: 13, fontWeight: '700' }}>PROTEST</Text></Pressable> : null}
            </View>
          ))}
        </Group>
      )}
      {mine ? <Btn ghost label="Edit profile" onPress={() => router.push('/profile')} style={{ marginTop: 6 }} /> : null}
    </Screen>
  );

  function protest(e: Entry) {
    router.push({ pathname: '/report', params: { type: 'protest_lift', id: e.id, name: `${p.display_name} ${liftName(e.lift)} ${fmt(e.weight_lb)} lb` } });
  }
}

