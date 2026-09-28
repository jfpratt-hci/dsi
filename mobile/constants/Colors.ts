// DSI palette, shared with the website (site/app.css).
export const C = {
  bg: '#0E1420',
  panel: '#151D2C',
  panel2: '#1B2537',
  line: '#26324A',
  ink: '#E9EEF6',
  muted: '#8E9AB0',
  accent: '#F2C94C',
  bench: '#5B93E8',
  squat: '#EF4B5C',
  dead: '#3DBA74',
  clean: '#F2C94C',
  up: '#3DBA74',
  flat: '#E0A43A',
  down: '#F06262',
};

export const liftColor: Record<string, string> = { bench: C.bench, squat: C.squat, dead: C.dead, clean: C.clean };

export default { light: { text: C.ink, background: C.bg, tint: C.accent }, dark: { text: C.ink, background: C.bg, tint: C.accent } };
