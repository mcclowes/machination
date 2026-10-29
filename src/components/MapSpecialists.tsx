/** Compact, directly inspectable chart insignia with a complete accessible manifest. */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SpecialistIcon } from './Artwork';
import { usePlayerRoster } from './PlayerIdentity';
import { SPECIALIST_BADGE_GAP, SPECIALIST_BADGE_SIZE, SPECIALIST_BADGE_HIT_SLOP, type SpecialistMarkerPlacement, type SpecialistSummary } from './map-specialists';

const MAX_BADGE_COUNT = 99;

export function MapSpecialists({ summary, placement, label, onPress }: {
  summary: SpecialistSummary; placement?: SpecialistMarkerPlacement; label: string; onPress: () => void;
}) {
  const identity = usePlayerRoster();
  if (!placement) return null;
  return <Pressable testID="map-specialists" accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={SPECIALIST_BADGE_HIT_SLOP} style={[s.row, {
    left: placement.left, top: placement.top, width: placement.width, height: placement.height,
  }]}>
    {summary.displayed.map(group => <View testID="map-specialist-badge" key={`${group.kind}:${group.owner}:${group.captive}`} accessible={false} style={[s.badge, { borderColor: identity(group.owner).color }, group.captive && s.captive]}>
      <View style={group.captive && s.muted}><SpecialistIcon kind={group.kind} size={SPECIALIST_BADGE_SIZE - 4} /></View>
      {group.captive && <Text accessible={false} style={s.lock}>🔒</Text>}
      {group.count > 1 && <Text accessible={false} style={s.count}>{group.count > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : group.count}</Text>}
    </View>)}
    {summary.overflow > 0 && <View testID="map-specialist-overflow" accessible={false} style={s.badge}><Text accessible={false} numberOfLines={1} style={s.overflow}>{summary.overflow > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : `+${summary.overflow}`}</Text></View>}
  </Pressable>;
}
const s = StyleSheet.create({
  row: { position: 'absolute', flexDirection: 'row', gap: SPECIALIST_BADGE_GAP },
  badge: { width: SPECIALIST_BADGE_SIZE, height: SPECIALIST_BADGE_SIZE, borderWidth: 1, borderRadius: SPECIALIST_BADGE_SIZE / 2, backgroundColor: '#101d24', alignItems: 'center', justifyContent: 'center', borderColor: '#82979d' },
  captive: { borderStyle: 'dashed' }, muted: { opacity: 0.45 },
  lock: { position: 'absolute', right: 0, top: 0, fontSize: 8, lineHeight: 10 },
  count: { position: 'absolute', right: -1, bottom: -1, color: '#e5eadc', backgroundColor: '#101d24', paddingHorizontal: 1, borderRadius: 3, fontSize: 9, lineHeight: 11, fontVariant: ['tabular-nums'] },
  overflow: { color: '#d6e2cd', fontSize: 10, fontVariant: ['tabular-nums'] },
});
