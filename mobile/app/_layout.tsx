import AsyncStorage from '@react-native-async-storage/async-storage';
import { DarkTheme, router, Stack, ThemeProvider, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import 'react-native-reanimated';

import { C } from '@/constants/Colors';
import { SEEN_WELCOME } from '@/lib/invite';
import { listenForTaps, permission, registerPush, scheduleReminders, wasAsked } from '@/lib/notify';
import { startPurchases } from '@/lib/purchases';
import { SessionProvider, useSession } from '@/lib/session';

export { ErrorBoundary } from 'expo-router';
export const unstable_settings = { initialRouteName: '(tabs)' };

SplashScreen.preventAutoHideAsync();

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: C.bg, card: '#0B1019', text: C.ink, border: C.line, primary: C.accent },
};

function Nav() {
  const { ready, me, session, setStorePro } = useSession();
  const seg = useSegments();
  const asked = useRef(false);
  useEffect(() => { if (ready) SplashScreen.hideAsync(); }, [ready]);
  useEffect(() => listenForTaps(), []);

  // First open, signed out: the welcome screen once.
  useEffect(() => {
    if (!ready || session) return;
    AsyncStorage.getItem(SEEN_WELCOME).then(v => { if (v !== '1' && seg[0] !== 'welcome' && seg[0] !== 'login') router.push('/welcome'); }).catch(() => {});
  }, [ready, session]);

  // Signed in: register for pushes, refresh this week's reminders, start purchases. Again whenever the app comes back.
  useEffect(() => {
    if (!me?.display_name) return;
    const sync = () => { registerPush(me).catch(() => {}); scheduleReminders(me).catch(() => {}); };
    sync();
    startPurchases(me.id, setStorePro);
    const sub = AppState.addEventListener('change', st => { if (st === 'active') sync(); });
    return () => sub.remove();
  }, [me?.id, me?.display_name, me?.reminder_hour, me?.notify_reminders]);

  // After the rules are accepted, ask about notifications once with our own screen.
  useEffect(() => {
    if (!ready || !me?.display_name || !me.terms_accepted_at || asked.current) return;
    if (['terms', 'profile', 'notifications', 'welcome'].includes(seg[0] as string)) return;
    asked.current = true;
    Promise.all([wasAsked(), permission()]).then(([a, p]) => { if (!a && p === 'undetermined') router.push('/notifications'); }).catch(() => {});
  }, [ready, me?.id, me?.terms_accepted_at, seg]);

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
      <Stack.Screen name="welcome" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="notifications" options={{ title: '', gestureEnabled: false }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="lift" options={{ title: '' }} />
      <Stack.Screen name="pr/[id]" options={{ title: 'PR' }} />
      <Stack.Screen name="newgroup" options={{ presentation: 'modal', title: 'New group' }} />
      <Stack.Screen name="plates" options={{ title: 'Plates' }} />
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
