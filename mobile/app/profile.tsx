import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Switch, Text, TextInput, View } from 'react-native';

import { Btn, Chip, Eyebrow, Muted, s, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

export default function ProfileEdit() {
  const { me, reloadMe } = useSession();
  const { first } = useLocalSearchParams<{ first?: string }>();
  const yr = new Date().getFullYear();
  const [name, setName] = useState(me?.display_name ?? '');
  const [by, setBy] = useState(me?.birth_year ? String(me.birth_year) : '');
  const [bw, setBw] = useState(me?.bodyweight ? String(me.bodyweight) : '');
  const [sex, setSex] = useState(me?.sex ?? 'male');
  const [div, setDiv] = useState(me?.division ?? 'men');
  const [roast, setRoast] = useState(!!me?.roast_opt_in);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  if (!me) return <Screen stack><Muted>Sign in first.</Muted></Screen>;

  async function save() {
    const n = name.trim(), b = Number(by), w = Number(bw);
    if (n.length < 2) return setMsg('Pick a board name, at least 2 characters.');
    if (!(b >= yr - 100 && b <= yr - 13)) return setMsg('Enter a real birth year. DSI is for lifters 13 and up.');
    if (!(w >= 80 && w <= 450)) return setMsg('Bodyweight should be between 80 and 450 lb.');
    setBusy(true); setMsg('Saving…');
    const { error } = await sb.from('profiles').update({ display_name: n, birth_year: b, bodyweight: w, sex, division: div, roast_opt_in: roast }).eq('id', me!.id);
    setBusy(false);
    if (error) return setMsg(error.code === '23505' ? 'That name is taken. Try another.' : error.message);
    await reloadMe();
    if (first) router.replace('/terms'); else { setMsg('Saved.'); router.back(); }
  }

  const field = (label: string, el: React.ReactNode) => (<View style={{ marginBottom: 14 }}><Eyebrow style={{ marginBottom: 6 }}>{label}</Eyebrow>{el}</View>);
  return (
    <Screen stack>
      <Title eyebrow={first ? 'Welcome to the index' : 'Your account'} accent="profile">{first ? 'Set up your' : 'Edit'}</Title>
      {first ? <Muted style={{ fontSize: 15, marginBottom: 14 }}>Your board name shows on the leaderboard. Age and bodyweight make the score fair.</Muted> : null}
      {field('Board name', <TextInput value={name} onChangeText={setName} maxLength={24} autoCapitalize="words" style={s.input} placeholder="Dandy" placeholderTextColor="#5A6478" accessibilityLabel="Board name" />)}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>{field('Birth year', <TextInput value={by} onChangeText={v => setBy(v.replace(/[^0-9]/g, ''))} maxLength={4} keyboardType="number-pad" style={s.input} placeholder="1980" placeholderTextColor="#5A6478" accessibilityLabel="Birth year" />)}</View>
        <View style={{ flex: 1 }}>{field('Bodyweight lb', <TextInput value={bw} onChangeText={v => setBw(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" style={s.input} placeholder="200" placeholderTextColor="#5A6478" accessibilityLabel="Bodyweight in pounds" />)}</View>
      </View>
      {field('Sex', <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{[['male', 'Male'], ['female', 'Female'], ['unspecified', 'Prefer not to say']].map(([k, l]) => <Chip key={k} label={l} on={sex === k} onPress={() => { setSex(k); if (k === 'female' && div === 'men') setDiv('women'); }} />)}</View>)}
      {field('Division', <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{[['men', 'Men'], ['women', 'Women'], ['open', 'Open']].map(([k, l]) => <Chip key={k} label={l} on={div === k} onPress={() => setDiv(k)} />)}</View>)}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.panel, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 14, marginBottom: 16 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.ink, fontWeight: '700', fontSize: 16 }}>Roast me 🔥</Text>
          <Muted style={{ fontSize: 14 }}>Show the savage verdict on your card and let people know you can take it.</Muted>
        </View>
        <Switch value={roast} onValueChange={setRoast} trackColor={{ true: C.accent, false: C.line }} thumbColor={C.ink} accessibilityLabel="Roast me" />
      </View>
      <Btn label={first ? 'Join the board' : 'Save'} onPress={save} disabled={busy} />
      {msg ? <Muted style={{ marginTop: 12, textAlign: 'center', fontSize: 14, color: msg === 'Saved.' || msg === 'Saving…' ? C.muted : C.down }}>{msg}</Muted> : null}
    </Screen>
  );
}
