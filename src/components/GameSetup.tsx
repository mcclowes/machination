import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { GameOptions } from '../game/rules';
import { ALL_PLAYERS, FACTIONS } from '../game/players';
import { CHARACTERS, CHARACTER_IDS, DEFAULT_PORTRAITS, type CharacterId } from '../game/characters';
import { PlayerAvatar, PlayerIdentity, PlayerPortraits } from './PlayerIdentity';

export function GameSetup({ value, onChange, disabled = false }: { value: GameOptions; onChange: (options: GameOptions) => void; disabled?: boolean }) {
  const [editing, setEditing] = useState<number | null>(null);
  const portraits = value.portraits ?? DEFAULT_PORTRAITS.slice(0, value.playerCount);
  const seat = editing === null ? null : Math.min(editing, value.playerCount - 1);
  function resize(count: number) {
    const next = portraits.slice(0, count);
    for (const id of [...DEFAULT_PORTRAITS, ...CHARACTER_IDS]) if (next.length < count && !next.includes(id)) next.push(id);
    onChange({ ...value, playerCount: count, portraits: next });
  }
  function assign(character: CharacterId) {
    if (seat === null) return;
    const next = [...portraits];
    const other = next.indexOf(character);
    if (other !== -1) next[other] = next[seat]!;
    next[seat] = character;
    onChange({ ...value, portraits: next });
  }
  return <PlayerPortraits.Provider value={portraits}><View style={s.panel}>
    <Text style={s.label}>Players</Text>
    <View style={s.choices}>{Array.from({ length: 9 }, (_, i) => i + 2).map(count => <Pressable key={count} accessibilityRole="radio" accessibilityLabel={`${count} players`} accessibilityState={{ checked: value.playerCount === count, disabled }} disabled={disabled} onPress={() => resize(count)} style={[s.choice, value.playerCount === count && s.selected, disabled && s.disabled]}><Text style={s.text}>{count}</Text></Pressable>)}</View>
    <Text style={s.label}>Player portraits</Text><Text style={s.detail}>Tap a player to choose from {CHARACTER_IDS.length} commanders. Each portrait includes its colors and insignia.</Text>
    <View style={s.roster}>{ALL_PLAYERS.slice(0, value.playerCount).map((faction, index) => <Pressable key={faction} accessibilityRole="button" accessibilityLabel={`Choose portrait for ${FACTIONS[faction].name}`} accessibilityState={{ expanded: seat === index, disabled }} disabled={disabled} onPress={() => setEditing(seat === index ? null : index)} style={[s.player, seat === index && s.selected, disabled && s.disabled]}><PlayerIdentity faction={faction} size={56} detail={`${index === 0 ? 'You' : `Player ${index + 1}`} · ${CHARACTERS[portraits[index]!].label}`} /></Pressable>)}</View>
    {seat !== null && <View style={s.gallery}><Text style={s.label}>Choose {FACTIONS[ALL_PLAYERS[seat]!].name}'s portrait</Text><View style={s.choices}>{CHARACTER_IDS.map(id => <Pressable key={id} accessibilityRole="radio" accessibilityLabel={`${CHARACTERS[id].label} portrait`} accessibilityState={{ checked: portraits[seat] === id, disabled }} disabled={disabled} onPress={() => assign(id)} style={[s.portraitChoice, { borderColor: portraits[seat] === id ? CHARACTERS[id].color : '#30402e' }, disabled && s.disabled]}><PlayerAvatar faction={ALL_PLAYERS[seat]!} character={id} size={72} /><Text style={s.detail}>{CHARACTERS[id].label}</Text></Pressable>)}</View><Text style={s.detail}>Choosing an assigned portrait swaps the two players.</Text></View>}
    <Text style={s.label}>Game mode</Text>
    <View style={s.choices}>{(['mining', 'domination'] as const).map(mode => <Pressable key={mode} accessibilityRole="radio" accessibilityLabel={mode === 'mining' ? 'Mining' : 'Domination'} accessibilityState={{ checked: value.mode === mode, disabled }} disabled={disabled} onPress={() => onChange({ ...value, mode })} style={[s.choice, value.mode === mode && s.selected, disabled && s.disabled]}><Text style={s.text}>{mode === 'mining' ? 'Mining' : 'Domination'}</Text></Pressable>)}</View>
    <Text style={s.detail}>{value.mode === 'mining' ? 'Mining: extract 200 cargo to complete your quota.' : `Domination: control ${5 * value.playerCount} outposts, half the chart. No mines.`}</Text>
    <Text style={s.detail}>Each player starts with five initial sites and 160 drones. The generated chart has 10 sites per player ({10 * value.playerCount} total).</Text>
  </View></PlayerPortraits.Provider>;
}
const s = StyleSheet.create({
  panel: { gap: 12 }, label: { color: '#96ad89', fontSize: 11, letterSpacing: 1 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  roster: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, player: { flexBasis: 230, flexGrow: 1, padding: 10, borderWidth: 1, borderColor: '#30402e' },
  gallery: { gap: 12, paddingVertical: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#30402e' }, portraitChoice: { padding: 9, gap: 8, alignItems: 'center', borderWidth: 1, minWidth: 94 },
  choice: { padding: 12, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#40563a', backgroundColor: '#0b140e' },
  selected: { borderColor: '#b8e986', backgroundColor: '#263b23' }, disabled: { opacity: 0.35 },
  text: { color: '#e5eadc', fontSize: 14 }, detail: { color: '#8c9f85', fontSize: 12, lineHeight: 20 },
});
