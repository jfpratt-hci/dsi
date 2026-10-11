// Connected apps (DSI Pro): Apple Health on iPhone, Health Connect on Android, WHOOP on both.
// Readiness is the same call as the website: WHOOP recovery when there is one, otherwise HRV, resting heart rate and sleep.
import { router, Stack, useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { loadWear, ReadinessCard, type Link } from '@/components/Readiness';
import { Btn, Card, Loading, Muted, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { fmtD } from '@/lib/data';
import { connectHealth, disconnectHealth, healthAvailable, healthKind, healthName, healthOn, syncHealth } from '@/lib/health';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

const ago = (t: string | null) => { if (!t) return 'not yet'; const m = Math.round((Date.now() - Date.parse(t)) / 60000); return m < 2 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : fmtD(t.slice(0, 10)); };

async function whoop<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.functions.invoke('whoop', { body });
  let msg: string | undefined = error?.message;
  const ctx = (error as any)?.context;
  if (error && ctx && typeof ctx.json === 'function') { try { const j = await ctx.json(); msg = (j && j.error) || msg; } catch {} }
  if (msg) throw new Error(msg);
  if (data && (data as any).error) throw new Error(String((data as any).error));
  return data as T;
}

export default function Connect() {
  const { me, isPro } = useSession();
  const [st, setSt] = useState<{ links: Link[]; rows: any[] } | null>(null);
  const [can, setCan] = useState(false);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    if (!me) return;
    setCan(await healthAvailable()); setOn(await healthOn());
    setSt(await loadWear(me.id));
  }, [me]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const head = <Stack.Screen options={{ title: 'Connected apps' }} />;
  if (!me) return <Screen stack>{head}<Muted>Sign in first.</Muted></Screen>;
  if (!isPro) {
    return (
      <Screen stack>{head}
        <Title eyebrow="DSI Pro" accent="apps">Connected</Title>
        <Card><Muted style={{ fontSize: 15 }}>Bring in your recovery, HRV, resting heart rate and sleep from {healthName || 'Apple Health'} or WHOOP. Every morning you get a green, yellow or red day for your lifting. Part of DSI Pro.</Muted></Card>
        <Btn label="See DSI Pro" onPress={() => router.push('/pro')} />
      </Screen>
    );
  }
  if (!st) return <Screen stack>{head}<Loading /></Screen>;
  const link = (p: string) => st.links.find(l => l.provider === p);
  const w = link('whoop'), h = healthKind ? link(healthKind) : undefined;

  const run = async (label: string, f: () => Promise<unknown>) => {
    setBusy(label);
    try { await f(); } catch (e: any) { Alert.alert('That did not work', e?.message ?? String(e)); }
    setBusy(''); load();
  };
  const turnOnHealth = () => run('health', async () => {
    if (!(await connectHealth())) throw new Error(`${healthName} said no. You can allow Dandy in ${healthKind === 'apple' ? 'the Health app under Sharing, Apps' : 'Health Connect settings'}.`);
    const n = await syncHealth(me.id, 30);
    Alert.alert(`${healthName} is on`, n ? `Pulled in ${n} days.` : 'Nothing to pull in yet. Wear your watch tonight and check back in the morning.');
  });
  const connectWhoop = () => run('whoop', async () => {
    const back = 'dsi://connect/whoop';
    const { url } = await whoop<{ url: string }>({ action: 'start', app: true });
    const res = await WebBrowser.openAuthSessionAsync(url, back);
    if (res.type !== 'success') return;
    const q = new URL(res.url).searchParams;
    if (q.get('error')) throw new Error(q.get('error') === 'access_denied' ? 'WHOOP was not connected.' : String(q.get('error')));
    const r = await whoop<{ days: number }>({ action: 'finish', code: q.get('code'), state: q.get('state'), app: true });
    Alert.alert('WHOOP connected', r.days ? `Pulled in ${r.days} days.` : 'Your scores come in each morning.');
  });

  return (
    <Screen stack>{head}
      <Title eyebrow="DSI Pro" accent="apps">Connected</Title>
      <Muted style={{ marginBottom: 12 }}>Only you can see this. Your readiness each morning comes from what you connect here.</Muted>
      <ReadinessCard rows={st.rows} links={st.links} />

      {healthKind ? (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: C.ink, fontWeight: '800', fontSize: 17 }}>{healthName}</Text>{on && h ? <Text style={{ color: C.up, fontWeight: '800' }}>On</Text> : null}</View>
          <Muted style={{ marginVertical: 6 }}>{on && h ? `Last sync ${ago(h.last_sync)}. Your DSI sessions are saved to ${healthName} as strength workouts.`
            : healthKind === 'apple' ? 'HRV, resting heart rate, sleep and bodyweight from your Apple Watch, Oura, Garmin or anything that writes to Apple Health.'
            : 'HRV, resting heart rate, sleep and bodyweight from Samsung Health, Fitbit, Garmin, Oura and the rest. Health Connect replaces Google Fit, which Google is shutting down.'}</Muted>
          {!can ? <Muted style={{ fontSize: 13 }}>{healthKind === 'apple' ? 'Apple Health is not available on this device.' : 'Install or update Health Connect from the Play Store, then come back.'}</Muted>
            : on && h ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Btn ghost label={busy === 'sync' ? 'Syncing…' : 'Sync now'} disabled={!!busy} onPress={() => run('sync', () => syncHealth(me.id, 30))} style={{ flex: 1 }} />
                <Btn ghost label="Turn off" disabled={!!busy} onPress={() => run('off', () => disconnectHealth(me.id))} style={{ flex: 1 }} />
              </View>
            ) : <Btn label={busy === 'health' ? 'Connecting…' : `Turn on ${healthName}`} disabled={!!busy} onPress={turnOnHealth} />}
        </Card>
      ) : null}

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: C.ink, fontWeight: '800', fontSize: 17 }}>WHOOP</Text>{w ? <Text style={{ color: w.status === 'ok' ? C.up : C.down, fontWeight: '800' }}>{w.status === 'ok' ? 'Connected' : 'Reconnect'}</Text> : null}</View>
        <Muted style={{ marginVertical: 6 }}>{w ? `Last sync ${ago(w.last_sync)}. New scores come in on their own each morning.` : 'Recovery, HRV, resting heart rate, sleep and strain from your WHOOP strap.'}</Muted>
        {w && w.status === 'ok' ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Btn ghost label={busy === 'wsync' ? 'Syncing…' : 'Sync now'} disabled={!!busy} onPress={() => run('wsync', () => whoop({ action: 'sync' }))} style={{ flex: 1 }} />
            <Btn ghost label="Disconnect" disabled={!!busy} onPress={() => Alert.alert('Disconnect WHOOP?', 'Your past days stay in your readiness history.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Disconnect', style: 'destructive', onPress: () => run('woff', () => whoop({ action: 'disconnect' })) }])} style={{ flex: 1 }} />
          </View>
        ) : <Btn label={busy === 'whoop' ? 'Opening WHOOP…' : w ? 'Reconnect WHOOP' : 'Connect WHOOP'} disabled={!!busy} onPress={connectWhoop} />}
      </Card>
    </Screen>
  );
}
