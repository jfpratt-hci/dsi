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
};

const n = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

export async function loadBoard(): Promise<BoardRow[]> {
  const { data, error } = await sb.from('board').select('*');
  if (error) throw error;
  return (data ?? []).map((r: any) => {
    const x = { ...r, bw: n(r.bw), age: n(r.age), bench: n(r.bench), squat: n(r.squat), dead: n(r.dead), clean: n(r.clean) };
    return { ...x, score: D.score(x), total: D.total(x), p: D.pcts(x) } as BoardRow;
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
