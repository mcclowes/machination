/** Read-only role information for the complete observed manifest, including marker overflow. */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SPECIALISTS } from '../game/specialist-catalog';
import type { SpecialistSummary } from './map-specialists';
import { CaptiveLock, SpecialistIcon } from './SpecialistIcon';
import { usePlayerRoster } from './PlayerIdentity';

export function SpecialistManifest({ summary, heading = 'Specialists aboard' }: { summary?: SpecialistSummary; heading?: string }) {
  const identity = usePlayerRoster();
  if (!summary?.total) return null;
  return <View style={s.manifest}>
    <Text style={s.heading}>{heading}</Text>
    {summary.groups.map(group => {
      const role = SPECIALISTS[group.kind];
      const owner = identity(group.owner);
      return <View key={`${group.kind}:${group.owner}:${group.captive}`} style={s.role}>
        <View style={s.row}>
          <View accessible={false} style={s.icon}><SpecialistIcon kind={group.kind} size={28} />{group.captive && <View style={s.lock}><CaptiveLock /></View>}</View>
          <View style={s.identity}>
            <Text style={s.name}>{group.count > 1 ? `${group.count} × ` : ''}{role.name}</Text>
            <Text style={[s.detail, { color: owner.color }]}>Specialist owner: {owner.name}</Text>
          </View>
        </View>
        {group.captive && <Text style={s.captive}>Captive · abilities inactive</Text>}
        <Text style={s.detail}>{role.description}</Text>
      </View>;
    })}
  </View>;
}
const s = StyleSheet.create({
  manifest: { gap: 10 }, heading: { color: '#c2d8d3', fontSize: 12, fontWeight: '600' },
  role: { gap: 5, borderTopWidth: 1, borderTopColor: '#30454a', paddingTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 }, icon: { width: 28, height: 28, flexShrink: 0 },
  lock: { position: 'absolute', bottom: 0, right: -2 }, identity: { flex: 1, minWidth: 0 },
  name: { color: '#dce8df', fontSize: 13, fontWeight: '600' }, detail: { color: '#b3c9cd', fontSize: 12, lineHeight: 18 },
  captive: { color: '#d4bc98', fontSize: 12, lineHeight: 18 },
});
