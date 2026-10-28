/** Public territorial progress for domination operations. */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { playersIn } from '../game/players';
import { victoryProgress, victoryTarget } from '../game/rules';
import { FACTIONS } from '../game/simulation';
import type { GameView } from '../game/visibility';

export function TerritoryStandings({ game }: { game: GameView }) {
  if (game.rules?.mode !== 'domination' || game.rocks.some(r => r.owner === undefined)) return null;
  return <View style={s.panel}><Text style={s.title}>Territory standings</Text>
    {playersIn(game).map(f => <Text key={f} style={[s.entry, { color: FACTIONS[f].color }]}>{FACTIONS[f].name}: {victoryProgress(game, f)} / {victoryTarget(game)}{game.eliminated.includes(f) ? ' · eliminated' : ''}</Text>)}
    {game.forecastUncertain && <Text style={s.detail}>Projected from public owners and observed outcomes. Unseen battles can change these totals.</Text>}
  </View>;
}
const s = StyleSheet.create({
  panel: { padding: 16, borderWidth: 1, borderColor: '#30402e', backgroundColor: '#101b13', gap: 10 }, title: { color: '#e5eadc', fontSize: 16 }, entry: { fontSize: 14 }, detail: { color: '#8c9f85', fontSize: 12, lineHeight: 19 },
});
