// Gym office helpers for the phone: which gyms I run, dated classes in the gym's time zone, names,
// saving coach entries, and the web office links. Same rules as the website:
// site/js/club.js (sessionsFor, isOwner, isCoach), site/js/gym.js (runs, /tv link), site/js/app.js (OFFICE, officeHref).
import * as WebBrowser from 'expo-web-browser';
import { createElement, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { s } from '@/components/ui';
import { C } from '@/constants/Colors';
import { addDays, iso } from './data';
import type { Profile } from './session';
import { sb } from './supabase';

export const WEB = 'https://dandystrength.com';

export type Gym = { id: string; name: string; city: string | null; slug: string | null; tz: string };
export type Role = 'owner' | 'coach';
export type StaffGym = { gym_id: string; role: Role; gym: Gym };
export type ClassSession = {
  id: string; gym_id: string; class_id: string | null; name: string; starts_at: string; ends_at: string;
  capacity: number; coach_id: string | null; status: 'scheduled' | 'canceled'; note: string | null;
};
export type Booking = { id: string; session_id: string; profile_id: string; status: 'booked' | 'waitlist' | 'canceled' | 'attended' | 'no_show'; created_at: string };
export type LogRow = { workout_id: string; profile_id: string; entries: Record<string, number>; score: string | null; sets: Record<string, unknown> };

const GYM_COLS = 'id,name,city,slug,tz';

/* ---------- who runs which gym ---------- */
// The gyms I staff. The Founder (admin) runs every gym as an owner, like is_gym_staff and is_gym_owner in the database.
export async function myGyms(me: Profile | null): Promise<StaffGym[]> {
  if (!me) return [];
  if (me.role === 'admin') {
    const { data, error } = await sb.from('gyms').select(GYM_COLS).order('name');
    if (error) throw error;
    return ((data ?? []) as Gym[]).map(g => ({ gym_id: g.id, role: 'owner' as Role, gym: g }));
  }
  const { data, error } = await sb.from('gym_staff').select(`gym_id,role,gym:gyms(${GYM_COLS})`).eq('profile_id', me.id);
  if (error) throw error;
  return ((data ?? []) as any[])
    .map(x => ({ gym_id: x.gym_id as string, role: x.role as Role, gym: (Array.isArray(x.gym) ? x.gym[0] : x.gym) as Gym }))
    .filter(x => !!x.gym)
    .sort((a, b) => a.gym.name.localeCompare(b.gym.name));
}

// My role at one gym, or null when I do not staff it.
export async function staffRole(me: Profile | null, gid?: string | null): Promise<Role | null> {
  if (!me || !gid) return null;
  if (me.role === 'admin') return 'owner';
  const { data } = await sb.from('gym_staff').select('role').eq('gym_id', gid).eq('profile_id', me.id).maybeSingle();
  return (data?.role as Role) ?? null;
}

export async function gymById(gid: string): Promise<Gym | null> {
  const { data, error } = await sb.from('gyms').select(GYM_COLS).eq('id', gid).maybeSingle();
  if (error) throw error;
  return (data as Gym) ?? null;
}

// Display names for a set of profiles.
export async function people(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter(Boolean) as string[])];
  if (!list.length) return new Map();
  const { data } = await sb.from('profiles').select('id,display_name').in('id', list);
  return new Map(((data ?? []) as { id: string; display_name: string | null }[]).map(p => [p.id, p.display_name || 'Member']));
}

/* ---------- days and times in the gym's time zone ---------- */
// YYYY-MM-DD for a moment in a time zone. Falls back to the phone's own day.
export function dayIn(tz?: string | null, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
    const v = (t: string) => parts.find(p => p.type === t)?.value ?? '';
    const out = `${v('year')}-${v('month')}-${v('day')}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(out)) return out;
  } catch {}
  return iso(at);
}
// "6:00 AM" in the gym's time zone.
export function tAt(ts: string, tz?: string | null): string {
  try { return new Date(ts).toLocaleTimeString('en-US', { timeZone: tz || undefined, hour: 'numeric', minute: '2-digit' }); }
  catch { return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
}
const pd = (d: string) => { const [y, m, x] = d.split('-').map(Number); return new Date(y, m - 1, x); };
export const dayName = (d: string) => pd(d).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
export const fmtDW = (d: string) => pd(d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

// Dated classes for a gym between two days (inclusive), built from the weekly templates.
export async function sessionsFor(g: Gym, from: string, to: string): Promise<ClassSession[]> {
  try { await sb.rpc('ensure_sessions', { p_gym: g.id, p_from: from, p_to: to }); } catch {}
  const { data, error } = await sb.from('sessions').select('*').eq('gym_id', g.id)
    .gte('starts_at', addDays(from, -1) + 'T00:00:00Z').lt('starts_at', addDays(to, 2) + 'T00:00:00Z').order('starts_at');
  if (error) throw error;
  return ((data ?? []) as ClassSession[]).filter(x => { const d = dayIn(g.tz, new Date(x.starts_at)); return d >= from && d <= to; });
}

// Front desk check in (or undo). Coaches only; walk ins included.
export async function checkIn(session: string, profile: string, on: boolean) {
  const { error } = await sb.rpc('check_in', { p_session: session, p_profile: profile, p_in: on });
  if (error) throw new Error(error.message);
}

/* ---------- saving what coaches enter ---------- */
// Upsert members' day logs, stamped with the coach who entered them. If the database has no entered_by column yet, save without it.
let noEnteredBy = false;
export async function upsertLogs(rows: LogRow[], by: string) {
  const put = (r: object[]) => sb.from('workout_logs').upsert(r, { onConflict: 'workout_id,profile_id' });
  let { error } = await put(noEnteredBy ? rows : rows.map(r => ({ ...r, entered_by: by })));
  if (error && /entered_by/.test(error.message)) { noEnteredBy = true; ({ error } = await put(rows)); }
  return error;
}
export const saveError = (e: { message: string }, name: string, gym: string) =>
  /row-level security/i.test(e.message) ? `${name} is not a member of ${gym} yet, so their result can't be entered here.` : e.message;

// Weight in pounds to the nearest half pound, total reps, or a time (seconds) checked by the caller.
export const clampW = (v: string) => Math.max(0, Math.min(1499, Math.round(Number(v) * 2) / 2 || 0));
export const clampR = (v: string) => Math.max(0, Math.min(99999, Math.round(Number(v)) || 0));

/* ---------- the office pages that stay on the website ---------- */
export type OfficeKey = 'today' | 'schedule' | 'wod' | 'results' | 'plan' | 'class' | 'members' | 'billing' | 'docs' | 'staff' | 'settings';
// [key, name, one line, owners only]
export const OFFICE: [OfficeKey, string, string, boolean?][] = [
  ['today', 'Check in', "Today's classes and who is here"], ['schedule', 'Schedule', 'Classes, times and coaches'],
  ['wod', 'Workouts', 'Write the week, Parts A to D'], ['results', 'Results', 'Enter scores for the day'],
  ['plan', 'Plan builder', 'AI cycles from a day to a quarter'], ['class', 'Log a class', 'Type weights live, straight to the board'],
  ['members', 'Members', 'Profiles, waivers and attendance'], ['billing', 'Billing', 'Plans, invoices and payments', true],
  ['docs', 'Documents', 'Waiver and membership contract', true], ['staff', 'Staff', 'Coaches, swaps, hours and pay'],
  ['settings', 'Settings', 'Gym details and board link'],
];
export const officeHref = (gid: string, k: OfficeKey) =>
  k === 'class' ? `/class/${gid}` : k === 'plan' ? `/plan/${gid}` : k === 'wod' ? `/wod/${gid}` : k === 'results' ? `/results/${gid}` : k === 'settings' ? `/gym/${gid}` : `/club/${gid}?tab=${k}`;
export const tvHref = (g: { id: string; slug?: string | null }) => `/tv/${g.slug || g.id}`;
export const openWeb = (path: string) => WebBrowser.openBrowserAsync(WEB + path).catch(() => {});

/* ---------- small shared pieces ---------- */
const TONE = { up: C.up, down: C.down, flat: C.flat, acc: C.accent, none: C.muted } as const;
export function Pill({ label, tone = 'none' }: { label: string; tone?: keyof typeof TONE }) {
  return createElement(Text, { style: [st.pill, { color: TONE[tone], borderColor: TONE[tone] }] }, label);
}
// Same as <Screen stack>, but taps go through while the keyboard is up, and the keyboard never covers a box.
export function OfficeScreen({ children }: { children: ReactNode }) {
  return createElement(SafeAreaView, { style: { flex: 1, backgroundColor: C.bg }, edges: [] },
    createElement(ScrollView, { contentContainerStyle: s.pad, keyboardShouldPersistTaps: 'handled', keyboardDismissMode: 'on-drag', automaticallyAdjustKeyboardInsets: true }, children));
}
const st = StyleSheet.create({
  pill: { fontSize: 11, fontWeight: '700', borderWidth: 1, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1, overflow: 'hidden', marginLeft: 6 },
});
