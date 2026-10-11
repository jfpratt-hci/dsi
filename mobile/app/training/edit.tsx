// Log or edit one of my own sessions. Same rules and wording as site/js/training.js.
//   /training/edit             log a new session (the Log tab links here)
//   /training/edit?id=<id>     view or edit a session
//   /training/edit?again=<id>  start from an earlier session's exercises with today's date
// After saving, heavy singles on catalog lifts are written to lift_entries (the four DSI lifts for everyone, the rest on Pro).
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Btn, Card, Eyebrow, Loading, Muted, ProBadge, s, Screen } from '@/components/ui';
import { C } from '@/constants/Colors';
import { addDays, ALL_LIFTS, fmt, fmtD, liftName, today } from '@/lib/data';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';
import {
  cleanExercises, fmtDW, isDsiLift, liftFor, MAX_EXERCISES, missing, num, QUICK, searchNames, setLine, writeSingles,
  type DraftEx, type Exercise, type Session,
} from '@/lib/training';

type Phase = 'loading' | 'ready' | 'gone' | 'soon' | 'error';
const PH = '#5A6478';

// Row keys only need to be unique while the screen is open.
let SEQ = 1;
const nk = () => SEQ++;
const blankEx = (): DraftEx => ({ k: nk(), name: '', sets: [{ k: nk(), r: '', w: '' }] });
const toDraft = (ex: Exercise): DraftEx => {
  const sets = (ex.sets || []).map(st => ({ k: nk(), r: st.r == null ? '' : String(num(st.r)), w: st.w == null ? '' : String(num(st.w)) }));
  return { k: nk(), name: String(ex.name || ''), sets: sets.length ? sets : [{ k: nk(), r: '', w: '' }] };
};

export default function EditSession() {
  const { id, again } = useLocalSearchParams<{ id?: string; again?: string }>();
  const { me, isPro } = useSession();
  const isNew = !id;

  const [phase, setPhase] = useState<Phase>('loading');
  const [loadErr, setLoadErr] = useState('');
  const [day, setDay] = useState(today());
  const [origDay, setOrigDay] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [exs, setExs] = useState<DraftEx[]>([]);
  const [recent, setRecent] = useState<Pick<Session, 'id' | 'day' | 'exercises'>[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState<number | null>(null); // exercise whose name box has focus
  const [browse, setBrowse] = useState<number | null>(null); // exercise showing the whole catalog
  const [offset, setOffset] = useState(0);

  const refs = useRef(new Map<string, TextInput>());
  const pending = useRef<string | null>(null);
  const wrap = useRef<View>(null);

  // Keyed on the profile id, not the profile object: a token refresh reloads the profile and must not wipe a half logged session.
  const meId = me?.id;
  useEffect(() => {
    if (!meId) return;
    let live = true;
    (async () => {
      setPhase('loading');
      const rec = await sb.from('personal_workouts').select('id,day,exercises').eq('profile_id', meId).order('day', { ascending: false }).limit(60);
      if (!live) return;
      if (rec.error) {
        if (missing(rec.error)) { setPhase('soon'); return; }
        setLoadErr(rec.error.message); setPhase('error'); return;
      }
      setRecent(((rec.data ?? []) as any[]).map(w => ({ ...w, exercises: Array.isArray(w.exercises) ? w.exercises : [] })));
      let d = today(), t = '', n = '', list: Exercise[] = [];
      const src = id || again;
      if (src) {
        const r = await sb.from('personal_workouts').select('*').eq('id', src).maybeSingle();
        if (!live) return;
        if (r.error) { setLoadErr(r.error.message); setPhase('error'); return; }
        if (!r.data && id) { setPhase('gone'); return; }
        if (r.data) {
          const w = r.data as Session;
          list = Array.isArray(w.exercises) ? w.exercises : [];
          t = w.title || '';
          if (id) { d = w.day; n = w.note || ''; }
        }
      }
      setDay(d); setOrigDay(id ? d : ''); setTitle(t); setNote(n);
      setExs(list.length ? list.map(toDraft) : [blankEx()]);
      setMsg(''); setPhase('ready');
    })();
    return () => { live = false; };
  }, [meId, id, again]);

  // Focus a box once the row it belongs to has rendered (a new set's weight, a new exercise's name).
  useEffect(() => {
    const k = pending.current;
    if (!k) return;
    pending.current = null;
    refs.current.get(k)?.focus();
  }, [exs]);

  const bind = (k: string) => (r: TextInput | null) => { if (r) refs.current.set(k, r); else refs.current.delete(k); };

  /* ---------- edits ---------- */
  const patchEx = (k: number, f: (ex: DraftEx) => DraftEx) => setExs(list => list.map(ex => (ex.k === k ? f(ex) : ex)));
  const setName = (k: number, v: string) => patchEx(k, ex => ({ ...ex, name: v.slice(0, 60) }));
  const pick = (ex: DraftEx, name: string) => {
    setName(ex.k, name);
    setBrowse(null);
    const first = ex.sets[0];
    if (first && !first.w && !first.r) pending.current = `w${first.k}`;
    else Keyboard.dismiss();
  };
  const setSet = (k: number, sk: number, field: 'r' | 'w', v: string) => {
    const clean = field === 'r' ? v.replace(/[^0-9]/g, '').slice(0, 3)
      : v.replace(/,/g, '.').replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1').slice(0, 7);
    patchEx(k, ex => ({ ...ex, sets: ex.sets.map(st => (st.k === sk ? { ...st, [field]: clean } : st)) }));
  };
  const addSet = (k: number) => {
    const nkey = nk();
    pending.current = `w${nkey}`;
    patchEx(k, ex => { const last = ex.sets[ex.sets.length - 1] || { r: '', w: '' }; return { ...ex, sets: [...ex.sets, { k: nkey, r: last.r, w: last.w }] }; });
  };
  const rmSet = (k: number, sk: number) => patchEx(k, ex => {
    const sets = ex.sets.filter(st => st.k !== sk);
    return { ...ex, sets: sets.length ? sets : [{ k: nk(), r: '', w: '' }] };
  });
  const rmEx = (k: number) => setExs(list => { const next = list.filter(ex => ex.k !== k); return next.length ? next : [blankEx()]; });
  const addEx = () => {
    if (exs.length >= MAX_EXERCISES) return;
    const ex = blankEx();
    pending.current = `n${ex.k}`;
    setExs(list => [...list, ex]);
  };

  // The last time this exercise shows up in an earlier session.
  const lastOf = (name: string) => {
    const k = name.trim().toLowerCase(); if (!k) return null;
    for (const w of recent) {
      if (id && w.id === id) continue;
      const ex = (w.exercises || []).find(e => String(e.name || '').trim().toLowerCase() === k);
      if (ex) return { day: w.day, ex };
    }
    return null;
  };

  /* ---------- save and delete ---------- */
  async function save() {
    if (!me || busy) return;
    const exercises = cleanExercises(exs);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { setMsg('Pick a date.'); return; }
    if (day > today() && day !== origDay) { setMsg('Pick today or an earlier day.'); return; }
    if (!exercises.length) { setMsg('Add at least one exercise with a set.'); return; }
    if (exercises.length > MAX_EXERCISES) { setMsg(`A session holds up to ${MAX_EXERCISES} exercises.`); return; }
    const t = (title.trim() || exercises.map(x => x.name).slice(0, 2).join(' + ')).slice(0, 80);
    const row = { profile_id: me.id, day, title: t, note: note.trim() || null, exercises };
    Keyboard.dismiss();
    setBusy(true); setMsg('Saving…');
    const res = isNew
      ? await sb.from('personal_workouts').insert(row).select().single()
      : await sb.from('personal_workouts').update(row).eq('id', id).select().single();
    if (res.error) {
      setBusy(false);
      setMsg(missing(res.error) ? 'Logging switches on shortly. Try again in a few minutes.' : res.error.message);
      return;
    }
    const { written, failed } = await writeSingles(me.id, isPro, exercises, day, t);
    setBusy(false);
    // A single that beat an earlier best gets the PR moment. Replace so Done lands back where you started.
    const big = written.find(w => w.isPr && w.prev);
    if (big) { router.replace({ pathname: '/pr/[id]', params: { id: big.id, celebrate: '1' } }); return; }
    const prs = written.filter(w => w.isPr).map(w => `${liftName(w.lift)} ${fmt(w.w)} lb`);
    const done = (prs.length ? `Saved. New PR${prs.length > 1 ? 's' : ''}: ${prs.join(', ')}` : 'Session saved')
      + (failed ? '. One heavy single did not post. Open the session and save again to retry.' : '');
    router.dismissTo({ pathname: '/training', params: { msg: done, t: String(Date.now()) } });
  }

  function del() {
    if (!id) return;
    Alert.alert('Delete this session?', 'Lifts it already posted stay in your history.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setBusy(true);
          const { error } = await sb.from('personal_workouts').delete().eq('id', id);
          setBusy(false);
          if (error) { Alert.alert('Could not delete', error.message); return; }
          router.dismissTo({ pathname: '/training', params: { msg: 'Session deleted', t: String(Date.now()) } });
        },
      },
    ]);
  }

  /* ---------- render ---------- */
  const head = <Stack.Screen options={{ title: isNew ? 'Log a session' : 'Your session' }} />;
  const plain = (body: ReactNode) => <Screen stack>{head}{body}</Screen>;

  if (!me) {
    return plain(<>
      <Card>
        <Text style={{ color: C.ink, fontWeight: '800', fontSize: 16, marginBottom: 4 }}>Sign in to track your training</Text>
        <Muted style={{ fontSize: 15 }}>Members log lifts, chat and file protests. Boards and PRs stay public.</Muted>
      </Card>
      <Btn label="Sign in" onPress={() => router.push('/login')} />
    </>);
  }
  if (phase === 'loading') return plain(<Loading />);
  if (phase === 'soon') {
    return plain(<>
      <Card>
        <Text style={{ color: C.ink, fontWeight: '800', fontSize: 16, marginBottom: 4 }}>My training is switching on</Text>
        <Muted style={{ fontSize: 15 }}>Logging your own sessions goes live as soon as today&apos;s update finishes. Check back shortly.</Muted>
      </Card>
      <Btn ghost label="Log a single lift meanwhile" onPress={() => router.replace('/(tabs)/log')} />
    </>);
  }
  if (phase === 'gone' || phase === 'error') {
    return plain(<>
      <Card>
        <Text style={{ color: C.ink, fontWeight: '800', fontSize: 16 }}>{phase === 'gone' ? 'That session is gone' : 'Could not load this session'}</Text>
        {phase === 'error' ? <Muted style={{ fontSize: 14, marginTop: 4 }}>{loadErr}</Muted> : null}
      </Card>
      <Btn ghost label="My training" onPress={() => router.dismissTo('/training')} />
    </>);
  }

  const now = today();
  const dayNote = day === now ? 'Today' : day === addDays(now, -1) ? 'Yesterday' : '';
  const canNext = day < now;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={[]}>
      {head}
      <View ref={wrap} style={{ flex: 1 }} onLayout={() => wrap.current?.measureInWindow((_x, y) => setOffset(y))}>
        {/* iOS insets the scroll view for the keyboard itself; Android pads above the keyboard (zero when the window already resized). */}
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" enabled={Platform.OS === 'android'} keyboardVerticalOffset={offset}>
          <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}>
            <Muted style={{ fontSize: 15, marginBottom: 14 }}>Add each exercise and its sets. A single (1 rep) heavier than your best on a catalog lift becomes a PR.</Muted>

            <Eyebrow style={{ marginBottom: 6 }}>Date</Eyebrow>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <StepBtn label="‹" a11y="Previous day" onPress={() => setDay(addDays(day, -1))} />
              <View style={{ flex: 1, alignItems: 'center' }} accessible accessibilityLabel={`Date, ${fmtDW(day)}${dayNote ? ', ' + dayNote : ''}`}>
                <Text style={{ color: C.ink, fontWeight: '800', fontSize: 18 }}>{fmtDW(day)}</Text>
                <Muted style={{ fontSize: 12 }}>{dayNote || (day > now ? 'Future date' : ' ')}</Muted>
              </View>
              <StepBtn label="›" a11y="Next day" disabled={!canNext} onPress={() => setDay(addDays(day, 1))} />
            </View>

            <Eyebrow style={{ marginBottom: 6 }}>Name</Eyebrow>
            <TextInput value={title} onChangeText={v => setTitle(v.slice(0, 80))} maxLength={80} placeholder="Lower body, travel day, open gym" placeholderTextColor={PH}
              accessibilityLabel="Session name" returnKeyType="done" style={[s.input, { fontSize: 17, marginBottom: 16 }]} />

            <Eyebrow style={{ marginBottom: 6 }}>Exercises</Eyebrow>
            {exs.map((ex, i) => {
              const last = lastOf(ex.name);
              const lift = liftFor(ex.name);
              const q = ex.name.trim();
              const sugg = naming === ex.k && q ? searchNames(q) : [];
              const showQuick = !q || browse === ex.k;
              return (
                <Card key={ex.k}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <TextInput ref={bind(`n${ex.k}`)} value={ex.name} onChangeText={v => setName(ex.k, v)} maxLength={60}
                      placeholder="Exercise, like Back squat" placeholderTextColor={PH} accessibilityLabel={`Exercise ${i + 1} name`}
                      autoCapitalize="sentences" autoCorrect={false} returnKeyType="next" submitBehavior="submit"
                      onFocus={() => setNaming(ex.k)} onBlur={() => setNaming(n => (n === ex.k ? null : n))}
                      onSubmitEditing={() => { const f = ex.sets[0]; if (f) refs.current.get(`w${f.k}`)?.focus(); }}
                      style={[s.input, { flex: 1, fontSize: 17, fontWeight: '700' }]} />
                    <Pressable accessibilityRole="button" accessibilityLabel={`Remove exercise ${i + 1}`} onPress={() => rmEx(ex.k)} hitSlop={4}
                      style={({ pressed }) => [{ minHeight: 52, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 12 }, pressed && { backgroundColor: C.panel2 }]}>
                      <Text style={{ color: C.muted, fontWeight: '700', fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase' }}>Remove</Text>
                    </Pressable>
                  </View>

                  {lift ? (
                    <Pressable disabled={isDsiLift(lift) || isPro} onPress={() => router.push('/pro')} hitSlop={6}
                      accessibilityRole={isDsiLift(lift) || isPro ? 'text' : 'button'} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 32, marginTop: 2 }}>
                      <Muted style={{ fontSize: 12 }}>
                        {isDsiLift(lift) ? 'DSI lift. A heavy single counts as a PR.' : isPro ? 'Catalog lift. A heavy single counts as a PR.' : 'Catalog lift. Singles count as PRs on'}
                      </Muted>
                      {!isDsiLift(lift) && !isPro ? <ProBadge /> : null}
                    </Pressable>
                  ) : null}

                  {sugg.length ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
                      {sugg.map(n => <NameChip key={n} label={n} onPress={() => pick(ex, n)} />)}
                    </View>
                  ) : showQuick ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
                      {(browse === ex.k ? ALL_LIFTS.map(([, n]) => n) : QUICK).map(n => <NameChip key={n} label={n} on={n === q} onPress={() => pick(ex, n)} />)}
                      <NameChip label={browse === ex.k ? 'Fewer' : 'All lifts'} ghost onPress={() => setBrowse(browse === ex.k ? null : ex.k)} />
                    </View>
                  ) : null}

                  {last ? <Muted style={{ fontSize: 13, marginTop: 6 }}>Last time, {fmtD(last.day)}: {setLine(last.ex)}</Muted> : null}

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, marginBottom: 4 }}>
                    <Text style={[ui.colHead, { width: 22 }]}>Set</Text>
                    <Text style={[ui.colHead, { flex: 1 }]}>Weight lb</Text>
                    <Text style={[ui.colHead, { flex: 1 }]}>Reps</Text>
                    <View style={{ width: 44 }} />
                  </View>
                  {ex.sets.map((set, j) => (
                    <View key={set.k} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <Text style={[s.mono, { width: 22, textAlign: 'center', color: C.muted }]}>{j + 1}</Text>
                      <TextInput ref={bind(`w${set.k}`)} value={set.w} onChangeText={v => setSet(ex.k, set.k, 'w', v)} keyboardType="decimal-pad" inputMode="decimal"
                        placeholder="lb" placeholderTextColor={PH} accessibilityLabel={`Weight in pounds, exercise ${i + 1}, set ${j + 1}`} selectTextOnFocus
                        style={[s.input, { flex: 1, textAlign: 'center', fontWeight: '700', paddingHorizontal: 6 }]} />
                      <TextInput ref={bind(`r${set.k}`)} value={set.r} onChangeText={v => setSet(ex.k, set.k, 'r', v)} keyboardType="number-pad" inputMode="numeric"
                        placeholder="reps" placeholderTextColor={PH} accessibilityLabel={`Reps, exercise ${i + 1}, set ${j + 1}`} selectTextOnFocus
                        style={[s.input, { flex: 1, textAlign: 'center', fontWeight: '700', paddingHorizontal: 6 }]} />
                      <Pressable accessibilityRole="button" accessibilityLabel={`Remove set ${j + 1}`} onPress={() => rmSet(ex.k, set.k)}
                        style={({ pressed }) => [{ width: 44, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 12 }, pressed && { backgroundColor: C.panel2 }]}>
                        <Text style={{ color: C.muted, fontSize: 20 }}>✕</Text>
                      </Pressable>
                    </View>
                  ))}
                  <Btn ghost label="Add set" onPress={() => addSet(ex.k)} style={{ height: 48, marginTop: 2 }} />
                </Card>
              );
            })}
            {exs.length < MAX_EXERCISES
              ? <Btn ghost label="Add exercise" onPress={addEx} style={{ marginBottom: 16 }} />
              : <Muted style={{ textAlign: 'center', marginBottom: 16 }}>A session holds up to {MAX_EXERCISES} exercises.</Muted>}

            <Eyebrow style={{ marginBottom: 6 }}>Notes (optional)</Eyebrow>
            <TextInput value={note} onChangeText={setNote} maxLength={1000} multiline placeholder="How it felt, what to change next time" placeholderTextColor={PH}
              accessibilityLabel="Notes" style={[s.input, { height: undefined, minHeight: 96, paddingTop: 14, paddingBottom: 14, fontSize: 16, textAlignVertical: 'top', marginBottom: 16 }]} />

            {msg ? (
              <Text accessibilityLiveRegion="polite" style={{ color: msg === 'Saving…' ? C.muted : C.ink, fontSize: 15, fontWeight: '600', marginBottom: 10, textAlign: 'center' }}>{msg}</Text>
            ) : null}
            <Btn label={isNew ? 'Save session' : 'Save changes'} onPress={save} disabled={busy} />
            {!isNew ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <Btn ghost label="Do this again" disabled={busy} onPress={() => router.replace({ pathname: '/training/edit', params: { again: id! } })} style={{ flex: 1 }} />
                <Btn ghost label="Delete" disabled={busy} onPress={del} style={{ flex: 1, borderColor: C.down }} />
              </View>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </SafeAreaView>
  );
}

function StepBtn({ label, a11y, onPress, disabled }: { label: string; a11y: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ disabled: !!disabled }} onPress={onPress} disabled={disabled}
      style={({ pressed }) => [{ width: 52, height: 52, borderRadius: 12, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
        pressed && { backgroundColor: C.panel2 }, disabled && { opacity: 0.35 }]}>
      <Text style={{ color: C.ink, fontSize: 28, fontWeight: '600', marginTop: -3 }}>{label}</Text>
    </Pressable>
  );
}

// Quick pick chip, 40 tall plus a little slop so it is an easy thumb target.
function NameChip({ label, onPress, on, ghost }: { label: string; onPress: () => void; on?: boolean; ghost?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!on }} onPress={onPress} hitSlop={4}
      style={({ pressed }) => [ui.pick, on && { backgroundColor: C.ink, borderColor: C.ink }, ghost && { borderStyle: 'dashed' }, pressed && { opacity: 0.6 }]}>
      <Text style={[ui.pickText, on && { color: C.bg }, ghost && { color: C.accent }]}>{label}</Text>
    </Pressable>
  );
}

const ui = {
  colHead: { color: C.muted, fontSize: 11, fontWeight: '600' as const, letterSpacing: 1.2, textTransform: 'uppercase' as const, textAlign: 'center' as const },
  pick: { height: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: C.line, justifyContent: 'center' as const, marginRight: 8, marginBottom: 8 },
  pickText: { color: C.ink, fontWeight: '600' as const, fontSize: 14 },
};
