import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { Btn, Card, Group, Loading, Muted, Screen } from '@/components/ui';
import { C } from '@/constants/Colors';
import { unblock } from '@/lib/data';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

export default function Blocked() {
  const { me, blocked, reloadBlocks } = useSession();
  const [people, setPeople] = useState<any[] | null>(null);
  const load = useCallback(async () => {
    const ids = [...blocked];
    if (!ids.length) { setPeople([]); return; }
    const { data } = await sb.from('profiles').select('id,display_name').in('id', ids);
    setPeople(data ?? []);
  }, [blocked]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!people) return <Screen stack><Loading /></Screen>;
  return (
    <Screen stack>
      {people.length === 0 ? <Card><Muted style={{ fontSize: 15 }}>You have not blocked anyone. Long press a message to block its sender.</Muted></Card> : (
        <Group>
          {people.map((p, i) => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
              <Text style={{ color: C.ink, fontSize: 16, fontWeight: '600', flex: 1 }}>{p.display_name || 'Someone'}</Text>
              <Btn ghost label="Unblock" onPress={async () => { await unblock(me!.id, p.id); await reloadBlocks(); }} style={{ height: 40 }} />
            </View>
          ))}
        </Group>
      )}
    </Screen>
  );
}
