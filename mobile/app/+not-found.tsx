import { Link, Stack } from 'expo-router';
import { Text, View } from 'react-native';

import { C } from '@/constants/Colors';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: C.bg }}>
        <Text style={{ color: C.ink, fontSize: 20, fontWeight: '700' }}>That screen doesn't exist.</Text>
        <Link href="/" style={{ marginTop: 16, color: C.accent, fontSize: 16 }}>Back to the board</Link>
      </View>
    </>
  );
}
