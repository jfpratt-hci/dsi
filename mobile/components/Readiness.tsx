// Readiness card and loader, shared by Connected apps and My training. Same call as the website.
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { Btn, Card, Eyebrow, Mono, Muted } from '@/components/ui';
import { C } from '@/constants/Colors';
import { fmtD, today } from '@/lib/data';
import * as D from '@/lib/dsi.js';
import { healthName } from '@/lib/health';
import { sb } from '@/lib/supabase';

export type Link = { provider: string; last_sync: string | null; status: string };
export const NAMES: Record<string, string> = { whoop: 'WHOOP', apple: 'Apple Health', health_connect: 'Health Connect' };
const ZONE: Record<string, string> = { up: C.up, flat: C.flat, down: C.down };

// The readiness card, shared with My training.
export function ReadinessCard({ rows, links }: { rows: any[]; links: Link[] }) {
  const r = D.readiness(rows, today()) as any;
  const t = r.today;
  if (!t) {
    return (
      <Card>
        <Eyebrow>Readiness</Eyebrow>
        <Muted style={{ marginTop: 6 }}>{links.length ? 'No reading for today yet. It shows up after your watch or strap scores last night.' : `Connect ${healthName || 'Apple Health'} or WHOOP and every morning you get a green, yellow or red day for your lifting.`}</Muted>
        {!links.length ? <Btn ghost label="Connect an app" onPress={() => router.push('/connect')} style={{ marginTop: 10 }} /> : null}
      </Card>
    );
  }
  const bars = r.days.slice(0, 14).reverse();
  const facts: [string, string][] = [];
  if (t.hrv_ms != null) facts.push([String(Math.round(t.hrv_ms)), `HRV ms${t.hrvAvg ? ` · avg ${t.hrvAvg}` : ''}`]);
  if (t.rhr != null) facts.push([String(t.rhr), 'Resting HR']);
  if (t.sleep_hours != null) facts.push([(+t.sleep_hours).toFixed(1), 'Hours asleep']);
  if (t.strain != null) facts.push([(+t.strain).toFixed(1), 'Strain']);
  return (
    <Card accent={ZONE[t.zone]}>
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
        <View style={{ width: 84, height: 84, borderRadius: 42, borderWidth: 6, borderColor: ZONE[t.zone], alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: C.ink, fontSize: 34, fontWeight: '900' }}>{t.score}</Text>
          <Text style={{ color: C.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>{t.label.toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Eyebrow>{`Readiness · ${t.day === today() ? 'today' : fmtD(t.day)}`}</Eyebrow>
          <Text style={{ color: C.ink, fontSize: 15, marginTop: 4 }}>{t.advice}</Text>
          <Muted style={{ fontSize: 12, marginTop: 4 }}>{t.how}{t.src === 'whoop' ? '' : ` · ${NAMES[t.src] ?? t.src}`}</Muted>
        </View>
      </View>
      {facts.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 }}>
          {facts.map(([v, l]) => <View key={l} style={{ width: '50%', marginBottom: 8 }}><Mono style={{ fontSize: 18 }}>{v}</Mono><Muted style={{ fontSize: 12 }}>{l}</Muted></View>)}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 48, gap: 3, marginTop: 6 }} accessibilityLabel="Readiness the last two weeks">
        {bars.map((d: any) => <View key={d.day} style={{ flex: 1, height: `${d.score ? Math.max(8, d.score.v) : 4}%`, backgroundColor: d.score ? ZONE[d.score.v >= 67 ? 'up' : d.score.v >= 34 ? 'flat' : 'down'] : C.line, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />)}
      </View>
    </Card>
  );
}

export async function loadWear(profileId: string) {
  const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const [l, d] = await Promise.all([sb.from('wearable_links').select('provider,last_sync,status').eq('profile_id', profileId),
    sb.from('wearable_days').select('*').eq('profile_id', profileId).gte('day', since).order('day', { ascending: false })]);
  return { links: (l.data ?? []) as Link[], rows: (d.data ?? []) as any[] };
}

