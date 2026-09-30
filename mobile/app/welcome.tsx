// 1.1 Welcome: first open, signed out.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { Image, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Btn, Muted } from '@/components/ui';
import { C } from '@/constants/Colors';
import { SEEN_WELCOME } from '@/lib/invite';

const POINTS = [
  ['Your DSI', 'Bench, squat, deadlift and clean scored against lifters your age and bodyweight. 500 is the median.'],
  ['The board', 'Climb it. Every PR lands on the wall with the date, and anyone can protest it.'],
  ['The week', 'Daily programming with target weights built from your own numbers.'],
];

export default function Welcome() {
  async function go(to: '/login' | '/') {
    try { await AsyncStorage.setItem(SEEN_WELCOME, '1'); } catch {}
    if (to === '/login') router.replace('/login'); else router.replace('/');
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flex: 1, padding: 24, justifyContent: 'space-between' }}>
        <View style={{ gap: 18, marginTop: 24 }}>
          <Image source={require('../assets/images/icon.png')} style={{ width: 88, height: 88, borderRadius: 20 }} accessibilityLabel="DSI" />
          <Text style={{ color: C.ink, fontSize: 44, fontWeight: '900', textTransform: 'uppercase', lineHeight: 46 }}>How strong{'\n'}are you, <Text style={{ color: C.accent }}>really?</Text></Text>
          {POINTS.map(([h, t]) => (
            <View key={h} style={{ borderLeftWidth: 3, borderLeftColor: C.accent, paddingLeft: 12 }}>
              <Text style={{ color: C.ink, fontWeight: '800', fontSize: 16, textTransform: 'uppercase' }}>{h}</Text>
              <Muted style={{ fontSize: 15 }}>{t}</Muted>
            </View>
          ))}
        </View>
        <View style={{ gap: 10 }}>
          <Btn label="Get your DSI" onPress={() => go('/login')} />
          <Btn ghost label="Look around first" onPress={() => go('/')} />
          <Muted style={{ textAlign: 'center', fontSize: 12 }}>Free to join. For bragging rights, not medical or training advice.</Muted>
        </View>
      </View>
    </SafeAreaView>
  );
}
