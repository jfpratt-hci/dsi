import { ALL_LIFTS, today } from './data';

export type Row = { date: string; lift: string; weight: number };
const ALIAS: Record<string, string> = { 'bench press': 'bench', bp: 'bench', 'back squat': 'squat', dl: 'deadlift', dead: 'deadlift', 'c&j': 'clean_and_jerk', 'clean & jerk': 'clean_and_jerk', ohs: 'overhead_squat', 'fs': 'front_squat', 'press': 'strict_press', ohp: 'strict_press' };
const BY_NAME = Object.fromEntries(ALL_LIFTS.flatMap(([id, n]) => [[id, id], [n.toLowerCase(), id], [id.replace(/_/g, ' '), id]]));

function parseDate(t: string) {
  t = t.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  return null;
}

export function parseImport(text: string) {
  const rows: Row[] = [], bad: string[] = [];
  text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(line => {
    const parts = line.split(/[,\t;]/).map(p => p.trim());
    if (parts.length < 3) { bad.push(line); return; }
    const date = parseDate(parts[0]), key = parts[1].toLowerCase(), lift = BY_NAME[key] || ALIAS[key], weight = Number(parts[2].replace(/[^0-9.]/g, ''));
    if (!date || !lift || !(weight > 0 && weight < 1500) || date > today()) { if (!/date/i.test(line)) bad.push(line); return; }
    rows.push({ date, lift, weight });
  });
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return { rows, bad };
}

