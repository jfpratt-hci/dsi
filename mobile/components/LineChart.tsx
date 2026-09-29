import { View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import { C } from '@/constants/Colors';

type Pt = { x: number; y: number; label?: string };

// Small dependency free line chart. x is a timestamp, y a weight. Grid lines at nice steps.
export function LineChart({ points, color = C.accent, height = 180, goal }: { points: Pt[]; color?: string; height?: number; goal?: number }) {
  const W = 340, H = height, L = 40, R = 10, T = 10, B = 22;
  if (!points.length) return <View style={{ height }} />;
  const xs = points.map(p => p.x), ys = points.map(p => p.y).concat(goal ? [goal] : []);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1;
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = Math.max(10, (y1 - y0) * 0.15); y0 = Math.max(0, Math.floor((y0 - pad) / 5) * 5); y1 = Math.ceil((y1 + pad) / 5) * 5;
  const sx = (x: number) => L + (x1 === x0 ? (W - L - R) / 2 : ((x - x0) / (x1 - x0)) * (W - L - R));
  const sy = (y: number) => T + (1 - (y - y0) / (y1 - y0 || 1)) * (H - T - B);
  const step = niceStep((y1 - y0) / 4);
  const ticks: number[] = []; for (let v = Math.ceil(y0 / step) * step; v <= y1; v += step) ticks.push(v);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  const fmt = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} accessibilityLabel="Progress chart">
      {ticks.map(v => (
        <Line key={v} x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} stroke={C.line} strokeWidth={1} />
      ))}
      {ticks.map(v => (
        <SvgText key={'t' + v} x={L - 6} y={sy(v) + 4} fontSize={10} fill={C.muted} textAnchor="end">{v}</SvgText>
      ))}
      {goal ? <Line x1={L} x2={W - R} y1={sy(goal)} y2={sy(goal)} stroke={C.up} strokeWidth={1.5} strokeDasharray="4 4" /> : null}
      <Path d={d} stroke={color} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => <Circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={i === points.length - 1 ? 4.5 : 3} fill={color} stroke={C.bg} strokeWidth={1.5} />)}
      <SvgText x={L} y={H - 6} fontSize={10} fill={C.muted}>{fmt(x0)}</SvgText>
      <SvgText x={W - R} y={H - 6} fontSize={10} fill={C.muted} textAnchor="end">{fmt(x1)}</SvgText>
    </Svg>
  );
}

function niceStep(raw: number) {
  const m = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  const n = raw / m;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * m;
}
