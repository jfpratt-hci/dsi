// A training day is Part A, B, C and sometimes D. Same rules as the website (site/js/gym.js).
// Part A is never logged. B, C and D can each log one weight, a time and total reps.
// Stored on the workout row: sections [{ part, name, text, time?, reps? }] and lifts [{ id: 'b', part: 'B', n, sch, b, f | rx, rxw, why, max? }].
// Weights are kept in workout_logs.entries under the lift id ('b'), times in seconds under '<part>_t', reps under '<part>_r'.
// Older days (no parts) keep their section list and log their lift list.

export type Lift = { id: string; part?: string; n: string; sch: string; b?: string; f?: number; rx?: number[]; rxw?: number[]; why?: string; max?: boolean };
export type Section = { part?: string; name: string; text: string; time?: boolean; reps?: boolean };
export type Workout = {
  id: string; day: string; title: string; source: string | null; gym_id: string | null;
  sections: Section[]; lifts: Lift[]; score_label: string | null; score_type: string | null;
  rest_note: string | null; pr_lift: string | null; benchmark?: string | null;
};
export type Part = { L: string; name: string; text: string; time: boolean; reps: boolean; lift: Lift | null };
export type Item = { key: string; kind: 'w' | 't' | 'r'; label: string; sch: string; lift: Lift | null; L: string };

const LET = ['A', 'B', 'C', 'D'];
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);

export const isParts = (w?: Workout | null) => !!w && ((w.sections ?? []).some(s => s.part) || (w.lifts ?? []).some(l => l.part));

export function partsOf(w: Workout, withD = false): Part[] {
  const secs = w.sections ?? [], lifts = w.lifts ?? [], np = isParts(w);
  return LET.map((L, i) => {
    const s: Partial<Section> = (np ? secs.find(x => x.part === L) : secs[i]) ?? {};
    return { L, name: s.name ?? '', text: s.text ?? '', time: !!s.time, reps: !!s.reps, lift: lifts.find(l => l.part === L) ?? null };
  }).filter(p => p.L !== 'D' || withD || p.text || p.lift || p.time || p.reps);
}

// What a screen shows: the parts with something in them. Older days keep every section they had.
export const shownParts = (w: Workout): Part[] => isParts(w)
  ? partsOf(w).filter(p => p.text || p.lift || p.time || p.reps)
  : (w.sections ?? []).map((s, i) => ({ L: String.fromCharCode(65 + i), name: s.name, text: s.text, lift: null, time: false, reps: false }));

// Everything a member logs for a day, in part order.
export function items(w?: Workout | null): Item[] {
  if (!w) return [];
  if (!isParts(w)) return (w.lifts ?? []).map(l => ({ key: l.id, kind: 'w' as const, label: l.n, sch: l.sch, lift: l, L: '' }));
  const out: Item[] = [];
  for (const p of partsOf(w)) {
    if (p.lift) out.push({ key: p.lift.id, kind: 'w', label: `${p.L} · ${p.lift.n}`, sch: p.lift.sch, lift: p.lift, L: p.L });
    if (p.time) out.push({ key: p.L.toLowerCase() + '_t', kind: 't', label: `${p.L} · ${p.name || 'Part ' + p.L} time`, sch: '', lift: null, L: p.L });
    if (p.reps) out.push({ key: p.L.toLowerCase() + '_r', kind: 'r', label: `${p.L} · ${p.name || 'Part ' + p.L} reps`, sch: 'total reps', lift: null, L: p.L });
  }
  return out;
}

// Seconds to "8:45" or "1:02:30".
export const fmtT = (v: unknown) => {
  const s = Math.round(num(v)); if (!s) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
};
// "8:45" or "1:02:30"; a plain number is minutes. NaN when it is not a time.
export const parseT = (v: string) => {
  v = String(v ?? '').trim(); if (!v) return 0;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 60);
  const m = v.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
};
export const cell = (it: Item, v: unknown) => (it.kind === 't' ? fmtT(v) : num(v) ? Number(num(v)).toLocaleString('en-US') : '');

// What a member logs for a part, in words: "Back squat weight and time".
export const logWords = (p: Part) => [p.lift ? p.lift.n + ' weight' : '', p.time ? 'time' : '', p.reps ? 'total reps' : ''].filter(Boolean).join(' and ');

// The day board ranks by the max lift if there is one, else the first thing logged: fastest time, most reps or heaviest weight.
export const rankKey = (w: Workout) => { const its = items(w); return its.find(i => i.lift?.max) ?? its[0] ?? null; };

// Part D only shows on a board once somebody logged it.
export const boardItems = (w: Workout, logs: { entries?: Record<string, number> | null }[]) =>
  items(w).filter(it => it.L !== 'D' || logs.some(x => num((x.entries ?? {})[it.key])));

// Rx text for a lift: "Rx 135/95, Rx+ 155/105 lb" (men/women), or the percent of a base lift.
const BASES: Record<string, string> = { squat: 'squat', dead: 'deadlift', clean: 'clean', bench: 'bench' };
export const liftRule = (l: Lift) => l.rx && l.rx.length
  ? `Rx ${l.rx[0]}${l.rxw ? '/' + l.rxw[0] : ''}${l.rx[1] && l.rx[1] !== l.rx[0] ? `, Rx+ ${l.rx[1]}${l.rxw && l.rxw[1] !== l.rxw[0] ? '/' + l.rxw[1] : ''}` : ''} lb`
  : l.f ? `${Math.round(l.f * 100)}% of ${BASES[l.b ?? ''] ?? l.b}` : '';

// Sort a day's logs like the web's day board (site/js/app.js dayBoard): struck last, then a timed score
// (fastest first), then the rank key. Text scores do not reorder the board.
export function sortDay<T extends { status?: string; score?: string | null; entries?: Record<string, number> | null }>(w: Workout, logs: T[]): T[] {
  const isT = w.score_type === 'time';
  const secs = (s?: string | null) => { const m = String(s ?? '').match(/^(\d+):(\d{1,2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : 1e9; };
  const rk = rankKey(w), key = rk?.key ?? '', asc = !!rk && rk.kind === 't' && isParts(w);
  const ev = (x: T) => num((x.entries ?? {})[key]);
  return [...logs].sort((a, b) =>
    (Number(a.status === 'struck') - Number(b.status === 'struck'))
    || (isT ? secs(a.score) - secs(b.score) : 0)
    || (asc ? (ev(a) || 1e9) - (ev(b) || 1e9) : ev(b) - ev(a)));
}
