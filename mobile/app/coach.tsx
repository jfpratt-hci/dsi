import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { Btn, Card, Eyebrow, Loading, Mono, Muted, PctBar, Screen } from '@/components/ui';
import { C } from '@/constants/Colors';
import { colorOf, fmt, LIFTS, loadBoard, type BoardRow, fmtPct } from '@/lib/data';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

const r5 = (x: number) => Math.round(x / 5) * 5;
// Typical strength ratios for balanced lifters
const RATIOS: [string, string, number, number, string][] = [
  ['bench', 'squat', 0.65, 0.8, 'Bench to squat'],
  ['squat', 'dead', 0.78, 0.9, 'Squat to deadlift'],
  ['clean', 'squat', 0.62, 0.75, 'Clean to squat'],
];

export default function Coach() {
  const { me } = useSession();
  const [row, setRow] = useState<BoardRow | null | undefined>(undefined);
  const [lastPR, setLastPR] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!me) return;
    const [b, { data }] = await Promise.all([loadBoard(), sb.from('lift_entries').select('performed_on').eq('profile_id', me.id).eq('is_pr', true).order('performed_on', { ascending: false }).limit(1)]);
    setRow(b.find(x => x.profile_id === me.id) ?? null);
    setLastPR(data?.[0]?.performed_on ?? null);
  }, [me]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (row === undefined) return <Screen stack><Loading /></Screen>;
  if (!row) return <Screen stack><Card><Muted style={{ fontSize: 15, marginBottom: 12 }}>Log your four lifts and the coach can read your numbers.</Muted><Btn label="Log a lift" onPress={() => router.push('/(tabs)/log')} /></Card></Screen>;

  const have = LIFTS.filter(l => (row as any)[l.k]);
  const missing = LIFTS.filter(l => !(row as any)[l.k]);
  const ranked = [...have].sort((a, b) => row.p[a.k] - row.p[b.k]);
  const weak = ranked[0], strong = ranked[ranked.length - 1];
  const days = lastPR ? Math.round((Date.now() - new Date(lastPR + 'T12:00:00').getTime()) / 864e5) : null;
  const val = (k: string) => Number((row as any)[k]) || 0;

  const ratioNotes = RATIOS.filter(([a, b]) => val(a) && val(b)).map(([a, b, lo, hi, label]) => {
    const r = val(a) / val(b);
    const la = LIFTS.find(l => l.k === a)!.n, lb = LIFTS.find(l => l.k === b)!.n;
    const verdict = r < lo ? `${la} is lagging your ${lb.toLowerCase()}. Bring it up to about ${fmt(r5(val(b) * lo))} lb.` : r > hi ? `${lb} is lagging your ${la.toLowerCase()}. Push it toward ${fmt(r5(val(a) / hi))} lb.` : 'Balanced. Keep them moving together.';
    return { label, r, ok: r >= lo && r <= hi, verdict };
  });

  return (
    <Screen stack>
      <Muted style={{ fontSize: 15, marginBottom: 12 }}>Read from your lifts, your age and your bodyweight. The better your log, the sharper the read.</Muted>

      {weak && strong && weak !== strong ? (
        <Card accent={colorOf(weak.db)}>
          <Eyebrow style={{ color: C.accent }}>Your focus</Eyebrow>
          <Text style={{ color: C.ink, fontSize: 22, fontWeight: '900', textTransform: 'uppercase', marginTop: 4 }}>{weak.n} is your weak link</Text>
          <Muted style={{ fontSize: 15, marginTop: 4 }}>It sits at the {fmtPct(row.p[weak.k])} percentile for your age and size, while your {strong.n.toLowerCase()} is at the {fmtPct(row.p[strong.k])}. Raising your weakest lift moves your DSI™ fastest.</Muted>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <View style={{ flex: 1, backgroundColor: '#0B1019', borderRadius: 10, padding: 10 }}><Eyebrow>Next PR</Eyebrow><Mono style={{ fontSize: 22, color: C.accent }}>{fmt(r5(val(weak.k) * 1.025) || 5)}</Mono></View>
            <View style={{ flex: 1, backgroundColor: '#0B1019', borderRadius: 10, padding: 10 }}><Eyebrow>Train 2x a week</Eyebrow><Mono style={{ fontSize: 22 }}>5x3 @ {fmt(r5(val(weak.k) * 0.8))}</Mono></View>
          </View>
        </Card>
      ) : null}

      {missing.length ? (
        <Card accent={C.flat}><Eyebrow>Missing lifts</Eyebrow><Muted style={{ fontSize: 15, marginTop: 4 }}>{missing.map(l => l.n).join(', ')} {missing.length > 1 ? 'are' : 'is'} blank, which scores as zero. Log {missing.length > 1 ? 'them' : 'it'} for a true DSI™.</Muted></Card>
      ) : null}

      <Eyebrow style={{ marginVertical: 8 }}>Where you rank</Eyebrow>
      <Card>
        {LIFTS.map(l => (
          <View key={l.k} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Text style={{ width: 70, color: C.ink, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>{l.n}</Text>
            <PctBar pct={row.p[l.k] || 0} color={colorOf(l.db)} />
            <Mono style={{ width: 44, textAlign: 'right', fontSize: 13 }}>{fmtPct(row.p[l.k])}</Mono>
          </View>
        ))}
      </Card>

      {ratioNotes.length ? <>
        <Eyebrow style={{ marginVertical: 8 }}>Balance</Eyebrow>
        {ratioNotes.map(n => (
          <Card key={n.label} accent={n.ok ? C.up : C.flat}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: C.ink, fontWeight: '700', fontSize: 15 }}>{n.label}</Text><Mono>{n.r.toFixed(2)}</Mono>
            </View>
            <Muted style={{ fontSize: 14, marginTop: 4 }}>{n.verdict}</Muted>
          </Card>
        ))}
      </> : null}

      <Card accent={days !== null && days > 45 ? C.down : C.up}>
        <Eyebrow>Momentum</Eyebrow>
        <Muted style={{ fontSize: 15, marginTop: 4 }}>{days === null ? 'No PRs yet. Your first logged lift sets the baseline.' : days > 45 ? `${days} days since your last PR. Drop the weight 10% for two weeks, then build back with triples.` : days === 0 ? 'PR today. Keep the streak going.' : `Last PR ${days} day${days === 1 ? '' : 's'} ago. Keep the streak going.`}</Muted>
      </Card>
      <Muted style={{ textAlign: 'center', fontSize: 12, marginTop: 6 }}>For bragging rights, not medical or training advice.</Muted>
    </Screen>
  );
}
