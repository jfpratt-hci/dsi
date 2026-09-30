// 4.5 New group: Pro members start their own group chat.
import { router } from 'expo-router';
import { useState } from 'react';
import { Switch, Text, TextInput, View } from 'react-native';

import { Btn, Card, Eyebrow, Muted, s, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

export default function NewGroup() {
  const { isPro } = useSession();
  const [name, setName] = useState('');
  const [open, setOpen] = useState(true);
  const [proOnly, setProOnly] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  if (!isPro) return (
    <Screen stack>
      <Title accent="group">New</Title>
      <Card><Muted style={{ fontSize: 15 }}>Starting your own group is part of DSI Pro. Every member can still chat in their division room.</Muted></Card>
      <Btn label="See DSI Pro" onPress={() => router.replace('/pro')} />
    </Screen>
  );

  async function create() {
    setBusy(true); setMsg('');
    const { data: gid, error } = await sb.rpc('create_group', { p_name: name, p_open: open, p_pro_only: proOnly });
    if (error) { setBusy(false); setMsg(error.message); return; }
    const { data: room } = await sb.from('chat_rooms').select('id').eq('kind', 'group').eq('group_id', gid).maybeSingle();
    setBusy(false);
    if (room) router.replace({ pathname: '/room/[id]', params: { id: room.id, title: name.trim() } });
    else router.back();
  }
  const opt = (label: string, sub: string, v: boolean, set: (b: boolean) => void) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.panel, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 14, marginBottom: 10 }}>
      <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700', fontSize: 16 }}>{label}</Text><Muted style={{ fontSize: 13 }}>{sub}</Muted></View>
      <Switch value={v} onValueChange={set} trackColor={{ true: C.accent, false: C.line }} thumbColor={C.ink} accessibilityLabel={label} />
    </View>
  );
  return (
    <Screen stack>
      <Title accent="group">New</Title>
      <Eyebrow style={{ marginBottom: 6 }}>Group name</Eyebrow>
      <TextInput value={name} onChangeText={setName} maxLength={40} placeholder="Masters 50+, 5am crew, Symmetry Barbell" placeholderTextColor="#5A6478" style={[s.input, { marginBottom: 14 }]} accessibilityLabel="Group name" />
      {opt('Open to join', 'Anyone can find it in Chat and join', open, setOpen)}
      {opt('Pro members only', 'Only DSI Pro members can join', proOnly, setProOnly)}
      <Btn label="Create group" onPress={create} disabled={busy || name.trim().length < 3} />
      {msg ? <Muted style={{ marginTop: 10, color: C.down, textAlign: 'center' }}>{msg}</Muted> : null}
    </Screen>
  );
}
