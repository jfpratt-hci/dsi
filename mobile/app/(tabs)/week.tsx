import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';

import { Btn, Card, Chip, Eyebrow, Loading, Mono, Muted, ProBadge, s, Screen, Title } from '@/components/ui';
import { C, liftColor } from '@/constants/Colors';
import { addDays, fmt, fmtD, keyOf, liftName, loadBoard, monday, target, today, type BoardRow, workoutsQuery } from '@/lib/data';
import { scheduleReminders } from '@/lib/notify';
import { boardItems, cell, fmtT, isParts, items, liftRule, logWords, parseT, shownParts, sortDay, type Item, type Workout } from '@/lib/parts';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

export type { Workout } from '@/lib/parts';
type Log = { id: string; workout_id: string; profile_id: string; entries: Record<string, number> | null; score: string | null; sets?: Record<string, { w: number; r: number }[]> | null; status?: string };
type Staff = { gym_id: string; role: string };

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);
const timeKb = Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default';

export default function Week() {
  const { me, isPro, blocked } = useSession();
  const myGym = me?.gym_id ?? null, myId = me?.id ?? null;
  const [start, setStart] = useState(monday(today()));
  const [day, setDay] = useState(today());
  const [src, setSrc] = useState<'gym' | 'dsi'>('gym');
  const [all, setAll] = useState<Workout[] | null>(null);
  const [gymName, setGymName] = useState<string | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [actual, setActual] = useState<Record<string, string>>({});
  const [score, setScore] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [showProg, setShowProg] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ data }, b, g, st] = await Promise.all([
        workoutsQuery(sb.from('workouts').select('*').gte('day', start).lte('day', addDays(start, 6)).order('day'), myGym),
        loadBoard(),
        myGym ? sb.from('gyms').select('id,name').eq('id', myGym).maybeSingle().then(r => r.data as { id: string; name: string } | null) : Promise.resolve(null),
        myId ? sb.from('gym_staff').select('gym_id,role').eq('profile_id', myId).then(r => (r.data as Staff[]) ?? []) : Promise.resolve([] as Staff[]),
      ]);
      const rows = (data as Workout[]) ?? [];
      const ids = rows.map(x => x.id);
      let mineIds = new Set<string>();
      if (myId && ids.length) {
        const { data: ml } = await sb.from('workout_logs').select('workout_id').eq('profile_id', myId).in('workout_id', ids);
        mineIds = new Set(((ml as { workout_id: string }[]) ?? []).map(r => r.workout_id));
      }
      setAll(rows); setDone(mineIds); setGymName(g?.name ?? null); setStaff(st);
      setBoard(b);
      setNames(prev => ({ ...prev, ...Object.fromEntries(b.map(r => [r.profile_id, r.name])) }));
      setErr('');
    } catch (e: any) {
      setErr(e?.message ?? 'Could not load the week.');
      setAll(prev => prev ?? []);
    }
  }, [start, myGym, myId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // A member of a gym that posts its own programming picks the gym or the DSI week.
  const hasGym = !!(myGym && all?.some(x => x.gym_id === myGym));
  const source = hasGym ? src : 'dsi';
  const wks = useMemo(() => (all ? all.filter(x => (source === 'gym' ? x.gym_id === myGym : !x.gym_id)) : null), [all, source, myGym]);
  const w = useMemo(() => wks?.find(x => x.day === day), [wks, day]);
  const mine = me ? board.find(b => b.profile_id === me.id) ?? null : null;
  const base = mine ?? { bw: Number(me?.bodyweight) || 200, sex: me?.sex, bench: 0, squat: 0, dead: 0, clean: 0 };
  const its = useMemo(() => items(w), [w]);

  // A new day starts with empty boxes so nothing from the last day can be saved onto it.
  const shown = useRef<string | null>(null);
  useEffect(() => { shown.current = w?.id ?? null; setActual({}); setScore(''); setMsg(''); }, [w?.id]);

  // Everyone's logs for the day (the day board) and my own numbers in the boxes.
  const loadLogs = useCallback(async (note?: string) => {
    const cur = w;
    if (!cur) { setLogs([]); setActual({}); setScore(''); setMsg(''); return; }
    const { data } = await sb.from('workout_logs').select('id,workout_id,profile_id,entries,score,sets,status').eq('workout_id', cur.id);
    if (shown.current !== cur.id) return; // the lifter moved to another day while this loaded
    const list = (data as Log[]) ?? [];
    setLogs(list);
    const my = myId ? list.find(l => l.profile_id === myId) : null;
    const vals: Record<string, string> = {};
    if (my) for (const it of items(cur)) {
      const v = my.entries?.[it.key];
      if (it.kind === 't') { const t = fmtT(v); if (t) vals[it.key] = t; } else if (v != null) vals[it.key] = String(v);
    }
    setActual(vals); setScore(my?.score ?? '');
    setMsg(note ?? (my ? 'Logged. Update any time.' : ''));
    // Lifters with no PRs yet are not on the board; fetch their names.
    const missing = [...new Set(list.map(l => l.profile_id))].filter(id => !names[id]);
    if (missing.length) {
      const { data: ps } = await sb.from('profiles').select('id,display_name').in('id', missing);
      if (ps?.length) setNames(prev => ({ ...prev, ...Object.fromEntries((ps as { id: string; display_name: string | null }[]).map(p => [p.id, p.display_name ?? 'Lifter'])) }));
    }
    // Keyed on the day's id (not the object, which is new after every reload); names only skips lookups.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w?.id, myId]);
  useFocusEffect(useCallback(() => { loadLogs(); }, [loadLogs]));

  async function save() {
    if (!me || !w) { router.push('/login'); return; }
    if (!isPro) { router.push('/pro'); return; }
    const entries: Record<string, number> = {};
    let bad = '';
    for (const it of its) {
      const v = (actual[it.key] ?? '').trim();
      if (!v) continue;
      if (it.kind === 't') { const x = parseT(v); if (x > 0) entries[it.key] = x; else bad = `"${v}" is not a time. Use minutes and seconds, like 8:45.`; }
      else if (it.kind === 'r') entries[it.key] = Math.max(0, Math.min(99999, Math.round(Number(v)) || 0));
      else entries[it.key] = Math.max(0, Math.min(1499, Math.round(Number(v) * 2) / 2 || 0));
    }
    if (bad) { setMsg(bad); return; }
    const sc = w.score_label ? score.trim().slice(0, 40) : '';
    if (!Object.keys(entries).length && !sc) { setMsg('Enter at least one number.'); return; }
    setBusy(true); setMsg('Saving…');
    const { error } = await sb.from('workout_logs').upsert({ workout_id: w.id, profile_id: me.id, entries, score: sc || null }, { onConflict: 'workout_id,profile_id' });
    if (error) { setBusy(false); setMsg(error.message); return; }
    scheduleReminders(me).catch(() => {});
    setDone(prev => new Set(prev).add(w.id));
    let note = 'Logged. You are on the day board.';
    if (w.pr_lift) {
      const maxItem = (w.lifts ?? []).find(l => l.max && entries[l.id]);
      const best = num((base as Record<string, unknown>)[keyOf(w.pr_lift)]);
      if (maxItem && entries[maxItem.id] > best) {
        const { data } = await sb.from('lift_entries').insert({ profile_id: me.id, lift: w.pr_lift, weight_lb: entries[maxItem.id], performed_on: w.day, source: 'workout' }).select().single();
        if (data?.is_pr && data.prev_best) { setBusy(false); router.push({ pathname: '/pr/[id]', params: { id: data.id, celebrate: '1' } }); loadLogs(); return; }
        if (data?.is_pr) note = `New ${liftName(w.pr_lift)} PR: ${fmt(data.weight_lb)} lb!`;
      }
    }
    setBusy(false);
    loadLogs(note);
  }

  async function talk() {
    if (!me || !w) { router.push('/login'); return; }
    const t = `${fmtD(w.day)} · ${w.title}`;
    const { data, error } = await sb.rpc('room_for', { p_kind: 'workout', p_ref: w.id, p_title: t });
    if (!error) router.push({ pathname: '/room/[id]', params: { id: data, title: t } });
  }

  // Day board: struck last, then the score, then the day's rank key. Blocked lifters are hidden.
  const dayBoard = useMemo(() => (w ? sortDay(w, logs.filter(l => !blocked.has(l.profile_id))) : []), [logs, w, blocked]);
  const bIts = useMemo(() => (w ? boardItems(w, dayBoard) : []), [w, dayBoard]);
  const rowOf = useMemo(() => new Map(board.map(r => [r.profile_id, r])), [board]);
  const pairs = (l: Log) => bIts.flatMap(it => {
    const v = num(l.entries?.[it.key]);
    if (!v) return [];
    const br = it.kind === 'w' && it.lift ? rowOf.get(l.profile_id) : undefined;
    const t = br && it.lift ? target(it.lift, br) : 0;
    return [{ k: it.key, label: it.label.replace(' · ', ' '), val: cell(it, v), sub: t ? `${Math.round((v / t) * 100)}% of target` : '', hit: !!t && v >= t }];
  });

  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const tdy = today();
  const np = isParts(w);
  const parts = w ? shownParts(w) : [];
  const rest = !!w && !its.length && !w.score_label;
  const myLogged = !!w && done.has(w.id);
  const runsGym = !!w?.gym_id && staff.some(g => g.gym_id === w.gym_id);
  const goWeek = (s2: string, d2: string) => { setStart(s2); setDay(d2); };

  function weightRow(it: Item) {
    const l = it.lift!;
    const t = target(l, base), a = Number(actual[it.key] || 0), diff = a - t;
    const col = liftColor[l.b ?? ''] ?? C.muted;
    return (
      <Card key={it.key} accent={col}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text style={{ color: C.ink, fontWeight: '700', fontSize: 16, flex: 1 }}>{it.label}</Text>
          <Mono style={{ color: C.muted, fontSize: 13 }}>{l.sch}</Mono>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <View style={{ width: 64, flexShrink: 0 }}><Eyebrow>Target</Eyebrow><Mono style={{ fontSize: 22, color: C.accent }}>{t || 'n/a'}</Mono></View>
          <TextInput value={actual[it.key] ?? ''} onChangeText={v => setActual({ ...actual, [it.key]: v.replace(/[^0-9.]/g, '') })}
            placeholder={t ? String(t) : 'lb'} placeholderTextColor="#5A6478" keyboardType="decimal-pad" maxLength={7} accessibilityLabel={`${l.n} weight used`}
            style={[s.input, { flex: 1, minWidth: 0, textAlign: 'center' }]} />
          <Btn ghost label="Hit" onPress={() => setActual({ ...actual, [it.key]: t ? String(t) : '' })} style={{ height: 52, width: 54, paddingHorizontal: 0, flexShrink: 0 }} />
          {l.part ? null : <Btn ghost label="Sets" onPress={() => router.push({ pathname: '/lift', params: { wid: w!.id, lid: l.id } })} style={{ height: 52, width: 58, paddingHorizontal: 0, flexShrink: 0 }} />}
        </View>
        <Muted style={{ marginTop: 6, color: !a ? C.muted : diff >= 0 ? C.up : C.flat }}>
          {!a ? l.why ?? '' : !t ? 'Logged' : diff === 0 ? 'Hit it' : diff > 0 ? `${diff} over target` : `${-diff} under target`}
        </Muted>
      </Card>
    );
  }

  function otherRow(it: Item) {
    const isT = it.kind === 't';
    return (
      <Card key={it.key}>
        <Text style={{ color: C.ink, fontWeight: '700', fontSize: 16 }}>{it.label}</Text>
        <Muted style={{ marginTop: 2 }}>{isT ? 'Minutes and seconds' : 'Total reps'}</Muted>
        <TextInput value={actual[it.key] ?? ''} onChangeText={v => setActual({ ...actual, [it.key]: isT ? v.replace(/[^0-9:.]/g, '') : v.replace(/[^0-9]/g, '') })}
          placeholder={isT ? 'm:ss' : 'reps'} placeholderTextColor="#5A6478" keyboardType={isT ? timeKb : 'number-pad'} maxLength={isT ? 8 : 5}
          accessibilityLabel={it.label} style={[s.input, { marginTop: 8, textAlign: 'center' }]} />
      </Card>
    );
  }

  return (
    <Screen>
      <Title eyebrow={`Week of ${fmtD(start)}`} accent="week">The</Title>
      {hasGym ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 }}>
          <Chip label={gymName ?? 'My gym'} on={source === 'gym'} onPress={() => setSrc('gym')} />
          <Chip label="DSI week" on={source === 'dsi'} onPress={() => setSrc('dsi')} />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
        {days.map(d => {
          const on = d === day, dt = new Date(d + 'T12:00:00'), has = wks?.find(x => x.day === d), logged = !!has && done.has(has.id);
          return (
            <Pressable key={d} onPress={() => setDay(d)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${dt.toDateString()}${logged ? ', logged' : ''}`}
              style={{ flex: 1, height: 56, borderRadius: 10, borderWidth: 1, borderColor: on ? C.ink : d === tdy ? C.muted : C.line, backgroundColor: on ? C.ink : C.panel, alignItems: 'center', justifyContent: 'center', opacity: has || on ? 1 : 0.55 }}>
              {logged ? <Text style={{ position: 'absolute', top: 2, right: 4, fontSize: 11, fontWeight: '900', color: C.up }}>✓</Text> : null}
              <Text style={{ fontSize: 10, fontWeight: '600', color: on ? C.bg : C.muted }}>{dt.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}</Text>
              <Text style={{ fontSize: 20, fontWeight: '900', color: on ? C.bg : C.ink }}>{dt.getDate()}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 }}>
        <Chip label="← Last week" on={false} onPress={() => { const s2 = addDays(start, -7); goWeek(s2, s2); }} />
        {start !== monday(tdy) ? <Chip label="Today" on={false} onPress={() => goWeek(monday(tdy), tdy)} /> : null}
        <Chip label="Next week →" on={false} onPress={() => { const s2 = addDays(start, 7); goWeek(s2, s2); }} />
      </View>
      {err ? <Muted style={{ color: C.down, marginBottom: 8 }}>{err}</Muted> : null}

      {!wks ? <Loading /> : !w ? (
        <Card><Muted>{wks.length ? 'No programming for this day. Pick another day above.' : 'This week has not been posted yet.'}</Muted></Card>
      ) : (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 6 }}>
            <View style={{ flex: 1 }}>
              <Eyebrow>{`${w.source ?? (w.gym_id ? gymName ?? 'Gym' : 'DSI')}${w.day === tdy ? ' · Today' : ''}`}</Eyebrow>
              <Text style={{ color: C.ink, fontSize: 24, fontWeight: '900', textTransform: 'uppercase' }}>{w.title}</Text>
            </View>
            {parts.length ? <Chip label={showProg ? 'Hide' : 'Workout'} on={false} onPress={() => setShowProg(!showProg)} /> : null}
          </View>

          {rest ? (
            <Card accent={C.up}>
              <Text style={{ color: C.ink, fontSize: 24, fontWeight: '900', textTransform: 'uppercase', marginBottom: 6 }}>Rest <Text style={{ color: C.up }}>day</Text></Text>
              <Muted style={{ fontSize: 15 }}>{w.rest_note || 'Nothing to log. Recover like it is your job.'}</Muted>
            </Card>
          ) : null}

          {showProg && (parts.length || (w.rest_note && !rest)) ? (
            <Card>
              {w.rest_note && !rest ? (
                <View style={{ borderLeftWidth: 3, borderLeftColor: C.up, paddingLeft: 10, marginBottom: 10 }}>
                  <Text style={{ color: C.ink, fontSize: 15 }}>{w.rest_note}</Text>
                </View>
              ) : null}
              {parts.map((p, i) => {
                const lw = logWords(p);
                return (
                  <View key={p.L + i} style={{ marginBottom: i === parts.length - 1 ? 0 : 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      {np ? (
                        <View style={{ width: 22, height: 22, borderRadius: 4, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ color: '#141414', fontWeight: '900', fontSize: 13 }}>{p.L}</Text>
                        </View>
                      ) : null}
                      <Text style={{ color: C.ink, fontWeight: '700', flex: 1 }}>{p.name || (np ? `Part ${p.L}` : '')}</Text>
                    </View>
                    {p.text ? <Muted style={{ fontSize: 14 }}>{p.text}</Muted> : null}
                    {lw ? <Text style={{ color: C.accent, fontWeight: '600', fontSize: 12, marginTop: 4 }}>Log your {lw}</Text> : null}
                  </View>
                );
              })}
            </Card>
          ) : null}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 }}>
            <Chip label="Day thread" on={false} onPress={talk} />
            {w.benchmark ? <Chip label={`Benchmark: ${w.benchmark}`} on={false} onPress={() => router.push({ pathname: '/compete/benchmark/[name]', params: { name: w.benchmark! } })} /> : null}
          </View>
          {runsGym ? (
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              <Btn label="Enter results" onPress={() => router.push({ pathname: '/office/results', params: { gym: w.gym_id!, day: w.day } })} style={{ flex: 1, paddingHorizontal: 8 }} />
              <Btn ghost label="Log a class" onPress={() => router.push({ pathname: '/office/class', params: { gym: w.gym_id! } })} style={{ flex: 1, paddingHorizontal: 8 }} />
            </View>
          ) : null}

          {rest ? null : (
            <>
              {its.length ? <Eyebrow style={{ color: C.ink, marginVertical: 6 }}>{isPro ? (np ? 'Your numbers' : 'Target vs actual') : np ? 'What you log' : 'Lifts today'}</Eyebrow> : null}
              {isPro ? its.map(it => (it.kind === 'w' && it.lift ? weightRow(it) : otherRow(it))) : its.map(it => (
                <Card key={it.key} accent={it.lift ? liftColor[it.lift.b ?? ''] ?? C.muted : undefined}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                    <Text style={{ color: C.ink, fontWeight: '700', fontSize: 16, flex: 1 }}>{it.label}</Text>
                    {it.sch ? <Mono style={{ color: C.muted, fontSize: 13 }}>{it.sch}</Mono> : null}
                  </View>
                  <Muted style={{ marginTop: 4 }}>{it.lift ? it.lift.why ?? '' : it.kind === 'r' ? 'Your total reps' : 'Your time'}</Muted>
                  {it.lift?.rx?.length ? <Muted style={{ marginTop: 2, color: C.ink }}>{liftRule(it.lift)}</Muted> : null}
                </Card>
              ))}

              {!me && its.length ? (
                <Card><Muted style={{ fontSize: 14 }}>Sign in and every weight here is built from your own PRs. Then log what you actually did.</Muted></Card>
              ) : !isPro && its.length ? (
                <Pressable onPress={() => router.push('/pro')} accessibilityRole="button">
                  <Card style={{ borderColor: C.accent, backgroundColor: '#221F14' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <Text style={{ color: C.ink, fontWeight: '800', fontSize: 16, flex: 1 }}>Your weights for today</Text><ProBadge />
                    </View>
                    <Muted style={{ fontSize: 14 }}>Pro turns every lift here into a target weight built from your own PRs, then logs what you actually did and puts you on the day board.</Muted>
                  </Card>
                </Pressable>
              ) : null}

              {isPro && w.score_label ? (
                <Card>
                  <Eyebrow>{w.score_label}</Eyebrow>
                  <TextInput value={score} onChangeText={setScore} maxLength={40} placeholder={w.score_type === 'time' ? '12:34' : 'Your score'} placeholderTextColor="#5A6478"
                    keyboardType={w.score_type === 'time' ? timeKb : 'default'} style={[s.input, { marginTop: 6 }]} accessibilityLabel={w.score_label} />
                </Card>
              ) : null}
              {its.length || w.score_label ? <Btn label={!me ? 'Sign in to log' : isPro ? (myLogged ? 'Update log' : 'Save today') : 'Log workouts with Pro'} onPress={save} disabled={busy} style={{ marginTop: 6 }} /> : null}
              {msg ? <Muted style={{ marginTop: 10, textAlign: 'center' }}>{msg}</Muted> : null}

              <View style={{ marginTop: 22 }}>
                <Title eyebrow={`${fmtD(w.day)}${dayBoard.length ? ` · ${dayBoard.length} logged` : ''}`} accent="board">Day</Title>
                {!dayBoard.length ? <Card><Muted>Nobody has logged this day yet.</Muted></Card> : dayBoard.map((l, i) => {
                  const ps = pairs(l), struck = l.status === 'struck';
                  return (
                    <Pressable key={l.id} onPress={() => router.push({ pathname: '/lifter/[id]', params: { id: l.profile_id } })} accessibilityRole="button"
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, minHeight: 48, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, opacity: struck ? 0.45 : 1, backgroundColor: me?.id === l.profile_id ? 'rgba(242,201,76,0.08)' : 'transparent' }}>
                      <Text style={{ width: 24, fontSize: 20, fontWeight: '900', color: i === 0 && !struck ? C.accent : C.muted }}>{i + 1}</Text>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Text style={{ color: C.ink, fontWeight: '600', fontSize: 16, textDecorationLine: struck ? 'line-through' : 'none' }}>{names[l.profile_id] ?? 'Lifter'}</Text>
                          {l.status === 'protested' ? <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: C.flat, backgroundColor: 'rgba(224,164,58,0.16)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' }}>Protest</Text> : null}
                          {struck ? <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: C.down }}>Struck</Text> : null}
                        </View>
                        <Text style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                          {ps.length ? ps.map((p, j) => (
                            <Text key={p.k}>{j ? '  ·  ' : ''}{p.label} <Text style={{ color: p.hit ? C.up : C.ink, fontWeight: '700' }}>{p.val}</Text>{p.sub ? ` (${p.sub})` : ''}</Text>
                          )) : 'Logged'}
                        </Text>
                      </View>
                      {l.score ? <Mono style={{ fontSize: 18, color: C.ink }}>{l.score}</Mono> : null}
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}
        </>
      )}
    </Screen>
  );
}
