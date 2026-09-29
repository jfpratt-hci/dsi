import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';

import { Btn, Card, Chip, Eyebrow, Loading, Muted, PctBar, ProBadge, s, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { addDays, ALL_LIFTS, colorOf, fmt, fmtD, liftName, today } from '@/lib/data';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

type G = { lift: string; target: string; date: string | null };
const MAIN = ['bench', 'squat', 'deadlift', 'clean'];
const WEEKS = [8, 12, 16, 24];

export default function Goals() {
  const { me, isPro } = useSession();
  const [goals, setGoals] = useState<G[] | null>(null);
  const [orig, setOrig] = useState<string[]>([]);
  const [best, setBest] = useState<Record<string, number>>({});
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!me) return;
    const [{ data: g }, { data: b }] = await Promise.all([
      sb.from('goals').select('*').eq('profile_id', me.id),
      sb.from('lift_bests').select('lift,weight_lb').eq('profile_id', me.id),
    ]);
    const have = new Map((g ?? []).map((x: any) => [x.lift, x]));
    const ids = [...new Set([...MAIN, ...(g ?? []).map((x: any) => x.lift)])];
    setGoals(ids.map(id => ({ lift: id, target: have.get(id) ? String(Number(have.get(id).target_lb)) : '', date: have.get(id)?.target_date ?? null })));
    setOrig((g ?? []).map((x: any) => x.lift));
    setBest(Object.fromEntries((b ?? []).map((x: any) => [x.lift, Number(x.weight_lb)])));
  }, [me]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!me) return <Screen stack><Muted>Sign in first.</Muted></Screen>;
  if (!goals) return <Screen stack><Loading /></Screen>;

  const set = (lift: string, patch: Partial<G>) => setGoals(goals.map(g => (g.lift === lift ? { ...g, ...patch } : g)));
  async function save() {
    if (!goals) return;
    setBusy(true);
    const ups = goals.filter(g => Number(g.target) > 0).map(g => ({ profile_id: me!.id, lift: g.lift, target_lb: Number(g.target), target_date: isPro ? g.date : null, updated_at: new Date().toISOString() }));
    const dels = orig.filter(l => !goals.find(g => g.lift === l && Number(g.target) > 0));
    const r1 = ups.length ? await sb.from('goals').upsert(ups, { onConflict: 'profile_id,lift' }) : { error: null };
    const r2 = dels.length ? await sb.from('goals').delete().eq('profile_id', me!.id).in('lift', dels) : { error: null };
    setBusy(false);
    const err = r1.error || r2.error;
    if (err) { Alert.alert('Could not save', err.message); return; }
    Alert.alert('Goals saved', isPro ? 'Your goal plans are updated.' : undefined);
    load();
  }

  return (
    <Screen stack>
      <Title eyebrow="What are you chasing" accent="">Goals</Title>
      {goals.map(g => {
        const now = best[g.lift] || 0, t = Number(g.target) || 0, pc = t ? Math.min(100, Math.round((now / t) * 100)) : 0;
        return (
          <Card key={g.lift} accent={colorOf(g.lift)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.ink, fontWeight: '700', fontSize: 16 }}>{liftName(g.lift)}</Text>
                <Muted>{now ? `Best ${fmt(now)} lb` : 'No lift yet'}</Muted>
              </View>
              <TextInput value={g.target} onChangeText={v => set(g.lift, { target: v.replace(/[^0-9]/g, '') })} placeholder="goal lb" placeholderTextColor="#5A6478"
                keyboardType="number-pad" accessibilityLabel={`${liftName(g.lift)} goal`} style={[s.input, { width: 110, textAlign: 'center' }]} />
            </View>
            {t ? <View style={{ flexDirection: 'row', marginTop: 10 }}><PctBar pct={pc} color={colorOf(g.lift)} /></View> : null}
            {t ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
                <Text style={{ color: C.muted, fontSize: 12, marginRight: 8 }}>BY</Text>
                {isPro ? WEEKS.map(w => { const d = addDays(today(), w * 7); return <Chip key={w} label={`${w} wks`} on={!!g.date && Math.abs(new Date(g.date).getTime() - new Date(d).getTime()) < 4 * 864e5} onPress={() => set(g.lift, { date: d })} />; })
                  : <Pressable onPress={() => router.push('/pro')} style={{ flexDirection: 'row', alignItems: 'center' }}><Muted>Set a date and get a weekly plan</Muted><ProBadge /></Pressable>}
                {isPro && g.date ? <Muted style={{ marginLeft: 4 }}>{fmtD(g.date)}</Muted> : null}
              </View>
            ) : null}
          </Card>
        );
      })}
      {adding ? (
        <Card>
          <Eyebrow style={{ marginBottom: 8 }}>Add a goal for</Eyebrow>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {ALL_LIFTS.filter(([id]) => !goals.find(g => g.lift === id)).map(([id, n]) => <Chip key={id} label={n} on={false} onPress={() => { setGoals([...goals, { lift: id, target: '', date: null }]); setAdding(false); }} />)}
          </View>
        </Card>
      ) : <Btn ghost label="Add another lift" onPress={() => setAdding(true)} style={{ marginBottom: 10 }} />}
      <Btn label="Save goals" onPress={save} disabled={busy} />
      <Muted style={{ textAlign: 'center', marginTop: 10 }}>Clear a box to remove that goal.</Muted>
    </Screen>
  );
}
