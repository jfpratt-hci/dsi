import { SymbolView } from 'expo-symbols';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';

import { C } from '@/constants/Colors';

type Sym = { ios: any; android: any; web: any };
const icon = (name: Sym) => ({ color }: { color: ColorValue }) => <SymbolView name={name} tintColor={color} size={26} />;

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.accent,
        tabBarInactiveTintColor: C.muted,
        tabBarStyle: { backgroundColor: '#0B1019', borderTopColor: C.line },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Board', tabBarIcon: icon({ ios: 'trophy', android: 'emoji_events', web: 'emoji_events' }) }} />
      <Tabs.Screen name="week" options={{ title: 'Week', tabBarIcon: icon({ ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }) }} />
      <Tabs.Screen name="log" options={{ title: 'Log', tabBarIcon: icon({ ios: 'plus.circle.fill', android: 'add_circle', web: 'add_circle' }) }} />
      <Tabs.Screen name="chat" options={{ title: 'Chat', tabBarIcon: icon({ ios: 'bubble.left.and.bubble.right', android: 'forum', web: 'forum' }) }} />
      <Tabs.Screen name="me" options={{ title: 'Me', tabBarIcon: icon({ ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' }) }} />
    </Tabs>
  );
}
