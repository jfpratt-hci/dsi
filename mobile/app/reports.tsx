import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { Btn, Card, Eyebrow, Loading, Muted, Screen } from '@/components/ui';
import { C } from '@/constants/Colors';
import { timeAgo } from '@/lib/data';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

// Staff only: review reports, remove content, dismiss.
export default function Reports() {
  const { me, isStaff } = useSession();
  const [list, setList] = useState<any[] | null>(null);
  const [ctx, setCtx] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [{ data }, { data: people }] = await Promise.all([
      sb.from('reports').select('*').order('created_at', { ascending: false }).limit(100),
      sb.from('profiles').select('id,display_name'),
    ]);
    const all = data ?? [];
    setNames(Object.fromEntries((people ?? []).map((p: any) => [p.id, p.display_name || 'Someone'])));
    const msgIds = all.filter(r => r.target_type === 'message').map(r => r.target_id);
    if (msgIds.length) {
      const { data: m } = await sb.from('messages').select('id,body,profile_id,deleted').in('id', msgIds);
      setCtx(Object.fromEntries((m ?? []).map((x: any) => [x.id, `${x.deleted ? '[removed] ' : ''}“${x.body}”`])));
    }
    setList(all);
  }, []);
  useFocusEffect(useCallback(() => { if (isStaff) load(); }, [load, isStaff]));

  if (!isStaff) return <Screen stack><Muted>Staff only.</Muted></Screen>;
  if (!list) return <Screen stack><Loading /></Screen>;

  async function handle(r: any, status: 'actioned' | 'dismissed') {
    if (status === 'actioned' && r.target_type === 'message') await sb.from('messages').update({ deleted: true }).eq('id', r.target_id);
    if (status === 'actioned' && r.target_type === 'lift_entry') await sb.from('lift_entries').update({ status: 'struck' }).eq('id', r.target_id);
    const { error } = await sb.from('reports').update({ status, handled_by: me!.id, handled_at: new Date().toISOString() }).eq('id', r.id);
    if (error) Alert.alert('Could not update', error.message); else load();
  }

  const open = list.filter(r => r.status === 'open');
  return (
    <Screen stack>
      <Eyebrow style={{ marginBottom: 8, color: C.accent }}>Open · respond within 24 hours</Eyebrow>
      {open.length === 0 ? <Card><Muted>No open reports.</Muted></Card> : open.map(r => (
        <Card key={r.id} accent={C.down}>
          <Muted style={{ fontSize: 12 }}>{r.target_type} · {timeAgo(r.created_at)} · by {names[r.reporter] ?? 'someone'}</Muted>
          <Text style={{ color: C.ink, fontWeight: '700', fontSize: 16, marginTop: 4 }}>{r.reason}</Text>
          {ctx[r.target_id] ? <Text style={{ color: C.muted, marginTop: 6 }}>{ctx[r.target_id]}</Text> : null}
          {r.target_type === 'profile' ? <Text style={{ color: C.accent, marginTop: 6 }} onPress={() => router.push({ pathname: '/lifter/[id]', params: { id: r.target_id } })}>Open {names[r.target_id] ?? 'lifter'}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <Btn label={r.target_type === 'message' ? 'Remove it' : r.target_type === 'lift_entry' ? 'Strike it' : 'Actioned'} onPress={() => handle(r, 'actioned')} style={{ flex: 1, backgroundColor: C.down }} />
            <Btn ghost label="Dismiss" onPress={() => handle(r, 'dismissed')} style={{ flex: 1 }} />
          </View>
        </Card>
      ))}
      <Eyebrow style={{ marginVertical: 8 }}>Handled</Eyebrow>
      {list.filter(r => r.status !== 'open').slice(0, 30).map(r => (
        <Card key={r.id}><Muted style={{ fontSize: 13 }}>{r.status} · {r.target_type} · {r.reason}</Muted></Card>
      ))}
    </Screen>
  );
}
