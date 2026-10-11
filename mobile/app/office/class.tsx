// Log a class: coaches type each person's weight, time or reps during class, straight to the board and the TV.
// One part at a time, one box per person, each box saves on its own. On a max out day a new best is also a PR.
// Same rules and words as VIEWS.class in site/js/club.js. Params: gym (required), s (session id), it (item key).
import * as Haptics from 'expo-haptics';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, Text, TextInput, View } from 'react-native';

import { Btn, Card, Chip, Eyebrow, Group, Loading, Muted, Row, s, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { LIFTS, liftName, loadBoard, target, type BoardRow } from '@/lib/data';
import {
  checkIn, clampR, clampW, dayIn, gymById, myGyms, OfficeScreen, openWeb, people, Pill, saveError, sessionsFor, staffRole, tAt, tvHref, upsertLogs,
  type ClassSession, type Gym, type LogRow,
} from '@/lib/office';
import { fmtT, items, liftRule, parseT, type Item, type Workout } from '@/lib/parts';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

type Member = { id: string; display_name: string; sex: string | null };
type Person = { id: string; status: 'attended' | 'booked' | 'added' };
type St = { k: 'saving' | 'saved' | 'pr' | 'bad' | 'off'; msg?: string };
type Data = {
  g: Gym; day: string; w: Workout | null; live: ClassSession[]; members: Member[]; board: BoardRow[];
  auto: string | null; // the class going on now, else the next one, else the last; picked once when the page opens
};

const back = () => (router.canGoBack() ? router.back() : router.replace('/office'));
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);

export default function LogClass() {
  const params = useLocalSearchParams<{ gym?: string; s?: string; it?: string }>();
  const { me, session } = useSession();
  const [gid, setGid] = useState<string | null>(params.gym || null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [sid, setSid] = useState<string | null>(params.s || null);
  const [itKey, setItKey] = useState<string | null>(params.it || null);
  const [people_, setPeople] = useState<Person[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [vals, setVals] = useState<Record<string, string>>({});
  const [sts, setSts] = useState<Record<string, St>>({});
  const [added, setAdded] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [note, setNote] = useState('');
  const logOf = useRef(new Map<string, LogRow>());
  const inflight = useRef(new Map<string, Promise<void>>());
  const inputs = useRef(new Map<string, TextInput | null>());
  const typed = useRef<Record<string, string>>({});

  useEffect(() => { if (params.gym) setGid(params.gym); }, [params.gym]);
  useEffect(() => { if (params.s) setSid(params.s); }, [params.s]);
  useEffect(() => { if (params.it) setItKey(params.it); }, [params.it]);

  /* ----- the gym, today's classes and workout ----- */
  const load = useCallback(async () => {
    if (!me) return;
    setErr('');
    try {
      let id = gid;
      if (!id) { const mine = await myGyms(me); id = mine[0]?.gym_id ?? null; if (id) setGid(id); }
      const role = await staffRole(me, id);
      setAllowed(!!role);
      if (!role || !id) return;
      const g = await gymById(id);
      if (!g) { setErr('No gym here'); return; }
      const day = dayIn(g.tz);
      const [ss, wr, board, ms] = await Promise.all([
        sessionsFor(g, day, day),
        sb.from('workouts').select('*').eq('gym_id', id).eq('day', day).maybeSingle(),
        loadBoard(),
        sb.from('profiles').select('id,display_name,sex').eq('gym_id', id).not('display_name', 'is', null).order('display_name'),
      ]);
      if (wr.error) throw wr.error;
      const live = ss.filter(x => x.status !== 'canceled'), now = Date.now();
      const auto = live.find(x => Date.parse(x.starts_at) <= now && Date.parse(x.ends_at) >= now) || live.find(x => Date.parse(x.starts_at) > now) || live[live.length - 1] || null;
      setD({ g, day, w: (wr.data as Workout) ?? null, live, members: (ms.data ?? []) as Member[], board, auto: auto?.id ?? null });
    } catch (e: any) { setErr(e.message ?? String(e)); }
  }, [me?.id, gid]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const its: Item[] = d?.w ? items(d.w) : [];
  const it = its.find(i => i.key === itKey) || its.find(i => i.kind === 'w') || its[0] || null;
  const live = d?.live ?? [];
  const pick = live.find(x => x.id === sid) || live.find(x => x.id === d?.auto) || null;

  /* ----- who is in the class, and what they have logged ----- */
  const loadClass = useCallback(async () => {
    if (!d?.w) { setPeople([]); return; }
    try {
      const bk = pick ? ((await sb.from('bookings').select('profile_id,status').eq('session_id', pick.id).in('status', ['booked', 'attended']).order('created_at')).data ?? []) as { profile_id: string; status: 'booked' | 'attended' }[] : [];
      const ids = [...bk.map(b => b.profile_id), ...added.filter(a => !bk.some(b => b.profile_id === a))];
      const memberBy = new Map(d.members.map(m => [m.id, m.display_name]));
      const extra = await people(ids.filter(x => !memberBy.has(x)));
      const nm = new Map([...extra, ...memberBy]);
      const { data: logs } = ids.length ? await sb.from('workout_logs').select('workout_id,profile_id,entries,score,sets').eq('workout_id', d.w.id).in('profile_id', ids) : { data: [] };
      logOf.current = new Map(((logs ?? []) as LogRow[]).map(l => [l.profile_id, l]));
      const list: Person[] = [...bk.map(b => ({ id: b.profile_id, status: b.status })), ...ids.slice(bk.length).map(x => ({ id: x, status: 'added' as const }))];
      const name = (x: string) => nm.get(x) || 'Member';
      list.sort((a, b) => Number(b.status === 'attended') - Number(a.status === 'attended') || name(a.id).localeCompare(name(b.id)));
      setNames(nm);
      setPeople(list);
    } catch (e: any) { setErr(e.message ?? String(e)); setPeople([]); }
  }, [d, pick?.id, added]);
  useFocusEffect(useCallback(() => { loadClass(); }, [loadClass]));

  // Box values for the part on screen, from what each person has logged.
  const shown = (pid: string, item: Item) => { const v = logOf.current.get(pid)?.entries?.[item.key]; return item.kind === 't' ? fmtT(v) : v == null ? '' : String(v); };
  const boxKey = (pid: string) => `${it?.key}|${pid}`;
  const valOf = (pid: string) => (it ? vals[boxKey(pid)] ?? shown(pid, it) : '');
  const nameOf = (pid: string) => names.get(pid) || 'Member';
  const rowOf = (pid: string): any => d?.board.find(r => r.profile_id === pid) || { sex: d?.members.find(m => m.id === pid)?.sex };
  const tgt = (pid: string) => (it && it.kind === 'w' && it.lift ? target(it.lift, rowOf(pid)) : 0);
  const prLift = d?.w?.pr_lift ? LIFTS.find(l => l.db === d.w!.pr_lift) : undefined;
  const isPrDay = !!(it && it.kind === 'w' && it.lift?.max && prLift);

  /* ----- save one box ----- */
  const parse = (item: Item, raw: string): { empty?: true; x?: number; bad?: string } => {
    const v = String(raw).trim(); if (!v) return { empty: true };
    if (item.kind === 't') { const x = parseT(v); return x > 0 ? { x } : { bad: `"${v}" is not a time. Use minutes and seconds, like 8:45.` }; }
    if (item.kind === 'r') return { x: clampR(v) };
    const x = clampW(v);
    return x > 0 ? { x } : { bad: `"${v}" is not a weight.` };
  };
  const setSt = (key: string, v: St | null) => setSts(cur => { const n = { ...cur }; if (v) n[key] = v; else delete n[key]; return n; });

  async function doSave(pid: string, item: Item, raw: string) {
    if (!d?.w || !me) return;
    const w = d.w, key = `${item.key}|${pid}`, r = parse(item, raw);
    if (r.bad) { setSt(key, { k: 'bad', msg: r.bad }); return; }
    const had = logOf.current.get(pid), entries = { ...(had?.entries ?? {}) };
    const same = r.empty ? !(item.key in entries) : entries[item.key] === r.x;
    if (same) { setSts(cur => { if (cur[key]?.k !== 'bad' && cur[key]?.k !== 'off') return cur; const n = { ...cur }; delete n[key]; return n; }); return; }
    if (r.empty) delete entries[item.key]; else entries[item.key] = r.x!;
    setSt(key, { k: 'saving' });
    const row: LogRow = { workout_id: w.id, profile_id: pid, entries, score: had?.score || null, sets: had?.sets || {} };
    const error = await upsertLogs([row], me.id);
    if (error) { setSt(key, { k: 'off', msg: saveError(error, nameOf(pid), d.g.name) }); return; }
    logOf.current.set(pid, row);
    // The box now shows what was saved (times tidied to m:ss), unless the coach has typed again since.
    if (typed.current[key] === raw) { delete typed.current[key]; setVals(cur => { const n = { ...cur }; delete n[key]; return n; }); }
    setSt(key, r.empty ? null : { k: 'saved' });
    // Max out day: a new best becomes a PR for the DSI and the PR wall.
    const prDay = item.kind === 'w' && item.lift?.max && prLift;
    if (prDay && !r.empty && w.pr_lift) {
      const br = rowOf(pid), best = num(br[prLift.k]);
      if (r.x! > best) {
        const { data, error: e2 } = await sb.from('lift_entries').insert({
          profile_id: pid, lift: w.pr_lift, weight_lb: r.x, performed_on: d.day, source: 'workout', entered_by: me.id, note: `Entered by ${me.display_name} in class`,
        }).select().single();
        if (!e2 && data?.is_pr) {
          br[prLift.k] = r.x;
          setSt(key, { k: 'pr', msg: `New ${liftName(w.pr_lift)} PR for ${nameOf(pid)}: ${r.x} lb` });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        } else if (e2) {
          setSt(key, { k: 'saved', msg: `Saved. ${nameOf(pid)} can confirm the PR from their own log.` });
        }
      }
    }
  }
  // One save at a time per box, so a blur and a Save tap never race.
  function save(pid: string, item: Item | null = it) {
    if (!item) return;
    const key = `${item.key}|${pid}`, raw = typed.current[key] ?? shown(pid, item);
    const prev = inflight.current.get(key) ?? Promise.resolve();
    const next = prev.then(() => doSave(pid, item, raw)).catch(e => setSt(key, { k: 'off', msg: e?.message ?? String(e) }));
    inflight.current.set(key, next);
    return next;
  }
  // Save every box still being typed before switching class or part.
  function flush() {
    if (!it || !people_) return;
    for (const p of people_) { const k = boxKey(p.id); if (k in typed.current && typed.current[k] !== shown(p.id, it)) save(p.id, it); }
  }
  function switchTo(next: { s?: string; it?: string }) {
    Keyboard.dismiss(); flush();
    if (next.s !== undefined && next.s !== pick?.id) { setSid(next.s); setAdded([]); setAdding(false); setQ(''); setNote(''); }
    if (next.it !== undefined) setItKey(next.it);
  }

  async function add(pid: string) {
    setNote('');
    if (pick) {
      try { await checkIn(pick.id, pid, true); setNote('Added and checked in'); }
      catch (e: any) { setNote(e.message); return; }
    }
    setAdded(a => (a.includes(pid) ? a : [...a, pid]));
    setQ(''); setAdding(false);
  }

  /* ----- screens ----- */
  const head = <Stack.Screen options={{ title: 'Log a class' }} />;
  if (!session) return (
    <Screen stack>{head}
      <Card>
        <Text style={st.h}>Sign in to log a class</Text>
        <Muted style={st.p}>Members log lifts, chat and file protests. Boards and PRs stay public.</Muted>
        <Btn label="Sign in" onPress={() => router.push('/login')} style={{ marginTop: 12 }} />
      </Card>
    </Screen>
  );
  if (!me) return <Screen stack>{head}<Loading /></Screen>;
  if (allowed === false) return (
    <Screen stack>{head}
      <Card>
        <Text style={st.h}>Coaches only</Text>
        <Muted style={st.p}>Gym owners and coaches log weights for their classes here.</Muted>
        <Btn ghost label="Back" onPress={back} style={{ marginTop: 12 }} />
      </Card>
    </Screen>
  );
  if (err) return <Screen stack>{head}<Card><Muted style={{ color: C.down }}>{err}</Muted></Card><Btn ghost label="Try again" onPress={load} /></Screen>;
  if (!d) return <Screen stack>{head}<Loading /></Screen>;

  const { g, w, day } = d;
  if (!w) return (
    <Screen stack>{head}
      <Card>
        <Text style={st.h}>No workout posted for today</Text>
        <Muted style={st.p}>Post today's workout first, then log the class against it.</Muted>
        <Btn label="Post the workout" onPress={() => openWeb(`/wod/${g.id}?day=${day}`)} style={{ marginTop: 12 }} />
        <Btn ghost label="Plan builder" onPress={() => openWeb(`/plan/${g.id}`)} style={{ marginTop: 8 }} />
      </Card>
    </Screen>
  );
  if (!it) return (
    <Screen stack>{head}
      <Card>
        <Text style={st.h}>Nothing to log today</Text>
        <Muted style={st.p}>Today's workout has no weight, time or reps to record. Turn one on in the workout editor.</Muted>
        <Btn label="Edit the workout" onPress={() => openWeb(`/wod/${g.id}?day=${day}`)} style={{ marginTop: 12 }} />
      </Card>
    </Screen>
  );

  const ids = new Set((people_ ?? []).map(p => p.id));
  const find = q.trim().toLowerCase();
  const matches = find ? d.members.filter(m => !ids.has(m.id) && m.display_name.toLowerCase().includes(find)).slice(0, 8) : [];
  const what = it.kind === 't' ? 'time' : it.kind === 'r' ? 'total reps' : 'weight';
  const rule = it.lift ? liftRule(it.lift) : '';
  const kb = it.kind === 'w' ? 'decimal-pad' : it.kind === 'r' ? 'number-pad' : Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default';
  const order = people_ ?? [];

  return (
    <OfficeScreen>
      {head}
      <Title eyebrow={`${pick ? `${tAt(pick.starts_at, g.tz)} ${pick.name}` : 'Today'} · ${w.title}`} accent="class">Log the</Title>
      <Muted style={{ fontSize: 15, marginTop: -6, marginBottom: 10 }}>
        Type each person's {what} as they finish. Every box saves on its own and goes straight to the board and the TV.{isPrDay ? ' Today is a max out day, so a new best counts as a PR.' : ''}
      </Muted>
      {live.length > 1 ? (<>
        <Eyebrow style={{ marginBottom: 6 }}>Class</Eyebrow>
        <View style={st.chips}>{live.map(x => <Chip key={x.id} label={`${tAt(x.starts_at, g.tz)} ${x.name}`} on={!!pick && x.id === pick.id} onPress={() => switchTo({ s: x.id })} />)}</View>
      </>) : null}
      <Eyebrow style={{ marginBottom: 6 }}>Part</Eyebrow>
      <View style={st.chips}>{its.map(i => <Chip key={i.key} label={i.label} on={i.key === it.key} onPress={() => switchTo({ it: i.key })} />)}</View>
      {it.lift ? (
        <Muted style={{ fontSize: 14, marginBottom: 10 }}>
          <Text style={{ color: C.ink, fontWeight: '700' }}>{it.lift.n}</Text> {it.sch || ''}{rule ? ' · ' + rule : ''}. The grey number is each person's target.
        </Muted>
      ) : null}

      {!pick ? (
        <Card>
          <Text style={st.h}>No classes today</Text>
          <Muted style={st.p}>Set up the weekly classes on the Schedule page, or add people below to log them anyway.</Muted>
        </Card>
      ) : null}

      {!people_ ? <Loading /> : !order.length && pick ? <Card><Muted>Nobody booked yet.</Muted></Card> : null}
      {order.length ? (
        <View style={st.list}>
          {order.map((p, i) => {
            const key = boxKey(p.id), stt = sts[key], t = tgt(p.id), v = valOf(p.id);
            const saved = !stt && v !== '' && v === shown(p.id, it);
            return (
              <View key={p.id} style={[st.item, i === 0 && { borderTopWidth: 0 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Text style={{ color: C.ink, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{nameOf(p.id)}</Text>
                  {p.status === 'attended' ? <Pill label="Here" tone="up" /> : p.status === 'booked' ? <Pill label="Booked" /> : <Pill label="Added" />}
                  <View style={{ flex: 1 }} />
                  {stt?.k === 'saving' ? <Pill label="Saving" />
                    : stt?.k === 'pr' ? <Pill label="PR" tone="acc" />
                    : stt?.k === 'bad' ? <Pill label="Check it" tone="down" />
                    : stt?.k === 'off' ? <Pill label="Not saved" tone="down" />
                    : stt?.k === 'saved' || saved ? <Pill label="✓ Saved" tone="up" /> : null}
                </View>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'center' }}>
                  <TextInput
                    ref={r => { inputs.current.set(p.id, r); }}
                    value={v}
                    onChangeText={x => { typed.current[key] = x; setVals(cur => ({ ...cur, [key]: x })); if (stt && stt.k !== 'saving') setSt(key, null); }}
                    onEndEditing={() => save(p.id)}
                    onSubmitEditing={() => { const nx = order[i + 1]; if (nx) inputs.current.get(nx.id)?.focus(); }}
                    returnKeyType={order[i + 1] ? 'next' : 'done'}
                    submitBehavior={order[i + 1] ? 'submit' : 'blurAndSubmit'}
                    keyboardType={kb}
                    maxLength={it.kind === 't' ? 8 : 7}
                    placeholder={it.kind === 't' ? 'm:ss' : it.kind === 'r' ? 'reps' : t ? String(t) : 'lb'}
                    placeholderTextColor="#5A6478"
                    accessibilityLabel={`${nameOf(p.id)} ${it.kind === 't' ? 'time' : it.kind === 'r' ? 'reps' : 'weight in pounds'}`}
                    style={[s.input, { flex: 1, minWidth: 0, textAlign: 'center' }]}
                  />
                  <Btn label="Save" onPress={() => { Keyboard.dismiss(); save(p.id); }} disabled={stt?.k === 'saving'} style={{ width: 84, paddingHorizontal: 0 }} />
                </View>
                {it.kind === 'w' && t ? <Muted style={{ marginTop: 4 }}>Target {t} lb</Muted> : null}
                {stt?.msg ? <Text style={{ marginTop: 4, fontSize: 13, color: stt.k === 'pr' ? C.accent : stt.k === 'saved' ? C.muted : C.down }}>{stt.msg}</Text> : null}
              </View>
            );
          })}
        </View>
      ) : null}

      <View style={{ marginTop: 12 }}>
        {adding ? (<>
          <TextInput value={q} onChangeText={setQ} autoFocus placeholder="Search members by name" placeholderTextColor="#5A6478"
            autoCapitalize="words" autoCorrect={false} accessibilityLabel="Add someone to this class" style={s.input} />
          {find && !matches.length ? <Muted style={{ marginTop: 8 }}>No member by that name.</Muted> : null}
          {matches.map(m => (
            <Pressable key={m.id} accessibilityRole="button" accessibilityLabel={`Add ${m.display_name}`} onPress={() => add(m.id)}
              style={({ pressed }) => [st.pick, pressed && { opacity: 0.6 }]}>
              <Text style={{ color: C.ink, fontSize: 16, fontWeight: '600', flex: 1 }}>{m.display_name}</Text>
              <Text style={{ color: C.accent, fontSize: 12, fontWeight: '700' }}>{pick ? 'Add and check in' : 'Add'}</Text>
            </Pressable>
          ))}
          <Btn ghost label="Done" onPress={() => { setAdding(false); setQ(''); }} style={{ height: 44, marginTop: 8 }} />
        </>) : <Btn ghost label="Add someone to this class" onPress={() => { setAdding(true); setNote(''); }} />}
        {note ? <Muted style={{ marginTop: 8, textAlign: 'center' }}>{note}</Muted> : null}
      </View>

      <View style={{ height: 18 }} />
      <Group>
        <Row first label="All of today's results" onPress={() => { Keyboard.dismiss(); flush(); router.push({ pathname: '/office/results', params: { gym: g.id } }); }} />
        <Row label="Big screen" detail="Website" onPress={() => openWeb(tvHref(g))} />
      </Group>
    </OfficeScreen>
  );
}

const st = {
  h: { color: C.ink, fontSize: 17, fontWeight: '800' as const },
  p: { fontSize: 15, marginTop: 4 },
  chips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, marginBottom: 6 },
  list: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 12, overflow: 'hidden' as const },
  item: { paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.line },
  pick: { flexDirection: 'row' as const, alignItems: 'center' as const, minHeight: 48, paddingHorizontal: 12, marginTop: 6, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel2 },
};
