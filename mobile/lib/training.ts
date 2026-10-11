// My training: every session a member logs on their own, plus the Pro insights.
// Same rules and wording as the website (site/js/training.js). Logging is free.
// Heavy singles on catalog lifts become PRs: the four DSI lifts for everyone, every lift on Pro.
import { addDays, ALL_LIFTS, fmt, monday, today } from './data';
// @ts-ignore  shared scoring module, same file the website uses
import * as D from './dsi.js';
import { sb } from './supabase';

export type TSet = { r: number; w: number };
export type Exercise = { name: string; lift: string | null; sets: TSet[] };
export type Session = { id: string; profile_id: string; day: string; title: string; note: string | null; exercises: Exercise[]; created_at?: string; updated_at?: string };

// The database holds at most 40 exercises in one session.
export const MAX_EXERCISES = 40;

// The web's suggestion list (its datalist), in the same order.
export const COMMON = ['Back squat', 'Bench press', 'Deadlift', 'Clean', 'Front squat', 'Overhead squat', 'Strict press', 'Push press', 'Power clean', 'Squat clean', 'Clean and jerk', 'Snatch', 'Power snatch', 'Jerk', 'Sumo deadlift',
  'Romanian deadlift', 'Incline bench press', 'Dumbbell bench press', 'Barbell row', 'Pull up', 'Weighted pull up', 'Dip', 'Lunge', 'Bulgarian split squat', 'Hip thrust', 'Good morning', 'Dumbbell press', 'Curl', 'Tricep extension'];

// Quick picks shown on an empty exercise: the four DSI lifts first, then a few common ones.
const DSI_IDS = (D.LIFTS as { db: string }[]).map(l => l.db);
const NAME_OF = Object.fromEntries(ALL_LIFTS) as Record<string, string>;
export const QUICK: string[] = [...DSI_IDS.map(id => NAME_OF[id]), 'Front squat', 'Strict press', 'Power clean', 'Romanian deadlift'];
export const CATALOG_NAMES: string[] = ALL_LIFTS.map(([, n]) => n);

const CATALOG = Object.fromEntries(ALL_LIFTS.map(([id, n]) => [n.toLowerCase(), id])) as Record<string, string>;
export const liftFor = (name: string) => CATALOG[String(name || '').trim().toLowerCase()] || null;
export const isDsiLift = (id: string | null) => !!id && !!D.LIFT_BY_DB[id];

export const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);
export const e1rm = (w: number, r: number) => (r <= 1 ? w : Math.round(w * (1 + r / 30))); // Epley
export const vol = (ex: Exercise) => (ex.sets || []).reduce((t, s) => t + num(s.r) * num(s.w), 0);
export const sessionTotal = (wk: Pick<Session, 'exercises'>) => (wk.exercises || []).reduce((t, ex) => t + vol(ex), 0);
export const setText = (s: TSet) => `${num(s.w) ? fmt(num(s.w)) : 'BW'}×${num(s.r)}`;
export const setLine = (ex: Exercise) => (ex.sets || []).map(setText).join(', ');
// Heaviest set, more reps breaks a tie.
export const topSet = (ex: Exercise) => (ex.sets || []).reduce<TSet | null>((b, s) => (!b || num(s.w) > num(b.w) || (num(s.w) === num(b.w) && num(s.r) > num(b.r)) ? s : b), null);

const pd = (s: string) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const fmtDW = (s: string) => pd(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

// The table ships with a migration; until it lands the screens say so instead of failing.
export const missing = (e: { message?: string; code?: string } | null) => !!e && (/personal_workouts/.test(e.message || '') || e.code === '42P01' || e.code === 'PGRST205');

// Suggestions while typing a name: catalog lifts and the common list, best match first.
const NAMES = [...new Set([...CATALOG_NAMES, ...COMMON])];
export function searchNames(q: string, n = 8) {
  const k = q.trim().toLowerCase();
  if (!k) return [];
  const rank = (x: string) => { const l = x.toLowerCase(); return l.startsWith(k) ? 0 : l.split(' ').some(w => w.startsWith(k)) ? 1 : 2; };
  return NAMES.filter(x => { const l = x.toLowerCase(); return l !== k && l.includes(k); })
    .sort((a, b) => rank(a) - rank(b) || a.length - b.length).slice(0, n);
}

/* ---------- Pro insights: weekly volume for 8 weeks and the best estimated max per exercise ---------- */
export type Best = { name: string; v: number; day: string; s: TSet };
export function insights(wks: Session[]) {
  const start = addDays(monday(today()), -49);
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(start, i * 7));
  const of = (wk: string) => wks.filter(w => w.day >= wk && w.day < addDays(wk, 7));
  const vols = weeks.map(wk => of(wk).reduce((t, w) => t + sessionTotal(w), 0));
  const counts = weeks.map(wk => of(wk).length);
  const best = new Map<string, Best>();
  wks.forEach(w => (w.exercises || []).forEach(ex => (ex.sets || []).forEach(s => {
    const v = e1rm(num(s.w), num(s.r)); if (!v) return;
    const k = String(ex.name || '').trim(); if (!k) return;
    const cur = best.get(k);
    if (!cur || v > cur.v) best.set(k, { name: k, v, day: w.day, s });
  })));
  const top = [...best.values()].sort((a, b) => b.v - a.v).slice(0, 8);
  return { weeks, vols, counts, top };
}

/* ---------- editor draft to saved row ---------- */
export type DraftSet = { k: number; r: string; w: string };
export type DraftEx = { k: number; name: string; sets: DraftSet[] };

// Same clean up as the web: blank sets drop, reps 1 to 200, weight 0 to 1500 in half pounds, unnamed or empty exercises drop.
export function cleanExercises(exs: DraftEx[]): Exercise[] {
  return exs.map(ex => ({
    name: ex.name.trim().slice(0, 60),
    lift: liftFor(ex.name),
    sets: ex.sets.filter(s => s.r.trim() !== '' || s.w.trim() !== '')
      .map(s => ({ r: Math.max(1, Math.min(200, Math.round(num(s.r)) || 1)), w: Math.max(0, Math.min(1500, Math.round(num(s.w) * 2) / 2)) })),
  })).filter(ex => ex.name && ex.sets.length);
}

/* ---------- heavy singles become lift entries ---------- */
export type Written = { id: string; lift: string; w: number; isPr: boolean; prev: number | null };

// For each exercise on a catalog lift (the four DSI lifts for everyone, the rest on Pro), the heaviest single (1 rep)
// is written to lift_entries with source 'workout' and a note, only when it beats the best already on record.
// Re-saving a session never writes the same single twice because the first write raised the best.
export async function writeSingles(profileId: string, pro: boolean, exercises: Exercise[], day: string, title: string): Promise<{ written: Written[]; failed: boolean }> {
  const tops: { lift: string; w: number }[] = [];
  for (const ex of exercises) {
    if (!ex.lift) continue;
    if (!isDsiLift(ex.lift) && !pro) continue;
    // lift_entries holds weights under 1500 lb, so a set at the cap cannot post.
    const top = Math.max(0, ...ex.sets.filter(s => s.r === 1 && s.w < 1500).map(s => s.w));
    if (top) tops.push({ lift: ex.lift, w: top });
  }
  if (!tops.length) return { written: [], failed: false };
  // Best on record per lift, read fresh (struck lifts do not count), the same rule the PR trigger uses.
  const lifts = [...new Set(tops.map(t => t.lift))];
  const reads = await Promise.all(lifts.map(l => sb.from('lift_entries').select('weight_lb').eq('profile_id', profileId).eq('lift', l)
    .neq('status', 'struck').order('weight_lb', { ascending: false }).limit(1)));
  if (reads.some(r => r.error)) return { written: [], failed: true };
  const best = new Map<string, number>(lifts.map((l, i) => [l, num(((reads[i].data ?? [])[0] as { weight_lb?: number } | undefined)?.weight_lb)]));
  const written: Written[] = [];
  let failed = false;
  // The same lift twice in one session posts once: the first write raises the best.
  for (const t of tops) {
    if (t.w <= (best.get(t.lift) ?? 0)) continue;
    const { data: e, error: err } = await sb.from('lift_entries')
      .insert({ profile_id: profileId, lift: t.lift, weight_lb: t.w, performed_on: day, source: 'workout', note: `From ${title}` })
      .select('id,lift,weight_lb,is_pr,prev_best').single();
    if (err || !e) { failed = true; continue; }
    best.set(t.lift, t.w);
    written.push({ id: e.id, lift: e.lift, w: num(e.weight_lb), isPr: !!e.is_pr, prev: e.prev_best == null ? null : num(e.prev_best) });
  }
  return { written, failed };
}
