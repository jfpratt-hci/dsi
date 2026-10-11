// Rep counting for the Plate tracker. No DOM here, so it can be tested on its own.
// Each frame gives the height (0 top to 1 bottom of the picture) of three body points: wrists, shoulders, hips.
// A rep is one trip away from where the lifter started and back: down and up for a squat or bench,
// up and down for a deadlift, clean or pull up. Every point is counted on its own and the one that
// moved the most wins, so the same code works for squats, presses, pulls and curls.

export function counter() {
  let s = null, base = null, st = 'rest', dir = 0, peak = 0, peakT = 0, leaveT = 0, outSince = 0, lastPeak = 0;
  const reps = [];
  return {
    reps,
    push(y, t, T) {
      s = s == null ? y : s + 0.45 * (y - s); // smooth out jitter
      if (base == null) { base = s; leaveT = t; return false; }
      const d = s - base;
      // Just counted: wait until the lifter is back at the start before the next rep can begin,
      // unless they turn around early and go again (touch and go).
      if (st === 'back') {
        if (Math.abs(d) < T * 0.5) { st = 'rest'; leaveT = t; }
        else if (dir * d > 0.6 * lastPeak) { st = 'out'; peak = d; peakT = t; outSince = t; leaveT = t; }
        else if (t - outSince > 3000) { base = s; st = 'rest'; leaveT = t; }
        return false;
      }
      if (st === 'rest') {
        if (Math.abs(d) < T * 0.25) leaveT = t;
        if (Math.abs(d) > T) { st = 'out'; dir = Math.sign(d); peak = d; peakT = t; outSince = t; return false; }
        if (Math.abs(d) < T * 0.5) base += 0.04 * d; // follow slow drift while still
        return false;
      }
      if (dir * d > dir * peak) { peak = d; peakT = t; }
      // Back near the start: that is a rep. Lift time is the hard half: coming up for a squat or bench, going up for a pull.
      if (dir * d < 0.35 * dir * peak) {
        reps.push({ t, amp: Math.abs(peak), up: Math.max(0.1, (dir < 0 ? peakT - leaveT : t - peakT) / 1000) });
        st = 'back'; lastPeak = Math.abs(peak); outSince = t; return true;
      }
      // Gone a long time without coming back (walked the bar out, re racked): start over from here, no rep.
      if (t - outSince > 8000) { base = s; st = 'rest'; leaveT = t; }
      return false;
    },
    score() { return reps.reduce((a, r) => a + r.amp, 0); },
  };
}

const POINTS = ['wrist', 'shoulder', 'hip'];

// f = { wrist, shoulder, hip, torso } with heights or null when not seen; torso is the shoulder to hip length.
export function tracker() {
  let C, armed = false, calm = null, prev = null, first = null, shown = 0;
  const reset = () => { C = Object.fromEntries(POINTS.map(n => [n, counter()])); };
  reset();
  const best = () => POINTS.map(n => C[n]).reduce((a, c) => (c.score() > a.score() ? c : a));
  return {
    get armed() { return armed; },
    best,
    // Waits until the lifter holds still (or 4 seconds pass), then counts.
    push(f, t) {
      const T = Math.max(0.03, 0.22 * (f.torso || 0.25));
      if (!armed) {
        if (first == null) first = t;
        const move = prev ? Math.max(0, ...POINTS.map(n => (f[n] != null && prev[n] != null ? Math.abs(f[n] - prev[n]) : 0))) : 1;
        prev = f;
        if (move < 0.012) { if (calm == null) calm = t; } else calm = null;
        if ((calm != null && t - calm > 700) || t - first > 4000) { armed = true; reset(); }
        return { count: 0, rep: false };
      }
      for (const n of POINTS) if (f[n] != null) C[n].push(f[n], t, T);
      const count = best().reps.length, rep = count > shown;
      if (rep) shown = count;
      return { count: shown, rep };
    },
    // The set as counted: reps and how long each one took to lift.
    result() {
      const r = best().reps;
      return { reps: Math.max(r.length, shown), times: r.map(x => Math.round(x.up * 10) / 10) };
    },
  };
}
