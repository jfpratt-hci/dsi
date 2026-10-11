// Weekly battles: call out any lifter for a Monday to Sunday week. Most DSI points gained wins; pounds added breaks a tie.
// Starting a battle is Pro; anyone can accept one. Same rules and wording as dandystrength.com/battles.
import * as Haptics from 'expo-haptics';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Btn, Card, Eyebrow, Loading, Mono, Muted, ProBadge, s, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { addDays, fmt, fmtD, loadBoard, monday, today, type BoardRow } from '@/lib/data';
import { allEntries, battleScore, battleStatus, battleWeeks, loadProIds, namer, namesFor, openThread, respondBattle, TONE, type Battle, type LiftRow } from '@/lib/compete';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

type Data = { board: BoardRow[]; battles: Battle[]; by: Map<string, LiftRow[]>; extra: Record<string, string>; pros: Set<string> };

export default function Battles() {
  const { me, isPro, blocked } = useSession();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  // the challenge form
  const [opp, setOpp] = useState<BoardRow | null>(null);
  const [week, setWeek] = useState(monday(today()));
  const [talk, setTalk] = useState('');
  const [msg, setMsg] = useState('They get it in their battles list and accept or decline.');
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(async (force = false) => {
    try {
      const [board, bres, by, pros] = await Promise.all([
        loadBoard(),
        sb.from('battles').select('*').order('week_start', { ascending: false }).order('created_at', { ascending: false }).limit(200),
        allEntries(force),
        loadProIds(force),
      ]);
      if (bres.error) throw new Error(bres.error.message);
      const battles = (bres.data ?? []) as Battle[];
      const ids = battles.flatMap(b => [b.challenger, b.opponent]).filter(id => !board.some(r => r.profile_id === id));
      setD({ board, battles, by, extra: await namesFor(ids), pros }); setErr('');
    } catch (e: any) { setErr(e.message ?? String(e)); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const name = d ? namer(d.board, d.extra) : () => 'Someone';
  const thisMon = monday(today());
  const weeks = battleWeeks();
  const others = useMemo(() => (d?.board ?? []).filter(r => r.profile_id !== me?.id && !blocked.has(r.profile_id)).sort((a, b) => a.name.localeCompare(b.name)), [d, me?.id, blocked]);
  const found = useMemo(() => { const t = q.trim().toLowerCase(); return t ? others.filter(r => r.name.toLowerCase().includes(t)) : others; }, [others, q]);

  const mine = d && me ? d.battles.filter(b => b.challenger === me.id || b.opponent === me.id) : [];
  const live = d ? d.battles.filter(b => b.status === 'accepted' && b.week_start >= addDays(thisMon, -7) && !mine.includes(b)) : [];

  async function send() {
    if (!me) { router.push('/login'); return; }
    if (!isPro) { router.push('/pro'); return; }
    if (!opp) { setMsg('Pick a lifter to call out.'); setPicker(true); return; }
    setBusy(true); setMsg('Sending…');
    const { error } = await sb.from('battles').insert({ challenger: me.id, opponent: opp.profile_id, week_start: week, trash_talk: talk.trim() || null });
    setBusy(false);
    if (error) { setMsg(/battles_once/.test(error.message) ? 'You two already have a battle that week.' : error.message); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Alert.alert('Challenge sent to ' + opp.name);
    setOpp(null); setTalk(''); setMsg('They get it in their battles list and accept or decline.');
    load();
  }

  const card = (b: Battle) => {
    if (!d) return null;
    const sc = battleScore(b, d.by, d.board), meA = me?.id === b.challenger, meO = me?.id === b.opponent;
    const st = battleStatus(b, sc, name, fmtD, me?.id);
    const side = (pid: string, g: typeof sc.a) => {
      const lead = b.status === 'accepted' && sc.lead === pid;
      return (
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/lifter/[id]', params: { id: pid } })}
          style={{ flex: 1, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: lead ? C.up : C.line, backgroundColor: lead ? 'rgba(61,186,116,0.08)' : 'transparent', minHeight: 44 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ color: C.ink, fontWeight: '700', fontSize: 15, flexShrink: 1 }} numberOfLines={1}>{name(pid)}</Text>
            {d.pros.has(pid) ? <ProBadge /> : null}
          </View>
          <Mono style={{ fontSize: 28, color: lead ? C.up : C.ink, marginTop: 2 }}>+{g.pts}</Mono>
          <Muted style={{ fontSize: 12 }}>{fmt(g.lb)} lb · {g.prs} {g.prs === 1 ? 'PR' : 'PRs'}</Muted>
        </Pressable>
      );
    };
    return (
      <Card key={b.id}>
        <Pressable accessibilityRole="button" accessibilityLabel="Open this battle" onPress={() => router.push({ pathname: '/compete/battle/[id]', params: { id: b.id } })}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, marginTop: -6, marginBottom: 4 }}>
          <Eyebrow>Week of {fmtD(b.week_start)}</Eyebrow>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ color: TONE[st.tone], fontWeight: '800', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', borderWidth: 1, borderColor: TONE[st.tone], borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden', maxWidth: 190 }} numberOfLines={1}>{st.label}</Text>
            <Text style={s.chev}>›</Text>
          </View>
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {side(b.challenger, sc.a)}
          <Text style={{ color: C.muted, fontWeight: '900', textTransform: 'uppercase' }}>vs</Text>
          {side(b.opponent, sc.o)}
        </View>
        {b.trash_talk ? <Text style={{ color: C.ink, fontStyle: 'italic', marginTop: 10, fontSize: 15 }}>“{b.trash_talk}”</Text> : null}
        {b.status === 'pending' && meO ? (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            {sc.over ? null : <Btn label="Accept" onPress={() => respondBattle(b.id, 'accept', load)} style={{ flex: 1 }} />}
            <Btn ghost label="Decline" onPress={() => respondBattle(b.id, 'decline', load)} style={{ flex: 1 }} />
          </View>
        ) : null}
        {b.status === 'pending' && meA ? <Btn ghost label="Call it off" onPress={() => respondBattle(b.id, 'cancel', load)} style={{ marginTop: 12 }} /> : null}
        {b.status === 'accepted' ? <Btn ghost label="Talk" onPress={() => openThread('battle', b.id, `${name(b.challenger)} vs ${name(b.opponent)}`, !!me)} style={{ marginTop: 12 }} /> : null}
      </Card>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={[]}>
      <Stack.Screen options={{ title: 'Battles' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl tintColor={C.accent} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(true); setRefreshing(false); }} />}>
          <Title eyebrow="Head to head" accent="battles">Weekly</Title>
          <Muted style={{ fontSize: 15, marginTop: -6, marginBottom: 14 }}>Call out any lifter for a Monday to Sunday week. Most DSI points gained wins; pounds added breaks a tie.</Muted>

          {!me ? (
            <Card>
              <Muted style={{ fontSize: 15, marginBottom: 10 }}>Sign in to start or answer a battle.</Muted>
              <Btn label="Sign in" onPress={() => router.push('/login')} />
            </Card>
          ) : !isPro ? (
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}><Text style={{ color: C.ink, fontSize: 18, fontWeight: '800' }}>Start a battle</Text><ProBadge /></View>
              <Muted style={{ fontSize: 15, marginBottom: 10 }}>Starting a battle is part of DSI Pro. Anyone can accept one.</Muted>
              <Btn label="See Pro" onPress={() => router.push('/pro')} />
            </Card>
          ) : (
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}><Text style={{ color: C.ink, fontSize: 18, fontWeight: '800' }}>Send a challenge</Text><ProBadge /></View>
              <Eyebrow style={{ marginBottom: 6 }}>Opponent</Eyebrow>
              <Pressable accessibilityRole="button" accessibilityLabel={opp ? `Opponent ${opp.name}. Change` : 'Pick a lifter'} onPress={() => { setQ(''); setPicker(true); }}
                style={[s.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
                <Text style={{ color: opp ? C.ink : '#5A6478', fontSize: 17, flexShrink: 1 }} numberOfLines={1}>{opp ? `${opp.name} · DSI ${opp.score}` : 'Pick a lifter…'}</Text>
                <Text style={s.chev}>›</Text>
              </Pressable>
              <Eyebrow style={{ marginTop: 14, marginBottom: 6 }}>Week</Eyebrow>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {weeks.map((w, i) => {
                  const on = week === w;
                  return (
                    <Pressable key={w} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setWeek(w)}
                      style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: on ? C.ink : C.line, backgroundColor: on ? C.ink : 'transparent', justifyContent: 'center', marginRight: 8, marginBottom: 8 }}>
                      <Text style={{ color: on ? C.bg : C.muted, fontWeight: '700', fontSize: 14 }}>{i ? 'Week of ' + fmtD(w) : 'This week'}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Eyebrow style={{ marginTop: 8, marginBottom: 6 }}>Trash talk (optional)</Eyebrow>
              <TextInput value={talk} onChangeText={setTalk} maxLength={140} placeholder="Bring your belt." placeholderTextColor="#5A6478"
                style={[s.input, { fontSize: 16 }]} accessibilityLabel="Trash talk, optional" returnKeyType="done" />
              <Muted style={{ textAlign: 'right', fontSize: 11, marginTop: 4 }}>{talk.length}/140</Muted>
              <Btn label={busy ? 'Sending…' : 'Send the challenge'} onPress={send} disabled={busy} style={{ marginTop: 6 }} />
              <Muted style={{ marginTop: 8, fontSize: 13 }}>{msg}</Muted>
            </Card>
          )}

          {err ? <Muted style={{ color: C.down, marginVertical: 10 }}>{err}</Muted> : null}
          {!d ? <Loading /> : (<>
            {mine.length ? <>
              <Text style={st.h2}>Your <Text style={{ color: C.accent }}>battles</Text></Text>
              {mine.map(card)}
            </> : null}
            <Text style={st.h2}>Live <Text style={{ color: C.accent }}>now</Text></Text>
            {live.length ? live.map(card) : <Card><Muted style={{ fontSize: 15 }}>No battles running. Start one.</Muted></Card>}
          </>)}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={picker} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPicker(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, paddingBottom: 8 }}>
            <Text style={{ color: C.ink, fontSize: 24, fontWeight: '900', textTransform: 'uppercase', flex: 1 }}>Pick a lifter</Text>
            <Pressable accessibilityRole="button" onPress={() => setPicker(false)} hitSlop={12} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: C.accent, fontWeight: '700', fontSize: 16 }}>Close</Text>
            </Pressable>
          </View>
          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <TextInput value={q} onChangeText={setQ} placeholder="Search the board" placeholderTextColor="#5A6478" autoFocus autoCorrect={false} autoCapitalize="none"
              style={[s.input, { fontSize: 17 }]} accessibilityLabel="Search lifters" clearButtonMode="while-editing" />
          </View>
          <FlatList data={found} keyExtractor={r => r.profile_id} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
            ListEmptyComponent={<Muted style={{ padding: 16, textAlign: 'center' }}>{others.length ? 'Nobody by that name on the board.' : 'Nobody else is on the board yet.'}</Muted>}
            renderItem={({ item: r }) => (
              <Pressable accessibilityRole="button" onPress={() => { setOpp(r); setPicker(false); setMsg('They get it in their battles list and accept or decline.'); }}
                style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', minHeight: 56, borderTopWidth: 1, borderTopColor: C.line, paddingHorizontal: 4 }, pressed && { backgroundColor: C.panel2 }, opp?.profile_id === r.profile_id && { backgroundColor: 'rgba(242,201,76,0.08)' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.ink, fontSize: 17, fontWeight: '600' }} numberOfLines={1}>{r.name}</Text>
                  <Muted style={{ fontSize: 12 }}>{r.division}{r.age ? ` · age ${r.age}` : ''}</Muted>
                </View>
                <Mono style={{ fontSize: 18 }}>DSI {r.score}</Mono>
              </Pressable>
            )} />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const st = {
  h2: { color: C.ink, fontSize: 26, fontWeight: '900' as const, textTransform: 'uppercase' as const, marginTop: 18, marginBottom: 10 },
};
