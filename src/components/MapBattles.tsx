import React from 'react';
import { Platform } from 'react-native';
import { Circle, G, Path } from 'react-native-svg';
import type { ObservedEvent } from '../game/events';

const BATTLE_MARKER_HOURS = 2;
const BATTLE_COLOR = '#efb16d';

export function MapBattles({ events = [], hour, scale }: { events?: ObservedEvent[]; hour: number; scale: number }) {
  const seen = new Set<string>();
  return <G pointerEvents="none">
    {events.map((event, index) => {
      const age = hour - event.hour;
      if (!event.battle || age < 0 || age >= BATTLE_MARKER_HOURS) return null;
      const { x, y } = event.battle;
      const key = `${event.hour}:${x}:${y}`;
      if (seen.has(key)) return null;
      seen.add(key);
      const progress = age / BATTLE_MARKER_HOURS;
      const elapsed = age < 1 / 60 ? 'just now' : age < 1 ? `${Math.floor(age * 60)}m ago` : `${Math.floor(age)}h ago`;
      return <G key={key} id={`battle-marker-${index}`} accessible={Platform.OS === 'web' ? undefined : true} accessibilityLabel={`Battle, ${elapsed}`} opacity={0.45 * (1 - progress)} transform={`translate(${x * scale}, ${y * scale})`}>
        <G transform={`scale(${0.8 + 0.4 * progress})`}>
          <Circle r={28} fill="none" stroke={BATTLE_COLOR} strokeWidth={1.5} strokeDasharray="3 5" />
          <Path d="M-24 -24 L-20 -20 M24 -24 L20 -20 M-24 24 L-20 20 M24 24 L20 20 M0 -31 L0 -27 M31 0 L27 0 M0 31 L0 27 M-31 0 L-27 0" stroke={BATTLE_COLOR} strokeWidth={2} strokeLinecap="round" />
        </G>
      </G>;
    })}
  </G>;
}
