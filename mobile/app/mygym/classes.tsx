// Book a class (web: /classes): the next 7 days at my gym, by day in the gym's time zone. Book, cancel, waitlist.
import * as Haptics from 'expo-haptics';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { Btn, Card, Eyebrow, Loading, Muted, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import {
  dayOf, GYM_PICKER, gymById, hasSigned, must, people, Pill, pd, rpc, sessionsFor, tAt, todayIn,
  type Booking, type ClassSession, type Gym,
} from '@/lib/club';
import { addDays } from '@/lib/data';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

type Data = { g: Gym; ss: ClassSession[]; bk: Booking[]; signed: boolean; coach: Map<string, string>; from: string };

export default function Classes() {
  const { me, session, ready, reloadMe } = useSession();
  const gid = me?.gym_id ?? null;
  const [d, setD] = useState<Data | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async () => {
    if (!me || !gid) return;
    try {
      const g = await gymById(gid);
      if (!g) { setErr('No gym here.'); return; }
      const from = todayIn(g.tz), to = addDays(from, 6);
      const [ss, signed] = await Promise.all([sessionsFor(g, from, to), hasSigned(g.id, 'waiver')]);
      const ids = ss.map(x => x.id);
      const bk = ids.length ? must(await sb.from('bookings').select('session_id,profile_id,status').in('session_id', ids).neq('status', 'canceled')) as Booking[] : [];
      const coach = await people(ss.map(x => x.coach_id));
      if (!alive.current) return;
      setD({ g, ss, bk, signed, coach, from });
      setSel(cur => (cur && cur >= from && cur <= to ? cur : from));
      setErr('');
    } catch (e: any) {
      if (alive.current) setErr(e?.message ?? 'Could not load classes.');
    }
  }, [me?.id, gid]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  // No gym yet: look again when the member comes back from picking one.
  const reload = useRef(reloadMe);
  reload.current = reloadMe;
  useFocusEffect(useCallback(() => { if (me?.id && !gid) reload.current().catch(() => {}); }, [me?.id, gid]));

  if (!ready) return <Screen stack><Stack.Screen options={{ title: 'Book a class' }} /><Loading /></Screen>;
  if (!session) return (
    <Screen stack>
      <Stack.Screen options={{ title: 'Book a class' }} />
      <Title accent="class">Book a</Title>
      <Card><Text style={st.h}>Sign in to book a class</Text><Muted style={{ fontSize: 15, marginTop: 4 }}>Book your spot, join the waitlist, and see your classes for the week.</Muted></Card>
      <Btn label="Sign in" onPress={() => router.push('/login')} />
    </Screen>
  );
  if (!me) return <Screen stack><Stack.Screen options={{ title: 'Book a class' }} /><Loading /></Screen>;
  if (!gid) return (
    <Screen stack>
      <Stack.Screen options={{ title: 'Book a class' }} />
      <Title accent="class">Book a</Title>
      <Card><Text style={st.h}>Pick your gym first</Text><Muted style={{ fontSize: 15, marginTop: 4 }}>Find your gym on the Gym league page and join it. Then you can book classes and manage your membership here.</Muted></Card>
      <Btn label="Gym league" onPress={() => router.push(GYM_PICKER)} />
    </Screen>
  );
  if (!d || !sel) return (
    <Screen stack>
      <Stack.Screen options={{ title: 'Book a class' }} />
      {err ? <><Card><Muted style={{ fontSize: 15 }}>{err}</Muted></Card><Btn ghost label="Try again" onPress={load} /></> : <Loading />}
    </Screen>
  );

  const { g, ss, bk, signed, coach, from } = d;
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const now = Date.now();
  const mineOn = (id: string) => bk.find(b => b.session_id === id && b.profile_id === me.id)?.status;
  const list = ss.filter(x => dayOf(x.starts_at, g.tz) === sel && Date.parse(x.ends_at) > now);

  async function book(x: ClassSession) {
    if (busy) return;
    setBusy(x.id); setNote('');
    try {
      const r = await rpc<string>('book_session', { p_session: x.id });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setNote(r === 'waitlist' ? 'You are on the waitlist. We move you in if a spot opens.' : 'Booked. See you there.');
      await load();
    } catch (e: any) {
      Alert.alert('Booking', e?.message ?? 'Could not book that class.');
    }
    setBusy('');
  }
  async function cancel(x: ClassSession, waitlist: boolean) {
    if (busy) return;
    const go = async () => {
      setBusy(x.id); setNote('');
      try {
        await rpc('cancel_booking', { p_session: x.id });
        setNote('Canceled');
        await load();
      } catch (e: any) {
        Alert.alert('Booking', e?.message ?? 'Could not cancel.');
      }
      setBusy('');
    };
    Alert.alert(waitlist ? 'Leave the waitlist?' : 'Cancel your spot?', `${x.name} at ${tAt(x.starts_at, g.tz)}`, [
      { text: 'Keep it', style: 'cancel' },
      { text: waitlist ? 'Leave' : 'Cancel', style: 'destructive', onPress: go },
    ]);
  }

  return (
    <Screen stack>
      <Stack.Screen options={{ title: 'Book a class' }} />
      <Title eyebrow={g.name} accent="class">Book a</Title>

      {!signed ? (
        <Card style={{ borderColor: C.flat }}>
          <Text style={{ color: C.ink, fontWeight: '800', fontSize: 16, marginBottom: 10 }}>Sign the waiver to book classes.</Text>
          <Btn label="Sign the waiver" onPress={() => router.push({ pathname: '/mygym/sign', params: { kind: 'waiver' } })} />
        </Card>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 14 }} accessibilityLabel="Days">
        {days.map(day => {
          const on = day === sel, dt = pd(day);
          const booked = ss.some(x => dayOf(x.starts_at, g.tz) === day && !!mineOn(x.id));
          return (
            <Pressable key={day} onPress={() => setSel(day)} accessibilityRole="button" accessibilityState={{ selected: on }}
              accessibilityLabel={`${dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}${booked ? ', booked' : ''}`}
              style={{ flex: 1, height: 58, borderRadius: 10, borderWidth: 1, borderColor: on ? C.ink : day === from ? C.muted : C.line, backgroundColor: on ? C.ink : C.panel, alignItems: 'center', justifyContent: 'center' }}>
              {booked ? <Text style={{ position: 'absolute', top: 2, right: 5, fontSize: 11, color: on ? C.bg : C.up }}>✓</Text> : null}
              <Text style={{ fontSize: 10, fontWeight: '600', color: on ? C.bg : C.muted }}>{dt.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}</Text>
              <Text style={{ fontSize: 20, fontWeight: '900', color: on ? C.bg : C.ink }}>{dt.getDate()}</Text>
            </Pressable>
          );
        })}
      </View>

      <Eyebrow style={{ marginBottom: 8 }}>{pd(sel).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</Eyebrow>
      {note ? <Card style={{ borderColor: C.up }}><Text style={{ color: C.ink, fontSize: 15 }}>{note}</Text></Card> : null}

      {list.map(x => {
        const n = bk.filter(b => b.session_id === x.id && b.status !== 'waitlist').length;
        const wl = bk.filter(b => b.session_id === x.id && b.status === 'waitlist').length;
        const mine = mineOn(x.id), left = x.capacity - n, off = x.status === 'canceled';
        const mins = Math.round((Date.parse(x.ends_at) - Date.parse(x.starts_at)) / 6e4);
        const sub = [x.coach_id ? 'Coach ' + (coach.get(x.coach_id) || '') : '', x.note || ''].filter(Boolean).join(' · ');
        return (
          <Card key={x.id} style={off ? { opacity: 0.55 } : undefined}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ width: 82 }}>
                <Text style={{ color: C.ink, fontSize: 18, fontWeight: '800' }}>{tAt(x.starts_at, g.tz)}</Text>
                <Muted>{mins} min</Muted>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.ink, fontSize: 16, fontWeight: '700' }}>{x.name}</Text>
                {sub ? <Muted style={{ marginTop: 2 }}>{sub}</Muted> : null}
                <View style={{ marginTop: 6 }}>
                  {off ? <Pill label="Canceled" tone="down" />
                    : <Muted style={{ color: left > 0 ? C.muted : C.flat }}>{left > 0 ? `${left} spot${left === 1 ? '' : 's'} left` : `Full${wl ? ` · ${wl} waiting` : ''}`}</Muted>}
                </View>
              </View>
            </View>
            {off ? null : mine === 'booked' ? (
              <View style={st.act}><Pill label="Booked" tone="up" style={{ alignSelf: 'center' }} /><View style={{ flex: 1 }} /><Btn ghost label="Cancel" disabled={busy === x.id} onPress={() => cancel(x, false)} style={st.btn} /></View>
            ) : mine === 'waitlist' ? (
              <View style={st.act}><Pill label="Waitlist" tone="flat" style={{ alignSelf: 'center' }} /><View style={{ flex: 1 }} /><Btn ghost label="Leave" disabled={busy === x.id} onPress={() => cancel(x, true)} style={st.btn} /></View>
            ) : mine === 'attended' ? (
              <View style={st.act}><Pill label="Checked in" tone="up" style={{ alignSelf: 'center' }} /></View>
            ) : (
              <Btn label={busy === x.id ? 'Booking…' : left > 0 ? 'Book' : 'Join waitlist'} disabled={!signed || !!busy} onPress={() => book(x)} style={{ height: 44, marginTop: 12 }} />
            )}
          </Card>
        );
      })}
      {!list.length ? (
        <Card>
          <Text style={st.h}>No classes {sel === from ? 'left today' : 'this day'}</Text>
          <Muted style={{ fontSize: 15, marginTop: 4 }}>Pick another day above.</Muted>
        </Card>
      ) : null}

      <Btn ghost label="My gym" onPress={() => router.dismissTo('/mygym')} style={{ marginTop: 8 }} />
    </Screen>
  );
}

const st = {
  h: { color: C.ink, fontSize: 18, fontWeight: '800' as const },
  act: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, marginTop: 12 },
  btn: { height: 44, paddingHorizontal: 18 },
};
