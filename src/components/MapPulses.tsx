import React from 'react';
import { Circle, G, Text } from 'react-native-svg';
import type { GameView } from '../game/visibility';
import { usePlayerRoster } from './PlayerIdentity';

export function MapPulses({ pulse, sx, sy }: { pulse: NonNullable<GameView['pulse']>; sx: number; sy: number }) {
  const identity = usePlayerRoster();
  return <G>
    {pulse.tactical?.waves.map(p => <Circle id={`tactical-wave-${p.id}`} key={`tactical-${p.id}`} cx={p.origin.x * sx} cy={p.origin.y * sy} r={p.radius * sx} fill="none" stroke={identity(p.factionId).color} strokeWidth={1} strokeOpacity={Math.max(0, 1 - p.radius * p.attenuationPerDistance / p.initialStrength)} />)}
    {pulse.pulses.map(p => <G key={p.id}>
      <Circle cx={p.origin.x * sx} cy={p.origin.y * sy} r={p.radius * sx} fill={identity(p.factionId).color} fillOpacity={0.07} stroke={identity(p.factionId).color} strokeWidth={2} />
      <Circle cx={p.origin.x * sx} cy={p.origin.y * sy} r={4} fill={identity(p.factionId).color} />
    </G>)}
    {pulse.kings.filter(k => k.state !== 'destroyed' && k.state !== 'idle').map(k => <Text key={k.kingId} x={k.position.x * sx} y={k.position.y * sy - 30} fill={identity(k.factionId).color} fontSize={10} fontFamily="sans-serif" textAnchor="middle">King · {k.state}</Text>)}
  </G>;
}
