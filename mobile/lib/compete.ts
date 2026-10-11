// Compete and grow: seasons, weekly battles, the gym league, benchmark boards and the year recap.
// Same math and rules as the website (site/js/extra.js): dsiAt, gainIn, allEntries, quarter, battleScore.
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Alert } from 'react-native';

import { C } from '@/constants/Colors';
import { addDays, iso, LIFTS, monday, score, today, total, type BoardRow } from './data';
import { sb } from './supabase';

export const MAIN = LIFTS.map(l => l.db);
type K = 'bench' | 'squat' | 'dead' | 'clean';
const KEY: Record<string, K> = Object.fromEntries(LIFTS.map(l => [l.db, l.k]));
export const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);
export const pd = (s: string) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MINE_BG = 'rgba(242,201,76,0.08)';

export type LiftRow = { id: string; profile_id: string; lift: string; weight_lb: number; performed_on: string; status: string; is_pr: boolean; prev_best: number | null; created_at?: string };
export type Prof = { bw?: number | null; bodyweight?: number | null; age?: number | null; birth_year?: number | null };
export type Gain = { pts: number; lb: number; prs: number; start?: number; end?: number };

/* ---------- paging: the API caps each request, so read in pages until a short page comes back ---------- */
type Res = { data: unknown; error: { message: string } | null };
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<Res>, page = 1000, max = 100000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max;) {
    const { data, error } = await build(from, from + page - 1);
    if (error) throw new Error(error.message);
    const rows = (data as T[]) ?? [];
    out.push(...rows);
    if (rows.length < page) break;
    from += rows.length;
  }
  return out;
}

/* ---------- DSI at any date, from a lifter's own entries. Struck lifts never count. ---------- */
export function dsiAt(entries: LiftRow[], prof: Prof, date: string, from?: string) {
  const r = { bw: num(prof.bw ?? prof.bodyweight) || 185, age: num(prof.age) || (prof.birth_year ? new Date().getFullYear() - prof.birth_year : 30), bench: 0, squat: 0, dead: 0, clean: 0 };
  for (const e of entries) {
    if (e.status === 'struck' || !MAIN.includes(e.lift)) continue;
    if (e.performed_on > date || (from && e.performed_on < from)) continue;
    const k = KEY[e.lift]; r[k] = Math.max(r[k], num(e.weight_lb));
  }
  const has = LIFTS.some(l => r[l.k]);
  return { score: has ? score(r) : 0, total: total(r), row: r, has };
}

// Points gained in a window: DSI at the end minus DSI the day before it starts.
// A lifter with nothing logged before the window starts from their first day inside it, so joining is not a gain.
export function gainIn(entries: LiftRow[], prof: Prof, start: string, end: string): Gain {
  const mine = entries.filter(e => e.status !== 'struck' && MAIN.includes(e.lift));
  const before = mine.filter(e => e.performed_on < start);
  let base;
  if (before.length) base = dsiAt(mine, prof, addDays(start, -1));
  else {
    const first = mine.filter(e => e.performed_on >= start && e.performed_on <= end).map(e => e.performed_on).sort()[0];
    if (!first) return { pts: 0, lb: 0, prs: 0 };
    base = dsiAt(mine, prof, first);
  }
  const fin = dsiAt(mine, prof, end);
  const prs = mine.filter(e => e.is_pr && e.prev_best != null && e.performed_on >= start && e.performed_on <= end).length;
  return { pts: Math.max(0, fin.score - base.score), lb: Math.max(0, fin.total - base.total), prs, start: base.score, end: fin.score };
}

/* ---------- every main lift entry, grouped by lifter ----------
   Kept in memory for the session. Before reusing it, one count query checks nothing was logged,
   deleted or struck since; after 30 minutes it reloads anyway. Pull to refresh passes force. */
type Cache = { at: number; count: number | null; by: Map<string, LiftRow[]> };
let cache: Cache | null = null;
let inflight: Promise<Cache> | null = null;
const STALE = 30 * 60 * 1000, FRESH = 20 * 1000;

async function countMain(): Promise<number | null> {
  const { count, error } = await sb.from('lift_entries').select('id', { count: 'exact', head: true }).in('lift', MAIN).neq('status', 'struck');
  return error ? null : count ?? null;
}
async function loadEntries(): Promise<Cache> {
  const [count, rows] = await Promise.all([
    countMain(),
    fetchAll<LiftRow>((a, b) => sb.from('lift_entries')
      .select('id,profile_id,lift,weight_lb,performed_on,status,is_pr,prev_best,created_at')
      .in('lift', MAIN).neq('status', 'struck').order('performed_on').order('id').range(a, b)),
  ]);
  const by = new Map<string, LiftRow[]>();
  rows.forEach(r => { if (!by.has(r.profile_id)) by.set(r.profile_id, []); by.get(r.profile_id)!.push(r); });
  return { at: Date.now(), count, by };
}
export async function allEntries(force = false): Promise<Map<string, LiftRow[]>> {
  if (!force && cache) {
    const age = Date.now() - cache.at;
    if (age < FRESH) return cache.by;
    if (age < STALE) {
      const c = await countMain();
      if (c === null || c === cache.count) { cache.at = Date.now() - FRESH; return cache.by; }
    }
  }
  if (!inflight) inflight = loadEntries().then(c => { cache = c; return c; }).finally(() => { inflight = null; });
  return (await inflight).by;
}
// Call after logging or deleting a lift if a compete screen should not wait for the count check.
export const forgetEntries = () => { cache = null; };

/* ---------- seasons: one per quarter ---------- */
export type Quarter = { y: number; q: number; start: string; end: string; name: string };
export function quarter(d: string): Quarter {
  const t = pd(d), q = Math.floor(t.getMonth() / 3), y = t.getFullYear();
  return { y, q: q + 1, start: iso(new Date(y, q * 3, 1)), end: iso(new Date(y, q * 3 + 3, 0)), name: ['Winter', 'Spring', 'Summer', 'Fall'][q] + ' ' + y };
}
export const qid = (q: Quarter) => `${q.y}-q${q.q}`;
export const fromQid = (arg?: string | null) => /^\d{4}-q[1-4]$/i.test(arg ?? '')
  ? quarter(`${arg!.slice(0, 4)}-${String((Number(arg!.slice(6)) - 1) * 3 + 1).padStart(2, '0')}-01`) : null;
export const prevQuarter = (q: Quarter) => quarter(addDays(q.start, -1));
export const nextQuarter = (q: Quarter) => quarter(addDays(q.end, 1));
export const daysLeft = (end: string) => Math.max(0, Math.round((pd(end).getTime() - pd(today()).getTime()) / 864e5));

export type SeasonRow = { r: BoardRow; g: Gain };
// Ranked by DSI points gained, then pounds added. Only lifters who gained show.
export function seasonRows(board: BoardRow[], by: Map<string, LiftRow[]>, q: Quarter): SeasonRow[] {
  const end = q.end < today() ? q.end : today();
  return board.map(r => ({ r, g: gainIn(by.get(r.profile_id) ?? [], r, q.start, end) }))
    .filter(x => x.g.pts > 0 || x.g.lb > 0)
    .sort((a, b) => b.g.pts - a.g.pts || b.g.lb - a.g.lb);
}

/* ---------- weekly battles ---------- */
export type Battle = { id: string; challenger: string; opponent: string; week_start: string; status: 'pending' | 'accepted' | 'declined' | 'cancelled'; trash_talk: string | null; created_at: string; responded_at: string | null };
export type BattleScore = { a: Gain; o: Gain; over: boolean; lead: string | null; live: boolean };
export type Tone = 'up' | 'acc' | 'flat';
export const TONE: Record<Tone, string> = { up: C.up, acc: C.accent, flat: C.flat };

export function battleScore(b: Battle, by: Map<string, LiftRow[]>, board: BoardRow[]): BattleScore {
  const last = addDays(b.week_start, 6), t = today();
  const end = last < t ? last : t;
  const side = (id: string) => { const r: Prof = board.find(x => x.profile_id === id) ?? { bw: 185, age: 30 }; return gainIn(by.get(id) ?? [], r, b.week_start, end); };
  const a = side(b.challenger), o = side(b.opponent);
  const over = last < t;
  const lead = a.pts !== o.pts ? (a.pts > o.pts ? b.challenger : b.opponent) : a.lb !== o.lb ? (a.lb > o.lb ? b.challenger : b.opponent) : null;
  return { a, o, over, lead, live: b.week_start <= t && !over };
}

// The status pill: who won, live, when it starts, or who it is waiting on.
export function battleStatus(b: Battle, s: BattleScore, name: (id: string) => string, fmtD: (d: string) => string, meId?: string | null): { label: string; tone: Tone } {
  if (b.status === 'accepted') return { label: s.over ? (s.lead ? `${s.lead === meId ? 'You' : name(s.lead)} won` : 'Tie') : s.live ? 'Live' : 'Starts ' + fmtD(b.week_start), tone: s.live ? 'up' : 'acc' };
  if (b.status === 'pending') return { label: s.over ? 'Never answered' : b.opponent === meId ? 'Waiting on you' : 'Waiting on ' + name(b.opponent), tone: 'flat' };
  return { label: b.status === 'declined' ? 'Declined' : 'Called off', tone: 'flat' };
}
export const weekOver = (b: Battle) => addDays(b.week_start, 6) < today();

// This week and the next four Mondays, the window the database accepts.
export const battleWeeks = () => [0, 7, 14, 21, 28].map(n => addDays(monday(today()), n));

// Accept, decline or call off. Decline and call off ask first. Calls done() after a change.
export function respondBattle(id: string, action: 'accept' | 'decline' | 'cancel', done: () => void) {
  const run = async () => {
    const { error } = await sb.rpc('respond_battle', { p_id: id, p_action: action });
    if (error) { Alert.alert('That did not go through', error.message); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (action === 'accept') Alert.alert('Game on.', 'Most DSI points gained by Sunday wins.');
    done();
  };
  if (action === 'accept') { run(); return; }
  Alert.alert(action === 'cancel' ? 'Call it off?' : 'Decline this battle?', undefined, [
    { text: 'Keep it', style: 'cancel' },
    { text: action === 'cancel' ? 'Call it off' : 'Decline', style: 'destructive', onPress: run },
  ]);
}

/* ---------- threads: Talk on a battle uses the same room_for path as PR and day threads ---------- */
export async function openThread(kind: 'battle' | 'pr' | 'workout', ref: string, title: string, signedIn: boolean) {
  if (!signedIn) { router.push('/login'); return; }
  const { data, error } = await sb.rpc('room_for', { p_kind: kind, p_ref: ref, p_title: title });
  if (error) { Alert.alert('Could not open the thread', error.message); return; }
  router.push({ pathname: '/room/[id]', params: { id: String(data), title } });
}

/* ---------- gym league ---------- */
export type Gym = { id: string; name: string; city: string | null; slug?: string | null; created_by?: string | null };
export type LeagueRow = { g: Gym; n: number; avg: number; best: BoardRow | undefined };
// Ranked by the average DSI of each gym's top five lifters. A gym needs three lifters to rank.
export function gymLeague(gyms: Gym[], board: BoardRow[], gymOf: Map<string, string>): LeagueRow[] {
  const members = (gid: string) => board.filter(r => gymOf.get(r.profile_id) === gid).sort((a, b) => b.score - a.score);
  return gyms.map(g => {
    const m = members(g.id), top = m.slice(0, 5);
    return { g, n: m.length, avg: top.length ? Math.round(top.reduce((s, r) => s + r.score, 0) / top.length) : 0, best: m[0] };
  }).sort((a, b) => Number(b.n >= 3) - Number(a.n >= 3) || b.avg - a.avg || b.n - a.n);
}
export async function loadGymOf(): Promise<Map<string, string>> {
  const rows = await fetchAll<{ id: string; gym_id: string }>((a, b) => sb.from('profiles').select('id,gym_id').not('gym_id', 'is', null).order('id').range(a, b));
  return new Map(rows.map(p => [p.id, p.gym_id]));
}
// Set or clear my gym. Returns an error message or null; the caller reloads the session.
export async function setMyGym(profileId: string, gymId: string | null) {
  const { error } = await sb.from('profiles').update({ gym_id: gymId }).eq('id', profileId);
  return error ? error.message : null;
}

/* ---------- benchmark boards ---------- */
export type BenchWorkout = { id: string; day: string; title: string; benchmark: string; score_type: string | null; score_label: string | null };
export type BenchLog = { id: string; workout_id: string; profile_id: string; score: string | null; status: string };
const secs = (s: unknown) => { const m = String(s ?? '').match(/^(\d+):(\d{1,2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
export const scoreVal = (s: unknown, type: string | null) => (type === 'time' ? secs(s) : (parseFloat(String(s ?? '').replace(/[^0-9.]/g, '')) || null));

export async function loadBenchmarks() {
  const { data: w, error } = await sb.from('workouts').select('id,day,title,benchmark,score_type,score_label').not('benchmark', 'is', null).order('day', { ascending: false });
  if (error) throw new Error(error.message);
  const ws = (w ?? []) as BenchWorkout[];
  const ids = ws.map(x => x.id);
  const logs = ids.length ? await fetchAll<BenchLog>((a, b) => sb.from('workout_logs').select('id,workout_id,profile_id,score,status').in('workout_id', ids).neq('status', 'struck').order('id').range(a, b)) : [];
  return { ws, logs };
}
// Each lifter's best: fastest time when the benchmark is timed, otherwise the most.
export function benchBoard(bw: BenchWorkout[], logs: BenchLog[]) {
  const type = bw[0]?.score_type ?? null, best = new Map<string, { v: number; s: string; day: string }>();
  for (const l of logs) {
    const w = bw.find(x => x.id === l.workout_id); if (!w) continue;
    const v = scoreVal(l.score, type); if (v == null) continue;
    const cur = best.get(l.profile_id);
    if (!cur || (type === 'time' ? v < cur.v : v > cur.v)) best.set(l.profile_id, { v, s: String(l.score), day: w.day });
  }
  return [...best.entries()].sort((a, b) => (type === 'time' ? a[1].v - b[1].v : b[1].v - a[1].v));
}

/* ---------- who is Pro: the web puts a Pro tag next to every name on these boards ---------- */
let proCache: { at: number; ids: Set<string> } | null = null;
export async function loadProIds(force = false): Promise<Set<string>> {
  if (!force && proCache && Date.now() - proCache.at < 10 * 60 * 1000) return proCache.ids;
  try {
    const rows = await fetchAll<{ id: string }>((a, b) => sb.from('profiles').select('id').or('tier.eq.pro,role.in.(admin,commissioner)').order('id').range(a, b));
    proCache = { at: Date.now(), ids: new Set(rows.map(r => r.id)) };
  } catch { return proCache?.ids ?? new Set(); }
  return proCache.ids;
}

/* ---------- display names for profile ids that are not on the board ---------- */
export async function namesFor(ids: string[]): Promise<Record<string, string>> {
  const u = [...new Set(ids)].filter(Boolean);
  if (!u.length) return {};
  const { data } = await sb.from('profiles').select('id,display_name').in('id', u);
  return Object.fromEntries((data ?? []).map((p: any) => [p.id, p.display_name || 'Someone']));
}
// A name lookup that tries the board first, then the extra names.
export const namer = (board: BoardRow[], extra: Record<string, string>) => {
  const m = new Map(board.map(r => [r.profile_id, r.name]));
  return (id: string) => m.get(id) || extra[id] || 'Someone';
};
