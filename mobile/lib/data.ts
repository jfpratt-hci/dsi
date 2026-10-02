import { sb } from './supabase';
// @ts-ignore  shared scoring module, same file the website uses
import * as D from './dsi.js';

export type BoardRow = {
  profile_id: string;
  name: string;
  division: string;
  age: number;
  bw: number;
  roast_opt_in: boolean;
  bench: number; squat: number; dead: number; clean: number;
  bench_date: string | null; squat_date: string | null; dead_date: string | null; clean_date: string | null;
  has_protest: boolean;
  score: number;
  total: number;
  p: Record<string, number>;
  g: { lift: Record<string, number>; score: number; total: number };
};

const n = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

export async function loadBoard(): Promise<BoardRow[]> {
  const { data, error } = await sb.from('board').select('*');
  if (error) throw error;
  return (data ?? []).map((r: any) => {
    const x = { ...r, bw: n(r.bw), age: n(r.age), bench: n(r.bench), squat: n(r.squat), dead: n(r.dead), clean: n(r.clean) };
    return { ...x, score: D.score(x), total: D.total(x), p: D.pcts(x), g: D.gains(x) } as BoardRow;
  });
}

export const LIFTS = D.LIFTS as { k: 'bench' | 'squat' | 'dead' | 'clean'; db: string; n: string }[];
export const liftName: (id: string) => string = D.liftName;
export const target: (l: any, p: any) => number = D.target;
export const verdict = D.verdict as (s: number) => [number, string, string, string];

export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = () => iso(new Date());
export const monday = (s: string) => { const [y, m, d] = s.split('-').map(Number); const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7)); return iso(dt); };
export const addDays = (s: string, k: number) => { const [y, m, d] = s.split('-').map(Number); const dt = new Date(y, m - 1, d + k); return iso(dt); };
export const fmtD = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
export const isNew = (s: string | null) => !!s && (Date.now() - new Date(s + 'T12:00:00').getTime()) / 864e5 <= 6.5;

/* ---------- shared lookups used across screens ---------- */
export const ALL_LIFTS = D.ALL_LIFTS as [string, string][];
export const pcts: (r: any) => Record<string, number> = D.pcts;
export const fmtPct: (v: number) => string = D.fmtPct;
export const score: (r: any) => number = D.score;
export const total: (r: any) => number = D.total;
export const clubOf: (t: number) => number | undefined = D.clubOf;
export const isMain = (db: string) => ['bench', 'squat', 'deadlift', 'clean'].includes(db);
export const keyOf = (db: string) => (db === 'deadlift' ? 'dead' : db);
const LC: Record<string, string> = { bench: '#5B93E8', squat: '#EF4B5C', deadlift: '#3DBA74', clean: '#F2C94C' };
export const colorOf = (db: string) => LC[db] ?? '#8E9AB0';
export const timeAgo = (ts: string) => {
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
export const fmt = (n: number) => Number(n || 0).toLocaleString('en-US');
export const ageOf = (by: number | null | undefined) => (by ? new Date().getFullYear() - by : 0);

export type Entry = { id: string; profile_id: string; lift: string; weight_lb: number; performed_on: string; is_pr: boolean; prev_best: number | null; status: string; note: string | null; source: string; video_path: string | null };
export type PR = { id: string; profile_id: string; name: string; lift: string; weight_lb: number; prev_best: number | null; performed_on: string; status: string; created_at?: string };

export function videoUrl(path: string) {
  return sb.storage.from('lift-videos').getPublicUrl(path).data.publicUrl;
}

/* ---------- reports and blocks ---------- */
export async function report(targetType: 'message' | 'profile' | 'lift_entry' | 'workout_log', targetId: string, reporter: string, reason: string) {
  return sb.from('reports').insert({ reporter, target_type: targetType, target_id: targetId, reason });
}
export async function block(blocker: string, blocked: string) {
  return sb.from('blocks').insert({ blocker, blocked });
}
export async function unblock(blocker: string, blocked: string) {
  return sb.from('blocks').delete().eq('blocker', blocker).eq('blocked', blocked);
}
