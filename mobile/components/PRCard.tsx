import { router } from 'expo-router';
import { Alert, Pressable, Text, View } from 'react-native';

import { Card, Mono, Muted } from '@/components/ui';
import { C } from '@/constants/Colors';
import { colorOf, fmt, fmtD, isNew, liftName, type PR } from '@/lib/data';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

export function PRCard({ p, onChange }: { p: PR; onChange?: () => void }) {
  const { me } = useSession();
  const hot = isNew(p.performed_on), gain = p.prev_best ? Number(p.weight_lb) - Number(p.prev_best) : 0;
  const mine = me?.id === p.profile_id;
  async function talk() {
    if (!me) { router.push('/login'); return; }
    const { data, error } = await sb.rpc('room_for', { p_kind: 'pr', p_ref: p.id, p_title: `${p.name} ${liftName(p.lift)} ${Number(p.weight_lb)}` });
    if (error) { Alert.alert('Could not open thread', error.message); return; }
    router.push({ pathname: '/room/[id]', params: { id: data, title: `${p.name} ${liftName(p.lift)}` } });
  }
  return (
    <Card style={{ borderTopWidth: 4, borderTopColor: colorOf(p.lift), backgroundColor: hot ? '#1E1D17' : C.panel, borderColor: hot ? C.accent : C.line }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ backgroundColor: hot ? C.accent : C.line, color: hot ? '#141414' : C.ink, fontSize: 10, fontWeight: '800', letterSpacing: 1.4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3, overflow: 'hidden' }}>{hot ? 'NEW PR' : 'PR'}</Text>
        <Muted>{fmtD(p.performed_on)}</Muted>
      </View>
      <Pressable onPress={() => router.push({ pathname: '/lifter/[id]', params: { id: p.profile_id } })}>
        <Text style={{ color: C.ink, fontSize: 28, fontWeight: '900', textTransform: 'uppercase', marginTop: 6 }}>{p.name}</Text>
      </Pressable>
      <Text style={{ color: C.muted, fontSize: 15 }}>{liftName(p.lift)} <Mono style={{ fontSize: 17 }}>{fmt(p.weight_lb)} lb</Mono>{p.status === 'protested' ? <Text style={{ color: C.flat }}>  Under protest</Text> : null}</Text>
      {gain > 0 ? <Mono style={{ color: C.up, fontSize: 24, marginTop: 4 }}>+{fmt(gain)} lb</Mono> : null}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <Pressable onPress={talk} style={pill}><Text style={pillT}>TALK</Text></Pressable>
        {!mine && me && p.status === 'ok' ? <Pressable onPress={() => router.push({ pathname: '/report', params: { type: 'protest_lift', id: p.id, name: `${p.name} ${liftName(p.lift)} ${fmt(p.weight_lb)} lb` } })} style={pill}><Text style={pillT}>PROTEST</Text></Pressable> : null}
      </View>
    </Card>
  );
}
const pill = { borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 };
const pillT = { color: C.ink, fontWeight: '700' as const, fontSize: 12, letterSpacing: 1 };

