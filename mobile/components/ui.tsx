import type { ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { C } from '@/constants/Colors';

export function Screen({ children, scroll = true, stack = false }: { children: ReactNode; scroll?: boolean; stack?: boolean }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={stack ? [] : ['top']}>
      {scroll ? <ScrollView contentContainerStyle={s.pad}>{children}</ScrollView> : <View style={[s.pad, { flex: 1 }]}>{children}</View>}
    </SafeAreaView>
  );
}

export function Title({ eyebrow, children, accent }: { eyebrow?: string; children: string; accent?: string }) {
  return (
    <View style={{ marginBottom: 14 }}>
      {eyebrow ? <Text style={s.eyebrow}>{eyebrow}</Text> : null}
      <Text style={s.title}>
        {children}
        {accent ? <Text style={{ color: C.accent }}> {accent}</Text> : null}
      </Text>
    </View>
  );
}

export const Eyebrow = ({ children, style }: { children: ReactNode; style?: TextStyle }) => <Text style={[s.eyebrow, style]}>{children}</Text>;
export const Muted = ({ children, style }: { children: ReactNode; style?: TextStyle }) => <Text style={[s.muted, style]}>{children}</Text>;
export const Mono = ({ children, style }: { children: ReactNode; style?: TextStyle }) => <Text style={[s.mono, style]}>{children}</Text>;

export function Card({ children, style, accent }: { children: ReactNode; style?: ViewStyle; accent?: string }) {
  return <View style={[s.card, accent ? { borderLeftWidth: 4, borderLeftColor: accent } : null, style]}>{children}</View>;
}

export function Btn({ label, onPress, ghost, disabled, style }: { label: string; onPress: () => void; ghost?: boolean; disabled?: boolean; style?: ViewStyle }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled}
      style={({ pressed }) => [s.btn, ghost && s.ghost, (pressed || disabled) && { opacity: 0.6 }, style]}>
      <Text style={[s.btnText, ghost && { color: C.ink }]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress}
      style={[s.chip, on && { backgroundColor: C.ink, borderColor: C.ink }]}>
      <Text style={[s.chipText, on && { color: C.bg }]}>{label}</Text>
    </Pressable>
  );
}

export function ProBadge() {
  return <Text style={s.pro}>PRO</Text>;
}

// Menu row: label, optional detail, chevron. Used on Me and lifter pages.
export function Row({ label, detail, onPress, pro, danger, first }: { label: string; detail?: string; onPress: () => void; pro?: boolean; danger?: boolean; first?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress}
      style={({ pressed }) => [s.row, first && { borderTopWidth: 0 }, pressed && { backgroundColor: C.panel2 }]}>
      <Text style={[s.rowText, danger && { color: C.down }]}>{label}</Text>
      {pro ? <ProBadge /> : null}
      <View style={{ flex: 1 }} />
      {detail ? <Text style={s.rowDetail} numberOfLines={1}>{detail}</Text> : null}
      <Text style={s.chev}>›</Text>
    </Pressable>
  );
}

export function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: 18 }}>
      {title ? <Text style={[s.eyebrow, { marginBottom: 6 }]}>{title}</Text> : null}
      <View style={s.group}>{children}</View>
    </View>
  );
}

// Percentile bar with a median tick at 50
export function PctBar({ pct, color }: { pct: number; color: string }) {
  return (
    <View style={s.pb}>
      <View style={[s.pbFill, { width: `${Math.max(2, pct)}%`, backgroundColor: color }]} />
      <View style={s.pbMid} />
    </View>
  );
}

export const Loading = () => <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />;

export const s = StyleSheet.create({
  pad: { padding: 16, paddingBottom: 40 },
  eyebrow: { fontSize: 11, fontWeight: '600', letterSpacing: 1.6, textTransform: 'uppercase', color: C.muted },
  title: { fontSize: 38, fontWeight: '900', textTransform: 'uppercase', color: C.ink, letterSpacing: 0.5 },
  muted: { fontSize: 13, color: C.muted },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontWeight: '600', color: C.ink, fontVariant: ['tabular-nums'] },
  card: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 },
  btn: { height: 52, borderRadius: 12, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  ghost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.line },
  btnText: { color: '#141414', fontWeight: '700', fontSize: 14, letterSpacing: 1, textTransform: 'uppercase' },
  chip: { height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line, justifyContent: 'center', marginRight: 8, marginBottom: 8 },
  chipText: { color: C.muted, fontWeight: '600', fontSize: 13 },
  pro: { backgroundColor: C.accent, color: '#141414', fontSize: 10, fontWeight: '800', letterSpacing: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden', marginLeft: 8 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: C.line },
  rowText: { color: C.ink, fontSize: 16, fontWeight: '600', flexShrink: 1 },
  rowDetail: { color: C.muted, fontSize: 14, textAlign: 'right', marginLeft: 10, maxWidth: '50%' },
  chev: { color: C.muted, fontSize: 24, marginLeft: 8, marginTop: -2 },
  group: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  pb: { height: 10, backgroundColor: '#0B1019', borderRadius: 5, overflow: 'hidden', flex: 1 },
  pbFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 5 },
  pbMid: { position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, backgroundColor: C.muted, opacity: 0.6 },
  input: { height: 52, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: '#0B1019', color: C.ink, paddingHorizontal: 14, fontSize: 18 },
});
