import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { Btn, Card, Eyebrow, Mono, Muted, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { loadBoard, verdict, type BoardRow } from '@/lib/data';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

export default function Me() {
  const { me, session } = useSession();
  const [row, setRow] = useState<BoardRow | null>(null);

  useFocusEffect(useCallback(() => {
    if (!me) return;
    loadBoard().then(b => setRow(b.find(x => x.profile_id === me.id) ?? null));
  }, [me]));

  if (!session) return (
    <Screen>
      <Title>Me</Title>
      <Card><Muted>Sign in with the same email you use on dandystrength.com. Your numbers come with you.</Muted></Card>
      <Btn label="Sign in" onPress={() => router.push('/login')} />
    </Screen>
  );

  const v = row ? verdict(row.score) : null;
  return (
    <Screen>
      <Title eyebrow={`${me?.division ?? ''} · ${me?.role === 'admin' ? 'Founder' : me?.role === 'commissioner' ? 'Commissioner' : 'Member'}`}>{me?.display_name ?? 'Set up your profile'}</Title>
      {row ? (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View><Eyebrow>DSI™</Eyebrow><Mono style={{ fontSize: 40 }}>{row.score}</Mono></View>
            <View style={{ alignItems: 'flex-end' }}><Eyebrow>Total</Eyebrow><Mono style={{ fontSize: 40 }}>{row.total}</Mono></View>
          </View>
          {v ? <Text style={{ color: C.accent, fontWeight: '900', fontSize: 20, textTransform: 'uppercase', marginTop: 10 }}>{v[1]}</Text> : null}
          {v ? <Text style={{ color: C.ink, marginTop: 4 }}>{me?.roast_opt_in ? v[2] : v[3]}</Text> : null}
        </Card>
      ) : null}
      <Card>
        <Muted>{session.user.email}</Muted>
        <Muted>Edit your profile, goals and membership on dandystrength.com for now. Those screens come to the app next.</Muted>
      </Card>
      <Btn ghost label="Sign out" onPress={() => sb.auth.signOut()} />
    </Screen>
  );
}
