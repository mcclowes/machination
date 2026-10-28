/**
 * ---
 * purpose: Global control for muting or restoring sound cues.
 * ---
 */
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { playSound, setSoundEnabled, useSoundEnabled } from '../audio/sound';

export function SoundToggle({ compact = false }: { compact?: boolean } = {}) {
  const enabled = useSoundEnabled();
  return <Pressable accessibilityRole="switch" accessibilityLabel="Sound" accessibilityState={{ checked: enabled }}
    onPress={() => { setSoundEnabled(!enabled); if (!enabled) playSound('tap'); }} style={[s.trigger, compact && { minWidth: 44, backgroundColor: 'transparent', borderWidth: 0 }]}>
    <Text style={[s.text, !enabled && s.muted]}>{compact ? enabled ? '♪' : '♪̸' : enabled ? 'Sound' : 'Muted'}</Text>
  </Pressable>;
}
const s = StyleSheet.create({
  trigger: { minWidth: 64, minHeight: 44, alignItems: 'center', justifyContent: 'center', padding: 10, backgroundColor: '#162217', borderWidth: 1, borderColor: '#30442b' },
  text: { color: '#b8e986', fontSize: 12 }, muted: { color: '#80917c' },
});
