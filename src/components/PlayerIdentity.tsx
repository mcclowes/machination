/** Player portraits and scalable ownership emblems, shared by native and web views. */

import type { PlayerColor } from '../game/player-colors';
import React, { createContext, useContext } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { playerAppearance, type Faction } from '../game/players';
import { CHARACTERS, type CharacterId } from '../game/characters';

const rosters = {
  original: require('../../assets/players/roster.png'),
  retro: require('../../assets/players/retro-roster.png'),
  cyborg: require('../../assets/players/cyborg-roster.png'),
  cybernetic: require('../../assets/players/cybernetic-roster.png'),
  nomad: require('../../assets/players/nomad-roster.png'),
};
export const PlayerColors = createContext<readonly PlayerColor[] | undefined>(undefined);
export const PlayerPortraits = createContext<readonly CharacterId[] | undefined>(undefined);
export function PlayerRoster({ portraits, colors, children }: { portraits?: readonly CharacterId[]; colors?: readonly PlayerColor[]; children: React.ReactNode }) {
  return <PlayerColors.Provider value={colors}><PlayerPortraits.Provider value={portraits}>{children}</PlayerPortraits.Provider></PlayerColors.Provider>;
}
export function usePlayerRoster() {
  const portraits = useContext(PlayerPortraits);
  const colors = useContext(PlayerColors);
  return (faction: Faction) => playerAppearance(faction, portraits, colors);
}
const portraitEdge = 488;
const emblems = {
  compass: 'M12 1 14 10 22 12 14 14 12 23 10 14 2 12 10 10Z',
  spear: 'M12 1 21 12 21 17 14 10 13 23 11 23 10 10 3 17 3 12Z',
  gear: 'M10 2h4v3l3 1 2-2 3 3-2 2 1 3h3v4h-3l-1 3 2 2-3 3-2-2-3 1v3h-4v-3l-3-1-2 2-3-3 2-2-1-3H0v-4h3l1-3-2-2 3-3 2 2 3-1Z M12 8a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z',
  bars: 'M3 5h3v17H3Z M10 2h4v20h-4Z M18 5h3v17h-3Z',
  meridian: 'M12 1 13 17 15 19 13 21 12 25 11 21 9 19 11 17Z M15 19a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z',
  cluster: 'M16 7a5 5 0 1 0-10 0 5 5 0 0 0 10 0Z M23 12a2 2 0 1 0-4 0 2 2 0 0 0 4 0Z M8 17a2 2 0 1 0-4 0 2 2 0 0 0 4 0Z M16 18a2 2 0 1 0-4 0 2 2 0 0 0 4 0Z',
  star: 'M12 1 14 9 21 5 17 11 24 13 16 15 20 22 13 18 11 25 9 17 2 21 6 14 0 12 8 10 5 4 10 8Z',
  triangles: 'M12 1 21 9H3Z M12 9 21 17H3Z M12 17 19 24H5Z',
  crescent: 'M12 2a10 10 0 1 0 8 18A10 10 0 0 1 12 2Z M23 5a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z',
  chevron: 'M6 2h3v15l-4 4-2-3V6Z M11 1h3v17h-3Z M16 4l5 4v10l-3 3-2-4Z M12 20l4 4-4 4-4-4Z',
} as const;

export function FactionEmblem({ faction, size = 20, color, character }: { faction: Faction; size?: number; color?: string; character?: CharacterId }) {
  const appearance = usePlayerRoster()(faction);
  const identity = character ? CHARACTERS[character] : appearance;
  const { emblem } = identity;
  color ??= identity.color;
  return <Svg width={size} height={size} viewBox="-1 -1 26 28" accessible={false} pointerEvents="none">
    {emblem === 'compass' && <Circle cx="12" cy="12" r="8" fill="none" stroke={color} strokeWidth="1.2" />}
    {emblem === 'meridian' && <Circle cx="12" cy="13" r="8" fill="none" stroke={color} strokeWidth="0.9" />}
    <Path d={emblems[emblem]} fill={color} fillRule="evenodd" stroke={color} strokeWidth="0.65" />
  </Svg>;
}

export function PlayerAvatar({ faction, size = 44, character }: { faction: Faction; size?: number; character?: CharacterId }) {
  const appearance = usePlayerRoster()(faction);
  const identity = character ? { ...appearance, ...CHARACTERS[character] } : appearance;
  const scale = size / portraitEdge;
  return <View accessible={false} style={{ width: size, height: size, flexShrink: 0 }}>
    <View style={[s.portrait, { width: size, height: size, backgroundColor: identity.background, borderColor: identity.color }]}>
      <Image accessible={false} source={rosters[identity.portrait.sheet]} resizeMode="stretch" style={{ position: 'absolute', width: 1536 * scale, height: 1024 * scale, left: -identity.portrait.x * scale, top: -identity.portrait.y * scale }} />
    </View>
    <View style={[s.badge, { borderColor: identity.color, width: size * 0.4, height: size * 0.4 }]}><FactionEmblem faction={faction} character={character} size={size * 0.29} color="#e6d0a5" /></View>
  </View>;
}

export function PlayerIdentity({ faction, detail, size = 44 }: { faction: Faction; detail?: string; size?: number }) {
  const identity = usePlayerRoster()(faction);
  return <View style={s.identity}>
    <PlayerAvatar faction={faction} size={size} />
    <View style={s.copy}><Text style={[s.name, { color: identity.color }]}>{identity.name}</Text>{!!detail && <Text style={s.detail}>{detail}</Text>}</View>
  </View>;
}

const s = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 }, copy: { flex: 1, gap: 4 },
  portrait: { overflow: 'hidden', borderWidth: 1, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', bottom: -3, right: -3, backgroundColor: '#17201e', borderWidth: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 2 },
  name: { fontSize: 14, fontWeight: '600' }, detail: { color: '#a6b1a0', fontSize: 11, lineHeight: 17 },
});
