import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { PRCard } from '@/components/PRCard';
import { Card, Eyebrow, Loading, Muted, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { monday, today, type PR } from '@/lib/data';
import { sb } from '@/lib/supabase';

export default function PRWall() {
  const [feed, setFeed] = useState<PR[] | null>(null);
  const load = useCallback(async () => {
    const { data } = await sb.from('pr_feed').select('*').limit(200);
    setFeed((data as PR[]) ?? []);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const wk = monday(today());
  const thisWeek = (feed ?? []).filter(p => p.performed_on >= wk), earlier = (feed ?? []).filter(p => p.performed_on < wk);
  return (
    <Screen stack>
      <Title eyebrow="Every PR, dated" accent="wall">PR</Title>
      <Muted style={{ fontSize: 15, marginBottom: 12 }}>A PR counts when it beats your old best. Think one is fishy? Protest it and the Commissioner rules.</Muted>
      {!feed ? <Loading /> : <>
        <Eyebrow style={{ marginBottom: 8, color: C.accent }}>This week</Eyebrow>
        {thisWeek.length ? thisWeek.map(p => <PRCard key={p.id} p={p} onChange={load} />) : <Card><Muted>Quiet week so far. First PR gets the spotlight.</Muted></Card>}
        <Eyebrow style={{ marginVertical: 8 }}>Earlier</Eyebrow>
        {earlier.length ? earlier.map(p => <PRCard key={p.id} p={p} onChange={load} />) : <Card><Muted>Nothing older yet.</Muted></Card>}
      </>}
    </Screen>
  );
}
