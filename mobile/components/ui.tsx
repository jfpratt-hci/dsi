import type { ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { C } from '@/constants/Colors';

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
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
  input: { height: 52, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: '#0B1019', color: C.ink, paddingHorizontal: 14, fontSize: 18 },
});
