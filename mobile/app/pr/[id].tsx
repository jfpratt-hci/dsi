// 2.5 PR detail and 3.7 New PR (celebrate=1): the lift, the gain, video proof, share, talk and protest.
import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Share, Text, View } from 'react-native';

import { Btn, Card, Eyebrow, Loading, Mono, Muted, Screen } from '@/components/ui';
import { C } from '@/constants/Colors';
import { colorOf, fmt, fmtD, liftName, loadBoard, type BoardRow } from '@/lib/data';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';
import { addVideo } from '@/lib/video';

type Entry = { id: string; profile_id: string; lift: string; weight_lb: number; prev_best: number | null; performed_on: string; status: string; is_pr: boolean; video_path: string | null };

export default function PRDetail() {
  const { id, celebrate } = useLocalSearchParams<{ id: string; celebrate?: string }>();
  const { me } = useSession();
  const [e, setE] = useState<Entry | null>(null);
  const [row, setRow] = useState<BoardRow | null>(null);
  const [name, setName] = useState('');
  const [msgs, setMsgs] = useState<{ body: string; who: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const fresh = celebrate === '1';

  const load = useCallback(async () => {
    const { data } = await sb.from('lift_entries').select('*').eq('id', id).maybeSingle();
    if (!data) return;
    setE(data as Entry);
    const [board, prof, room] = await Promise.all([
      loadBoard(),
      sb.from('profiles').select('display_name').eq('id', data.profile_id).maybeSingle(),
      sb.from('chat_rooms').select('id').eq('kind', 'pr').eq('ref_id', id).maybeSingle(),
    ]);
    setRow(board.find(b => b.profile_id === data.profile_id) ?? null);
    setName(prof.data?.display_name ?? 'Lifter');
    if (room.data?.id) {
      const { data: m } = await sb.from('messages').select('body,profile_id,deleted').eq('room_id', room.data.id).order('created_at', { ascending: false }).limit(3);
      const ids = [...new Set((m ?? []).map((x: any) => x.profile_id))];
      const { data: ps } = ids.length ? await sb.from('profiles').select('id,display_name').in('id', ids) : { data: [] as any[] };
      const nm = Object.fromEntries((ps ?? []).map((p: any) => [p.id, p.display_name]));
      setMsgs((m ?? []).filter((x: any) => !x.deleted).map((x: any) => ({ body: x.body, who: nm[x.profile_id] ?? 'Someone' })));
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (fresh) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); }, [fresh]);

  if (!e) return <Screen stack><Loading /></Screen>;
  const mine = me?.id === e.profile_id;
  const gain = e.prev_best ? Number(e.weight_lb) - Number(e.prev_best) : 0;
  const col = colorOf(e.lift);
  const g = row?.g;

  async function video(src: 'camera' | 'library') {
    if (!me || !e) return;
    setBusy(true);
    const path = await addVideo(e.id, me.id, src);
    setBusy(false);
    if (path) setE({ ...e, video_path: path });
  }
  async function share() {
    if (!e) return;
    const line = `${mine ? 'New PR' : name + ' hit a PR'}: ${liftName(e.lift)} ${fmt(e.weight_lb)} lb${gain ? `, up ${fmt(gain)}` : ''}.${row ? ` DSI ${row.score}.` : ''}`;
    await Share.share({ message: `${line} See the board: https://dandystrength.com/u/${e.profile_id}` }).catch(() => {});
  }
  async function talk() {
    if (!me || !e) { router.push('/login'); return; }
    const t = `${name} ${liftName(e.lift)} ${Number(e.weight_lb)}`;
    const { data, error } = await sb.rpc('room_for', { p_kind: 'pr', p_ref: e.id, p_title: t });
    if (error) { Alert.alert('Could not open thread', error.message); return; }
    router.push({ pathname: '/room/[id]', params: { id: data, title: t } });
  }

  return (
    <Screen stack>
      <Stack.Screen options={{ title: fresh ? '' : 'PR', headerBackVisible: !fresh }} />
      <View style={{ alignItems: 'center', paddingVertical: fresh ? 18 : 6 }}>
        <Text style={{ backgroundColor: C.accent, color: '#141414', fontWeight: '900', fontSize: 12, letterSpacing: 2, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, overflow: 'hidden' }}>{fresh ? 'NEW PR' : e.is_pr ? 'PR' : 'LIFT'}</Text>
        <Text style={{ color: C.ink, fontSize: 30, fontWeight: '900', textTransform: 'uppercase', marginTop: 10 }}>{name}</Text>
        <Eyebrow style={{ color: col, marginTop: 4 }}>{liftName(e.lift)} · {fmtD(e.performed_on)}</Eyebrow>
        <Mono style={{ fontSize: fresh ? 88 : 64, color: C.ink, marginTop: 4 }}>{fmt(e.weight_lb)}</Mono>
        <Muted>pounds</Muted>
        {gain > 0 ? <Mono style={{ color: C.up, fontSize: 30, marginTop: 8 }}>▲ {fmt(gain)} lb</Mono> : null}
        {e.prev_best ? <Muted>was {fmt(e.prev_best)}</Muted> : null}
        {e.status === 'protested' ? <Text style={{ color: C.flat, marginTop: 6, fontWeight: '700' }}>Under protest</Text> : null}
      </View>

      {row ? (
        <Card style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
          <View style={{ alignItems: 'center' }}><Eyebrow>DSI</Eyebrow><Mono style={{ fontSize: 28 }}>{row.score}</Mono>{g?.score ? <Text style={{ color: C.up, fontWeight: '700' }}>▲{g.score}</Text> : null}</View>
          <View style={{ alignItems: 'center' }}><Eyebrow>Total</Eyebrow><Mono style={{ fontSize: 28 }}>{fmt(row.total)}</Mono>{g?.total ? <Text style={{ color: C.up, fontWeight: '700' }}>▲{fmt(g.total)}</Text> : null}</View>
        </Card>
      ) : null}

      {e.video_path ? <Btn label="▶ Watch the lift" onPress={() => router.push({ pathname: '/video', params: { path: e.video_path! } })} />
        : mine ? (<>
          <Eyebrow style={{ marginBottom: 6, marginTop: 4 }}>Add proof (free on every PR)</Eyebrow>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
            <Btn label="Record video" onPress={() => video('camera')} disabled={busy} style={{ flex: 1 }} />
            <Btn ghost label="Pick video" onPress={() => video('library')} disabled={busy} style={{ flex: 1 }} />
          </View>
        </>) : null}

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <Btn ghost label="Share" onPress={share} style={{ flex: 1 }} />
        <Btn ghost label="Talk" onPress={talk} style={{ flex: 1 }} />
        {!mine && me && e.status === 'ok' && e.is_pr ? <Btn ghost label="Protest" onPress={() => router.push({ pathname: '/report', params: { type: 'protest_lift', id: e.id, name: `${name} ${liftName(e.lift)} ${fmt(e.weight_lb)} lb` } })} style={{ flex: 1 }} /> : null}
      </View>

      {msgs.length ? (
        <Card style={{ marginTop: 14 }}>
          <Eyebrow style={{ marginBottom: 6 }}>Latest in the thread</Eyebrow>
          {msgs.map((m, i) => <Text key={i} style={{ color: C.ink, marginBottom: 4 }}><Text style={{ fontWeight: '700' }}>{m.who}:</Text> {m.body}</Text>)}
        </Card>
      ) : null}
      {fresh ? <Btn label="Done" onPress={() => router.back()} style={{ marginTop: 16 }} /> : null}
    </Screen>
  );
}
