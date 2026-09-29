import { DarkTheme, router, Stack, ThemeProvider, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { C } from '@/constants/Colors';
import { SessionProvider, useSession } from '@/lib/session';

export { ErrorBoundary } from 'expo-router';
export const unstable_settings = { initialRouteName: '(tabs)' };

SplashScreen.preventAutoHideAsync();

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: C.bg, card: '#0B1019', text: C.ink, border: C.line, primary: C.accent },
};

function Nav() {
  const { ready, me } = useSession();
  const seg = useSegments();
  useEffect(() => { if (ready) SplashScreen.hideAsync(); }, [ready]);

  // New members: pick a board name first, then accept the community rules before anything else.
  useEffect(() => {
    if (!ready || !me) return;
    const at = seg[0];
    if (!me.display_name && at !== 'profile') router.push({ pathname: '/profile', params: { first: '1' } });
    else if (me.display_name && !me.terms_accepted_at && at !== 'terms' && at !== 'profile') router.push('/terms');
  }, [ready, me, seg]);

  if (!ready) return null;
  const header = { headerStyle: { backgroundColor: C.bg }, headerTintColor: C.accent, headerTitleStyle: { color: C.ink }, headerBackButtonDisplayMode: 'minimal' as const };
  return (
    <Stack screenOptions={header}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ presentation: 'modal', title: 'Sign in' }} />
      <Stack.Screen name="profile" options={{ title: 'Profile' }} />
      <Stack.Screen name="terms" options={{ title: 'Community rules', gestureEnabled: false }} />
      <Stack.Screen name="lifter/[id]" options={{ title: '' }} />
      <Stack.Screen name="room/[id]" options={{ title: 'Chat' }} />
      <Stack.Screen name="prs" options={{ title: 'PR wall' }} />
      <Stack.Screen name="protests" options={{ title: 'Protests' }} />
      <Stack.Screen name="goals" options={{ title: 'Goals' }} />
      <Stack.Screen name="pro" options={{ presentation: 'modal', title: 'DSI Pro' }} />
      <Stack.Screen name="progress" options={{ title: 'Progress' }} />
      <Stack.Screen name="plans" options={{ title: 'Goal plans' }} />
      <Stack.Screen name="coach" options={{ title: 'Coach' }} />
      <Stack.Screen name="import" options={{ title: 'Import history' }} />
      <Stack.Screen name="report" options={{ presentation: 'modal', title: 'Report' }} />
      <Stack.Screen name="blocked" options={{ title: 'Blocked lifters' }} />
      <Stack.Screen name="video" options={{ presentation: 'fullScreenModal', headerShown: false }} />
      <Stack.Screen name="reports" options={{ title: 'Reports' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider value={theme}>
      <SessionProvider>
        <StatusBar style="light" />
        <Nav />
      </SessionProvider>
    </ThemeProvider>
  );
}
