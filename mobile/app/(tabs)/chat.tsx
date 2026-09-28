import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';

import { Btn, Card, Eyebrow, Loading, Muted, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

export default function Chat() {
  const { me } = useSession();
  const [rooms, setRooms] = useState<any[] | null>(null);

  useFocusEffect(useCallback(() => {
    if (!me) return;
    sb.from('chat_rooms').select('*').order('created_at', { ascending: false }).then(({ data }) => setRooms(data ?? []));
  }, [me]));

  if (!me) return (
    <Screen>
      <Title>Chat</Title>
      <Card><Muted>Sign in to chat with your division and crew.</Muted></Card>
      <Btn label="Sign in" onPress={() => router.push('/login')} />
    </Screen>
  );

  return (
    <Screen>
      <Title eyebrow="Talk it out">Chat</Title>
      <Eyebrow style={{ marginBottom: 8 }}>Your rooms</Eyebrow>
      {!rooms ? <Loading /> : rooms.map(r => (
        <Card key={r.id}>
          <Text style={{ color: C.ink, fontWeight: '700', fontSize: 16 }}>{r.title}</Text>
          <Muted>{r.kind === 'group' ? 'Group room' : `${r.kind} thread`}</Muted>
        </Card>
      ))}
      <Muted style={{ marginTop: 8 }}>Live messages in the app are the next build step. Chat works today on dandystrength.com.</Muted>
    </Screen>
  );
}
