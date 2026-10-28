import React from 'react';
import { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';
import { DRIFT_PREVIEW_HOURS, type MovingPoint } from '../game/drift';

/** Render the unwrapped course in each chart tile so seam crossings stay continuous. */
export function DriftCourse({ site, sx, sy, selected }: { site: MovingPoint; sx: number; sy: number; selected: boolean }) {
  if (!site.drift) return null;
  const x = site.x * sx, y = site.y * sy;
  const dx = site.drift.velocity.x * DRIFT_PREVIEW_HOURS * sx;
  const dy = site.drift.velocity.y * DRIFT_PREVIEW_HOURS * sy;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  return <G opacity={selected ? 0.9 : 0.35}>
    <Line x1={x} y1={y} x2={x + dx} y2={y + dy} stroke="#e0bd86" strokeWidth={selected ? 1.4 : 0.8} strokeDasharray="2 4" />
    <G transform={`translate(${x + dx / 2}, ${y + dy / 2}) rotate(${angle})`}><Path d="M -3 -3 L 1 0 L -3 3" stroke="#e0bd86" strokeWidth="1.2" fill="none" /></G>
    <Circle cx={x + dx} cy={y + dy} r="3" stroke="#e0bd86" strokeWidth="1" fill="none" />
    {selected && <SvgText x={x + dx} y={y + dy - 6} fill="#e0bd86" fontSize="7" textAnchor="middle">+24h</SvgText>}
  </G>;
}
