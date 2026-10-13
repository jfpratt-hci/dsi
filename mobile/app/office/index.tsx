// Gym office on the phone: pick a gym I run, check people in for today's classes, then jump to
// Log a class and Enter results here, or to the office pages that stay on the website.
// Same rules and words as site/js/club.js (VIEWS.club, tabToday) and the OFFICE menu in site/js/app.js.
import * as Haptics from 'expo-haptics';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';

import { Btn, Card, Chip, Eyebrow, Group, Loading, Muted, Row, s, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { addDays } from '@/lib/data';
import {
  checkIn, dayIn, dayName, myGyms, OFFICE, officeHref, OfficeScreen, openWeb, people, Pill, sessionsFor, tAt, tvHref,
  type Booking, type ClassSession, type Gym, type OfficeKey, type StaffGym,
} from '@/lib/office';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

export default function Office() {
  const { gym: gParam } = useLocalSearchParams<{ gym?: string }>();
  const { me, session } = useSession();
  const [gyms, setGyms] = useState<StaffGym[] | null>(null);
  const [gid, setGid] = useState<string | null>(gParam || null);
  const [err, setErr] = useState('');

  useEffect(() => { if (gParam) setGid(gParam); }, [gParam]);
  useEffect(() => {
    if (!me) return;
    setErr('');
    myGyms(me).then(setGyms).catch(e => setErr(e.message));
  }, [me?.id, me?.role]);

  const head = <Stack.Screen options={{ title: 'Gym office' }} />;
  if (!session) return (
    <Screen stack>{head}
      <Card>
        <Text style={st.h}>Sign in to run your gym</Text>
        <Muted style={st.p}>Members log lifts, chat and file protests. Boards and PRs stay public.</Muted>
        <Btn label="Sign in" onPress={() => router.push('/login')} style={{ marginTop: 12 }} />
      </Card>
    </Screen>
  );
  if (err) return <Screen stack>{head}<Card><Muted style={{ color: C.down }}>{err}</Muted></Card></Screen>;
  if (!me || !gyms) return <Screen stack>{head}<Loading /></Screen>;

  const chosen = gid ? gyms.find(x => x.gym_id === gid) ?? null : gyms.length === 1 ? gyms[0] : null;
  if (!gyms.length || (gid && !chosen)) return (
    <Screen stack>{head}
      <Card>
        <Text style={st.h}>Coaches only</Text>
        <Muted style={st.p}>Owners and coaches run the gym office.</Muted>
        <Btn ghost label="Back" onPress={back} style={{ marginTop: 12 }} />
      </Card>
    </Screen>
  );

  if (!chosen) return (
    <Screen stack>{head}
      <Title eyebrow="Gym office">Your gyms</Title>
      <Group>
        {gyms.map((x, i) => (
          <Row key={x.gym_id} first={i === 0} label={x.gym.name} detail={x.role === 'owner' ? 'Owner' : 'Coach'} onPress={() => setGid(x.gym_id)} />
        ))}
      </Group>
    </Screen>
  );

  return <GymOffice key={chosen.gym_id} g={chosen.gym} owner={chosen.role === 'owner'} many={gyms.length > 1} onSwitch={() => setGid(null)} />;
}

/* ---------- one gym: check in for the day, then the office pages ---------- */
type Member = { id: string; display_name: string };

function GymOffice({ g, owner, many, onSwitch }: { g: Gym; owner: boolean; many: boolean; onSwitch: () => void }) {
  const todayHere = dayIn(g.tz);
  const [day, setDay] = useState(todayHere);
  const [loaded, setLoaded] = useState<{ day: string; list: ClassSession[] } | null>(null);
  const [bk, setBk] = useState<Booking[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [hasWaiver, setHasWaiver] = useState(false);
  const [signed, setSigned] = useState<Set<string>>(new Set());
  const [mem, setMem] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<string>('');
  const [walk, setWalk] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      const [list, ms, wv] = await Promise.all([
        sessionsFor(g, day, day),
        sb.from('profiles').select('id,display_name').eq('gym_id', g.id).not('display_name', 'is', null).order('display_name'),
        sb.from('gym_docs').select('id').eq('gym_id', g.id).eq('kind', 'waiver').eq('active', true).maybeSingle(),
      ]);
      const roster = (ms.data ?? []) as Member[];
      const ids = list.map(x => x.id);
      const [b, sg, mb] = await Promise.all([
        ids.length ? sb.from('bookings').select('*').in('session_id', ids).neq('status', 'canceled').order('created_at') : Promise.resolve({ data: [] as Booking[] }),
        wv.data ? sb.from('doc_signatures').select('profile_id').eq('doc_id', wv.data.id) : Promise.resolve({ data: [] as { profile_id: string }[] }),
        sb.from('memberships').select('profile_id,status').eq('gym_id', g.id).in('status', ['active', 'past_due', 'pending', 'paused']),
      ]);
      const books = (b.data ?? []) as Booking[];
      const known = new Set(roster.map(m => m.id));
      const extra = await people([...list.map(x => x.coach_id), ...books.map(x => x.profile_id).filter(id => !known.has(id))]);
      setMembers(roster);
      setNames(new Map([...extra, ...roster.map(m => [m.id, m.display_name] as [string, string])]));
      setHasWaiver(!!wv.data);
      setSigned(new Set(((sg.data ?? []) as { profile_id: string }[]).map(x => x.profile_id)));
      setMem(new Map(((mb.data ?? []) as { profile_id: string; status: string }[]).map(x => [x.profile_id, x.status])));
      setBk(books);
      setLoaded({ day, list });
    } catch (e: any) { setErr(e.message ?? String(e)); setLoaded({ day, list: [] }); }
  }, [g, day]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const nm = (id: string) => names.get(id) || 'Member';
  const ss = loaded && loaded.day === day ? loaded.list : null;

  async function tap(sid: string, pid: string, on: boolean) {
    setBusy(sid + pid);
    try {
      await checkIn(sid, pid, on);
      Haptics.selectionAsync().catch(() => {});
      setBk(cur => {
        const has = cur.some(b => b.session_id === sid && b.profile_id === pid);
        const status = on ? 'attended' : 'booked';
        return has ? cur.map(b => (b.session_id === sid && b.profile_id === pid ? { ...b, status } : b))
          : [...cur, { id: sid + pid, session_id: sid, profile_id: pid, status, created_at: new Date().toISOString() }];
      });
      if (on && walk === sid) { setWalk(null); setQ(''); }
    } catch (e: any) {
      Alert.alert('Not checked in', e.message);
    } finally { setBusy(''); }
  }

  const go = (k: OfficeKey) => openWeb(officeHref(g.id, k));
  const web = OFFICE.filter(o => !o[3] || owner);
  const has = (k: OfficeKey) => web.some(o => o[0] === k);
  const label = (k: OfficeKey) => OFFICE.find(o => o[0] === k)?.[1] ?? k;

  return (
    <OfficeScreen>
      <Stack.Screen options={{ title: 'Gym office' }} />
      <Title eyebrow={`${g.city || 'Gym'} · Gym office`}>{g.name}</Title>
      {many ? <View style={{ flexDirection: 'row', marginTop: -6, marginBottom: 8 }}><Chip label="Switch gym" on={false} onPress={onSwitch} /></View> : null}

      <Eyebrow style={{ marginBottom: 6 }}>Check in</Eyebrow>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Chip label="← Day before" on={false} onPress={() => setDay(addDays(day, -1))} />
        {day !== todayHere ? <Chip label="Today" on={false} onPress={() => setDay(todayHere)} /> : null}
        <Chip label="Next day →" on={false} onPress={() => setDay(addDays(day, 1))} />
      </View>
      <Text style={st.day}>{dayName(day)}</Text>
      <Muted style={{ marginBottom: 10 }}>Tap a name to check them in. Tap again to undo.</Muted>
      {err ? <Card><Muted style={{ color: C.down }}>{err}</Muted></Card> : null}

      {!ss ? <Loading /> : !ss.length ? (
        <Card>
          <Text style={st.h}>No classes on {dayName(day)}</Text>
          <Muted style={st.p}>Set up the weekly classes on the Schedule page.</Muted>
          <Btn ghost label="Schedule" onPress={() => go('schedule')} style={{ marginTop: 12 }} />
        </Card>
      ) : ss.map(x => {
        const roster = bk.filter(b => b.session_id === x.id);
        const here = roster.filter(b => b.status === 'attended').length, booked = roster.filter(b => b.status !== 'waitlist').length;
        const off = x.status === 'canceled';
        const open = walk === x.id;
        const find = q.trim().toLowerCase();
        const matches = open && find ? members.filter(m => !roster.some(b => b.profile_id === m.id) && m.display_name.toLowerCase().includes(find)).slice(0, 8) : [];
        return (
          <Card key={x.id} style={off ? { opacity: 0.6 } : undefined}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.ink, fontSize: 17, fontWeight: '800' }}>{tAt(x.starts_at, g.tz)} <Text style={{ fontWeight: '600' }}>{x.name}</Text></Text>
                <Muted>Coach {x.coach_id ? nm(x.coach_id) : 'not set'}</Muted>
                {off ? <View style={{ flexDirection: 'row', marginTop: 4 }}><Pill label="Canceled" tone="down" /></View> : null}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: C.ink, fontSize: 20, fontWeight: '900' }}>{here}<Text style={{ color: C.muted, fontSize: 14, fontWeight: '600' }}>/{booked} here</Text></Text>
                <Muted style={{ fontSize: 12 }}>{x.capacity} spots</Muted>
              </View>
            </View>
            {day === todayHere && !off ? <Btn ghost label="Log weights" onPress={() => router.push({ pathname: '/office/class', params: { gym: g.id, s: x.id } })} style={{ height: 44, marginTop: 10 }} /> : null}

            <View style={{ marginTop: 10, gap: 6 }}>
              {roster.length ? roster.map(b => {
                const on = b.status === 'attended', wl = b.status === 'waitlist', key = x.id + b.profile_id;
                const ms = mem.get(b.profile_id);
                return (
                  <Pressable key={b.profile_id} accessibilityRole="button" accessibilityState={{ selected: on, busy: busy === key }}
                    accessibilityLabel={`${nm(b.profile_id)}, ${on ? 'here. Tap to undo' : 'tap to check in'}`}
                    disabled={!!busy} onPress={() => tap(x.id, b.profile_id, !on)}
                    style={({ pressed }) => [st.person, on && st.personOn, (pressed || busy === key) && { opacity: 0.6 }]}>
                    <Text style={[st.check, on && { color: C.up, borderColor: C.up }]}>{on ? '✓' : ''}</Text>
                    <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
                      <Text style={{ color: C.ink, fontSize: 16, fontWeight: '600', marginRight: 2 }}>{nm(b.profile_id)}</Text>
                      {wl ? <Pill label="Waitlist" tone="flat" /> : null}
                      {hasWaiver && !signed.has(b.profile_id) ? <Pill label="No waiver" tone="down" /> : null}
                      {!ms ? <Pill label="No membership" tone="flat" /> : ms === 'past_due' ? <Pill label="Past due" tone="down" /> : null}
                    </View>
                    <Text style={{ color: on ? C.up : C.muted, fontSize: 12, fontWeight: '700' }}>{on ? 'Here' : 'Check in'}</Text>
                  </Pressable>
                );
              }) : <Muted>Nobody booked yet.</Muted>}
            </View>

            {open ? (
              <View style={{ marginTop: 10 }}>
                <TextInput value={q} onChangeText={setQ} autoFocus placeholder="Search members by name" placeholderTextColor="#5A6478"
                  autoCapitalize="words" autoCorrect={false} accessibilityLabel="Search members to check in a walk in" style={s.input} />
                {find && !matches.length ? <Muted style={{ marginTop: 8 }}>No member by that name.</Muted> : null}
                {matches.map(m => (
                  <Pressable key={m.id} accessibilityRole="button" accessibilityLabel={`Check in ${m.display_name}`} disabled={!!busy}
                    onPress={() => tap(x.id, m.id, true)} style={({ pressed }) => [st.person, { marginTop: 6 }, pressed && { opacity: 0.6 }]}>
                    <Text style={{ color: C.ink, fontSize: 16, fontWeight: '600', flex: 1 }}>{m.display_name}</Text>
                    <Text style={{ color: C.accent, fontSize: 12, fontWeight: '700' }}>Check in</Text>
                  </Pressable>
                ))}
                <Btn ghost label="Done" onPress={() => { setWalk(null); setQ(''); }} style={{ height: 44, marginTop: 8 }} />
              </View>
            ) : !off ? (
              <Btn ghost label="Check in a walk in" onPress={() => { setWalk(x.id); setQ(''); }} style={{ height: 44, marginTop: 10 }} />
            ) : null}
          </Card>
        );
      })}

      <View style={{ height: 8 }} />
      <Group title="Run the floor">
        <Row first label="Log a class" detail="Weights live" onPress={() => router.push({ pathname: '/office/class', params: { gym: g.id } })} />
        <Row label="Enter results" detail="Scores for the day" onPress={() => router.push({ pathname: '/office/results', params: { gym: g.id } })} />
        {(['schedule', 'wod', 'plan'] as OfficeKey[]).filter(has).map(k => <Row key={k} label={label(k)} detail="Website" onPress={() => go(k)} />)}
        <Row label="Dandy TV" detail="Website" onPress={() => openWeb(tvHref(g))} />
      </Group>
      <Group title="Run the business">
        {(['members', 'billing', 'docs', 'staff', 'settings'] as OfficeKey[]).filter(has).map((k, i) => <Row key={k} first={i === 0} label={label(k)} detail="Website" onPress={() => go(k)} />)}
      </Group>
    </OfficeScreen>
  );
}

const st = {
  h: { color: C.ink, fontSize: 17, fontWeight: '800' as const },
  p: { fontSize: 15, marginTop: 4 },
  day: { color: C.ink, fontSize: 20, fontWeight: '900' as const, textTransform: 'uppercase' as const, marginTop: 2 },
  person: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, minHeight: 48, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel2 },
  personOn: { borderColor: C.up, backgroundColor: 'rgba(61,186,116,0.12)' },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: C.line, textAlign: 'center' as const, lineHeight: 20, fontSize: 14, fontWeight: '900' as const, color: C.muted, overflow: 'hidden' as const },
};
