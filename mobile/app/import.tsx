import { useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';

import { Btn, Card, Eyebrow, Mono, Muted, s, Screen } from '@/components/ui';
import { C } from '@/constants/Colors';
import { fmt, fmtD, liftName } from '@/lib/data';
import { parseImport } from '@/lib/importer';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

export default function Import() {
  const { me } = useSession();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const { rows, bad } = parseImport(text);

  async function run() {
    if (!me || !rows.length) return;
    setBusy(true);
    let done = 0;
    for (const r of rows) {
      const { error } = await sb.from('lift_entries').insert({ profile_id: me.id, lift: r.lift, weight_lb: r.weight, performed_on: r.date, source: 'import' });
      if (error) { setBusy(false); Alert.alert('Stopped', `${done} imported. ${error.message}`); return; }
      done++;
    }
    setBusy(false); setText('');
    Alert.alert('Imported', `${done} lifts added to your history.`);
  }

  return (
    <Screen stack>
      <Muted style={{ fontSize: 15, marginBottom: 10 }}>Paste from a spreadsheet or notes. One lift per line: date, lift, weight.</Muted>
      <Card><Mono style={{ fontSize: 13, color: C.muted }}>{'2025-03-14, bench, 225\n3/28/2025, back squat, 315\n2025-04-02, deadlift, 405'}</Mono></Card>
      <TextInput value={text} onChangeText={setText} multiline placeholder="Paste here" placeholderTextColor="#5A6478" autoCapitalize="none" autoCorrect={false}
        style={[s.input, { height: 180, paddingTop: 12, textAlignVertical: 'top', fontSize: 15 }]} accessibilityLabel="Lifts to import" />
      {text ? <>
        <Eyebrow style={{ marginTop: 12, marginBottom: 6 }}>{rows.length} ready{bad.length ? ` · ${bad.length} skipped` : ''}</Eyebrow>
        {rows.slice(0, 8).map((r, i) => (
          <View key={i} style={{ flexDirection: 'row', paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.line }}>
            <Muted style={{ width: 90 }}>{fmtD(r.date)}</Muted><Text style={{ color: C.ink, flex: 1 }}>{liftName(r.lift)}</Text><Mono>{fmt(r.weight)}</Mono>
          </View>
        ))}
        {rows.length > 8 ? <Muted>and {rows.length - 8} more</Muted> : null}
        {bad.length ? <Muted style={{ color: C.flat, marginTop: 6 }}>Could not read: {bad.slice(0, 3).join(' | ')}</Muted> : null}
      </> : null}
      <Btn label={busy ? 'Importing…' : `Import ${rows.length || ''} lifts`} onPress={run} disabled={busy || !rows.length} style={{ marginTop: 14 }} />
    </Screen>
  );
}
