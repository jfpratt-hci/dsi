// Gym league: every gym ranked by the average DSI of its top five lifters. A gym needs three lifters to rank.
// Pick your gym, leave it, or add a new one. Same rules and wording as dandystrength.com/gyms.
import * as Haptics from 'expo-haptics';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Btn, Card, Eyebrow, Loading, Mono, Muted, s, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { loadBoard } from '@/lib/data';
import { gymLeague, loadGymOf, MINE_BG, setMyGym, type Gym, type LeagueRow } from '@/lib/compete';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

export default function Gyms() {
  const { me, reloadMe } = useSession();
  const [gyms, setGyms] = useState<Gym[] | null>(null);
  const [league, setLeague] = useState<LeagueRow[]>([]);
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [find, setFind] = useState('');
  const [nm, setNm] = useState('');
  const [city, setCity] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [board, gres, gymOf] = await Promise.all([loadBoard(), sb.from('gyms').select('id,name,city,slug,created_by').order('name'), loadGymOf()]);
      if (gres.error) throw new Error(gres.error.message);
      const gs = (gres.data ?? []) as Gym[];
      setGyms(gs); setLeague(gymLeague(gs, board, gymOf)); setErr('');
    } catch (e: any) { setErr(e.message ?? String(e)); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const myGym = me?.gym_id ?? null;
  const myName = gyms?.find(g => g.id === myGym)?.name;
  const matches = useMemo(() => {
    const t = find.trim().toLowerCase();
    if (!t || !gyms) return [];
    return gyms.filter(g => g.name.toLowerCase().includes(t) || (g.city ?? '').toLowerCase().includes(t)).slice(0, 8);
  }, [find, gyms]);

  async function pick(g: Gym | null) {
    if (!me) { router.push('/login'); return; }
    setBusy(true);
    const e = await setMyGym(me.id, g ? g.id : null);
    setBusy(false);
    if (e) { Alert.alert('That did not save', e); return; }
    await reloadMe();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setFind('');
    Alert.alert(g ? 'Gym saved' : 'Gym cleared', g ? `You train at ${g.name}.` : undefined);
    load();
  }
  function leave() {
    Alert.alert('Leave ' + (myName ?? 'your gym') + '?', 'You come off its board. You can pick it again any time.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => pick(null) },
    ]);
  }
  async function add() {
    if (!me) { router.push('/login'); return; }
    const name = nm.trim().replace(/\s+/g, ' '), c = city.trim();
    if (name.length < 3 || name.length > 60) { setMsg('Gym names are 3 to 60 characters.'); return; }
    const dup = gyms?.find(g => g.name.trim().toLowerCase() === name.toLowerCase());
    if (dup) { setNm(''); setCity(''); setMsg(''); await pick(dup); return; }
    setBusy(true); setMsg('Saving…');
    const { data, error } = await sb.from('gyms').insert({ name, city: c || null, created_by: me.id }).select('id,name,city,slug,created_by').single();
    if (error) { setBusy(false); setMsg(/gyms_name_ci|duplicate/.test(error.message) ? 'Another gym already has that name. Search for it above.' : error.message); return; }
    setNm(''); setCity(''); setMsg('');
    await pick(data as Gym);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={[]}>
      <Stack.Screen options={{ title: 'Gym league' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl tintColor={C.accent} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
          <Title eyebrow="Gym league" accent="every gym">Your gym vs</Title>
          <Muted style={{ fontSize: 15, marginTop: -6, marginBottom: 14 }}>Ranked by the average DSI of each gym's top five lifters. A gym needs three lifters to rank.</Muted>

          {me && gyms ? (
            <Card accent={myGym ? C.accent : undefined}>
              <Eyebrow>Your gym</Eyebrow>
              {myGym ? (<>
                <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/compete/gym/[id]', params: { id: myGym } })} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
                  <Text style={{ color: C.ink, fontSize: 20, fontWeight: '800', flex: 1 }} numberOfLines={2}>You train at {myName ?? 'your gym'}.</Text>
                  <Text style={s.chev}>›</Text>
                </Pressable>
                <Btn ghost label="Leave this gym" onPress={leave} disabled={busy} style={{ marginTop: 8 }} />
              </>) : <Muted style={{ fontSize: 15, marginTop: 4 }}>Pick your gym to put it on the league.</Muted>}
              <TextInput value={find} onChangeText={setFind} placeholder={myGym ? 'Switch gyms: search by name or city' : 'Search gyms by name or city'} placeholderTextColor="#5A6478"
                autoCorrect={false} style={[s.input, { fontSize: 16, marginTop: 12 }]} accessibilityLabel="Search gyms" clearButtonMode="while-editing" />
              {matches.map(g => (
                <View key={g.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, borderTopWidth: 1, borderTopColor: C.line, marginTop: 6, paddingTop: 6 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.ink, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{g.name}</Text>
                    {g.city ? <Muted style={{ fontSize: 12 }}>{g.city}</Muted> : null}
                  </View>
                  {g.id === myGym ? <Muted>Your gym</Muted>
                    : <Btn label="Make this my gym" onPress={() => pick(g)} disabled={busy} style={{ height: 44, paddingHorizontal: 12 }} />}
                </View>
              ))}
              {find.trim() && !matches.length ? <Muted style={{ marginTop: 8 }}>No gym by that name yet. Add it below.</Muted> : null}
            </Card>
          ) : null}
          {!me ? (
            <Card>
              <Muted style={{ fontSize: 15, marginBottom: 10 }}>Sign in to put your gym on the league.</Muted>
              <Btn label="Sign in" onPress={() => router.push('/login')} />
            </Card>
          ) : null}

          {err ? <Muted style={{ color: C.down, marginVertical: 10 }}>{err}</Muted> : null}
          {!gyms ? <Loading /> : (<>
            <View style={{ flexDirection: 'row', paddingHorizontal: 4, paddingBottom: 6, marginTop: 10 }}>
              <Eyebrow style={{ width: 30 }}>#</Eyebrow>
              <Eyebrow style={{ flex: 1 }}>Gym</Eyebrow>
              <Eyebrow style={{ color: C.accent }}>Top 5 avg</Eyebrow>
            </View>
            {league.length === 0 ? <Card><Muted style={{ fontSize: 15 }}>No gyms yet. Add yours below.</Muted></Card> : league.map((x, i) => {
              const mine = myGym === x.g.id, ranked = x.n >= 3;
              return (
                <Pressable key={x.g.id} accessibilityRole="button" accessibilityLabel={`${x.g.name}${ranked ? `, rank ${i + 1}, top five average ${x.avg}` : ''}`}
                  onPress={() => router.push({ pathname: '/compete/gym/[id]', params: { id: x.g.id } })}
                  style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 64, paddingVertical: 10, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: mine ? MINE_BG : 'transparent' }, pressed && { backgroundColor: C.panel2 }]}>
                  <Text style={{ width: 24, fontSize: 20, fontWeight: '900', color: ranked && i === 0 ? C.accent : C.muted }}>{ranked ? i + 1 : '·'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.ink, fontSize: 17, fontWeight: '700' }} numberOfLines={1}>{x.g.name}{mine ? <Text style={{ color: C.accent, fontSize: 12 }}>  YOUR GYM</Text> : null}</Text>
                    <Muted style={{ fontSize: 12 }} >{[x.g.city, `${x.n} ${x.n === 1 ? 'lifter' : 'lifters'}`, x.best ? `strongest ${x.best.name} ${x.best.score}` : ''].filter(Boolean).join(' · ')}</Muted>
                  </View>
                  {ranked ? <Mono style={{ fontSize: 22 }}>{x.avg}</Mono> : <Muted style={{ fontSize: 12 }}>needs {3 - x.n} more</Muted>}
                  <Text style={s.chev}>›</Text>
                </Pressable>
              );
            })}
          </>)}

          {me ? (
            <Card style={{ marginTop: 18 }}>
              <Text style={{ color: C.ink, fontSize: 18, fontWeight: '800' }}>Add your gym</Text>
              <Muted style={{ fontSize: 14, marginTop: 4, marginBottom: 10 }}>Not on the list? Add it and it becomes your gym.</Muted>
              <Eyebrow style={{ marginBottom: 6 }}>Gym name</Eyebrow>
              <TextInput value={nm} onChangeText={t => { setNm(t); setMsg(''); }} maxLength={60} placeholder="Gym name" placeholderTextColor="#5A6478" style={[s.input, { fontSize: 16 }]} accessibilityLabel="Gym name" />
              <Eyebrow style={{ marginTop: 12, marginBottom: 6 }}>City</Eyebrow>
              <TextInput value={city} onChangeText={setCity} maxLength={60} placeholder="Cincinnati, OH" placeholderTextColor="#5A6478" style={[s.input, { fontSize: 16 }]} accessibilityLabel="City" />
              <Btn label="Add and make it my gym" onPress={add} disabled={busy || nm.trim().length < 3} style={{ marginTop: 12 }} />
              {msg ? <Muted style={{ marginTop: 8, color: msg === 'Saving…' ? C.muted : C.down }}>{msg}</Muted> : null}
            </Card>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
