import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Btn, Card, Eyebrow, Group, Loading, Muted, Row, s, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { timeAgo } from '@/lib/data';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

export default function Chat() {
  const { me, isPro } = useSession();
  const [rooms, setRooms] = useState<any[] | null>(null);
  const [groups, setGroups] = useState<any[]>([]);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [last, setLast] = useState<Record<string, any>>({});
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!me) return;
    const [r, g, gm] = await Promise.all([
      sb.from('chat_rooms').select('*').order('created_at', { ascending: false }).limit(200),
      sb.from('groups').select('*').order('kind').order('name'),
      sb.from('group_members').select('group_id').eq('profile_id', me.id),
    ]);
    const list = r.data ?? [];
    setRooms(list); setGroups(g.data ?? []); setMine(new Set((gm.data ?? []).map((x: any) => x.group_id)));
    // Latest message per room for previews
    const ids = list.map((x: any) => x.id);
    if (ids.length) {
      const { data } = await sb.from('messages').select('room_id,body,created_at,deleted').in('room_id', ids).order('created_at', { ascending: false }).limit(300);
      const m: Record<string, any> = {};
      (data ?? []).forEach((x: any) => { if (!m[x.room_id]) m[x.room_id] = x; });
      setLast(m);
    }
  }, [me]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!me) return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <View style={s.pad}>
        <Title eyebrow="Talk it out">Chat</Title>
        <Card><Muted style={{ fontSize: 15 }}>Sign in to chat with your division and crew.</Muted></Card>
        <Btn label="Sign in" onPress={() => router.push('/login')} />
      </View>
    </SafeAreaView>
  );

  const groupRooms = (rooms ?? []).filter(r => r.kind === 'group');
  const threads = (rooms ?? []).filter(r => r.kind !== 'group').sort((a, b) => (last[b.id]?.created_at ?? b.created_at).localeCompare(last[a.id]?.created_at ?? a.created_at)).slice(0, 30);
  const gById = new Map(groups.map(g => [g.id, g]));
  const locked = groups.filter(g => !groupRooms.some(r => r.group_id === g.id));
  const joinable = locked.filter(g => g.is_open && !mine.has(g.id) && g.kind === 'custom' && (g.min_tier === 'free' || isPro));
  const proLocked = locked.filter(g => g.min_tier !== 'free' && !isPro);

  async function join(gid: string, name: string) {
    const { error } = await sb.from('group_members').insert({ group_id: gid, profile_id: me!.id });
    if (error) Alert.alert('Could not join', error.message); else { load(); Alert.alert('Joined', `You're in ${name}.`); }
  }
  const preview = (id: string) => { const m = last[id]; return m ? `${m.deleted ? 'Message removed' : m.body.slice(0, 40)} · ${timeAgo(m.created_at)}` : 'No messages yet'; };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={s.pad} refreshControl={<RefreshControl tintColor={C.accent} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        <Title eyebrow="Talk it out">Chat</Title>
        {!rooms ? <Loading /> : <>
          <Group title="Groups">
            {groupRooms.length ? groupRooms.map((r, i) => (
              <Row key={r.id} first={i === 0} label={r.title} detail={preview(r.id)} pro={(gById.get(r.group_id)?.min_tier ?? 'free') !== 'free'}
                onPress={() => router.push({ pathname: '/room/[id]', params: { id: r.id, title: r.title } })} />
            )) : <View style={{ padding: 14 }}><Muted>No groups yet.</Muted></View>}
          </Group>
          {joinable.length ? <Group title="Open to join">
            {joinable.map((g, i) => <Row key={g.id} first={i === 0} label={g.name} detail="Join" onPress={() => join(g.id, g.name)} />)}
          </Group> : null}
          {proLocked.length ? <Group title="Pro groups">
            {proLocked.map((g, i) => <Row key={g.id} first={i === 0} label={g.name} pro onPress={() => router.push('/pro')} />)}
          </Group> : null}
          <Group title="Threads">
            {threads.length ? threads.map((r, i) => (
              <Row key={r.id} first={i === 0} label={r.title} detail={preview(r.id)} onPress={() => router.push({ pathname: '/room/[id]', params: { id: r.id, title: r.title } })} />
            )) : <View style={{ padding: 14 }}><Muted style={{ fontSize: 14 }}>Tap Talk on any PR or workout day to start a thread.</Muted></View>}
          </Group>
          <Eyebrow style={{ textAlign: 'center' }}>Long press a message to report or block</Eyebrow>
        </>}
      </ScrollView>
    </SafeAreaView>
  );
}

