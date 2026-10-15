// Enter results: coaches type each member's numbers for the gym's workout of the day.
// Same rules and words as VIEWS.results in site/js/gym.js. Params: gym (required), day (YYYY-MM-DD, default today at the gym).
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Text, TextInput, View } from 'react-native';

import { Btn, Card, Chip, Group, Loading, Muted, Row, s, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { addDays, loadBoard, target, type BoardRow } from '@/lib/data';
import {
  clampR, clampW, dayIn, fmtDW, gymById, myGyms, OfficeScreen, openWeb, Pill, saveError, staffRole, tvHref, upsertLogs,
  type Gym, type LogRow,
} from '@/lib/office';
import { fmtT, items, parseT, type Item, type Workout } from '@/lib/parts';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

type Member = { id: string; display_name: string; bodyweight: number | null; birth_year: number | null; sex: string | null };
type St = { k: 'saving' | 'saved' | 'bad' | 'off' | 'note'; msg?: string };
type Data = { g: Gym; day: string; w: Workout | null; members: Member[]; board: BoardRow[] };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const back = () => (router.canGoBack() ? router.back() : router.replace('/office'));
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);

export default function Results() {
  const params = useLocalSearchParams<{ gym?: string; day?: string }>();
  const { me, session } = useSession();
  const [gid, setGid] = useState<string | null>(params.gym || null);
  const [day, setDay] = useState<string | null>(params.day && DAY.test(params.day) ? params.day : null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [vals, setVals] = useState<Record<string, string>>({});
  const [sts, setSts] = useState<Record<string, St>>({});
  const [find, setFind] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const logOf = useRef(new Map<string, LogRow>());
  const typed = useRef<Record<string, string>>({});
  const shownFor = useRef('');

  useEffect(() => { if (params.gym) setGid(params.gym); }, [params.gym]);
  useEffect(() => { if (params.day && DAY.test(params.day)) setDay(params.day); }, [params.day]);

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
      if (!g) { setErr('No gym here.'); return; }
      const on = day ?? dayIn(g.tz);
      const [wr, ms, board] = await Promise.all([
        sb.from('workouts').select('*').eq('gym_id', id).eq('day', on).maybeSingle(),
        sb.from('profiles').select('id,display_name,bodyweight,birth_year,sex').eq('gym_id', id).not('display_name', 'is', null),
        loadBoard(),
      ]);
      if (wr.error) throw wr.error;
      const w = (wr.data as Workout) ?? null;
      const { data: logs } = w ? await sb.from('workout_logs').select('workout_id,profile_id,entries,score,sets').eq('workout_id', w.id) : { data: [] };
      logOf.current = new Map(((logs ?? []) as LogRow[]).map(l => [l.profile_id, l]));
      // A new gym or day starts clean; coming back to the same day keeps anything typed but not saved yet.
      if (shownFor.current !== `${id}|${on}`) { shownFor.current = `${id}|${on}`; typed.current = {}; setVals({}); setSts({}); setMsg(''); }
      const members = ((ms.data ?? []) as Member[]).sort((a, b) => a.display_name.localeCompare(b.display_name));
      setD({ g, day: on, w, members, board });
    } catch (e: any) { setErr(e.message ?? String(e)); }
  }, [me?.id, gid, day]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  /* ----- values ----- */
  const its: Item[] = d?.w ? items(d.w) : [];
  const shown = (pid: string, it: Item | 'score') => {
    const lg = logOf.current.get(pid);
    if (it === 'score') return lg?.score ?? '';
    const v = lg?.entries?.[it.key];
    return it.kind === 't' ? fmtT(v) : v == null ? '' : String(v);
  };
  const kOf = (pid: string, it: Item | 'score') => `${pid}|${it === 'score' ? 'score' : it.key}`;
  const valOf = (pid: string, it: Item | 'score') => vals[kOf(pid, it)] ?? shown(pid, it);
  const setVal = (pid: string, it: Item | 'score', v: string) => {
    const k = kOf(pid, it);
    typed.current[k] = v;
    setVals(cur => ({ ...cur, [k]: v }));
    setSts(cur => { if (!cur[pid] || cur[pid].k === 'saving') return cur; const n = { ...cur }; delete n[pid]; return n; });
  };
  const dirty = (pid: string) => [...its, 'score' as const].some(it => { const k = kOf(pid, it); return k in typed.current && typed.current[k] !== shown(pid, it); });
  const rowOf = (m: Member): any => d?.board.find(r => r.profile_id === m.id)
    || { profile_id: m.id, sex: m.sex, bw: num(m.bodyweight) || 185, age: m.birth_year ? new Date().getFullYear() - m.birth_year : 30, bench: 0, squat: 0, dead: 0, clean: 0 };

  /* ----- build and save one member's row, like the web form ----- */
  function build(pid: string): { row?: LogRow; bad?: string; none?: true } {
    if (!d?.w) return { none: true };
    const had = logOf.current.get(pid), entries: Record<string, number> = { ...(had?.entries ?? {}) };
    let any = false, bad = '';
    for (const it of its) {
      const v = (typed.current[kOf(pid, it)] ?? shown(pid, it)).trim();
      if (!v) { delete entries[it.key]; continue; }
      const x = it.kind === 't' ? parseT(v) : it.kind === 'r' ? clampR(v) : clampW(v);
      if (it.kind === 't' && !(x > 0)) { bad = bad || `"${v}" is not a time. Use minutes and seconds, like 8:45.`; continue; }
      entries[it.key] = x; any = true;
    }
    if (bad) return { bad };
    const score = d.w.score_label ? (typed.current[kOf(pid, 'score')] ?? shown(pid, 'score')).trim().slice(0, 40) : (had?.score ?? '');
    if (!any && !score && !had) return { none: true };
    return { row: { workout_id: d.w.id, profile_id: pid, entries, score: score || null, sets: had?.sets ?? {} } };
  }
  async function saveOne(m: Member): Promise<boolean> {
    if (!me || !d) return false;
    if (!dirty(m.id)) { setSts(cur => ({ ...cur, [m.id]: { k: 'note', msg: 'Nothing to save yet.' } })); return false; }
    const b = build(m.id);
    if (b.bad) { setSts(cur => ({ ...cur, [m.id]: { k: 'bad', msg: b.bad } })); return false; }
    if (b.none || !b.row) { setSts(cur => ({ ...cur, [m.id]: { k: 'note', msg: 'Nothing to save yet.' } })); return false; }
    setSts(cur => ({ ...cur, [m.id]: { k: 'saving' } }));
    const snap = Object.fromEntries([...its, 'score' as const].map(it => [kOf(m.id, it), typed.current[kOf(m.id, it)]]));
    const error = await upsertLogs([b.row], me.id);
    if (error) { setSts(cur => ({ ...cur, [m.id]: { k: 'off', msg: saveError(error, m.display_name, d.g.name) } })); return false; }
    logOf.current.set(m.id, b.row);
    // Boxes now show what was saved, unless the coach typed again while it saved.
    const clear = Object.keys(snap).filter(k => typed.current[k] === snap[k]);
    clear.forEach(k => { delete typed.current[k]; });
    setVals(cur => { const n = { ...cur }; clear.forEach(k => { delete n[k]; }); return n; });
    setSts(cur => ({ ...cur, [m.id]: { k: 'saved' } }));
    return true;
  }
  async function saveAll() {
    if (!d) return;
    Keyboard.dismiss();
    const todo = d.members.filter(m => dirty(m.id));
    if (!todo.length) { setMsg('Nothing to save yet.'); return; }
    setBusy(true); setMsg('Saving…');
    const ok = (await Promise.all(todo.map(saveOne))).filter(Boolean).length;
    setBusy(false);
    setMsg(ok === todo.length ? `Saved ${ok} result${ok === 1 ? '' : 's'}` : `Saved ${ok} of ${todo.length}. Check the ones marked below.`);
  }

  /* ----- screens ----- */
  const head = <Stack.Screen options={{ title: 'Enter results' }} />;
  if (!session) return (
    <Screen stack>{head}
      <Card>
        <Text style={st.h}>Sign in to enter results</Text>
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
        <Muted style={st.p}>Gym owners and coaches enter results here.</Muted>
        <Btn ghost label="Back" onPress={back} style={{ marginTop: 12 }} />
      </Card>
    </Screen>
  );
  if (err) return <Screen stack>{head}<Card><Muted style={{ color: C.down }}>{err}</Muted></Card><Btn ghost label="Try again" onPress={load} /></Screen>;
  if (!d) return <Screen stack>{head}<Loading /></Screen>;

  const { g, w } = d;
  const todayHere = dayIn(g.tz), cur = day ?? d.day;
  const nav = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
      <Chip label="← Day before" on={false} onPress={() => setDay(addDays(cur, -1))} />
      {cur !== todayHere ? <Chip label="Today" on={false} onPress={() => setDay(todayHere)} /> : null}
      <Chip label="Next day →" on={false} onPress={() => setDay(addDays(cur, 1))} />
    </View>
  );
  if (!w) return (
    <Screen stack>{head}
      <Title eyebrow={`${g.name} · ${fmtDW(d.day)}`} accent="results">Enter</Title>
      {nav}
      <Card>
        <Text style={st.h}>{g.name} has no workout posted for this day</Text>
        <Muted style={st.p}>Results go on your own gym's workout. Post it first.</Muted>
        <Btn label="Post the workout" onPress={() => openWeb(`/wod/${g.id}?day=${d.day}`)} style={{ marginTop: 12 }} />
      </Card>
    </Screen>
  );

  const q = find.trim().toLowerCase();
  const list = q ? d.members.filter(m => m.display_name.toLowerCase().includes(q)) : d.members;
  const timeKb = Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default';

  return (
    <OfficeScreen>
      {head}
      <Title eyebrow={`${g.name} · ${fmtDW(d.day)}`}>{w.title}</Title>
      {nav}
      {cur !== d.day ? <Loading /> : null}
      <Muted style={{ fontSize: 15, marginBottom: 12 }}>
        Type the weight each member used, their time where a part is timed (like 8:45), and total reps where a part counts reps. Blank means they did not do it. Targets show in grey.
      </Muted>

      {d.members.length > 8 ? (
        <TextInput value={find} onChangeText={setFind} placeholder="Find a member" placeholderTextColor="#5A6478" autoCorrect={false}
          accessibilityLabel="Find a member by name" style={[s.input, { marginBottom: 10 }]} />
      ) : null}

      {!d.members.length ? <Card><Muted>No members yet. Members pick {g.name} on the Gym league page.</Muted></Card> : null}
      {q && !list.length ? <Card><Muted>No member by that name.</Muted></Card> : null}

      {list.map(m => {
        const r = rowOf(m), lg = logOf.current.get(m.id), stt = sts[m.id];
        return (
          <Card key={m.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
              <Text style={{ color: C.ink, fontSize: 17, fontWeight: '800' }}>{m.display_name}</Text>
              {lg ? <Pill label="Logged" tone="up" /> : null}
              <View style={{ flex: 1 }} />
              {stt?.k === 'saving' ? <Pill label="Saving" /> : stt?.k === 'saved' ? <Pill label="✓ Saved" tone="up" />
                : stt?.k === 'bad' ? <Pill label="Check it" tone="down" /> : stt?.k === 'off' ? <Pill label="Not saved" tone="down" /> : null}
            </View>
            {its.map(it => {
              const t = it.kind === 'w' && it.lift ? target(it.lift, r) : 0;
              return (
                <View key={it.key} style={st.line}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: C.ink, fontWeight: '600', fontSize: 14 }} numberOfLines={2}>{it.label}</Text>
                    <Muted style={{ fontSize: 12 }}>{it.sch || (it.kind === 't' ? 'm:ss' : '')}</Muted>
                  </View>
                  <TextInput value={valOf(m.id, it)} onChangeText={v => setVal(m.id, it, v)}
                    keyboardType={it.kind === 'w' ? 'decimal-pad' : it.kind === 'r' ? 'number-pad' : timeKb}
                    maxLength={it.kind === 't' ? 8 : 7}
                    placeholder={it.kind === 't' ? 'm:ss' : it.kind === 'r' ? 'reps' : t ? String(t) : ''} placeholderTextColor="#5A6478"
                    accessibilityLabel={`${m.display_name} ${it.label}`} style={[s.input, st.box]} />
                </View>
              );
            })}
            {w.score_label ? (
              <View style={st.line}>
                <Text style={{ color: C.ink, fontWeight: '600', fontSize: 14, flex: 1 }} numberOfLines={2}>{w.score_label}</Text>
                <TextInput value={valOf(m.id, 'score')} onChangeText={v => setVal(m.id, 'score', v)} maxLength={40}
                  keyboardType={w.score_type === 'time' ? timeKb : 'default'}
                  placeholder={w.score_type === 'time' ? '12:34' : ''} placeholderTextColor="#5A6478"
                  accessibilityLabel={`${m.display_name} ${w.score_label}`} style={[s.input, st.box]} />
              </View>
            ) : null}
            {stt?.msg ? <Text style={{ color: stt.k === 'note' ? C.muted : C.down, fontSize: 13, marginTop: 6 }}>{stt.msg}</Text> : null}
            <Btn ghost label="Save" onPress={() => { Keyboard.dismiss(); saveOne(m); }} disabled={busy || stt?.k === 'saving'} style={{ height: 44, marginTop: 10 }} />
          </Card>
        );
      })}

      {d.members.length ? <Btn label="Save results" onPress={saveAll} disabled={busy} style={{ marginTop: 6 }} /> : null}
      {msg ? <Muted style={{ marginTop: 10, textAlign: 'center' }}>{msg}</Muted> : null}

      <View style={{ height: 18 }} />
      <Group>
        <Row first label="Edit this workout" detail="Website" onPress={() => openWeb(`/wod/${g.id}?day=${d.day}`)} />
        <Row label="Dandy TV" detail="Website" onPress={() => openWeb(tvHref(g))} />
      </Group>
    </OfficeScreen>
  );
}

const st = {
  h: { color: C.ink, fontSize: 17, fontWeight: '800' as const },
  p: { fontSize: 15, marginTop: 4 },
  line: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, marginTop: 8 },
  box: { width: 116, flexShrink: 0, textAlign: 'center' as const, height: 48, fontSize: 17 },
};
