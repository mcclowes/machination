/** Public massive bodies and their compact influence circles repeat across chart tiles. */
import React from 'react';
import { Circle, G, Text } from 'react-native-svg';
import type { GravityConfig } from '../game/gravity';
import { DEFAULT_TUNING } from '../game/gravity-model';
export function MapGravity({ gravity, sx, sy }: { gravity?: GravityConfig; sx: number; sy: number }) {
  return <G>{gravity?.wells.map(w => <G key={w.id} testID="gravity-body" accessibilityLabel={`${w.mass > 0 ? 'Gravity giant' : 'Antigravity well'} ${w.id}`}>
    <Circle cx={w.x * sx} cy={w.y * sy} r={(DEFAULT_TUNING.reach + w.radius) * sx} fill={w.mass > 0 ? '#b88a4e' : '#72b8db'} fillOpacity={0.045} stroke={w.mass > 0 ? '#b88a4e' : '#72b8db'} strokeOpacity={0.28} strokeWidth={0.4} strokeDasharray="2 3" />
    <Circle cx={w.x * sx} cy={w.y * sy} r={w.radius * sx} fill={w.mass > 0 ? '#ac7947' : '#263e64'} stroke="#e0b982" strokeWidth={0.7} />
    <Circle cx={(w.x - w.radius * 0.25) * sx} cy={(w.y - w.radius * 0.25) * sy} r={w.radius * sx * 0.45} fill="#e0b982" fillOpacity={0.35} />
    <Text x={w.x * sx} y={(w.y + w.radius + 1.3) * sy} fontSize={2.1 * sx} fill="#c8a77a" textAnchor="middle">{w.mass > 0 ? 'Giant' : 'Antigravity'}</Text>
  </G>)}</G>;
}
