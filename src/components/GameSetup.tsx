import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { GameOptions } from '../game/rules';

export function GameSetup({ value, onChange, disabled = false }: { value: GameOptions; onChange: (options: GameOptions) => void; disabled?: boolean }) {
  return <View style={s.panel}>
    <Text style={s.label}>Players</Text>
    <View style={s.choices}>{Array.from({ length: 9 }, (_, i) => i + 2).map(count => <Pressable key={count} accessibilityRole="radio" accessibilityLabel={`${count} players`} accessibilityState={{ checked: value.playerCount === count, disabled }} disabled={disabled} onPress={() => onChange({ ...value, playerCount: count })} style={[s.choice, value.playerCount === count && s.selected, disabled && s.disabled]}><Text style={s.text}>{count}</Text></Pressable>)}</View>
    <Text style={s.label}>Game mode</Text>
    <View style={s.choices}>{(['mining', 'domination'] as const).map(mode => <Pressable key={mode} accessibilityRole="radio" accessibilityLabel={mode === 'mining' ? 'Mining' : 'Domination'} accessibilityState={{ checked: value.mode === mode, disabled }} disabled={disabled} onPress={() => onChange({ ...value, mode })} style={[s.choice, value.mode === mode && s.selected, disabled && s.disabled]}><Text style={s.text}>{mode === 'mining' ? 'Mining' : 'Domination'}</Text></Pressable>)}</View>
    <Text style={s.detail}>{value.mode === 'mining' ? 'Mining: extract 200 cargo to complete your quota.' : `Domination: control ${5 * value.playerCount} outposts, half the chart. No mines.`}</Text>
    <Text style={s.detail}>Each player starts with five initial sites and 160 drones. The generated chart has 10 sites per player ({10 * value.playerCount} total).</Text>
  </View>;
}
const s = StyleSheet.create({
  panel: { gap: 12 }, label: { color: '#96ad89', fontSize: 11, letterSpacing: 1 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { padding: 12, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#40563a', backgroundColor: '#0b140e' },
  selected: { borderColor: '#b8e986', backgroundColor: '#263b23' }, disabled: { opacity: 0.35 },
  text: { color: '#e5eadc', fontSize: 14 }, detail: { color: '#8c9f85', fontSize: 12, lineHeight: 20 },
});
