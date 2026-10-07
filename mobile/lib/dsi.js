// DSI scoring. Same math as the original DSI page.
export const LIFTS = [
  { k: 'bench', db: 'bench', n: 'Bench', b: 1.11, c: 'var(--bench)' },
  { k: 'squat', db: 'squat', n: 'Squat', b: 1.50, c: 'var(--squat)' },
  { k: 'dead', db: 'deadlift', n: 'Deadlift', b: 1.83, c: 'var(--dead)' },
  { k: 'clean', db: 'clean', n: 'Clean', b: 1.00, c: 'var(--clean)' },
];
export const LIFT_BY_DB = Object.fromEntries(LIFTS.map(l => [l.db, l]));
// Every lift in the catalog (mirrors public.lifts). Only the four above feed the DSI score.
export const ALL_LIFTS = [
  ['bench', 'Bench press'], ['squat', 'Back squat'], ['deadlift', 'Deadlift'], ['clean', 'Clean'],
  ['front_squat', 'Front squat'], ['overhead_squat', 'Overhead squat'],
  ['snatch', 'Snatch'], ['squat_snatch', 'Squat snatch'], ['power_snatch', 'Power snatch'],
  ['squat_clean', 'Squat clean'], ['power_clean', 'Power clean'], ['clean_and_jerk', 'Clean and jerk'], ['jerk', 'Jerk'],
  ['strict_press', 'Strict press'], ['push_press', 'Push press'], ['sumo_deadlift', 'Sumo deadlift'],
];
const NAMES = Object.fromEntries(ALL_LIFTS);
export const OTHER_LIFTS = Object.fromEntries(ALL_LIFTS.filter(([id]) => !LIFT_BY_DB[id]));
export const liftName = db => NAMES[db] || db;
export const liftColor = db => (LIFT_BY_DB[db] && LIFT_BY_DB[db].c) || 'var(--muted)';

export const CLUBS = [1500, 1250, 1000, 750];
export const VERDICTS = [
  [800, 'Genetic freak or liar', 'The Commissioner will need video, a witness, and a notarized statement.', 'Elite for your age and size.'],
  [650, 'Legit strong', "You're the guy other guys pretend not to watch warming up.", 'Well above the median for your age and size.'],
  [500, 'Above the median', 'Strong enough to be annoying about it. Please keep it to yourself.', 'Stronger than most lifters your age and size.'],
  [400, 'Just under average', 'You are the gym\'s control group. Science thanks you.', 'Right around the median. Plenty of room to climb.'],
  [300, 'Below average', 'You lift. Technically. The data is being generous.', 'Building the base. Consistency wins here.'],
  [200, 'Rookie numbers', 'Nobody is intimidated, including the bar.', 'Early days. Every PR moves you fast from here.'],
  [0, 'The index is concerned', 'Hydrate, eat something, and try again.', 'Log your lifts to get a real read.'],
];

export function af(a) {
  if (a < 20) return 0.85 + 0.0375 * (a - 16);
  if (a <= 35) return 1;
  return Math.max(0.55, 1 - 0.01 * (a - 35) - (a > 60 ? 0.005 * (a - 60) : 0));
}
export const med = (b, bw, a) => b * af(a) * Math.pow(185 / bw, 0.25) * bw;
export function normcdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
const rnd = x => Math.floor(x + 0.5);
// Whole number percentile. The DSI score is built from these, so it stays unchanged.
export function pct(b, w, bw, a) {
  if (!w) return 0;
  return Math.max(1, Math.min(99, rnd(normcdf(Math.log(w / med(b, bw, a)) / 0.25) * 100)));
}
// Display percentile with one decimal, 0.1 to 99.9.
export function pct1(b, w, bw, a) {
  if (!w) return 0;
  return Math.max(0.1, Math.min(99.9, Math.round(normcdf(Math.log(w / med(b, bw, a)) / 0.25) * 1000) / 10));
}
export const fmtPct = v => (+v || 0).toFixed(1);
const bwOf = r => +r.bw || 185, ageOf = r => +r.age || 30;
export const pcts = r => Object.fromEntries(LIFTS.map(l => [l.k, pct1(l.b, +r[l.k] || 0, bwOf(r), ageOf(r))]));
export const pctsWhole = r => Object.fromEntries(LIFTS.map(l => [l.k, pct(l.b, +r[l.k] || 0, bwOf(r), ageOf(r))]));
export function score(r) {
  const p = pctsWhole(r);
  return rnd(LIFTS.reduce((s, l) => s + p[l.k], 0) / 4 * 10);
}
export const total = r => LIFTS.reduce((s, l) => s + (+r[l.k] || 0), 0);
export const clubOf = t => CLUBS.find(c => t >= c);
export const verdict = s => VERDICTS.find(v => s >= v[0]);
export const medianFor = (l, r) => med(l.b, bwOf(r), ageOf(r));

// Weekly targets
const r5 = x => Math.max(5, Math.round(x / 5) * 5);
export function target(l, p) {
  const base = +p[l.b] || 0, bw = +p.bw || 200;
  if (l.fixed) {
    const f = l.fixed;
    if (l.id === 'kbs') return base >= 2 * bw ? f[2] : base >= 1.4 * bw ? f[1] : f[0];
    return base >= 185 ? f[1] : f[0];
  }
  if (l.rx) {
    // rx is the men's [Rx, Rx+]; rxw is the women's [Rx, Rx+] when the coach set one.
    const rx = p.sex === 'female' && l.rxw && l.rxw.length ? l.rxw : l.rx;
    if (l.f2) return base >= 270 ? rx[1] : rx[0];
    return base * 0.7 >= rx[1] ? rx[1] : base * 0.7 >= rx[0] ? rx[0] : r5(base * 0.6);
  }
  if (!base) return 0;
  return r5(base * l.f + (l.plus || 0));
}

// Gains from PRs set in the last week: pounds added per lift, plus what that did to the DSI and total.
export function gains(r, days = 7) {
  const out = { lift: {}, score: 0, total: 0 }, prev = { ...r };
  let any = false;
  for (const l of LIFTS) {
    const dt = r[l.k + '_date'], pv = +r[l.k + '_prev'] || 0, now = +r[l.k] || 0;
    if (!dt || !pv || now <= pv) continue;
    if ((Date.now() - Date.parse(String(dt).slice(0, 10) + 'T12:00:00')) / 864e5 > days + 0.5) continue;
    out.lift[l.k] = now - pv; prev[l.k] = pv; any = true;
  }
  if (any) { out.score = score(r) - score(prev); out.total = total(r) - total(prev); }
  return out;
}
