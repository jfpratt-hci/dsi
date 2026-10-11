// Gym membership helpers for the phone app: classes and bookings, plans, invoices, waivers and contracts.
// Same rules and wording as site/js/club.js and site/js/doc-templates.js.
import type { Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { createElement } from 'react';
import { Text, type TextStyle } from 'react-native';

import { C } from '@/constants/Colors';
import { addDays, iso } from './data';
import { sb } from './supabase';

/* ---------- shapes ---------- */
export type Gym = {
  id: string; name: string; city: string | null; address: string | null; tz: string;
  slug?: string | null; phone?: string | null; email?: string | null;
  stripe_account?: string | null; stripe_ready: boolean;
};
export type ClassSession = {
  id: string; gym_id: string; class_id: string | null; name: string; starts_at: string; ends_at: string;
  capacity: number; coach_id: string | null; status: 'scheduled' | 'canceled'; note: string | null;
};
export type Booking = { id?: string; session_id: string; gym_id?: string; profile_id: string; status: 'booked' | 'waitlist' | 'canceled' | 'attended' | 'no_show'; checked_in_at?: string | null; created_at?: string };
export type Plan = {
  id: string; gym_id: string; name: string; description: string | null; price_cents: number;
  interval: 'month' | 'year' | 'once'; commitment_months: number; active: boolean; includes_pro?: boolean;
};
export type Membership = {
  id: string; gym_id: string; profile_id: string; plan_id: string | null; plan_name: string; price_cents: number;
  interval: string; status: 'pending' | 'active' | 'past_due' | 'paused' | 'canceled'; start_date: string; end_date: string | null;
  stripe_customer: string | null; stripe_subscription: string | null; created_at: string;
};
export type Invoice = {
  id: string; number: number; gym_id: string; profile_id: string; membership_id: string | null; description: string;
  amount_cents: number; status: 'open' | 'paid' | 'void'; due_date: string; paid_at: string | null; method: string | null; created_at: string;
};
export type GymDoc = { id: string; gym_id: string; kind: 'waiver' | 'contract'; title: string; body: string; version: number; active: boolean };
export type Signature = {
  id: string; doc_id: string; gym_id: string; kind: 'waiver' | 'contract'; profile_id: string; signed_name: string; signature: string;
  body_sha256: string; user_agent: string | null; context: SignContext | null; signed_at: string;
};
export type SignContext = { values?: Record<string, string>; plan_id?: string; plan?: string; price_cents?: number; interval?: string; commitment_months?: number };
export type MemberDetails = {
  profile_id: string; legal_name: string | null; email: string | null; phone: string | null;
  emergency_name: string | null; emergency_phone: string | null; updated_at?: string;
};

// Where a member picks their gym (the Gym league list).
export const GYM_PICKER = '/compete/gyms' as unknown as Href;

/* ---------- small helpers ---------- */
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Cents to dollars: $175 or $12.50
export const money = (c: number | string | null | undefined) => {
  const n = num(c);
  return '$' + (n / 100).toLocaleString('en-US', { minimumFractionDigits: n % 100 ? 2 : 0, maximumFractionDigits: 2 });
};
// "$175.50" or "175.5" to cents
export const cents = (v: string) => Math.round(parseFloat(String(v).replace(/[^0-9.]/g, '')) * 100) || 0;

// Throw on a Supabase error, return the rows.
export function must<T = any>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

// Clock time of an instant in the gym's time zone: 6:00 AM
export const tAt = (at: string, tz: string) => new Date(at).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
// The day (YYYY-MM-DD) an instant falls on in the gym's time zone.
export function dayOf(at: string | Date, tz: string) {
  const d = typeof at === 'string' ? new Date(at) : at;
  try {
    const t = d.toLocaleDateString('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const m = t.match(/(\d{1,2})\D+(\d{1,2})\D+(\d{4})/);
    if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  } catch {}
  return iso(d);
}
// Today in the gym's time zone.
export const todayIn = (tz: string) => dayOf(new Date(), tz);
// Sat, Oct 11, 6:00 AM in the gym's time zone
export const when = (at: string, tz: string) => new Date(at).toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
// A local day string as a Date at noon (safe for weekday names).
export const pd = (d: string) => { const [y, m, k] = d.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, k, 12); };
export const dayName = (d: string, opt?: Intl.DateTimeFormatOptions) => pd(d).toLocaleDateString('en-US', opt || { weekday: 'long', month: 'short', day: 'numeric' });
// "06:00:00" to 6:00 AM
export const hm = (t: string) => { const [h, m] = String(t).split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };

/* ---------- data ---------- */
export async function gymById(gid: string): Promise<Gym | null> {
  return must(await sb.from('gyms').select('*').eq('id', gid).maybeSingle()) as Gym | null;
}

// Board names for a list of profile ids.
export async function people(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter(Boolean) as string[])];
  if (!list.length) return new Map();
  const rows = must(await sb.from('profiles').select('id,display_name').in('id', list)) as { id: string; display_name: string | null }[];
  return new Map(rows.map(p => [p.id, p.display_name || 'Member']));
}

// Dated classes for a gym between two days (inclusive, gym time zone), built from the weekly templates.
export async function sessionsFor(g: Pick<Gym, 'id' | 'tz'>, from: string, to: string): Promise<ClassSession[]> {
  try { await sb.rpc('ensure_sessions', { p_gym: g.id, p_from: from, p_to: to }); } catch {}
  const rows = must(await sb.from('sessions').select('*').eq('gym_id', g.id)
    .gte('starts_at', addDays(from, -1) + 'T00:00:00Z').lt('starts_at', addDays(to, 2) + 'T00:00:00Z').order('starts_at')) as ClassSession[];
  return rows.filter(x => { const d = dayOf(x.starts_at, g.tz); return d >= from && d <= to; });
}

export async function rpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

// Has the member signed the gym's current waiver (or contract)? True when the gym has none.
export const hasSigned = (gid: string, kind: 'waiver' | 'contract') => rpc<boolean>('has_signed', { p_gym: gid, p_kind: kind }).catch(() => true);

/* ---------- payments (the billing edge function) ---------- */
// Same as the web: the function answers { error } with a plain message, for example when payments are not on yet.
export async function call<T = any>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await sb.functions.invoke('billing', { body: { action, ...body } });
  let msg: string | undefined = error?.message;
  const ctx = (error as any)?.context;
  if (error && ctx && typeof ctx.json === 'function') { try { const j = await ctx.json(); msg = (j && j.error) || msg; } catch {} }
  if (msg) throw new Error(msg);
  if (data && typeof data === 'object' && (data as any).error) throw new Error(String((data as any).error));
  return data as T;
}

// Start a card payment (pay an invoice, start a membership, or manage the card) in the in app browser.
// Resolves when the browser closes on iOS; on Android it resolves as soon as the browser opens.
export async function openBilling(action: 'pay' | 'subscribe' | 'portal', body: Record<string, unknown>) {
  const r = await call<{ url?: string }>(action, body);
  if (!r || !r.url) throw new Error('Could not open the payment page. Try again.');
  return WebBrowser.openBrowserAsync(r.url);
}

/* ---------- documents ---------- */
// Fill placeholders for display and for the record kept with a signature.
export function fillDoc(body: string, v: Record<string, string | number | null | undefined>) {
  return String(body).replace(/\{\{(\w+)\}\}/g, (m, k) => (v[k] != null && v[k] !== '' ? String(v[k]) : m));
}
export const docVals = (g: Pick<Gym, 'name' | 'address' | 'city'>, extra: Record<string, string> = {}): Record<string, string> => ({
  gym: g.name,
  gym_address: [g.address, g.city].filter(Boolean).join(', ') || g.city || '',
  date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
  ...extra,
});
export const planVals = (p: Pick<Plan, 'name' | 'price_cents' | 'interval' | 'commitment_months'> | null | undefined): Record<string, string> => p ? {
  plan: p.name,
  price: money(p.price_cents),
  interval: ({ month: 'per month', year: 'per year', once: 'one time' } as Record<string, string>)[p.interval],
  commitment: p.commitment_months ? `${p.commitment_months} months` : 'None, month to month',
} : {};

// The drawn signature as an image source: SVG markup (signed in the app) or a PNG data URL (signed on the web).
export function sigImage(sig: string): { svg: string } | { uri: string } | null {
  if (!sig) return null;
  if (sig.startsWith('data:image/svg+xml')) {
    const comma = sig.indexOf(',');
    const head = sig.slice(0, comma), data = sig.slice(comma + 1);
    try { return { svg: /;base64/.test(head) ? atob(data) : decodeURIComponent(data) }; } catch { return null; }
  }
  if (sig.startsWith('data:image/')) return { uri: sig };
  return null;
}

/* ---------- status pills ---------- */
type Tone = 'up' | 'down' | 'flat' | 'acc' | '';
const TONE: Record<string, string> = { up: C.up, down: C.down, flat: C.flat, acc: C.accent };
export function Pill({ label, tone = '', style }: { label: string; tone?: Tone; style?: TextStyle }) {
  const col = TONE[tone] ?? C.muted;
  return createElement(Text, {
    style: [{
      color: col, backgroundColor: col + '29', fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase',
      paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden', alignSelf: 'flex-start',
    } as TextStyle, style],
  }, label);
}
const STATUS: Record<string, [string, Tone]> = {
  active: ['Active', 'up'], past_due: ['Past due', 'down'], pending: ['Pending', 'flat'], paused: ['Paused', 'flat'], canceled: ['Ended', ''],
};
export function StatusPill({ status, style }: { status: string | null | undefined; style?: TextStyle }) {
  const [label, tone] = STATUS[status ?? ''] ?? ['None', ''];
  return Pill({ label, tone, style });
}
