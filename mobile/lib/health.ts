// Apple Health (iPhone) and Health Connect (Android) for DSI Pro.
// Reads HRV, resting heart rate, sleep and bodyweight for the last month, one row per day into wearable_days,
// so the readiness call works the same here and on the website. Writes each logged DSI session back as a
// strength workout. Google Fit is closing; Health Connect is its replacement on Android.
// The native modules load only on their own platform, so the web build never touches them.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { sb } from '@/lib/supabase';

export type HealthKind = 'apple' | 'health_connect';
export const healthKind: HealthKind | null = Platform.OS === 'ios' ? 'apple' : Platform.OS === 'android' ? 'health_connect' : null;
export const healthName = healthKind === 'apple' ? 'Apple Health' : healthKind === 'health_connect' ? 'Health Connect' : '';
const FLAG = 'dsi.health.on';

type Day = { hrv: number[]; rhr: number[]; sleepIv: [number, number][]; lb?: number };
const localDay = (t: number | string | Date) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
// Watch and phone both log sleep; merge overlapping stretches so a night is not counted twice.
const merged = (iv: [number, number][]) => {
  const s = [...iv].sort((a, b) => a[0] - b[0]); let tot = 0, cs = -1, ce = -1;
  for (const [a, b] of s) { if (a > ce) { if (ce > cs) tot += ce - cs; cs = a; ce = b; } else ce = Math.max(ce, b); }
  if (ce > cs) tot += ce - cs;
  return tot;
};

const hk = () => require('@kingstinct/react-native-healthkit') as typeof import('@kingstinct/react-native-healthkit');
const hc = () => require('react-native-health-connect') as typeof import('react-native-health-connect');

export async function healthOn() { return (await AsyncStorage.getItem(FLAG)) === '1'; }

export async function healthAvailable(): Promise<boolean> {
  try {
    if (healthKind === 'apple') return hk().isHealthDataAvailable();
    if (healthKind === 'health_connect') { const H = hc(); return (await H.getSdkStatus()) === H.SdkAvailabilityStatus.SDK_AVAILABLE; }
  } catch { /* no native module, as in Expo Go */ }
  return false;
}

// Asks the phone for permission. Returns false if the member says no or the phone cannot.
export async function connectHealth(): Promise<boolean> {
  if (healthKind === 'apple') {
    const H = hk();
    await H.requestAuthorization({
      toRead: ['HKQuantityTypeIdentifierHeartRateVariabilitySDNN', 'HKQuantityTypeIdentifierRestingHeartRate', 'HKCategoryTypeIdentifierSleepAnalysis', 'HKQuantityTypeIdentifierBodyMass'],
      toShare: ['HKWorkoutTypeIdentifier'],
    });
  } else if (healthKind === 'health_connect') {
    const H = hc();
    if (!(await H.initialize())) return false;
    const got = await H.requestPermission([
      { accessType: 'read', recordType: 'HeartRateVariabilityRmssd' }, { accessType: 'read', recordType: 'RestingHeartRate' },
      { accessType: 'read', recordType: 'SleepSession' }, { accessType: 'read', recordType: 'Weight' }, { accessType: 'write', recordType: 'ExerciseSession' },
    ]);
    if (!got.length) return false;
  } else return false;
  await AsyncStorage.setItem(FLAG, '1');
  return true;
}

export async function disconnectHealth(profileId: string) {
  await AsyncStorage.removeItem(FLAG);
  if (healthKind) await sb.from('wearable_links').delete().eq('profile_id', profileId).eq('provider', healthKind);
}

async function readApple(start: Date, end: Date, days: Map<string, Day>, day: (k: string) => Day) {
  const H = hk(), filter = { date: { startDate: start, endDate: end } };
  const [hrv, rhr, sleep, mass] = await Promise.all([
    H.queryQuantitySamples('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', { limit: 0, filter, unit: 'ms' }),
    H.queryQuantitySamples('HKQuantityTypeIdentifierRestingHeartRate', { limit: 0, filter }),
    H.queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', { limit: 0, filter }),
    H.queryQuantitySamples('HKQuantityTypeIdentifierBodyMass', { limit: 0, filter, unit: 'lb' }),
  ]);
  hrv.forEach(x => day(localDay(x.startDate)).hrv.push(x.quantity));
  rhr.forEach(x => day(localDay(x.startDate)).rhr.push(x.quantity));
  // Asleep values: 1 asleep, 3 core, 4 deep, 5 REM (0 in bed and 2 awake do not count). The night goes to the day you wake.
  sleep.forEach(x => { if ([1, 3, 4, 5].includes(Number(x.value))) day(localDay(x.endDate)).sleepIv.push([+x.startDate, +x.endDate]); });
  mass.forEach(x => { day(localDay(x.startDate)).lb = x.quantity; });
  return days;
}

async function readAndroid(start: Date, end: Date, day: (k: string) => Day) {
  const H = hc();
  await H.initialize();
  const timeRangeFilter = { operator: 'between' as const, startTime: start.toISOString(), endTime: end.toISOString() };
  const all = async <T extends Parameters<typeof H.readRecords>[0]>(type: T) => {
    const out: any[] = []; let pageToken: string | undefined;
    for (let i = 0; i < 10; i++) { const r = await H.readRecords(type, { timeRangeFilter, pageToken }); out.push(...r.records); pageToken = r.pageToken; if (!pageToken) break; }
    return out;
  };
  const [hrv, rhr, sleep, w] = await Promise.all([all('HeartRateVariabilityRmssd'), all('RestingHeartRate'), all('SleepSession'), all('Weight')]);
  hrv.forEach(x => day(localDay(x.time)).hrv.push(x.heartRateVariabilityMillis));
  rhr.forEach(x => day(localDay(x.time)).rhr.push(x.beatsPerMinute));
  // Sleep stages: 2 sleeping, 4 light, 5 deep, 6 REM. Without stages, the whole session counts.
  sleep.forEach(x => {
    const d = day(localDay(x.endTime));
    const st = (x.stages || []).filter((s: any) => [2, 4, 5, 6].includes(s.stage));
    if (st.length) st.forEach((s: any) => d.sleepIv.push([Date.parse(s.startTime), Date.parse(s.endTime)]));
    else d.sleepIv.push([Date.parse(x.startTime), Date.parse(x.endTime)]);
  });
  w.forEach(x => { day(localDay(x.time)).lb = x.weight?.inPounds; });
}

// Pull the last month and save one row per day. Returns how many days had data.
export async function syncHealth(profileId: string, daysBack = 30): Promise<number> {
  if (!healthKind || !(await healthOn())) return 0;
  const end = new Date(), start = new Date(Date.now() - daysBack * 864e5);
  const days = new Map<string, Day>();
  const day = (k: string) => { let d = days.get(k); if (!d) days.set(k, (d = { hrv: [], rhr: [], sleepIv: [] })); return d; };
  if (healthKind === 'apple') await readApple(start, end, days, day); else await readAndroid(start, end, day);
  const rows = [...days.entries()].map(([k, d]) => ({
    profile_id: profileId, provider: healthKind, day: k, updated_at: new Date().toISOString(),
    hrv_ms: d.hrv.length ? Math.round(avg(d.hrv) * 10) / 10 : null,
    rhr: d.rhr.length ? Math.round(Math.min(...d.rhr)) : null,
    sleep_hours: d.sleepIv.length ? Math.round(merged(d.sleepIv) / 36000) / 100 : null,
    bodyweight_lb: d.lb ? Math.round(d.lb * 10) / 10 : null,
  })).filter(r => r.hrv_ms != null || r.rhr != null || r.sleep_hours != null || r.bodyweight_lb != null);
  if (rows.length) { const { error } = await sb.from('wearable_days').upsert(rows); if (error) throw error; }
  const { error } = await sb.from('wearable_links').upsert({ profile_id: profileId, provider: healthKind, last_sync: new Date().toISOString(), status: 'ok' });
  if (error) throw error;
  return rows.length;
}

// A logged DSI session shows up in Health as a strength workout. Quietly skipped if Health is not on.
export async function saveStrengthWorkout(startedAt: Date, endedAt: Date, title: string) {
  try {
    if (!healthKind || !(await healthOn())) return;
    if (healthKind === 'apple') {
      const H = hk();
      await H.saveWorkoutSample(H.WorkoutActivityType.traditionalStrengthTraining, [], startedAt, endedAt);
    } else {
      const H = hc();
      await H.initialize();
      await H.insertRecords([{ recordType: 'ExerciseSession', exerciseType: H.ExerciseType.STRENGTH_TRAINING, startTime: startedAt.toISOString(), endTime: endedAt.toISOString(), title }]);
    }
  } catch { /* never block saving a session over Health */ }
}
