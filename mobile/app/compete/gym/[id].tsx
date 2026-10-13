// One gym's board: its lifters ranked by DSI and their latest PRs. Make it my gym or leave it,
// and ask to run it (the DSI team confirms every owner). Same rules as dandystrength.com/gyms/<id> and /gym/<id>.
import * as Haptics from 'expo-haptics';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Btn, Card, Eyebrow, Loading, Mono, Muted, ProBadge, s } from '@/components/ui';
import { C } from '@/constants/Colors';
import { colorOf, fmt, fmtD, liftName, loadBoard, type BoardRow, type PR } from '@/lib/data';
import { fetchAll, loadProIds, MINE_BG, setMyGym, UUID, type Gym } from '@/lib/compete';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

type Claim = { id: string; status: 'pending' | 'approved' | 'declined'; created_at: string };
type Data = { g: Gym; members: BoardRow[]; prs: PR[]; runs: boolean; office: boolean; claim: Claim | null; pros: Set<string> };

export default function GymBoard() {
  const { id: key } = useLocalSearchParams<{ id: string }>();
  const { me, isStaff, reloadMe } = useSession();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      // A gym is reached by its id or its short big screen name.
      const gq = sb.from('gyms').select('id,name,city,slug,created_by');
      const { data: g, error } = await (UUID.test(key ?? '') ? gq.eq('id', key) : gq.eq('slug', String(key ?? '').toLowerCase())).maybeSingle();
      if (error) throw new Error(error.message);
      if (!g) { setErr('No gym here.'); return; }
      const gym = g as Gym;
      const [board, ids, pros, staff, claims] = await Promise.all([
        loadBoard(),
        fetchAll<{ id: string }>((a, b) => sb.from('profiles').select('id').eq('gym_id', gym.id).order('id').range(a, b)),
        loadProIds(),
        me ? sb.from('gym_staff').select('role').eq('gym_id', gym.id).eq('profile_id', me.id).maybeSingle() : Promise.resolve({ data: null }),
        me ? sb.from('gym_claims').select('id,status,created_at').eq('gym_id', gym.id).eq('profile_id', me.id).order('created_at', { ascending: false }).limit(1) : Promise.resolve({ data: [] as Claim[] }),
      ]);
      const memberIds = ids.map(x => x.id);
      const members = board.filter(r => memberIds.includes(r.profile_id)).sort((a, b) => b.score - a.score);
      const { data: prs } = memberIds.length
        ? await sb.from('pr_feed').select('*').in('profile_id', memberIds).order('performed_on', { ascending: false }).order('created_at', { ascending: false }).limit(10)
        : { data: [] as PR[] };
      // Like the web: staff (the Founder and Commissioners) and the gym's own coaches never see the claim form.
      // The phone office opens for the Founder and the gym's own owners and coaches.
      const office = me?.role === 'admin' || !!staff.data;
      setD({ g: gym, members, prs: (prs ?? []) as PR[], runs: isStaff || office, office, claim: ((claims.data ?? []) as Claim[])[0] ?? null, pros }); setErr('');
    } catch (e: any) { setErr(e.message ?? String(e)); }
  }, [key, me?.id, me?.role, isStaff]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const head = <Stack.Screen options={{ title: d?.g.name ?? 'Gym' }} />;
  if (err) return <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={[]}>{head}<View style={s.pad}><Card><Muted style={{ fontSize: 15 }}>{err}</Muted></Card><Btn ghost label="Gym league" onPress={() => router.replace('/compete/gyms')} /></View></SafeAreaView>;
  if (!d) return <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={[]}>{head}<Loading /></SafeAreaView>;

  const { g, members } = d;
  const mine = !!me && me.gym_id === g.id;
  const pending = d.claim?.status === 'pending';

  async function pick(on: boolean) {
    if (!me) { router.push('/login'); return; }
    setBusy(true);
    const e = await setMyGym(me.id, on ? g.id : null);
    setBusy(false);
    if (e) { Alert.alert('That did not save', e); return; }
    await reloadMe();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Alert.alert(on ? 'Gym saved' : 'Gym cleared', on ? `You train at ${g.name}. You are on its board.` : undefined);
    load();
  }
  function leave() {
    Alert.alert(`Leave ${g.name}?`, 'You come off its board. You can pick it again any time.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => pick(false) },
    ]);
  }
  function makeMine() {
    if (!me) { router.push('/login'); return; }
    if (me.gym_id && me.gym_id !== g.id) {
      Alert.alert(`Switch to ${g.name}?`, 'You can only train at one gym on the league.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Switch', onPress: () => pick(true) },
      ]);
      return;
    }
    pick(true);
  }
  async function ask() {
    if (!me) { router.push('/login'); return; }
    setBusy(true); setMsg('Sending…');
    const { error } = await sb.from('gym_claims').insert({ gym_id: g.id, profile_id: me.id, note: note.trim().slice(0, 300) || null });
    setBusy(false);
    if (error) { setMsg(/gym_claims_once|duplicate/.test(error.message) ? 'Your request is already in.' : error.message); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setNote(''); setMsg(''); setAsking(false);
    Alert.alert('Request sent', "We'll confirm it soon.");
    load();
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={[]}>
      {head}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl tintColor={C.accent} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
          <Eyebrow>{g.city || 'Gym'}</Eyebrow>
          <Text style={{ color: C.ink, fontSize: 34, fontWeight: '900', textTransform: 'uppercase', marginTop: 2 }} numberOfLines={3}>{g.name}</Text>
          <Muted style={{ fontSize: 15, marginBottom: 12 }}>{members.length} {members.length === 1 ? 'lifter' : 'lifters'} on the board.{mine ? ' Your gym.' : ''}</Muted>

          {me ? (
            mine ? <Btn ghost label="Leave this gym" onPress={leave} disabled={busy} />
              : <Btn label="Make this my gym" onPress={makeMine} disabled={busy} />
          ) : <Btn label="Sign in to pick your gym" onPress={() => router.push('/login')} />}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <Btn ghost label="Dandy TV" onPress={() => WebBrowser.openBrowserAsync(`https://dandystrength.com/tv/${g.slug || g.id}`).catch(() => {})} style={{ flex: 1, paddingHorizontal: 8 }} />
            <Btn ghost label="Gym league" onPress={() => router.push('/compete/gyms')} style={{ flex: 1, paddingHorizontal: 8 }} />
          </View>

          <Text style={st.h2}>The <Text style={{ color: C.accent }}>board</Text></Text>
          {members.length === 0 ? <Card><Muted style={{ fontSize: 15 }}>Nobody has claimed this gym yet.</Muted></Card> : members.map((r, i) => {
            const me1 = me?.id === r.profile_id;
            return (
              <Pressable key={r.profile_id} accessibilityRole="button" onPress={() => router.push({ pathname: '/lifter/[id]', params: { id: r.profile_id } })}
                style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60, paddingVertical: 10, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: me1 ? MINE_BG : 'transparent' }, pressed && { backgroundColor: C.panel2 }]}>
                <Text style={{ width: 28, fontSize: 22, fontWeight: '900', color: i === 0 ? C.accent : C.muted }}>{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ color: C.ink, fontSize: 17, fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>{r.name}</Text>
                    {d.pros.has(r.profile_id) ? <ProBadge /> : null}
                  </View>
                  <Muted style={{ fontSize: 12 }}>{fmt(r.total)} lb total</Muted>
                </View>
                <View style={{ alignItems: 'flex-end' }}><Eyebrow style={{ fontSize: 9 }}>DSI™</Eyebrow><Mono style={{ fontSize: 22 }}>{r.score}</Mono></View>
              </Pressable>
            );
          })}

          <Text style={st.h2}>Latest <Text style={{ color: C.accent }}>PRs</Text></Text>
          {d.prs.length === 0 ? <Card><Muted style={{ fontSize: 15 }}>No PRs here yet. Somebody fix that.</Muted></Card> : d.prs.map(p => {
            const gain = p.prev_best ? Number(p.weight_lb) - Number(p.prev_best) : 0;
            return (
              <Pressable key={p.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/pr/[id]', params: { id: p.id } })}
                style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.line }, pressed && { backgroundColor: C.panel2 }]}>
                <View style={{ width: 4, alignSelf: 'stretch', backgroundColor: colorOf(p.lift), borderRadius: 2 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.ink, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{p.name}</Text>
                  <Muted style={{ fontSize: 12 }}>{liftName(p.lift)} · {fmtD(p.performed_on)}{p.status === 'protested' ? ' · under protest' : ''}</Muted>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Mono style={{ fontSize: 18 }}>{fmt(p.weight_lb)} lb</Mono>
                  {gain > 0 ? <Text style={{ color: C.up, fontWeight: '700', fontSize: 12 }}>+{fmt(gain)}</Text> : null}
                </View>
              </Pressable>
            );
          })}

          {me && (d.office || !d.runs) ? (
            <Card style={{ marginTop: 20 }}>
              {d.office ? (<>
                <Text style={st.h3}>You run this gym</Text>
                <Muted style={{ fontSize: 14, marginTop: 4, marginBottom: 10 }}>Check people in, log a class and enter results from the gym office.</Muted>
                <Btn label="Gym office" onPress={() => router.push({ pathname: '/office', params: { gym: g.id } })} />
              </>) : pending ? (<>
                <Text style={st.h3}>Run this gym</Text>
                <Muted style={{ fontSize: 15, marginTop: 6 }}>Your request is in. We'll confirm it soon.</Muted>
              </>) : (<>
                <Text style={st.h3}>Own or coach here?</Text>
                <Muted style={{ fontSize: 14, marginTop: 4 }}>Gym owners get a free gym page: post the daily workout, enter results for members, and put a live dashboard on Dandy TV. The DSI team confirms every owner.</Muted>
                {asking ? (<>
                  <Eyebrow style={{ marginTop: 12, marginBottom: 6 }}>Your role at {g.name} (optional)</Eyebrow>
                  <TextInput value={note} onChangeText={setNote} maxLength={300} multiline placeholder="Owner, head coach, gym website or Instagram so we can confirm" placeholderTextColor="#5A6478"
                    style={[s.input, { height: 96, paddingTop: 12, textAlignVertical: 'top', fontSize: 16 }]} accessibilityLabel={`Your role at ${g.name}, optional`} />
                  <Btn label={busy ? 'Sending…' : 'Ask to run this gym'} onPress={ask} disabled={busy} style={{ marginTop: 10 }} />
                  <Muted style={{ marginTop: 8, fontSize: 13, color: msg && msg !== 'Sending…' ? C.down : C.muted }}>{msg || 'Coaches: ask your owner to add you instead.'}</Muted>
                </>) : <Btn ghost label="Ask to run this gym" onPress={() => setAsking(true)} style={{ marginTop: 12 }} />}
              </>)}
            </Card>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const st = {
  h2: { color: C.ink, fontSize: 26, fontWeight: '900' as const, textTransform: 'uppercase' as const, marginTop: 22, marginBottom: 8 },
  h3: { color: C.ink, fontSize: 18, fontWeight: '800' as const },
};
