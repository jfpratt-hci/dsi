import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Switch, Text, TextInput, View } from 'react-native';

import { Btn, Chip, Eyebrow, Muted, s, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';
import { colorOf, fmt, LIFTS, pcts, score, today, total, verdict } from '@/lib/data';

export default function ProfileEdit() {
  const { me, reloadMe, isPro } = useSession();
  const { first } = useLocalSearchParams<{ first?: string }>();
  const yr = new Date().getFullYear();
  const [name, setName] = useState(me?.display_name ?? '');
  const [by, setBy] = useState(me?.birth_year ? String(me.birth_year) : '');
  const [bw, setBw] = useState(me?.bodyweight ? String(me.bodyweight) : '');
  const [sex, setSex] = useState(me?.sex ?? 'male');
  const [div, setDiv] = useState(me?.division ?? 'men');
  const [roast, setRoast] = useState(!!me?.roast_opt_in);
  const [lifts, setLifts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  if (!me) return <Screen stack><Muted>Sign in first.</Muted></Screen>;

  async function save() {
    const n = name.trim(), b = Number(by), w = Number(bw);
    if (n.length < 2) return setMsg('Pick a board name, at least 2 characters.');
    if (!(b >= yr - 100 && b <= yr - 13)) return setMsg('Enter a real birth year. DSI is for lifters 13 and up.');
    if (!(w >= 80 && w <= 450)) return setMsg('Bodyweight should be between 80 and 450 lb.');
    const rows = first ? LIFTS.filter(l => Number(lifts[l.k]) > 0).map(l => ({ profile_id: me!.id, lift: l.db, weight_lb: Number(lifts[l.k]), performed_on: today(), source: 'manual', note: 'Signup' })) : [];
    if (first && !rows.length) return setMsg('Enter at least one of your four lifts.');
    if (rows.some(r => r.weight_lb > 1499)) return setMsg('Check your numbers. 1,499 lb is the max.');
    setBusy(true); setMsg('Saving…');
    const { error } = await sb.from('profiles').update({ display_name: n, birth_year: b, bodyweight: w, sex, division: div, roast_opt_in: roast }).eq('id', me!.id);
    if (error) { setBusy(false); return setMsg(error.code === '23505' ? 'That name is taken. Try another.' : error.message); }
    if (rows.length) { const r = await sb.from('lift_entries').insert(rows); if (r.error) console.warn(r.error.message); }
    setBusy(false);
    await reloadMe();
    if (first) router.replace('/terms'); else { setMsg('Saved.'); router.back(); }
  }

  const field = (label: string, el: React.ReactNode) => (<View style={{ marginBottom: 14 }}><Eyebrow style={{ marginBottom: 6 }}>{label}</Eyebrow>{el}</View>);
  return (
    <Screen stack>
      <Title eyebrow={first ? 'Welcome to the index' : 'Your account'} accent="profile">{first ? 'Set up your' : 'Edit'}</Title>
      {first ? <Muted style={{ fontSize: 15, marginBottom: 14 }}>Your board name shows on the leaderboard. Age and bodyweight make the score fair. Then enter your four lifts and see your DSI™.</Muted> : null}
      {field('Board name', <TextInput value={name} onChangeText={setName} maxLength={24} autoCapitalize="words" style={s.input} accessibilityLabel="Board name" />)}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>{field('Birth year', <TextInput value={by} onChangeText={v => setBy(v.replace(/[^0-9]/g, ''))} maxLength={4} keyboardType="number-pad" style={s.input} accessibilityLabel="Birth year" />)}</View>
        <View style={{ flex: 1 }}>{field('Bodyweight lb', <TextInput value={bw} onChangeText={v => setBw(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" style={s.input} accessibilityLabel="Bodyweight in pounds" />)}</View>
      </View>
      {field('Sex', <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{[['male', 'Male'], ['female', 'Female'], ['unspecified', 'Prefer not to say']].map(([k, l]) => <Chip key={k} label={l} on={sex === k} onPress={() => { setSex(k); if (k === 'female' && div === 'men') setDiv('women'); }} />)}</View>)}
      {field('Division', <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{[['men', 'Men'], ['women', 'Women'], ['open', 'Open']].map(([k, l]) => <Chip key={k} label={l} on={div === k} onPress={() => setDiv(k)} />)}</View>)}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.panel, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 14, marginBottom: 16 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.ink, fontWeight: '700', fontSize: 16 }}>Roast me 🔥{isPro ? '' : '  · Pro'}</Text>
          <Muted style={{ fontSize: 14 }}>Show the savage verdict on your card and let people know you can take it.</Muted>
        </View>
        <Switch value={roast} onValueChange={v => (v && !isPro ? router.push('/pro') : setRoast(v))} trackColor={{ true: C.accent, false: C.line }} thumbColor={C.ink} accessibilityLabel="Roast me" />
      </View>
      {first ? <LiftsBlock lifts={lifts} setLifts={setLifts} by={Number(by)} bw={Number(bw)} yr={yr} /> : null}
      <Btn label={first ? 'Join the board' : 'Save'} onPress={save} disabled={busy} />
      {msg ? <Muted style={{ marginTop: 12, textAlign: 'center', fontSize: 14, color: msg === 'Saved.' || msg === 'Saving…' ? C.muted : C.down }}>{msg}</Muted> : null}
    </Screen>
  );
}

function LiftsBlock({ lifts, setLifts, by, bw, yr }: { lifts: Record<string, string>; setLifts: (f: (x: Record<string, string>) => Record<string, string>) => void; by: number; bw: number; yr: number }) {
  const age = by ? yr - by : 0, ready = age >= 13 && age <= 100 && bw >= 80 && bw <= 450;
  const r: any = { bw, age }; LIFTS.forEach(l => { r[l.k] = Number(lifts[l.k]) || 0; });
  const any = LIFTS.some(l => r[l.k] > 0), sc = ready && any ? score(r) : 0, v = sc ? verdict(sc) : null, p = pcts(r);
  return (
    <View style={{ marginBottom: 16 }}>
      <Eyebrow style={{ marginBottom: 4 }}>Your four lifts</Eyebrow>
      <Muted style={{ fontSize: 14, marginBottom: 10 }}>Heaviest single in pounds. Leave one blank if you don't do it.</Muted>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {LIFTS.map(l => (
          <View key={l.k} style={{ width: '47%' }}>
            <Text style={{ color: colorOf(l.db), fontSize: 11, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>{l.n}</Text>
            <TextInput value={lifts[l.k] ?? ''} onChangeText={t => setLifts(x => ({ ...x, [l.k]: t.replace(/[^0-9]/g, '') }))} keyboardType="number-pad" maxLength={4} style={s.input} placeholder="lb" placeholderTextColor="#5A6478" accessibilityLabel={`${l.n} in pounds`} />
          </View>
        ))}
      </View>
      <View style={{ backgroundColor: C.panel, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 14, marginTop: 14 }}>
        <Eyebrow>Your DSI™</Eyebrow>
        {v ? (<>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
            <Text style={{ color: C.accent, fontSize: 52, fontWeight: '900' }}>{sc}</Text>
            <Muted style={{ fontSize: 14 }}>{fmt(total(r))} lb total</Muted>
          </View>
          <Text style={{ color: C.ink, fontSize: 15 }}><Text style={{ color: C.accent, fontWeight: '800' }}>{v[1]}.</Text> {v[3]}</Text>
          <Muted style={{ fontSize: 13, marginTop: 6 }}>{LIFTS.map(l => `${l.n} ${p[l.k] || 0}%`).join('  ·  ')}</Muted>
        </>) : <Muted style={{ fontSize: 14, marginTop: 4 }}>{ready ? 'Enter a lift to see your score.' : 'Enter your birth year and bodyweight, then your lifts.'}</Muted>}
      </View>
    </View>
  );
}
