// Push notifications.
// Reminders are local: one per upcoming workout day at the lifter's chosen hour, skipped once that day is logged.
// PR and programming alerts are remote: the device registers an Expo push token and the server sends them.
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { addDays, today } from './data';
import type { Profile } from './session';
import { sb } from './supabase';

const ON = Platform.OS !== 'web';
const ASKED = 'dsi.notifAsked';

if (ON) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

export async function permission(): Promise<'granted' | 'denied' | 'undetermined'> {
  if (!ON) return 'denied';
  const { status } = await Notifications.getPermissionsAsync();
  return status as any;
}

export async function wasAsked() {
  try { return (await AsyncStorage.getItem(ASKED)) === '1'; } catch { return true; }
}

// Shows the system prompt. Call only after our own screen explains why.
export async function askPermission(): Promise<boolean> {
  if (!ON) return false;
  try { await AsyncStorage.setItem(ASKED, '1'); } catch {}
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'DSI', importance: Notifications.AndroidImportance.DEFAULT, lightColor: '#F2C94C' });
  }
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function registerPush(me: Profile) {
  if (!ON || !Device.isDevice || (await permission()) !== 'granted') return;
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await sb.from('push_tokens').upsert({ token, profile_id: me.id, platform: Platform.OS, updated_at: new Date().toISOString() });
  } catch (e) {
    console.warn('Push registration failed', e);
  }
}

// Rebuild the next 7 days of workout reminders.
export async function scheduleReminders(me: Profile) {
  if (!ON) return;
  const all = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(all.filter(n => (n.content.data as any)?.kind === 'reminder').map(n => Notifications.cancelScheduledNotificationAsync(n.identifier)));
  if (!me.notify_reminders || (await permission()) !== 'granted') return;

  const start = today(), end = addDays(start, 7);
  const { data: wks } = await sb.from('workouts').select('id,day,title,lifts,score_label').gte('day', start).lt('day', end);
  const ids = (wks ?? []).map(w => w.id);
  const { data: logs } = ids.length ? await sb.from('workout_logs').select('workout_id').eq('profile_id', me.id).in('workout_id', ids) : { data: [] as any[] };
  const done = new Set((logs ?? []).map((l: any) => l.workout_id));
  const hour = me.reminder_hour ?? 18;

  for (const w of wks ?? []) {
    if (done.has(w.id) || (!(w.lifts ?? []).length && !w.score_label)) continue;
    const [y, m, d] = w.day.split('-').map(Number);
    const at = new Date(y, m - 1, d, hour, 0, 0);
    if (at.getTime() < Date.now() + 60_000) continue;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `Log today's workout`,
        body: `${w.title}. Put your numbers in before the day board closes.`,
        data: { kind: 'reminder', url: '/week' },
        sound: 'default',
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
    });
  }
}

// Taps on any notification open the screen it names.
export function listenForTaps() {
  if (!ON) return () => {};
  const open = (r: Notifications.NotificationResponse | null) => {
    const url = (r?.notification.request.content.data as any)?.url;
    if (typeof url === 'string' && url.startsWith('/')) setTimeout(() => router.push(url as any), 300);
  };
  Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener(open);
  return () => sub.remove();
}

export async function unregisterPush() {
  if (!ON) return;
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await sb.from('push_tokens').delete().eq('token', token);
  } catch {}
  const all = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(all.map(n => Notifications.cancelScheduledNotificationAsync(n.identifier)));
}
