// 6.5 Plate calculator and warmup sets. Free.
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { Card, Chip, Eyebrow, Mono, Muted, s, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';

const PLATES = [45, 35, 25, 10, 5, 2.5];
const COLORS: Record<string, string> = { 45: '#EF4B5C', 35: '#F2C94C', 25: '#3DBA74', 10: '#E9EEF6', 5: '#5B93E8', 2.5: '#8E9AB0' };

function load(total: number, bar: number) {
  let side = Math.max(0, (total - bar) / 2);
  const out: number[] = [];
  for (const p of PLATES) while (side >= p - 1e-9) { out.push(p); side -= p; }
  return { plates: out, off: Math.round(side * 2 * 10) / 10 };
}
const r5 = (x: number) => Math.round(x / 5) * 5;

export default function Plates() {
  const q = useLocalSearchParams<{ w?: string }>();
  const [w, setW] = useState(q.w ?? '225');
  const [bar, setBar] = useState(45);
  const total = Number(w) || 0;
  const { plates, off } = load(total, bar);
  const warm = total > bar ? [[bar, 10], [r5(total * 0.4), 5], [r5(total * 0.6), 3], [r5(total * 0.75), 2], [r5(total * 0.85), 1]].filter(([x]) => x < total && x >= bar) : [];
  return (
    <Screen stack>
      <Title accent="calculator">Plate</Title>
      <Eyebrow style={{ marginBottom: 6 }}>Weight on the bar (lb)</Eyebrow>
      <TextInput value={w} onChangeText={v => setW(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" style={[s.input, { fontSize: 32, textAlign: 'center', height: 64, marginBottom: 10 }]} accessibilityLabel="Total weight" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 }}>
        {[45, 35, 15].map(b => <Chip key={b} label={`${b} lb bar`} on={bar === b} onPress={() => setBar(b)} />)}
      </View>
      <Card>
        <Eyebrow>Each side</Eyebrow>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginVertical: 12, minHeight: 90 }}>
          <View style={{ width: 40, height: 12, backgroundColor: '#5A6478', borderRadius: 2 }} />
          {plates.map((p, i) => <View key={i} style={{ width: p >= 25 ? 16 : 11, height: 30 + Math.min(p, 45) * 1.3, backgroundColor: COLORS[String(p)], borderRadius: 3 }} />)}
        </View>
        <Mono style={{ fontSize: 18 }}>{plates.length ? plates.join(' + ') : 'Just the bar'}</Mono>
        {off ? <Muted style={{ color: C.flat, marginTop: 4 }}>{off} lb can't be loaded with standard plates</Muted> : null}
      </Card>
      {warm.length ? (
        <Card>
          <Eyebrow style={{ marginBottom: 6 }}>Warmup to {total}</Eyebrow>
          {warm.map(([x, reps]) => (
            <View key={x} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.line }}>
              <Mono style={{ fontSize: 16 }}>{x} lb</Mono><Text style={{ color: C.muted }}>× {reps}</Text>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
