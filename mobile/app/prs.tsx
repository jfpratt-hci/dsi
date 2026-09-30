import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { PRCard } from '@/components/PRCard';
import { Btn, Card, Loading, Muted, Screen, Title } from '@/components/ui';
import { addDays, fmtD, monday, today, type PR } from '@/lib/data';
import { sb } from '@/lib/supabase';

// The wall resets every Monday. Newest PR on top as it comes in; past weeks are one tap back.
export default function PRWall() {
  const cur = monday(today());
  const [wk, setWk] = useState(cur);
  const [feed, setFeed] = useState<PR[] | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const live = wk === cur;

  const load = useCallback(async () => {
    const [{ data }, prev] = await Promise.all([
      sb.from('pr_feed').select('*').gte('performed_on', wk).lt('performed_on', addDays(wk, 7)).order('created_at', { ascending: false }).limit(300),
      sb.from('pr_feed').select('id', { count: 'exact', head: true }).lt('performed_on', wk),
    ]);
    setFeed((data as PR[]) ?? []);
    setHasOlder((prev.count ?? 0) > 0);
  }, [wk]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (!live) return;
    const ch = sb.channel('prwall').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lift_entries' }, (p: any) => {
      if (p.new?.is_pr && p.new?.prev_best && p.new.performed_on >= wk) load();
    }).subscribe();
    return () => { sb.removeChannel(ch); };
  }, [live, wk, load]);

  return (
    <Screen stack>
      <Title eyebrow={live ? 'Resets every Monday' : `Week of ${fmtD(wk)}`} accent="wall">PR</Title>
      <Muted style={{ fontSize: 15, marginBottom: 12 }}>{live ? `Week of ${fmtD(wk)}. Newest PRs land on top as they're logged.` : `${fmtD(wk)} to ${fmtD(addDays(wk, 6))}.`}</Muted>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
        {hasOlder ? <View style={{ flex: 1 }}><Btn ghost label="Last week" onPress={() => { setFeed(null); setWk(addDays(wk, -7)); }} /></View> : null}
        {!live ? <View style={{ flex: 1 }}><Btn ghost label="This week" onPress={() => { setFeed(null); setWk(cur); }} /></View> : null}
      </View>
      {!feed ? <Loading /> : feed.length ? feed.map(p => <PRCard key={p.id} p={p} onChange={load} />)
        : <Card><Muted>{live ? 'Fresh week, empty wall. First PR gets the top spot.' : 'No PRs that week.'}</Muted></Card>}
    </Screen>
  );
}
