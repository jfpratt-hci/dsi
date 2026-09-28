// DSI scoring. Same math as the original DSI page.
export const LIFTS = [
  { k: 'bench', db: 'bench', n: 'Bench', b: 1.11, c: 'var(--bench)' },
  { k: 'squat', db: 'squat', n: 'Squat', b: 1.50, c: 'var(--squat)' },
  { k: 'dead', db: 'deadlift', n: 'Deadlift', b: 1.83, c: 'var(--dead)' },
  { k: 'clean', db: 'clean', n: 'Clean', b: 1.00, c: 'var(--clean)' },
];
export const LIFT_BY_DB = Object.fromEntries(LIFTS.map(l => [l.db, l]));
export const OTHER_LIFTS = { jerk: 'Jerk', snatch: 'Snatch', front_squat: 'Front squat', overhead_squat: 'Overhead squat' };
export const liftName = db => (LIFT_BY_DB[db] && LIFT_BY_DB[db].n) || OTHER_LIFTS[db] || db;
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
export function pct(b, w, bw, a) {
  if (!w) return 0;
  return Math.max(1, Math.min(99, rnd(normcdf(Math.log(w / med(b, bw, a)) / 0.25) * 100)));
}
const bwOf = r => +r.bw || 185, ageOf = r => +r.age || 30;
export const pcts = r => Object.fromEntries(LIFTS.map(l => [l.k, pct(l.b, +r[l.k] || 0, bwOf(r), ageOf(r))]));
export function score(r) {
  const p = pcts(r);
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
    if (l.f2) return base >= 270 ? l.rx[1] : l.rx[0];
    return base * 0.7 >= l.rx[1] ? l.rx[1] : base * 0.7 >= l.rx[0] ? l.rx[0] : r5(base * 0.6);
  }
  if (!base) return 0;
  return r5(base * l.f + (l.plus || 0));
}
