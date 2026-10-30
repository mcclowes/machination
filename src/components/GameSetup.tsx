import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { GameOptions } from '../game/rules';
import { ALL_PLAYERS, FACTIONS } from '../game/players';
import { CHARACTERS, CHARACTER_IDS, DEFAULT_PORTRAITS, type CharacterId } from '../game/characters';
import { PlayerAvatar, PlayerIdentity, PlayerPortraits } from './PlayerIdentity';

export function GameSetup({ value, onChange, disabled = false, council = false }: { value: GameOptions; onChange: (options: GameOptions) => void; disabled?: boolean; council?: boolean }) {
  const [editing, setEditing] = useState<number | null>(null);
  const portraits = value.portraits ?? DEFAULT_PORTRAITS.slice(0, value.playerCount);
  const seat = editing === null ? null : Math.min(editing, value.playerCount - 1);
  function resize(count: number) {
    const next = portraits.slice(0, count);
    for (const id of [...DEFAULT_PORTRAITS, ...CHARACTER_IDS]) if (next.length < count && !next.includes(id)) next.push(id);
    const { teamFormat: _, ...individual } = value;
    onChange({ ...individual, playerCount: count, portraits: next });
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
    <Text style={s.label}>Teams</Text>
    <View style={s.choices}>{(['individual', '2v2', '4v4'] as const).map(format => <Pressable key={format} accessibilityRole="radio" accessibilityLabel={format === 'individual' ? 'Individual game' : format === '2v2' ? 'Doubles (2v2)' : format} aria-checked={(value.teamFormat ?? 'individual') === format} accessibilityState={{ checked: (value.teamFormat ?? 'individual') === format, disabled }} disabled={disabled} onPress={() => {
      if (format === 'individual') { const { teamFormat: _, ...individual } = value; onChange(individual); }
      else { const count = format === '2v2' ? 4 : 8; onChange({ ...value, teamFormat: format, mode: value.mode === 'pulse' ? 'mining' : value.mode, playerCount: count, portraits: DEFAULT_PORTRAITS.slice(0, count) }); }
    }} style={[s.choice, (value.teamFormat ?? 'individual') === format && s.selected, disabled && s.disabled]}><Text style={s.text}>{format === 'individual' ? 'Individual' : format === '2v2' ? 'Doubles (2v2)' : format}</Text></Pressable>)}</View>
    {value.teamFormat && <Text style={s.detail}>Seats {value.teamFormat === '2v2' ? '1–2 and 3–4' : value.teamFormat === '3v3v3' ? '1–3, 4–6, and 7–9' : '1–4 and 5–8'} form fixed teams in join order. Teammates share sensors, future plans, and victory. Each player controls their own assets.</Text>}
    <Text style={s.label}>Players</Text>
    <View style={s.choices}>{Array.from({ length: 9 }, (_, i) => i + 2).map(count => <Pressable key={count} accessibilityRole="radio" accessibilityLabel={`${count} players`} aria-checked={value.playerCount === count} accessibilityState={{ checked: value.playerCount === count, disabled }} disabled={disabled} onPress={() => resize(count)} style={[s.choice, value.playerCount === count && s.selected, disabled && s.disabled]}><Text style={s.text}>{count}</Text></Pressable>)}</View>
    <Text style={s.label}>Player portraits</Text><Text style={s.detail}>Tap a player to choose from {CHARACTER_IDS.length} commanders. Each portrait includes its colors and insignia.</Text>
    <View style={s.roster}>{ALL_PLAYERS.slice(0, value.playerCount).map((faction, index) => <Pressable key={faction} accessibilityRole="button" accessibilityLabel={`Choose portrait for ${FACTIONS[faction].name}`} accessibilityState={{ expanded: seat === index, disabled }} disabled={disabled} onPress={() => setEditing(seat === index ? null : index)} style={[s.player, seat === index && s.selected, disabled && s.disabled]}><PlayerIdentity faction={faction} size={56} detail={`${value.teamFormat ? `Team ${Math.floor(index / (value.teamFormat === '2v2' ? 2 : value.teamFormat === '3v3v3' ? 3 : 4)) + 1} · ` : ''}${index === 0 ? 'You' : `Player ${index + 1}`} · ${CHARACTERS[portraits[index]!].label}`} /></Pressable>)}</View>
    {seat !== null && <View style={s.gallery}><Text style={s.label}>Choose {FACTIONS[ALL_PLAYERS[seat]!].name}'s portrait</Text><View style={s.choices}>{CHARACTER_IDS.map(id => <Pressable key={id} accessibilityRole="radio" accessibilityLabel={`${CHARACTERS[id].label} portrait`} accessibilityState={{ checked: portraits[seat] === id, disabled }} disabled={disabled} onPress={() => assign(id)} style={[s.portraitChoice, { borderColor: portraits[seat] === id ? CHARACTERS[id].color : '#30402e' }, disabled && s.disabled]}><PlayerAvatar faction={ALL_PLAYERS[seat]!} character={id} size={72} /><Text style={s.detail}>{CHARACTERS[id].label}</Text></Pressable>)}</View><Text style={s.detail}>Choosing an assigned portrait swaps the two players.</Text></View>}
    <Pressable accessibilityRole="checkbox" accessibilityLabel="Drifting asteroid bases" accessibilityState={{ checked: !!value.driftingBases, disabled }} disabled={disabled} onPress={() => onChange({ ...value, driftingBases: !value.driftingBases })} style={[s.choice, value.driftingBases && s.selected, disabled && s.disabled]}><Text style={s.text}>{value.driftingBases ? '☑' : '☐'} Drifting asteroid bases</Text></Pressable>
    <Text style={s.detail}>Two small asteroid installations per player start neutral and drift 12 chart units per day. Capture one to carry a foothold toward a new front. Starting stations stay fixed. Additional mines require drilling.</Text>
    {council && <><Pressable accessibilityRole="checkbox" accessibilityLabel="Belt compact and daily council" accessibilityState={{ checked: !!value.beltCompact, disabled }} disabled={disabled} onPress={() => onChange({ ...value, beltCompact: !value.beltCompact })} style={[s.choice, value.beltCompact && s.selected, disabled && s.disabled]}><Text style={s.text}>{value.beltCompact ? '☑' : '☐'} Belt compact and daily council</Text></Pressable><Text style={s.detail}>Begin under six corporate conventions. Vote every 24 hours to suspend one for 48 hours. Public council keys control high-thrust transit, replication, surveillance, demolition, self-destruct weapons, and salvage rights.</Text></>}
    <Text style={s.label}>Game mode</Text>
    <View style={s.choices}>{(value.teamFormat ? ['mining', 'domination'] as const : ['pulse', 'mining', 'domination'] as const).map(mode => <Pressable key={mode} accessibilityRole="radio" accessibilityLabel={mode === 'pulse' ? "King’s Pulse" : mode === 'mining' ? 'Mining' : 'Domination'} aria-checked={value.mode === mode} accessibilityState={{ checked: value.mode === mode, disabled }} disabled={disabled} onPress={() => onChange({ ...value, mode })} style={[s.choice, value.mode === mode && s.selected, disabled && s.disabled]}><Text style={s.text}>{mode === 'pulse' ? "King’s Pulse" : mode === 'mining' ? 'Mining' : 'Domination'}</Text></Pressable>)}</View>
    <Text style={s.detail}>{value.mode === 'pulse' ? 'Mine pulse material, charge your stationary King, and fire an expanding pulse. The last surviving King wins.' : value.mode === 'mining' ? value.teamFormat ? 'Team mining: pool 300 cargo. Mine prices count every mine built by your team.' : 'Mining: extract 300 cargo to complete your quota.' : `${value.teamFormat ? 'Team domination' : 'Domination'}: control ${5 * value.playerCount} sites, half the chart. Mines supply recruitment cargo.`}</Text>
    <Text style={s.detail}>Each player starts with six sites, including one mine, 160 drones, and 5 cargo. Hiring costs 1 credit and 5 cargo. The generated chart has 10 sites per player ({10 * value.playerCount} total).</Text>
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
